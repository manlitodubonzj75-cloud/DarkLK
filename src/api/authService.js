import { apiClient } from './client';
import { cryptoStorage } from './cryptoStorage';

export const authService = {
  /**
   * User login: POST /auth
   */
  async login(username, password) {
    const data = await apiClient('/auth', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    if (data && data.access_token) {
      cryptoStorage.setTokens(data.access_token, data.refresh_token || null);
      localStorage.setItem('saved_login', username);
      cryptoStorage.setItem('saved_password', password);

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
   * Completely shreds cryptographic keys and purges local storage
   */
  async logout() {
    try {
      await apiClient('/auth/logout', { method: 'POST' });
    } catch (e) {
      console.warn('Logout request warning:', e.message);
    } finally {
      localStorage.removeItem('saved_login');
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
   * Restore user session on startup
   */
  async restoreSession() {
    await cryptoStorage.init();

    const token = cryptoStorage.getToken() || localStorage.getItem('access_token');
    const refreshToken = cryptoStorage.getRefreshToken() || localStorage.getItem('refresh_token');

    if (!token && !refreshToken) {
      return null;
    }

    if (token) {
      try {
        const user = await this.checkSession(token);
        if (user) {
          this.cacheUser(user);
          return { user, token };
        }
      } catch (e) {
        console.warn('Existing access_token invalid, attempting refresh...');
      }
    }

    if (refreshToken) {
      try {
        const refreshed = await this.refreshToken(refreshToken);
        if (refreshed && refreshed.access_token) {
          const user = await this.checkSession(refreshed.access_token);
          if (user) {
            this.cacheUser(user);
            return { user, token: refreshed.access_token };
          }
        }
      } catch (e) {
        console.warn('Token refresh on session restore failed:', e);
      }
    }

    const offlineUser = this.getCachedUser();
    if (offlineUser && token) {
      return { user: offlineUser, token };
    }

    return null;
  }
};
