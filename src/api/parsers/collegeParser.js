/**
 * College LK Parser Module
 * Specialized parsing engine for College of MSAL (МГЮА).
 *
 * Characteristics of College LK:
 * - 5-point grading system (ratings: 2..5)
 * - Turnout tracking: individual missed lessons (turnout: false, past date, no grade)
 * - Academic debt tracking via flawGrape / flawPractice / debtReport
 * - Non-blocking initial render: returns disciplines overview instantly, loads journal on-demand or in background
 */

import { runWithConcurrency } from "../utils/concurrency.js";

function parseGrade(val) {
  if (val === null || val === undefined || val === "") return 0;
  const num = parseInt(val, 10);
  if (!isNaN(num) && num >= 2 && num <= 5) return num;
  return 0;
}

export function parseLessonDate(dateStr) {
  if (!dateStr) return null;
  const parts = String(dateStr).trim().split(".");
  if (parts.length === 3) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const y = parseInt(parts[2], 10);
    if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
      return new Date(y, m, d);
    }
  }
  const str = String(dateStr).trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(str) ? new Date(`${str}T00:00:00`) : new Date(str);
  if (!isNaN(iso.getTime())) return iso;
  return null;
}

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
 * Parses and enriches College progress data.
 * Does NOT block on fetching detailed lesson journals for all 14 disciplines upfront.
 * Loads any existing cached journals synchronously, and leaves on-demand or background loading for details.
 */
export async function parseCollegeProgress(rawProgress, activeCourse, activeSemester, { apiClient, cacheService, options = {} } = {}) {
  let collegeDisciplines = [];
  if (Array.isArray(rawProgress)) {
    collegeDisciplines = rawProgress;
  } else if (rawProgress && Array.isArray(rawProgress.disciplines)) {
    collegeDisciplines = rawProgress.disciplines;
  }

  // Pre-load any cached lessons synchronously
  const detailsMap = new Map();
  collegeDisciplines.forEach((d) => {
    const guid = d.disciplineID || d.id || d.guid;
    if (guid && cacheService?.get) {
      const discCacheKey = `college_details_${guid}_c${activeCourse}_s${activeSemester}`;
      const cached = cacheService.get(discCacheKey);
      if (Array.isArray(cached) && cached.length > 0) {
        detailsMap.set(guid, cached);
      }
    }
  });

  let totalPasses = 0;
  let allGrades = [];
  let allMissedLessons = [];
  let unadmittedCount = 0;
  let totalReportedGrades = 0;

  const enrichedDisciplines = collegeDisciplines.map((d, idx) => {
    const discName = (d.discipline || d.name || "").trim();
    const discId = d.disciplineID || d.id || d.guid || idx;
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
      const isTurnoutFalse = l.turnout === false || l.turnout === 0 || l.turnout === "false" || l.missed === 1 || l.missed === "1" || l.missed === true;
      const isAbsent = isTurnoutFalse && !l.lateness && !hasGrade;

      if (lessonDate && isPastDate(lessonDate) && isAbsent) {
        passes++;
        totalPasses++;
        allMissedLessons.push({
          discipline: discName,
          date: l.date,
          teacher: l.teacher || d.teacher || "",
          subgroup: l.subgroup || 0
        });
      }
    });

    // Admission status
    const access = d.access === true || d.access === 1 || String(d.access).toLowerCase() === "true";
    if (!access) unadmittedCount++;

    // Clean info / debtReport
    const info = (d.debtReport || d.info || "").toString().replace(/[\r\n]+/g, " ").replace(/#/g, " • ").trim();

    // Average grade for discipline
    const avgGrade = discGrades.length > 0
      ? (discGrades.reduce((a, b) => a + b, 0) / discGrades.length).toFixed(2)
      : null;

    const professors = teachersSet.size > 0 ? Array.from(teachersSet) : (d.teacher ? [d.teacher] : []);
    const countGrape = Number(d.countGrape) || discGrades.length;
    totalReportedGrades += countGrape;

    return {
      id: discId,
      disciplineID: discId,
      name: discName,
      type: "Дисциплина",
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
      countPractice: Number(d.countPractice) || 0,
      countGrape,
      flawGrape: Number(d.flawGrape) || 0,
      flawPractice: Number(d.flawPractice) || 0,
      debtReport: d.debtReport || null
    };
  });

  const gradeDistribution = { 5: 0, 4: 0, 3: 0, 2: 0 };
  allGrades.forEach((g) => {
    if (gradeDistribution[g] !== undefined) gradeDistribution[g]++;
  });

  const totalGradesCount = allGrades.length > 0 ? allGrades.length : totalReportedGrades;
  const gpa = allGrades.length > 0
    ? (allGrades.reduce((a, b) => a + b, 0) / allGrades.length).toFixed(2)
    : null;

  // Background non-blocking pre-fetch for missing or stale details (TTL: 15 min or forceRefresh)
  const forceRefresh = Boolean(options.forceRefresh);
  const DETAILS_TTL_MS = 15 * 60 * 1000;

  if (apiClient && cacheService && typeof window !== "undefined") {
    setTimeout(async () => {
      try {
        const toFetch = collegeDisciplines.filter((d) => {
          const guid = d.disciplineID || d.id || d.guid;
          if (!guid) return false;
          if (forceRefresh) return true;
          const discCacheKey = `college_details_${guid}_c${activeCourse}_s${activeSemester}`;
          const cached = cacheService.get(discCacheKey);
          if (!Array.isArray(cached) || cached.length === 0) return true;
          const info = cacheService.getInfo(discCacheKey);
          return !info || info.ageMs > DETAILS_TTL_MS;
        });

        if (toFetch.length === 0) return;

        const tasks = toFetch.map((d) => async () => {
          const guid = d.disciplineID || d.id || d.guid;
          try {
            const res = await apiClient(
              `/progress/details?disciplineID=${guid}&course=${activeCourse}&semester=${activeSemester}`,
              { timeout: 15000, forceRefresh }
            );
            if (Array.isArray(res) && res.length > 0) {
              const discCacheKey = `college_details_${guid}_c${activeCourse}_s${activeSemester}`;
              cacheService.set(discCacheKey, res);

              // Update master cache so all components immediately see the enriched lessons
              const mainKey = `progress_with_lessons_c${activeCourse}_s${activeSemester}`;
              const master = cacheService.get(mainKey) || cacheService.get("progress_with_lessons_latest");
              if (master && Array.isArray(master.disciplines)) {
                const discGrades = [];
                res.forEach((l) => {
                  const ratings = Array.isArray(l.ratings) ? l.ratings : (l.ratings !== undefined ? [l.ratings] : []);
                  ratings.forEach((r) => {
                    const num = parseInt(r, 10);
                    if (!isNaN(num) && num >= 2 && num <= 5) discGrades.push(num);
                  });
                });
                const avgGrade = discGrades.length > 0 ? (discGrades.reduce((a, b) => a + b, 0) / discGrades.length).toFixed(2) : null;
                const updatedDisc = master.disciplines.map((dItem) => {
                  if ((dItem.disciplineID || dItem.id || dItem.guid) === guid) {
                    return {
                      ...dItem,
                      lessons: res,
                      grades: discGrades.length > 0 ? discGrades : dItem.grades,
                      avgGrade: avgGrade || dItem.avgGrade,
                      countGrape: discGrades.length > 0 ? discGrades.length : dItem.countGrape
                    };
                  }
                  return dItem;
                });
                const updatedMaster = { ...master, disciplines: updatedDisc };
                cacheService.set(mainKey, updatedMaster);
                cacheService.set("progress_with_lessons_latest", updatedMaster);
              }

              window.dispatchEvent(new CustomEvent("msal-college-discipline-loaded", {
                detail: { disciplineID: guid, lessons: res }
              }));
            }
          } catch (_) {}
        });

        // Run with concurrency 2 in the background quietly
        await runWithConcurrency(tasks, 2);
      } catch (_) {}
    }, 200);
  }

  return {
    isCollege: true,
    activeCourse,
    activeSemester,
    gpa,
    isAdmitted: unadmittedCount === 0,
    unadmittedCount,
    passes: totalPasses,
    missedLessons: allMissedLessons,
    disciplines: enrichedDisciplines,
    totalGradesCount,
    gradeDistribution
  };
}
