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
 */
export function detectActiveSemester(progressData = [], user = null, studentInfo = null) {
  const now = new Date();
  const month = now.getMonth();
  const isAutumn = month >= 8 || month === 0;

  let userCourse = Number(user?.course || studentInfo?.course || 0);
  let userSem = Number(user?.semester || studentInfo?.semester || 0);

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

  if (data.length > 0 && (data[0].discipline || data[0].name) && !data[0].disciplines) {
    const hasSem = data.some(d => d.semester !== undefined);
    if (hasSem) {
      return data.filter(d => {
        const itemCourse = Number(d.course || 0);
        const itemSemester = Number(d.semester || 0);
        return (!itemCourse || itemCourse === cNum) && (!itemSemester || itemSemester === sNum);
      });
    }
    return data;
  }

  return [];
}
