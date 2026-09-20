/**
 * MSAL+ Secure Client-Side Cryptographic Storage
 * Implements 152-FZ zero-knowledge local-only data protection.
 *
 * Technical Specifications:
 * - Algorithm: AES-GCM 256 with 96-bit random IV per operation
 * - Key Derivation / Storage: Native Web Crypto API (window.crypto.subtle)
 * - Key Persistence: IndexedDB (non-extractable CryptoKey, extractable: false)
 * - Storage Target: Encrypted ciphertext strings prefixed with 'ENC:' in localStorage
 * - Memory Vault: In-memory decrypted cache for high-performance synchronous reads
 */

const DB_NAME = 'msal_secure_vault';
const STORE_NAME = 'keys';
const MASTER_KEY_ID = 'msal_master_key';
const ENC_PREFIX = 'ENC:';

// In-memory decrypted cache for instant synchronous access
const memoryVault = new Map();
let masterCryptoKey = null;
let isInitialized = false;
let initPromise = null;

/**
 * Convert ArrayBuffer to Base64
 */
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

/**
 * Convert Base64 to ArrayBuffer
 */
function base64ToArrayBuffer(base64) {
  const binary = window.atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Open or upgrade IndexedDB for secure key storage
 */
function openKeyDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not supported in current environment'));
    }

    const req = window.indexedDB.open(DB_NAME, 1);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open secure key database'));
  });
}

/**
 * Retrieve or generate the non-extractable master AES-GCM 256 key
 */
async function getOrGenerateMasterKey() {
  if (masterCryptoKey) return masterCryptoKey;

  try {
    const db = await openKeyDatabase();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const existingRecord = await new Promise((resolve, reject) => {
      const getReq = store.get(MASTER_KEY_ID);
      getReq.onsuccess = () => resolve(getReq.result);
      getReq.onerror = () => reject(getReq.error);
    });

    if (existingRecord && existingRecord.key) {
      masterCryptoKey = existingRecord.key;
      return masterCryptoKey;
    }

    // Generate non-extractable 256-bit AES-GCM key
    // extractable: false guarantees key raw bytes can NEVER be inspected or stolen via XSS
    const newKey = await window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    await new Promise((resolve, reject) => {
      const putReq = store.put({
        id: MASTER_KEY_ID,
        key: newKey,
        createdAt: Date.now()
      });
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    });

    masterCryptoKey = newKey;
    return masterCryptoKey;
  } catch (err) {
    console.warn('[SecureVault] IndexedDB unavailable, using ephemeral in-memory key:', err.message);
    if (!masterCryptoKey) {
      masterCryptoKey = await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    }
    return masterCryptoKey;
  }
}

/**
 * Encrypt a JavaScript value using AES-GCM
 */
async function encryptValue(key, value) {
  if (value === undefined || value === null) return null;

  const jsonStr = JSON.stringify(value);
  const encodedData = new TextEncoder().encode(jsonStr);
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit random IV

  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encodedData
  );

  // Combine IV (12 bytes) + Ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return ENC_PREFIX + arrayBufferToBase64(combined.buffer);
}

/**
 * Decrypt an AES-GCM encrypted string
 */
async function decryptValue(key, rawString) {
  if (!rawString || typeof rawString !== 'string') return null;

  // If not encrypted (legacy item), parse and return
  if (!rawString.startsWith(ENC_PREFIX)) {
    try {
      return JSON.parse(rawString);
    } catch (_) {
      return rawString;
    }
  }

  const base64Data = rawString.slice(ENC_PREFIX.length);
  const combinedBuf = base64ToArrayBuffer(base64Data);
  const combined = new Uint8Array(combinedBuf);

  if (combined.length < 13) return null;

  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  const jsonStr = new TextDecoder().decode(decrypted);
  return JSON.parse(jsonStr);
}

export const cryptoStorage = {
  /**
   * Initialize crypto storage: derives key, preloads and decrypts tokens & user profile
   */
  async init() {
    if (isInitialized) return true;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        const key = await getOrGenerateMasterKey();

        // Preload core security keys into memory vault
        const coreKeys = ['access_token', 'refresh_token', 'cached_user'];

        // Also detect cached data items starting with msal_cache_
        const allKeys = Object.keys(localStorage);
        for (const k of allKeys) {
          if (k && (k.startsWith('msal_cache_') || coreKeys.includes(k))) {
            const rawVal = localStorage.getItem(k);
            if (rawVal) {
              try {
                const decrypted = await decryptValue(key, rawVal);
                if (decrypted !== null && decrypted !== undefined) {
                  memoryVault.set(k, decrypted);
                  // Transparently upgrade legacy plaintext items to encrypted format
                  if (!rawVal.startsWith(ENC_PREFIX)) {
                    encryptValue(key, decrypted).then(enc => {
                      if (enc) localStorage.setItem(k, enc);
                    }).catch(() => {});
                  }
                }
              } catch (e) {
                console.warn(`[SecureVault] Failed to decrypt key "${k}":`, e.message);
              }
            }
          }
        }

        isInitialized = true;
        return true;
      } catch (err) {
        console.error('[SecureVault] Initialization failed:', err);
        return false;
      } finally {
        initPromise = null;
      }
    })();

    return initPromise;
  },

  /**
   * Save an item: updates in-memory vault immediately and asynchronously persists AES-GCM ciphertext
   */
  async setItem(key, value) {
    if (!key) return;
    memoryVault.set(key, value);

    try {
      const cryptoKey = await getOrGenerateMasterKey();
      const encrypted = await encryptValue(cryptoKey, value);
      if (encrypted) {
        localStorage.setItem(key, encrypted);
      }
    } catch (e) {
      console.warn(`[SecureVault] Encrypt write failed for "${key}":`, e.message);
    }
  },

  /**
   * Synchronous set in memory vault + fire-and-forget encrypted disk persist
   */
  setItemFast(key, value) {
    if (!key) return;
    memoryVault.set(key, value);
    this.setItem(key, value).catch(() => {});
  },

  /**
   * Read item asynchronously (checks memory vault first, then decrypts from disk)
   */
  async getItem(key) {
    if (!key) return null;
    if (memoryVault.has(key)) {
      return memoryVault.get(key);
    }

    const raw = localStorage.getItem(key);
    if (!raw) return null;

    try {
      const cryptoKey = await getOrGenerateMasterKey();
      const decrypted = await decryptValue(cryptoKey, raw);
      if (decrypted !== null && decrypted !== undefined) {
        memoryVault.set(key, decrypted);
      }
      return decrypted;
    } catch (e) {
      console.warn(`[SecureVault] Decrypt read failed for "${key}":`, e.message);
      return null;
    }
  },

  /**
   * Read item synchronously from memory vault (instant zero-latency read)
   */
  getItemSync(key) {
    if (!key) return null;
    if (memoryVault.has(key)) {
      return memoryVault.get(key);
    }
    // Fallback: check if unencrypted legacy item exists in localStorage
    const raw = localStorage.getItem(key);
    if (raw && !raw.startsWith(ENC_PREFIX)) {
      try {
        const parsed = JSON.parse(raw);
        memoryVault.set(key, parsed);
        return parsed;
      } catch (_) {
        memoryVault.set(key, raw);
        return raw;
      }
    }
    return null;
  },

  /**
   * Remove an item from both memory vault and disk
   */
  removeItem(key) {
    if (!key) return;
    memoryVault.delete(key);
    localStorage.removeItem(key);
  },

  /**
   * Fast token access for HTTP client headers
   */
  getToken() {
    return this.getItemSync('access_token');
  },

  getRefreshToken() {
    return this.getItemSync('refresh_token');
  },

  getUser() {
    return this.getItemSync('cached_user');
  },

  setTokens(accessToken, refreshToken) {
    if (accessToken) this.setItemFast('access_token', accessToken);
    if (refreshToken) this.setItemFast('refresh_token', refreshToken);
  },

  setUser(userData) {
    if (userData) this.setItemFast('cached_user', userData);
  },

  /**
   * Cryptographic shredding & complete data purge upon logout
   * Deletes in-memory keys, clears localStorage, and rotates/wipes the IndexedDB key
   */
  async purgeAll() {
    memoryVault.clear();

    // Remove all cached items and tokens from localStorage
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('msal_cache_') || k === 'access_token' || k === 'refresh_token' || k === 'cached_user')) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));

    // Clear key in IndexedDB so any residual ciphertext is unrecoverable
    try {
      const db = await openKeyDatabase();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      await new Promise((res) => {
        const delReq = store.delete(MASTER_KEY_ID);
        delReq.onsuccess = () => res();
        delReq.onerror = () => res();
      });
    } catch (_) {}

    masterCryptoKey = null;
    isInitialized = false;
  }
};
