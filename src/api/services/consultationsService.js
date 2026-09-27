import { apiClient } from '../client';
import { cacheService } from '../cacheService';

export const consultationsService = {
  /**
   * Get student's booked consultations / retakes: /consultation/student?from=X&to=Y
   */
  async getMyConsultations(from, to, options = {}) {
    return cacheService.withOfflineFallback(`consultation_my_${from}_${to}`, async () => {
      const data = await apiClient(`/consultation/student?from=${from}&to=${to}`, {
        timeout: options.timeout || 10000
      });
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.consultations)) return data.consultations;
      if (data && Array.isArray(data.data)) return data.data;
      return [];
    }, {
      ttl: options.ttl ?? 180000,
      forceRefresh: options.forceRefresh || false
    });
  },

  /**
   * Alias for backward compatibility
   */
  async getConsultations(from, to, options = {}) {
    return this.getMyConsultations(from, to, options);
  },

  /**
   * Book a consultation slot
   */
  async bookConsultation(consultationData) {
    return apiClient('/consultation', {
      method: 'POST',
      body: JSON.stringify(consultationData),
      timeout: 10000
    });
  },

  /**
   * Cancel an existing consultation
   */
  async cancelConsultation(consultationData) {
    return apiClient('/consultation', {
      method: 'PATCH',
      body: JSON.stringify(consultationData),
      timeout: 10000
    });
  },

  /**
   * Get themes for consultations: /consultation/theme
   */
  async getConsultationThemes(options = {}) {
    return cacheService.withOfflineFallback("consultation_themes", async () => {
      const data = await apiClient("/consultation/theme", {
        timeout: options.timeout || 10000
      });
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.themes)) return data.themes;
      if (data && Array.isArray(data.data)) return data.data;
      return [];
    }, {
      ttl: options.ttl ?? 600000,
      forceRefresh: options.forceRefresh || false
    });
  },

  /**
   * Get available consultation slots for discipline and teacher:
   * /consultation?discipline=X&teacher=Y&from=Z&to=W
   */
  async getConsultationsForDisciplineTeacher(disciplineId, teacherId, from, to, options = {}) {
    return cacheService.withOfflineFallback(`consultations_${disciplineId}_${teacherId}_${from}_${to}`, async () => {
      const data = await apiClient(`/consultation?discipline=${disciplineId}&teacher=${teacherId}&from=${from}&to=${to}`, {
        timeout: options.timeout || 10000
      });
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.consultations)) return data.consultations;
      if (data && Array.isArray(data.data)) return data.data;
      return [];
    }, {
      ttl: options.ttl ?? 180000,
      forceRefresh: options.forceRefresh || false
    });
  },

  /**
   * Get teachers for discipline: /disciplines/{id}/teachers
   */
  async getDisciplineTeachers(disciplineId, options = {}) {
    return cacheService.withOfflineFallback(`teachers_${disciplineId}`, async () => {
      const data = await apiClient(`/disciplines/${disciplineId}/teachers`, {
        timeout: options.timeout || 10000
      });
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.teachers)) return data.teachers;
      if (data && Array.isArray(data.data)) return data.data;
      return [];
    }, {
      ttl: options.ttl ?? 600000,
      forceRefresh: options.forceRefresh || false
    });
  },

  /**
   * Get my disciplines: /disciplines/student
   */
  async getMyDisciplines(options = {}) {
    return cacheService.withOfflineFallback("student_disciplines", async () => {
      const data = await apiClient("/disciplines/student", {
        timeout: options.timeout || 10000
      });
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.disciplines)) return data.disciplines;
      if (data && Array.isArray(data.data)) return data.data;
      return [];
    }, {
      ttl: options.ttl ?? 600000,
      forceRefresh: options.forceRefresh || false
    });
  }
};
