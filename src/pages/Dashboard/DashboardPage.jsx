import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { lkService, formatISODate, formatLessonTime, getMondayOfWeek, parseLessonDate } from '../../api';
import { cacheService } from '../../api';

// Поля могут прийти объектом ({ name }) — React не умеет рендерить объекты
const asText = (v) => (v && typeof v === 'object' ? (v.name || v.title || '') : v);

// 1 пара, 2 пары, 5 пар, 11 пар, 21 пара
function pluralPairs(n) {
  const num = Math.abs(Number(n)) || 0;
  const mod10 = num % 10;
  const mod100 = num % 100;
  if (mod10 === 1 && mod100 !== 11) return 'пара';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'пары';
  return 'пар';
}

function extractTodayLessons(weekData, todayISO) {
  if (!Array.isArray(weekData) || weekData.length === 0) return null;
  const todayItem = weekData.find(day => {
    const title = day.title || day.date;
    if (!title) return false;
    return title === todayISO || title.startsWith(todayISO);
  });
  return (todayItem && Array.isArray(todayItem.data)) ? todayItem.data : [];
}

export const DashboardPage = () => {
  const { user, isCollege } = useAuth();
  const navigate = useNavigate();

  const now = new Date();
  const todayISO = formatISODate(now);
  const monday = getMondayOfWeek(now);
  const mondayISO = formatISODate(monday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const sundayISO = formatISODate(sunday);
  const scheduleCacheKey = `schedule_${mondayISO}_${sundayISO}`;

  // 1. Synchronous Instant State Initialization from Encrypted Cache
  const [scheduleToday, setScheduleToday] = useState(() => {
    const cachedWeek = cacheService.get(scheduleCacheKey);
    const lessons = extractTodayLessons(cachedWeek, todayISO);
    return lessons !== null ? lessons : [];
  });

  const [isScheduleLoading, setIsScheduleLoading] = useState(() => {
    const cachedWeek = cacheService.get(scheduleCacheKey);
    return !Array.isArray(cachedWeek) || cachedWeek.length === 0;
  });

  const [stats, setStats] = useState(() => {
    const cachedStudentInfo = cacheService.get('student_info');
    const cachedProgress = cacheService.get('progress_with_lessons_latest');
    let ratingVal = cachedStudentInfo?.reting ?? cachedStudentInfo?.rating ?? cachedProgress?.studentInfo?.reting ?? cachedProgress?.rating;
    if ((ratingVal === undefined || ratingVal === null || ratingVal === '—') && cachedProgress?.gpa && cachedProgress.gpa !== '—') {
      ratingVal = cachedProgress.gpa;
    }
    if (!ratingVal) ratingVal = '—';
    const passesVal = cachedProgress?.passes ?? cachedStudentInfo?.passes ?? 0;
    const missedLessons = Array.isArray(cachedProgress?.missedLessons) ? cachedProgress.missedLessons : [];

    return {
      rating: ratingVal,
      passes: passesVal,
      missedLessons,
      loading: !cachedStudentInfo && !cachedProgress
    };
  });

  const [showMissedModal, setShowMissedModal] = useState(false);
  const [scheduleError, setScheduleError] = useState(false);

  // 2. Fetch fresh data in background (decoupled for instant schedule render)
  useEffect(() => {
    let isMounted = true;
    // Date из mondayISO (строка стабильна между рендерами, в отличие от объекта Date)
    const [my, mm, md] = mondayISO.split('-').map(Number);
    const mondayDate = new Date(my, mm - 1, md);

    async function fetchSchedule(forceRefresh = false) {
      try {
        const weekSchedule = await lkService.getScheduleWeek(mondayDate, { forceRefresh, ttl: 300000 });
        if (!isMounted) return;
        const lessons = extractTodayLessons(weekSchedule, todayISO);
        setScheduleToday(lessons !== null ? lessons : []);
        setScheduleError(false);
      } catch (err) {
        console.warn('[Dashboard] Schedule load warning:', err.message);
        if (!isMounted) return;
        const cachedWeek = cacheService.get(scheduleCacheKey);
        const lessons = extractTodayLessons(cachedWeek, todayISO);
        if (lessons !== null) {
          setScheduleToday(lessons);
        } else {
          setScheduleError(true);
        }
      } finally {
        if (isMounted) setIsScheduleLoading(false);
      }
    }

    async function fetchOtherData(forceRefresh = false) {
      const fetchOpts = { forceRefresh, ttl: 300000 };
      try {
        const [progressInfo, studentInfoResp] = await Promise.allSettled([
          lkService.getProgressWithLessons(user, fetchOpts),
          !isCollege ? lkService.getStudentInfo(fetchOpts) : Promise.resolve({})
        ]);

        if (!isMounted) return;

        // Process rating/GPA and absences
        const studentInfo = studentInfoResp.status === 'fulfilled' ? studentInfoResp.value : null;
        const progressVal = progressInfo.status === 'fulfilled' ? progressInfo.value : null;
        let ratingVal = studentInfo?.reting ?? studentInfo?.rating ?? progressVal?.studentInfo?.reting ?? progressVal?.rating;
        if ((ratingVal === undefined || ratingVal === null || ratingVal === '—') && progressVal?.gpa && progressVal.gpa !== '—') {
          ratingVal = progressVal.gpa;
        }
        if (!ratingVal) ratingVal = '—';
        const passesVal = progressVal?.passes ?? studentInfo?.passes ?? 0;
        const missedLessons = Array.isArray(progressVal?.missedLessons) ? progressVal.missedLessons : [];

        setStats(prev => ({
          rating: ratingVal || prev.rating || '—',
          passes: passesVal ?? prev.passes ?? 0,
          missedLessons: missedLessons.length > 0 ? missedLessons : (prev.missedLessons || []),
          loading: false
        }));
      } catch (err) {
        console.warn('Dashboard secondary data warning:', err);
      }
    }

    function loadDashboardData(forceRefresh = false) {
      fetchSchedule(forceRefresh);
      fetchOtherData(forceRefresh);
    }

    loadDashboardData(false);

    const handlePull = () => {
      loadDashboardData(true);
    };

    window.addEventListener('app-pull-to-refresh', handlePull);

    return () => {
      isMounted = false;
      window.removeEventListener('app-pull-to-refresh', handlePull);
    };
  // Не кладём сюда объект monday: он новый на каждом рендере -> бесконечный цикл запросов/перерисовок
  }, [user, isCollege, mondayISO, scheduleCacheKey, todayISO]);

  const QUICK_ACTIONS = isCollege
    ? [
        { title: 'Расписание', icon: Icons.Calendar, path: '/schedule', color: 'text-primary dark:text-[#4E80EE] bg-primary/10 dark:bg-[#4E80EE]/10' },
        { title: 'Успеваемость', icon: Icons.Award, path: '/grades', color: 'text-secondary dark:text-emerald-400 bg-secondary/10 dark:bg-emerald-400/10' },
        { title: 'Зачётка', icon: Icons.BookOpen, path: '/recordbook', color: 'text-accent dark:text-cyan-400 bg-accent/10 dark:bg-cyan-400/10' },
        { title: 'Почта', icon: Icons.Mail, path: '/mail', color: 'text-violet-500 dark:text-violet-400 bg-violet-500/10 dark:bg-violet-400/10' }
      ]
    : [
        { title: 'Расписание', icon: Icons.Calendar, path: '/schedule', color: 'text-primary dark:text-[#4E80EE] bg-primary/10 dark:bg-[#4E80EE]/10' },
        { title: 'Успеваемость', icon: Icons.Award, path: '/grades', color: 'text-secondary dark:text-emerald-400 bg-secondary/10 dark:bg-emerald-400/10' },
        { title: 'Зачётка', icon: Icons.BookOpen, path: '/recordbook', color: 'text-accent dark:text-cyan-400 bg-accent/10 dark:bg-cyan-400/10' },
        { title: 'Консультации', icon: Icons.HelpCircle, path: '/consultations', color: 'text-amber-500 dark:text-amber-400 bg-amber-500/10 dark:bg-amber-400/10' },
        { title: 'Почта', icon: Icons.Mail, path: '/mail', color: 'text-violet-500 dark:text-violet-400 bg-violet-500/10 dark:bg-violet-400/10' }
      ];

  const handleOpenLink = (url) => {
    try {
      if (window.Capacitor?.isNativePlatform?.()) {
        window.open(url, '_system');
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (_) {
      window.location.href = url;
    }
  };

  return (
    <div className="space-y-6">
      {/* Student Welcome Banner */}
      <div className="bg-gradient-to-r from-primary to-accent dark:from-[#1E6685] dark:to-[#0F2A38] rounded-2xl p-6 text-white shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-semibold px-2.5 py-1 bg-white/20 rounded-full inline-block mb-2">
            {isCollege ? 'Колледж МГЮА' : 'Студент МГЮА'}
          </span>
          <h1 className="text-xl sm:text-2xl font-bold">
            {user?.name || 'Студент'}
          </h1>
          <p className="text-sm text-white/80 mt-1">
            {user?.group ? `Группа ${user.group}` : 'Информация об учебной группе'}
          </p>
        </div>
        <div className="text-left sm:text-right border-t sm:border-t-0 border-white/20 pt-3 sm:pt-0">
          <p className="text-xs text-white/80">Сегодня</p>
          <p className="text-sm font-semibold capitalize">
            {now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
      </div>

      {/* Metrics Row */}
      <section aria-label="Учебная сводка">
        <div className={`grid ${isCollege ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'} gap-3`}>
          <div className="bg-card dark:bg-[#1C2433] p-4 rounded-xl border border-border/40 dark:border-[#283245]/60 flex flex-col justify-between">
            <span className="text-xs text-textMuted dark:text-[#8E98A8]">Курс</span>
            <span className="text-2xl font-bold text-dark dark:text-[#F1F5F9] mt-1">
              {user?.course || '1'}
            </span>
          </div>
          {!isCollege && (
            <div className="bg-card dark:bg-[#1C2433] p-4 rounded-xl border border-border/40 dark:border-[#283245]/60 flex flex-col justify-between">
              <span className="text-xs text-textMuted dark:text-[#8E98A8]">Семестр</span>
              <span className="text-2xl font-bold text-dark dark:text-[#F1F5F9] mt-1">
                {user?.semester || '1'}
              </span>
            </div>
          )}
          <div className="bg-card dark:bg-[#1C2433] p-4 rounded-xl border border-border/40 dark:border-[#283245]/60 flex flex-col justify-between">
            <div className="flex items-center justify-between text-secondary dark:text-emerald-400">
              <span className="text-xs text-textMuted dark:text-[#8E98A8]">
                {isCollege ? 'Средний балл' : 'Рейтинг'}
              </span>
              {isCollege ? <Icons.GraduationCap size={16} /> : <Icons.Award size={16} />}
            </div>
            <span className="text-2xl font-bold text-dark dark:text-[#F1F5F9] mt-1">
              {stats.loading ? '—' : stats.rating}
            </span>
          </div>
          <div
            onClick={isCollege ? () => setShowMissedModal(true) : undefined}
            role={isCollege ? 'button' : undefined}
            tabIndex={isCollege ? 0 : undefined}
            onKeyDown={isCollege ? (e) => (e.key === 'Enter' || e.key === ' ') && setShowMissedModal(true) : undefined}
            className={`bg-card dark:bg-[#1C2433] p-4 rounded-xl border border-border/40 dark:border-[#283245]/60 flex flex-col justify-between ${
              isCollege
                ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-[#232D3F] transition-colors focus:outline-none focus:ring-2 focus:ring-primary dark:focus:ring-[#4E80EE]'
                : ''
            }`}
          >
            <div className="flex items-center justify-between text-rose-500">
              <span className="text-xs text-textMuted dark:text-[#8E98A8]">
                {isCollege ? 'Пропуски' : 'Пропуски (ч)'}
              </span>
              <Icons.Clock size={16} />
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-2xl font-bold text-dark dark:text-[#F1F5F9]">
                {stats.loading ? '—' : stats.passes}
              </span>
              {isCollege && (
                <span className="text-[10px] text-primary dark:text-[#4E80EE] font-medium ml-1">
                  детали →
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Quick Navigation Actions */}
      <section aria-label="Быстрый доступ">
        <h2 className="text-sm font-semibold text-textMuted dark:text-[#8E98A8] uppercase tracking-wider mb-3">
          Быстрый доступ
        </h2>
        <div className={`grid grid-cols-2 ${isCollege ? 'sm:grid-cols-4' : 'sm:grid-cols-5'} gap-3`}>
          {QUICK_ACTIONS.map(action => {
            const Icon = action.icon;
            return (
              <button
                type="button"
                key={action.path}
                onClick={() => navigate(action.path)}
                className="bg-card dark:bg-[#1C2433] p-4 rounded-xl border border-border/40 dark:border-[#283245]/60 hover:bg-slate-50 dark:hover:bg-[#232D3F] transition-all flex flex-col items-center justify-center text-center group active:scale-[0.98]"
              >
                <div className={`p-3 rounded-xl mb-2 group-hover:scale-110 transition-transform ${action.color}`}>
                  <Icon size={22} />
                </div>
                <span className="text-xs font-semibold text-dark dark:text-[#F1F5F9] truncate w-full">
                  {action.title}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Today Schedule Section */}
      <section aria-label="Расписание на сегодня">
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-textMuted dark:text-[#8E98A8] uppercase tracking-wider">
              Расписание на сегодня
            </h2>
            <button
              type="button"
              onClick={() => navigate('/schedule')}
              className="text-xs font-semibold text-primary dark:text-[#4E80EE] hover:underline"
            >
              Всё расписание →
            </button>
          </div>

          {isScheduleLoading ? (
            <div className="bg-card dark:bg-[#1C2433] p-8 rounded-xl border border-border/40 dark:border-[#283245]/60 flex flex-col items-center justify-center text-center">
              <Icons.Loader2 size={24} className="animate-spin text-primary dark:text-[#4E80EE] mb-2" />
              <p className="text-xs text-textMuted dark:text-[#8E98A8]">Загрузка расписания...</p>
            </div>
          ) : scheduleError && scheduleToday.length === 0 ? (
            <div className="bg-card dark:bg-[#1C2433] p-8 rounded-xl border border-border/40 dark:border-[#283245]/60 text-center">
              <Icons.WifiOff size={32} className="mx-auto text-rose-500 mb-2 opacity-80" />
              <h3 className="font-semibold text-dark dark:text-[#F1F5F9] text-sm">Не удалось загрузить расписание</h3>
              <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-0.5">Проверьте подключение и потяните экран вниз, чтобы обновить</p>
            </div>
          ) : scheduleToday.length === 0 ? (
            <div className="bg-card dark:bg-[#1C2433] p-8 rounded-xl border border-border/40 dark:border-[#283245]/60 text-center">
              <Icons.Smile size={32} className="mx-auto text-textMuted dark:text-[#8E98A8] mb-2 opacity-60" />
              <h3 className="font-semibold text-dark dark:text-[#F1F5F9] text-sm">Пар нет</h3>
              <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-0.5">Сегодня учебных занятий не запланировано</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {scheduleToday.map((lesson, idx) => {
                // formatLessonTime сам разбирает start/end, time и номер пары; разделитель — «—»
                const timeStr = formatLessonTime(lesson) || '';
                const [timeStart, timeEnd] = timeStr.split(/\s*[—-]\s*/);
                const room = asText(lesson.auditory) || asText(lesson.room);
                return (
                  <div
                    key={idx}
                    className="bg-card dark:bg-[#1C2433] p-4 rounded-xl border border-border/40 dark:border-[#283245]/60 flex items-start gap-3.5 hover:bg-slate-50 dark:hover:bg-[#232D3F] transition-colors"
                  >
                    <div className="flex flex-col items-center justify-center px-2 py-1 bg-primary/10 dark:bg-[#4E80EE]/10 rounded-lg text-primary dark:text-[#4E80EE] font-semibold text-xs shrink-0 min-w-[58px]">
                      <span>{timeStart || timeStr}</span>
                      <span className="text-[10px] opacity-75">{timeEnd || ''}</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="font-semibold text-dark dark:text-[#F1F5F9] text-sm truncate">
                          {asText(lesson.name) || asText(lesson.discipline) || asText(lesson.subject) || lesson.title || 'Учебное занятие'}
                        </h4>
                        {room && (
                          <span className="text-xs font-medium px-2 py-0.5 bg-bg dark:bg-[#12151B] border border-border/40 dark:border-[#283245]/60 rounded-md text-textMuted dark:text-[#8E98A8] shrink-0">
                            ауд. {room}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-textMuted dark:text-[#8E98A8] min-w-0">
                        {lesson.type && <span className="shrink-0">{asText(lesson.type)}</span>}
                        {lesson.teacher && <span className="truncate min-w-0">• {asText(lesson.teacher)}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal for College Missed Lessons */}
        {isCollege && showMissedModal && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
          >
            <div className="bg-card dark:bg-[#1C2433] rounded-2xl border border-border/60 dark:border-[#283245] w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl overflow-hidden">
              <div className="p-4 border-b border-border/40 dark:border-[#283245] flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500">
                    <Icons.AlertTriangle size={18} />
                  </div>
                  <h3 className="font-bold text-dark dark:text-[#F1F5F9] text-base">Пропущенные занятия</h3>
                </div>
                <button
                  type="button"
                  aria-label="Закрыть"
                  onClick={() => setShowMissedModal(false)}
                  className="p-1.5 rounded-lg text-textMuted hover:text-dark hover:bg-bg dark:hover:bg-[#12151B] transition-colors"
                >
                  <Icons.X size={18} />
                </button>
              </div>

              <div className="p-4 overflow-y-auto flex-1 space-y-2">
                {stats.missedLessons && stats.missedLessons.length > 0 ? (
                  stats.missedLessons.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-bg dark:bg-[#12151B] border border-border/30 dark:border-[#283245]/40 flex items-start justify-between gap-3 text-xs"
                    >
                      <div>
                        <div className="font-semibold text-dark dark:text-[#F1F5F9]">
                          {item.discipline || item.name || 'Занятие'}
                        </div>
                        <div className="text-textMuted dark:text-[#8E98A8] mt-0.5">
                          {/* даты пропусков приходят как DD.MM.YYYY — new Date() даёт Invalid Date */}
                          {parseLessonDate(item.date)?.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) || item.date || ''}
                          {item.type ? ` • ${item.type}` : ''}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-500 font-semibold shrink-0">
                        {item.hours ? `${item.hours} ч` : '2 ч'}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-textMuted dark:text-[#8E98A8]">
                    <Icons.CheckCircle size={32} className="mx-auto text-secondary dark:text-emerald-400 mb-2 opacity-80" />
                    <p className="text-xs">Детализированный список пропусков чист или ещё не загружен.</p>
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-border/40 dark:border-[#283245] bg-bg/50 dark:bg-[#12151B]/50 flex items-center justify-between">
                <span className="text-xs text-textMuted dark:text-[#8E98A8]">Всего пропущено:</span>
                <span className="text-sm font-bold text-rose-500">
                  {stats.passes} {isCollege ? pluralPairs(stats.passes) : 'ч'}
                </span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Footer Support & Source Code Links */}
      <footer aria-label="Ссылки и поддержка" className="pt-2 pb-6 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => handleOpenLink('https://t.me/DarkMSAL_supportbot')}
          className="px-4 py-2.5 rounded-xl bg-card dark:bg-[#1C2433] hover:bg-slate-100 dark:hover:bg-[#232D3F] border border-border/40 dark:border-[#283245]/60 text-xs font-semibold text-textMuted dark:text-[#8E98A8] hover:text-primary dark:hover:text-[#4E80EE] flex items-center space-x-2 transition-all active:scale-[0.98] shadow-sm"
        >
          <Icons.Send size={14} className="text-[#2AABEE]" />
          <span>Поддержка</span>
        </button>

        <button
          type="button"
          onClick={() => handleOpenLink('https://github.com/Dewerro67/MSALKA')}
          className="px-4 py-2.5 rounded-xl bg-card dark:bg-[#1C2433] hover:bg-slate-100 dark:hover:bg-[#232D3F] border border-border/40 dark:border-[#283245]/60 text-xs font-semibold text-textMuted dark:text-[#8E98A8] hover:text-dark dark:hover:text-white flex items-center space-x-2 transition-all active:scale-[0.98] shadow-sm"
        >
          <Icons.Code2 size={14} />
          <span>Исходники</span>
        </button>
      </footer>
    </div>
  );
};
