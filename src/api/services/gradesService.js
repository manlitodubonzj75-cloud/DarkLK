/**
 * Grades and Academic Progress Service
 * Unified service providing cached and live academic progress data.
 */

import { apiClient } from "../client.js";
import { cacheService } from "../cacheService.js";
import { cryptoStorage } from "../cryptoStorage.js";
import { isCollegeStudent, detectActiveSemester, getStudentCourse } from "../lkUtils.js";
import { parseCollegeProgress } from "../parsers/collegeParser.js";
import { parseBachelorProgress } from "../parsers/bachelorParser.js";
import { studentService } from "./studentService.js";

export const gradesService = {
  /**
   * Helper to resolve active course and semester for the student.
   * Pure local calculation without making any external requests.
   */
  resolveActiveCourseAndSemester(user = null) {
    const currentUser = user || cryptoStorage.getUser();
    const rb = cacheService.get("recordbook");

    const detected = detectActiveSemester([], currentUser, null, rb);
    let activeCourse = detected.course;
    let activeSemester = detected.semester;

    if (!activeCourse) {
      activeCourse = getStudentCourse(currentUser, rb);
    }

    if (!activeSemester && activeCourse) {
      const now = new Date();
      const isAutumn = now.getMonth() >= 8 || now.getMonth() === 0;
      activeSemester = isAutumn ? (activeCourse * 2 - 1) : (activeCourse * 2);
    }

    return {
      course: activeCourse || 3,
      semester: activeSemester || 5
    };
  },

  /**
   * Raw progress request from university server: /progress
   */
  async getProgress(course = null, semester = null, options = {}) {
    const user = cryptoStorage.getUser();
    let activeCourse = course || user?.course;
    let activeSem = semester || user?.semester;

    if (!activeCourse || !activeSem) {
      const resolved = this.resolveActiveCourseAndSemester(user);
      activeCourse = activeCourse || resolved.course;
      activeSem = activeSem || resolved.semester;
    }

    let query = "";
    if (activeCourse && activeSem) {
      query = `?course=${activeCourse}&semester=${activeSem}`;
    }

    const cacheKey = `progress_${activeCourse || "all"}_${activeSem || "all"}`;

    // Purge corrupted non-array cache if it was stored previously
    const existingCache = cacheService.get(cacheKey);
    if (existingCache && !Array.isArray(existingCache)) {
      cacheService.remove(cacheKey);
    }

    return cacheService.withOfflineFallback(cacheKey, async () => {
      const data = await apiClient(`/progress${query}`, {
        timeout: options.timeout || 30000
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
    const query = params.length > 0 ? `?${params.join("&")}` : "";
    const cacheKey = `college_details_${disciplineId || "all"}_c${course || "all"}_s${semester || "all"}`;

    return cacheService.withOfflineFallback(cacheKey, async () => {
      let lastError = null;
      try {
        const data = await apiClient(`/progress/details${query}`, {
          timeout: options.timeout || 15000,
          forceRefresh: options.forceRefresh
        });
        if (Array.isArray(data) && data.length > 0) {
          return data;
        }
      } catch (e) {
        lastError = e;
        console.warn("Direct progress details query failed, trying fallback:", e.message);
      }

      if (query !== "") {
        try {
          const fallbackData = await apiClient("/progress/details", {
            timeout: options.timeout || 15000,
            forceRefresh: options.forceRefresh
          });
          if (Array.isArray(fallbackData) && fallbackData.length > 0) {
            return fallbackData;
          }
        } catch (e) {
          lastError = e;
        }
      }

      if (lastError) {
        throw lastError;
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
    const user = currentUser || cryptoStorage.getUser();
    const isCollege = isCollegeStudent(user);

    // 1. Detect active course and semester before requesting progress
    let activeCourse = options.course;
    let activeSemester = options.semester;

    if (!activeCourse || !activeSemester) {
      const resolved = this.resolveActiveCourseAndSemester(user);
      activeCourse = resolved.course;
      activeSemester = resolved.semester;
    }

    const cacheKey = `progress_with_lessons_c${activeCourse}_s${activeSemester}`;

    // If cache exists but has 0 disciplines or missing disciplines, force refresh
    const existingParsed = cacheService.get(cacheKey);
    const isCorruptedOrEmpty = existingParsed && (
      !Array.isArray(existingParsed.disciplines) ||
      existingParsed.disciplines.length === 0
    );
    const forceRefresh = Boolean(options.forceRefresh || isCorruptedOrEmpty);

    // 2. Fetch raw progress overview and studentInfo with forwarded forceRefresh
    const [rawProgressResult, studentInfoResult] = await Promise.allSettled([
      this.getProgress(activeCourse, activeSemester, { ...options, forceRefresh, timeout: options.timeout || 30000 }),
      !isCollege ? studentService.getStudentInfo({ ...options, forceRefresh }) : Promise.resolve(null)
    ]);

    const rawProgress = rawProgressResult.status === "fulfilled" ? rawProgressResult.value : [];
    const studentInfo = studentInfoResult.status === "fulfilled" ? studentInfoResult.value : null;

    // For Bachelor: refine activeCourse and activeSemester if progress has semester hierarchy
    if (!isCollege && Array.isArray(rawProgress) && rawProgress.length > 0) {
      const refined = this.extractActiveSemester(rawProgress, user);
      if (refined.course && refined.semester) {
        activeCourse = refined.course;
        activeSemester = refined.semester;
      }
    }

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
          options: { ...options, forceRefresh }
        });
      } else {
        result = await parseBachelorProgress(rawProgress, activeCourse, activeSemester, studentInfo, {
          apiClient,
          cacheService,
          getProgressDetails: this.getProgressDetails.bind(this),
          options: { ...options, forceRefresh }
        });
      }

      try {
        cacheService.set("progress_with_lessons_latest", result);
        cacheService.set(cacheKey, result);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("msal-progress-updated", { detail: result }));
        }
      } catch (_) {}

      return result;
    }, {
      ttl: options.ttl ?? 300000,
      forceRefresh
    });
  },

  /**
   * Extract active course and semester number
   */
  extractActiveSemester(rawProgress, user = null) {
    if (!Array.isArray(rawProgress) || rawProgress.length === 0) {
      return { course: null, semester: null };
    }
    const detected = detectActiveSemester(rawProgress, user);
    return {
      course: detected.course,
      semester: detected.semester
    };
  },

  /**
   * Normalize student stats
   */
  normalizeStudentStats(progressData = null, studentInfo = null, user = null) {
    let rating = "—";
    const rawRating = studentInfo?.reting ?? studentInfo?.rating ?? user?.rating ?? user?.reting ?? progressData?.studentInfo?.reting ?? progressData?.rating ?? progressData?.gpa;
    if (rawRating !== undefined && rawRating !== null && rawRating !== 0 && rawRating !== "0" && String(rawRating) !== "NaN") {
      rating = String(rawRating);
    }

    let passes = 0;
    let missedLessons = [];

    if (progressData) {
      if (typeof progressData.passes === "number") {
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
    if (!progressData && studentInfo && typeof studentInfo.passes === "number") {
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

export const normalizeStudentStats = (...args) => gradesService.normalizeStudentStats(...args);
