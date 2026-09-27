import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useDashboardData } from '../../context/SyncContext';
import { formatLessonTime } from '../../api';
import { Card } from '../../components/common/Card';
import { Badge } from '../../components/common/Badge';
import { Icons } from '../../components/common/Icons';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';

export const DashboardPage = () => {
  const { user, isCollege } = useAuth();
  const navigate = useNavigate();

  // Clean Domain Hook: single source of truth for dashboard data
  const {
    todayLessons,
    hasLoadedLessons,
    rating,
    passes,
    missedLessons,
    news,
    loading: isDataLoading
  } = useDashboardData();

  const [showMissedModal, setShowMissedModal] = useState(false);

  const ALL_QUICK_ACTIONS = [
    { label: 'Расписание', icon: Icons.Calendar, path: '/schedule', color: 'bg-primary' },
    { label: 'Оценки', icon: Icons.GraduationCap, path: '/grades', color: 'bg-secondary' },
    { label: 'Зачётка', icon: Icons.BookOpen, path: '/recordbook', color: 'bg-teal-700' },
    { label: 'Почта', icon: Icons.Mail, path: '/mail', color: 'bg-[#036495]' },
    { label: 'Отработки', icon: Icons.UserCheck, path: '/consultations', color: 'bg-accent' }
  ];

  const QUICK_ACTIONS = isCollege
    ? ALL_QUICK_ACTIONS.filter(action => action.path !== '/consultations')
    : ALL_QUICK_ACTIONS;

  return (
    <div className="space-y-6 pb-6">
      {/* Greeting Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-textMuted dark:text-[#8E98A8]">
            {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <h1 className="text-2xl font-black text-dark dark:text-white mt-0.5">
            Привет, {user?.name ? (user.name.split(' ')[1] || user.name.split(' ')[0]) : 'Студент'} 👋
          </h1>
          <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1">
            {user?.department || user?.faculty || (isCollege ? 'Колледж МГЮА им. О.Е. Кутафина' : 'МГЮА им. О.Е. Кутафина')} • {user?.group ? `Группа ${user.group}` : (user?.speciality || user?.role || '')}
          </p>
        </div>
      </div>

      {/* Quick Action Navigation */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-textMuted dark:text-[#8E98A8] mb-3">
          Быстрый доступ
        </h3>
        <div className="grid grid-cols-4 sm:grid-cols-5 gap-3">
          {QUICK_ACTIONS.map(action => {
            const Icon = action.icon;
            return (
              <button
                key={action.path}
                onClick={() => navigate(action.path)}
                className="flex flex-col items-center justify-center p-3 rounded-2xl bg-card dark:bg-[#1F2430] border border-border dark:border-[#2B3242] hover:border-accent dark:hover:border-[#38BDF8] hover:shadow-sm transition-all text-center group cursor-pointer"
              >
                <div className={`w-10 h-10 rounded-xl ${action.color} text-white flex items-center justify-center mb-2 shadow-sm group-hover:scale-105 transition-transform`}>
                  <Icon size={20} />
                </div>
                <span className="text-xs font-bold text-dark dark:text-white">{action.label}</span>
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
              {isDataLoading ? '—' : (rating !== '—' && rating !== undefined && rating !== null ? rating : '—')}
            </h4>
          </div>
        </Card>

        <Card
          onClick={() => {
            if (missedLessons.length > 0) setShowMissedModal(true);
          }}
          className={`p-3.5 sm:p-4 flex items-center justify-between border border-border dark:border-[#2B3242] ${
            missedLessons.length > 0 ? 'cursor-pointer hover:border-accent dark:hover:border-[#38BDF8] transition-colors' : ''
          }`}
          title={missedLessons.length > 0 ? "Нажмите для просмотра пропущенных занятий" : undefined}
        >
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent dark:text-[#38BDF8] flex items-center justify-center shrink-0">
              <Icons.Clock size={22} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-textMuted dark:text-[#8E98A8] font-medium truncate">Пропуски (акад. ч)</p>
              <h4 className="text-lg sm:text-xl font-black text-dark dark:text-white mt-0.5 truncate">
                {isDataLoading ? '—' : passes}
              </h4>
            </div>
          </div>
          {missedLessons.length > 0 && (
            <span className="text-xs font-bold text-accent dark:text-[#38BDF8] hover:underline shrink-0 ml-2">
              Детали →
            </span>
          )}
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
                  <p className="text-xs text-textMuted dark:text-[#8E98A8]">Всего пропущено: {passes} ч.</p>
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
              {missedLessons.map((l, i) => (
                <div key={i} className="p-3.5 rounded-2xl bg-bg dark:bg-[#12151B] border border-border/50 dark:border-[#2B3242]/50 flex items-start space-x-3">
                  <div className="w-7 h-7 rounded-lg bg-rose-500/10 text-rose-500 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
                    Н
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-xs sm:text-sm text-dark dark:text-white">{l.discipline || l.name || l.title}</p>
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

      {/* Today's Classes */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-textMuted dark:text-[#8E98A8]">
            Расписание на сегодня
          </h3>
          <button
            onClick={() => navigate('/schedule')}
            className="text-xs font-bold text-secondary dark:text-[#38BDF8] hover:underline"
          >
            Все занятия →
          </button>
        </div>

        {!hasLoadedLessons && isDataLoading ? (
          <Card className="p-8 text-center border border-border dark:border-[#2B3242]">
            <LoadingSpinner size={8} text="Загрузка занятий..." />
          </Card>
        ) : todayLessons.length === 0 ? (
          <Card className="p-8 text-center border border-border dark:border-[#2B3242]">
            <div className="w-12 h-12 rounded-full bg-accent/10 mx-auto flex items-center justify-center text-accent dark:text-[#38BDF8] mb-3">
              <Icons.Calendar size={24} />
            </div>
            <h4 className="text-base font-bold text-dark dark:text-white">Сегодня занятий нет</h4>
            <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1">Отличный день для подготовки или отдыха!</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {todayLessons.map((lesson, idx) => {
              const teacherName = lesson.teacher || lesson.lecturer || lesson.tutor;
              const room = lesson.classroom || lesson.auditory || lesson.room;

              return (
                <Card key={lesson.id || idx} className="p-4 sm:p-5 hover:border-accent dark:hover:border-[#38BDF8] transition-colors overflow-hidden w-full min-w-0 border border-border dark:border-[#2B3242]">
                  {/* Header: Time badge on left, Lesson Type & Corps on right */}
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2 w-full min-w-0">
                    <div className="px-2.5 py-1 rounded-lg bg-primary/10 text-primary dark:text-[#38BDF8] font-bold text-xs sm:text-sm shrink-0">
                      {formatLessonTime(lesson)}
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-1.5 min-w-0 max-w-[60%] sm:max-w-none">
                      {lesson.type && (
                        <Badge 
                          type={lesson.isConsultation ? 'secondary' : 'primary'}
                          className="max-w-[180px] sm:max-w-[280px] truncate text-[11px] font-semibold"
                          title={lesson.type}
                        >
                          {lesson.type}
                        </Badge>
                      )}
                      {lesson.corps && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-bg dark:bg-[#12151B] text-textMuted dark:text-[#8E98A8] border border-border dark:border-[#2B3242] shrink-0">
                          {lesson.corps}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Body: Full-width discipline title */}
                  <h4 className="text-base sm:text-lg font-bold text-dark dark:text-white leading-snug break-words">
                    {lesson.discipline || lesson.subject || lesson.title}
                  </h4>

                  {/* Footer: Auditory & Teacher */}
                  {(room || teacherName) && (
                    <div className="mt-3 pt-2.5 border-t border-border dark:border-[#2B3242] flex flex-wrap items-center justify-between gap-2 text-xs text-textMuted dark:text-[#8E98A8]">
                      {room && (
                        <span className="font-semibold text-dark dark:text-white">
                          Аудитория: {room}
                        </span>
                      )}
                      {teacherName && (
                        <div className="flex items-center space-x-1 text-secondary dark:text-[#38BDF8] font-medium">
                          <Icons.User size={14} />
                          <span>{teacherName}</span>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* University News Feed */}
      {Array.isArray(news) && news.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-textMuted dark:text-[#8E98A8] mb-3">
            Новости университета
          </h3>
          <div className="space-y-3">
            {news.map((item, idx) => (
              <Card key={item.id || idx} className="p-4 border border-border dark:border-[#2B3242]">
                <h4 className="text-sm font-bold text-dark dark:text-white">{item.title || item.name}</h4>
                {item.date && <span className="text-[11px] text-textMuted dark:text-[#8E98A8]">{item.date}</span>}
                {item.preview && <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1 leading-relaxed">{item.preview}</p>}
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
