import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { lkService, filterSemesterProgress, detectActiveSemester, formatDisplayDate, cacheService } from '../../api';
import { Card } from '../../components/common/Card';
import { Badge } from '../../components/common/Badge';
import { Icons } from '../../components/common/Icons';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { ErrorMessage } from '../../components/common/ErrorMessage';

export const RecordbookPage = () => {
  const { user } = useAuth();

  const [selectedCourse, setSelectedCourse] = useState(Number(user?.course || 1));
  const [selectedSemester, setSelectedSemester] = useState(Number(user?.semester || 1));
  const [hasDetectedSemester, setHasDetectedSemester] = useState(false);

  const getCachedProgress = () => cacheService.get(`progress_${selectedCourse}_${selectedSemester}`) || cacheService.get('progress_all_all');
  const getCachedRecordbook = () => cacheService.get('recordbook');

  const initialRecordbook = getCachedRecordbook();
  const initialProgress = getCachedProgress();

  const [recordbookEntries, setRecordbookEntries] = useState(() => Array.isArray(initialRecordbook) ? initialRecordbook : []);
  const [sessionDisciplines, setSessionDisciplines] = useState(() => {
    if (Array.isArray(initialProgress) && initialProgress.length > 0) {
      return filterSemesterProgress(initialProgress, selectedCourse, selectedSemester);
    }
    return [];
  });
  const [viewAllRecordbook, setViewAllRecordbook] = useState(false);

  const [isLoading, setIsLoading] = useState(() => (!initialRecordbook || !initialRecordbook.length) && (!initialProgress || !initialProgress.length));
  const [error, setError] = useState(null);

  const loadRecordbookData = async () => {
    const hasCached = (Array.isArray(recordbookEntries) && recordbookEntries.length > 0) || (Array.isArray(sessionDisciplines) && sessionDisciplines.length > 0);
    if (!hasCached) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const [progressResp, recordbookResp] = await Promise.allSettled([
        lkService.getProgress(selectedCourse, selectedSemester),
        lkService.getRecordbook()
      ]);

      // 1. Process session disciplines
      if (progressResp.status === 'fulfilled' && progressResp.value) {
        const rawProgress = progressResp.value;

        // Auto-detect the active semester on first load (ensures autumn = 5, not future spring 6)
        if (!hasDetectedSemester && Array.isArray(rawProgress) && rawProgress.length > 0) {
          const active = detectActiveSemester(rawProgress, user);
          if (active.semester && active.semester !== selectedSemester) {
            setSelectedSemester(active.semester);
            setSelectedCourse(active.course);
            setHasDetectedSemester(true);
            const filtered = filterSemesterProgress(rawProgress, active.course, active.semester);
            setSessionDisciplines(filtered);
            return;
          }
          setHasDetectedSemester(true);
        }

        const filtered = filterSemesterProgress(
          rawProgress,
          selectedCourse,
          selectedSemester
        );
        setSessionDisciplines(filtered);
      } else {
        setSessionDisciplines([]);
      }

      // 2. Process recordbook
      if (recordbookResp.status === 'fulfilled' && Array.isArray(recordbookResp.value)) {
        setRecordbookEntries(recordbookResp.value);
      } else {
        setRecordbookEntries([]);
      }
    } catch (err) {
      setError(err.message || 'Не удалось загрузить данные сессии и зачётной книжки');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRecordbookData();
  }, [selectedCourse, selectedSemester]);

  // Helper for grade badge color: returns null if no official grade exists (removes "В плане")
  const getGradeBadge = (gradeStr = '') => {
    if (!gradeStr) return null;
    const g = gradeStr.toString().toLowerCase().trim();
    if (!g || g === 'в плане' || g === 'план' || g === '0' || g === '—' || g === '-') {
      return null;
    }

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

  // Find official grade in recordbook if available
  const findOfficialRecord = (disciplineName) => {
    if (!disciplineName || !recordbookEntries.length) return null;
    const cleanName = disciplineName.trim().toLowerCase();
    return recordbookEntries.find(r => {
      const rName = (r.discipline || r.name || '').trim().toLowerCase();
      const rSem = Number(r.semester || 0);
      return (rName === cleanName || rName.includes(cleanName) || cleanName.includes(rName)) &&
        (!rSem || rSem === selectedSemester);
    });
  };

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

        {/* View toggle */}
        <div className="flex items-center bg-card dark:bg-[#1F2430] border border-border dark:border-[#2B3242] rounded-xl p-1 self-start sm:self-auto shadow-sm">
          <button
            onClick={() => setViewAllRecordbook(false)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              !viewAllRecordbook ? 'bg-primary dark:bg-[#1E6685] text-white shadow-sm' : 'text-textMuted dark:text-[#8E98A8] hover:text-dark dark:hover:text-white'
            }`}
          >
            По семестрам
          </button>
          <button
            onClick={() => setViewAllRecordbook(true)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              viewAllRecordbook ? 'bg-primary dark:bg-[#1E6685] text-white shadow-sm' : 'text-textMuted dark:text-[#8E98A8] hover:text-dark dark:hover:text-white'
            }`}
          >
            Вся зачётка
          </button>
        </div>
      </div>

      {/* Semester filter bar */}
      {!viewAllRecordbook && (
        <Card className="p-3.5 sm:p-4 w-full max-w-full overflow-hidden dark:bg-[#1F2430] dark:border-[#2B3242]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center justify-between sm:justify-start space-x-3 shrink-0">
              <span className="text-xs font-bold text-textMuted dark:text-[#8E98A8] uppercase tracking-wider">
                Семестр:
              </span>
              <div className="sm:hidden flex items-center space-x-1.5 text-xs">
                <span className="text-textMuted dark:text-[#8E98A8] font-medium">Курс:</span>
                <span className="font-bold text-dark dark:text-white px-2 py-0.5 rounded-lg bg-bg dark:bg-[#181C26] border border-border dark:border-[#2B3242]">
                  {selectedCourse} курс
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 max-w-full no-scrollbar min-w-0">
              {[1, 2, 3, 4, 5, 6, 7, 8].map(s => {
                const isSelected = selectedSemester === s;
                return (
                  <button
                    key={s}
                    onClick={() => {
                      setSelectedSemester(s);
                      setSelectedCourse(Math.ceil(s / 2));
                    }}
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

            <div className="hidden sm:flex items-center space-x-2 text-xs shrink-0">
              <span className="text-textMuted dark:text-[#8E98A8] font-medium">Курс:</span>
              <span className="font-bold text-dark dark:text-white px-2 py-0.5 rounded-lg bg-bg dark:bg-[#181C26] border border-border dark:border-[#2B3242]">
                {selectedCourse} курс
              </span>
            </div>
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
        /* Semester-specific Session Disciplines */
        sessionDisciplines.length === 0 ? (
          <Card className="p-12 text-center dark:bg-[#1F2430] dark:border-[#2B3242]">
            <div className="w-16 h-16 rounded-full bg-accent/10 dark:bg-[#22869A]/20 mx-auto flex items-center justify-center text-accent dark:text-[#22869A] mb-4">
              <Icons.BookOpen size={32} />
            </div>
            <h3 className="text-lg font-bold text-dark dark:text-white">
              Нет данных сессии за {selectedSemester} семестр ({selectedCourse} курс)
            </h3>
            <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1">
              Выберите другой семестр или перейдите в режим «Вся зачётка».
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {sessionDisciplines.map((disc, idx) => {
              const officialRec = findOfficialRecord(disc.name || disc.discipline);
              const gradeInfo = getGradeBadge(
                officialRec?.grade || officialRec?.mark || disc.grade || disc.mark || ''
              );
              const validDate = formatDisplayDate(officialRec?.date || disc.date);

              return (
                <Card key={disc.guid || disc.id || idx} className="p-4 sm:p-5 dark:bg-[#1F2430] dark:border-[#2B3242]">
                  <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-[200px]">
                      <h3 className="font-bold text-base sm:text-lg text-dark dark:text-white">
                        {disc.name || disc.discipline}
                      </h3>
                      {disc.year && (
                        <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-0.5">Учебный год: {disc.year}</p>
                      )}
                    </div>

                    <div className="flex items-center space-x-2 shrink-0">
                      {gradeInfo && (
                        <Badge type={gradeInfo.type}>
                          {gradeInfo.text}
                        </Badge>
                      )}
                      {disc.type && (
                        <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full border border-border dark:border-[#2B3242] text-textMuted dark:text-[#8E98A8] bg-transparent">
                          {disc.type}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between text-xs text-textMuted dark:text-[#8E98A8] pt-3 border-t border-border dark:border-[#2B3242] mt-3 gap-2">
                    <span className="font-medium text-secondary dark:text-[#38BDF8]">
                      {Array.isArray(disc.professors) && disc.professors.length > 0
                        ? disc.professors.join(', ')
                        : officialRec?.teacher || disc.teacher || 'Преподаватель кафедры'}
                    </span>

                    {/* Only display date if it's a real valid date (never 0001-01-01) */}
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
        /* All Recordbook Entries */
        recordbookEntries.length === 0 ? (
          <Card className="p-12 text-center dark:bg-[#1F2430] dark:border-[#2B3242]">
            <h3 className="text-lg font-bold text-dark dark:text-white">Зачётная книжка пуста</h3>
            <p className="text-xs text-textMuted dark:text-[#8E98A8] mt-1">Данные об аттестациях ещё не внесены в электронную ведомость.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {recordbookEntries.map((entry, idx) => {
              const gradeInfo = getGradeBadge(entry.grade || entry.mark);
              const validDate = formatDisplayDate(entry.date);
              return (
                <Card key={idx} className="p-4 dark:bg-[#1F2430] dark:border-[#2B3242]">
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
        )
      )}
    </div>
  );
};
