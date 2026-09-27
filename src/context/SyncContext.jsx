import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthContext';
import {
  scheduleService,
  gradesService,
  studentService,
  recordbookService,
  cacheService,
  formatISODate,
  getMondayOfWeek
} from '../api';

const SyncContext = createContext(null);

export const useSync = () => {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSync must be used within a SyncProvider');
  }
  return context;
};

export const SyncProvider = ({ children }) => {
  const { user, isAuthenticated } = useAuth();

  const [lastSyncTime, setLastSyncTime] = useState(() => {
    try {
      const saved = localStorage.getItem('msal_last_sync_timestamp');
      return saved ? Number(saved) : null;
    } catch (_) {
      return null;
    }
  });

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);

  const today = new Date();
  const todayISO = formatISODate(today);
  const currentMonday = getMondayOfWeek(today);

  // 1. Synchronously pre-seed from cache for 0ms cold-start
  const [dashboardData, setDashboardData] = useState(() => {
    const mondayISO = formatISODate(currentMonday);
    const toDate = new Date(currentMonday);
    toDate.setDate(currentMonday.getDate() + 6);
    const sundayISO = formatISODate(toDate);

    const cachedWeek = cacheService.get(`schedule_${mondayISO}_${sundayISO}`);
    const todayLessons = scheduleService.extractTodayLessons(cachedWeek, todayISO);

    const cachedProgress = cacheService.get('progress_with_lessons_latest') ||
      (user?.course ? cacheService.get(`progress_with_lessons_c${user.course}_s${user.semester || 1}`) : null);
    const cachedStudentInfo = cacheService.get('student_info');

    const stats = gradesService.normalizeStudentStats(cachedProgress, cachedStudentInfo, user);

    return {
      todayLessons: todayLessons !== null ? todayLessons : [],
      hasLoadedLessons: todayLessons !== null,
      rating: stats.rating,
      passes: stats.passes,
      missedLessons: stats.missedLessons,
      loading: !cachedWeek && !cachedProgress && !cachedStudentInfo,
      isError: false
    };
  });

  const isSyncingRef = useRef(false);

  // Unified background sync: fetches fresh data and keeps local caches updated
  const syncAll = useCallback(async ({ force = false } = {}) => {
    if (!isAuthenticated) return;
    if (isSyncingRef.current) return;

    isSyncingRef.current = true;
    setIsSyncing(true);
    setSyncError(null);

    const mondayISO = formatISODate(currentMonday);
    const toDate = new Date(currentMonday);
    toDate.setDate(currentMonday.getDate() + 6);
    const sundayISO = formatISODate(toDate);

    try {
      const [scheduleRes, progressRes, studentInfoRes, recordbookRes] = await Promise.allSettled([
        scheduleService.getScheduleWeek(currentMonday, { forceRefresh: force }),
        gradesService.getProgressWithLessons(user, { forceRefresh: force }),
        studentService.getStudentInfo({ forceRefresh: force }),
        recordbookService.getRecordbook({ forceRefresh: force })
      ]);

      const weekData = scheduleRes.status === 'fulfilled' && Array.isArray(scheduleRes.value)
        ? scheduleRes.value
        : cacheService.get(`schedule_${mondayISO}_${sundayISO}`);

      const progressData = progressRes.status === 'fulfilled' && progressRes.value
        ? progressRes.value
        : (cacheService.get('progress_with_lessons_latest') ||
           (user?.course ? cacheService.get(`progress_with_lessons_c${user.course}_s${user.semester || 1}`) : null));

      const studentInfo = studentInfoRes.status === 'fulfilled' && studentInfoRes.value
        ? studentInfoRes.value
        : cacheService.get('student_info');

      // Normalize today's lessons
      const todayLessons = scheduleService.extractTodayLessons(weekData, todayISO) || [];

      // Normalize grades / passes / rating
      const stats = gradesService.normalizeStudentStats(progressData, studentInfo, user);

      setDashboardData({
        todayLessons,
        hasLoadedLessons: Array.isArray(weekData),
        rating: stats.rating,
        passes: stats.passes,
        missedLessons: stats.missedLessons,
        loading: false,
        isError: false
      });

      const now = Date.now();
      setLastSyncTime(now);
      try {
        localStorage.setItem('msal_last_sync_timestamp', String(now));
      } catch (_) {}
    } catch (err) {
      console.warn('[SyncContext] Sync failure:', err);
      setSyncError(err.message || 'Ошибка синхронизации данных');
      setDashboardData(prev => ({ ...prev, loading: false }));
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [isAuthenticated, user, currentMonday, todayISO]);

  // Initial sync on mount or auth change
  useEffect(() => {
    if (isAuthenticated) {
      syncAll({ force: false });
    }
  }, [isAuthenticated, syncAll]);

  // Global Pull-to-refresh listener
  useEffect(() => {
    const handlePull = () => {
      syncAll({ force: true });
    };

    window.addEventListener('app-pull-to-refresh', handlePull);
    return () => window.removeEventListener('app-pull-to-refresh', handlePull);
  }, [syncAll]);

  const value = {
    isSyncing,
    lastSyncTime,
    syncError,
    syncAll,
    dashboardData
  };

  return (
    <SyncContext.Provider value={value}>
      {children}
    </SyncContext.Provider>
  );
};

export const useDashboardData = () => {
  const { dashboardData } = useSync();
  return dashboardData;
};
