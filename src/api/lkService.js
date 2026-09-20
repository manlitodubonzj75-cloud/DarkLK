import { apiClient } from './client';
import { cacheService } from './cacheService';
import { cryptoStorage } from './cryptoStorage';

/**
 * Format Date to YYYY-MM-DD
 */
export function formatISODate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format ISO Date string to Russian display date (e.g. 15 сентября)
 */
export function formatDisplayDate(dateStr) {
  if (!dateStr || dateStr.startsWith('0001-01-01')) return '';
  // Support DD.MM.YYYY format
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateStr)) {
    const [dd, mm, yyyy] = dateStr.split('.');
    const d = new Date(`${yyyy}-${mm}-${dd}`);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    }
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime()) || d.getFullYear() <= 1970) return '';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * Parse lesson date string (DD.MM.YYYY or ISO) into Date object
 */
export function parseLessonDate(dateStr) {
  if (!dateStr) return null;
  const parts = String(dateStr).trim().split('.');
  if (parts.length === 3) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const y = parseInt(parts[2], 10);
    if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
      return new Date(y, m, d);
    }
  }
  const iso = new Date(dateStr);
  if (!isNaN(iso.getTime())) return iso;
  return null;
}

/**
 * Check if a date is strictly before today (00:00)
 */
export function isPastDate(d) {
  if (!d) return false;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d < todayStart) return true;
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
    return now.getHours() >= 16;
  }
  return false;
}

/**
 * Format lesson time range (e.g. 09:00 - 10:30)
 */
export function formatLessonTime(lesson) {
  const start = lesson.start || lesson.timeStart || lesson.lesson_start || lesson.start_time;
  const end = lesson.end || lesson.timeEnd || lesson.lesson_end || lesson.end_time;
  if (!start) return '';
  const cleanStart = start.slice(0, 5);
  const cleanEnd = end ? end.slice(0, 5) : '';
  return cleanEnd ? `${cleanStart} — ${cleanEnd}` : cleanStart;
}

/**
 * Calculate the Monday of the given date's week
 */
export function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Clean discipline names for robust matching between endpoints
 */
function normalizeDisciplineName(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-zа-я0-9]/gi, '').trim();
}

/**
 * Parse any score / mediumScore value safely
 */
function parseScore(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const cleaned = String(val).replace(',', '.').replace(/[^0-9.]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

/**
 * Parse single grade safely
 */
function parseGrade(val) {
  if (val === null || val === undefined || val === '') return 0;
  const num = parseInt(val, 10);
  if (!isNaN(num) && num >= 2 && num <= 5) return num;
  return 0;
}

/**
 * Detect whether the user object belongs to a College student.
 * Checks subrole ('COLLEGE'), department (contains 'колледж'), faculty, group (starts with 'КП'), or speciality.
 */
export function isCollegeStudent(user) {
  if (!user) return false;
  const subrole = String(user.subrole || '').toLowerCase();
  const dept = String(user.department || '').toLowerCase();
  const fac = String(user.faculty || '').toLowerCase();
  const group = String(user.group || '').toLowerCase();
  const spec = String(user.speciality || '').toLowerCase();

  return (
    subrole.includes('college') ||
    dept.includes('колледж') ||
    fac.includes('колледж') ||
    group.startsWith('кп') ||
    spec.includes('колледж')
  );
}

/**
 * Accurately detects active semester for current calendar period.
 * Academic year rules:
 * - Autumn Semester: September 1 (month 8) - January 31 (month 0). ALWAYS ODD semester (1, 3, 5, 7).
 * - Spring Semester: February 1 (month 1) - August 31 (month 7). ALWAYS EVEN semester (2, 4, 6, 8).
 */
export function detectActiveSemester(progressData = [], user = null, studentInfo = null) {
  const now = new Date();
  const month = now.getMonth(); // 0 = Jan, 8 = Sep, 11 = Dec
  const isAutumn = month >= 8 || month === 0;

  let userCourse = Number(user?.course || studentInfo?.course || 0);
  let userSem = Number(user?.semester || studentInfo?.semester || 0);

  // If user object already specifies course/semester (e.g. College course 3, semester 5)
  if (userSem > 0 && userCourse > 0) {
    if (isAutumn && userSem % 2 === 0) {
      userSem = userSem - 1;
    } else if (!isAutumn && userSem % 2 !== 0) {
      userSem = userSem + 1;
    }
    return {
      course: userCourse,
      semester: userSem
    };
  }

  // 1. If progressData has semester elements
  if (Array.isArray(progressData) && progressData.length > 0 && progressData[0].semester) {
    if (userSem > 0) {
      const match = progressData.find(s => Number(s.semester) === userSem);
      if (match) {
        return {
          course: Number(match.coures || match.course || userCourse || 1),
          semester: userSem
        };
      }
    }

    if (userCourse > 0) {
      const expectedSem = isAutumn ? (userCourse * 2 - 1) : (userCourse * 2);
      const semMatch = progressData.find(s => Number(s.semester) === expectedSem);
      if (semMatch) {
        return {
          course: userCourse,
          semester: expectedSem
        };
      }
    }

    // 3. Fallback to latest semester in progressData
    const sorted = [...progressData].sort((a, b) => Number(a.semester || 0) - Number(b.semester || 0));
    const lastItem = sorted[sorted.length - 1];
    let lastSem = Number(lastItem.semester || 1);
    if (isAutumn && lastSem % 2 === 0) {
      const autumnCandidate = sorted.reverse().find(s => Number(s.semester) % 2 !== 0);
      if (autumnCandidate) {
        return {
          course: Number(autumnCandidate.coures || autumnCandidate.course || 1),
          semester: Number(autumnCandidate.semester)
        };
      }
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
    const hasSem = data.some(d => d.semester !== undefined);
    if (hasSem) {
      return data.filter(d => {
        const itemCourse = Number(d.course || 0);
        const itemSemester = Number(d.semester || 0);
        return (!itemCourse || itemCourse === cNum) && (!itemSemester || itemSemester === sNum);
      });
    }
    // Disciplines array returned specifically for query params course & semester
    return data;
  }

  return [];
}

export const lkService = {
  /**
   * Schedule for an arbitrary range (e.g. whole month): GET /schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
   */
  async getScheduleRange(from, to) {
    const cacheKey = `schedule_${from}_${to}`;

    return cacheService.withOfflineFallback(cacheKey, async () => {
      const isCollege = isCollegeStudent(cryptoStorage.getUser());
      const [scheduleResp, consultationsResp] = await Promise.allSettled([
        apiClient(`/schedule?from=${from}&to=${to}`),
        !isCollege ? apiClient(`/consultation/student?from=${from}&to=${to}`).catch(() => []) : Promise.resolve([])
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
      const isCollege = isCollegeStudent(cryptoStorage.getUser());
      const [scheduleResp, consultationsResp] = await Promise.allSettled([
        apiClient(`/schedule?from=${from}&to=${to}`),
        !isCollege ? apiClient(`/consultation/student?from=${from}&to=${to}`).catch(() => []) : Promise.resolve([])
      ]);

      const scheduleData = scheduleResp.status === 'fulfilled' ? scheduleResp.value : [];
      const consultations = consultationsResp.status === 'fulfilled' ? consultationsResp.value : [];

      return this.mergeScheduleWithConsultations(scheduleData, consultations);
    });
  },

  /**
   * Merges consultations with normal schedule items and sorts by time
   */
  mergeScheduleWithConsultations(scheduleList, consultations) {
    if (!Array.isArray(scheduleList)) return [];
    if (!Array.isArray(consultations) || consultations.length === 0) return scheduleList;

    const result = scheduleList.map(day => ({
      ...day,
      data: Array.isArray(day.data) ? [...day.data] : []
    }));

    consultations.forEach(c => {
      const consultDateStr = c.date ? c.date.split('T')[0] : null;
      if (!consultDateStr) return;

      const consultItem = {
        title: c.discipline || 'Консультация (отработка)',
        type: 'Консультация',
        isConsultation: true,
        start: c.start || c.timeStart || '18:00',
        end: c.end || c.timeEnd || '19:30',
        teacher: c.teacher || '',
        classroom: c.auditory || c.room || 'Кафедра',
        subgroup: c.subgroup || 0,
        comment: c.theme || c.comment || '',
        status: c.status || 'Записан',
        id: c.id
      };

      const existingDay = result.find(d => d.title === consultDateStr);
      if (existingDay) {
        existingDay.data.push(consultItem);
        existingDay.data.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
      } else {
        result.push({
          title: consultDateStr,
          data: [consultItem]
        });
      }
    });

    result.sort((a, b) => a.title.localeCompare(b.title));
    return result;
  },

  async getProgress(course = null, semester = null) {
    let activeCourse = course;
    let activeSem = semester;

    if (!activeCourse || !activeSem) {
      const cached = cryptoStorage.getUser();
      if (cached) {
        if (!activeCourse && cached.course) activeCourse = cached.course;
        if (!activeSem && cached.semester) activeSem = cached.semester;
      }
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
   * Retrieves student progress, verifies active current semester (e.g. 5 in autumn, never 6),
   * fetches details for Bachelor (modules/BARS) or College (lessons, turnout, ratings, flawGrape),
   * and calculates overall GPA, absences, and admission statuses.
   */
  async getProgressWithLessons(user = null) {
    const currentUser = user || cryptoStorage.getUser();
    const isCollege = isCollegeStudent(currentUser);

    const targetCourse = currentUser?.course;
    const targetSemester = currentUser?.semester;

    // 1. Concurrent fetch of /progress and /student/info
    const [progressResult, studentInfoResult] = await Promise.allSettled([
      this.getProgress(targetCourse, targetSemester),
      !isCollege ? this.getStudentInfo().catch(() => ({})) : Promise.resolve({})
    ]);

    const rawProgress = progressResult.status === 'fulfilled' ? progressResult.value : [];
    const studentInfo = studentInfoResult.status === 'fulfilled' ? studentInfoResult.value : {};

    // 2. Accurately detect the active semester (Autumn = Odd e.g. 5, Spring = Even e.g. 6)
    const activeInfo = detectActiveSemester(rawProgress, currentUser, studentInfo);
    const activeCourse = activeInfo.course;
    const activeSemester = activeInfo.semester;

    const cacheKey = `progress_with_lessons_c${activeCourse}_s${activeSemester}`;

    return cacheService.withOfflineFallback(cacheKey, async () => {
      const isCollegeData = isCollege || (
        Array.isArray(rawProgress) &&
        rawProgress.length > 0 &&
        rawProgress[0].disciplineID &&
        !rawProgress[0].disciplines
      );

      // ==========================================
      // COLLEGE PROGRESS & LESSONS FLOW
      // ==========================================
      if (isCollegeData) {
        const collegeDisciplines = Array.isArray(rawProgress) ? rawProgress : [];

        // Fully asynchronous parallel fetch of /progress/details for all college disciplines
        const detailsPromises = collegeDisciplines.map(async (d) => {
          const guid = d.disciplineID || d.id;
          if (!guid) return null;
          const discCacheKey = `college_details_${guid}_c${activeCourse}_s${activeSemester}`;
          const cachedLessons = cacheService.get(discCacheKey);

          try {
            const res = await apiClient(
              `/progress/details?disciplineID=${guid}&course=${activeCourse}&semester=${activeSemester}`
            ).catch(err => {
              console.warn(`[College Details] Failed for ${d.discipline || guid}:`, err.message);
              return cachedLessons || [];
            });

            const lessons = Array.isArray(res) ? res : (Array.isArray(cachedLessons) ? cachedLessons : []);
            if (Array.isArray(res) && res.length > 0) {
              cacheService.set(discCacheKey, res);
            }

            return {
              disciplineID: guid,
              lessons
            };
          } catch (e) {
            return { disciplineID: guid, lessons: Array.isArray(cachedLessons) ? cachedLessons : [] };
          }
        });

        const settledDetails = await Promise.allSettled(detailsPromises);
        const detailsMap = new Map();
        settledDetails.forEach(s => {
          if (s.status === 'fulfilled' && s.value && s.value.disciplineID) {
            detailsMap.set(s.value.disciplineID, s.value.lessons);
          }
        });

        let totalPasses = 0;
        let allGrades = [];
        let allMissedLessons = [];
        let unadmittedCount = 0;

        const enrichedDisciplines = collegeDisciplines.map((d, idx) => {
          const discName = (d.discipline || d.name || '').trim();
          const discId = d.disciplineID || d.id || idx;
          const lessons = detailsMap.get(discId) || [];

          let passes = 0;
          let discGrades = [];
          const teachersSet = new Set();

          lessons.forEach(l => {
            if (l.teacher) {
              teachersSet.add(l.teacher.trim());
            }

            // Extract grades (ratings)
            const ratingsList = Array.isArray(l.ratings) ? l.ratings : (l.ratings !== undefined ? [l.ratings] : []);
            ratingsList.forEach(r => {
              const g = parseGrade(r);
              if (g > 0) {
                discGrades.push(g);
                allGrades.push(g);
              }
            });

            // Missed classes: turnout is false AND lesson date was in the past AND no grade
            const lessonDate = parseLessonDate(l.date);
            const hasGrade = ratingsList.some(r => parseGrade(r) > 0);
            if (lessonDate && isPastDate(lessonDate) && !l.turnout && !hasGrade) {
              passes++;
              totalPasses++;
              allMissedLessons.push({
                discipline: discName,
                date: l.date,
                teacher: l.teacher || d.teacher || '',
                subgroup: l.subgroup || 0
              });
            }
          });

          // Admission status
          const access = d.access === true || d.access === 1 || String(d.access).toLowerCase() === 'true';
          if (!access) unadmittedCount++;

          // Clean info / debtReport
          const info = (d.debtReport || d.info || '').toString().replace(/[\r\n]+/g, ' ').replace(/#/g, ' • ').trim();

          // Average grade for discipline
          const avgGrade = discGrades.length > 0
            ? (discGrades.reduce((a, b) => a + b, 0) / discGrades.length).toFixed(2)
            : null;

          const professors = teachersSet.size > 0 ? Array.from(teachersSet) : (d.teacher ? [d.teacher] : []);

          return {
            id: discId,
            disciplineID: discId,
            name: discName,
            type: 'Дисциплина',
            professors,
            access,
            info,
            passes,
            grades: discGrades,
            avgGrade,
            barsScore: null,
            moduleScores: [],
            modules: [],
            lessons,
            countGrape: Number(d.countGrape) || 0,
            countPractice: Number(d.countPractice) || 0,
            flawGrape: Number(d.flawGrape) || 0,
            flawPractice: Number(d.flawPractice) || 0
          };
        });

        // Overall GPA
        const overallGpa = allGrades.length > 0
          ? (allGrades.reduce((a, b) => a + b, 0) / allGrades.length).toFixed(2)
          : '—';

        const totalGradeDistribution = {};
        allGrades.forEach(g => {
          totalGradeDistribution[g] = (totalGradeDistribution[g] || 0) + 1;
        });

        // Sort missed lessons newest date first
        allMissedLessons.sort((a, b) => {
          const da = parseLessonDate(a.date);
          const db = parseLessonDate(b.date);
          if (da && db) return db - da;
          return 0;
        });

        const collegeResult = {
          activeCourse,
          activeSemester,
          disciplines: enrichedDisciplines,
          gpa: overallGpa,
          passes: totalPasses,
          missedLessons: allMissedLessons,
          totalGradesCount: allGrades.length,
          gradeDistribution: totalGradeDistribution,
          unadmittedCount,
          isAdmitted: unadmittedCount === 0,
          isCollege: true,
          studentInfo
        };

        try {
          cacheService.set('progress_with_lessons_latest', collegeResult);
          cacheService.set(cacheKey, collegeResult);
        } catch (_) {}

        return collegeResult;
      }

      // ==========================================
      // BACHELOR PROGRESS & MODULES FLOW
      // ==========================================
      let targetDisciplines = filterSemesterProgress(rawProgress, activeCourse, activeSemester);

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
                const key = normalizeDisciplineName(detObj.discipline || d.name || d.discipline);
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

            moduleScores.push({
              name: modName,
              score: modScore,
              displayScore: `${modScore} б.`
            });

            if (modScore > 0) {
              allModuleScores.push(modScore);
            }

            if (Array.isArray(m.themes)) {
              m.themes.forEach(t => {
                if (Array.isArray(t.items)) {
                  t.items.forEach(it => {
                    const isMissed = it.missed === 1 || it.missed === '1' || it.turnout === false || it.turnout === 'false';
                    if (isMissed) {
                      passes++;
                      totalPasses++;
                    }

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
        }

        if (!access) unadmittedCount++;

        const avgGrade = discGrades.length > 0
          ? (discGrades.reduce((a, b) => a + b, 0) / discGrades.length).toFixed(2)
          : (moduleScores.some(m => m.score > 0)
              ? (moduleScores.reduce((sum, m) => sum + m.score, 0) / moduleScores.length).toFixed(2)
              : null);

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

      if (studentInfo && typeof studentInfo.passes === 'number' && (totalPasses === 0 || studentInfo.passes > totalPasses)) {
        totalPasses = studentInfo.passes;
      }

      const overallGpa = allGrades.length > 0
        ? (allGrades.reduce((a, b) => a + b, 0) / allGrades.length).toFixed(2)
        : (allModuleScores.length > 0
            ? (allModuleScores.reduce((a, b) => a + b, 0) / allModuleScores.length).toFixed(2)
            : '—');

      const totalGradeDistribution = {};
      allGrades.forEach(g => {
        totalGradeDistribution[g] = (totalGradeDistribution[g] || 0) + 1;
      });

      const bachelorResult = {
        activeCourse,
        activeSemester,
        disciplines: enrichedDisciplines,
        gpa: overallGpa,
        passes: totalPasses,
        missedLessons: [],
        totalGradesCount: allGrades.length,
        gradeDistribution: totalGradeDistribution,
        unadmittedCount,
        isAdmitted: unadmittedCount === 0,
        isCollege: false,
        studentInfo
      };

      try {
        cacheService.set('progress_with_lessons_latest', bachelorResult);
        cacheService.set(cacheKey, bachelorResult);
      } catch (_) {}

      return bachelorResult;
    });
  }
};
