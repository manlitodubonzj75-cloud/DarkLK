/**
 * MSAL+ API HTTP Client
 * Configured with proxy support, automatic token injection, error handling,
 * in-flight token refresh mutex, and integration with AES-GCM encrypted cryptoStorage.
 */

import { cryptoStorage } from './cryptoStorage.js';

// In Electron desktop or Capacitor Android environment, use direct official API URL (zero proxy, 100% 152-FZ compliant)
// In web dev browser environment, use Vite proxy '/api'
const isNativeEnv = (typeof window !== 'undefined') && (
  Boolean(window.electronAPI?.apiBaseUrl) ||
  Boolean(window.Capacitor?.isNativePlatform?.()) ||
  window.Capacitor?.getPlatform?.() === 'android'
);

const BASE_URL = isNativeEnv
  ? 'https://lk.msal.ru:3443'
  : (import.meta.env?.VITE_API_BASE_URL || '/api');

/**
 * Standard browser-safe request headers
 * Note: Browser fetch rejects manual setting of User-Agent, Origin, and Referer.
 */
function getStandardHeaders(token = null) {
  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'X-Device-Model': 'ClientType: browser, DeviceType: web'
  };

  const activeToken = token || cryptoStorage.getToken() || localStorage.getItem('access_token');
  if (activeToken) {
    headers['Authorization'] = `Bearer ${activeToken}`;
  }

  return headers;
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
          const response = await fetch(`${BASE_URL}/auth/refresh`, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ refresh_token: refreshToken })
          });

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
          const response = await fetch(`${BASE_URL}/auth`, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username: savedLogin, password: savedPassword })
          });

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
            // Credentials affirmatively rejected by the server! (Password changed or student expelled)
            console.warn('[Auth Client] Saved credentials rejected by university server (401/403).');
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('auth-session-expired', { detail: 'CREDENTIALS_INVALID' }));
            }
            return false;
          }
        } catch (err) {
          // Network failure while attempting re-login must NOT boot the student to the login page
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
 * Core HTTP request handler
 */
export async function apiClient(endpoint, options = {}) {
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${BASE_URL}${cleanEndpoint}`;
  const headers = {
    ...getStandardHeaders(options.token),
    ...(options.headers || {})
  };

  const config = {
    ...options,
    headers
  };

  try {
    const response = await fetch(url, config);

    // 401 Unauthorized - token expired or invalid
    if (response.status === 401) {
      // Try refresh token if available and not already attempting auth endpoint
      if (!endpoint.includes('/auth')) {
        const refreshed = await tryRefreshToken();
        if (refreshed) {
          // Retry original request once with new encrypted token
          const newToken = cryptoStorage.getToken() || localStorage.getItem('access_token');
          headers['Authorization'] = `Bearer ${newToken}`;
          const retryResponse = await fetch(url, { ...config, headers });
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

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await response.json();
    }
    return await response.text();
  } catch (error) {
    console.error(`API Error on [${config.method || 'GET'} ${cleanEndpoint}]:`, error.message);
    throw error;
  }
}
