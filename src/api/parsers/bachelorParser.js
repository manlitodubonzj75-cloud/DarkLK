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

import { runWithConcurrency } from "../utils/concurrency.js";

function normalizeDisciplineName(name) {
  if (!name) return "";
  return name.toLowerCase().replace(/[^a-zа-я0-9]/gi, "").trim();
}

function parseScore(val) {
  if (val === null || val === undefined || val === "") return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  const cleaned = String(val).replace(",", ".").replace(/[^0-9.]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parseGrade(val) {
  if (val === null || val === undefined || val === "") return 0;
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
 */
export async function parseBachelorProgress(
  rawProgress,
  activeCourse,
  activeSemester,
  studentInfo,
  context = {}
) {
  const { apiClient, cacheService, getProgressDetails, options } = context;
  const targetDisciplines = filterSemesterProgress(rawProgress, activeCourse, activeSemester);

  // 1. Fetch bulk progress details
  let bulkDetails = [];
  try {
    if (typeof getProgressDetails === "function") {
      bulkDetails = await getProgressDetails(activeCourse, activeSemester, null, options);
    } else if (typeof apiClient === "function") {
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

  // 2. Fetch missing individual details with concurrency limit
  if (targetDisciplines.length > 0 && typeof apiClient === "function") {
    const needsFetch = targetDisciplines.filter((d) => {
      const key = normalizeDisciplineName(d.name || d.discipline);
      const existing = detailsMap.get(key);
      return !existing || !Array.isArray(existing.modules) || existing.modules.length === 0;
    }).slice(0, 15);

    if (needsFetch.length > 0) {
      const taskFns = needsFetch.map((d) => async () => {
        const guid = d.guid || d.disciplineId || d.disciplineID || d.id;
        if (!guid) return null;
        try {
          const res = await apiClient(
            `/progress/details?disciplineID=${guid}&course=${activeCourse}&semester=${activeSemester}`,
            { timeout: 8000 }
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
        if (r.status === "fulfilled" && r.value && r.value.key) {
          detailsMap.set(r.value.key, r.value.data);
        }
      });
    }
  }

  let totalPasses = 0;
  let allGrades = [];
  let allModuleScores = [];
  let allMissedLessons = [];
  let unadmittedCount = 0;

  const baseList = targetDisciplines.length > 0 ? targetDisciplines : Array.from(detailsMap.values());

  const enrichedDisciplines = baseList.map((d, idx) => {
    const discName = (d.name || d.discipline || d.title || `Дисциплина #${idx + 1}`).trim();
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
    let info = "";

    if (detail) {
      if (detail.accessTotal !== undefined) {
        access = detail.accessTotal === 1 || detail.accessTotal === true || String(detail.accessTotal).toLowerCase() === "true";
      } else if (detail.access !== undefined) {
        access = detail.access === true || detail.access === 1 || String(detail.access).toLowerCase() === "true";
      }

      info = (detail.debtReport || detail.info || "").toString().replace(/[\r\n]+/g, " ").trim();

      rawModules = Array.isArray(detail.modules) ? detail.modules : [];

      // Parse BARS Modules
      rawModules.forEach((m) => {
        const modScore = parseScore(m.mediumScore ?? m.score ?? m.points ?? m.ball);
        const modName = (m.module || m.name || "БМ").toString().trim();

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
                const isMissed = it.missed === 1 || it.missed === "1" || it.turnout === false || it.turnout === "false";
                if (isMissed) {
                  passes++;
                  totalPasses++;
                  allMissedLessons.push({
                    discipline: discName,
                    date: it.date || t.date || '',
                    teacher: it.teacher || (Array.isArray(d.professors) ? d.professors[0] : (d.teacher || '')),
                    theme: it.theme || t.theme || it.name || 'Занятие',
                    subgroup: it.subgroup || 0
                  });
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
    } else {
      if (d.accessTotal !== undefined) {
        access = d.accessTotal === 1 || d.accessTotal === true || String(d.accessTotal).toLowerCase() === "true";
      } else if (d.access !== undefined) {
        access = d.access === true || d.access === 1 || String(d.access).toLowerCase() === "true";
      }
    }

    if (!access) unadmittedCount++;

    // Average only over modules that already have points (unfilled modules are 0, not a real score)
    const filledModuleScores = moduleScores.filter((m) => m.score > 0);
    const avgGrade = discGrades.length > 0
      ? (discGrades.reduce((a, b) => a + b, 0) / discGrades.length).toFixed(2)
      : (filledModuleScores.length > 0
          ? (filledModuleScores.reduce((sum, m) => sum + m.score, 0) / filledModuleScores.length).toFixed(2)
          : null);

    const totalBars = moduleScores.reduce((sum, m) => sum + m.score, 0);

    return {
      id: d.guid || d.id || idx,
      name: discName,
      type: d.type || detailsMap.get(normName)?.controlType || "Дисциплина",
      professors: d.professors || (d.teacher ? [d.teacher] : []),
      access,
      isAdmitted: access,
      info,
      passes,
      grades: discGrades,
      avgGrade,
      barsScore: totalBars > 0 ? totalBars.toFixed(2) : null,
      moduleScores,
      modules: rawModules
    };
  });

  // If detailed calculation didn't find any missed lessons, check studentInfo fallback
  if (totalPasses === 0 && studentInfo && typeof studentInfo.passes === "number") {
    totalPasses = studentInfo.passes;
  }

  const overallGpa = allGrades.length > 0
    ? (allGrades.reduce((a, b) => a + b, 0) / allGrades.length).toFixed(2)
    : (allModuleScores.length > 0
        ? (allModuleScores.reduce((sum, m) => sum + m, 0) / allModuleScores.length).toFixed(2)
        : (studentInfo?.reting ? String(studentInfo.reting) : "—"));

  const totalGradeDistribution = {};
  allGrades.forEach((g) => {
    totalGradeDistribution[g] = (totalGradeDistribution[g] || 0) + 1;
  });

  return {
    activeCourse,
    activeSemester,
    course: activeCourse,
    semester: activeSemester,
    disciplines: enrichedDisciplines,
    passes: totalPasses,
    missedLessons: allMissedLessons,
    gpa: overallGpa,
    rating: studentInfo?.reting ? String(studentInfo.reting) : overallGpa,
    unadmittedCount,
    isAdmitted: unadmittedCount === 0,
    totalGradesCount: allGrades.length,
    gradeDistribution: totalGradeDistribution
  };
}
