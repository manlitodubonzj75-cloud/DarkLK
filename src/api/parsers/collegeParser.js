/**
 * College LK Parser Module
 * Specialized parsing engine for College of MSAL (МГЮА).
 *
 * Characteristics of College LK:
 * - 5-point grading system (ratings: 2..5)
 * - Turnout tracking: individual missed lessons (turnout: false, past date, no grade)
 * - Academic debt tracking via flawGrape / flawPractice / debtReport
 * - Zero consultations (consultations belong exclusively to Bachelor)
 * - Concurrency-limited details fetching (max 3 in parallel) with per-discipline caching
 */

import { runWithConcurrency } from '../utils/concurrency.js';

function parseGrade(val) {
  if (val === null || val === undefined || val === '') return 0;
  const num = parseInt(val, 10);
  if (!isNaN(num) && num >= 2 && num <= 5) return num;
  return 0;
}

function parseLessonDate(dateStr) {
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

function isPastDate(d) {
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
 * Parses and enriches College progress data.
 *
 * @param {Array} rawProgress Array of college discipline items from /progress
 * @param {number} activeCourse Current detected course
 * @param {number} activeSemester Current detected semester
 * @param {Object} context Context containing { apiClient, cacheService }
 * @returns {Promise<Object>} Unified progress object formatted for College UI
 */
export async function parseCollegeProgress(rawProgress, activeCourse, activeSemester, { apiClient, cacheService }) {
  const collegeDisciplines = Array.isArray(rawProgress) ? rawProgress : [];

  // Create tasks for fetching details with concurrency control (max 3 concurrent)
  const taskFns = collegeDisciplines.map((d) => async () => {
    const guid = d.disciplineID || d.id;
    if (!guid) return null;

    const discCacheKey = `college_details_${guid}_c${activeCourse}_s${activeSemester}`;
    const cachedLessons = cacheService.get(discCacheKey);

    try {
      const res = await apiClient(
        `/progress/details?disciplineID=${guid}&course=${activeCourse}&semester=${activeSemester}`
      ).catch((err) => {
        console.warn(`[College Details] Failed for ${d.discipline || guid}:`, err.message);
        return cachedLessons || [];
      });

      const lessons = Array.isArray(res) ? res : (Array.isArray(cachedLessons) ? cachedLessons : []);
      if (Array.isArray(res) && res.length > 0) {
        cacheService.set(discCacheKey, res);
      }

      return { disciplineID: guid, lessons };
    } catch (_) {
      return { disciplineID: guid, lessons: Array.isArray(cachedLessons) ? cachedLessons : [] };
    }
  });

  const settledDetails = await runWithConcurrency(taskFns, 3);
  const detailsMap = new Map();
  settledDetails.forEach((s) => {
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

    lessons.forEach((l) => {
      if (l.teacher) {
        teachersSet.add(l.teacher.trim());
      }

      // Extract grades (ratings: 2..5)
      const ratingsList = Array.isArray(l.ratings) ? l.ratings : (l.ratings !== undefined ? [l.ratings] : []);
      ratingsList.forEach((r) => {
        const g = parseGrade(r);
        if (g > 0) {
          discGrades.push(g);
          allGrades.push(g);
        }
      });

      // Missed classes check
      const lessonDate = parseLessonDate(l.date);
      const hasGrade = ratingsList.some((r) => parseGrade(r) > 0);
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

  // Overall GPA (5-point system)
  const overallGpa = allGrades.length > 0
    ? (allGrades.reduce((a, b) => a + b, 0) / allGrades.length).toFixed(2)
    : '—';

  const totalGradeDistribution = {};
  allGrades.forEach((g) => {
    totalGradeDistribution[g] = (totalGradeDistribution[g] || 0) + 1;
  });

  // Sort missed lessons newest date first
  allMissedLessons.sort((a, b) => {
    const da = parseLessonDate(a.date);
    const db = parseLessonDate(b.date);
    if (da && db) return db - da;
    return 0;
  });

  return {
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
    studentInfo: {}
  };
}
