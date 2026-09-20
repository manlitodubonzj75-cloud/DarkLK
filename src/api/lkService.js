import { apiClient } from './client';
import { cacheService } from './cacheService';
import { cryptoStorage } from './cryptoStorage';
import { parseCollegeProgress } from './parsers/collegeParser';
import { parseBachelorProgress } from './parsers/bachelorParser';

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
 * Official MSAL (МГЮА) Bell Schedule
 */
export const MSAL_BELL_SCHEDULE = {
  1: { start: "09:00", end: "10:30" },
  2: { start: "10:40", end: "12:10" },
  3: { start: "12:40", end: "14:10" },
  4: { start: "14:20", end: "15:50" },
  5: { start: "16:20", end: "17:50" },
  6: { start: "18:00", end: "19:30" },
  7: { start: "19:40", end: "21:10" },
  8: { start: "21:20", end: "22:50" }
};

function extractTimeStr(val) {
  if (val === null || val === undefined) return "";
  if (typeof val !== "string") val = String(val);
  val = val.trim();
  if (!val) return "";
  if (val.includes("T")) {
    const timePart = val.split("T")[1];
    if (timePart) return timePart.slice(0, 5);
  }
  const match = val.match(/(\d{1,2}:\d{2})/);
  if (match) {
    return match[1].padStart(5, "0");
  }
  return val.slice(0, 5);
}

/**
 * Robust format lesson time range (e.g. 09:00 — 10:30).
 */
export function formatLessonTime(arg1, arg2) {
  if (arg1 === null || arg1 === undefined) {
    if (arg2) return extractTimeStr(arg2);
    return "";
  }

  // If called with two arguments: formatLessonTime(start, end)
  if (arg2 !== undefined) {
    const s = extractTimeStr(arg1);
    const e = extractTimeStr(arg2);
    if (s && e) return `${s} — ${e}`;
    if (s) return s;
    if (e) return e;
    return "";
  }

  // If called with a string
  if (typeof arg1 === "string") {
    if (arg1.includes("-") || arg1.includes("—")) {
      const parts = arg1.split(/[-—]/).map(p => extractTimeStr(p)).filter(Boolean);
      if (parts.length >= 2) return `${parts[0]} — ${parts[1]}`;
      if (parts.length === 1) return parts[0];
    }
    return extractTimeStr(arg1);
  }

  // If called with an object: formatLessonTime(lesson)
  if (typeof arg1 === "object") {
    const lesson = arg1;
    const rawStart = lesson.start || lesson.timeStart || lesson.lesson_start || lesson.start_time || lesson.begin || lesson.time_begin || lesson.from;
    const rawEnd = lesson.end || lesson.timeEnd || lesson.lesson_end || lesson.end_time || lesson.finish || lesson.time_end || lesson.to;

    const start = extractTimeStr(rawStart);
    const end = extractTimeStr(rawEnd);

    if (start && end) {
      return `${start} — ${end}`;
    }
    if (start) {
      return start;
    }

    // Check full string interval
    const timeRange = lesson.time || lesson.interval || lesson.lessonTime;
    if (timeRange && typeof timeRange === "string") {
      return formatLessonTime(timeRange);
    }

    // Pair number fallback (1..8)
    const pairNum = lesson.pair || lesson.num || lesson.number || lesson.lessonNumber || lesson.order;
    if (pairNum && MSAL_BELL_SCHEDULE[pairNum]) {
      return `${MSAL_BELL_SCHEDULE[pairNum].start} — ${MSAL_BELL_SCHEDULE[pairNum].end}`;
    }
    if (pairNum) {
      return `${pairNum} пара`;
    }
  }

  return "";
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
  async getScheduleRange(from, to, options = {}) {
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
    }, { ttl: options.ttl ?? 300000, forceRefresh: options.forceRefresh ?? false });
  },

  async getScheduleWeek(monday, options = {}) {
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
    }, { ttl: options.ttl ?? 300000, forceRefresh: options.forceRefresh ?? false });
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

  async getProgress(course = null, semester = null, options = {}) {
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
    }, { ttl: options.ttl ?? 300000, forceRefresh: options.forceRefresh ?? false });
  },

  async getProgressDetails(course = null, semester = null, disciplineId = null, options = {}) {
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
    }, { ttl: options.ttl ?? 300000, forceRefresh: options.forceRefresh ?? false });
  },

  async getRecordbook(options = {}) {
    return cacheService.withOfflineFallback('recordbook', async () => {
      return apiClient('/recordbook');
    }, { ttl: options.ttl ?? 600000, forceRefresh: options.forceRefresh ?? false });
  },

  async getStudentInfo(options = {}) {
    return cacheService.withOfflineFallback('student_info', async () => {
      return apiClient('/student/info');
    }, { ttl: options.ttl ?? 300000, forceRefresh: options.forceRefresh ?? false });
  },

  async getGroupmates(options = {}) {
    return cacheService.withOfflineFallback('student_group', async () => {
      return apiClient('/student/group');
    }, { ttl: options.ttl ?? 600000, forceRefresh: options.forceRefresh ?? false });
  },

  async getMyConsultations(from, to, options = {}) {
    return cacheService.withOfflineFallback(`consultation_my_${from}_${to}`, async () => {
      return apiClient(`/consultation/student?from=${from}&to=${to}`);
    }, { ttl: options.ttl ?? 180000, forceRefresh: options.forceRefresh ?? false });
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

  async getConsultationThemes(options = {}) {
    return cacheService.withOfflineFallback("consultation_themes", async () => {
      return apiClient("/consultation/theme");
    }, { ttl: options.ttl ?? 600000, forceRefresh: options.forceRefresh ?? false });
  },

  async getConsultationsForDisciplineTeacher(disciplineId, teacherId, from, to, options = {}) {
    return cacheService.withOfflineFallback(`consultations_${disciplineId}_${teacherId}_${from}_${to}`, async () => {
      return apiClient(`/consultation?discipline=${disciplineId}&teacher=${teacherId}&from=${from}&to=${to}`);
    }, { ttl: options.ttl ?? 180000, forceRefresh: options.forceRefresh ?? false });
  },

  async getDisciplineTeachers(disciplineId, options = {}) {
    return cacheService.withOfflineFallback(`teachers_${disciplineId}`, async () => {
      return apiClient(`/disciplines/${disciplineId}/teachers`);
    }, { ttl: options.ttl ?? 600000, forceRefresh: options.forceRefresh ?? false });
  },

  async getMyDisciplines(options = {}) {
    return cacheService.withOfflineFallback("student_disciplines", async () => {
      return apiClient("/disciplines/student");
    }, { ttl: options.ttl ?? 600000, forceRefresh: options.forceRefresh ?? false });
  },

  async getNews(options = {}) {
    return cacheService.withOfflineFallback('news_preview', async () => {
      return apiClient('/news/preview');
    }, { ttl: options.ttl ?? 300000, forceRefresh: options.forceRefresh ?? false });
  },

  async markNewsRead(newsId) {
    return apiClient(`/news/${newsId}/read`, { method: 'POST' });
  },

  async getPrivacySettings(options = {}) {
    return cacheService.withOfflineFallback('student_privacy', async () => {
      try {
        const res = await apiClient('/student/access');
        return res;
      } catch (e) {
        return null;
      }
    }, { ttl: options.ttl ?? 600000, forceRefresh: options.forceRefresh ?? false });
  },

  async updatePrivacySettings(settings) {
    const res = await apiClient('/student/access', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
    cacheService.set('student_privacy', settings);
    return res;
  },

  /**
   * Unified progress engine with specialized College & Bachelor sub-parsers.
   * Concurrency-limited details fetching & isolated data structures.
   */
  async getProgressWithLessons(user = null, options = {}) {
    const currentUser = user || cryptoStorage.getUser();
    const isCollege = isCollegeStudent(currentUser);

    const targetCourse = currentUser?.course;
    const targetSemester = currentUser?.semester;

    // College doesn't use /student/info, saving an unnecessary roundtrip
    const [progressResult, studentInfoResult] = await Promise.allSettled([
      this.getProgress(targetCourse, targetSemester, options),
      !isCollege ? this.getStudentInfo(options).catch(() => ({})) : Promise.resolve({})
    ]);

    const rawProgress = progressResult.status === 'fulfilled' ? progressResult.value : [];
    const studentInfo = studentInfoResult.status === 'fulfilled' ? studentInfoResult.value : {};

    // Accurately detect active semester
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

      let result;
      if (isCollegeData) {
        result = await parseCollegeProgress(rawProgress, activeCourse, activeSemester, {
          apiClient,
          cacheService
        });
      } else {
        result = await parseBachelorProgress(rawProgress, activeCourse, activeSemester, studentInfo, {
          apiClient,
          cacheService,
          getProgressDetails: this.getProgressDetails.bind(this)
        });
      }

      try {
        cacheService.set('progress_with_lessons_latest', result);
        cacheService.set(cacheKey, result);
      } catch (_) {}

      return result;
    }, { ttl: options.ttl ?? 300000, forceRefresh: options.forceRefresh ?? false });
  }
};
