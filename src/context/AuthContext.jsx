import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService, cryptoStorage, isCollegeStudent } from '../api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => authService.getCachedUser());
  const [token, setToken] = useState(() => cryptoStorage.getToken());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' ? !navigator.onLine : false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(() => {
    const saved = localStorage.getItem('msal_last_sync');
    return saved ? Number(saved) : null;
  });

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await authService.logout();
    } finally {
      setUser(null);
      setToken(null);
      setError(null);
      setIsOffline(false);
      setIsLoading(false);
    }
  }, []);

  const retrySync = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const freshUser = await authService.checkSession();
      if (freshUser) {
        setUser(freshUser);
        authService.cacheUser(freshUser);
        setIsOffline(false);
        const now = Date.now();
        setLastSyncTime(now);
        try {
          localStorage.setItem('msal_last_sync', String(now));
        } catch (_) {}
      }
    } catch (err) {
      console.warn('[AuthContext] Manual sync attempt failed:', err.message);
      // Only flip to offline mode if connection truly failed or device is offline
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setIsOffline(true);
      } else if (err.name === 'TimeoutError' || err.status === 408 || err.message?.includes('Failed to fetch')) {
        setIsOffline(true);
      }
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing]);

  // Restore session on initial load
  useEffect(() => {
    let isMounted = true;

    async function initAuth() {
      setIsLoading(true);
      try {
        const session = await authService.restoreSession();
        if (isMounted) {
          if (session && session.user) {
            setUser(session.user);
            setToken(session.token);
            setIsOffline(Boolean(session.isOffline));
            if (!session.isOffline) {
              const now = Date.now();
              setLastSyncTime(now);
              try {
                localStorage.setItem('msal_last_sync', String(now));
              } catch (_) {}
            }
          } else {
            // Only clear state if there is truly no cached user or credentials
            const fallbackUser = authService.getCachedUser();
            if (fallbackUser) {
              setUser(fallbackUser);
              setToken(cryptoStorage.getToken() || 'offline');
              setIsOffline(typeof navigator !== 'undefined' ? !navigator.onLine : false);
            } else {
              setUser(null);
              setToken(null);
            }
          }
        }
      } catch (err) {
        console.warn('Initial session restore error caught:', err);
        if (isMounted) {
          const fallbackUser = authService.getCachedUser();
          if (fallbackUser) {
            setUser(fallbackUser);
            setToken(cryptoStorage.getToken() || 'offline');
            setIsOffline(typeof navigator !== 'undefined' ? !navigator.onLine : false);
          } else {
            setUser(null);
            setToken(null);
          }
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    initAuth();

    // Standard native online/offline listeners
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const handleTokenRefreshed = (e) => {
      if (e.detail && isMounted) {
        setToken(e.detail);
      }
    };

    const handleSessionExpired = () => {
      logout();
    };

    window.addEventListener('session-token-refreshed', handleTokenRefreshed);
    window.addEventListener('auth-session-expired', handleSessionExpired);

    return () => {
      isMounted = false;
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('session-token-refreshed', handleTokenRefreshed);
      window.removeEventListener('auth-session-expired', handleSessionExpired);
    };
  }, [logout]);

  const login = useCallback(async (username, password) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await authService.login(username, password);
      if (response && response.access_token) {
        setToken(response.access_token);
        const currentUser = response.user || authService.getCachedUser() || {
          name: username,
          username,
          role: 'student'
        };
        setUser(currentUser);
        setIsOffline(false);
        const now = Date.now();
        setLastSyncTime(now);
        try {
          localStorage.setItem('msal_last_sync', String(now));
        } catch (_) {}
        return { success: true, user: currentUser };
      }
      throw new Error('Не удалось получить токен доступа');
    } catch (err) {
      // apiClient бросает технические англоязычные ошибки ('UNAUTHORIZED', 'Request timed out…',
      // 'Failed to fetch', HTML-тело ответа) — показываем пользователю понятный русский текст
      const rawMsg = String(err?.message || '');
      let msg;
      if (err?.status === 401 || rawMsg === 'UNAUTHORIZED') {
        msg = 'Неверный логин или пароль';
      } else if (err?.name === 'TimeoutError' || err?.status === 408) {
        msg = 'Сервер МГЮА не отвечает. Попробуйте ещё раз чуть позже.';
      } else if (err?.status === 0 || err?.name === 'TypeError' || /failed to fetch|load failed|network/i.test(rawMsg)) {
        msg = 'Нет соединения с сервером. Проверьте подключение к интернету.';
      } else if (err?.status >= 500) {
        msg = `Сервер МГЮА временно недоступен (ошибка ${err.status}). Попробуйте позже.`;
      } else if (/[а-яё]/i.test(rawMsg) && rawMsg.length <= 300) {
        msg = rawMsg;
      } else {
        msg = 'Ошибка авторизации. Проверьте соединение с сервером.';
      }
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const latestUser = await authService.checkSession();
      if (latestUser) {
        setUser(latestUser);
        authService.cacheUser(latestUser);
        setIsOffline(false);
        const now = Date.now();
        setLastSyncTime(now);
        try {
          localStorage.setItem('msal_last_sync', String(now));
        } catch (_) {}
      }
    } catch (e) {
      console.warn('Failed to refresh user profile:', e);
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setIsOffline(true);
      }
    }
  }, []);

  const isCollege = isCollegeStudent(user);

  const value = {
    user,
    token,
    isCollege,
    isAuthenticated: Boolean(token && user),
    isLoading,
    isOffline,
    isSyncing,
    lastSyncTime,
    retrySync,
    error,
    login,
    logout,
    refreshUser
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
