import { safeArray } from '../lkUtils.js';

function parseNumber(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const num = parseFloat(String(val).replace(',', '.'));
  return isNaN(num) ? 0 : num;
}

function parseGrade(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const s = String(val).toLowerCase().trim();
  if (s.includes('отличн') || s === '5') return 5;
  if (s.includes('хорош') || s === '4') return 4;
  if (s.includes('удовл') || s === '3') return 3;
  if (s.includes('неуд') || s === '2') return 2;
  if (s.includes('зач') && !s.includes('не зач') && !s.includes('незач')) return 5;
  const num = parseInt(s, 10);
  if (!isNaN(num) && num >= 2 && num <= 5) return num;
  return 0;
}

export function filterSemesterProgress(data = [], course, semester) {
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
    if (Array.isArray(item.disciplines)) {
      const filtered = item.disciplines.filter(d => {
        const itemSem = Number(d.semester || d.sem);
        return itemSem === s;
      });
      if (filtered.length > 0) return filtered;
    }
  }

  // Level 3: Array of disciplines itself
  const directMatch = data.filter(d => {
    const itemSem = Number(d.semester || d.sem);
    return itemSem === s;
  });
  if (directMatch.length > 0) return directMatch;

  return data;
}

export function parseBachelorProgress(rawProgress = [], activeCourse = 1, activeSemester = 1) {
  const targetDisciplines = filterSemesterProgress(rawProgress, activeCourse, activeSemester);
  const disciplines = [];
  const gradeDistribution = { 5: 0, 4: 0, 3: 0, 2: 0 };
  let totalGrades = 0;
  let gradeSum = 0;
  let passes = 0;
  let unadmittedCount = 0;

  for (const disc of targetDisciplines) {
    const name = disc.discipline || disc.name || disc.subject || 'Дисциплина';
    const type = disc.controlType || disc.type || '';
    const points = parseNumber(disc.points || disc.totalPoints || disc.currentPoints);
    const mark = disc.grade || disc.mark || '';
    const numGrade = parseGrade(mark);

    if (numGrade >= 2 && numGrade <= 5) {
      gradeDistribution[numGrade]++;
      gradeSum += numGrade;
      totalGrades++;
    }

    const discPasses = parseNumber(disc.missedHours || disc.passes || disc.absences);
    passes += discPasses;

    const isAdmitted = disc.isAdmitted !== undefined ? Boolean(disc.isAdmitted) : (points >= 30 || numGrade >= 3);
    if (!isAdmitted) {
      unadmittedCount++;
    }

    const modules = safeArray(disc.modules || disc.controlPoints || disc.subPoints).map(m => ({
      name: m.name || m.title || 'Модуль',
      points: parseNumber(m.points || m.score),
      maxPoints: parseNumber(m.maxPoints),
      grade: m.grade || m.mark || ''
    }));

    disciplines.push({
      id: disc.id || disc.guid || `${name}_${disciplines.length}`,
      name,
      type,
      points,
      mark,
      passes: discPasses,
      isAdmitted,
      professors: safeArray(disc.teachers || disc.professors).map(t => typeof t === 'string' ? t : t.name),
      modules
    });
  }

  const gpa = totalGrades > 0 ? (gradeSum / totalGrades).toFixed(2) : '—';
  const isAdmitted = unadmittedCount === 0;

  return {
    activeCourse,
    activeSemester,
    gpa,
    isAdmitted,
    unadmittedCount,
    passes,
    totalGradesCount: totalGrades,
    gradeDistribution,
    disciplines
  };
}
