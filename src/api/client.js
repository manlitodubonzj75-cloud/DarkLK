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

// Platform metadata headers: clean browser-standard headers without bot/fingerprint signatures
function getPlatformDeviceHeaders() {
  return {
    'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
  };
}

// Lightweight Circuit Breaker to prevent UI hangs during university server outages
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
const FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30000;

export function isCircuitOpen() {
  return Date.now() < circuitOpenUntil;
}

export function resetCircuit() {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

function isAuthEndpoint(endpoint) {
  const ep = String(endpoint || "").toLowerCase();
  return ep.includes("/auth") || ep.includes("/token") || ep.includes("/login") || ep.includes("/refresh");
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

  // Circuit Breaker fast-path: if backend is down with 3+ consecutive timeouts/5xx,
  // fail immediately (0ms) so cacheService serves cached offline data without hanging UI.
  // CRITICAL: Auth, token and login endpoints MUST NEVER be blocked by the circuit breaker!
  if (isCircuitOpen() && !options.forceRefresh && !isAuthEndpoint(endpoint)) {
    const circuitError = new Error('CIRCUIT_OPEN: Сервер МГЮА временно недоступен');
    circuitError.status = 503;
    circuitError.name = 'CircuitBreakerError';
    throw circuitError;
  }

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
      if (!isAuthEndpoint(endpoint)) {
        const refreshed = await tryRefreshToken();
        if (refreshed) {
          const newToken = cryptoStorage.getToken();
          headers['Authorization'] = `Bearer ${newToken}`;
          const retryResponse = await fetchWithTimeout(url, { ...config, headers }, timeoutMs);
          if (retryResponse.ok) {
            consecutiveFailures = 0;
            circuitOpenUntil = 0;
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
      consecutiveFailures = 0;
      circuitOpenUntil = 0;
      return null;
    }

    // Read response text to handle HTML 200 OK login forms / expired sessions (IIS / 1C behavior)
    const contentType = (response.headers?.get ? response.headers.get('content-type') : response.headers?.['content-type']) || '';
    const rawText = await response.text();

    // Check for HTML response (expired session / IIS login redirect masquerading as 200 OK)
    const isHtmlResponse = contentType.includes('text/html') ||
      rawText.trim().startsWith('<!DOCTYPE') ||
      rawText.trim().startsWith('<html') ||
      (rawText.includes('<form action=') && rawText.includes('password')) ||
      rawText.includes('<title>Авторизация</title>');

    if (isHtmlResponse && response.ok) {
      if (!isAuthEndpoint(endpoint)) {
        console.warn(`[Client] Received HTML 200 OK instead of JSON on ${endpoint}. Attempting silent token refresh...`);
        const refreshed = await tryRefreshToken();
        if (refreshed) {
          const newToken = cryptoStorage.getToken();
          headers['Authorization'] = `Bearer ${newToken}`;
          const retryResponse = await fetchWithTimeout(url, { ...config, headers }, timeoutMs);
          if (retryResponse.ok) {
            const retryText = await retryResponse.text();
            if (!retryText.trim().startsWith('<!DOCTYPE') && !retryText.trim().startsWith('<html')) {
              consecutiveFailures = 0;
              circuitOpenUntil = 0;
              try {
                return JSON.parse(retryText);
              } catch (_) {}
            }
          }
        }
      }
      const authError = new Error('SESSION_EXPIRED_HTML: Сессия истекла (получена страница авторизации вместо JSON)');
      authError.status = 401;
      throw authError;
    }

    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errorData = JSON.parse(rawText);
        errorDetail = errorData.message || errorData.detail || errorData.error || errorDetail;
      } catch (_) {
        if (rawText) errorDetail = rawText.slice(0, 300);
      }

      if (!isAuthEndpoint(endpoint) && response.status >= 500) {
        consecutiveFailures++;
        if (consecutiveFailures >= FAILURE_THRESHOLD) {
          circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
          console.warn(`[Circuit Breaker] Trip activated: backend down (${response.status}), skipping network for ${CIRCUIT_COOLDOWN_MS / 1000}s`);
        }
      }

      const err = new Error(errorDetail);
      err.status = response.status;
      throw err;
    }

    // Success - reset breaker
    consecutiveFailures = 0;
    circuitOpenUntil = 0;

    try {
      return JSON.parse(rawText);
    } catch (parseErr) {
      console.warn(`[Client] Failed to parse JSON on ${endpoint}:`, parseErr.message);
      throw parseErr;
    }
  } catch (err) {
    if (!isAuthEndpoint(endpoint) && (err.name === 'TimeoutError' || err.status === 408 || err.message?.includes('Network') || err.status === 0)) {
      consecutiveFailures++;
      if (consecutiveFailures >= FAILURE_THRESHOLD) {
        circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
        console.warn(`[Circuit Breaker] Trip activated: repeated network failures, skipping network for ${CIRCUIT_COOLDOWN_MS / 1000}s`);
      }
      console.warn(`[Client] Network timeout/error on ${endpoint}`);
    }
    throw err;
  }
}
