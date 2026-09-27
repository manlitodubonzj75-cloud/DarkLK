import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';

const ThemeContext = createContext(null);

export const ThemeProvider = ({ children }) => {
  const [isDark, setIsDark] = useState(() => {
    try {
      const saved = localStorage.getItem('msal_theme');
      if (saved) return saved === 'dark';
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (_) {
      return false;
    }
  });

  // Явный выбор пользователя сохраняем; без него — следуем системной теме
  const hasUserPrefRef = useRef((() => {
    try { return Boolean(localStorage.getItem('msal_theme')); } catch (_) { return false; }
  })());

  const lastToggleTimeRef = useRef(0);
  const rafIdRef = useRef(null);
  const saveTimeoutRef = useRef(null);

  // Synchronize DOM with current state
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    root.style.colorScheme = isDark ? 'dark' : 'light';

    // Пока пользователь не выбрал тему вручную, не фиксируем её — иначе смена системной темы игнорируется
    if (!hasUserPrefRef.current) return undefined;

    // Debounce localStorage write to prevent blocking disk I/O on rapid clicks
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem('msal_theme', isDark ? 'dark' : 'light');
      } catch (_) {}
    }, 120);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [isDark]);

  // Follow system theme changes while no explicit user choice is saved
  useEffect(() => {
    let mql;
    try {
      mql = window.matchMedia('(prefers-color-scheme: dark)');
    } catch (_) {
      return undefined;
    }
    const handleChange = (e) => {
      if (!hasUserPrefRef.current) setIsDark(e.matches);
    };
    if (mql.addEventListener) mql.addEventListener('change', handleChange);
    else if (mql.addListener) mql.addListener(handleChange);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', handleChange);
      else if (mql.removeListener) mql.removeListener(handleChange);
    };
  }, []);

  // Clean up RAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  /**
   * Throttled toggleTheme to prevent UI deadlock / thread starvation on rapid clicks
   */
  const toggleTheme = useCallback(() => {
    const now = performance.now();
    // Throttle to at most once every 120ms to allow browser render pipelines to settle
    if (now - lastToggleTimeRef.current < 120) {
      return;
    }
    lastToggleTimeRef.current = now;
    hasUserPrefRef.current = true;

    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }

    rafIdRef.current = requestAnimationFrame(() => {
      setIsDark(prev => !prev);
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
};
