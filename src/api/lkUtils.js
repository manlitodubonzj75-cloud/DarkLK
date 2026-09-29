/**
 * MSAL LK Utility Functions
 * Pure helper functions decoupled from service implementations to prevent circular dependencies.
 */

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
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateStr)) {
    const [dd, mm, yyyy] = dateStr.split('.');
    // Локальная полночь: new Date('YYYY-MM-DD') парсится как UTC и в западных поясах сдвигает день
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    }
  }
  const d = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? new Date(`${dateStr}T00:00:00`) : new Date(dateStr);
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
  const str = String(dateStr).trim();
  // 'YYYY-MM-DD' без времени — локальная дата, а не UTC-полночь
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(str) ? new Date(`${str}T00:00:00`) : new Date(str);
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

  if (arg2 !== undefined) {
    const s = extractTimeStr(arg1);
    const e = extractTimeStr(arg2);
    if (s && e) return `${s} — ${e}`;
    if (s) return s;
    if (e) return e;
    return "";
  }

  if (typeof arg1 === "string") {
    if (arg1.includes("-") || arg1.includes("—")) {
      const parts = arg1.split(/[-—]/).map(p => extractTimeStr(p)).filter(Boolean);
      if (parts.length >= 2) return `${parts[0]} — ${parts[1]}`;
      if (parts.length === 1) return parts[0];
    }
    return extractTimeStr(arg1);
  }

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

    const timeRange = lesson.time || lesson.interval || lesson.lessonTime;
    if (timeRange && typeof timeRange === "string") {
      return formatLessonTime(timeRange);
    }

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
 */
export function isCollegeStudent(user) {
  if (!user) return false;
  const subrole = String(user.subrole || user.subRole || user.sub_role || '').toLowerCase();
  const role = String(user.role || '').toLowerCase();
  const dept = String(user.department || '').toLowerCase();
  const fac = String(user.faculty || '').toLowerCase();
  const group = String(user.group || '').toLowerCase();
  const spec = String(user.speciality || '').toLowerCase();

  return (
    subrole.includes('college') ||
    subrole.includes('колледж') ||
    role.includes('college') ||
    role.includes('колледж') ||
    dept.includes('колледж') ||
    dept.includes('сп') ||
    fac.includes('колледж') ||
    group.startsWith('кп') ||
    group.startsWith('сп') ||
    group.includes('колледж') ||
    spec.includes('колледж')
  );
}

/**
 * Robustly extract student course number from user profile, recordbook, or group name.
 */
export function getStudentCourse(user = null, recordbook = null) {
  // 1. Direct explicit course property from API profile
  const directCourse = Number(user?.course || user?.curse || 0);
  if (directCourse >= 1 && directCourse <= 6) return directCourse;

  // 2. Direct explicit semester property from API profile
  const directSem = Number(user?.semester || 0);
  if (directSem >= 1 && directSem <= 12) return Math.ceil(directSem / 2);

  const group = String(user?.group || '').trim();

  // 3. Trailing course number in group (e.g. 'КП24-ПСА-О-3' -> 3, 'ЮР-О-2' -> 2)
  const endCourseMatch = group.match(/[-_\s](?:о|з|озо)?[-_\s]*([1-6])$/i);
  if (endCourseMatch) {
    const parsed = parseInt(endCourseMatch[1], 10);
    if (parsed >= 1 && parsed <= 6) return parsed;
  }

  // 4. Recordbook deduction:
  // If recordbook has completed semesters:
  if (Array.isArray(recordbook) && recordbook.length > 0) {
    const sems = recordbook.map(e => Number(e.semester) || 0).filter(s => s > 0);
    const maxSem = sems.length > 0 ? Math.max(...sems) : 0;
    if (maxSem > 0) {
      const now = new Date();
      const month = now.getMonth(); // 0-indexed: 8 is September
      // If max semester is even (e.g. 2, 4, 6), and current date is in autumn/spring of next academic year, student has advanced!
      if (maxSem % 2 === 0 && (month >= 7 || month <= 5)) {
        const nextCourse = Math.ceil(maxSem / 2) + 1;
        if (nextCourse <= 6) return nextCourse;
      }
      return Math.ceil(maxSem / 2);
    }
  }

  // 5. Admission year in college groups (e.g. 'КП24-...' in Sep 2026 = 3rd course)
  const yrMatch = group.match(/(?:кп|сп|юр|пс|пса)[-_ ]*(\d{2})/i);
  if (yrMatch) {
    const admissionYear = 2000 + parseInt(yrMatch[1], 10);
    const now = new Date();
    const currentYear = now.getFullYear();
    const isNewYear = now.getMonth() >= 7; // Aug - Dec is first semester of new year
    const calcCourse = currentYear - admissionYear + (isNewYear ? 1 : 0);
    if (calcCourse >= 1 && calcCourse <= 6) return calcCourse;
  }

  // 6. Classical group patterns (e.g. 'КП-31' -> 3)
  const groupMatch = group.match(/(?:^|\D)([1-6])\d{1,2}(?:$|\D)/);
  if (groupMatch) {
    const parsed = parseInt(groupMatch[1], 10);
    if (parsed >= 1 && parsed <= 6) return parsed;
  }

  return 1;
}

/**
 * Accurately detects active semester for current calendar period.
 */
export function detectActiveSemester(progressData = [], user = null, studentInfo = null, recordbook = null) {
  const now = new Date();
  const month = now.getMonth();
  const isAutumn = month >= 8 || month === 0;

  let userCourse = Number(user?.course || studentInfo?.course || 0);
  let userSem = Number(user?.semester || studentInfo?.semester || 0);

  if (!userCourse) {
    userCourse = getStudentCourse(user, recordbook);
  }

  // If user profile explicitly provides both course and semester
  if (userSem > 0 && userCourse > 0) {
    return {
      course: userCourse,
      semester: userSem
    };
  }

  // If progress has nested semester hierarchy (Bachelor)
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

  // Default calculation based on calendar period and detected course
  const defaultSem = userSem > 0
    ? userSem
    : (isAutumn ? (userCourse * 2 - 1) : (userCourse * 2));

  return {
    course: userCourse || 1,
    semester: defaultSem || 1
  };
}

/**
 * Safely return array or empty array
 */
export const safeArray = (val) => (Array.isArray(val) ? val : []);
