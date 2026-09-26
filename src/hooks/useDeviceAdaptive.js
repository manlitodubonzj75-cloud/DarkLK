import { useState, useEffect, useRef } from 'react';

/**
 * Hook for comprehensive responsive device adaptation:
 * - Viewport breakpoints (Mobile, Tablet, Desktop)
 * - Stabilized: does NOT trigger re-renders on minor height changes (URL bar collapse in Safari)
 * - Safe areas and viewport height normalization (--vh)
 * - Environment detection (Capacitor Android/iOS, Electron Desktop, Mobile Web)
 * - Touch vs mouse pointer adaptation
 */
export function useDeviceAdaptive() {
  const [deviceState, setDeviceState] = useState(() => {
    if (typeof window === 'undefined') {
      return {
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
      isMobile: w < 768,
      isTablet: w >= 768 && w < 1024,
      isDesktop: w >= 1024,
      isTouch,
      isCapacitor,
      isElectron
    };
  });

  const stateRef = useRef(deviceState);
  stateRef.current = deviceState;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let resizeTimer = null;

    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
      const isCapacitor = Boolean(window.Capacitor?.isNativePlatform?.() || window.Capacitor);
      const isElectron = Boolean(window.electronAPI || (typeof process !== 'undefined' && process.versions?.electron));

      const isMobile = w < 768;
      const isTablet = w >= 768 && w < 1024;
      const isDesktop = w >= 1024;

      // Update CSS variables
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

      const prev = stateRef.current;
      // ONLY re-render if responsive breakpoint or touch mode actually changed
      if (
        prev.isMobile !== isMobile ||
        prev.isTablet !== isTablet ||
        prev.isDesktop !== isDesktop ||
        prev.isTouch !== isTouch ||
        prev.isCapacitor !== isCapacitor
      ) {
        setDeviceState({
          isMobile,
          isTablet,
          isDesktop,
          isTouch,
          isCapacitor,
          isElectron
        });
      }
    };

    handleResize();

    const debouncedResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(handleResize, 100);
    };

    window.addEventListener('resize', debouncedResize, { passive: true });
    window.addEventListener('orientationchange', handleResize, { passive: true });

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener('resize', debouncedResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  return deviceState;
}
