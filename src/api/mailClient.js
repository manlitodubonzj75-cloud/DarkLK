/**
 * DarkMSAL - Universal Mail HTTP Transport (OWA / Exchange 2016)
 *
 * Supports:
 * - Tampermonkey / Violentmonkey Userscripts (via GM_xmlhttpRequest / GM.xmlHttpRequest)
 * - Electron Desktop (via direct fetch with relaxed CORS)
 * - Capacitor iOS / Android (via native fetch / capacitor)
 * - Local Vite Development (via '/owa-proxy' in vite.config.js)
 */

import { cryptoStorage } from './cryptoStorage.js';

const OWA_CREDS_STORAGE_KEY = 'msal_owa_credentials';
const OWA_SESSION_STORAGE_KEY = 'msal_owa_session';

// Environment detection
const isUserscript = typeof GM_xmlhttpRequest !== 'undefined' || (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function');
const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);
const isCapacitor = typeof window !== 'undefined' && (
  Boolean(window.Capacitor?.isNativePlatform?.()) ||
  window.Capacitor?.getPlatform?.() === 'android' ||
  window.Capacitor?.getPlatform?.() === 'ios'
);
const isDev = import.meta.env?.DEV;

// Base URL selection
function getBaseUrl() {
  if (isUserscript || isElectron || isCapacitor) {
    return 'https://mail.msal.ru';
  }
  // In local browser development (Vite), use configured proxy
  return isDev ? '/owa-proxy' : 'https://mail.msal.ru';
}

class MailClient {
  constructor() {
    this.sessionCookies = {};
    this.canary = null;
    this.isReauthenticating = false;
    this.reauthPromise = null;
    this.loadCachedSession();
  }

  loadCachedSession() {
    try {
      const raw = localStorage.getItem(OWA_SESSION_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.cookies) this.sessionCookies = parsed.cookies;
        if (parsed.canary) this.canary = parsed.canary;
      }
    } catch (_) {}
  }

  saveSession() {
    try {
      localStorage.setItem(OWA_SESSION_STORAGE_KEY, JSON.stringify({
        cookies: this.sessionCookies,
        canary: this.canary,
        updatedAt: Date.now()
      }));
    } catch (_) {}
  }

  clearSession() {
    this.sessionCookies = {};
    this.canary = null;
    try {
      localStorage.removeItem(OWA_SESSION_STORAGE_KEY);
    } catch (_) {}
  }

  parseAndStoreCookies(rawSetCookie) {
    if (!rawSetCookie) return;
    const cookieHeaders = Array.isArray(rawSetCookie) ? rawSetCookie : [rawSetCookie];
    for (const line of cookieHeaders) {
      // Split on newline or comma if bundled
      const parts = line.split(/,(?=[^;]+=[^;]+)/g);
      for (const item of parts) {
        const first = item.split(';')[0].trim();
        const eqIdx = first.indexOf('=');
        if (eqIdx !== -1) {
          const name = first.slice(0, eqIdx).trim();
          const val = first.slice(eqIdx + 1).trim();
          if (name) {
            this.sessionCookies[name] = val;
            if (name === 'X-OWA-CANARY' && val) {
              this.canary = val;
            }
          }
        }
      }
    }
    this.saveSession();
  }

  getCookieHeader() {
    const pairs = [];
    for (const [k, v] of Object.entries(this.sessionCookies)) {
      pairs.push(`${k}=${v}`);
    }
    return pairs.join('; ');
  }

  /**
   * Low-level universal HTTP requester
   */
  async rawRequest({ url, method = 'GET', headers = {}, body = null, followRedirects = true }) {
    const fullUrl = url.startsWith('http') ? url : `${getBaseUrl()}${url}`;

    // 1. Userscript GM_xmlhttpRequest mode (bypass SOP & CORS)
    if (isUserscript) {
      return new Promise((resolve, reject) => {
        const gmReq = typeof GM_xmlhttpRequest !== 'undefined'
          ? GM_xmlhttpRequest
          : GM.xmlHttpRequest;

        const reqHeaders = { ...headers };
        const cookieHeader = this.getCookieHeader();
        if (cookieHeader) {
          reqHeaders['Cookie'] = cookieHeader;
        }

        gmReq({
          method,
          url: fullUrl,
          headers: reqHeaders,
          data: body,
          anonymous: false,
          redirect: followRedirects ? 'follow' : 'manual',
          timeout: 25000,
          onload: (res) => {
            const respHeaders = res.responseHeaders || '';
            const setCookieMatch = respHeaders.match(/set-cookie:\s*(.+)/gi);
            if (setCookieMatch) {
              for (const m of setCookieMatch) {
                this.parseAndStoreCookies(m.replace(/^set-cookie:\s*/i, ''));
              }
            }
            resolve({
              status: res.status,
              statusText: res.statusText,
              ok: res.status >= 200 && res.status < 300,
              headers: {
                get: (h) => {
                  const regex = new RegExp(`^${h}:\\s*(.+)`, 'gmi');
                  const match = regex.exec(respHeaders);
                  return match ? match[1].trim() : null;
                }
              },
              text: async () => res.responseText,
              json: async () => JSON.parse(res.responseText)
            });
          },
          onerror: (err) => reject(new Error(err.statusText || 'Network request failed in Userscript GM_xhr')),
          ontimeout: () => reject(new Error('Request to mail.msal.ru timed out'))
        });
      });
    }

    // 2. Standard Fetch mode (Electron, Capacitor, Vite Proxy)
    const fetchHeaders = new Headers(headers);
    const cookieHeader = this.getCookieHeader();
    if (cookieHeader && !fetchHeaders.has('Cookie')) {
      fetchHeaders.set('Cookie', cookieHeader);
    }

    const res = await fetch(fullUrl, {
      method,
      headers: fetchHeaders,
      body,
      credentials: 'include',
      redirect: followRedirects ? 'follow' : 'manual'
    });

    if (res.headers.getSetCookie) {
      this.parseAndStoreCookies(res.headers.getSetCookie());
    } else if (res.headers.get('set-cookie')) {
      this.parseAndStoreCookies(res.headers.get('set-cookie'));
    }

    return res;
  }

  /**
   * Perform OWA Form Login (POST /owa/auth.owa)
   */
  async login(username, password) {
    if (!username || !password) {
      throw new Error('Логин и пароль обязательны для входа в почту');
    }

    const cleanUsername = username.trim();
    const loginParams = new URLSearchParams({
      destination: `${getBaseUrl()}/owa/`,
      flags: '4',
      forcedownlevel: '0',
      username: cleanUsername,
      password: password,
      isUtf8: '1'
    }).toString();

    const res = await this.rawRequest({
      url: '/owa/auth.owa',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
      },
      body: loginParams,
      followRedirects: false
    });

    const location = res.headers.get('location') || '';
    if (location.includes('reason=2')) {
      throw new Error('Неверный логин или пароль от почты (Exchange reason=2)');
    } else if (location.includes('reason=')) {
      throw new Error(`Ошибка авторизации на сервере почты: ${location}`);
    }

    // Retrieve home page to extract CSRF Canary token
    const owaHomeRes = await this.rawRequest({
      url: '/owa/',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      },
      followRedirects: true
    });

    const html = await owaHomeRes.text();
    if (!this.canary) {
      const canaryMatch =
        html.match(/["']?canary["']?\s*[:=]\s*["']([^"']+)["']/i) ||
        html.match(/a_sCanary\s*=\s*["']([^"']+)["']/i) ||
        html.match(/name=["']canary["']\s+value=["']([^"']+)["']/i);

      if (canaryMatch) {
        this.canary = canaryMatch[1];
      }
    }

    this.saveSession();

    // Store credentials securely in local AES-GCM vault for silent session refresh
    await cryptoStorage.setItem(OWA_CREDS_STORAGE_KEY, {
      username: cleanUsername,
      password: password,
      savedAt: Date.now()
    });

    return {
      success: true,
      username: cleanUsername,
      canary: this.canary
    };
  }

  /**
   * Get stored credentials from secure cryptoStorage
   */
  async getStoredCredentials() {
    try {
      return await cryptoStorage.getItem(OWA_CREDS_STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  /**
   * Silent background re-authentication
   */
  async reauthenticate() {
    if (this.isReauthenticating && this.reauthPromise) {
      return this.reauthPromise;
    }

    this.isReauthenticating = true;
    this.reauthPromise = (async () => {
      try {
        const creds = await this.getStoredCredentials();
        if (!creds?.username || !creds?.password) {
          throw new Error('Требуется авторизация в почте');
        }
        await this.login(creds.username, creds.password);
        return true;
      } finally {
        this.isReauthenticating = false;
        this.reauthPromise = null;
      }
    })();

    return this.reauthPromise;
  }

  /**
   * Execute JSON-RPC request to /owa/service.svc?action=<Action>
   */
  async serviceCall(action, payload, retryOn440 = true) {
    if (!this.canary) {
      // Check if we can recover session
      await this.reauthenticate();
    }

    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Action': action,
      'X-Requested-With': 'XMLHttpRequest'
    };

    if (this.canary) {
      headers['X-OWA-CANARY'] = this.canary;
    }

    const res = await this.rawRequest({
      url: `/owa/service.svc?action=${action}`,
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    // 440: Exchange Login Timeout / Session Expired
    // 401: Unauthorized
    if ((res.status === 440 || res.status === 401) && retryOn440) {
      console.warn(`[MailClient] OWA session expired (${res.status}). Performing silent auto-login...`);
      await this.reauthenticate();
      return this.serviceCall(action, payload, false);
    }

    if (!res.ok) {
      const errText = await res.text();
      let parsedErr = null;
      try {
        parsedErr = JSON.parse(errText);
      } catch (_) {}

      const msg = parsedErr?.Body?.Message || parsedErr?.Body?.ResponseCode || `Exchange service error ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.raw = errText;
      throw err;
    }

    return await res.json();
  }

  /**
   * Log out and wipe secure mail credentials
   */
  async logout() {
    this.clearSession();
    try {
      await cryptoStorage.removeItem(OWA_CREDS_STORAGE_KEY);
    } catch (_) {}
  }
}

export const mailClient = new MailClient();
