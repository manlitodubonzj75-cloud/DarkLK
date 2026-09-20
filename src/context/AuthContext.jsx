import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authService, cryptoStorage, isCollegeStudent } from '../api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => authService.getCachedUser());
  const [token, setToken] = useState(() => cryptoStorage.getToken() || localStorage.getItem('access_token'));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

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
          } else {
            setUser(null);
            setToken(null);
          }
        }
      } catch (err) {
        console.warn('Initial session restore failed:', err);
        if (isMounted) {
          setUser(null);
          setToken(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    initAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  const login = useCallback(async (username, password) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await authService.login(username, password);
      if (response && response.access_token) {
        setToken(response.access_token);
        // If user object was returned or fetched
        const currentUser = response.user || authService.getCachedUser() || {
          name: username,
          username,
          role: 'student'
        };
        setUser(currentUser);
        return { success: true, user: currentUser };
      }
      throw new Error('Не удалось получить токен доступа');
    } catch (err) {
      const msg = err.status === 401 
        ? 'Неверный логин или пароль' 
        : (err.message || 'Ошибка авторизации. Проверьте соединение с сервером.');
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await authService.logout();
    } finally {
      setUser(null);
      setToken(null);
      setError(null);
      setIsLoading(false);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const latestUser = await authService.checkSession();
      if (latestUser) {
        setUser(latestUser);
        authService.cacheUser(latestUser);
      }
    } catch (e) {
      console.warn('Failed to refresh user profile:', e);
    }
  }, []);

  const isCollege = isCollegeStudent(user);

  const value = {
    user,
    token,
    isCollege,
    isAuthenticated: Boolean(token && user),
    isLoading,
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
