import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { lkService, cacheService, formatLessonTime, formatDisplayDate } from '../../api';
import { Card } from '../../components/common/Card';
import { Badge } from '../../components/common/Badge';
import { Icons } from '../../components/common/Icons';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';

function getPairWord(count) {
  const n = Math.abs(Number(count) || 0) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return 'пар';
  if (n1 > 1 && n1 < 5) return 'пары';
  if (n1 === 1) return 'пара';
  return 'пар';
}

export const DashboardPage = () => {
  const navigate = useNavigate();
  const { user, isCollege } = useAuth();

  const now = new Date();
  const todayISO = now.toISOString().split('T')[0];

  // Current calendar week (Monday to Sunday)
  const currentDay = now.getDay();
  const distanceToMonday = currentDay === 0 ? -6 : 1 - currentDay;
  const monday = new Date(now);
  monday.setDate(now.getDate() + distanceToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const mondayISO = monday.toISOString().split('T')[0];
  const sundayISO = sunday.toISOString().split('T')[0];
  const scheduleCacheKey = `schedule_${mondayISO}_${sundayISO}`;

  // 1. Instant Cache-First State Initialization
  const [scheduleToday, setScheduleToday] = useState(() => {
    const cachedWeek = cacheService.get(scheduleCacheKey);
    if (Array.isArray(cachedWeek) && cachedWeek.length > 0) {
      const todayItem = cachedWeek.find(day => day.title === todayISO);
      if (todayItem && Array.isArray(todayItem.data)) return todayItem.data;
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

    async function loadDashboardData() {
      try {
        const [weekSchedule, progressInfo, studentInfoResp, newsData] = await Promise.allSettled([
          lkService.getScheduleWeek(monday),
          lkService.getProgressWithLessons(user),
          !isCollege ? lkService.getStudentInfo() : Promise.resolve({}),
          lkService.getNews()
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
      cacheService.remove(scheduleCacheKey);
      cacheService.remove('student_info');
      cacheService.remove('progress_with_lessons_latest');
      cacheService.remove('news_preview');
      loadDashboardData();
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
    ? ALL_QUICK_ACTIONS.filter(item => item.path !== '/consultations')
    : ALL_QUICK_ACTIONS;

  const displayName = typeof user?.name === 'string' && user.name.trim()
    ? (user.name.split(' ')[1] || user.name.split(' ')[0])
    : 'Студент';

  const displayRating = typeof stats.rating === 'object' ? '—' : String(stats.rating ?? '—');
  const displayPasses = typeof stats.passes === 'object' ? (stats.passes?.total ?? 0) : Number(stats.passes ?? 0);

  return (
    <div className="space-y-6 pb-6">
      {/* Greeting Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-textMuted">
            {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="text-2xl font-black text-dark mt-0.5">
            Привет, {displayName} 👋
          </h1>
          <p className="text-xs text-textMuted mt-1">
            {user?.department || user?.faculty || 'МГЮА им. О.Е. Кутафина'} • {user?.group || user?.role || ''}
          </p>
        </div>
      </div>

      {/* Quick Action Navigation */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-textMuted mb-3">
          Быстрый доступ
        </h3>
        <div className={`grid ${isCollege ? 'grid-cols-3' : 'grid-cols-4'} gap-3`}>
          {QUICK_ACTIONS.map(action => {
            const Icon = action.icon;
            return (
              <button
                key={action.path}
                onClick={() => navigate(action.path)}
                className="flex flex-col items-center justify-center p-3 rounded-2xl bg-card border border-border dark:border-[#2B3242] hover:border-accent dark:hover:border-[#38BDF8] hover:shadow-sm transition-all text-center group"
              >
                <div className={`w-10 h-10 rounded-xl ${action.color} text-white flex items-center justify-center mb-2 shadow-sm group-hover:scale-105 transition-transform`}>
                  <Icon size={20} />
                </div>
                <span className="text-xs font-bold text-dark">{action.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Academic Highlights: Student Rating & Passes */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <Card className="p-3.5 sm:p-4 flex items-center space-x-3 border border-border dark:border-[#2B3242]">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary dark:text-[#38BDF8] flex items-center justify-center shrink-0">
            {isCollege ? <Icons.GraduationCap size={22} /> : <Icons.Award size={22} />}
          </div>
          <div className="min-w-0">
            <p className="text-xs text-textMuted dark:text-[#8E98A8] font-medium truncate">
              {isCollege ? 'Средний балл' : 'Рейтинг'}
            </p>
            <h4 className="text-lg sm:text-xl font-black text-dark dark:text-white mt-0.5 truncate">
              {stats.loading ? '—' : displayRating}
            </h4>
          </div>
        </Card>

        {/* Absences Card: for College, counts missed pairs strictly and opens details popup */}
        <Card
          onClick={isCollege ? () => setShowMissedModal(true) : undefined}
          role={isCollege ? 'button' : undefined}
          tabIndex={isCollege ? 0 : undefined}
          onKeyDown={isCollege ? (e) => (e.key === 'Enter' || e.key === ' ') && setShowMissedModal(true) : undefined}
          className={`p-3.5 sm:p-4 flex items-center space-x-3 border border-border dark:border-[#2B3242] ${
            isCollege
              ? 'cursor-pointer hover:border-accent dark:hover:border-[#38BDF8] hover:shadow-md transition-all active:scale-[0.98]'
              : ''
          }`}
        >
          <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent dark:text-[#38BDF8] flex items-center justify-center shrink-0">
            <Icons.Clock size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <p className="text-xs text-textMuted dark:text-[#8E98A8] font-medium truncate">
                {isCollege ? 'Пропущенные пары' : 'Пропуски (акад. ч)'}
              </p>
              {isCollege && (
                <span className="text-[10px] text-accent dark:text-[#38BDF8] font-semibold hidden sm:inline ml-1">
                  список →
                </span>
              )}
            </div>
            <h4 className="text-lg sm:text-xl font-black text-dark dark:text-white mt-0.5 truncate">
              {stats.loading ? '—' : displayPasses}
            </h4>
          </div>
        </Card>
      </div>

      {/* Modal / Popup with Missed Pairs for College */}
      {isCollege && showMissedModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setShowMissedModal(false)}
        >
          <div
            className="bg-card dark:bg-[#1F2430] border border-border dark:border-[#2B3242] rounded-2xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-scale-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-border dark:border-[#2B3242] flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-accent/10 text-accent dark:text-[#38BDF8] flex items-center justify-center">
                  <Icons.Clock size={18} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-dark dark:text-white">Пропущенные пары</h3>
                  <p className="text-xs text-textMuted dark:text-[#8E98A8]">
                    Всего: {displayPasses} {getPairWord(displayPasses)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowMissedModal(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-textMuted hover:text-dark dark:text-[#8E98A8] dark:hover:text-white hover:bg-bg dark:hover:bg-[#181C26] transition-colors"
              >
                <Icons.X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4 sm:p-5 overflow-y-auto space-y-2.5 flex-1">
              {stats.loading ? (
                <div className="py-8">
                  <LoadingSpinner size={8} text="Загрузка пропущенных пар..." />
                </div>
              ) : stats.missedLessons && stats.missedLessons.length > 0 ? (
                stats.missedLessons.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-bg dark:bg-[#181C26] border border-border dark:border-[#2B3242] flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <h4 className="font-bold text-xs sm:text-sm text-dark dark:text-white leading-tight">
                        {item.discipline}
                      </h4>
                      {item.teacher && (
                        <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1 truncate">
                          {item.teacher}
                        </p>
                      )}
                      {item.subgroup > 0 && (
                        <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-card dark:bg-[#1F2430] border border-border dark:border-[#2B3242] text-textMuted dark:text-[#8E98A8]">
                          Подгруппа {item.subgroup}
                        </span>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="inline-block px-2.5 py-1 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 font-bold text-xs">
                        {item.date}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8">
                  <div className="w-14 h-14 rounded-full bg-emerald-500/10 text-emerald-500 mx-auto flex items-center justify-center mb-3">
                    <Icons.Check size={28} />
                  </div>
                  <h4 className="font-bold text-base text-dark dark:text-white">Пропусков нет!</h4>
                  <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1">
                    Отличная посещаемость, ни одного пропуска занятий 🎉
                  </p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3.5 bg-bg/50 dark:bg-[#181C26]/50 border-t border-border dark:border-[#2B3242] text-right">
              <button
                onClick={() => setShowMissedModal(false)}
                className="px-4 py-1.5 rounded-xl bg-primary dark:bg-[#1E6685] text-white text-xs font-bold hover:opacity-90 transition-opacity"
              >
                Понятно
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Today Schedule Preview */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-textMuted">
            Занятия на сегодня
          </h3>
          <button
            onClick={() => navigate('/schedule')}
            className="text-xs font-bold text-secondary hover:underline"
          >
            Все занятия →
          </button>
        </div>

        {isLoading ? (
          <Card className="p-8 text-center">
            <LoadingSpinner size={8} text="Загрузка занятий..." />
          </Card>
        ) : scheduleToday.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-accent/10 mx-auto flex items-center justify-center text-accent mb-3">
              <Icons.Calendar size={24} />
            </div>
            <h4 className="text-base font-bold text-dark">Сегодня занятий нет</h4>
            <p className="text-xs text-textMuted mt-1">Отличный день для подготовки или отдыха!</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {scheduleToday.map((lesson, idx) => {
              const disciplineTitle = typeof (lesson.discipline || lesson.subject) === 'object'
                ? JSON.stringify(lesson.discipline || lesson.subject)
                : String(lesson.discipline || lesson.subject || 'Занятие');

              return (
                <Card key={lesson.id || idx} className="p-4 sm:p-5 hover:border-accent transition-colors overflow-hidden w-full min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2 w-full min-w-0">
                    <div className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary font-bold text-xs sm:text-sm shrink-0">
                      {formatLessonTime(lesson) || "Пара"}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5 min-w-0 max-w-[60%] sm:max-w-none">
                      {lesson.type && (
                        <Badge 
                          type={lesson.type.toLowerCase().includes('лек') ? 'info' : 'secondary'}
                          className="shrink-0 text-xs"
                        >
                          {lesson.type}
                        </Badge>
                      )}
                      {lesson.corps && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-bg text-textMuted border border-border shrink-0">
                          {lesson.corps}
                        </span>
                      )}
                    </div>
                  </div>

                  <h4 className="font-bold text-base sm:text-lg text-dark mb-1 break-words">
                    {disciplineTitle}
                  </h4>

                  <div className="flex flex-wrap items-center justify-between text-xs text-textMuted pt-2 border-t border-border mt-3 gap-2">
                    <span className="text-secondary font-semibold">
                      {lesson.auditory ? `Ауд. ${lesson.auditory}` : 'Аудитория уточняется'}
                    </span>
                    <span>
                      {lesson.teacher || 'Преподаватель кафедры'}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* News Preview */}
      {news.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-textMuted">
              Новости Университета
            </h3>
            <button
              onClick={() => navigate('/news')}
              className="text-xs font-bold text-secondary hover:underline"
            >
              Все новости →
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {news.map((item, idx) => (
              <Card
                key={item.id || idx}
                onClick={() => navigate(`/news/${item.id || idx}`)}
                className="p-4 hover:border-accent transition-all cursor-pointer flex flex-col justify-between"
              >
                <div>
                  <span className="text-[10px] font-bold text-textMuted uppercase tracking-wider">
                    {formatDisplayDate(item.date || item.created_at)}
                  </span>
                  <h4 className="font-bold text-sm text-dark mt-1 line-clamp-2">
                    {item.title}
                  </h4>
                  {item.preview && (
                    <p className="text-xs text-textMuted mt-1 line-clamp-2">
                      {item.preview}
                    </p>
                  )}
                </div>
                <div className="mt-3 text-xs font-bold text-accent flex items-center">
                  Читать далее →
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
