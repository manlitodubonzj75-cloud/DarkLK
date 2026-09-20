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
 * Retrieve existing AES-GCM CryptoKey from IndexedDB or generate a new non-extractable 256-bit key
 */
async function getOrGenerateMasterKey() {
  if (masterCryptoKey) return masterCryptoKey;

  const db = await openKeyDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(MASTER_KEY_ID);

    getReq.onsuccess = async () => {
      if (getReq.result && getReq.result.key) {
        masterCryptoKey = getReq.result.key;
        return resolve(masterCryptoKey);
      }

      // Generate a new 256-bit AES-GCM non-extractable key
      try {
        const newKey = await window.crypto.subtle.generateKey(
          {
            name: 'AES-GCM',
            length: 256
          },
          false, // extractable: false (hardware / crypto-subsystem isolated)
          ['encrypt', 'decrypt']
        );

        const writeTx = db.transaction(STORE_NAME, 'readwrite');
        const writeStore = writeTx.objectStore(STORE_NAME);
        const putReq = writeStore.put({ id: MASTER_KEY_ID, key: newKey });

        putReq.onsuccess = () => {
          masterCryptoKey = newKey;
          resolve(masterCryptoKey);
        };
        putReq.onerror = () => reject(putReq.error || new Error('Failed to store generated master key'));
      } catch (err) {
        reject(err);
      }
    };

    getReq.onerror = () => reject(getReq.error || new Error('Failed to lookup master key'));
  });
}

/**
 * Encrypt arbitrary JSON data with AES-GCM 256 using 96-bit random IV
 */
async function encryptValue(cryptoKey, value) {
  if (value === null || value === undefined) return null;

  const jsonStr = JSON.stringify(value);
  const encoded = new TextEncoder().encode(jsonStr);

  // 96-bit unique IV per operation as required by NIST SP 800-38D
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const cipherBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv
    },
    cryptoKey,
    encoded
  );

  const ivBase64 = arrayBufferToBase64(iv.buffer);
  const cipherBase64 = arrayBufferToBase64(cipherBuffer);

  return `${ENC_PREFIX}${ivBase64}:${cipherBase64}`;
}

/**
 * Decrypt ciphertext string with AES-GCM 256
 */
async function decryptValue(cryptoKey, cipherText) {
  if (!cipherText || typeof cipherText !== 'string') return null;

  // Transparently return unencrypted legacy values if any
  if (!cipherText.startsWith(ENC_PREFIX)) {
    try {
      return JSON.parse(cipherText);
    } catch (_) {
      return cipherText;
    }
  }

  const payload = cipherText.slice(ENC_PREFIX.length);
  const [ivBase64, cipherBase64] = payload.split(':');
  if (!ivBase64 || !cipherBase64) return null;

  const iv = base64ToArrayBuffer(ivBase64);
  const cipher = base64ToArrayBuffer(cipherBase64);

  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(iv)
    },
    cryptoKey,
    cipher
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

        // Preload core security keys and credentials into memory vault
        const coreKeys = ['access_token', 'refresh_token', 'cached_user', 'saved_login', 'saved_password'];

        // Detect all keys starting with msal_cache_ or matching coreKeys
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

  getSavedCredentials() {
    const login = this.getItemSync('saved_login') || localStorage.getItem('saved_login');
    const password = this.getItemSync('saved_password');
    return { login, password };
  },

  setTokens(accessToken, refreshToken) {
    if (accessToken) this.setItemFast('access_token', accessToken);
    if (refreshToken) this.setItemFast('refresh_token', refreshToken);
  },

  setUser(userData) {
    if (userData) this.setItemFast('cached_user', userData);
  },

  setSavedCredentials(login, password) {
    if (login) this.setItemFast('saved_login', login);
    if (password) this.setItemFast('saved_password', password);
    try {
      localStorage.removeItem('saved_login');
    } catch (_) {}
  },

  /**
   * Cryptographic shredding & complete data purge upon logout
   * Deletes in-memory keys, clears localStorage, and rotates/wipes the IndexedDB key
   */
  async purgeAll() {
    memoryVault.clear();

    const coreKeys = ['access_token', 'refresh_token', 'cached_user', 'saved_login', 'saved_password'];

    // Remove all cached items, credentials and tokens from localStorage
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('msal_cache_') || k.startsWith('_fast_msal_cache_') || coreKeys.includes(k))) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));

    // Clear key in IndexedDB so any residual ciphertext is permanently unrecoverable
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
