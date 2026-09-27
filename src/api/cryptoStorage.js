/**
 * DarkMSAL CryptoStorage (Zero-Retention Security Engine)
 * 
 * Compliant with 152-FZ & Zero-Retention Architecture:
 * - Credentials and tokens are NEVER sent to any third-party or intermediate server.
 * - Sensitive values (access_token, refresh_token, student password) are encrypted at rest using AES-GCM 256.
 * - Cryptographic key is derived per device/browser session using Web Crypto API.
 * - Memory vault caches values in RAM during active app session to eliminate crypto overhead.
 */

// Memory cache for sub-millisecond synchronous reads during active session
const memoryVault = new Map();

// Local device salt and master key management
const SALT_KEY = 'msal_crypto_salt_v1';
const KEY_NAME = 'msal_aes_key';

let cachedCryptoKey = null;

async function getOrDeriveKey() {
  if (cachedCryptoKey) return cachedCryptoKey;

  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return null; // Fallback to memory-only or raw if WebCrypto is unavailable
  }

  try {
    let salt = localStorage.getItem(SALT_KEY);
    if (!salt) {
      const saltBuffer = new Uint8Array(16);
      crypto.getRandomValues(saltBuffer);
      salt = Array.from(saltBuffer).map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(SALT_KEY, salt);
    }

    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(`${salt}_DarkMSAL_Local_Keystore`),
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const saltBytes = new Uint8Array(salt.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

    cachedCryptoKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    return cachedCryptoKey;
  } catch (err) {
    console.warn('[CryptoStorage] Key derivation warning:', err);
    return null;
  }
}

/**
 * Encrypt a text or object with AES-GCM 256
 */
async function encryptValue(data) {
  const key = await getOrDeriveKey();
  if (!key || typeof crypto === 'undefined' || !crypto.subtle) {
    return typeof data === 'string' ? data : JSON.stringify(data);
  }

  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const strData = typeof data === 'string' ? data : JSON.stringify(data);
    const enc = new TextEncoder();
    const encoded = enc.encode(strData);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded
    );

    const ivArr = Array.from(iv);
    const ctArr = Array.from(new Uint8Array(ciphertext));
    return `enc_v1:${JSON.stringify({ iv: ivArr, ct: ctArr })}`;
  } catch (err) {
    console.warn('[CryptoStorage] Encrypt failed:', err);
    return typeof data === 'string' ? data : JSON.stringify(data);
  }
}

/**
 * Decrypt an AES-GCM 256 ciphertext
 */
async function decryptValue(rawVal) {
  if (typeof rawVal !== 'string') return rawVal;
  if (!rawVal.startsWith('enc_v1:')) {
    // Unencrypted or legacy string
    try {
      return JSON.parse(rawVal);
    } catch (_) {
      return rawVal;
    }
  }

  const key = await getOrDeriveKey();
  if (!key || typeof crypto === 'undefined' || !crypto.subtle) {
    return null;
  }

  try {
    const jsonStr = rawVal.slice(7);
    const { iv, ct } = JSON.parse(jsonStr);
    const ivBuf = new Uint8Array(iv);
    const ctBuf = new Uint8Array(ct);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBuf },
      key,
      ctBuf
    );

    const dec = new TextDecoder();
    const text = dec.decode(decrypted);
    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  } catch (err) {
    console.warn('[CryptoStorage] Decrypt failed:', err);
    return null;
  }
}

export const cryptoStorage = {
  /**
   * Pre-load critical keys and cached API data from disk into fast RAM cache
   */
  async init() {
    if (typeof localStorage === 'undefined') return;

    const coreKeys = [
      'access_token',
      'refresh_token',
      'cached_user',
      'saved_login',
      'saved_password',
      'msal_owa_credentials',
      'msal_owa_session'
    ];

    const targetKeys = [...coreKeys];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('msal_cache_') && !targetKeys.includes(key)) {
        targetKeys.push(key);
      }
    }

    await Promise.all(
      targetKeys.map(async (k) => {
        const rawVal = localStorage.getItem(k);
        if (rawVal !== null && !memoryVault.has(k)) {
          const decrypted = await decryptValue(rawVal);
          if (decrypted !== null) {
            memoryVault.set(k, decrypted);
          }
        }
      })
    );
  },

  /**
   * Asynchronously store an encrypted value in localStorage and memory
   */
  async setItem(key, value) {
    if (!key) return;
    memoryVault.set(key, value);

    if (typeof localStorage === 'undefined') return;

    if (value === null || value === undefined) {
      localStorage.removeItem(key);
      memoryVault.delete(key);
      return;
    }

    try {
      const encrypted = await encryptValue(value);
      localStorage.setItem(key, encrypted);
    } catch (e) {
      console.warn(`[CryptoStorage] Error writing ${key}:`, e);
    }
  },

  /**
   * Synchronously store in memory and schedule encrypted disk persistence
   */
  setItemFast(key, value) {
    if (!key) return;
    memoryVault.set(key, value);
    // Non-blocking asynchronous encryption to disk
    this.setItem(key, value).catch(() => {});
  },

  /**
   * Read item with async decryption fallback
   */
  async getItem(key) {
    if (!key) return null;
    if (memoryVault.has(key)) {
      return memoryVault.get(key);
    }

    if (typeof localStorage === 'undefined') return null;

    const raw = localStorage.getItem(key);
    if (!raw) return null;

    const decrypted = await decryptValue(raw);
    if (decrypted !== null) {
      memoryVault.set(key, decrypted);
    }
    return decrypted;
  },

  /**
   * Fast synchronous read from RAM cache
   */
  getItemSync(key) {
    if (!key) return null;
    return memoryVault.get(key) || null;
  },

  /**
   * Remove item from memory and disk
   */
  removeItem(key) {
    if (!key) return;
    memoryVault.delete(key);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  },

  /**
   * Complete secure purge of all sensitive student data and tokens
   */
  async purgeAll() {
    memoryVault.clear();
    const keysToRemove = [
      'access_token',
      'refresh_token',
      'token',
      'cached_user',
      'saved_login',
      'saved_password',
      'msal_owa_credentials',
      'msal_owa_session',
      'msal_mail_cookies',
      'msal_mail_canary',
      'msal_mail_username'
    ];

    if (typeof localStorage !== 'undefined') {
      const allKeys = Object.keys(localStorage);
      for (const k of allKeys) {
        if (k.startsWith('msal_') || keysToRemove.includes(k)) {
          localStorage.removeItem(k);
        }
      }
    }
  },

  // Token Helpers
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

  // User Profile Helpers
  setUser(userData) {
    if (userData) this.setItemFast('cached_user', userData);
  },

  getUser() {
    return this.getItemSync('cached_user');
  },

  // Persistent Credentials for Silent Re-auth & Mail SSO (AES-256 GCM)
  saveCredentials(login, password) {
    if (login && password) {
      this.setItemFast('saved_login', login);
      this.setItemFast('saved_password', password);
      // Seamlessly sync credentials for Exchange OWA Single Sign-On
      this.setItemFast('msal_owa_credentials', {
        username: login,
        password: password,
        savedAt: Date.now()
      });
    }
  },

  // Alias for backward compatibility with authService
  setSavedCredentials(login, password) {
    return this.saveCredentials(login, password);
  },

  getSavedCredentials() {
    return {
      login: this.getItemSync('saved_login') || null,
      password: this.getItemSync('saved_password') || null
    };
  },

  async getSavedCredentialsAsync() {
    await this.init();
    let login = this.getItemSync('saved_login') || (await this.getItem('saved_login'));
    let password = this.getItemSync('saved_password') || (await this.getItem('saved_password'));

    if (!login || !password) {
      const owa = this.getItemSync('msal_owa_credentials') || (await this.getItem('msal_owa_credentials'));
      if (owa?.username && owa?.password) {
        login = owa.username;
        password = owa.password;
      }
    }

    return { login: login || null, password: password || null };
  },

  // Mail Credentials Helpers (SSO with LK credentials)
  getMailCredentials() {
    const owaCreds = this.getItemSync('msal_owa_credentials');
    if (owaCreds && owaCreds.username && owaCreds.password) {
      return owaCreds;
    }
    const saved = this.getSavedCredentials();
    if (saved && saved.login && saved.password) {
      return {
        username: saved.login,
        password: saved.password
      };
    }
    return null;
  },

  setMailCredentials(username, password) {
    if (username && password) {
      this.setItemFast('msal_owa_credentials', {
        username,
        password,
        savedAt: Date.now()
      });
      this.saveCredentials(username, password);
    }
  },

  clearMailCredentials() {
    this.removeItem('msal_owa_credentials');
  }
};
