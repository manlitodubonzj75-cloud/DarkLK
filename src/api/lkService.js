import { apiClient } from './client';
import { cacheService } from './cacheService';

/**
 * Format a Date object to YYYY-MM-DD
 */
export function formatISODate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Safely format a date for display.
 * Returns null if the date is a placeholder like '0001-01-01', invalid, or earlier than 2000.
 */
export function formatDisplayDate(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (s.startsWith('0001') || s.startsWith('0000') || s.startsWith('1970')) {
    return null;
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime()) || d.getFullYear() < 2000) {
    return null;
  }
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

/**
 * Robust float score parser (handles numbers, strings with Russian comma like "3,75", nulls)
 */
export function parseScore(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'string') {
    const cleaned = val.replace(',', '.').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

/**
 * Robust integer grade parser (handles 5, 4, 3, 2, strings, ignores 0)
 */
export function parseGrade(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return Math.round(val);
  if (typeof val === 'string') {
    const cleaned = val.replace(',', '.').trim();
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

/**
 * Get Monday of a given date's week
 */
/**
 * Format lesson time from datetime/time strings (e.g. "14.09.2026 09:00:00", "2026-09-14T09:00:00", "09:00:00", "09:00")
 * to clean "H:mm" format (e.g. "9:00", "11:30").
 */
export function formatLessonTime(timeStr) {
  if (!timeStr) return "--:--";
  const s = String(timeStr).trim();
  if (!s) return "--:--";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "--:--";

  const match = s.match(/(?:^|[\sT])(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (match) {
    const hours = parseInt(match[1], 10);
    const minutes = match[2];
    return `${hours}:${minutes}`;
  }
  return s.length >= 5 ? s.substring(0, 5) : s;
}

export function getMondayOfWeek(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

/**
 * Normalize discipline name string for robust matching across endpoints
 */
export function normalizeDisciplineName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[@()«»"'\s\-_]/g, '')
    .trim();
}

/**
 * Detect the actual current semester based on calendar date, curriculum list, and user data.
 * Educational calendar rules in Russia:
 * - Autumn semester: September 1 – January 31 (months 8..11, 0) -> ODD semesters (1, 3, 5, 7)
 * - Spring semester: February 1 – August 31 (months 1..7) -> EVEN semesters (2, 4, 6, 8)
 */
export function detectActiveSemester(progressData = [], user = null, studentInfo = null) {
  const now = new Date();
  const month = now.getMonth(); // 0 = Jan, 8 = Sep, 11 = Dec
  const isAutumn = month >= 8 || month === 0;

  let userCourse = Number(user?.course || studentInfo?.course || 0);
  let userSem = Number(user?.semester || studentInfo?.semester || 0);

  // If user Course is known, verify seasonal parity (autumn = odd, spring = even)
  if (userCourse > 0) {
    const expectedSem = isAutumn ? (userCourse * 2 - 1) : (userCourse * 2);
    // If userSem was not set or mismatched with current calendar season, correct it
    if (!userSem || (isAutumn && userSem % 2 === 0) || (!isAutumn && userSem % 2 === 1)) {
      userSem = expectedSem;
    }
  }

  if (Array.isArray(progressData) && progressData.length > 0) {
    // 1. Direct match by userSem if present in progressData
    if (userSem > 0) {
      const directMatch = progressData.find(s => {
        const sSem = Number(s.semester || 0);
        const sCourse = Number(s.coures || s.course || 0);
        return sSem === userSem && (!userCourse || !sCourse || sCourse === userCourse);
      });
      if (directMatch) {
        return {
          course: Number(directMatch.coures || directMatch.course || userCourse || 1),
          semester: userSem
        };
      }
    }

    // 2. Filter semesters that belong to the current season (autumn = odd, spring = even)
    const seasonalSemesters = progressData.filter(s => {
      const semNum = Number(s.semester || 0);
      return isAutumn ? (semNum % 2 === 1) : (semNum % 2 === 0);
    });

    if (seasonalSemesters.length > 0) {
      // Pick the latest semester of the current season (e.g. in September pick 5, never 6)
      let latestSeason = seasonalSemesters[0];
      seasonalSemesters.forEach(s => {
        if (Number(s.semester || 0) > Number(latestSeason.semester || 0)) {
          latestSeason = s;
        }
      });

      return {
        course: Number(latestSeason.coures || latestSeason.course || userCourse || 1),
        semester: Number(latestSeason.semester)
      };
    }

    // 3. Fallback: if last item is a future spring semester during autumn, pick the previous semester
    const lastItem = progressData[progressData.length - 1];
    const lastSem = Number(lastItem.semester || 0);
    if (isAutumn && lastSem % 2 === 0 && progressData.length > 1) {
      const prevItem = progressData[progressData.length - 2];
      return {
        course: Number(prevItem.coures || prevItem.course || 1),
        semester: Number(prevItem.semester || 1)
      };
    }

    return {
      course: Number(lastItem.coures || lastItem.course || 1),
      semester: lastSem
    };
  }

  // 4. Absolute fallback
  const finalCourse = userCourse || 1;
  const finalSem = userSem || (isAutumn ? (finalCourse * 2 - 1) : (finalCourse * 2));
  return {
    course: finalCourse,
    semester: finalSem
  };
}

/**
 * Filter raw /progress array to find the chosen semester's disciplines.
 */
export function filterSemesterProgress(data, targetCourse, targetSemester) {
  if (!Array.isArray(data)) return [];
  const cNum = Number(targetCourse);
  const sNum = Number(targetSemester);

  const matched = data.find(item => {
    const itemCourse = Number(item.coures || item.course || 0);
    const itemSemester = Number(item.semester || 0);
    return itemSemester === sNum && (!itemCourse || itemCourse === cNum);
  });

  if (matched && Array.isArray(matched.disciplines)) {
    return matched.disciplines;
  }

  // Fallback: flat list of disciplines (College format)
  if (data.length > 0 && (data[0].discipline || data[0].name) && !data[0].disciplines) {
    return data.filter(d => {
      const itemCourse = Number(d.course || 0);
      const itemSemester = Number(d.semester || 0);
      return (!itemCourse || itemCourse === cNum) && (!itemSemester || itemSemester === sNum);
    });
  }

  return [];
}

export const lkService = {
  /**
   * Schedule for a specific week: GET /schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
   */
  /**
   * Schedule for an arbitrary range (e.g. whole month): GET /schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
   */
  async getScheduleRange(from, to) {
    const cacheKey = `schedule_${from}_${to}`;

    return cacheService.withOfflineFallback(cacheKey, async () => {
      const [scheduleResp, consultationsResp] = await Promise.allSettled([
        apiClient(`/schedule?from=${from}&to=${to}`),
        apiClient(`/consultation/student?from=${from}&to=${to}`).catch(() => [])
      ]);

      const scheduleData = scheduleResp.status === "fulfilled" ? scheduleResp.value : [];
      const consultations = consultationsResp.status === "fulfilled" ? consultationsResp.value : [];

      return this.mergeScheduleWithConsultations(scheduleData, consultations);
    });
  },

  async getScheduleWeek(monday) {
    const mondayDate = new Date(monday);
    const sundayDate = new Date(mondayDate);
    sundayDate.setDate(mondayDate.getDate() + 6);

    const from = formatISODate(mondayDate);
    const to = formatISODate(sundayDate);
    const cacheKey = `schedule_${from}_${to}`;

    return cacheService.withOfflineFallback(cacheKey, async () => {
      const [scheduleResp, consultationsResp] = await Promise.allSettled([
        apiClient(`/schedule?from=${from}&to=${to}`),
        apiClient(`/consultation/student?from=${from}&to=${to}`).catch(() => [])
      ]);

      const scheduleData = scheduleResp.status === 'fulfilled' ? scheduleResp.value : [];
      const consultations = consultationsResp.status === 'fulfilled' ? consultationsResp.value : [];

      return this.mergeScheduleWithConsultations(scheduleData, consultations);
    });
  },

  mergeScheduleWithConsultations(scheduleDays = [], consultations = []) {
    if (!Array.isArray(scheduleDays)) return [];
    if (!Array.isArray(consultations) || consultations.length === 0) return scheduleDays;

    const daysMap = new Map();

    scheduleDays.forEach(day => {
      const dateKey = day.title || day.date || '';
      daysMap.set(dateKey, {
        title: dateKey,
        data: Array.isArray(day.data) ? [...day.data] : []
      });
    });

    consultations.forEach(slot => {
      const slotDate = slot.start ? slot.start.slice(0, 10) : (slot.day ? slot.day.slice(0, 10) : '');
      if (!slotDate) return;

      const consultationLesson = {
        id: `consultation_${slot.start || Math.random()}`,
        day: slotDate,
        start: slot.startConsultation || slot.start || '10:00',
        end: slot.endConsultation || slot.end || '11:30',
        groups: [],
        teacher: slot.teacherName || slot.teacher || 'Консультант',
        discipline: slot.disciplineName || slot.discipline || 'Консультация',
        type: 'Консультация',
        corps: slot.corps || '',
        auditory: slot.auditory || '',
        homeworkText: slot.themeName ? `Тема: ${slot.themeName}` : null
      };

      if (daysMap.has(slotDate)) {
        daysMap.get(slotDate).data.push(consultationLesson);
      } else {
        daysMap.set(slotDate, {
          title: slotDate,
          data: [consultationLesson]
        });
      }
    });

    const result = Array.from(daysMap.values());
    result.forEach(day => {
      day.data.sort((a, b) => {
        const timeA = (a.start || '').toString();
        const timeB = (b.start || '').toString();
        return timeA.localeCompare(timeB);
      });
    });

    return result;
  },

  async getProgress(course = null, semester = null) {
    let activeCourse = course;
    let activeSem = semester;

    if (!activeCourse || !activeSem) {
      try {
        const raw = localStorage.getItem("cached_user");
        if (raw) {
          const u = JSON.parse(raw);
          if (!activeCourse && u.course) activeCourse = u.course;
          if (!activeSem && u.semester) activeSem = u.semester;
        }
      } catch (_) {}
    }

    const params = [];
    if (activeCourse) params.push(`course=${activeCourse}`);
    if (activeSem) params.push(`semester=${activeSem}`);
    const query = params.length > 0 ? `?${params.join('&')}` : '';
    const cacheKey = `progress_${activeCourse || 'all'}_${activeSem || 'all'}`;

    return cacheService.withOfflineFallback(cacheKey, async () => {
      return apiClient(`/progress${query}`);
    });
  },

  async getProgressDetails(course = null, semester = null, disciplineId = null) {
    const params = [];
    if (disciplineId) params.push(`disciplineID=${disciplineId}`);
    if (course) params.push(`course=${course}`);
    if (semester) params.push(`semester=${semester}`);
    const query = params.length > 0 ? `?${params.join('&')}` : '';
    const cacheKey = `progress_details_${disciplineId || 'all'}_${course || 'all'}_${semester || 'all'}`;

    return cacheService.withOfflineFallback(cacheKey, async () => {
      try {
        const data = await apiClient(`/progress/details${query}`);
        if (Array.isArray(data) && data.length > 0) {
          return data;
        }
      } catch (e) {
        console.warn('Direct progress details query failed, trying fallback:', e.message);
      }

      if (query !== '') {
        try {
          const fallbackData = await apiClient('/progress/details');
          if (Array.isArray(fallbackData) && fallbackData.length > 0) {
            return fallbackData;
          }
        } catch (_) {}
      }

      return [];
    });
  },

  async getRecordbook() {
    return cacheService.withOfflineFallback('recordbook', async () => {
      return apiClient('/recordbook');
    });
  },

  async getStudentInfo() {
    return cacheService.withOfflineFallback('student_info', async () => {
      return apiClient('/student/info');
    });
  },

  async getGroupmates() {
    return cacheService.withOfflineFallback('student_group', async () => {
      return apiClient('/student/group');
    });
  },

  async getMyConsultations(from, to) {
    return cacheService.withOfflineFallback(`consultation_my_${from}_${to}`, async () => {
      return apiClient(`/consultation/student?from=${from}&to=${to}`);
    });
  },

  async bookConsultation(consultationData) {
    return apiClient("/consultation", {
      method: "POST",
      body: JSON.stringify(consultationData)
    });
  },

  async cancelConsultation(consultationData) {
    return apiClient("/consultation", {
      method: "PATCH",
      body: JSON.stringify(consultationData)
    });
  },

  async getConsultationThemes() {
    return cacheService.withOfflineFallback("consultation_themes", async () => {
      return apiClient("/consultation/theme");
    });
  },

  async getConsultationsForDisciplineTeacher(disciplineId, teacherId, from, to) {
    return cacheService.withOfflineFallback(`consultations_${disciplineId}_${teacherId}_${from}_${to}`, async () => {
      return apiClient(`/consultation?discipline=${disciplineId}&teacher=${teacherId}&from=${from}&to=${to}`);
    });
  },

  async getDisciplineTeachers(disciplineId) {
    return cacheService.withOfflineFallback(`teachers_${disciplineId}`, async () => {
      return apiClient(`/disciplines/${disciplineId}/teachers`);
    });
  },

  async getMyDisciplines() {
    return cacheService.withOfflineFallback("student_disciplines", async () => {
      return apiClient("/disciplines/student");
    });
  },

  async getNews() {
    return cacheService.withOfflineFallback('news_preview', async () => {
      return apiClient('/news/preview');
    });
  },

  async markNewsRead(newsId) {
    return apiClient(`/news/${newsId}/read`, { method: 'POST' });
  },

  async updatePrivacySettings(settings) {
    return apiClient('/student/access', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  },

  /**
   * FLUTTER PARITY getProgressWithLessons()
   * Retrieves student progress, verifies the active current semester (e.g. 5 in autumn, never 6),
   * performs parallel /progress/details queries by disciplineID (matching Flutter _fetchLessons),
   * extracts modules (with mediumScore), lessons (with ball/ratings), absences, and admission statuses.
   */
  async getProgressWithLessons(user = null) {
    // 1. Concurrent fetch of /progress and /student/info
    const [progressResult, studentInfoResult] = await Promise.allSettled([
      this.getProgress(),
      this.getStudentInfo().catch(() => ({}))
    ]);

    const rawProgress = progressResult.status === 'fulfilled' ? progressResult.value : [];
    const studentInfo = studentInfoResult.status === 'fulfilled' ? studentInfoResult.value : {};

    // 2. Accurately detect the active semester (Autumn = Odd e.g. 5, Spring = Even e.g. 6)
    const activeInfo = detectActiveSemester(rawProgress, user, studentInfo);
    const activeCourse = activeInfo.course;
    const activeSemester = activeInfo.semester;

    const cacheKey = `progress_with_lessons_c${activeCourse}_s${activeSemester}`;

    return cacheService.withOfflineFallback(cacheKey, async () => {
      let targetDisciplines = filterSemesterProgress(rawProgress, activeCourse, activeSemester);

      // 3. Fetch detailed modules for active semester:
      let bulkDetails = [];
      try {
        bulkDetails = await this.getProgressDetails(activeCourse, activeSemester);
      } catch (_) {}

      const detailsMap = new Map();

      if (Array.isArray(bulkDetails)) {
        bulkDetails.forEach(det => {
          const key = normalizeDisciplineName(det.discipline || det.name);
          if (key) detailsMap.set(key, det);
        });
      }

      // Mirror Flutter _fetchLessons: for each discipline, if details are missing or have empty modules,
      // query /progress/details?disciplineID=... in parallel
      if (targetDisciplines.length > 0) {
        const needsFetch = targetDisciplines.filter(d => {
          const key = normalizeDisciplineName(d.name || d.discipline);
          const existing = detailsMap.get(key);
          return !existing || !Array.isArray(existing.modules) || existing.modules.length === 0;
        });

        if (needsFetch.length > 0) {
          const fetchPromises = needsFetch.map(async (d) => {
            const guid = d.guid || d.disciplineId || d.disciplineID || d.id;
            if (!guid) return null;
            try {
              const res = await apiClient(`/progress/details?disciplineID=${guid}&course=${activeCourse}&semester=${activeSemester}`);
              const detObj = Array.isArray(res) ? res[0] : res;
              if (detObj) {
                const key = normalizeDisciplineName(detObj.discipline || d.name);
                return { key, data: detObj };
              }
            } catch (_) {}
            return null;
          });

          const results = await Promise.allSettled(fetchPromises);
          results.forEach(r => {
            if (r.status === 'fulfilled' && r.value && r.value.key) {
              detailsMap.set(r.value.key, r.value.data);
            }
          });
        }
      }

      // 4. Enrich disciplines with real modules, grades, and absence counts
      let totalPasses = 0;
      let allGrades = [];
      let allModuleScores = [];
      let unadmittedCount = 0;

      const baseList = targetDisciplines.length > 0 ? targetDisciplines : Array.from(detailsMap.values());

      const enrichedDisciplines = baseList.map((d, idx) => {
        const discName = (d.name || d.discipline || '').trim();
        const normName = normalizeDisciplineName(discName);

        let detail = detailsMap.get(normName);
        if (!detail) {
          for (const [k, v] of detailsMap.entries()) {
            if (k.includes(normName) || normName.includes(k)) {
              detail = v;
              break;
            }
          }
        }
        if (!detail && d.modules) {
          detail = d;
        }

        let passes = 0;
        let discGrades = [];
        let moduleScores = [];
        let rawModules = [];
        let access = true;
        let info = '';

        if (detail) {
          if (detail.accessTotal !== undefined) {
            access = detail.accessTotal === 1 || detail.accessTotal === true || String(detail.accessTotal).toLowerCase() === 'true';
          } else if (detail.access !== undefined) {
            access = detail.access === true || detail.access === 1;
          }

          info = (detail.info || detail.debtReport || '').toString().trim();
          rawModules = Array.isArray(detail.modules) ? detail.modules : [];

          // Parse University Modules
          rawModules.forEach(m => {
            const modScore = parseScore(m.mediumScore);
            const modName = (m.module || 'БМ').toString().trim();

            // ALWAYS keep the module for quick display (e.g. [БМ1: 0 б.])
            moduleScores.push({
              name: modName,
              score: modScore,
              displayScore: `${modScore} б.`
            });

            if (modScore > 0) {
              allModuleScores.push(modScore);
            }

            // Extract lesson grades and absences from themes
            if (Array.isArray(m.themes)) {
              m.themes.forEach(t => {
                if (Array.isArray(t.items)) {
                  t.items.forEach(it => {
                    const isMissed = it.missed === 1 || it.missed === '1' || it.turnout === false || it.turnout === 'false';
                    if (isMissed) {
                      passes++;
                      totalPasses++;
                    }

                    // Extract seminar lesson grade: check ball, ratings, grades
                    let grade = parseGrade(it.ball);
                    if (grade === 0 && it.ratings) {
                      const rList = Array.isArray(it.ratings) ? it.ratings : [it.ratings];
                      for (const r of rList) {
                        const parsed = parseGrade(r);
                        if (parsed > 0) { grade = parsed; break; }
                      }
                    }
                    if (grade === 0 && it.grades) {
                      const gList = Array.isArray(it.grades) ? it.grades : [it.grades];
                      for (const g of gList) {
                        const parsed = parseGrade(g);
                        if (parsed > 0) { grade = parsed; break; }
                      }
                    }

                    if (grade > 0) {
                      discGrades.push(grade);
                      allGrades.push(grade);
                    }
                  });
                }
              });
            }
          });
        } else {
          // College LK format
          if (d.flawGrape) {
            passes = Number(d.flawGrape) || 0;
            totalPasses += passes;
          }
          if (Array.isArray(d.lessons)) {
            d.lessons.forEach(l => {
              if (l.turnout === false || l.missed === 1 || l.missed === '1') {
                passes++;
                totalPasses++;
              }
              const rList = l.grades || l.ratings || [];
              if (Array.isArray(rList)) {
                rList.forEach(r => {
                  const g = parseGrade(r);
                  if (g > 0) {
                    discGrades.push(g);
                    allGrades.push(g);
                  }
                });
              }
            });
          }
        }

        if (!access) unadmittedCount++;

        // Subject Average Grade
        const avgGrade = discGrades.length > 0
          ? (discGrades.reduce((a, b) => a + b, 0) / discGrades.length).toFixed(2)
          : (moduleScores.some(m => m.score > 0)
              ? (moduleScores.reduce((sum, m) => sum + m.score, 0) / moduleScores.length).toFixed(2)
              : null);

        // Subject BARS Total
        const totalBars = moduleScores.reduce((sum, m) => sum + m.score, 0);

        return {
          id: d.guid || d.id || idx,
          name: discName,
          type: d.type || 'Дисциплина',
          professors: d.professors || (d.teacher ? [d.teacher] : []),
          access,
          info,
          passes,
          grades: discGrades,
          avgGrade,
          barsScore: totalBars > 0 ? totalBars.toFixed(2) : null,
          moduleScores,
          modules: rawModules
        };
      });

      // 5. Passes fallback to studentInfo
      if (studentInfo && typeof studentInfo.passes === 'number' && (totalPasses === 0 || studentInfo.passes > totalPasses)) {
        totalPasses = studentInfo.passes;
      }

      // 6. Overall GPA calculation
      let overallGpa = '—';
      if (allGrades.length > 0) {
        overallGpa = (allGrades.reduce((a, b) => a + b, 0) / allGrades.length).toFixed(2);
      } else if (allModuleScores.length > 0) {
        overallGpa = (allModuleScores.reduce((a, b) => a + b, 0) / allModuleScores.length).toFixed(2);
      } else if (studentInfo && studentInfo.reting) {
        overallGpa = String(studentInfo.reting);
      }

      const totalGradeDistribution = {};
      allGrades.forEach(g => {
        totalGradeDistribution[g] = (totalGradeDistribution[g] || 0) + 1;
      });

      const result = {
        activeCourse,
        activeSemester,
        disciplines: enrichedDisciplines,
        gpa: overallGpa,
        passes: totalPasses,
        totalGradesCount: allGrades.length,
        gradeDistribution: totalGradeDistribution,
        unadmittedCount,
        isAdmitted: unadmittedCount === 0,
        studentInfo
      };
      cacheService.set('progress_with_lessons_latest', result);
      return result;
    });
  }
};
