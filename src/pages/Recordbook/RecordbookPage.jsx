import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { lkService, formatDisplayDate, cacheService } from '../../api';
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

export const RecordbookPage = () => {
  const { user } = useAuth();

  const getCachedRecordbook = () => cacheService.get('recordbook');
  const initialRecordbook = getCachedRecordbook();

  const [rawRecordbook, setRawRecordbook] = useState(() => Array.isArray(initialRecordbook) ? initialRecordbook : []);
  const [viewAllRecordbook, setViewAllRecordbook] = useState(false);
  const [isLoading, setIsLoading] = useState(() => !initialRecordbook || !initialRecordbook.length);
  const [error, setError] = useState(null);

  // 1. Filter raw records: KEEP ONLY entries that have a REAL official session grade/mark
  const gradedEntries = useMemo(() => {
    if (!Array.isArray(rawRecordbook)) return [];
    return rawRecordbook.filter(entry => hasValidGrade(entry.grade || entry.mark));
  }, [rawRecordbook]);

  // 2. Semesters: ONLY include semesters where at least one subject has a real grade
  const availableSemesters = useMemo(() => {
    const sems = new Set();
    gradedEntries.forEach(entry => {
      const s = Number(entry.semester);
      if (s > 0 && Number.isInteger(s)) {
        sems.add(s);
      }
    });
    return Array.from(sems).sort((a, b) => a - b);
  }, [gradedEntries]);

  // 3. Selected semester: defaults to the latest semester that actually has grades
  const [selectedSemester, setSelectedSemester] = useState(() => {
    if (availableSemesters.length > 0) {
      return availableSemesters[availableSemesters.length - 1];
    }
    return null;
  });

  // Keep selected semester in sync if availableSemesters updates
  useEffect(() => {
    if (availableSemesters.length > 0) {
      if (!selectedSemester || !availableSemesters.includes(selectedSemester)) {
        setSelectedSemester(availableSemesters[availableSemesters.length - 1]);
      }
    } else {
      setSelectedSemester(null);
    }
  }, [availableSemesters, selectedSemester]);

  // Determine course for currently selected semester
  const selectedCourse = useMemo(() => {
    if (!selectedSemester) return null;
    const entry = gradedEntries.find(e => Number(e.semester) === selectedSemester);
    return Number(entry?.course || entry?.coures) || Math.ceil(selectedSemester / 2);
  }, [gradedEntries, selectedSemester]);

  // 4. Disciplines for the selected semester: STRICTLY only items with real grades
  const currentSemesterDisciplines = useMemo(() => {
    if (!selectedSemester) return [];
    return gradedEntries.filter(e => Number(e.semester) === selectedSemester);
  }, [gradedEntries, selectedSemester]);

  const loadRecordbookData = async () => {
    const hasCached = Array.isArray(rawRecordbook) && rawRecordbook.length > 0;
    if (!hasCached) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const recordbookResp = await lkService.getRecordbook();
      if (Array.isArray(recordbookResp)) {
        setRawRecordbook(recordbookResp);
      } else {
        setRawRecordbook([]);
      }
    } catch (err) {
      setError(err.message || 'Не удалось загрузить данные зачётной книжки');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRecordbookData();
  }, []);

  return (
    <div className="space-y-6 pb-8 w-full max-w-full overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-dark dark:text-white">Зачётная книжка</h1>
          <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-0.5">
            Результаты экзаменационных сессий и зачётов
          </p>
        </div>

        {/* View toggle (only show if there are graded records) */}
        {gradedEntries.length > 0 && (
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

      {/* Semester filter bar: ONLY DISPLAYED IF THERE ARE SEMESTERS WITH GRADES */}
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
      ) : gradedEntries.length === 0 ? (
        /* Entire recordbook empty: no grades yet for any semester */
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
      ) : !viewAllRecordbook ? (
        /* Semester-specific Graded Disciplines */
        currentSemesterDisciplines.length === 0 ? (
          <Card className="p-12 text-center dark:bg-[#1F2430] dark:border-[#2B3242]">
            <div className="w-16 h-16 rounded-full bg-accent/10 dark:bg-[#22869A]/20 mx-auto flex items-center justify-center text-accent dark:text-[#22869A] mb-4">
              <Icons.BookOpen size={32} />
            </div>
            <h3 className="text-lg font-bold text-dark dark:text-white">
              Нет оценок за {selectedSemester} семестр
            </h3>
            <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1">
              Выберите другой семестр или перейдите в режим «Вся зачётка».
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {currentSemesterDisciplines.map((entry, idx) => {
              const gradeInfo = getGradeBadge(entry.grade || entry.mark);
              const validDate = formatDisplayDate(entry.date);

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
                      {gradeInfo && (
                        <Badge type={gradeInfo.type}>
                          {gradeInfo.text}
                        </Badge>
                      )}
                      {entry.type && (
                        <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full border border-border dark:border-[#2B3242] text-textMuted dark:text-[#8E98A8] bg-transparent">
                          {entry.type}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between text-xs text-textMuted dark:text-[#8E98A8] pt-3 border-t border-border dark:border-[#2B3242] mt-3 gap-2">
                    <span className="font-medium text-secondary dark:text-[#38BDF8]">
                      {entry.teacher || 'Преподаватель кафедры'}
                    </span>

                    {validDate && (
                      <span className="font-semibold text-textMuted dark:text-[#8E98A8]">
                        Сдано: {validDate}
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
          {gradedEntries.map((entry, idx) => {
            const gradeInfo = getGradeBadge(entry.grade || entry.mark);
            const validDate = formatDisplayDate(entry.date);
            return (
              <Card key={entry.guid || entry.id || idx} className="p-4 dark:bg-[#1F2430] dark:border-[#2B3242]">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div>
                    <h4 className="font-bold text-base text-dark dark:text-white">{entry.discipline || entry.name}</h4>
                    <div className="flex items-center space-x-2 mt-1 text-xs text-textMuted dark:text-[#8E98A8]">
                      {entry.semester && <span>Семестр {entry.semester}</span>}
                      {entry.type && <span>• {entry.type}</span>}
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
          })}
        </div>
      )}
    </div>
  );
};
