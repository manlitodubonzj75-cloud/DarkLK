/**
 * MSAL+ API HTTP Client
 * Configured with proxy support, automatic token injection, error handling,
 * and integration with AES-GCM encrypted cryptoStorage.
 */

import { cryptoStorage } from './cryptoStorage';

// In Electron desktop or Capacitor Android environment, use direct official API URL (zero proxy, 100% 152-FZ compliant)
// In web dev browser environment, use Vite proxy '/api'
const isNativeEnv = (typeof window !== 'undefined') && (
  Boolean(window.electronAPI?.apiBaseUrl) ||
  Boolean(window.Capacitor?.isNativePlatform?.()) ||
  window.Capacitor?.getPlatform?.() === 'android'
);

const BASE_URL = isNativeEnv
  ? 'https://lk.msal.ru:3443'
  : (import.meta.env.VITE_API_BASE_URL || '/api');

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

/**
 * Preemptive or reactive token refresh
 */
async function tryRefreshToken() {
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
          return true;
        }
      }
    } catch (e) {
      console.warn('Token refresh failed:', e);
    }
  }

  // Fallback: silent re-login with saved credentials (parity with Flutter auth_service.dart)
  try {
    const savedLogin = localStorage.getItem('saved_login');
    const savedPassword = await cryptoStorage.getItem('saved_password');
    if (savedLogin && savedPassword) {
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
          return true;
        }
      }
    }
  } catch (err) {
    console.warn('Silent re-login attempt failed:', err);
  }

  return false;
}
