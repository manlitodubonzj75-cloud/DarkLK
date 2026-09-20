import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { lkService, formatISODate, getMondayOfWeek, formatLessonTime, cacheService } from '../../api';
import { Card } from '../../components/common/Card';
import { Badge } from '../../components/common/Badge';
import { Icons } from '../../components/common/Icons';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';

export const DashboardPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const todayISO = formatISODate(new Date());
  const monday = getMondayOfWeek(new Date());
  const mondayISO = formatISODate(monday);
  const sundayDate = new Date(monday);
  sundayDate.setDate(monday.getDate() + 6);
  const sundayISO = formatISODate(sundayDate);
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
    const ratingVal = cachedStudentInfo?.reting ?? cachedStudentInfo?.rating ?? cachedProgress?.studentInfo?.reting ?? cachedProgress?.rating ?? '—';
    const passesVal = cachedProgress?.passes ?? cachedStudentInfo?.passes ?? 0;
    return {
      rating: ratingVal,
      passes: passesVal,
      loading: !cachedStudentInfo && !cachedProgress
    };
  });

  const [news, setNews] = useState(() => {
    const cachedNews = cacheService.get('news_preview') || cacheService.get('news');
    return Array.isArray(cachedNews) ? cachedNews.slice(0, 3) : [];
  });

  // If we already have cached schedule or progress, don't show blocking spinner
  const [isLoading, setIsLoading] = useState(() => {
    const cachedWeek = cacheService.get(scheduleCacheKey);
    return !Array.isArray(cachedWeek) || cachedWeek.length === 0;
  });

  useEffect(() => {
    let isMounted = true;

    async function loadDashboardData() {
      try {
        const [weekSchedule, progressInfo, studentInfoResp, newsData] = await Promise.allSettled([
          lkService.getScheduleWeek(monday),
          lkService.getProgressWithLessons(user),
          lkService.getStudentInfo(),
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

        // 2. Process rating and absences (replacing GPA on dashboard as requested)
        const studentInfo = studentInfoResp.status === 'fulfilled' ? studentInfoResp.value : null;
        const progressVal = progressInfo.status === 'fulfilled' ? progressInfo.value : null;
        const ratingVal = studentInfo?.reting ?? studentInfo?.rating ?? progressVal?.studentInfo?.reting ?? progressVal?.rating ?? '—';
        const passesVal = progressVal?.passes ?? studentInfo?.passes ?? 0;

        setStats({
          rating: ratingVal,
          passes: passesVal,
          loading: false
        });

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
      cacheService.remove("student_info");
      cacheService.remove("progress_with_lessons_latest");
      cacheService.remove("news_preview");
      loadDashboardData();
    };

    window.addEventListener("app-pull-to-refresh", handlePullRefresh);

    return () => {
      isMounted = false;
      window.removeEventListener("app-pull-to-refresh", handlePullRefresh);
    };
  }, [user]);

  const QUICK_ACTIONS = [
    { label: 'Расписание', icon: Icons.Calendar, path: '/schedule', color: 'bg-primary' },
    { label: 'Оценки', icon: Icons.GraduationCap, path: '/grades', color: 'bg-secondary' },
    { label: 'Зачётка', icon: Icons.BookOpen, path: '/recordbook', color: 'bg-teal-700' },
    { label: 'Отработки', icon: Icons.UserCheck, path: '/consultations', color: 'bg-accent' }
  ];

  return (
    <div className="space-y-6 pb-6">
      {/* Greeting Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-textMuted">
            {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="text-2xl font-black text-dark mt-0.5">
            Привет, {user?.name ? user.name.split(' ')[1] || user.name.split(' ')[0] : 'Студент'} 👋
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
        <div className="grid grid-cols-4 gap-3">
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
            <Icons.Award size={22} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-textMuted dark:text-[#8E98A8] font-medium truncate">Рейтинг</p>
            <h4 className="text-lg sm:text-xl font-black text-dark dark:text-white mt-0.5 truncate">
              {stats.loading ? '—' : stats.rating}
            </h4>
          </div>
        </Card>

        <Card className="p-3.5 sm:p-4 flex items-center space-x-3 border border-border dark:border-[#2B3242]">
          <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent dark:text-[#38BDF8] flex items-center justify-center shrink-0">
            <Icons.Clock size={22} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-textMuted dark:text-[#8E98A8] font-medium truncate">Пропуски (акад. ч)</p>
            <h4 className="text-lg sm:text-xl font-black text-dark dark:text-white mt-0.5 truncate">
              {stats.loading ? '—' : stats.passes}
            </h4>
          </div>
        </Card>
      </div>

      {/* Today's Classes */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-textMuted">
            Расписание на сегодня
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
            {scheduleToday.map((lesson, idx) => (
              <Card key={lesson.id || idx} className="p-4 sm:p-5 hover:border-accent transition-colors overflow-hidden w-full min-w-0">
                {/* Header: Time badge on left, Lesson Type & Corps on right */}
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2 w-full min-w-0">
                  <div className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary font-bold text-xs sm:text-sm shrink-0">
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
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-bg text-textMuted border border-border shrink-0">
                        {lesson.corps}
                      </span>
                    )}
                  </div>
                </div>

                {/* Body: Full-width discipline title, no horizontal squishing or offset */}
                <h4 className="text-base sm:text-lg font-bold text-dark leading-snug break-words">
                  {lesson.discipline || lesson.subject}
                </h4>

                {/* Footer: Auditory & Teacher */}
                {(lesson.auditory || lesson.teacher) && (
                  <div className="mt-3 pt-2.5 border-t border-border flex flex-wrap items-center justify-between gap-2 text-xs text-textMuted">
                    {lesson.auditory && (
                      <span className="font-semibold text-dark">
                        Аудитория: {lesson.auditory}
                      </span>
                    )}
                    {lesson.teacher && (
                      <div className="flex items-center space-x-1 text-secondary font-medium">
                        <Icons.User size={14} />
                        <span>{lesson.teacher}</span>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* University News Feed */}
      {news.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-textMuted mb-3">
            Новости университета
          </h3>
          <div className="space-y-3">
            {news.map((item, idx) => (
              <Card key={item.id || idx} className="p-4">
                <h4 className="text-sm font-bold text-dark">{item.title || item.name}</h4>
                {item.date && <span className="text-[11px] text-textMuted">{item.date}</span>}
                {item.preview && <p className="text-xs text-textMuted mt-1 leading-relaxed">{item.preview}</p>}
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
