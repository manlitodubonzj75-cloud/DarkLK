import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { lkService, cacheService, formatISODate, getMondayOfWeek } from '../../api';
import { Card } from '../../components/common/Card';
import { Badge } from '../../components/common/Badge';
import { Icons } from '../../components/common/Icons';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';

const LESSON_TYPES = {
  'лекция': 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  'практическое': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  'семинар': 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  'лабораторная': 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
  'консультация': 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  'зачет': 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
  'экзамен': 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
};

const getLessonTypeBadge = (type = '') => {
  const lower = type.toLowerCase();
  for (const [key, classes] of Object.entries(LESSON_TYPES)) {
    if (lower.includes(key)) {
      return classes;
    }
  }
  return 'bg-primary/10 text-primary dark:text-[#38BDF8] border-primary/20';
};

export const SchedulePage = () => {
  const { user } = useAuth();

  // Navigation State
  const [viewMode, setViewMode] = useState('week'); // 'week' | 'month'
  const [currentMonday, setCurrentMonday] = useState(() => getMondayOfWeek(new Date()));
  const [currentMonthDate, setCurrentMonthDate] = useState(() => new Date());

  // Data State
  const [scheduleData, setScheduleData] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Helper to read cached week data immediately
  const getCachedWeek = (monday) => {
    const from = formatISODate(monday);
    const toDate = new Date(monday);
    toDate.setDate(monday.getDate() + 6);
    const to = formatISODate(toDate);
    return cacheService.get(`schedule_${from}_${to}`);
  };

  // Fetch Week Schedule safely without destroying offline cache
  const fetchWeekSchedule = useCallback(async (monday, forceRefresh = false) => {
    const cached = getCachedWeek(monday);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      setScheduleData(cached);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
    setError(null);
    try {
      const data = await lkService.getScheduleWeek(monday, { forceRefresh });
      if (Array.isArray(data) && data.length > 0) {
        setScheduleData(data);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("app-schedule-updated"));
        }
      }
    } catch (err) {
      if (!cached) {
        setError(err.message || 'Не удалось загрузить расписание недели');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch Month Schedule safely without destroying offline cache
  const fetchMonthSchedule = useCallback(async (monthDate, forceRefresh = false) => {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    const from = formatISODate(firstDay);
    const to = formatISODate(lastDay);

    const cached = cacheService.get(`schedule_${from}_${to}`);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      setScheduleData(cached);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const data = await lkService.getScheduleRange(from, to, { forceRefresh });
      if (Array.isArray(data) && data.length > 0) {
        setScheduleData(data);
      }
    } catch (err) {
      if (!cached) {
        setError(err.message || 'Не удалось загрузить расписание на месяц');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Trigger fetch depending on viewMode
  useEffect(() => {
    if (viewMode === 'week') {
      fetchWeekSchedule(currentMonday);
    } else {
      fetchMonthSchedule(currentMonthDate);
    }
  }, [viewMode, currentMonday, currentMonthDate, fetchWeekSchedule, fetchMonthSchedule]);

  // Listen for mobile pull-to-refresh without deleting offline cache
  useEffect(() => {
    const handlePullRefresh = () => {
      if (viewMode === 'week') {
        fetchWeekSchedule(currentMonday, true);
      } else {
        fetchMonthSchedule(currentMonthDate, true);
      }
    };

    window.addEventListener("app-pull-to-refresh", handlePullRefresh);
    return () => window.removeEventListener("app-pull-to-refresh", handlePullRefresh);
  }, [viewMode, currentMonday, currentMonthDate, fetchWeekSchedule, fetchMonthSchedule]);

  // Days of current week (Mon - Sat)
  const weekDays = useMemo(() => {
    const days = [];
    const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    for (let i = 0; i < 6; i++) {
      const d = new Date(currentMonday);
      d.setDate(currentMonday.getDate() + i);
      const iso = formatISODate(d);
      days.push({
        name: dayNames[i],
        date: d,
        iso,
        isToday: iso === formatISODate(new Date())
      });
    }
    return days;
  }, [currentMonday]);

  // Group lessons by date
  const lessonsByDate = useMemo(() => {
    const map = new Map();
    if (!Array.isArray(scheduleData)) return map;

    scheduleData.forEach(item => {
      const dateStr = item.date || item.lessonDate || item.dateLesson;
      if (!dateStr) return;
      const iso = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr.slice(0, 10);
      if (!map.has(iso)) {
        map.set(iso, []);
      }
      map.get(iso).push(item);
    });

    // Sort lessons inside each day by time
    for (const [date, list] of map.entries()) {
      list.sort((a, b) => {
        const timeA = a.time || a.timeStart || a.timeLesson || '';
        const timeB = b.time || b.timeStart || b.timeLesson || '';
        return timeA.localeCompare(timeB);
      });
    }

    return map;
  }, [scheduleData]);

  // Navigation handlers
  const handlePrevWeek = () => {
    const prev = new Date(currentMonday);
    prev.setDate(currentMonday.getDate() - 7);
    setCurrentMonday(prev);
  };

  const handleNextWeek = () => {
    const next = new Date(currentMonday);
    next.setDate(currentMonday.getDate() + 7);
    setCurrentMonday(next);
  };

  const handleCurrentWeek = () => {
    setCurrentMonday(getMondayOfWeek(new Date()));
  };

  const handlePrevMonth = () => {
    const prev = new Date(currentMonthDate);
    prev.setMonth(currentMonthDate.getMonth() - 1);
    setCurrentMonthDate(prev);
  };

  const handleNextMonth = () => {
    const next = new Date(currentMonthDate);
    next.setMonth(currentMonthDate.getMonth() + 1);
    setCurrentMonthDate(next);
  };

  const handleCurrentMonth = () => {
    setCurrentMonthDate(new Date());
  };

  return (
    <div className="space-y-6 pb-6">
      {/* Top Header & Mode Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-dark dark:text-white">Расписание занятий</h1>
          <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1">
            {user?.group ? `Группа ${user.group}` : 'Академическое расписание'} • {user?.department || 'МГЮА'}
          </p>
        </div>

        {/* View Mode & Today Buttons */}
        <div className="flex items-center space-x-2">
          <div className="flex items-center p-1 bg-surface dark:bg-[#1A1F2C] border border-border dark:border-[#2B3242] rounded-xl shadow-sm">
            <button
              onClick={() => setViewMode('week')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'week'
                  ? 'bg-primary text-white shadow'
                  : 'text-textMuted hover:text-dark dark:hover:text-white'
              }`}
            >
              Неделя
            </button>
            <button
              onClick={() => setViewMode('month')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                viewMode === 'month'
                  ? 'bg-primary text-white shadow'
                  : 'text-textMuted hover:text-dark dark:hover:text-white'
              }`}
            >
              Месяц
            </button>
          </div>

          <button
            onClick={viewMode === 'week' ? handleCurrentWeek : handleCurrentMonth}
            className="px-3 py-2 rounded-xl bg-surface dark:bg-[#1A1F2C] border border-border dark:border-[#2B3242] text-xs font-bold text-primary dark:text-[#38BDF8] hover:bg-primary/5 transition-all shadow-sm cursor-pointer"
          >
            Сегодня
          </button>
        </div>
      </div>

      {/* Date Navigation Bar */}
      <Card className="p-3 sm:p-4 flex items-center justify-between border border-border dark:border-[#2B3242]">
        <button
          onClick={viewMode === 'week' ? handlePrevWeek : handlePrevMonth}
          className="p-2 rounded-xl bg-bg dark:bg-[#12151B] text-textMuted hover:text-dark dark:hover:text-white transition-all cursor-pointer"
          title="Назад"
        >
          <Icons.ChevronLeft className="w-5 h-5" />
        </button>

        <div className="text-center">
          {viewMode === 'week' ? (
            <>
              <p className="text-sm sm:text-base font-bold text-dark dark:text-white">
                {currentMonday.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} —{' '}
                {new Date(currentMonday.getTime() + 5 * 86400000).toLocaleDateString('ru-RU', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric'
                })}
              </p>
              <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-0.5">
                {weekDays.some(d => d.isToday) ? 'Текущая неделя' : 'Выбранная неделя'}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm sm:text-base font-bold text-dark dark:text-white">
                {currentMonthDate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })}
              </p>
              <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-0.5">
                Календарный месяц
              </p>
            </>
          )}
        </div>

        <button
          onClick={viewMode === 'week' ? handleNextWeek : handleNextMonth}
          className="p-2 rounded-xl bg-bg dark:bg-[#12151B] text-textMuted hover:text-dark dark:hover:text-white transition-all cursor-pointer"
          title="Вперёд"
        >
          <Icons.ChevronRight className="w-5 h-5" />
        </button>
      </Card>

      {/* Loading or Error State */}
      {isLoading ? (
        <div className="py-20 flex justify-center">
          <LoadingSpinner size={10} text="Загрузка расписания..." />
        </div>
      ) : error && scheduleData.length === 0 ? (
        <Card className="p-8 text-center border border-border dark:border-[#2B3242]">
          <Icons.AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-3 opacity-80" />
          <h3 className="font-bold text-dark dark:text-white mb-1">Ошибка загрузки расписания</h3>
          <p className="text-xs text-textMuted dark:text-[#8E98A8] mb-4">{error}</p>
          <button
            onClick={() => viewMode === 'week' ? fetchWeekSchedule(currentMonday, true) : fetchMonthSchedule(currentMonthDate, true)}
            className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-bold shadow hover:bg-primary/90 transition-all cursor-pointer"
          >
            Попробовать снова
          </button>
        </Card>
      ) : (
        /* Week View Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {weekDays.map((day) => {
            const lessons = lessonsByDate.get(day.iso) || [];
            return (
              <Card
                key={day.iso}
                className={`p-4 border transition-all ${
                  day.isToday
                    ? 'border-primary dark:border-[#38BDF8] shadow-md ring-2 ring-primary/20 dark:ring-[#38BDF8]/20 bg-surface dark:bg-[#1A1F2C]'
                    : 'border-border dark:border-[#2B3242] bg-surface dark:bg-[#1A1F2C]'
                }`}
              >
                {/* Day Header */}
                <div className="flex items-center justify-between pb-3 border-b border-border dark:border-[#2B3242] mb-3">
                  <div className="flex items-center space-x-2">
                    <span className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs ${
                      day.isToday
                        ? 'bg-primary text-white'
                        : 'bg-bg dark:bg-[#12151B] text-textMuted dark:text-[#8E98A8]'
                    }`}>
                      {day.name}
                    </span>
                    <div>
                      <p className="text-xs font-bold text-dark dark:text-white">
                        {day.date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                      </p>
                      {day.isToday && (
                        <p className="text-[10px] font-bold text-primary dark:text-[#38BDF8]">
                          Сегодня
                        </p>
                      )}
                    </div>
                  </div>

                  <span className="text-[11px] font-semibold text-textMuted dark:text-[#8E98A8]">
                    {lessons.length > 0 ? `${lessons.length} пар` : 'Нет пар'}
                  </span>
                </div>

                {/* Day Lessons List */}
                {lessons.length === 0 ? (
                  <div className="py-8 text-center text-textMuted dark:text-[#8E98A8] text-xs">
                    <Icons.Coffee className="w-8 h-8 mx-auto mb-1.5 opacity-30" />
                    <span>Занятий нет</span>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {lessons.map((lesson, idx) => {
                      const typeClass = getLessonTypeBadge(lesson.type || lesson.typeLesson);
                      return (
                        <div
                          key={idx}
                          className="p-3 rounded-xl bg-bg dark:bg-[#12151B] border border-border/60 dark:border-[#2B3242]/60 hover:border-primary/40 transition-all space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-black text-dark dark:text-white">
                              {lesson.time || lesson.timeStart || '—'}
                            </span>
                            <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${typeClass}`}>
                              {lesson.type || lesson.typeLesson || 'Занятие'}
                            </span>
                          </div>

                          <p className="text-xs font-bold text-dark dark:text-white leading-snug">
                            {lesson.discipline || lesson.name || lesson.subject}
                          </p>

                          <div className="flex items-center justify-between text-[11px] text-textMuted dark:text-[#8E98A8] pt-0.5">
                            {lesson.teacher && (
                              <span className="truncate max-w-[150px]">
                                {lesson.teacher}
                              </span>
                            )}
                            {lesson.classroom && (
                              <span className="font-semibold text-primary dark:text-[#38BDF8] ml-auto">
                                ауд. {lesson.classroom}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SchedulePage;
