import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  lkService,
  formatISODate,
  getMondayOfWeek,
  formatLessonTime,
  cacheService
} from '../../api';
import { Card } from '../../components/common/Card';
import { Badge } from '../../components/common/Badge';
import { Icons } from '../../components/common/Icons';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';

function extractTodayLessons(scheduleList, todayISO) {
  if (!Array.isArray(scheduleList) || scheduleList.length === 0) return null;
  const todayItem = scheduleList.find(day => day.title === todayISO);
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
    let ratingVal = cachedStudentInfo?.reting ?? cachedStudentInfo?.rating ?? user?.rating ?? user?.reting ?? cachedProgress?.studentInfo?.reting ?? cachedProgress?.rating;
    if ((ratingVal === undefined || ratingVal === null || ratingVal === '—') && cachedProgress?.gpa && cachedProgress.gpa !== '—') {
      ratingVal = cachedProgress.gpa;
    }
    if (!ratingVal) ratingVal = '—';
    const passesVal = cachedProgress?.passes ?? cachedStudentInfo?.passes ?? user?.passes ?? 0;
    const missedLessons = Array.isArray(cachedProgress?.missedLessons) ? cachedProgress.missedLessons : [];

    return {
      rating: ratingVal,
      passes: passesVal,
      missedLessons,
      loading: ratingVal === '—'
    };
  });

  const [showMissedModal, setShowMissedModal] = useState(false);

  // 2. Fetch fresh data in background (decoupled for instant schedule render)
  useEffect(() => {
    let isMounted = true;

    async function fetchSchedule(forceRefresh = false) {
      try {
        const weekSchedule = await lkService.getScheduleWeek(monday, { forceRefresh, ttl: 300000 });
        if (!isMounted) return;
        const lessons = extractTodayLessons(weekSchedule, todayISO);
        if (lessons !== null) {
          setScheduleToday(lessons);
        }
      } catch (err) {
        console.warn('[Dashboard] Schedule load warning:', err.message);
        if (!isMounted) return;
        const cachedWeek = cacheService.get(scheduleCacheKey);
        const lessons = extractTodayLessons(cachedWeek, todayISO);
        if (lessons !== null) {
          setScheduleToday(lessons);
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

        // Process rating/GPA and absences with persistent cache fallback
        const studentInfo = (studentInfoResp.status === 'fulfilled' && studentInfoResp.value)
          ? studentInfoResp.value
          : (cacheService.get('student_info') || {});

        const progressVal = (progressInfo.status === 'fulfilled' && progressInfo.value)
          ? progressInfo.value
          : (cacheService.get('progress_with_lessons_latest') || null);

        let ratingVal = studentInfo?.reting ?? studentInfo?.rating ?? user?.rating ?? user?.reting ?? progressVal?.studentInfo?.reting ?? progressVal?.rating;
        if ((ratingVal === undefined || ratingVal === null || ratingVal === '—') && progressVal?.gpa && progressVal.gpa !== '—') {
          ratingVal = progressVal.gpa;
        }
        const passesVal = progressVal?.passes ?? studentInfo?.passes ?? user?.passes ?? 0;
        const missedLessons = Array.isArray(progressVal?.missedLessons) ? progressVal.missedLessons : [];

        setStats(prev => ({
          rating: (ratingVal && ratingVal !== '—') ? ratingVal : (prev.rating !== '—' ? prev.rating : ratingVal || '—'),
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
  }, [user, isCollege, monday, scheduleCacheKey, todayISO]);

  const QUICK_ACTIONS = isCollege
    ? [
        { title: 'Расписание', icon: Icons.Calendar, to: '/schedule', color: 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20' },
        { title: 'Оценки', icon: Icons.GraduationCap, to: '/grades', color: 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20' },
        { title: 'Зачётка', icon: Icons.BookOpen, to: '/recordbook', color: 'bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20' },
        { title: 'Почта MSAL', icon: Icons.Mail, to: '/mail', color: 'bg-sky-500/10 text-sky-500 hover:bg-sky-500/20' },
        { title: 'Настройки', icon: Icons.Settings, to: '/settings', color: 'bg-purple-500/10 text-purple-500 hover:bg-purple-500/20' },
      ]
    : [
        { title: 'Расписание', icon: Icons.Calendar, to: '/schedule', color: 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20' },
        { title: 'Оценки', icon: Icons.GraduationCap, to: '/grades', color: 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20' },
        { title: 'Зачётка', icon: Icons.BookOpen, to: '/recordbook', color: 'bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20' },
        { title: 'Почта MSAL', icon: Icons.Mail, to: '/mail', color: 'bg-sky-500/10 text-sky-500 hover:bg-sky-500/20' },
        { title: 'Отработки', icon: Icons.UserCheck, to: '/consultations', color: 'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20' },
        { title: 'Настройки', icon: Icons.Settings, to: '/settings', color: 'bg-purple-500/10 text-purple-500 hover:bg-purple-500/20' },
      ];

  return (
    <div className="space-y-6">
      {/* Welcome Card */}
      <div className="bg-gradient-to-r from-primary to-accent rounded-3xl p-6 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 opacity-10 flex items-center pr-6 pointer-events-none">
          <Icons.GraduationCap size={160} />
        </div>
        <div className="relative z-10">
          <Badge variant="accent" className="bg-white/20 text-white border-0 mb-3 px-3 py-1">
            Личный кабинет • {isCollege ? 'Колледж' : 'Бакалавриат / Специалитет'}
          </Badge>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight mb-2 text-white">
            Привет, {user?.name?.split(' ')[1] || user?.name || 'студент'}! 👋
          </h1>
          <p className="text-white/80 text-sm max-w-lg">
            Группа <span className="font-semibold text-white">{user?.group || '—'}</span> • {user?.course ? `${user.course} курс` : 'Студент МГЮА'}
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="flex items-center space-x-3 p-4">
          <div className="w-10 h-10 rounded-2xl bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
            <Icons.Layers size={20} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-textMuted dark:text-[#8E98A8] font-medium">Курс</p>
            <p className="text-lg font-bold text-dark dark:text-white truncate">
              {user?.course || '—'}
            </p>
          </div>
        </Card>

        <Card className="flex items-center space-x-3 p-4">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
            <Icons.Award size={20} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-textMuted dark:text-[#8E98A8] font-medium">Семестр</p>
            <p className="text-lg font-bold text-dark dark:text-white truncate">
              {user?.semester || '—'}
            </p>
          </div>
        </Card>

        <Card className="flex items-center space-x-3 p-4">
          <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center shrink-0">
            <Icons.Star size={20} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-textMuted dark:text-[#8E98A8] font-medium">
              {isCollege ? 'Ср. балл' : 'Рейтинг'}
            </p>
            <p className="text-lg font-bold text-dark dark:text-white truncate">
              {stats.loading ? '...' : (stats.rating !== '—' && stats.rating !== undefined && stats.rating !== null ? stats.rating : '—')}
            </p>
          </div>
        </Card>

        <Card
          onClick={() => {
            if (stats.missedLessons.length > 0) setShowMissedModal(true);
          }}
          className={`flex items-center space-x-3 p-4 transition-all ${
            stats.missedLessons.length > 0
              ? 'cursor-pointer hover:border-amber-500/40 hover:bg-amber-500/5 active:scale-[0.98]'
              : ''
          }`}
          title={stats.missedLessons.length > 0 ? "Нажмите для просмотра пропущенных занятий" : undefined}
        >
          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
            stats.passes > 0 ? 'bg-amber-500/10 text-amber-500' : 'bg-slate-500/10 text-slate-400'
          }`}>
            <Icons.Clock size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <p className="text-xs text-textMuted dark:text-[#8E98A8] font-medium">Пропуски</p>
              {stats.missedLessons.length > 0 && (
                <span className="text-[10px] text-amber-500 font-bold ml-1">Детали →</span>
              )}
            </div>
            <p className={`text-lg font-bold truncate ${stats.passes > 0 ? 'text-amber-500' : 'text-dark dark:text-white'}`}>
              {stats.loading ? '...' : (isCollege ? `${stats.passes} ч.` : stats.passes)}
            </p>
          </div>
        </Card>
      </div>

      {/* Missed Lessons Modal */}
      {showMissedModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setShowMissedModal(false)}
        >
          <div
            className="bg-card dark:bg-[#1F2430] border border-border dark:border-[#2B3242] rounded-3xl max-w-lg w-full max-h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-border dark:border-[#2B3242] flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
                  <Icons.AlertCircle size={18} />
                </div>
                <div>
                  <h3 className="font-bold text-base text-dark dark:text-white">Пропущенные занятия</h3>
                  <p className="text-xs text-textMuted dark:text-[#8E98A8]">Всего пропущено: {stats.passes} ч.</p>
                </div>
              </div>
              <button
                onClick={() => setShowMissedModal(false)}
                className="p-1.5 rounded-xl text-textMuted hover:text-dark dark:hover:text-white hover:bg-bg dark:hover:bg-[#262D3D] transition-colors"
              >
                <Icons.X size={18} />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-3 flex-1">
              {stats.missedLessons.map((l, i) => (
                <div key={i} className="p-3.5 rounded-2xl bg-bg dark:bg-[#12151B] border border-border/50 dark:border-[#2B3242]/50 flex items-start space-x-3">
                  <div className="w-7 h-7 rounded-lg bg-rose-500/10 text-rose-500 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
                    Н
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-xs sm:text-sm text-dark dark:text-white">{l.discipline}</p>
                    <p className="text-[11px] text-textMuted dark:text-[#8E98A8] mt-0.5">
                      {l.date} • {l.theme || l.type || 'Занятие'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Today Schedule Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Icons.Calendar size={20} className="text-primary dark:text-[#38BDF8]" />
            <h2 className="text-lg font-bold text-dark dark:text-white">Расписание на сегодня</h2>
          </div>
          <button
            onClick={() => navigate('/schedule')}
            className="text-xs font-semibold text-primary dark:text-[#38BDF8] hover:underline flex items-center space-x-1"
          >
            <span>На неделю</span>
            <Icons.ArrowRight size={14} />
          </button>
        </div>

        {isScheduleLoading ? (
          <div className="py-12 flex justify-center">
            <LoadingSpinner size={8} text="Загрузка расписания..." />
          </div>
        ) : scheduleToday.length === 0 ? (
          <Card className="p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto mb-3">
              <Icons.Coffee size={24} />
            </div>
            <p className="font-bold text-dark dark:text-white text-base">Сегодня занятий нет!</p>
            <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1">
              Отличный повод отдохнуть или повторить пройденный материал.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {scheduleToday.map((lesson, idx) => (
              <Card
                key={idx}
                className={`p-4 transition-all ${
                  lesson.isConsultation
                    ? 'border-l-4 border-l-amber-500 bg-amber-500/5'
                    : 'border-l-4 border-l-primary'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-primary dark:text-[#38BDF8]">
                        {formatLessonTime(lesson.start, lesson.end)}
                      </span>
                      <Badge variant={lesson.isConsultation ? "warning" : "primary"} size="sm">
                        {lesson.type || (lesson.isConsultation ? 'Консультация' : 'Занятие')}
                      </Badge>
                      {lesson.subgroup ? (
                        <Badge variant="neutral" size="sm">
                          {lesson.subgroup} п/г
                        </Badge>
                      ) : null}
                    </div>
                    <h3 className="font-bold text-sm sm:text-base text-dark dark:text-white">
                      {lesson.title}
                    </h3>
                    {lesson.teacher && (
                      <p className="text-xs text-textMuted dark:text-[#8E98A8] flex items-center space-x-1">
                        <Icons.User size={12} />
                        <span>{lesson.teacher}</span>
                      </p>
                    )}
                  </div>
                  {lesson.classroom && (
                    <div className="self-start sm:self-center shrink-0">
                      <span className="inline-flex items-center space-x-1 px-3 py-1 rounded-xl bg-bg dark:bg-[#12151B] text-dark dark:text-white font-semibold text-xs border border-border dark:border-[#2B3242]">
                        <Icons.MapPin size={12} className="text-textMuted" />
                        <span>ауд. {lesson.classroom}</span>
                      </span>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Quick Navigation Grid */}
      <div className="space-y-3">
        <h2 className="text-lg font-bold text-dark dark:text-white">Быстрый доступ</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {QUICK_ACTIONS.map((action, idx) => (
            <Card
              key={idx}
              onClick={() => navigate(action.to)}
              className="p-4 flex items-center space-x-3 cursor-pointer hover:border-primary/50 transition-all active:scale-[0.98] group"
            >
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110 ${action.color}`}>
                <action.icon size={20} />
              </div>
              <span className="font-bold text-sm text-dark dark:text-white group-hover:text-primary dark:group-hover:text-[#38BDF8] transition-colors">
                {action.title}
              </span>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};
