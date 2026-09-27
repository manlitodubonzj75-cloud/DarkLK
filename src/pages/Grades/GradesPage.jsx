import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { lkService, formatDisplayDate, parseLessonDate, isPastDate, cacheService } from '../../api';
import { Card } from '../../components/common/Card';
import { Icons } from '../../components/common/Icons';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { ErrorMessage } from '../../components/common/ErrorMessage';

// Helper for grade pill styling matching Flutter and the new dark palette
function getGradeStyle(grade) {
  switch (Number(grade)) {
    case 5:
      return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30';
    case 4:
      return 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30';
    case 3:
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';
    case 2:
      return 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30';
    default:
      return 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30';
  }
}

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
  const loadGradesData = async () => {
    const cachedData = getCachedProgress();
    if (cachedData && Array.isArray(cachedData.disciplines) && cachedData.disciplines.length > 0) {
      setDisciplines(cachedData.disciplines);
      setCurrentSemesterInfo({
        course: cachedData.activeCourse,
        semester: cachedData.activeSemester
      });
      setSemesterSummary({
        avgScore: cachedData.gpa || '—',
        isAdmitted: cachedData.isAdmitted !== undefined ? cachedData.isAdmitted : true,
        unadmittedCount: cachedData.unadmittedCount || 0,
        totalPasses: cachedData.passes !== undefined ? cachedData.passes : 0,
        totalGradesCount: cachedData.totalGradesCount || 0,
        gradeDistribution: cachedData.gradeDistribution || {}
      });
      setIsLoading(false);
    }

    try {
      const data = await lkService.getProgressWithLessons(user);

      if (data && Array.isArray(data.disciplines) && data.disciplines.length > 0) {
        setDisciplines(data.disciplines);
        setCurrentSemesterInfo({
          course: data.activeCourse,
          semester: data.activeSemester
        });
        setSemesterSummary({
          avgScore: data.gpa || '—',
          isAdmitted: data.isAdmitted !== undefined ? data.isAdmitted : true,
          unadmittedCount: data.unadmittedCount || 0,
          totalPasses: data.passes !== undefined ? data.passes : 0,
          totalGradesCount: data.totalGradesCount || 0,
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

    const handlePull = () => {
      const activeCourse = Number(user?.course || 1);
      const activeSem = Number(user?.semester || 1);
      cacheService.remove(`progress_with_lessons_c${activeCourse}_s${activeSem}`);
      cacheService.remove("progress_with_lessons_latest");
      cacheService.remove("progress_list");
      loadGradesData();
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
            <Icons.AlertCircle size={16} className="text-amber-600 dark:text-[#E5983A] shrink-0" />
            <span>Официальный сайт МГЮА недоступен. Отображаются сохранённые данные из локального кэша.</span>
          </div>
          <button
            onClick={loadGradesData}
            className="px-3 py-1 bg-amber-200/60 dark:bg-[#4A3323] rounded-xl font-bold hover:opacity-80 transition-opacity"
          >
            Обновить
          </button>
        </div>
      )}

      {/* Header with Switcher to Recordbook */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-dark dark:text-white">Текущая успеваемость</h1>
          <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-0.5">
            {currentSemesterInfo ? (
              <span className="font-semibold text-primary dark:text-[#38BDF8]">
                {currentSemesterInfo.course} курс, {currentSemesterInfo.semester} семестр (текущий) •{' '}
              </span>
            ) : null}
            {isCollege
              ? 'Оценки за занятия, посещаемость и допуск к сессии'
              : 'Оценки за занятия, баллы модулей БАРС и допуск к сессии'}
          </p>
        </div>

        <button
          onClick={() => navigate('/recordbook')}
          className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-card dark:bg-[#1F2430] border border-border dark:border-[#2B3242] text-dark dark:text-white text-xs font-bold hover:bg-bg dark:hover:bg-[#262D3D] transition-colors self-start sm:self-auto shadow-sm"
        >
          <Icons.BookOpen size={16} />
          <span>Зачётная книжка →</span>
        </button>
      </div>

      {/* Key Semester Metrics: GPA, Admission Status, Absences */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* 1. Средний балл */}
        <Card className="p-4 flex flex-col justify-between dark:bg-[#1F2430] dark:border-[#2B3242]">
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 rounded-2xl bg-secondary/10 dark:bg-[#1E6685]/20 text-secondary dark:text-[#38BDF8] flex items-center justify-center shrink-0">
              <Icons.GraduationCap size={26} />
            </div>
            <div>
              <span className="text-xs font-medium text-textMuted dark:text-[#8E98A8]">Текущий средний балл</span>
              <p className="text-2xl font-black text-secondary dark:text-[#38BDF8]">{semesterSummary.avgScore}</p>
            </div>
          </div>

          {semesterSummary.totalGradesCount > 0 && (
            <div className="flex items-center space-x-2 mt-3 pt-3 border-t border-border/60 dark:border-[#2B3242] text-xs">
              <span className="text-textMuted dark:text-[#8E98A8] font-medium">Всего оценок: {semesterSummary.totalGradesCount}</span>
              <div className="flex items-center space-x-1 ml-auto">
                {[5, 4, 3, 2].map(g => {
                  const count = semesterSummary.gradeDistribution[g];
                  if (!count) return null;
                  return (
                    <span
                      key={g}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${getGradeStyle(g)}`}
                    >
                      {g}: {count}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        {/* 2. Статус допуска к сессии */}
        <Card className="p-4 flex items-center space-x-3 dark:bg-[#1F2430] dark:border-[#2B3242]">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
            semesterSummary.isAdmitted
              ? 'bg-emerald-100 text-emerald-600 dark:bg-[#142E25] dark:text-[#34D399]'
              : 'bg-amber-100 text-amber-600 dark:bg-[#34251B] dark:text-[#E5983A]'
          }`}>
            {semesterSummary.isAdmitted ? <Icons.CheckCircle size={26} /> : <Icons.AlertCircle size={26} />}
          </div>
          <div className="min-w-0">
            <span className="text-xs font-medium text-textMuted dark:text-[#8E98A8]">Статус допуска к сессии</span>
            <p className={`text-sm font-black truncate ${
              semesterSummary.isAdmitted ? 'text-emerald-600 dark:text-[#34D399]' : 'text-amber-600 dark:text-[#E5983A]'
            }`}>
              {semesterSummary.isAdmitted
                ? '✓ Допущен к сессии'
                : `× Нет допуска (${semesterSummary.unadmittedCount})`}
            </p>
          </div>
        </Card>

        {/* 3. Пропуски */}
        <Card className="p-4 flex items-center space-x-3 dark:bg-[#1F2430] dark:border-[#2B3242]">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
            semesterSummary.totalPasses > 0
              ? 'bg-amber-100 text-amber-600 dark:bg-[#34251B] dark:text-[#E5983A]'
              : 'bg-emerald-100 text-emerald-600 dark:bg-[#142E25] dark:text-[#34D399]'
          }`}>
            <Icons.Calendar size={26} />
          </div>
          <div>
            <span className="text-xs font-medium text-textMuted dark:text-[#8E98A8]">{isCollege ? "Пропущено пар" : "Пропуски за семестр"}</span>
            <p className={`text-2xl font-black ${
              semesterSummary.totalPasses > 0 ? 'text-amber-600 dark:text-[#E5983A]' : 'text-emerald-600 dark:text-[#34D399]'
            }`}>
              {semesterSummary.totalPasses}
            </p>
          </div>
        </Card>
      </div>

      {/* Disciplines In-Progress List */}
      {isLoading ? (
        <Card className="p-12 text-center dark:bg-[#1F2430] dark:border-[#2B3242]">
          <LoadingSpinner size={10} text="Получение текущих оценок и баллов..." />
        </Card>
      ) : error ? (
        <ErrorMessage message={error} onRetry={loadGradesData} />
      ) : disciplines.length === 0 ? (
        <Card className="p-12 text-center dark:bg-[#1F2430] dark:border-[#2B3242]">
          <div className="w-16 h-16 rounded-full bg-accent/10 dark:bg-[#22869A]/20 mx-auto flex items-center justify-center text-accent dark:text-[#22869A] mb-4">
            <Icons.GraduationCap size={32} />
          </div>
          <h3 className="text-lg font-bold text-dark dark:text-white">
            Нет данных об успеваемости за {currentSemesterInfo ? `${currentSemesterInfo.semester} семестр` : 'текущий семестр'}
          </h3>
          <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1">
            Текущие баллы БАРС и оценки отображаются по мере внесения преподавателями.
          </p>
        </Card>
      ) : (
        <div className="space-y-3.5">
          {disciplines.map((disc, idx) => {
            const isExpanded = expandedDiscipline === disc.name;
            const hasAccess = disc.access;
            const hasGrades = Array.isArray(disc.grades) && disc.grades.length > 0;
            const hasModuleScores = Array.isArray(disc.moduleScores) && disc.moduleScores.length > 0;

            return (
              <Card
                key={disc.id || idx}
                className={`p-5 transition-all cursor-pointer dark:bg-[#1F2430] dark:border-[#2B3242] ${
                  !hasAccess ? 'border-amber-400 dark:border-[#4A3323]' : 'hover:border-accent dark:hover:border-[#22869A]/70'
                }`}
                onClick={() => toggleExpand(disc.name)}
              >
                {/* Header of Card */}
                <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-[240px]">
                    <h3 className="font-bold text-base sm:text-lg text-dark dark:text-white leading-tight">
                      {disc.name}
                    </h3>
                    {disc.info && (
                      <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1 font-normal leading-relaxed">
                        {disc.info}
                      </p>
                    )}
                    {Array.isArray(disc.professors) && disc.professors.length > 0 && !disc.info && (
                      <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1">
                        {disc.professors.join(', ')}
                      </p>
                    )}
                  </div>

                  {/* Admission Status Tag & Score Badge */}
                  <div className="flex items-center space-x-2 shrink-0">
                    {hasAccess ? (
                      <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-[#142E25] dark:text-[#34D399] dark:border-[#1F543D]">
                        ✓ Допуск
                      </span>
                    ) : (
                      <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-[#34251B] dark:text-[#E5983A] dark:border-[#4A3323]">
                        × Нет допуска
                      </span>
                    )}

                    {disc.avgGrade ? (
                      <span className="px-2.5 py-1 rounded-xl text-xs font-black bg-secondary dark:bg-[#1E6685] text-white shadow-sm">
                        {disc.avgGrade} ср.
                      </span>
                    ) : disc.barsScore ? (
                      <span className="px-2.5 py-1 rounded-xl text-xs font-black bg-secondary dark:bg-[#1E6685] text-white shadow-sm">
                        {disc.barsScore} б.
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* BOTTOM ROW: QUICK-DISPLAY MODULE SCORES, COLLEGE LESSON STATS, GRADES & ABSENCES */}
                {(hasModuleScores || hasGrades || disc.passes > 0 || (disc.flawGrape > 0 && !hasAccess) || disc.countPractice > 0) && (
                  <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-border/80 dark:border-[#2B3242]/70">
                    {/* Module Scores Pills (Bachelor) */}
                    {hasModuleScores && disc.moduleScores.map((mod, mIdx) => (
                      <div
                        key={mIdx}
                        className="flex items-center space-x-1.5 px-3 py-1 rounded-xl bg-bg dark:bg-[#181C26] border border-border dark:border-[#2B3242] text-xs"
                      >
                        <span className="font-semibold text-textMuted dark:text-[#8E98A8]">{mod.name}:</span>
                        <span className="font-bold text-dark dark:text-white">{mod.score} б.</span>
                      </div>
                    ))}

                    {/* Non-zero Received Lesson Grades */}
                    {hasGrades && (
                      <div className="flex items-center space-x-1.5 ml-1">
                        <span className="text-xs font-bold text-textMuted dark:text-[#8E98A8]">Оценки:</span>
                        <div className="flex flex-wrap gap-1">
                          {disc.grades.map((g, gIdx) => (
                            <span
                              key={gIdx}
                              className={`w-6 h-6 flex items-center justify-center rounded-lg text-xs font-black border ${getGradeStyle(g)}`}
                            >
                              {g}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* College: FlawGrape (missing positive grades needed for admission) */}
                    {disc.flawGrape > 0 && !hasAccess && (
                      <div className="flex items-center space-x-1 px-2.5 py-1 rounded-xl bg-amber-50 dark:bg-[#34251B] text-amber-700 dark:text-[#E5983A] border border-amber-200 dark:border-[#4A3323] text-xs font-semibold">
                        <span>Не хватает оценок: {disc.flawGrape}</span>
                      </div>
                    )}

                    {/* College: CountPractice (number of practical classes) */}
                    {disc.countPractice > 0 && (
                      <div className="flex items-center space-x-1 px-2.5 py-1 rounded-xl bg-bg dark:bg-[#181C26] border border-border dark:border-[#2B3242] text-xs font-semibold text-textMuted dark:text-[#8E98A8]">
                        <span>Практик: {disc.countPractice}</span>
                      </div>
                    )}

                    {/* Absence Tag */}
                    {disc.passes > 0 && (
                      <div className="flex items-center space-x-1 px-2.5 py-1 rounded-xl bg-amber-50 dark:bg-[#34251B] text-amber-700 dark:text-[#E5983A] border border-amber-200 dark:border-[#4A3323] text-xs font-semibold ml-auto">
                        <span>{isCollege ? `Пропущено: ${disc.passes} пар` : `Пропуски: ${disc.passes}`}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Expanded Detailed View for College (Lessons Journal: Dates, Turnout, Lateness, Ratings) */}
                {isExpanded && Array.isArray(disc.lessons) && disc.lessons.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border/80 dark:border-[#2B3242] space-y-3 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-textMuted dark:text-[#8E98A8]">
                        Журнал занятий и оценки
                      </h4>
                      <span className="text-[11px] text-textMuted dark:text-[#8E98A8]">
                        Всего занятий: {disc.lessons.length}
                      </span>
                    </div>

                    <div className="space-y-2 mt-2">
                      {disc.lessons.map((lesson, lIdx) => {
                        const ratings = Array.isArray(lesson.ratings) ? lesson.ratings.filter(r => r > 0) : [];
                        const lessonDate = parseLessonDate(lesson.date);
                        const isPast = lessonDate && isPastDate(lessonDate);
                        const isMissed = isPast && !lesson.turnout && ratings.length === 0;
                        const isPresent = lesson.turnout || ratings.length > 0;

                        return (
                          <div
                            key={lIdx}
                            className="flex items-center justify-between p-3 rounded-xl bg-bg dark:bg-[#181C26] border border-border/80 dark:border-[#2B3242] text-xs gap-3"
                          >
                            <div className="flex items-center space-x-3 min-w-0">
                              <span className="font-bold text-dark dark:text-white shrink-0">
                                {formatDisplayDate(lesson.date) || lesson.date}
                              </span>
                              <div className="min-w-0">
                                {lesson.teacher && (
                                  <p className="text-textMuted dark:text-[#8E98A8] truncate">
                                    {lesson.teacher}
                                  </p>
                                )}
                                {lesson.subgroup ? (
                                  <p className="text-[10px] text-textMuted dark:text-[#8E98A8]">
                                    Подгруппа {lesson.subgroup}
                                  </p>
                                ) : null}
                              </div>
                            </div>

                            <div className="flex items-center space-x-2 shrink-0">
                              {lesson.lateness && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-[#E5983A] border border-amber-500/30">
                                  Опоздание
                                </span>
                              )}

                              {ratings.length > 0 ? (
                                <div className="flex space-x-1">
                                  {ratings.map((r, rIdx) => (
                                    <span
                                      key={rIdx}
                                      className={`w-6 h-6 flex items-center justify-center rounded-lg text-xs font-black border ${getGradeStyle(r)}`}
                                    >
                                      {r}
                                    </span>
                                  ))}
                                </div>
                              ) : isPresent ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-[#34D399] border border-emerald-500/30">
                                  Посещено
                                </span>
                              ) : isMissed ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">
                                  Пропуск
                                </span>
                              ) : (
                                <span className="text-[11px] text-textMuted dark:text-[#8E98A8]">
                                  Запланировано
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Expanded Detailed View for Bachelor (Themes, Modules, Seminar Ball) */}
                {isExpanded && Array.isArray(disc.modules) && disc.modules.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-border/80 dark:border-[#2B3242] space-y-3 animate-in fade-in duration-150">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-textMuted dark:text-[#8E98A8]">
                      Подробности по модулям и занятиям
                    </h4>
                    {disc.modules.map((mod, mIdx) => (
                      <div key={mIdx} className="p-3.5 bg-bg dark:bg-[#181C26] rounded-xl border border-border dark:border-[#2B3242] space-y-2.5">
                        <div className="flex justify-between items-center text-xs font-bold">
                          <span className="text-dark dark:text-white">{mod.module || `Модуль ${mIdx + 1}`}</span>
                          <span className="text-secondary dark:text-[#38BDF8]">{mod.mediumScore || 0} баллов</span>
                        </div>
                        {Array.isArray(mod.themes) && mod.themes.map((theme, tIdx) => (
                          <div key={tIdx} className="text-xs pl-2.5 border-l-2 border-border/80 dark:border-[#2B3242] space-y-1.5">
                            <p className="font-medium text-dark dark:text-white leading-tight">{theme.theme}</p>
                            {Array.isArray(theme.items) && theme.items.map((item, itIdx) => {
                              const validDate = formatDisplayDate(item.date);
                              const isMissed = item.missed === 1 || item.missed === '1' || item.turnout === false || item.turnout === 'false';
                              const ball = item.ball;

                              return (
                                <div key={itIdx} className="flex justify-between items-center text-[11px] text-textMuted dark:text-[#8E98A8] pt-0.5">
                                  <span>{validDate ? validDate : 'Семинар'}</span>
                                  <div>
                                    {isMissed ? (
                                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-[#E5983A] border border-amber-500/30">
                                        Пропуск
                                      </span>
                                    ) : ball > 0 ? (
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getGradeStyle(ball)}`}>
                                        {ball} б.
                                      </span>
                                    ) : (
                                      <span className="text-textMuted dark:text-[#8E98A8]">—</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {/* If expanded and neither modules nor lessons found */}
                {isExpanded && (!disc.modules?.length && !disc.lessons?.length) && (
                  <div className="mt-4 pt-4 border-t border-border/80 dark:border-[#2B3242] text-center py-2">
                    <p className="text-xs text-textMuted dark:text-[#8E98A8]">
                      Нет детальных записей о занятиях по этой дисциплине
                    </p>
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
