/**
 * DarkMSAL Key Provider
 *
 * Выдаёт ключ шифрования данных (DEK, AES-GCM-256), который хранится
 * НЕ рядом с зашифрованными данными, а в хранилище платформы:
 *
 *  - Android / iOS (Capacitor): Android Keystore / iOS Keychain
 *    через @aparajita/capacitor-secure-storage;
 *  - Electron: ключ ОС (Keychain / DPAPI / libsecret) через safeStorage в main-процессе;
 *  - Userscript: хранилище менеджера скриптов (GM.getValue) — недоступно
 *    скриптам самой страницы lk.msal.ru;
 *  - Обычный браузер / dev: неизвлекаемый CryptoKey в IndexedDB.
 *
 * Зашифрованные данные при этом могут лежать в localStorage — без DEK они бесполезны.
 */
import { Capacitor } from '@capacitor/core';

const DEK_NAME = 'darkmsal_dek_v2';
const IDB_NAME = 'darkmsal-vault';
const IDB_STORE = 'keys';

function bytesToB64(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export { bytesToB64, b64ToBytes };

/* ------------------------------------------------------------------ */
/* Platform detection                                                  */
/* ------------------------------------------------------------------ */

// ВАЖНО: GM_* ищем только в области видимости userscript-песочницы,
// а не на window — иначе страница могла бы подсунуть свою реализацию.
function getGMStorage() {
  /* eslint-disable no-undef */
  try {
    if (typeof GM !== 'undefined' && GM && typeof GM.getValue === 'function' && typeof GM.setValue === 'function') {
      return {
        get: (k) => GM.getValue(k, null),
        set: (k, v) => GM.setValue(k, v),
        del: (k) => (typeof GM.deleteValue === 'function' ? GM.deleteValue(k) : GM.setValue(k, null))
      };
    }
  } catch (_) {}
  try {
    if (typeof GM_getValue === 'function' && typeof GM_setValue === 'function') {
      return {
        get: async (k) => GM_getValue(k, null),
        set: async (k, v) => GM_setValue(k, v),
        del: async (k) => (typeof GM_deleteValue === 'function' ? GM_deleteValue(k) : GM_setValue(k, null))
      };
    }
  } catch (_) {}
  /* eslint-enable no-undef */
  return null;
}

export function detectKeyPlatform() {
  if (typeof window === 'undefined') return 'none';
  if (window.electronAPI?.isElectron && typeof window.electronAPI.vaultKey === 'function') return 'electron';
  if (getGMStorage()) return 'userscript';
  try {
    if (Capacitor.isNativePlatform()) return 'native';
  } catch (_) {}
  return 'web';
}

/* ------------------------------------------------------------------ */
/* Raw key helpers                                                     */
/* ------------------------------------------------------------------ */

function newRawKey() {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  return raw;
}

async function importRaw(raw) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/* ------------------------------------------------------------------ */
/* Backends                                                            */
/* ------------------------------------------------------------------ */

const electronBackend = {
  async load() {
    const b64 = await window.electronAPI.vaultKey('get');
    return b64 ? importRaw(b64ToBytes(b64)) : null;
  },
  async create() {
    const raw = newRawKey();
    const ok = await window.electronAPI.vaultKey('set', bytesToB64(raw));
    if (!ok) return null;
    return importRaw(raw);
  },
  async destroy() {
    await window.electronAPI.vaultKey('delete');
  }
};

const userscriptBackend = {
  async load() {
    const b64 = await getGMStorage().get(DEK_NAME);
    return b64 ? importRaw(b64ToBytes(b64)) : null;
  },
  async create() {
    const raw = newRawKey();
    await getGMStorage().set(DEK_NAME, bytesToB64(raw));
    return importRaw(raw);
  },
  async destroy() {
    await getGMStorage().del(DEK_NAME);
  }
};

let secureStoragePluginPromise = null;
async function getSecureStoragePlugin() {
  if (!secureStoragePluginPromise) {
    secureStoragePluginPromise = (async () => {
      if (!Capacitor.isPluginAvailable('SecureStorage')) return null;
      const mod = await import('@aparajita/capacitor-secure-storage');
      const plugin = mod.SecureStorage;
      await plugin.setKeyPrefix('darkmsal_');
      try {
        // Не синхронизировать ключ в iCloud
        await plugin.setSynchronize(false);
      } catch (_) {}
      return plugin;
    })().catch((err) => {
      console.warn('[KeyProvider] SecureStorage plugin unavailable:', err?.message);
      return null;
    });
  }
  return secureStoragePluginPromise;
}

const nativeBackend = {
  async load() {
    const plugin = await getSecureStoragePlugin();
    if (!plugin) return undefined; // сигнал: плагина нет, используем IndexedDB
    const b64 = await plugin.get(DEK_NAME, false);
    return typeof b64 === 'string' && b64 ? importRaw(b64ToBytes(b64)) : null;
  },
  async create() {
    const plugin = await getSecureStoragePlugin();
    if (!plugin) return undefined;
    const raw = newRawKey();
    await plugin.set(DEK_NAME, bytesToB64(raw), false);
    return importRaw(raw);
  },
  async destroy() {
    const plugin = await getSecureStoragePlugin();
    if (plugin) {
      try { await plugin.remove(DEK_NAME); } catch (_) {}
    }
  }
};

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbTx(mode, fn) {
  return idbOpen().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode);
    const store = tx.objectStore(IDB_STORE);
    const req = fn(store);
    tx.oncomplete = () => { db.close(); resolve(req?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  }));
}

// Неизвлекаемый ключ: JS не может получить его байты даже при XSS.
const webBackend = {
  async load() {
    if (typeof indexedDB === 'undefined') return null;
    const key = await idbTx('readonly', (s) => s.get(DEK_NAME));
    return key || null;
  },
  async create() {
    if (typeof indexedDB === 'undefined') return null;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await idbTx('readwrite', (s) => s.put(key, DEK_NAME));
    return key;
  },
  async destroy() {
    if (typeof indexedDB === 'undefined') return;
    try { await idbTx('readwrite', (s) => s.delete(DEK_NAME)); } catch (_) {}
  }
};

const BACKENDS = {
  electron: electronBackend,
  userscript: userscriptBackend,
  native: nativeBackend,
  web: webBackend
};

let dekPromise = null;
let activeBackendName = null;

async function resolveKey(backendName) {
  const backend = BACKENDS[backendName];
  let key = await backend.load();
  if (key === undefined) return undefined;
  if (!key) key = await backend.create();
  return key;
}

/**
 * Возвращает DEK (CryptoKey) или null, если безопасное хранилище недоступно.
 * При null данные НЕ сохраняются на диск (только в памяти).
 */
export function getDataKey() {
  if (!dekPromise) {
    dekPromise = (async () => {
      if (typeof crypto === 'undefined' || !crypto.subtle) return null;
      const primary = detectKeyPlatform();
      if (primary === 'none') return null;
      try {
        const key = await resolveKey(primary);
        if (key) {
          activeBackendName = primary;
          return key;
        }
      } catch (err) {
        console.warn(`[KeyProvider] ${primary} key store failed:`, err?.message);
      }
      // Фолбэк: неизвлекаемый ключ в IndexedDB (например, Capacitor без синка плагина
      // или Linux без keyring в Electron)
      if (primary !== 'web' && primary !== 'userscript') {
        try {
          const key = await resolveKey('web');
          if (key) {
            activeBackendName = 'web';
            return key;
          }
        } catch (err) {
          console.warn('[KeyProvider] IndexedDB key store failed:', err?.message);
        }
      }
      return null;
    })();
  }
  return dekPromise;
}

export function getActiveKeyBackend() {
  return activeBackendName;
}

/**
 * Уничтожает DEK во всех хранилищах (при выходе из аккаунта).
 */
export async function destroyDataKey() {
  dekPromise = null;
  activeBackendName = null;
  const primary = detectKeyPlatform();
  const tasks = [];
  if (BACKENDS[primary]) tasks.push(BACKENDS[primary].destroy());
  if (primary !== 'web') tasks.push(webBackend.destroy());
  await Promise.all(tasks.map((p) => p.catch(() => {})));
}
