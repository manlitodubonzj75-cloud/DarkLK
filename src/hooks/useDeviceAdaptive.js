import { useState, useEffect } from 'react';

/**
 * Hook for comprehensive responsive device adaptation:
 * - Real-time viewport breakpoints (Mobile, Tablet, Desktop)
 * - Safe areas and viewport height normalization (--vh)
 * - Environment detection (Capacitor Android/iOS, Electron Desktop, Mobile Web)
 * - Touch vs mouse pointer adaptation
 */
export function useDeviceAdaptive() {
  const [deviceState, setDeviceState] = useState(() => {
    if (typeof window === 'undefined') {
      return {
        width: 1280,
        height: 800,
        isMobile: false,
        isTablet: false,
        isDesktop: true,
        isTouch: false,
        isCapacitor: false,
        isElectron: false
      };
    }

    const w = window.innerWidth;
    const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const isCapacitor = Boolean(window.Capacitor?.isNativePlatform?.() || window.Capacitor);
    const isElectron = Boolean(window.electronAPI || (typeof process !== 'undefined' && process.versions?.electron));

    return {
      width: w,
      height: window.innerHeight,
      isMobile: w < 768,
      isTablet: w >= 768 && w < 1024,
      isDesktop: w >= 1024,
      isTouch,
      isCapacitor,
      isElectron
    };
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
      const isCapacitor = Boolean(window.Capacitor?.isNativePlatform?.() || window.Capacitor);
      const isElectron = Boolean(window.electronAPI || (typeof process !== 'undefined' && process.versions?.electron));

      const isMobile = w < 768;
      const isTablet = w >= 768 && w < 1024;
      const isDesktop = w >= 1024;

      // Fix 100vh mobile address bar issue
      const vh = h * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);

      // Update root classes for CSS adaptive scoping
      const root = document.documentElement;
      root.classList.toggle('device-mobile', isMobile);
      root.classList.toggle('device-tablet', isTablet);
      root.classList.toggle('device-desktop', isDesktop);
      root.classList.toggle('device-touch', isTouch);
      root.classList.toggle('device-capacitor', isCapacitor);
      root.classList.toggle('device-electron', isElectron);

      setDeviceState({
        width: w,
        height: h,
        isMobile,
        isTablet,
        isDesktop,
        isTouch,
        isCapacitor,
        isElectron
      });
    };

    handleResize();
    window.addEventListener('resize', handleResize, { passive: true });
    window.addEventListener('orientationchange', handleResize, { passive: true });

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  return deviceState;
}
