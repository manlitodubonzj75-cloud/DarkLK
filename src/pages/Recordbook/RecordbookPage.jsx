import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { lkService, formatDisplayDate, cacheService, filterSemesterProgress } from '../../api';
import { Card } from '../../components/common/Card';
import { Badge } from '../../components/common/Badge';
import { Icons } from '../../components/common/Icons';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { ErrorMessage } from '../../components/common/ErrorMessage';

// Helper for validating real session grades (exams, tests, credit marks)
const hasValidGrade = (gradeStr) => {
  if (!gradeStr) return false;
  const g = gradeStr.toString().toLowerCase().trim();
  if (
    !g ||
    g === 'в плане' ||
    g === 'план' ||
    g === '0' ||
    g === '—' ||
    g === '-' ||
    g === 'нет' ||
    g === 'null' ||
    g === 'undefined'
  ) {
    return false;
  }
  return true;
};

// Helper for grade badge appearance
const getGradeBadge = (gradeStr = '') => {
  if (!hasValidGrade(gradeStr)) return null;
  const g = gradeStr.toString().toLowerCase().trim();

  if (g === '5' || g === 'отлично' || g === 'зачтено' || g === 'зачет' || g === 'зачёт') {
    return { type: 'success', text: gradeStr || 'Зачтено' };
  }
  if (g === '4' || g === 'хорошо') {
    return { type: 'secondary', text: gradeStr };
  }
  if (g === '3' || g === 'удовлетворительно' || g === 'удовл.') {
    return { type: 'warning', text: gradeStr };
  }
  if (g === '2' || g === 'неудовлетворительно' || g === 'не зачтено' || g === 'незачет') {
    return { type: 'danger', text: gradeStr };
  }
  return { type: 'secondary', text: gradeStr };
};

// Helper for control type badge
const getControlTypeInfo = (typeStr = '') => {
  const t = (typeStr || '').toLowerCase().trim();
  if (t.includes('экзамен')) {
    return {
      label: 'Экзамен',
      colorClass: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
      badgeType: 'danger',
    };
  }
  if (t.includes('дифф') || t.includes('дифференцирован')) {
    return {
      label: 'Дифф. зачёт',
      colorClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
      badgeType: 'secondary',
    };
  }
  if (t.includes('зачет') || t.includes('зачёт')) {
    return {
      label: 'Зачёт',
      colorClass: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
      badgeType: 'secondary',
    };
  }
  if (t.includes('курсов')) {
    return {
      label: 'Курсовая работа',
      colorClass: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
      badgeType: 'warning',
    };
  }
  return {
    label: typeStr || 'Контроль',
    colorClass: 'bg-gray-500/10 text-textMuted dark:text-[#8E98A8] border-border',
    badgeType: 'default',
  };
};

// Helper for exam/credit date status
const getExamDateInfo = (dateStr) => {
  const formatted = formatDisplayDate(dateStr);
  if (!formatted) {
    return {
      status: 'pending',
      formattedText: 'Дата уточняется',
      subtext: 'Будет назначена кафедрой',
      isKnown: false,
    };
  }

  let diffDays = null;
  let isFuture = false;
  let isToday = false;

  try {
    let d = null;
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateStr)) {
      const [dd, mm, yyyy] = dateStr.split('.');
      d = new Date(`${yyyy}-${mm}-${dd}`);
    } else {
      d = new Date(dateStr);
    }
    if (!isNaN(d.getTime())) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      d.setHours(0, 0, 0, 0);
      const diffMs = d.getTime() - today.getTime();
      diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
      if (diffDays === 0) isToday = true;
      else if (diffDays > 0) isFuture = true;
    }
  } catch (_) {}

  return {
    status: 'appointed',
    formattedText: formatted,
    subtext: isToday ? 'Сегодня!' : isFuture ? `через ${diffDays} дн.` : null,
    isKnown: true,
    isToday,
    isFuture,
    diffDays,
  };
};

export const RecordbookPage = () => {
  const { user } = useAuth();

  const getCachedRecordbook = () => cacheService.get('recordbook');
  const getCachedStudentInfo = () => cacheService.get('student_info');

  const initialRecordbook = getCachedRecordbook();
  const [rawRecordbook, setRawRecordbook] = useState(() => (Array.isArray(initialRecordbook) ? initialRecordbook : []));
  const [studentInfo, setStudentInfo] = useState(getCachedStudentInfo);

  // View toggle: false = 'По семестрам' | true = 'Вся зачётка'
  const [viewAllRecordbook, setViewAllRecordbook] = useState(false);

  // Determine current active course
  const currentCourse = useMemo(() => {
    const fromAuth = Number(user?.course || user?.curse);
    if (fromAuth && fromAuth > 0) return fromAuth;
    const fromInfo = Number(studentInfo?.course || studentInfo?.curse);
    if (fromInfo && fromInfo > 0) return fromInfo;
    const userSem = Number(user?.semester || studentInfo?.semester);
    if (userSem && userSem > 0) return Math.ceil(userSem / 2);
    if (Array.isArray(rawRecordbook) && rawRecordbook.length > 0) {
      const courses = rawRecordbook.map(e => Number(e.course || e.coures || Math.ceil(Number(e.semester) / 2)) || 0);
      return Math.max(...courses, 1);
    }
    return 1;
  }, [user, studentInfo, rawRecordbook]);

  // Semesters to show in buttons: STRICTLY up to the semesters of the current academic year
  // (e.g. for course 3: semesters 1, 2, 3, 4, 5, 6; NOT 7 and 8)
  const availableSemesters = useMemo(() => {
    const maxCurrentYearSem = Math.min(8, Math.max(1, currentCourse * 2));
    const sems = [];
    for (let s = 1; s <= maxCurrentYearSem; s++) {
      sems.push(s);
    }
    return sems;
  }, [currentCourse]);

  // Default selected semester: current active semester (e.g. 5 for Autumn semester of Course 3)
  const [selectedSemester, setSelectedSemester] = useState(() => {
    const userSem = Number(user?.semester || studentInfo?.semester);
    if (userSem && userSem > 0) return userSem;
    const month = new Date().getMonth(); // 0 = Jan, 8 = Sep
    const isAutumn = month >= 8 || month === 0;
    const estSem = isAutumn ? (currentCourse * 2 - 1) : (currentCourse * 2);
    return Math.min(estSem, Math.min(8, currentCourse * 2));
  });

  // Calculate course for selected semester: semester 1,2 => 1; 3,4 => 2; 5,6 => 3; 7,8 => 4
  const selectedCourse = useMemo(() => {
    if (!selectedSemester) return currentCourse;
    return Math.ceil(selectedSemester / 2);
  }, [selectedSemester, currentCourse]);

  // Progress disciplines state for current semester
  const [progressDisciplines, setProgressDisciplines] = useState(() => {
    const c = Math.ceil((selectedSemester || 1) / 2);
    const cached = cacheService.get(`progress_${c}_${selectedSemester}`) ||
                   cacheService.get(`progress_with_lessons_c${c}_s${selectedSemester}`) ||
                   cacheService.get('progress_with_lessons_latest');
    if (cached) {
      const list = filterSemesterProgress(cached.disciplines || cached, c, selectedSemester);
      return list || [];
    }
    return [];
  });

  const [isLoading, setIsLoading] = useState(() => !initialRecordbook || !initialRecordbook.length);
  const [error, setError] = useState(null);

  // Load progress disciplines whenever selected semester changes
  useEffect(() => {
    let isCancelled = false;

    const loadSemesterProgress = async () => {
      if (!selectedSemester) return;
      const c = Math.ceil(selectedSemester / 2);

      // Check cache first
      const cached = cacheService.get(`progress_${c}_${selectedSemester}`) ||
                     cacheService.get(`progress_with_lessons_c${c}_s${selectedSemester}`) ||
                     cacheService.get('progress_with_lessons_latest');
      if (cached) {
        const filtered = filterSemesterProgress(cached.disciplines || cached, c, selectedSemester);
        if (filtered && filtered.length > 0 && !isCancelled) {
          setProgressDisciplines(filtered);
        }
      }

      try {
        const res = await lkService.getProgress(c, selectedSemester);
        if (res && !isCancelled) {
          const filtered = filterSemesterProgress(res, c, selectedSemester);
          if (filtered && filtered.length > 0) {
            setProgressDisciplines(filtered);
          }
        }
      } catch (_) {}
    };

    loadSemesterProgress();

    return () => {
      isCancelled = true;
    };
  }, [selectedSemester]);

  // 1. Disciplines strictly for selected semester (matching semester, never falling back to another semester)
  const currentSemesterDisciplines = useMemo(() => {
    if (!selectedSemester) return [];

    // Filter recordbook items strictly belonging to selected semester
    const fromRecordbook = (rawRecordbook || []).filter(e => {
      const s = Number(e.semester);
      if (s === selectedSemester) return true;
      // In case 1C stored semester relative to course (1 or 2):
      const c = Number(e.course || e.coures);
      if (c && c === selectedCourse) {
        const relativeSem = (selectedSemester % 2 === 1) ? 1 : 2;
        if (s === relativeSem) return true;
      }
      return false;
    });

    const fromProg = Array.isArray(progressDisciplines) ? progressDisciplines : [];

    // If recordbook has entries, use them and enrich with dates/teachers from progress
    if (fromRecordbook.length > 0) {
      return fromRecordbook.map(rbItem => {
        const cleanName = (rbItem.discipline || rbItem.name || '').toLowerCase().trim();
        const progMatch = fromProg.find(p => {
          const pName = (p.discipline || p.name || '').toLowerCase().trim();
          return pName === cleanName || pName.includes(cleanName) || cleanName.includes(pName);
        });

        return {
          ...rbItem,
          date: rbItem.date || progMatch?.date,
          teacher: rbItem.teacher || (Array.isArray(progMatch?.professors) ? progMatch.professors.join(', ') : progMatch?.teacher),
          type: rbItem.type || progMatch?.type,
        };
      });
    }

    // If recordbook does not have entries yet (e.g. current upcoming 3rd course session):
    // Use disciplines from progress!
    if (fromProg.length > 0) {
      return fromProg.map(p => ({
        guid: p.guid || p.disciplineId || p.id,
        discipline: p.discipline || p.name,
        type: p.type || 'Экзамен',
        date: p.date,
        teacher: Array.isArray(p.professors) ? p.professors.join(', ') : (p.teacher || ''),
        grade: p.grade || p.mark || '',
        semester: selectedSemester,
        course: selectedCourse,
      }));
    }

    return [];
  }, [rawRecordbook, progressDisciplines, selectedSemester, selectedCourse]);

  // 2. All graded entries for "Вся зачётка"
  const gradedEntries = useMemo(() => {
    if (!Array.isArray(rawRecordbook)) return [];
    return rawRecordbook.filter(entry => hasValidGrade(entry.grade || entry.mark));
  }, [rawRecordbook]);

  const loadRecordbookData = async () => {
    const hasCached = Array.isArray(rawRecordbook) && rawRecordbook.length > 0;
    if (!hasCached) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const [recordbookResp, studentInfoResp, progressResp] = await Promise.allSettled([
        lkService.getRecordbook(),
        lkService.getStudentInfo(),
        lkService.getProgress(selectedCourse, selectedSemester),
      ]);

      if (recordbookResp.status === 'fulfilled' && Array.isArray(recordbookResp.value)) {
        setRawRecordbook(recordbookResp.value);
      }
      if (studentInfoResp.status === 'fulfilled' && studentInfoResp.value) {
        setStudentInfo(studentInfoResp.value);
      }
      if (progressResp.status === 'fulfilled' && progressResp.value) {
        const filtered = filterSemesterProgress(progressResp.value, selectedCourse, selectedSemester);
        if (filtered && filtered.length > 0) {
          setProgressDisciplines(filtered);
        }
      }
    } catch (err) {
      setError(err.message || 'Не удалось загрузить данные зачётной книжки');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRecordbookData();

    const handlePull = () => {
      loadRecordbookData();
    };
    window.addEventListener('app-pull-to-refresh', handlePull);
    return () => window.removeEventListener('app-pull-to-refresh', handlePull);
  }, []);

  return (
    <div className="space-y-6 pb-8 w-full max-w-full overflow-hidden">
      {/* Header with Switcher: По семестрам | Вся зачётка */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-dark dark:text-white">Зачётная книжка</h1>
          <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-0.5">
            Результаты экзаменационных сессий, зачётов и предметы текущего учебного плана
          </p>
        </div>

        {/* View toggle (only show if there are records) */}
        {(gradedEntries.length > 0 || rawRecordbook.length > 0) && (
          <div className="flex items-center bg-card dark:bg-[#1F2430] border border-border dark:border-[#2B3242] rounded-xl p-1 self-start sm:self-auto shadow-sm">
            <button
              onClick={() => setViewAllRecordbook(false)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                !viewAllRecordbook
                  ? 'bg-primary dark:bg-[#1E6685] text-white shadow-sm'
                  : 'text-textMuted dark:text-[#8E98A8] hover:text-dark dark:hover:text-white'
              }`}
            >
              По семестрам
            </button>
            <button
              onClick={() => setViewAllRecordbook(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                viewAllRecordbook
                  ? 'bg-primary dark:bg-[#1E6685] text-white shadow-sm'
                  : 'text-textMuted dark:text-[#8E98A8] hover:text-dark dark:hover:text-white'
              }`}
            >
              Вся зачётка
            </button>
          </div>
        )}
      </div>

      {/* Semester filter bar: strictly up to semesters of current year */}
      {!viewAllRecordbook && availableSemesters.length > 0 && selectedSemester && (
        <Card className="p-3.5 sm:p-4 w-full max-w-full overflow-hidden dark:bg-[#1F2430] dark:border-[#2B3242]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center justify-between sm:justify-start space-x-3 shrink-0">
              <span className="text-xs font-bold text-textMuted dark:text-[#8E98A8] uppercase tracking-wider">
                Семестр:
              </span>
              {selectedCourse && (
                <div className="sm:hidden flex items-center space-x-1.5 text-xs">
                  <span className="text-textMuted dark:text-[#8E98A8] font-medium">Курс:</span>
                  <span className="font-bold text-dark dark:text-white px-2 py-0.5 rounded-lg bg-bg dark:bg-[#181C26] border border-border dark:border-[#2B3242]">
                    {selectedCourse} курс
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 max-w-full no-scrollbar min-w-0">
              {availableSemesters.map(s => {
                const isSelected = selectedSemester === s;
                return (
                  <button
                    key={s}
                    onClick={() => setSelectedSemester(s)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                      isSelected
                        ? 'bg-primary dark:bg-[#1E6685] text-white shadow-sm ring-1 ring-white/20'
                        : 'bg-bg dark:bg-[#181C26] text-textMuted dark:text-[#8E98A8] hover:text-dark dark:hover:text-white border border-border dark:border-[#2B3242]'
                    }`}
                  >
                    {s} сем.
                  </button>
                );
              })}
            </div>

            {selectedCourse && (
              <div className="hidden sm:flex items-center space-x-2 text-xs shrink-0">
                <span className="text-textMuted dark:text-[#8E98A8] font-medium">Курс:</span>
                <span className="font-bold text-dark dark:text-white px-2 py-0.5 rounded-lg bg-bg dark:bg-[#181C26] border border-border dark:border-[#2B3242]">
                  {selectedCourse} курс
                </span>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Content */}
      {isLoading ? (
        <Card className="p-12 text-center dark:bg-[#1F2430] dark:border-[#2B3242]">
          <LoadingSpinner size={10} text="Загрузка зачётной книжки..." />
        </Card>
      ) : error ? (
        <ErrorMessage message={error} onRetry={loadRecordbookData} />
      ) : !viewAllRecordbook ? (
        /* Semester-specific Disciplines */
        currentSemesterDisciplines.length === 0 ? (
          <Card className="p-12 text-center dark:bg-[#1F2430] dark:border-[#2B3242]">
            <div className="w-16 h-16 rounded-full bg-accent/10 dark:bg-[#22869A]/20 mx-auto flex items-center justify-center text-accent dark:text-[#22869A] mb-4">
              <Icons.BookOpen size={32} />
            </div>
            <h3 className="text-lg font-bold text-dark dark:text-white">
              Нет записей за {selectedSemester} семестр ({selectedCourse} курс)
            </h3>
            <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1">
              Выберите другой семестр или перейдите в режим «Вся зачётка».
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {currentSemesterDisciplines.map((entry, idx) => {
              const gradeInfo = getGradeBadge(entry.grade || entry.mark);
              const controlInfo = getControlTypeInfo(entry.type);
              const dateInfo = getExamDateInfo(entry.date);
              const isPassed = Boolean(gradeInfo);

              return (
                <Card key={entry.guid || entry.id || idx} className="p-4 sm:p-5 dark:bg-[#1F2430] dark:border-[#2B3242]">
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-[200px]">
                      <h3 className="font-bold text-base sm:text-lg text-dark dark:text-white">
                        {entry.discipline || entry.name}
                      </h3>
                      {entry.year && (
                        <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-0.5">Учебный год: {entry.year}</p>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      {gradeInfo ? (
                        <Badge type={gradeInfo.type}>
                          {gradeInfo.text}
                        </Badge>
                      ) : (
                        <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full border border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10">
                          В плане сессии
                        </span>
                      )}
                      <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full border ${controlInfo.colorClass}`}>
                        {controlInfo.label}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between text-xs text-textMuted dark:text-[#8E98A8] pt-3 border-t border-border dark:border-[#2B3242] mt-3 gap-2">
                    <span className="font-medium text-secondary dark:text-[#38BDF8]">
                      {entry.teacher || 'Преподаватель кафедры'}
                    </span>

                    {dateInfo.isKnown ? (
                      <div className="flex items-center space-x-1.5 font-semibold text-textMuted dark:text-[#8E98A8]">
                        <Icons.Calendar size={13} className="text-primary dark:text-[#38BDF8]" />
                        <span>{isPassed ? 'Сдано:' : 'Дата:'} {dateInfo.formattedText}</span>
                        {dateInfo.subtext && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            dateInfo.isToday
                              ? 'bg-rose-500 text-white animate-pulse'
                              : 'bg-primary/20 text-primary dark:text-[#38BDF8]'
                          }`}>
                            {dateInfo.subtext}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-textMuted dark:text-[#8E98A8] flex items-center space-x-1">
                        <Icons.Clock size={13} />
                        <span>Дата уточняется</span>
                      </span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )
      ) : (
        /* All Graded Recordbook Entries */
        <div className="space-y-3">
          {gradedEntries.length === 0 ? (
            <Card className="p-12 text-center dark:bg-[#1F2430] dark:border-[#2B3242]">
              <div className="w-16 h-16 rounded-full bg-accent/10 dark:bg-[#22869A]/20 mx-auto flex items-center justify-center text-accent dark:text-[#22869A] mb-4">
                <Icons.BookOpen size={32} />
              </div>
              <h3 className="text-lg font-bold text-dark dark:text-white">
                Зачётная книжка пуста
              </h3>
              <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1">
                Оценки за экзамены и зачёты появятся здесь сразу после сдачи сессии и внесения в электронную ведомость.
              </p>
            </Card>
          ) : (
            gradedEntries.map((entry, idx) => {
              const gradeInfo = getGradeBadge(entry.grade || entry.mark);
              const validDate = formatDisplayDate(entry.date);
              const controlInfo = getControlTypeInfo(entry.type);

              return (
                <Card key={entry.guid || entry.id || idx} className="p-4 dark:bg-[#1F2430] dark:border-[#2B3242]">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div>
                      <h4 className="font-bold text-base text-dark dark:text-white">{entry.discipline || entry.name}</h4>
                      <div className="flex items-center space-x-2 mt-1 text-xs text-textMuted dark:text-[#8E98A8]">
                        {entry.semester && <span>Семестр {entry.semester}</span>}
                        {controlInfo.label && <span>• {controlInfo.label}</span>}
                        {validDate && <span>• {validDate}</span>}
                      </div>
                    </div>
                    {gradeInfo && (
                      <Badge type={gradeInfo.type} className="shrink-0">
                        {gradeInfo.text}
                      </Badge>
                    )}
                  </div>
                  {entry.teacher && (
                    <p className="text-xs text-secondary dark:text-[#38BDF8] mt-2 pt-2 border-t border-border dark:border-[#2B3242]">
                      {entry.teacher}
                    </p>
                  )}
                </Card>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
