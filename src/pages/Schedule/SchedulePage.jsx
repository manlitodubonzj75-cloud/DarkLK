import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { lkService, formatISODate, getMondayOfWeek, formatLessonTime, cacheService } from '../../api';
import { Card } from '../../components/common/Card';
import { Badge } from '../../components/common/Badge';
import { Icons } from '../../components/common/Icons';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { ErrorMessage } from '../../components/common/ErrorMessage';

export const SchedulePage = () => {
  const { isCollege } = useAuth();
  const [viewMode, setViewMode] = useState('week'); // 'week' | 'month'
  const [currentMonday, setCurrentMonday] = useState(() => getMondayOfWeek(new Date()));
  const [currentMonthDate, setCurrentMonthDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDateISO, setSelectedDateISO] = useState(() => formatISODate(new Date()));

  // Cache helper for a week
  const getCachedWeek = (mon) => {
    const from = formatISODate(mon);
    const toDate = new Date(mon);
    toDate.setDate(mon.getDate() + 6);
    const to = formatISODate(toDate);
    const cached = cacheService.get(`schedule_${from}_${to}`);
    return Array.isArray(cached) && cached.length > 0 ? cached : null;
  };

  const initialCached = getCachedWeek(currentMonday);
  const [scheduleData, setScheduleData] = useState(() => initialCached || []);
  const [isLoading, setIsLoading] = useState(() => !initialCached);
  const [error, setError] = useState(null);

  // Fetch Week Schedule
  const fetchWeekSchedule = useCallback(async (monday) => {
    const cached = getCachedWeek(monday);
    if (cached) {
      setScheduleData(cached);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }
    setError(null);
    try {
      const data = await lkService.getScheduleWeek(monday);
      if (Array.isArray(data) && data.length > 0) {
        setScheduleData(data);
      }
    } catch (err) {
      if (!cached) {
        setError(err.message || 'Не удалось загрузить расписание недели');
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch Month Schedule (using getScheduleRange from 1st of month to last of month)
  const fetchMonthSchedule = useCallback(async (monthDate) => {
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
      const data = await lkService.getScheduleRange(from, to);
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

  // Listen for mobile pull-to-refresh
  useEffect(() => {
    const handlePullRefresh = () => {
      if (viewMode === 'week') {
        const from = formatISODate(currentMonday);
        const toDate = new Date(currentMonday);
        toDate.setDate(currentMonday.getDate() + 6);
        const to = formatISODate(toDate);
        cacheService.remove(`schedule_${from}_${to}`);
        fetchWeekSchedule(currentMonday);
      } else {
        const year = currentMonthDate.getFullYear();
        const month = currentMonthDate.getMonth();
        const from = formatISODate(new Date(year, month, 1));
        const to = formatISODate(new Date(year, month + 1, 0));
        cacheService.remove(`schedule_${from}_${to}`);
        fetchMonthSchedule(currentMonthDate);
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
      const hasLessons = scheduleData.some(day => day.title === iso && Array.isArray(day.data) && day.data.length > 0);
      days.push({
        iso,
        dayNumber: d.getDate(),
        name: dayNames[i],
        isToday: iso === formatISODate(new Date()),
        hasLessons
      });
    }
    return days;
  }, [currentMonday, scheduleData]);

  // Month grid days (Mon - Sat only, skipping Sundays)
  const monthGridDays = useMemo(() => {
    if (viewMode !== 'month') return [];

    const year = currentMonthDate.getFullYear();
    const month = currentMonthDate.getMonth();
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    const result = [];
    let startDayOfWeek = firstDayOfMonth.getDay();
    if (startDayOfWeek === 0) startDayOfWeek = 7; // Sunday -> 7

    for (let i = 1; i < startDayOfWeek; i++) {
      const prevDate = new Date(year, month, 1 - (startDayOfWeek - i));
      if (prevDate.getDay() !== 0) {
        result.push({
          iso: formatISODate(prevDate),
          dayNumber: prevDate.getDate(),
          isCurrentMonth: false,
          isToday: formatISODate(prevDate) === formatISODate(new Date()),
          hasLessons: false
        });
      }
    }

    for (let day = 1; day <= lastDayOfMonth.getDate(); day++) {
      const curDate = new Date(year, month, day);
      if (curDate.getDay() !== 0) { // Skip Sunday
        const iso = formatISODate(curDate);
        const hasLessons = scheduleData.some(d => d.title === iso && Array.isArray(d.data) && d.data.length > 0);
        result.push({
          iso,
          dayNumber: day,
          isCurrentMonth: true,
          isToday: iso === formatISODate(new Date()),
          hasLessons
        });
      }
    }

    const remainder = result.length % 6;
    if (remainder !== 0) {
      const fillCount = 6 - remainder;
      for (let i = 1; i <= fillCount; i++) {
        const nextDate = new Date(year, month + 1, i);
        if (nextDate.getDay() !== 0) {
          result.push({
            iso: formatISODate(nextDate),
            dayNumber: nextDate.getDate(),
            isCurrentMonth: false,
            isToday: formatISODate(nextDate) === formatISODate(new Date()),
            hasLessons: false
          });
        }
      }
    }

    return result;
  }, [currentMonthDate, scheduleData, viewMode]);

  // Week navigation
  const handlePrevWeek = () => {
    const prev = new Date(currentMonday);
    prev.setDate(prev.getDate() - 7);
    setCurrentMonday(prev);
    setSelectedDateISO(formatISODate(prev));
  };

  const handleNextWeek = () => {
    const next = new Date(currentMonday);
    next.setDate(next.getDate() + 7);
    setCurrentMonday(next);
    setSelectedDateISO(formatISODate(next));
  };

  // Month navigation
  const handlePrevMonth = () => {
    const prev = new Date(currentMonthDate);
    prev.setMonth(prev.getMonth() - 1);
    setCurrentMonthDate(prev);
    setSelectedDateISO(formatISODate(prev));
  };

  const handleNextMonth = () => {
    const next = new Date(currentMonthDate);
    next.setMonth(next.getMonth() + 1);
    setCurrentMonthDate(next);
    setSelectedDateISO(formatISODate(next));
  };

  // Jump to Today
  const handleToday = () => {
    const now = new Date();
    setCurrentMonday(getMondayOfWeek(now));
    setCurrentMonthDate(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDateISO(formatISODate(now));
  };

  // Date Strings
  const startWeekStr = currentMonday.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  const endWeekDate = new Date(currentMonday);
  endWeekDate.setDate(currentMonday.getDate() + 5);
  const endWeekStr = endWeekDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

  const monthTitleStr = currentMonthDate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  const capitalizedMonthStr = monthTitleStr.charAt(0).toUpperCase() + monthTitleStr.slice(1);

  // Get lessons for selected date
  const selectedDayItem = scheduleData.find(d => d.title === selectedDateISO);
  const lessons = selectedDayItem && Array.isArray(selectedDayItem.data) ? selectedDayItem.data : [];

  return (
    <div className="space-y-5 pb-8 w-full min-w-0">
      {/* Header with date navigation & view toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full min-w-0">
        <div>
          <h1 className="text-2xl font-black text-dark dark:text-white tracking-wide">
            Расписание
          </h1>
          <p className="text-xs font-medium text-textMuted dark:text-[#8E98A8] mt-0.5">
            {isCollege ? 'Учебные занятия и семинары' : 'Учебные занятия, семинары и отработки'}
          </p>
        </div>

        {/* Row: [Сегодня]  [ < Дата-Дата / Месяц > ]  [ Месяц / Неделя ] - perfectly height-aligned */}
        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={handleToday}
            className="h-10 px-3.5 rounded-xl bg-card border border-border dark:border-[#2B3242] text-xs font-bold text-dark dark:text-white hover:bg-bg dark:hover:bg-[#262D3D] transition-colors shrink-0 flex items-center justify-center shadow-sm"
          >
            Сегодня
          </button>

          {/* Date Switcher */}
          <div className="h-10 flex items-center bg-card border border-border dark:border-[#2B3242] rounded-xl p-1 shrink-0 shadow-sm">
            <button
              onClick={viewMode === 'week' ? handlePrevWeek : handlePrevMonth}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-bg dark:hover:bg-[#262D3D] transition-colors text-dark dark:text-white"
              title={viewMode === 'week' ? 'Предыдущая неделя' : 'Предыдущий месяц'}
            >
              <Icons.ArrowLeft size={16} />
            </button>
            <span className="px-3 text-xs font-bold text-dark dark:text-white tracking-wide select-none min-w-[120px] text-center">
              {viewMode === 'week' ? `${startWeekStr} — ${endWeekStr}` : capitalizedMonthStr}
            </span>
            <button
              onClick={viewMode === 'week' ? handleNextWeek : handleNextMonth}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-bg dark:hover:bg-[#262D3D] transition-colors text-dark dark:text-white rotate-180"
              title={viewMode === 'week' ? 'Следующая неделя' : 'Следующий месяц'}
            >
              <Icons.ArrowLeft size={16} />
            </button>
          </div>

          {/* Single View Mode Toggle Button */}
          <button
            onClick={() => setViewMode(prev => prev === 'week' ? 'month' : 'week')}
            className={`h-10 px-3 rounded-xl border text-xs font-bold transition-all shrink-0 flex items-center space-x-1.5 shadow-sm ${
              viewMode === 'month'
                ? 'bg-primary text-white border-primary shadow-md'
                : 'bg-card border-border dark:border-[#2B3242] text-dark dark:text-white hover:border-accent dark:hover:border-[#38BDF8] hover:bg-bg dark:hover:bg-[#262D3D]'
            }`}
            title={viewMode === 'week' ? 'Переключить вид на месяц' : 'Переключить вид на неделю'}
          >
            <Icons.Calendar size={15} />
            <span className="hidden xs:inline">{viewMode === 'week' ? 'Месяц' : 'Неделя'}</span>
          </button>
        </div>
      </div>

      {/* VIEW MODE 1: WEEK VIEW */}
      {viewMode === 'week' && (
        <div className="grid grid-cols-6 gap-2 w-full min-w-0">
          {weekDays.map(item => {
            const isSelected = item.iso === selectedDateISO;
            return (
              <button
                key={item.iso}
                onClick={() => setSelectedDateISO(item.iso)}
                className={`py-3 px-1 sm:px-2 rounded-2xl flex flex-col items-center justify-center transition-all duration-150 min-w-0 ${
                  isSelected
                    ? 'bg-primary dark:bg-[#1E6685] text-white shadow-md scale-[1.02]'
                    : item.isToday
                    ? 'bg-accent/15 text-accent dark:text-[#38BDF8] border border-accent/40 dark:border-[#22869A]/50'
                    : 'bg-card dark:bg-[#1F2430] border border-border dark:border-[#2B3242] text-dark dark:text-white hover:border-accent dark:hover:border-[#38BDF8]'
                }`}
              >
                <div className="flex items-center space-x-1 mb-1">
                  <span className={`text-[10px] sm:text-xs font-bold uppercase ${isSelected ? 'text-white/80' : 'text-textMuted dark:text-[#8E98A8]'}`}>
                    {item.name}
                  </span>
                  {item.hasLessons && (
                    <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-secondary dark:bg-[#38BDF8]'}`} />
                  )}
                </div>
                <span className="text-base sm:text-lg font-black leading-none">
                  {item.dayNumber}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* VIEW MODE 2: MONTH VIEW */}
      {viewMode === 'month' && (
        <Card className="p-3.5 sm:p-4 border border-border dark:border-[#2B3242] w-full min-w-0 shadow-sm">
          {/* Calendar Header Row: Пн - Сб */}
          <div className="grid grid-cols-6 gap-1 mb-2 text-center text-[11px] font-bold uppercase tracking-wider text-textMuted dark:text-[#8E98A8]">
            <span>Пн</span>
            <span>Вт</span>
            <span>Ср</span>
            <span>Чт</span>
            <span>Пт</span>
            <span>Сб</span>
          </div>

          {/* Calendar Day Cells Grid */}
          <div className="grid grid-cols-6 gap-1 sm:gap-1.5 w-full min-w-0">
            {monthGridDays.map((item, idx) => {
              const isSelected = item.iso === selectedDateISO;
              return (
                <button
                  key={idx}
                  onClick={() => setSelectedDateISO(item.iso)}
                  className={`p-2 sm:p-2.5 rounded-xl flex flex-col items-center justify-center transition-all min-w-0 ${
                    isSelected
                      ? 'bg-primary text-white font-bold shadow-md scale-[1.03]'
                      : item.isToday
                      ? 'bg-accent/15 text-accent dark:text-[#38BDF8] font-bold border border-accent/40'
                      : item.isCurrentMonth
                      ? 'bg-card border border-border/80 dark:border-[#2B3242] text-dark dark:text-white hover:border-accent'
                      : 'bg-bg/60 dark:bg-[#12151B]/50 border border-transparent text-textMuted/40 dark:text-[#8E98A8]/40'
                  }`}
                >
                  <span className="text-xs sm:text-sm font-black leading-none">
                    {item.dayNumber}
                  </span>
                  {item.hasLessons && (
                    <span className={`w-1.5 h-1.5 rounded-full mt-1 ${isSelected ? 'bg-white' : 'bg-secondary dark:bg-[#38BDF8]'}`} />
                  )}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Selected Day Header */}
      <div className="flex items-center justify-between pt-1">
        <h3 className="text-xs font-bold uppercase tracking-wider text-textMuted dark:text-[#8E98A8]">
          Занятия на {new Date(selectedDateISO).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
        </h3>
        {lessons.length > 0 && (
          <span className="text-xs font-bold text-secondary dark:text-[#38BDF8]">
            {lessons.length} {lessons.length === 1 ? 'пара' : lessons.length < 5 ? 'пары' : 'пар'}
          </span>
        )}
      </div>

      {/* Schedule Content */}
      {isLoading ? (
        <Card className="p-12 text-center border border-border dark:border-[#2B3242]">
          <LoadingSpinner size={10} text="Получение расписания с сервера..." />
        </Card>
      ) : error ? (
        <ErrorMessage message={error} onRetry={() => viewMode === 'week' ? fetchWeekSchedule(currentMonday) : fetchMonthSchedule(currentMonthDate)} />
      ) : lessons.length === 0 ? (
        <Card className="p-12 text-center border border-border dark:border-[#2B3242]">
          <div className="w-14 h-14 rounded-full bg-accent/10 dark:bg-[#1E6685]/30 mx-auto flex items-center justify-center text-accent dark:text-[#38BDF8] mb-3">
            <Icons.Calendar size={28} />
          </div>
          <h3 className="text-base font-bold text-dark dark:text-white">В этот день занятий нет</h3>
          <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1">
            {isCollege ? 'На выбранную дату в системе не назначено пар.' : 'На выбранную дату в системе не назначено пар или отработок.'}
          </p>
        </Card>
      ) : (
        <div className="space-y-3 w-full min-w-0">
          {lessons.map((lesson, idx) => (
            <Card key={lesson.id || idx} className="p-4 sm:p-5 hover:border-accent dark:hover:border-[#38BDF8] transition-colors border border-border dark:border-[#2B3242] overflow-hidden w-full min-w-0 shadow-sm">
              {/* Top row: Time badge on left, Lesson Type & Corps on right */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 w-full min-w-0">
                <div className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary dark:text-[#38BDF8] font-bold text-xs sm:text-sm shrink-0">
                  {formatLessonTime(lesson.start)} — {formatLessonTime(lesson.end)}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5 min-w-0 max-w-[60%] sm:max-w-none">
                  {lesson.type && (
                    <Badge 
                      type={lesson.type === 'Консультация' ? 'secondary' : 'primary'}
                      className="max-w-[180px] sm:max-w-[280px] truncate text-[11px] font-semibold"
                      title={lesson.type}
                    >
                      {lesson.type}
                    </Badge>
                  )}
                  {lesson.corps && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-bg dark:bg-[#181C26] text-textMuted dark:text-[#8E98A8] border border-border dark:border-[#2B3242] shrink-0">
                      {lesson.corps}
                    </span>
                  )}
                </div>
              </div>

              {/* Middle row: Full Discipline Title */}
              <h4 className="text-base sm:text-lg font-bold text-dark dark:text-white leading-snug break-words">
                {lesson.discipline || lesson.subject}
              </h4>

              {/* Bottom row: Auditory & Teacher */}
              {(lesson.auditory || lesson.teacher) && (
                <div className="mt-3 pt-2.5 border-t border-border dark:border-[#2B3242] flex flex-wrap items-center justify-between gap-2 text-xs text-textMuted dark:text-[#8E98A8]">
                  {lesson.auditory && (
                    <span className="font-semibold text-dark dark:text-white">
                      Аудитория: {lesson.auditory}
                    </span>
                  )}
                  {lesson.teacher && (
                    <span className="text-secondary dark:text-[#38BDF8] font-medium">
                      {lesson.teacher}
                    </span>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
