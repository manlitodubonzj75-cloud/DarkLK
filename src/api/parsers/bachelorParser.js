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

  // 2. If some disciplines are missing modules, fetch individual details with concurrency limit (max 3)
  if (targetDisciplines.length > 0) {
    const needsFetch = targetDisciplines.filter((d) => {
      const key = normalizeDisciplineName(d.name || d.discipline);
      const existing = detailsMap.get(key);
      return !existing || !Array.isArray(existing.modules) || existing.modules.length === 0;
    });

    if (needsFetch.length > 0) {
      const taskFns = needsFetch.map((d) => async () => {
        const guid = d.guid || d.disciplineId || d.disciplineID || d.id;
        if (!guid) return null;
        try {
          const res = await apiClient(
            `/progress/details?disciplineID=${guid}&course=${activeCourse}&semester=${activeSemester}`
          );
          const detObj = Array.isArray(res) ? res[0] : res;
          if (detObj) {
            const key = normalizeDisciplineName(detObj.discipline || d.name || d.discipline);
            return { key, data: detObj };
          }
        } catch (_) {}
        return null;
      });

      const results = await runWithConcurrency(taskFns, 3);
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

      // Parse BARS Modules
      rawModules.forEach((m) => {
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
          m.themes.forEach((t) => {
            if (Array.isArray(t.items)) {
              t.items.forEach((it) => {
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
      : (moduleScores.some((m) => m.score > 0)
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
  allGrades.forEach((g) => {
    totalGradeDistribution[g] = (totalGradeDistribution[g] || 0) + 1;
  });

  return {
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
}
