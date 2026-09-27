/**
 * Bachelor LK Parser Module
 * Specialized parsing engine for Bachelor and Specialist degree students of MSAL (МГЮА).
 *
 * Characteristics of Bachelor LK:
 * - BARS point-rating system (0..100 score, Module 1, Module 2)
 * - Academic hours for absences (passes)
 * - Exam / Credit admission statuses (accessTotal)
 * - Bulk details fetching with fallback per-discipline queue
 */

import { runWithConcurrency } from '../utils/concurrency.js';

function normalizeDisciplineName(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/[^a-zа-я0-9]/gi, '').trim();
}

function parseScore(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const cleaned = String(val).replace(',', '.').replace(/[^0-9.]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parseGrade(val) {
  if (val === null || val === undefined || val === '') return 0;
  const num = parseInt(val, 10);
  if (!isNaN(num) && num >= 2 && num <= 5) return num;
  return 0;
}

function filterSemesterProgress(data = [], course, semester) {
  if (!Array.isArray(data) || data.length === 0) return [];
  const c = Number(course);
  const s = Number(semester);

  // Level 1: Filter semester items inside root structures
  for (const item of data) {
    if (Array.isArray(item.semesters)) {
      const match = item.semesters.find(sem => Number(sem.semester) === s || Number(sem.num) === s);
      if (match && Array.isArray(match.disciplines) && match.disciplines.length > 0) {
        return match.disciplines;
      }
    }
  }

  // Level 2: Root level has disciplines array
  for (const item of data) {
    if ((Number(item.course) === c || Number(item.coures) === c) &&
        (Number(item.semester) === s || Number(item.semestr) === s)) {
      if (Array.isArray(item.disciplines) && item.disciplines.length > 0) {
        return item.disciplines;
      }
    }
  }

  // Level 3: Flat array of disciplines matching course and semester
  const directMatches = data.filter(d => {
    const matchCourse = !d.course || Number(d.course) === c || Number(d.coures) === c;
    const matchSem = !d.semester || Number(d.semester) === s || Number(d.semestr) === s;
    return matchCourse && matchSem;
  });

  if (directMatches.length > 0 && directMatches.some(d => d.discipline || d.name)) {
    return directMatches;
  }

  // Level 4: Return any non-empty array with discipline names
  return data.filter(d => d.discipline || d.name || d.guid);
}

/**
 * Parses and enriches Bachelor progress data.
 *
 * @param {Array} rawProgress Array of progress items from /progress
 * @param {number} activeCourse Detected course
 * @param {number} activeSemester Detected semester
 * @param {Object} studentInfo Profile object from /student/info
 * @param {Object} context Context containing { apiClient, cacheService, getProgressDetails }
 * @returns {Promise<Object>} Unified progress object formatted for Bachelor UI
 */
export async function parseBachelorProgress(
  rawProgress,
  activeCourse,
  activeSemester,
  studentInfo,
  { apiClient, cacheService, getProgressDetails }
) {
  const targetDisciplines = filterSemesterProgress(rawProgress, activeCourse, activeSemester);

  // 1. Fetch bulk progress details
  let bulkDetails = [];
  try {
    if (typeof getProgressDetails === 'function') {
      bulkDetails = await getProgressDetails(activeCourse, activeSemester);
    } else {
      const res = await apiClient(`/progress/details?course=${activeCourse}&semester=${activeSemester}`).catch(() => []);
      bulkDetails = Array.isArray(res) ? res : [];
    }
  } catch (_) {}

  const detailsMap = new Map();
  if (Array.isArray(bulkDetails)) {
    bulkDetails.forEach((det) => {
      const key = normalizeDisciplineName(det.discipline || det.name);
      if (key) detailsMap.set(key, det);
    });
  }

  // 2. Fetch missing individual details with conservative limit (max 3) to prevent mobile socket starvation
  if (targetDisciplines.length > 0) {
    const needsFetch = targetDisciplines.filter((d) => {
      const key = normalizeDisciplineName(d.name || d.discipline);
      const existing = detailsMap.get(key);
      return !existing || !Array.isArray(existing.modules) || existing.modules.length === 0;
    }).slice(0, 3); // Capped to 3 to prevent network freezing

    if (needsFetch.length > 0) {
      const taskFns = needsFetch.map((d) => async () => {
        const guid = d.guid || d.disciplineId || d.disciplineID || d.id;
        if (!guid) return null;
        try {
          const res = await apiClient(
            `/progress/details?disciplineID=${guid}&course=${activeCourse}&semester=${activeSemester}`,
            { timeout: 6000 }
          );
          const detObj = Array.isArray(res) ? res[0] : res;
          if (detObj) {
            const key = normalizeDisciplineName(detObj.discipline || d.name || d.discipline);
            return { key, data: detObj };
          }
        } catch (_) {}
        return null;
      });

      const results = await runWithConcurrency(taskFns, 2);
      results.forEach((r) => {
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

  const disciplines = targetDisciplines.map((d, index) => {
    const name = d.name || d.discipline || d.title || `Дисциплина #${index + 1}`;
    const normKey = normalizeDisciplineName(name);
    const details = detailsMap.get(normKey) || {};

    const passCount = Number(details.passes ?? d.passes ?? 0);
    totalPasses += passCount;

    // Exam / Credit Admission Status
    const accessTotal = details.accessTotal !== undefined ? details.accessTotal : d.accessTotal;
    const isAdmitted = accessTotal === undefined || accessTotal === null || accessTotal === true || accessTotal === 1;
    if (!isAdmitted) {
      unadmittedCount++;
    }

    // Modules
    const rawModules = Array.isArray(details.modules) && details.modules.length > 0
      ? details.modules
      : (Array.isArray(d.modules) ? d.modules : []);

    const modules = rawModules.map((m, mIdx) => {
      const mScore = parseScore(m.score ?? m.points ?? m.ball);
      if (mScore > 0) allModuleScores.push(mScore);

      const lessons = (Array.isArray(m.lessons) ? m.lessons : []).map(l => ({
        date: l.date || '',
        theme: l.theme || l.name || '',
        score: parseScore(l.score ?? l.points),
        type: l.type || l.kind || 'Занятие',
        isPassed: Boolean(l.isPassed ?? l.visited ?? true)
      }));

      return {
        id: m.id || `mod_${mIdx}`,
        name: m.name || m.title || `Модуль ${mIdx + 1}`,
        score: mScore,
        maxScore: parseScore(m.maxScore ?? m.maxPoints ?? 50),
        lessons
      };
    });

    // Total Score and Final Grade
    const totalScore = parseScore(details.totalScore ?? d.totalScore ?? d.points ?? 0);
    const grade = parseGrade(details.grade ?? d.grade ?? d.mark);
    if (grade > 0) allGrades.push(grade);

    return {
      id: d.guid || d.id || `disc_${index}`,
      name,
      teacher: details.teacher || d.teacher || d.teacherName || '',
      type: details.controlType || d.controlType || d.type || 'Зачёт/Экзамен',
      totalScore,
      grade,
      passes: passCount,
      isAdmitted,
      modules
    };
  });

  // Calculate Overall GPA / BARS Rating
  let rating = studentInfo?.reting ?? studentInfo?.rating;
  if (!rating || rating === 0 || rating === '0') {
    if (allModuleScores.length > 0) {
      const sum = allModuleScores.reduce((acc, s) => acc + s, 0);
      rating = Math.round(sum / allModuleScores.length);
    } else if (allGrades.length > 0) {
      const sum = allGrades.reduce((acc, g) => acc + g, 0);
      rating = (sum / allGrades.length).toFixed(2);
    } else {
      rating = '—';
    }
  }

  // Calculate Absences
  const passes = studentInfo?.passes !== undefined && studentInfo?.passes !== null
    ? Number(studentInfo.passes)
    : totalPasses;

  return {
    studentType: 'bachelor',
    course: activeCourse,
    semester: activeSemester,
    rating,
    passes,
    unadmittedCount,
    disciplines,
    studentInfo
  };
}
