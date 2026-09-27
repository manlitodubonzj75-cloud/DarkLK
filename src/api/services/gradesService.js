import { apiClient } from '../client';
import { cacheService } from '../cacheService';
import { cryptoStorage } from '../cryptoStorage';
import { studentService } from './studentService';
import { isCollegeStudent } from '../lkUtils';
import { parseCollegeProgress } from '../parsers/collegeParser';
import { parseBachelorProgress } from '../parsers/bachelorParser';

export const gradesService = {
  /**
   * Get overall student progress list (disciplines, admissions, scores)
   * API: /progress?course={course}&semester={semester}
   */
  async getProgress(course = null, semester = null, options = {}) {
    const user = cryptoStorage.getUser();
    const activeCourse = course || user?.course;
    const activeSem = semester || user?.semester;

    let query = '';
    if (activeCourse && activeSem) {
      query = `?course=${activeCourse}&semester=${activeSem}`;
    }

    const cacheKey = `progress_${activeCourse || 'all'}_${activeSem || 'all'}`;

    return cacheService.withOfflineFallback(cacheKey, async () => {
      const data = await apiClient(`/progress${query}`, {
        timeout: options.timeout || 10000
      });
      return Array.isArray(data) ? data : [];
    }, {
      ttl: options.ttl ?? 300000,
      forceRefresh: options.forceRefresh || false
    });
  },

  /**
   * Get granular discipline progress details: /progress/details
   */
  async getProgressDetails(course = null, semester = null, disciplineId = null, options = {}) {
    const params = [];
    if (disciplineId) params.push(`disciplineID=${disciplineId}`);
    if (course) params.push(`course=${course}`);
    if (semester) params.push(`semester=${semester}`);
    const query = params.length > 0 ? `?${params.join('&')}` : '';
    const cacheKey = `progress_details_${disciplineId || 'all'}_${course || 'all'}_${semester || 'all'}`;

    return cacheService.withOfflineFallback(cacheKey, async () => {
      try {
        const data = await apiClient(`/progress/details${query}`, {
          timeout: options.timeout || 12000
        });
        if (Array.isArray(data) && data.length > 0) {
          return data;
        }
      } catch (e) {
        console.warn('Direct progress details query failed, trying fallback:', e.message);
      }

      if (query !== '') {
        try {
          const fallbackData = await apiClient('/progress/details', {
            timeout: options.timeout || 12000
          });
          if (Array.isArray(fallbackData) && fallbackData.length > 0) {
            return fallbackData;
          }
        } catch (_) {}
      }

      return [];
    }, {
      ttl: options.ttl ?? 300000,
      forceRefresh: options.forceRefresh || false
    });
  },

  /**
   * Unified progress parser with full module & theme details.
   */
  async getProgressWithLessons(currentUser = null, options = {}) {
    const isCollege = isCollegeStudent(currentUser || cryptoStorage.getUser());

    // 1. Fetch raw progress overview and studentInfo
    const [rawProgressResult, studentInfoResult] = await Promise.allSettled([
      this.getProgress(null, null, options),
      studentService.getStudentInfo(options)
    ]);

    const rawProgress = rawProgressResult.status === 'fulfilled' ? rawProgressResult.value : [];
    const studentInfo = studentInfoResult.status === 'fulfilled' ? studentInfoResult.value : null;

    // Detect active course and semester
    const activeInfo = this.extractActiveSemester(rawProgress, currentUser);
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
          cacheService,
          options
        });
      } else {
        result = await parseBachelorProgress(rawProgress, activeCourse, activeSemester, studentInfo, {
          apiClient,
          cacheService,
          getProgressDetails: this.getProgressDetails.bind(this),
          options
        });
      }

      try {
        cacheService.set('progress_with_lessons_latest', result);
        cacheService.set(cacheKey, result);
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('msal-progress-updated', { detail: result }));
        }
      } catch (_) {}

      return result;
    }, {
      ttl: options.ttl ?? 300000,
      forceRefresh: options.forceRefresh || false
    });
  },

  /**
   * Extract active course and semester number
   */
  extractActiveSemester(progressData, user = null) {
    const now = new Date();
    const isAutumn = now.getMonth() >= 8 || now.getMonth() === 0;

    let activeCourse = Number(user?.course || 1);
    let activeSemester = Number(user?.semester || (isAutumn ? (activeCourse * 2 - 1) : (activeCourse * 2)));

    if (Array.isArray(progressData) && progressData.length > 0) {
      for (const item of progressData) {
        if (Array.isArray(item.semesters) && item.semesters.length > 0) {
          const lastSem = item.semesters[item.semesters.length - 1];
          activeCourse = Number(item.course || item.coures || activeCourse);
          activeSemester = Number(lastSem.semester || lastSem.num || activeSemester);
          return { course: activeCourse, semester: activeSemester };
        }
      }
    }

    return { course: activeCourse, semester: activeSemester };
  },

  /**
   * Normalize student stats
   */
  normalizeStudentStats(progressData = null, studentInfo = null, user = null) {
    let rating = '—';
    const rawRating = studentInfo?.reting ?? studentInfo?.rating ?? user?.rating ?? user?.reting ?? progressData?.studentInfo?.reting ?? progressData?.rating;
    if (rawRating !== undefined && rawRating !== null && rawRating !== 0 && rawRating !== '0') {
      rating = String(rawRating);
    }

    let passes = 0;
    let missedLessons = [];

    if (progressData) {
      if (typeof progressData.passes === 'number') {
        passes = progressData.passes;
      } else if (Array.isArray(progressData.passes)) {
        passes = progressData.passes.reduce((sum, p) => sum + (Number(p.hours || p.passes || 1) || 0), 0);
      } else if (Array.isArray(progressData.disciplines)) {
        passes = progressData.disciplines.reduce((sum, d) => sum + (Number(d.passes) || 0), 0);
      }

      if (Array.isArray(progressData.missedLessons)) {
        missedLessons = progressData.missedLessons;
      }
    }

    // Only fallback to studentInfo.passes if progressData was not available
    if (!progressData && studentInfo && typeof studentInfo.passes === 'number') {
      passes = studentInfo.passes;
    }

    return {
      rating,
      passes,
      missedLessons,
      gpa: progressData?.gpa || rating,
      unadmittedCount: progressData?.unadmittedCount || 0,
      isAdmitted: progressData?.isAdmitted !== false,
      disciplines: progressData?.disciplines || []
    };
  }
};
