/**
 * MSAL Client API Module
 * Direct cross-platform client for official MSAL (МГЮА) LK API
 * Operates without intermediate backend proxy (152-FZ zero data retention)
 */

import { cryptoStorage } from './cryptoStorage';

const isUserscriptOrMsalDomain = typeof window !== 'undefined' && (
  window.location.hostname.includes('msal.ru') ||
  window.location.hostname === 'localhost' ||
  window.location.protocol === 'file:' ||
  window.location.protocol === 'capacitor:' ||
  window.location.protocol === 'ionic:'
);

const isNativeEnv = (typeof window !== 'undefined') && (
  Boolean(window.electronAPI?.apiBaseUrl) ||
  Boolean(window.Capacitor?.isNativePlatform?.()) ||
  window.Capacitor?.getPlatform?.() === 'android' || window.Capacitor?.getPlatform?.() === 'ios' ||
  isUserscriptOrMsalDomain
);

const BASE_URL = isNativeEnv
  ? 'https://lk.msal.ru:3443'
  : (import.meta.env?.VITE_API_BASE_URL || '/api');

// Platform metadata headers
function getPlatformDeviceHeaders() {
  if (typeof window === 'undefined') return {};

  const isAndroid = /Android/i.test(navigator.userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const isCapacitor = Boolean(window.Capacitor?.isNativePlatform?.());

  let clientName = 'Chrome';
  if (/Firefox/i.test(navigator.userAgent)) clientName = 'Firefox';
  else if (/Safari/i.test(navigator.userAgent) && !/Chrome/i.test(navigator.userAgent)) clientName = 'Safari';

  let os = 'Desktop';
  let deviceType = 'desktop';

  if (isAndroid || window.Capacitor?.getPlatform?.() === 'android') {
    os = 'Android';
    deviceType = 'mobile';
  } else if (isIOS || window.Capacitor?.getPlatform?.() === 'ios') {
    os = 'iOS';
    deviceType = 'mobile';
  } else if (navigator.platform?.includes('Mac')) {
    os = 'macOS';
  } else if (navigator.platform?.includes('Win')) {
    os = 'Windows';
  } else if (navigator.platform?.includes('Linux')) {
    os = 'Linux';
  }

  const deviceHeader = `ClientType: ${isCapacitor ? 'app' : 'browser'}, ClientName: ${clientName}, ClientVersion: 135.0, DeviceOS: ${os}, DeviceType: ${deviceType}`;

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

  const token = explicitToken || cryptoStorage.getToken() || localStorage.getItem('access_token') || localStorage.getItem('token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Wrapper around fetch with timeout via AbortController to prevent infinite hanging
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
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

/**
 * Preemptive or reactive token refresh with single-flight mutex.
 * Handles both refresh_token grant and silent background re-login from encrypted vault.
 */
export async function tryRefreshToken() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      // 1. Try /auth/refresh if refresh_token is available
      const refreshToken = cryptoStorage.getRefreshToken() || localStorage.getItem('refresh_token');
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
      const { login: savedLogin, password: savedPassword } = cryptoStorage.getSavedCredentials();
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
            console.warn('[Auth Client] Saved credentials rejected by university server (401/403).');
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('auth-session-expired', { detail: 'CREDENTIALS_INVALID' }));
            }
            return false;
          }
        } catch (err) {
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
          const newToken = cryptoStorage.getToken() || localStorage.getItem('access_token') || localStorage.getItem('token');
          headers['Authorization'] = `Bearer ${newToken}`;
          const retryResponse = await fetchWithTimeout(url, { ...config, headers }, timeoutMs);
          if (retryResponse.ok) {
            if (retryResponse.status === 204) return null;
            return await retryResponse.json();
          }
        }
      }
      throw new Error('UNAUTHORIZED');
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
