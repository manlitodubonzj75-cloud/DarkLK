import { apiClient, tryRefreshToken, getLastRefreshFailure } from "./client.js";
import { cryptoStorage } from "./cryptoStorage.js";

export const authService = {
  /**
   * User login: POST /auth
   * Stores access tokens and securely saves encrypted credentials in AES-GCM vault.
   * Automatically pre-warms Exchange mail session with zero friction.
   */
  async login(username, password) {
    const data = await apiClient("/auth", {
      method: "POST",
      body: JSON.stringify({ username, password }),
      timeout: 8000
    });

    if (data && data.access_token) {
      cryptoStorage.setTokens(data.access_token, data.refresh_token || null);
      cryptoStorage.saveCredentials(username, password);

      // Immediately fetch complete student profile (course, semester, group, etc.)
      let completeUser = data;
      try {
        const profile = await this.checkSession(data.access_token);
        if (profile && typeof profile === "object") {
          completeUser = { ...data, ...profile };
        }
      } catch (err) {
        console.warn("[AuthService] Profile fetch right after login warning:", err.message);
      }

      // Cache user from /auth response right away
      this.cacheUser(completeUser);

      // Pre-warm / login to Exchange Mail silently in background
      try {
        import("./mailService.js").then(({ mailService }) => {
          mailService.login(username, password).catch((err) => {
            console.warn("[AuthService] Background mail login warning:", err.message);
          });
        }).catch(() => {});
      } catch (_) {}

      return { ...data, user: completeUser };
    }

    return data;
  },

  /**
   * Check session / get user profile: GET /auth with 10s timeout
   */
  async checkSession(token = null) {
    return apiClient("/auth", { method: "GET", token, timeout: 10000 });
  },

  /**
   * Refresh token: POST /auth/refresh
   */
  async refreshToken(refreshToken) {
    const data = await apiClient("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
      timeout: 5000
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
      await apiClient("/auth/logout", { method: "POST", timeout: 3000 });
    } catch (e) {
      console.warn("Logout request warning:", e.message);
    } finally {
      // Сначала гасим сессию почты (ей нужны куки), потом стираем всё вместе с ключом
      try {
        const { mailService } = await import("./mailService.js");
        await Promise.race([
          mailService.logout(),
          new Promise((resolve) => setTimeout(resolve, 3000))
        ]);
      } catch (_) {}
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

    const token = cryptoStorage.getToken();
    const { login: savedLogin, password: savedPassword } = await cryptoStorage.getSavedCredentialsAsync();
    const offlineUser = this.getCachedUser();

    // If there is no token and no saved credentials, user is not authenticated
    if (!token && !savedLogin) {
      return null;
    }

    const isDeviceOffline = typeof navigator !== "undefined" && navigator.onLine === false;

    // 1. If we have a token, attempt to validate with current session with 10s timeout
    if (token) {
      try {
        const user = await this.checkSession(token);
        if (user) {
          const merged = { ...(offlineUser || {}), ...user };
          this.cacheUser(merged);
          return { user: merged, token, isOffline: false };
        }
      } catch (err) {
        // If error is NOT 401 (e.g. server delay, 502/504, timeout, or local proxy):
        // Keep the user in the app with cached profile seamlessly without disturbing banner
        if (err.status !== 401 && err.message !== "UNAUTHORIZED") {
          console.warn("[AuthService] Server check skipped during session restore, using cached profile:", err.message);
          if (offlineUser) {
            return { user: offlineUser, token, isOffline: isDeviceOffline };
          }
        }
        console.warn("[AuthService] Token expired (401), attempting background re-authentication...");
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
          return { user: finalUser, token: newToken, isOffline: false };
        }
      } catch (err) {
        if (err.status !== 401 && err.status !== 403 && offlineUser) {
          console.warn("[AuthService] Network error during re-login, falling back to offline session");
          return { user: offlineUser, token: token || "offline", isOffline: isDeviceOffline };
        }
      }
    }

    // Сервер явно отверг сохранённые логин/пароль (сменили пароль и т.п.) —
    // не держим человека в «автономном режиме» с мёртвой сессией, а ведём на экран входа
    if (getLastRefreshFailure() === "CREDENTIALS_INVALID") {
      await cryptoStorage.purgeAll();
      return null;
    }

    // 3. Fallback: if server is temporarily unreachable, grant access with cached profile
    if (offlineUser) {
      return { user: offlineUser, token: token || "cached", isOffline: true };
    }

    return null;
  }
};
