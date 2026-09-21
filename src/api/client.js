/**
 * MSAL+ API HTTP Client
 * Configured with timeout protection (AbortController), browser fingerprint alignment,
 * dynamic platform-aware X-Device-Model generation, in-flight token refresh mutex,
 * and integration with AES-GCM encrypted cryptoStorage.
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
 * Detect client platform, OS and browser version to construct
 * a legitimate X-Device-Model matching the university backend expectations.
 */
function getDeviceInfo() {
  let os = 'GNU/Linux';
  let clientName = 'Firefox';
  let clientVersion = '135.0';
  let deviceType = 'desktop';

  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    const platform = navigator.platform || '';

    // Device OS
    if (/android/i.test(ua)) {
      os = 'Android';
      deviceType = 'mobile';
    } else if (/iphone|ipad|ipod/i.test(ua)) {
      os = 'iOS';
      deviceType = 'mobile';
    } else if (/win/i.test(platform) || /windows/i.test(ua)) {
      os = 'Windows';
    } else if (/mac/i.test(platform) || /macintosh/i.test(ua)) {
      os = 'macOS';
    } else if (/linux/i.test(platform) || /linux/i.test(ua)) {
      os = 'GNU/Linux';
    }

    // Client Name & Version
    const ffMatch = ua.match(/Firefox\/(\d+[\.\d]*)/);
    const chromeMatch = ua.match(/(?:Chrome|Chromium)\/(\d+[\.\d]*)/);
    const safariMatch = ua.match(/Version\/(\d+[\.\d]*).*Safari/);

    if (ffMatch) {
      clientName = 'Firefox';
      clientVersion = ffMatch[1];
    } else if (chromeMatch) {
      clientName = 'Chrome';
      clientVersion = chromeMatch[1];
    } else if (safariMatch) {
      clientName = 'Safari';
      clientVersion = safariMatch[1];
    }
  }

  return { os, clientName, clientVersion, deviceType };
}

/**
 * Standard browser headers matching the exact format expected by lk.msal.ru:3443
 */
function getStandardHeaders(token = null) {
  const { os, clientName, clientVersion, deviceType } = getDeviceInfo();
  const deviceModel = `ClientType: browser, ClientName: ${clientName}, ClientVersion: ${clientVersion}, DeviceOS: ${os}, DeviceType: ${deviceType}`;

  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'X-Device-Model': deviceModel
  };

  const activeToken = token || cryptoStorage.getToken() || localStorage.getItem('access_token');
  if (activeToken) {
    headers['Authorization'] = `Bearer ${activeToken}`;
  }

  return headers;
}

/**
 * Wrapper around fetch with timeout via AbortController to prevent infinite hanging
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 6500) {
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
          }, 5000);

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
          }, 5000);

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
  const timeoutMs = options.timeout || 6500;

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
          const newToken = cryptoStorage.getToken() || localStorage.getItem('access_token');
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
