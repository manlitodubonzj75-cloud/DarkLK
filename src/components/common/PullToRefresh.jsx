import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Icons } from './Icons';

/**
 * Universal native-feeling Pull-to-Refresh container:
 * - Engages ONLY when swiping down from top of main scrollable page
 * - Strictly ignores touches inside modals, dialogs, and popups
 * - Tactile spring resistance and rotation indicator
 * - Dispatches 'app-pull-to-refresh' event and executes callback
 * - Optimized with requestAnimationFrame to prevent high-frequency re-rendering
 */
export const PullToRefresh = ({ children, onRefresh }) => {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const startY = useRef(0);
  const currentY = useRef(0);
  const isDragging = useRef(false);
  const containerRef = useRef(null);
  const rafRef = useRef(null);

  const TRIGGER_THRESHOLD = 65; // px to trigger refresh
  const MAX_PULL = 90;

  const isInsideModal = (target) => {
    if (!target) return false;
    return Boolean(
      target.closest('[role="dialog"]') ||
      target.closest('[aria-modal="true"]') ||
      target.closest('.fixed') ||
      target.closest('.modal-container') ||
      target.closest('[data-modal]')
    );
  };

  const handleTouchStart = (e) => {
    if (isRefreshing) return;

    // Never activate pull-to-refresh when touching inside a modal, dialog or drawer
    if (isInsideModal(e.target)) {
      isDragging.current = false;
      return;
    }

    const scrollElem = containerRef.current;
    // Only activate if we are scrolled to the very top
    if (scrollElem && scrollElem.scrollTop > 2) return;
    if (window.scrollY > 2) return;

    startY.current = e.touches[0].clientY;
    currentY.current = e.touches[0].clientY;
    isDragging.current = true;
  };

  const handleTouchMove = (e) => {
    if (!isDragging.current || isRefreshing) return;

    // Abort if finger dragged into or out of a modal
    if (isInsideModal(e.target)) {
      isDragging.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setPullDistance(0);
      return;
    }

    const scrollElem = containerRef.current;
    if (scrollElem && scrollElem.scrollTop > 2) {
      isDragging.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setPullDistance(0);
      return;
    }

    currentY.current = e.touches[0].clientY;
    const diff = currentY.current - startY.current;

    if (diff > 8) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const distance = Math.min((diff - 8) * 0.45, MAX_PULL);
        setPullDistance(distance);
      });
    } else {
      if (pullDistance !== 0) {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        setPullDistance(0);
      }
    }
  };

  const executeRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setPullDistance(TRIGGER_THRESHOLD);
    
    // Light haptic feedback if available on mobile
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(15); } catch (_) {}
    }

    const minDelay = new Promise(resolve => setTimeout(resolve, 750));
    const refreshTask = onRefresh 
      ? Promise.resolve(onRefresh()) 
      : new Promise(resolve => {
          window.dispatchEvent(new CustomEvent('app-pull-to-refresh'));
          setTimeout(resolve, 600);
        });

    try {
      await Promise.all([refreshTask, minDelay]);
    } catch (err) {
      console.warn('Pull-to-refresh execution error:', err);
    } finally {
      setIsRefreshing(false);
      setPullDistance(0);
    }
  }, [onRefresh]);

  const handleTouchEnd = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (!isDragging.current) return;
    isDragging.current = false;

    if (pullDistance >= TRIGGER_THRESHOLD) {
      executeRefresh();
    } else {
      setPullDistance(0);
    }
  };

  // Expose manual trigger via window event for desktop / shortcuts
  useEffect(() => {
    const handleTrigger = () => {
      if (!isRefreshing) executeRefresh();
    };
    window.addEventListener('trigger-app-refresh', handleTrigger);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('trigger-app-refresh', handleTrigger);
    };
  }, [executeRefresh, isRefreshing]);

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="relative w-full h-full overflow-y-auto overflow-x-hidden flex-1"
      style={{ WebkitOverflowScrolling: 'touch', overscrollBehaviorY: 'contain' }}
    >
      {/* Pull Indicator Badge */}
      <div
        className={`absolute left-0 right-0 top-0 flex items-center justify-center pointer-events-none z-30 transition-transform duration-150 ${
          isRefreshing ? 'transition-all duration-300' : ''
        }`}
        style={{
          transform: `translateY(${pullDistance > 0 ? pullDistance - 45 : -60}px)`,
          opacity: pullDistance > 10 ? Math.min(pullDistance / TRIGGER_THRESHOLD, 1) : 0
        }}
      >
        <div className="flex items-center space-x-2 px-4 py-2 rounded-full bg-card dark:bg-[#1F2430] border border-border dark:border-[#2B3242] shadow-md text-xs font-bold text-dark dark:text-white">
          <div className={isRefreshing ? 'animate-spin text-primary dark:text-[#38BDF8]' : 'text-primary dark:text-[#38BDF8]'}>
            <Icons.Refresh size={16} className={!isRefreshing && pullDistance >= TRIGGER_THRESHOLD ? 'rotate-180 transition-transform' : ''} />
          </div>
          <span>
            {isRefreshing 
              ? 'Обновление данных...' 
              : pullDistance >= TRIGGER_THRESHOLD 
              ? 'Отпустите для обновления' 
              : 'Потяните вниз для обновления'}
          </span>
        </div>
      </div>

      {/* Main Page Children Content */}
      <div
        style={{
          transform: `translateY(${pullDistance * 0.4}px)`,
          transition: isDragging.current ? 'none' : 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)'
        }}
        className="w-full min-h-full"
      >
        {children}
      </div>
    </div>
  );
};
