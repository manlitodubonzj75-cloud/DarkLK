import { scheduleService } from './services/scheduleService';
import { gradesService } from './services/gradesService';
import { recordbookService } from './services/recordbookService';
import { consultationsService } from './services/consultationsService';
import { studentService } from './services/studentService';
import { rpudService } from './services/rpudService';

export * from './lkUtils';

export { scheduleService } from './services/scheduleService';
export { gradesService } from './services/gradesService';
export { recordbookService } from './services/recordbookService';
export { consultationsService } from './services/consultationsService';
export { studentService } from './services/studentService';
export { rpudService } from './services/rpudService';

/**
 * Unified Facade for backwards compatibility.
 * Safely delegates to domain services without circular dependency hazards.
 */
export const lkService = {
  // Schedule
  getScheduleRange: (...args) => scheduleService.getScheduleRange(...args),
  getScheduleWeek: (...args) => scheduleService.getScheduleWeek(...args),
  getScheduleMonth: (...args) => scheduleService.getScheduleRange(...args),
  mergeScheduleWithConsultations: (...args) => scheduleService.mergeScheduleWithConsultations(...args),
  extractTodayLessons: (...args) => scheduleService.extractTodayLessons(...args),

  // RPUD Themes & Programs
  getRpudConfig: (...args) => rpudService.getConfig(...args),
  saveRpudConfig: (...args) => rpudService.saveConfig(...args),
  enrichScheduleWithThemes: (...args) => rpudService.enrichScheduleWithThemes(...args),
  enrichDisciplinesWithThemes: (...args) => rpudService.enrichDisciplinesWithThemes(...args),
  loadRpudData: (...args) => rpudService.loadRpudData(...args),

  // Grades & Performance
  getProgress: (...args) => gradesService.getProgress(...args),
  getProgressDetails: (...args) => gradesService.getProgressDetails(...args),
  getProgressWithLessons: (...args) => gradesService.getProgressWithLessons(...args),
  normalizeStudentStats: (...args) => gradesService.normalizeStudentStats(...args),

  // Recordbook
  getRecordbook: (...args) => recordbookService.getRecordbook(...args),
  getRecordBook: (...args) => recordbookService.getRecordBook(...args),
  getCollegeDiploma: (...args) => recordbookService.getCollegeDiploma(...args),

  // Consultations & Attendance
  getMyConsultations: (...args) => consultationsService.getMyConsultations(...args),
  getConsultations: (...args) => consultationsService.getConsultations(...args),
  bookConsultation: (...args) => consultationsService.bookConsultation(...args),
  cancelConsultation: (...args) => consultationsService.cancelConsultation(...args),
  getConsultationThemes: (...args) => consultationsService.getConsultationThemes(...args),
  getConsultationsForDisciplineTeacher: (...args) => consultationsService.getConsultationsForDisciplineTeacher(...args),
  getDisciplineTeachers: (...args) => consultationsService.getDisciplineTeachers(...args),
  getMyDisciplines: (...args) => consultationsService.getMyDisciplines(...args),

  // Student Info, Privacy & News
  getStudentInfo: (...args) => studentService.getStudentInfo(...args),
  getGroupmates: (...args) => studentService.getGroupmates(...args),
  getNews: (...args) => studentService.getNews(...args),
  markNewsRead: (...args) => studentService.markNewsRead(...args),
  getPrivacySettings: (...args) => studentService.getPrivacySettings(...args),
  updatePrivacySettings: (...args) => studentService.updatePrivacySettings(...args),
  getOrders: (...args) => studentService.getOrders(...args)
};
