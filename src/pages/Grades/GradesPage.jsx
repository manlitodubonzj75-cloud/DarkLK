import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { lkService, cacheService } from '../../api';
import { Card } from '../../components/common/Card';
import { Badge } from '../../components/common/Badge';
import { Icons } from '../../components/common/Icons';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';

const getScoreColor = (score) => {
  const num = parseFloat(score);
  if (isNaN(num)) return 'text-textMuted dark:text-[#8E98A8]';
  if (num >= 85) return 'text-emerald-500 dark:text-emerald-400';
  if (num >= 70) return 'text-primary dark:text-[#38BDF8]';
  if (num >= 60) return 'text-amber-500 dark:text-amber-400';
  return 'text-rose-500 dark:text-rose-400';
};

const getScoreBadgeVariant = (score) => {
  const num = parseFloat(score);
  if (isNaN(num)) return 'default';
  if (num >= 85) return 'success';
  if (num >= 70) return 'primary';
  if (num >= 60) return 'warning';
  return 'danger';
};

export const GradesPage = () => {
  const { user, isCollege } = useAuth();
  const navigate = useNavigate();

  const getCachedProgress = () => {
    const now = new Date();
    const isAutumn = now.getMonth() >= 8 || now.getMonth() === 0;
    const estCourse = Number(user?.course || 1);
    const estSem = Number(user?.semester || (isAutumn ? (estCourse * 2 - 1) : (estCourse * 2)));

    return cacheService.get('progress_with_lessons_latest') ||
      cacheService.get(`progress_with_lessons_c${estCourse}_s${estSem}`) ||
      cacheService.get(`progress_with_lessons_${estCourse}_${estSem}`);
  };

  const initialCached = getCachedProgress();

  const [disciplines, setDisciplines] = useState(() => initialCached?.disciplines || []);
  const [expandedDiscipline, setExpandedDiscipline] = useState(null);
  const [currentSemesterInfo, setCurrentSemesterInfo] = useState(() => initialCached ? {
    course: initialCached.activeCourse || Number(user?.course || 1),
    semester: initialCached.activeSemester || Number(user?.semester || 1)
  } : null);
  const [semesterSummary, setSemesterSummary] = useState(() => initialCached ? {
    avgScore: initialCached.gpa || '—',
    isAdmitted: initialCached.isAdmitted !== undefined ? initialCached.isAdmitted : true,
    unadmittedCount: initialCached.unadmittedCount || 0,
    totalPasses: initialCached.passes !== undefined ? initialCached.passes : 0,
    totalGradesCount: initialCached.totalGradesCount || 0,
    gradeDistribution: initialCached.gradeDistribution || {}
  } : {
    avgScore: '—',
    isAdmitted: true,
    unadmittedCount: 0,
    totalPasses: 0,
    totalGradesCount: 0,
    gradeDistribution: {}
  });

  const [isLoading, setIsLoading] = useState(() => !initialCached || !initialCached.disciplines?.length);
  const [isOfflineCached, setIsOfflineCached] = useState(false);
  const [error, setError] = useState(null);

  // Load current active semester progress details via getProgressWithLessons
  const loadGradesData = async ({ forceRefresh = false } = {}) => {
    const cachedData = getCachedProgress();
    if (cachedData && Array.isArray(cachedData.disciplines) && cachedData.disciplines.length > 0) {
      setDisciplines(cachedData.disciplines);
      setCurrentSemesterInfo({
        course: cachedData.activeCourse,
        semester: cachedData.activeSemester
      });
      setSemesterSummary({
        avgScore: cachedData.gpa || '—',
        isAdmitted: cachedData.isAdmitted !== undefined ? Boolean(cachedData.isAdmitted) : (Number(cachedData.unadmittedCount || 0) === 0),
        unadmittedCount: cachedData.unadmittedCount || 0,
        totalPasses: cachedData.passes !== undefined ? cachedData.passes : 0,
        totalGradesCount: cachedData.totalGradesCount || (Array.isArray(cachedData.disciplines) ? cachedData.disciplines.reduce((sum, d) => sum + (d.grades?.length || 0), 0) : 0),
        gradeDistribution: cachedData.gradeDistribution || {}
      });
      setIsLoading(false);
    }

    try {
      const data = await lkService.getProgressWithLessons(user, { forceRefresh });

      if (data && Array.isArray(data.disciplines) && data.disciplines.length > 0) {
        setDisciplines(data.disciplines);
        setCurrentSemesterInfo({
          course: data.activeCourse,
          semester: data.activeSemester
        });
        setSemesterSummary({
          avgScore: data.gpa || '—',
          isAdmitted: data.isAdmitted !== undefined ? Boolean(data.isAdmitted) : (Number(data.unadmittedCount || 0) === 0),
          unadmittedCount: data.unadmittedCount || 0,
          totalPasses: data.passes !== undefined ? data.passes : 0,
          totalGradesCount: data.totalGradesCount || (Array.isArray(data.disciplines) ? data.disciplines.reduce((sum, d) => sum + (d.grades?.length || 0), 0) : 0),
          gradeDistribution: data.gradeDistribution || {}
        });
        setIsOfflineCached(false);
      } else if (!cachedData) {
        setDisciplines([]);
      }
    } catch (err) {
      if (cachedData) {
        setIsOfflineCached(true);
      } else {
        setError(err.message || 'Не удалось загрузить данные об успеваемости');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadGradesData();

    // Pull-to-refresh safely triggers network refresh without wiping offline cache
    const handlePull = () => {
      loadGradesData({ forceRefresh: true });
    };

    window.addEventListener("app-pull-to-refresh", handlePull);
    return () => window.removeEventListener("app-pull-to-refresh", handlePull);
  }, [user]);

  const toggleExpand = (discName) => {
    setExpandedDiscipline(prev => prev === discName ? null : discName);
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Offline Alert Banner if official MSAL website is down */}
      {isOfflineCached && (
        <div className="p-3.5 bg-amber-50 dark:bg-[#34251B] border border-amber-200 dark:border-[#4A3323] rounded-2xl flex items-center justify-between text-xs text-amber-800 dark:text-[#E5983A]">
          <div className="flex items-center space-x-2">
            <Icons.CloudOff className="w-4 h-4 shrink-0" />
            <span>Офлайн-режим: отображаются последние сохранённые данные успеваемости</span>
          </div>
          <button
            onClick={() => loadGradesData({ forceRefresh: true })}
            className="font-bold underline ml-2 hover:opacity-80 cursor-pointer"
          >
            Повторить
          </button>
        </div>
      )}

      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-dark dark:text-white">Текущая успеваемость</h1>
          <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1">
            {isCollege ? 'Оценки за текущие занятия и пропуски' : 'Балльно-рейтинговая система (БАРС) и темы занятий'}
            {currentSemesterInfo && ` • ${currentSemesterInfo.course} курс, ${currentSemesterInfo.semester} семестр`}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => navigate('/recordbook')}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-surface dark:bg-[#1A1F2C] border border-border dark:border-[#2B3242] text-xs font-semibold text-textMuted hover:text-dark dark:hover:text-white transition-all cursor-pointer"
          >
            <Icons.BookOpen className="w-4 h-4" />
            <span>Зачётка</span>
          </button>
          <button
            onClick={() => loadGradesData({ forceRefresh: true })}
            disabled={isLoading}
            className="p-2 rounded-xl bg-surface dark:bg-[#1A1F2C] border border-border dark:border-[#2B3242] text-textMuted hover:text-dark dark:hover:text-white transition-all disabled:opacity-50 cursor-pointer"
            title="Обновить данные"
          >
            <Icons.RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* KPI Stats Overview Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* GPA / BARS Score */}
        <Card className="p-4 sm:p-5 flex items-center space-x-3 sm:space-x-4 border border-border dark:border-[#2B3242]">
          <div className="p-3 rounded-2xl bg-primary/10 text-primary dark:text-[#38BDF8] shrink-0">
            <Icons.Award className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-textMuted dark:text-[#8E98A8]">
              {isCollege ? 'Средний балл' : 'Рейтинг / Ср. балл'}
            </p>
            <p className="text-xl sm:text-2xl font-black text-dark dark:text-white mt-0.5">
              {semesterSummary.avgScore}
            </p>
          </div>
        </Card>

        {/* Exam Admission */}
        <Card className="p-4 sm:p-5 flex items-center space-x-3 sm:space-x-4 border border-border dark:border-[#2B3242]">
          <div className={`p-3 rounded-2xl shrink-0 ${semesterSummary.isAdmitted ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'}`}>
            {semesterSummary.isAdmitted ? <Icons.CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6" /> : <Icons.AlertCircle className="w-5 h-5 sm:w-6 sm:h-6" />}
          </div>
          <div>
            <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-textMuted dark:text-[#8E98A8]">
              Допуск к сессии
            </p>
            <p className={`text-sm sm:text-base font-bold mt-0.5 ${semesterSummary.isAdmitted ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {semesterSummary.isAdmitted ? 'Допущен' : `Недопусков: ${semesterSummary.unadmittedCount}`}
            </p>
          </div>
        </Card>

        {/* Missed Lessons (Passes) */}
        <Card className="p-4 sm:p-5 flex items-center space-x-3 sm:space-x-4 border border-border dark:border-[#2B3242]">
          <div className={`p-3 rounded-2xl shrink-0 ${semesterSummary.totalPasses > 0 ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-primary/10 text-primary dark:text-[#38BDF8]'}`}>
            <Icons.Clock className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-textMuted dark:text-[#8E98A8]">
              {isCollege ? 'Пропущено пар' : 'Пропуски (акад. ч)'}
            </p>
            <p className="text-xl sm:text-2xl font-black text-dark dark:text-white mt-0.5">
              {semesterSummary.totalPasses}
            </p>
          </div>
        </Card>

        {/* Total Grades / Points Received */}
        <Card className="p-4 sm:p-5 flex items-center space-x-3 sm:space-x-4 border border-border dark:border-[#2B3242]">
          <div className="p-3 rounded-2xl bg-secondary/10 text-secondary shrink-0">
            <Icons.CheckSquare className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-textMuted dark:text-[#8E98A8]">
              {isCollege ? 'Оценок получено' : 'Дисциплин в курсе'}
            </p>
            <p className="text-xl sm:text-2xl font-black text-dark dark:text-white mt-0.5">
              {isCollege ? semesterSummary.totalGradesCount : disciplines.length}
            </p>
          </div>
        </Card>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="py-20 flex justify-center">
          <LoadingSpinner size={10} text="Загрузка подробной успеваемости..." />
        </div>
      ) : error && disciplines.length === 0 ? (
        <Card className="p-8 text-center border border-border dark:border-[#2B3242]">
          <Icons.AlertCircle className="w-12 h-12 text-rose-500 mx-auto mb-3 opacity-80" />
          <h3 className="font-bold text-dark dark:text-white mb-1">Ошибка загрузки успеваемости</h3>
          <p className="text-xs text-textMuted dark:text-[#8E98A8] mb-4">{error}</p>
          <button
            onClick={() => loadGradesData({ forceRefresh: true })}
            className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-bold shadow hover:bg-primary/90 transition-all cursor-pointer"
          >
            Попробовать снова
          </button>
        </Card>
      ) : disciplines.length === 0 ? (
        <Card className="p-12 text-center border border-border dark:border-[#2B3242]">
          <Icons.Inbox className="w-12 h-12 text-textMuted dark:text-[#8E98A8] mx-auto mb-3 opacity-30" />
          <h3 className="font-bold text-dark dark:text-white">Нет данных об успеваемости</h3>
          <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1">
            Для выбранного семестра информация ещё не внесена преподавателями
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-textMuted dark:text-[#8E98A8]">
              Список дисциплин ({disciplines.length})
            </h2>
            <span className="text-[11px] text-textMuted dark:text-[#8E98A8]">
              Нажмите на предмет для просмотра деталей
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3">
            {disciplines.map((disc, idx) => {
              const isExpanded = expandedDiscipline === disc.name;
              const hasAccess = disc.access !== false && disc.isAdmitted !== false;
              const hasModules = Array.isArray(disc.modules) && disc.modules.length > 0;
              const hasModuleScores = Array.isArray(disc.moduleScores) && disc.moduleScores.length > 0;
              const hasGrades = Array.isArray(disc.grades) && disc.grades.length > 0;

              return (
                <Card
                  key={disc.id || idx}
                  className={`border transition-all overflow-hidden ${
                    isExpanded
                      ? 'border-primary/50 dark:border-[#1E6685] shadow-md'
                      : 'border-border dark:border-[#2B3242] hover:border-primary/30'
                  }`}
                >
                  {/* Discipline Header Row */}
                  <div
                    onClick={() => toggleExpand(disc.name)}
                    className="p-4 sm:p-5 flex items-start justify-between gap-3 cursor-pointer select-none"
                  >
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <Badge variant="outline" size="sm" className="font-semibold text-[10px]">
                          {disc.type || 'Дисциплина'}
                        </Badge>
                        <Badge
                          variant={hasAccess ? 'success' : 'danger'}
                          size="sm"
                          className="font-bold text-[10px]"
                        >
                          {hasAccess ? 'Допуск' : 'Недопуск'}
                        </Badge>
                        {disc.barsScore && (
                          <Badge variant={getScoreBadgeVariant(disc.barsScore)} size="sm" className="font-bold text-[10px]">
                            {disc.barsScore} б.
                          </Badge>
                        )}
                        {disc.avgGrade && (
                          <Badge variant={getScoreBadgeVariant(Number(disc.avgGrade) * 20)} size="sm" className="font-bold text-[10px]">
                            Ср. {disc.avgGrade}
                          </Badge>
                        )}
                      </div>

                      <h3 className="text-sm sm:text-base font-bold text-dark dark:text-white leading-snug">
                        {disc.name}
                      </h3>

                      {/* Professors */}
                      {Array.isArray(disc.professors) && disc.professors.length > 0 && (
                        <div className="flex items-center space-x-1.5 text-xs text-textMuted dark:text-[#8E98A8]">
                          <Icons.User className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{disc.professors.join(', ')}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center space-x-3 shrink-0 pt-1">
                      {/* BARS Score or College Average */}
                      <div className="text-right">
                        <p className={`text-base sm:text-lg font-black ${getScoreColor(disc.barsScore || (disc.avgGrade ? Number(disc.avgGrade) * 20 : null))}`}>
                          {disc.barsScore ? `${disc.barsScore} б.` : (disc.avgGrade || '—')}
                        </p>
                        <p className="text-[10px] text-textMuted dark:text-[#8E98A8]">
                          {disc.barsScore ? 'Итого БАРС' : 'Оценка'}
                        </p>
                      </div>

                      <div className={`p-1.5 rounded-xl bg-bg dark:bg-[#12151B] text-textMuted transition-transform duration-200 ${isExpanded ? 'rotate-180 text-primary dark:text-[#38BDF8]' : ''}`}>
                        <Icons.ChevronDown className="w-4 h-4" />
                      </div>
                    </div>
                  </div>

                  {/* Summary Micro-Badges Bar */}
                  {(hasModuleScores || hasGrades || disc.passes > 0 || (disc.flawGrape > 0 && !hasAccess) || disc.countPractice > 0) && (
                    <div className="px-4 sm:px-5 pb-3 pt-0 flex flex-wrap items-center gap-2 text-xs">
                      {/* BARS Modules breakdown */}
                      {hasModuleScores && disc.moduleScores.map((m, mIdx) => (
                        <span
                          key={mIdx}
                          className="px-2 py-0.5 rounded-lg bg-bg dark:bg-[#12151B] border border-border dark:border-[#2B3242] text-[11px] font-semibold text-textMuted dark:text-[#8E98A8]"
                        >
                          {m.name}: <strong className={getScoreColor(m.score)}>{m.score} б.</strong>
                        </span>
                      ))}

                      {/* College Grades chips */}
                      {hasGrades && (
                        <div className="flex items-center space-x-1">
                          <span className="text-[11px] text-textMuted dark:text-[#8E98A8]">Оценки:</span>
                          {disc.grades.slice(0, 5).map((g, gIdx) => (
                            <span
                              key={gIdx}
                              className={`w-5 h-5 rounded-md flex items-center justify-center font-bold text-[11px] ${
                                g >= 4
                                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                  : g === 3
                                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                    : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {g}
                            </span>
                          ))}
                          {disc.grades.length > 5 && (
                            <span className="text-[10px] text-textMuted">+{disc.grades.length - 5}</span>
                          )}
                        </div>
                      )}

                      {/* Passes (Absences) badge */}
                      {disc.passes > 0 && (
                        <span className="px-2 py-0.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold text-[11px] flex items-center space-x-1">
                          <Icons.Clock className="w-3 h-3" />
                          <span>{isCollege ? `Пропущено: ${disc.passes} пар` : `Пропуски: ${disc.passes}`}</span>
                        </span>
                      )}

                      {/* Practices remaining */}
                      {disc.countPractice > 0 && (
                        <span className="px-2 py-0.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold text-[11px]">
                          Практик: {disc.countPractice}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Expanded Discipline Detailed Content */}
                  {isExpanded && (
                    <div className="border-t border-border dark:border-[#2B3242] bg-bg/50 dark:bg-[#12151B]/50 p-4 sm:p-5 space-y-4">
                      {/* Teacher Notes / Debt info */}
                      {disc.info && (
                        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
                          <strong className="font-bold">Информация кафедры: </strong>
                          {disc.info}
                        </div>
                      )}

                      {/* BARS Modules & Lesson Themes */}
                      {hasModules ? (
                        <div className="space-y-4">
                          {disc.modules.map((module, modIdx) => (
                            <div
                              key={modIdx}
                              className="rounded-2xl bg-surface dark:bg-[#1A1F2C] border border-border dark:border-[#2B3242] p-3.5 space-y-3"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-bold text-xs text-dark dark:text-white flex items-center space-x-2">
                                  <span className="w-2 h-2 rounded-full bg-primary" />
                                  <span>{module.module || module.name || `Блок модулей #${modIdx + 1}`}</span>
                                </span>
                                {(module.mediumScore !== undefined || module.score !== undefined) && (
                                  <span className="text-xs font-bold text-primary dark:text-[#38BDF8]">
                                    Балл: {module.mediumScore ?? module.score}
                                  </span>
                                )}
                              </div>

                              {/* Themes / Lessons breakdown inside module */}
                              {Array.isArray(module.themes) && module.themes.length > 0 ? (
                                <div className="space-y-2">
                                  {module.themes.map((theme, thIdx) => (
                                    <div
                                      key={thIdx}
                                      className="p-2.5 rounded-xl bg-bg dark:bg-[#12151B] border border-border/50 dark:border-[#2B3242]/50 space-y-1.5"
                                    >
                                      <div className="flex items-center justify-between text-xs">
                                        <span className="font-semibold text-dark dark:text-white line-clamp-1">
                                          {theme.theme || theme.name || `Тема ${thIdx + 1}`}
                                        </span>
                                        {theme.date && (
                                          <span className="text-[10px] text-textMuted dark:text-[#8E98A8] shrink-0 ml-2">
                                            {theme.date}
                                          </span>
                                        )}
                                      </div>

                                      {/* Individual lesson items / points inside theme */}
                                      {Array.isArray(theme.items) && theme.items.length > 0 && (
                                        <div className="space-y-1 pt-1">
                                          {theme.items.map((it, itIdx) => {
                                            const isAbsent = it.missed === 1 || it.missed === '1' || it.turnout === false;
                                            return (
                                              <div
                                                key={itIdx}
                                                className="flex items-center justify-between text-[11px] text-textMuted dark:text-[#8E98A8] pl-2 border-l-2 border-primary/30"
                                              >
                                                <span className="line-clamp-1">
                                                  {it.theme || it.name || 'Занятие'}
                                                  {it.subgroup ? ` (Подгруппа ${it.subgroup})` : ''}
                                                </span>
                                                <div className="flex items-center space-x-2 shrink-0 ml-2">
                                                  {isAbsent && (
                                                    <span className="text-[10px] font-bold text-rose-500">
                                                      Пропуск
                                                    </span>
                                                  )}
                                                  {it.ball !== undefined && it.ball !== null && (
                                                    <span className="font-bold text-dark dark:text-white">
                                                      {it.ball} б.
                                                    </span>
                                                  )}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-textMuted dark:text-[#8E98A8] italic">
                                  Темы занятий пока не внесены преподавателем
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-xs text-textMuted dark:text-[#8E98A8]">
                            Подробные данные о занятиях и БАРС для данной дисциплины:
                          </p>
                          <div className="p-3 rounded-xl bg-surface dark:bg-[#1A1F2C] border border-border dark:border-[#2B3242] flex items-center justify-between text-xs">
                            <span className="text-textMuted dark:text-[#8E98A8]">Статус допуска:</span>
                            <span className={`font-bold ${hasAccess ? 'text-emerald-500' : 'text-rose-500'}`}>
                              {hasAccess ? 'Допущен к аттестации' : 'Не допущен'}
                            </span>
                          </div>
                          {disc.barsScore && (
                            <div className="p-3 rounded-xl bg-surface dark:bg-[#1A1F2C] border border-border dark:border-[#2B3242] flex items-center justify-between text-xs">
                              <span className="text-textMuted dark:text-[#8E98A8]">Текущий балл БАРС:</span>
                              <span className="font-bold text-primary dark:text-[#38BDF8]">{disc.barsScore} б.</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default GradesPage;
