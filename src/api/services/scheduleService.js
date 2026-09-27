import { apiClient } from '../client';
import { cacheService } from '../cacheService';
import { cryptoStorage } from '../cryptoStorage';
import { isCollegeStudent, formatISODate, getMondayOfWeek } from '../lkUtils';

export const scheduleService = {
  /**
   * Schedule for an arbitrary range (e.g. whole month): GET /schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
   */
  async getScheduleRange(from, to, options = {}) {
    const cacheKey = `schedule_${from}_${to}`;

    return cacheService.withOfflineFallback(cacheKey, async () => {
      const isCollege = isCollegeStudent(cryptoStorage.getUser());
      const [scheduleResp, consultationsResp] = await Promise.allSettled([
        apiClient(`/schedule?from=${from}&to=${to}`),
        !isCollege ? apiClient(`/consultation/student?from=${from}&to=${to}`).catch(() => []) : Promise.resolve([])
      ]);

      const scheduleData = scheduleResp.status === "fulfilled" ? scheduleResp.value : [];
      const consultations = consultationsResp.status === "fulfilled" ? consultationsResp.value : [];

      return this.mergeScheduleWithConsultations(scheduleData, consultations);
    }, { ttl: options.ttl ?? 300000, forceRefresh: options.forceRefresh ?? false });
  },

  /**
   * Schedule for a week given its Monday: GET /schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
   */
  async getScheduleWeek(monday, options = {}) {
    const mondayDate = new Date(monday);
    const sundayDate = new Date(mondayDate);
    sundayDate.setDate(mondayDate.getDate() + 6);

    const from = formatISODate(mondayDate);
    const to = formatISODate(sundayDate);
    const cacheKey = `schedule_${from}_${to}`;

    return cacheService.withOfflineFallback(cacheKey, async () => {
      const isCollege = isCollegeStudent(cryptoStorage.getUser());
      const [scheduleResp, consultationsResp] = await Promise.allSettled([
        apiClient(`/schedule?from=${from}&to=${to}`),
        !isCollege ? apiClient(`/consultation/student?from=${from}&to=${to}`).catch(() => []) : Promise.resolve([])
      ]);

      if (scheduleResp.status === 'rejected') {
        throw scheduleResp.reason || new Error('Failed to fetch schedule from university server');
      }

      const scheduleData = scheduleResp.value || [];
      const consultations = consultationsResp.status === 'fulfilled' ? consultationsResp.value : [];

      return this.mergeScheduleWithConsultations(scheduleData, consultations);
    }, { ttl: options.ttl ?? 300000, forceRefresh: options.forceRefresh ?? false });
  },

  /**
   * Merges consultations with normal schedule items and sorts by time
   */
  mergeScheduleWithConsultations(scheduleList, consultations) {
    if (!Array.isArray(scheduleList)) return [];
    if (!Array.isArray(consultations) || consultations.length === 0) return scheduleList;

    const result = scheduleList.map(day => ({
      ...day,
      data: Array.isArray(day.data) ? [...day.data] : []
    }));

    consultations.forEach(c => {
      const consultDateStr = c.date ? c.date.split('T')[0] : null;
      if (!consultDateStr) return;

      const consultItem = {
        title: c.discipline || 'Консультация (отработка)',
        type: 'Консультация',
        isConsultation: true,
        start: c.start || c.timeStart || '18:00',
        end: c.end || c.timeEnd || '19:30',
        teacher: c.teacher || '',
        classroom: c.auditory || c.room || 'Кафедра',
        subgroup: c.subgroup || 0,
        comment: c.theme || c.comment || '',
        status: c.status || 'Записан',
        id: c.id
      };

      const existingDay = result.find(d => d.title === consultDateStr);
      if (existingDay) {
        existingDay.data.push(consultItem);
        existingDay.data.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
      } else {
        result.push({
          title: consultDateStr,
          data: [consultItem]
        });
      }
    });

    result.sort((a, b) => a.title.localeCompare(b.title));
    return result;
  },

  /**
   * Extract today's lessons from a week schedule array
   */
  extractTodayLessons(weekData, todayISO) {
    if (!Array.isArray(weekData)) return null;
    const todayGroup = weekData.find(d => d.title === todayISO);
    return Array.isArray(todayGroup?.data) ? todayGroup.data : [];
  }
};
