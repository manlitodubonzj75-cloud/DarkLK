import { apiClient } from '../client';
import { cacheService } from '../cacheService';

export const recordbookService = {
  /**
   * Get student recordbook: /recordbook
   */
  async getRecordbook(options = {}) {
    return cacheService.withOfflineFallback('recordbook', async () => {
      const data = await apiClient('/recordbook', {
        timeout: options.timeout || 12000
      });
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.recordbook)) return data.recordbook;
      if (data && Array.isArray(data.records)) return data.records;
      if (data && Array.isArray(data.data)) return data.data;
      return [];
    }, {
      ttl: options.ttl ?? 600000,
      forceRefresh: options.forceRefresh || false
    });
  },

  /**
   * Alias for backward compatibility
   */
  async getRecordBook(options = {}) {
    return this.getRecordbook(options);
  },

  /**
   * Get college diploma if applicable
   */
  async getCollegeDiploma(options = {}) {
    return cacheService.withOfflineFallback('college_diploma', async () => {
      try {
        const data = await apiClient('/student/diploma', {
          timeout: options.timeout || 10000
        });
        return data || null;
      } catch (_) {
        return null;
      }
    }, {
      ttl: options.ttl ?? 600000,
      forceRefresh: options.forceRefresh || false
    });
  }
};
