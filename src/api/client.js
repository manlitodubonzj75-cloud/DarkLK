/**
 * MSAL Client API Module
 * Direct cross-platform client for official MSAL (МГЮА) LK API
 * Operates without intermediate backend proxy (152-FZ zero data retention)
 * 
 * Supports:
 * - Android & iOS (via CapacitorHttp native OkHttp/NSURLSession, bypassing WebView CORS)
 * - Electron Desktop (direct HTTPS or local proxy)
 * - Userscript (in-browser direct HTTPS to lk.msal.ru)
 * - Local Vite Development (via '/api' proxy)
 */

import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { cryptoStorage } from './cryptoStorage';

const isCapacitorNative = typeof window !== 'undefined' && Capacitor.isNativePlatform();

const isUserscriptOrMsalDomain = typeof window !== 'undefined' && (
  window.location.hostname === 'msal.ru' || window.location.hostname.endsWith('.msal.ru') ||
  window.location.protocol === 'file:' ||
  window.location.protocol === 'capacitor:' ||
  window.location.protocol === 'ionic:'
);

const isNativeEnv = isCapacitorNative || (typeof window !== 'undefined' && (
  Boolean(window.electronAPI?.apiBaseUrl) ||
  isUserscriptOrMsalDomain
));

const BASE_URL = isNativeEnv
  ? 'https://lk.msal.ru:3443'
  : (import.meta.env?.VITE_API_BASE_URL || '/api');

// Platform metadata headers
function getPlatformDeviceHeaders() {
  if (typeof window === 'undefined') return {};

  const isAndroid = isCapacitorNative ? (Capacitor.getPlatform() === 'android') : /Android/i.test(navigator.userAgent);
  const isIOS = isCapacitorNative ? (Capacitor.getPlatform() === 'ios') : /iPhone|iPad|iPod/i.test(navigator.userAgent);

  let clientName = 'Chrome';
  if (/Firefox/i.test(navigator.userAgent)) clientName = 'Firefox';
  else if (/Safari/i.test(navigator.userAgent) && !/Chrome/i.test(navigator.userAgent)) clientName = 'Safari';

  let os = 'Desktop';
  let deviceType = 'desktop';

  if (isAndroid) {
    os = 'Android';
    deviceType = 'mobile';
  } else if (isIOS) {
    os = 'iOS';
    deviceType = 'mobile';
  } else if (navigator.platform?.includes('Mac')) {
    os = 'macOS';
  } else if (navigator.platform?.includes('Win')) {
    os = 'Windows';
  } else if (navigator.platform?.includes('Linux')) {
    os = 'Linux';
  }

  const deviceHeader = `ClientType: ${isCapacitorNative ? 'app' : 'browser'}, ClientName: ${clientName}, ClientVersion: 135.0, DeviceOS: ${os}, DeviceType: ${deviceType}`;

  return {
    'X-Device-Model': deviceHeader,
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
  };
}

function getStandardHeaders(explicitToken = null) {
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...getPlatformDeviceHeaders()
  };

  const token = explicitToken || cryptoStorage.getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Native Capacitor HTTP requester using OkHttp on Android & NSURLSession on iOS.
 * Completely eliminates browser WebView CORS restrictions.
 */
async function nativeCapacitorFetch(url, options = {}, timeoutMs = 15000) {
  const method = (options.method || 'GET').toUpperCase();
  const headers = options.headers || {};
  let data = undefined;

  if (options.body) {
    if (typeof options.body === 'string') {
      try {
        data = JSON.parse(options.body);
      } catch (_) {
        data = options.body;
      }
    } else {
      data = options.body;
    }
  }

  try {
    const res = await CapacitorHttp.request({
      url,
      method,
      headers,
      data,
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs
    });

    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      headers: {
        get: (h) => {
          if (!res.headers) return null;
          const target = h.toLowerCase();
          for (const [k, v] of Object.entries(res.headers)) {
            if (k.toLowerCase() === target) return v;
          }
          return null;
        }
      },
      json: async () => {
        if (typeof res.data === 'string') {
          try {
            return JSON.parse(res.data);
          } catch (_) {
            return res.data;
          }
        }
        return res.data;
      },
      text: async () => {
        if (typeof res.data === 'object' && res.data !== null) {
          return JSON.stringify(res.data);
        }
        return String(res.data || '');
      }
    };
  } catch (err) {
    const error = new Error(err.message || 'Capacitor network error');
    error.status = 0;
    throw error;
  }
}

/**
 * Electron: запрос идёт через main-процесс (он пускает только на lk.msal.ru:3443),
 * поэтому в окне можно держать webSecurity включённым.
 */
async function electronFetch(url, options = {}, timeoutMs = 15000) {
  const res = await window.electronAPI.apiRequest({
    url,
    method: (options.method || 'GET').toUpperCase(),
    headers: options.headers || {},
    body: typeof options.body === 'string' ? options.body : (options.body ? JSON.stringify(options.body) : null),
    redirect: 'follow',
    timeout: timeoutMs
  });

  if (!res || !res.success) {
    const msg = res?.error || 'Electron network error';
    const error = new Error(/timeout|aborted/i.test(msg) ? `Request timed out after ${timeoutMs}ms: ${url}` : msg);
    if (/timeout|aborted/i.test(msg)) {
      error.name = 'TimeoutError';
      error.status = 408;
    } else {
      error.status = 0;
    }
    throw error;
  }

  const text = res.text || '';
  return {
    status: res.status,
    ok: res.ok,
    headers: {
      get: (h) => res.headers?.[String(h).toLowerCase()] ?? null
    },
    json: async () => JSON.parse(text),
    text: async () => text
  };
}

/**
 * Universal wrapper around fetch with timeout via AbortController or native mobile client
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  if (isCapacitorNative) {
    return nativeCapacitorFetch(url, options, timeoutMs);
  }
  if (typeof window !== 'undefined' && typeof window.electronAPI?.apiRequest === 'function') {
    return electronFetch(url, options, timeoutMs);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const signal = options.signal
    ? (typeof AbortSignal.any === 'function'
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal)
    : controller.signal;

  try {
    const response = await fetch(url, { ...options, signal });
    return response;
  } catch (err) {
    if (err.name === 'AbortError' || controller.signal.aborted) {
      const timeoutError = new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
      timeoutError.name = 'TimeoutError';
      timeoutError.status = 408;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

let refreshPromise = null;
// Почему последний тихий перелогин не удался: 'CREDENTIALS_INVALID' | 'NETWORK' | null
let lastRefreshFailure = null;
export function getLastRefreshFailure() {
  return lastRefreshFailure;
}

/**
 * Preemptive or reactive token refresh with single-flight mutex.
 * Handles both refresh_token grant and silent background re-login from encrypted vault.
 */
export async function tryRefreshToken() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    lastRefreshFailure = null;
    try {
      // 1. Try /auth/refresh if refresh_token is available
      const refreshToken = cryptoStorage.getRefreshToken();
      if (refreshToken) {
        try {
          const response = await fetchWithTimeout(`${BASE_URL}/auth/refresh`, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ refresh_token: refreshToken })
          }, 8000);

          if (response.ok) {
            const data = await response.json();
            if (data && data.access_token) {
              cryptoStorage.setTokens(data.access_token, data.refresh_token || refreshToken);
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('session-token-refreshed', { detail: data.access_token }));
              }
              return true;
            }
          }
        } catch (e) {
          console.warn('[Auth Client] Token refresh endpoint failed:', e.message);
        }
      }

      // 2. Silent re-login with saved credentials from AES-GCM encrypted cryptoStorage
      const { login: savedLogin, password: savedPassword } = await cryptoStorage.getSavedCredentialsAsync();
      if (savedLogin && savedPassword) {
        try {
          const response = await fetchWithTimeout(`${BASE_URL}/auth`, {
            method: 'POST',
            headers: getStandardHeaders(),
            body: JSON.stringify({ username: savedLogin, password: savedPassword })
          }, 10000);

          if (response.ok) {
            const data = await response.json();
            if (data && data.access_token) {
              cryptoStorage.setTokens(data.access_token, data.refresh_token || null);
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('session-token-refreshed', { detail: data.access_token }));
              }
              return true;
            }
          } else if (response.status === 401 || response.status === 403) {
            // Credentials rejected by the server
            lastRefreshFailure = 'CREDENTIALS_INVALID';
            console.warn('[Auth Client] Saved credentials rejected by university server (401/403).');
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('auth-session-expired', { detail: 'CREDENTIALS_INVALID' }));
            }
            return false;
          }
        } catch (err) {
          lastRefreshFailure = 'NETWORK';
          console.warn('[Auth Client] Silent re-login network failure:', err.message);
          return false;
        }
      }

      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Core HTTP request handler with timeout protection
 */
export async function apiClient(endpoint, options = {}) {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${BASE_URL}${cleanEndpoint}`;
  const timeoutMs = options.timeout || 15000;

  const headers = {
    ...getStandardHeaders(options.token),
    ...(options.headers || {})
  };

  const config = {
    ...options,
    headers
  };

  try {
    const response = await fetchWithTimeout(url, config, timeoutMs);

    // 401 Unauthorized - token expired or invalid
    if (response.status === 401) {
      if (!endpoint.includes('/auth')) {
        const refreshed = await tryRefreshToken();
        if (refreshed) {
          const newToken = cryptoStorage.getToken();
          headers['Authorization'] = `Bearer ${newToken}`;
          const retryResponse = await fetchWithTimeout(url, { ...config, headers }, timeoutMs);
          if (retryResponse.ok) {
            if (retryResponse.status === 204) return null;
            return await retryResponse.json();
          }
        }
      }
      const unauthorized = new Error('UNAUTHORIZED');
      unauthorized.status = 401;
      throw unauthorized;
    }

    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errorData = await response.json();
        errorDetail = errorData.message || errorData.detail || errorData.error || errorDetail;
      } catch (_) {
        const text = await response.text();
        if (text) errorDetail = text;
      }
      const err = new Error(errorDetail);
      err.status = response.status;
      throw err;
    }

    return await response.json();
  } catch (err) {
    if (err.name === 'TimeoutError' || err.status === 408) {
      console.warn(`[Client] Network timeout on ${endpoint}`);
    }
    throw err;
  }
}
