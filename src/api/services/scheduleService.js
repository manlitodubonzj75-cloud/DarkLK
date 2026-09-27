import { apiClient } from '../client';
import { cacheService } from '../cacheService';
import { cryptoStorage } from '../cryptoStorage';
import { isCollegeStudent, formatISODate, getMondayOfWeek, MSAL_BELL_SCHEDULE } from '../lkUtils';

// Поля консультаций приходят как объекты ({ id, name }) — в JSX их рендерить нельзя
function asText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return v.name || v.title || v.fio || '';
  return String(v);
}

// Дата дня (YYYY-MM-DD) из ISO / DD.MM.YYYY / datetime
function toDayISO(v) {
  if (!v) return null;
  const str = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str.slice(0, 10);
  const m = str.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : formatISODate(d);
}

// Ключ сортировки HH:MM (из "09:00", "2026-09-28T18:00:00" или номера пары)
function timeKey(item) {
  const raw = item?.start || item?.timeStart || item?.time || '';
  const m = String(raw).match(/(\d{1,2}):(\d{2})/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  const bell = MSAL_BELL_SCHEDULE[item?.pair || item?.num || item?.number];
  return bell ? bell.start : '';
}

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

      // Иначе при ошибке сервера в кэш записался бы [] и месяц показал бы «занятий нет» вместо офлайн-копии
      if (scheduleResp.status === 'rejected') {
        throw scheduleResp.reason || new Error('Failed to fetch schedule from university server');
      }

      const scheduleData = scheduleResp.value || [];
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
    if (consultations && !Array.isArray(consultations)) {
      consultations = consultations.consultations || consultations.data || [];
    }
    if (!Array.isArray(consultations) || consultations.length === 0) return scheduleList;

    const result = scheduleList.map(day => ({
      ...day,
      data: Array.isArray(day.data) ? [...day.data] : []
    }));

    consultations.forEach(c => {
      if (!c) return;
      const consultDateStr = toDayISO(c.date || c.day || c.startConsultation || c.start);
      if (!consultDateStr) return;

      const disciplineName = asText(c.discipline) || 'Консультация (отработка)';
      const room = asText(c.auditory) || asText(c.room);
      const consultItem = {
        title: disciplineName,
        discipline: disciplineName,
        type: 'Консультация',
        isConsultation: true,
        start: c.startConsultation || c.start || c.timeStart || '18:00',
        end: c.endConsultation || c.end || c.timeEnd || '19:30',
        teacher: asText(c.teacher),
        auditory: room,
        classroom: room || 'Кафедра',
        corps: asText(c.corps),
        subgroup: c.subgroup || 0,
        comment: asText(c.theme) || asText(c.comment),
        status: asText(c.status) || 'Записан',
        id: c.id
      };

      const existingDay = result.find(d => d.title === consultDateStr);
      if (existingDay) {
        existingDay.data.push(consultItem);
        existingDay.data.sort((a, b) => timeKey(a).localeCompare(timeKey(b)));
      } else {
        result.push({
          title: consultDateStr,
          data: [consultItem]
        });
      }
    });

    result.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
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
