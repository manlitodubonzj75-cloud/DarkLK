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
