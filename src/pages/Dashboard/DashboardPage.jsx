import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { lkService, formatISODate, formatLessonTime, getMondayOfWeek } from '../../api';
import { cacheService } from '../../api';

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
    if (Array.isArray(cachedWeek)) {
      const todayItem = cachedWeek.find(day => day.title === todayISO);
      if (todayItem && Array.isArray(todayItem.data)) {
        return todayItem.data;
      }
    }
    return [];
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

  const [news, setNews] = useState(() => {
    const cachedNews = cacheService.get('news_preview') || cacheService.get('news');
    return Array.isArray(cachedNews) ? cachedNews.slice(0, 3) : [];
  });

  // If we already have cached schedule or progress, don't show blocking spinner
  const [isLoading, setIsLoading] = useState(() => {
    const hasCachedSchedule = Boolean(cacheService.get(scheduleCacheKey));
    const hasCachedProgress = Boolean(cacheService.get('progress_with_lessons_latest') || cacheService.get('student_info'));
    return !hasCachedSchedule && !hasCachedProgress;
  });

  // 2. Fetch fresh data in background
  useEffect(() => {
    let isMounted = true;

    async function loadDashboardData(forceRefresh = false) {
      const fetchOpts = { forceRefresh, ttl: 300000 };
      try {
        const [weekSchedule, progressInfo, studentInfoResp, newsData] = await Promise.allSettled([
          lkService.getScheduleWeek(monday, fetchOpts),
          lkService.getProgressWithLessons(user, fetchOpts),
          !isCollege ? lkService.getStudentInfo(fetchOpts) : Promise.resolve({}),
          lkService.getNews(fetchOpts)
        ]);

        if (!isMounted) return;

        // 1. Process today's schedule
        if (weekSchedule.status === 'fulfilled' && Array.isArray(weekSchedule.value)) {
          const todayItem = weekSchedule.value.find(day => day.title === todayISO);
          if (todayItem && Array.isArray(todayItem.data)) {
            setScheduleToday(todayItem.data);
          } else {
            setScheduleToday([]);
          }
        }

        // 2. Process rating/GPA and absences
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

        // 3. Process news
        if (newsData.status === 'fulfilled' && Array.isArray(newsData.value)) {
          setNews(newsData.value.slice(0, 3));
        }
      } catch (err) {
        console.warn('Dashboard load warning:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadDashboardData();

    const handlePullRefresh = () => {
      loadDashboardData(true);
    };

    window.addEventListener('app-pull-to-refresh', handlePullRefresh);

    return () => {
      isMounted = false;
      window.removeEventListener('app-pull-to-refresh', handlePullRefresh);
    };
  }, [user, isCollege]);

  const ALL_QUICK_ACTIONS = [
    { label: 'Расписание', icon: Icons.Calendar, path: '/schedule', color: 'bg-primary' },
    { label: 'Оценки', icon: Icons.GraduationCap, path: '/grades', color: 'bg-secondary' },
    { label: 'Зачётка', icon: Icons.BookOpen, path: '/recordbook', color: 'bg-teal-700' },
    { label: 'Отработки', icon: Icons.UserCheck, path: '/consultations', color: 'bg-accent' }
  ];

  const QUICK_ACTIONS = isCollege
    ? ALL_QUICK_ACTIONS.filter(action => action.path !== '/consultations')
    : ALL_QUICK_ACTIONS;

  const handleLessonAction = (lesson) => {
    if (lesson.isConsultation) {
      navigate('/consultations');
    } else {
      navigate('/schedule', { state: { targetDate: todayISO } });
    }
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-300">
        {/* Profile Card & Avatar */}
        <div className="bg-surface dark:bg-[#1C2433] rounded-2xl p-5 border border-border/40 dark:border-[#283245]/60 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-primary dark:text-[#4E80EE] uppercase tracking-wider">
              {isCollege ? 'Колледж МГЮА' : 'Студент МГЮА'}
            </span>
            <h1 className="text-xl font-bold text-text dark:text-[#F1F5F9]">
              {user?.fio || user?.name || 'Студент'}
            </h1>
            <p className="text-xs text-textMuted dark:text-[#8E98A8]">
              {user?.group || user?.groupName ? `Группа ${user.group || user.groupName}` : ''}
              {user?.course ? ` • ${user.course} курс` : ''}
              {user?.faculty ? ` • ${user.faculty}` : ''}
            </p>
          </div>
          <div className="w-12 h-12 rounded-full bg-primary/10 dark:bg-primary/20 text-primary dark:text-[#4E80EE] flex items-center justify-center font-bold text-lg border border-primary/20">
            {(user?.fio || user?.name || 'С')[0]}
          </div>
        </div>

        {/* Stats Row */}
        <div className={`grid ${isCollege ? 'grid-cols-3' : 'grid-cols-4'} gap-3`}>
          <div className="bg-surface dark:bg-[#1C2433] p-4 rounded-xl border border-border/40 dark:border-[#283245]/60 flex flex-col justify-between">
            <span className="text-xs text-textMuted dark:text-[#8E98A8]">Курс</span>
            <span className="text-2xl font-bold text-text dark:text-[#F1F5F9] mt-1">
              {user?.course || '1'}
            </span>
          </div>
          {!isCollege && (
            <div className="bg-surface dark:bg-[#1C2433] p-4 rounded-xl border border-border/40 dark:border-[#283245]/60 flex flex-col justify-between">
              <span className="text-xs text-textMuted dark:text-[#8E98A8]">Семестр</span>
              <span className="text-2xl font-bold text-text dark:text-[#F1F5F9] mt-1">
                {user?.semester || '1'}
              </span>
            </div>
          )}
          <div className="bg-surface dark:bg-[#1C2433] p-4 rounded-xl border border-border/40 dark:border-[#283245]/60 flex flex-col justify-between">
            <div className="flex items-center justify-between text-secondary dark:text-emerald-400">
              <span className="text-xs text-textMuted dark:text-[#8E98A8]">
                {isCollege ? 'Средний балл' : 'Рейтинг'}
              </span>
              {isCollege ? <Icons.GraduationCap size={16} /> : <Icons.Award size={16} />}
            </div>
            <span className="text-2xl font-bold text-text dark:text-[#F1F5F9] mt-1">
              {stats.loading ? '—' : stats.rating}
            </span>
          </div>
          <div
            onClick={isCollege ? () => setShowMissedModal(true) : undefined}
            role={isCollege ? 'button' : undefined}
            tabIndex={isCollege ? 0 : undefined}
            onKeyDown={isCollege ? (e) => (e.key === 'Enter' || e.key === ' ') && setShowMissedModal(true) : undefined}
            className={`bg-surface dark:bg-[#1C2433] p-4 rounded-xl border border-border/40 dark:border-[#283245]/60 flex flex-col justify-between transition-all ${
              isCollege
                ? 'cursor-pointer hover:border-accent/40 active:scale-[0.98]'
                : ''
            }`}
          >
            <div className="flex items-center justify-between text-accent">
              <span className="text-xs text-textMuted dark:text-[#8E98A8]">
                {isCollege ? 'Пропуски' : 'Пропуски (ч)'}
              </span>
              <Icons.Clock size={16} />
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-2xl font-bold text-text dark:text-[#F1F5F9]">
                {stats.loading ? '0' : stats.passes}
              </span>
              {isCollege && (
                <span className="text-[10px] text-accent font-medium">детали</span>
              )}
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div>
          <h2 className="text-sm font-semibold text-textMuted dark:text-[#8E98A8] mb-3 uppercase tracking-wider">
            Быстрый доступ
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {QUICK_ACTIONS.map(action => {
              const IconComponent = action.icon;
              return (
                <button
                  key={action.path}
                  onClick={() => navigate(action.path)}
                  className="flex items-center p-3 bg-surface dark:bg-[#1C2433] rounded-xl border border-border/40 dark:border-[#283245]/60 hover:bg-slate-50 dark:hover:bg-[#232D3F] transition-all text-left group active:scale-[0.98]"
                >
                  <div className={`w-10 h-10 rounded-lg ${action.color} flex items-center justify-center text-white mr-3 shrink-0 group-hover:scale-105 transition-transform`}>
                    <IconComponent size={20} />
                  </div>
                  <span className="font-semibold text-sm text-text dark:text-[#F1F5F9]">
                    {action.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Today's Schedule */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-textMuted dark:text-[#8E98A8] uppercase tracking-wider">
              Занятия на сегодня
            </h2>
            <button
              onClick={() => navigate('/schedule')}
              className="text-xs font-semibold text-primary dark:text-[#4E80EE] hover:underline"
            >
              Вся неделя →
            </button>
          </div>

          {isLoading ? (
            <div className="bg-surface dark:bg-[#1C2433] rounded-2xl p-8 border border-border/40 dark:border-[#283245]/60 text-center">
              <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
              <p className="text-xs text-textMuted dark:text-[#8E98A8]">Синхронизация с расписанием...</p>
            </div>
          ) : scheduleToday.length === 0 ? (
            <div className="bg-surface dark:bg-[#1C2433] rounded-2xl p-8 border border-border/40 dark:border-[#283245]/60 text-center">
              <Icons.Coffee className="w-8 h-8 text-secondary dark:text-emerald-400 mx-auto mb-2 opacity-80" />
              <h3 className="font-semibold text-text dark:text-[#F1F5F9] text-sm">Пар на сегодня нет</h3>
              <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1">Отличный день для отдыха или самостоятельной подготовки!</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {scheduleToday.map((lesson, idx) => {
                const timeString = formatLessonTime(lesson);
                return (
                  <div
                    key={lesson.id || idx}
                    onClick={() => handleLessonAction(lesson)}
                    className="bg-surface dark:bg-[#1C2433] p-4 rounded-xl border border-border/40 dark:border-[#283245]/60 hover:border-primary/40 dark:hover:border-primary/30 transition-all cursor-pointer flex items-start gap-3.5 group active:scale-[0.99]"
                  >
                    <div className="w-1.5 self-stretch rounded-full bg-primary dark:bg-[#4E80EE] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-primary dark:text-[#4E80EE]">
                          {timeString || 'Пара'}
                        </span>
                        {lesson.classroom && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#151B26] text-textMuted dark:text-[#8E98A8]">
                            ауд. {lesson.classroom}
                          </span>
                        )}
                      </div>
                      <h4 className="font-semibold text-text dark:text-[#F1F5F9] text-sm mt-1 truncate group-hover:text-primary dark:group-hover:text-[#4E80EE] transition-colors">
                        {lesson.title || lesson.discipline || 'Занятие'}
                      </h4>
                      <div className="flex items-center gap-3 mt-1 text-xs text-textMuted dark:text-[#8E98A8]">
                        {lesson.type && <span>{lesson.type}</span>}
                        {lesson.teacher && <span className="truncate">• {lesson.teacher}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* News Feed Preview */}
        {news.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-textMuted dark:text-[#8E98A8] uppercase tracking-wider">
                Новости университета
              </h2>
              <button
                onClick={() => navigate('/news')}
                className="text-xs font-semibold text-primary dark:text-[#4E80EE] hover:underline"
              >
                Все новости →
              </button>
            </div>
            <div className="space-y-2.5">
              {news.map((item, idx) => (
                <div
                  key={item.id || idx}
                  onClick={() => navigate('/news')}
                  className="bg-surface dark:bg-[#1C2433] p-4 rounded-xl border border-border/40 dark:border-[#283245]/60 hover:bg-slate-50 dark:hover:bg-[#232D3F] transition-all cursor-pointer active:scale-[0.99]"
                >
                  <h4 className="font-semibold text-text dark:text-[#F1F5F9] text-sm line-clamp-1">
                    {item.title || item.header}
                  </h4>
                  <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1 line-clamp-2">
                    {item.preview || item.content || item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

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
            <div className="bg-surface dark:bg-[#1C2433] rounded-2xl border border-border/60 dark:border-[#283245] w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl overflow-hidden">
              <div className="p-4 border-b border-border/40 dark:border-[#283245] flex items-center justify-between bg-slate-50/50 dark:bg-[#151B26]/50">
                <div className="flex items-center gap-2 text-accent">
                  <Icons.AlertTriangle size={18} />
                  <h3 className="font-bold text-text dark:text-[#F1F5F9]">
                    Пропущенные занятия ({stats.missedLessons?.length || 0})
                  </h3>
                </div>
                <button
                  onClick={() => setShowMissedModal(false)}
                  className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-[#283245] text-textMuted transition-colors"
                >
                  <Icons.X size={18} />
                </button>
              </div>

              <div className="p-4 overflow-y-auto flex-1 space-y-2.5">
                {(!stats.missedLessons || stats.missedLessons.length === 0) ? (
                  <div className="text-center py-8">
                    <Icons.CheckCircle2 className="w-10 h-10 text-secondary dark:text-emerald-400 mx-auto mb-2 opacity-80" />
                    <p className="text-sm font-semibold text-text dark:text-[#F1F5F9]">Пропусков не обнаружено</p>
                    <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1">Отличная посещаемость в текущем семестре!</p>
                  </div>
                ) : (
                  stats.missedLessons.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-slate-50 dark:bg-[#151B26] rounded-xl border border-border/30 dark:border-[#283245]/40 flex flex-col gap-1 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-text dark:text-[#F1F5F9] text-sm">
                          {item.discipline}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-accent/10 text-accent font-semibold text-[11px]">
                          {item.date}
                        </span>
                      </div>
                      {item.teacher && (
                        <span className="text-textMuted dark:text-[#8E98A8]">
                          Преподаватель: {item.teacher}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="p-3 border-t border-border/40 dark:border-[#283245] bg-slate-50/50 dark:bg-[#151B26]/50 text-right">
                <button
                  onClick={() => setShowMissedModal(false)}
                  className="px-4 py-2 bg-primary text-white text-xs font-semibold rounded-xl hover:bg-primary/90 transition-all"
                >
                  Понятно
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
};
