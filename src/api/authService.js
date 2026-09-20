import { apiClient, tryRefreshToken } from './client.js';
import { cryptoStorage } from './cryptoStorage.js';

export const authService = {
  /**
   * User login: POST /auth
   * Stores access tokens and securely saves encrypted credentials in AES-GCM vault
   */
  async login(username, password) {
    const data = await apiClient('/auth', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    if (data && data.access_token) {
      cryptoStorage.setTokens(data.access_token, data.refresh_token || null);
      cryptoStorage.setSavedCredentials(username, password);

      // Cache user from POST /auth response right away (contains full profile for College & Bachelor)
      this.cacheUser(data);

      // Verify and fetch complete user profile
      try {
        const userProfile = await this.checkSession(data.access_token);
        if (userProfile) {
          const merged = { ...data, ...userProfile };
          this.cacheUser(merged);
          return { ...data, user: merged };
        }
      } catch (e) {
        console.warn('Fetched token but checkSession failed, using token response data:', e);
      }

      return { ...data, user: data };
    }

    return data;
  },

  /**
   * Check session / get user profile: GET /auth
   */
  async checkSession(token = null) {
    return apiClient('/auth', { method: 'GET', token });
  },

  /**
   * Refresh token: POST /auth/refresh
   */
  async refreshToken(refreshToken) {
    const data = await apiClient('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken })
    });

    if (data && data.access_token) {
      cryptoStorage.setTokens(data.access_token, data.refresh_token || refreshToken);
    }

    return data;
  },

  /**
   * User logout: POST /auth/logout
   * Completely shreds cryptographic keys, purges local storage and IndexedDB
   */
  async logout() {
    try {
      await apiClient('/auth/logout', { method: 'POST' });
    } catch (e) {
      console.warn('Logout request warning:', e.message);
    } finally {
      await cryptoStorage.purgeAll();
    }
  },

  /**
   * Get cached user profile
   */
  getCachedUser() {
    return cryptoStorage.getUser();
  },

  /**
   * Cache user profile
   */
  cacheUser(userData) {
    cryptoStorage.setUser(userData);
  },

  /**
   * Restore user session on startup.
   * Resilient to network outages, university server restarts, and token expiry.
   * NEVER logs the student out unless university server explicitly rejects credentials with 401.
   */
  async restoreSession() {
    await cryptoStorage.init();

    const token = cryptoStorage.getToken() || localStorage.getItem('access_token');
    const { login: savedLogin, password: savedPassword } = cryptoStorage.getSavedCredentials();
    const offlineUser = this.getCachedUser();

    // If there is no token and no saved credentials, user is not authenticated
    if (!token && !savedLogin) {
      return null;
    }

    // 1. If we have a token, attempt to validate with current session
    if (token) {
      try {
        const user = await this.checkSession(token);
        if (user) {
          const merged = { ...(offlineUser || {}), ...user };
          this.cacheUser(merged);
          return { user: merged, token };
        }
      } catch (err) {
        // If error is NOT 401 (e.g. server is down, 502/504, timeout, or user is offline):
        // Keep the user in the app with cached profile!
        if (err.status !== 401 && err.message !== 'UNAUTHORIZED') {
          console.warn('[AuthService] Server unreachable during session restore, using cached offline session:', err.message);
          if (offlineUser) {
            return { user: offlineUser, token, isOffline: true };
          }
        }
        console.warn('[AuthService] Token expired (401), attempting background re-authentication...');
      }
    }

    // 2. Token expired or missing: attempt silent background re-login from encrypted vault
    if (savedLogin && savedPassword) {
      try {
        const refreshed = await tryRefreshToken();
        if (refreshed) {
          const newToken = cryptoStorage.getToken();
          const user = await this.checkSession(newToken).catch(() => offlineUser);
          const finalUser = user || offlineUser || { username: savedLogin, name: savedLogin };
          this.cacheUser(finalUser);
          return { user: finalUser, token: newToken };
        }
      } catch (err) {
        // Network failure during re-login must NOT log out an existing user
        if (err.status !== 401 && err.status !== 403 && offlineUser) {
          console.warn('[AuthService] Network error during re-login, falling back to offline session');
          return { user: offlineUser, token: token || 'offline', isOffline: true };
        }
      }
    }

    // 3. Fallback: keep user logged in with offline profile if available
    if (offlineUser) {
      return { user: offlineUser, token: token || 'offline', isOffline: true };
    }

    return null;
  }
};
