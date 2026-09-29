/**
 * DarkMSAL CryptoStorage
 *
 * Схема: envelope-шифрование.
 *  - Значения шифруются AES-GCM-256 случайным ключом данных (DEK).
 *  - DEK хранится в хранилище платформы (см. keyProvider.js), а НЕ в localStorage
 *    рядом с шифротекстом.
 *  - Если безопасного хранилища нет — чувствительные данные живут только в памяти
 *    и на диск не пишутся (никакого тихого фолбэка на открытый текст).
 *
 * Формат значения в localStorage: "v2:" + base64(iv[12] || ciphertext).
 */
import { getDataKey, destroyDataKey, bytesToB64, b64ToBytes } from './keyProvider.js';

const PREFIX_V2 = 'v2:';
const PREFIX_V1 = 'enc_v1:';

// Ключи localStorage, которые считаются чувствительными и хранятся только зашифрованными
const CREDENTIALS_KEY = 'msal_credentials';
const SENSITIVE_KEYS = [
  'access_token',
  'refresh_token',
  'cached_user',
  CREDENTIALS_KEY,
  'msal_mail_session'
];
const SENSITIVE_PREFIXES = ['msal_cache_'];

// Устаревшие ключи (v1), которые надо мигрировать или удалить
const LEGACY_SALT_KEY = 'msal_crypto_salt_v1';
const LEGACY_KEYS = [
  'token',
  'saved_login',
  'saved_password',
  'msal_owa_credentials',
  'msal_owa_session',
  'msal_mail_cookies',
  'msal_mail_canary',
  'msal_mail_currentUser',
  'msal_mail_username'
];

// RAM-кэш расшифрованных значений
const memoryVault = new Map();
// Счётчик версий на ключ, чтобы поздняя асинхронная запись не перетёрла свежую
const writeSeq = new Map();

let initPromise = null;

function isSensitiveKey(key) {
  return SENSITIVE_KEYS.includes(key) || SENSITIVE_PREFIXES.some((p) => key.startsWith(p));
}

function lsGet(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, val); return true; } catch (e) {
    console.warn(`[CryptoStorage] localStorage write failed for ${key}:`, e?.message);
    return false;
  }
}
function lsRemove(key) {
  try { localStorage.removeItem(key); } catch (_) {}
}
function lsKeys() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) out.push(k);
    }
  } catch (_) {}
  return out;
}

/* ---------------- IndexedDB L2 backing store (hundreds of MBs quota) ---------------- */
const IDB_NAME = "msal_crypto_db";
const IDB_STORE = "secure_entries";
let idbInstancePromise = null;

function getIdb() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!idbInstancePromise) {
    idbInstancePromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (_) {
        resolve(null);
      }
    });
  }
  return idbInstancePromise;
}

async function idbGet(key) {
  const db = await getIdb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

async function idbSet(key, val) {
  const db = await getIdb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(val, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch (_) {
      resolve(false);
    }
  });
}

async function idbRemove(key) {
  const db = await getIdb();
  if (!db) return;
  try {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
  } catch (_) {}
}

async function idbKeys() {
  const db = await getIdb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (_) {
      resolve([]);
    }
  });
}

async function idbClear() {
  const db = await getIdb();
  if (!db) return;
  try {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).clear();
  } catch (_) {}
}


async function encryptValue(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(data));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);
  return PREFIX_V2 + bytesToB64(packed);
}

async function decryptValue(key, raw) {
  const packed = b64ToBytes(raw.slice(PREFIX_V2.length));
  const iv = packed.slice(0, 12);
  const ct = packed.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ---------------- Legacy v1 (ключ из соли в localStorage) ---------------- */

async function legacyV1Key() {
  const salt = lsGet(LEGACY_SALT_KEY);
  if (!salt || typeof crypto === 'undefined' || !crypto.subtle) return null;
  try {
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(`${salt}_DarkMSAL_Local_Keystore`),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    const saltBytes = new Uint8Array(salt.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
    return await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
  } catch (_) {
    return null;
  }
}

async function readLegacy(v1Key, raw) {
  if (raw == null) return null;
  if (raw.startsWith(PREFIX_V1)) {
    if (!v1Key) return null;
    try {
      const { iv, ct } = JSON.parse(raw.slice(PREFIX_V1.length));
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(iv) }, v1Key, new Uint8Array(ct));
      const text = new TextDecoder().decode(plain);
      try { return JSON.parse(text); } catch (_) { return text; }
    } catch (_) {
      return null;
    }
  }
  try { return JSON.parse(raw); } catch (_) { return raw; }
}

/**
 * Одноразовая миграция со старого формата: расшифровать, пересохранить в v2,
 * удалить старые ключи и соль. Пароль сводится к одной записи.
 */
async function migrateLegacy() {
  const keys = lsKeys();
  const hasLegacy = keys.some((k) =>
    k === LEGACY_SALT_KEY ||
    LEGACY_KEYS.includes(k) ||
    (isSensitiveKey(k) && !(lsGet(k) || '').startsWith(PREFIX_V2))
  );
  if (!hasLegacy) return;

  const v1Key = await legacyV1Key();

  // 1. Обычные чувствительные ключи, лежащие не в v2
  for (const k of keys) {
    if (!isSensitiveKey(k)) continue;
    const raw = lsGet(k);
    if (!raw || raw.startsWith(PREFIX_V2)) continue;
    const val = await readLegacy(v1Key, raw);
    lsRemove(k);
    if (val !== null && val !== undefined && !memoryVault.has(k)) {
      // кэш старого формата бывал вида {data, timestamp} в открытом виде — сохраняем как есть
      await cryptoStorage.setItem(k, val);
    }
  }

  // 2. Логин/пароль: три старые копии -> одна запись
  const login = await readLegacy(v1Key, lsGet('saved_login'));
  const password = await readLegacy(v1Key, lsGet('saved_password'));
  const owa = await readLegacy(v1Key, lsGet('msal_owa_credentials'));
  const legacyToken = await readLegacy(v1Key, lsGet('token'));
  if (!memoryVault.has(CREDENTIALS_KEY)) {
    const l = (typeof login === 'string' && login) || owa?.username || null;
    const p = (typeof password === 'string' && password) || owa?.password || null;
    if (l && p) {
      const rec = { login: l, password: p };
      if (owa?.username && owa.username !== l) rec.mailLogin = owa.username;
      if (owa?.password && owa.password !== p) rec.mailPassword = owa.password;
      await cryptoStorage.setItem(CREDENTIALS_KEY, rec);
    }
  }
  if (typeof legacyToken === 'string' && legacyToken && !memoryVault.has('access_token')) {
    await cryptoStorage.setItem('access_token', legacyToken);
  }

  // 3. Сессия почты (раньше лежала открытым текстом)
  if (!memoryVault.has('msal_mail_session')) {
    let cookies = null;
    try { cookies = JSON.parse(lsGet('msal_mail_cookies') || 'null'); } catch (_) {}
    const canary = lsGet('msal_mail_canary');
    const currentUser = lsGet('msal_mail_currentUser');
    if (cookies || canary || currentUser) {
      await cryptoStorage.setItem('msal_mail_session', { cookies: cookies || {}, canary, currentUser });
    }
  }

  for (const k of LEGACY_KEYS) lsRemove(k);
  lsRemove(LEGACY_SALT_KEY);
}

async function doInit() {
  if (typeof localStorage === 'undefined' && typeof indexedDB === 'undefined') return;
  const key = await getDataKey();

  if (key) {
    // 1. Load from IndexedDB (large caches, overflow store)
    const iKeys = await idbKeys();
    await Promise.all(iKeys.map(async (k) => {
      if (memoryVault.has(k)) return;
      try {
        const raw = await idbGet(k);
        if (raw && typeof raw === 'string' && raw.startsWith(PREFIX_V2)) {
          memoryVault.set(k, await decryptValue(key, raw));
        }
      } catch (_) {
        await idbRemove(k);
      }
    }));

    // 2. Load from localStorage (fast sync store)
    const targets = lsKeys().filter((k) => isSensitiveKey(k) && (lsGet(k) || '').startsWith(PREFIX_V2));
    await Promise.all(targets.map(async (k) => {
      if (memoryVault.has(k)) return;
      try {
        memoryVault.set(k, await decryptValue(key, lsGet(k)));
      } catch (_) {
        // ключ сменился/данные повреждены — выбрасываем
        lsRemove(k);
      }
    }));
  }

  try {
    await migrateLegacy();
  } catch (err) {
    console.warn('[CryptoStorage] Legacy migration failed:', err?.message);
  }
}

export const cryptoStorage = {
  /**
   * Загружает ключ и расшифровывает хранилище в RAM.
   * Вызывается один раз до рендера приложения; повторные вызовы дешёвые.
   */
  init() {
    if (!initPromise) {
      initPromise = doInit().catch((err) => {
        console.warn('[CryptoStorage] init failed:', err?.message);
      });
    }
    return initPromise;
  },

  async setItem(key, value) {
    if (!key) return;
    const seq = (writeSeq.get(key) || 0) + 1;
    writeSeq.set(key, seq);

    if (value === null || value === undefined) {
      memoryVault.delete(key);
      lsRemove(key);
      await idbRemove(key);
      return;
    }
    memoryVault.set(key, value);
    if (typeof localStorage === 'undefined' && typeof indexedDB === 'undefined') return;

    const dek = await getDataKey();
    if (!dek) {
      // Безопасного хранилища нет — не пишем на диск вообще
      lsRemove(key);
      await idbRemove(key);
      return;
    }
    try {
      const encrypted = await encryptValue(dek, value);
      if (writeSeq.get(key) === seq) {
        // Always persist to IndexedDB (asynchronous, hundreds of MBs quota)
        await idbSet(key, encrypted);

        // Also persist to localStorage for ultra-fast startup if space permits
        const written = lsSet(key, encrypted);
        if (!written && key.startsWith('msal_cache_')) {
          // If localStorage is full, evict oldest msal_cache_* entries from localStorage
          // (They remain safely stored in IndexedDB!)
          try {
            const cacheKeys = lsKeys().filter((k) => k.startsWith('msal_cache_'));
            for (let i = 0; i < Math.min(5, cacheKeys.length); i++) {
              lsRemove(cacheKeys[i]);
            }
            lsSet(key, encrypted);
          } catch (_) {}
        }
      }
    } catch (e) {
      console.warn(`[CryptoStorage] Error writing ${key}:`, e?.message);
    }
  },

  setItemFast(key, value) {
    if (!key) return;
    if (value === null || value === undefined) {
      this.removeItem(key);
      return;
    }
    memoryVault.set(key, value);
    this.setItem(key, value).catch(() => {});
  },

  async getItem(key) {
    if (!key) return null;
    await this.init();
    return memoryVault.has(key) ? memoryVault.get(key) : null;
  },

  getItemSync(key) {
    if (!key) return null;
    const v = memoryVault.get(key);
    return v === undefined ? null : v;
  },

  hasItem(key) {
    return memoryVault.has(key);
  },

  keys(prefix = '') {
    return Array.from(memoryVault.keys()).filter((k) => k.startsWith(prefix));
  },

  removeItem(key) {
    if (!key) return;
    writeSeq.set(key, (writeSeq.get(key) || 0) + 1);
    memoryVault.delete(key);
    lsRemove(key);
    idbRemove(key).catch(() => {});
  },

  /**
   * Полная очистка: данные, кэш, сессии и сам ключ шифрования.
   */
  async purgeAll() {
    for (const k of memoryVault.keys()) writeSeq.set(k, (writeSeq.get(k) || 0) + 1);
    memoryVault.clear();
    for (const k of lsKeys()) {
      if (k.startsWith('msal_') || isSensitiveKey(k) || LEGACY_KEYS.includes(k)) {
        lsRemove(k);
      }
    }
    await idbClear();
    await destroyDataKey();
    initPromise = null;
  },

  // ---------------- Tokens ----------------
  setTokens(accessToken, refreshToken = null) {
    if (accessToken) this.setItemFast('access_token', accessToken);
    if (refreshToken) this.setItemFast('refresh_token', refreshToken);
  },

  getToken() {
    return this.getItemSync('access_token');
  },

  getRefreshToken() {
    return this.getItemSync('refresh_token');
  },

  // ---------------- User profile ----------------
  setUser(userData) {
    if (userData) this.setItemFast('cached_user', userData);
  },

  getUser() {
    return this.getItemSync('cached_user');
  },

  // ---------------- Credentials (одна запись) ----------------
  saveCredentials(login, password) {
    if (!login || !password) return;
    const prev = this.getItemSync(CREDENTIALS_KEY) || {};
    const rec = { login, password };
    // Отдельные данные почты сохраняем, только если они реально отличаются
    if (prev.mailLogin && prev.mailLogin !== login) rec.mailLogin = prev.mailLogin;
    this.setItemFast(CREDENTIALS_KEY, rec);
  },

  setSavedCredentials(login, password) {
    return this.saveCredentials(login, password);
  },

  getSavedCredentials() {
    const rec = this.getItemSync(CREDENTIALS_KEY);
    return { login: rec?.login || null, password: rec?.password || null };
  },

  async getSavedCredentialsAsync() {
    await this.init();
    return this.getSavedCredentials();
  },

  getMailCredentials() {
    const rec = this.getItemSync(CREDENTIALS_KEY);
    if (!rec) return null;
    const username = rec.mailLogin || rec.login;
    const password = rec.mailPassword || rec.password;
    return username && password ? { username, password } : null;
  },

  setMailCredentials(username, password) {
    if (!username || !password) return;
    const prev = this.getItemSync(CREDENTIALS_KEY);
    if (!prev?.login) {
      this.setItemFast(CREDENTIALS_KEY, { login: username, password });
      return;
    }
    const rec = { login: prev.login, password: prev.password };
    if (username !== prev.login) rec.mailLogin = username;
    if (password !== prev.password) rec.mailPassword = password;
    this.setItemFast(CREDENTIALS_KEY, rec);
  },

  clearMailCredentials() {
    const prev = this.getItemSync(CREDENTIALS_KEY);
    if (prev && (prev.mailLogin || prev.mailPassword)) {
      this.setItemFast(CREDENTIALS_KEY, { login: prev.login, password: prev.password });
    }
  }
};
