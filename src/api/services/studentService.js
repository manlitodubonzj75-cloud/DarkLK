import { apiClient } from '../client';
import { cacheService } from '../cacheService';

export const studentService = {
  /**
   * Get student personal card & info: /student/info
   */
  async getStudentInfo(options = {}) {
    return cacheService.withOfflineFallback('student_info', async () => {
      return apiClient('/student/info', {
        timeout: options.timeout || 10000
      });
    }, {
      ttl: options.ttl ?? 300000,
      forceRefresh: options.forceRefresh || false
    });
  },

  /**
   * Get student groupmates list: /student/group
   */
  async getGroupmates(options = {}) {
    return cacheService.withOfflineFallback('student_group', async () => {
      const data = await apiClient('/student/group', {
        timeout: options.timeout || 10000
      });
      return Array.isArray(data) ? data : [];
    }, {
      ttl: options.ttl ?? 600000,
      forceRefresh: options.forceRefresh || false
    });
  },

  /**
   * Get university announcements and news preview: /news/preview
   */
  async getNews(options = {}) {
    return cacheService.withOfflineFallback('news_preview', async () => {
      const data = await apiClient('/news/preview', {
        timeout: options.timeout || 10000
      });
      return Array.isArray(data) ? data : [];
    }, {
      ttl: options.ttl ?? 300000,
      forceRefresh: options.forceRefresh || false
    });
  },

  /**
   * Mark news item as read: /news/{id}/read
   */
  async markNewsRead(newsId) {
    return apiClient(`/news/${newsId}/read`, { method: 'POST' });
  },

  /**
   * Get privacy permissions: /student/access
   */
  async getPrivacySettings(options = {}) {
    return cacheService.withOfflineFallback('student_privacy', async () => {
      try {
        const res = await apiClient('/student/access', {
          timeout: options.timeout || 10000
        });
        return res;
      } catch (e) {
        return null;
      }
    }, {
      ttl: options.ttl ?? 600000,
      forceRefresh: options.forceRefresh || false
    });
  },

  /**
   * Update privacy settings: PUT /student/access
   */
  async updatePrivacySettings(settings) {
    const res = await apiClient('/student/access', {
      method: 'PUT',
      body: JSON.stringify(settings),
      timeout: 10000
    });
    cacheService.set('student_privacy', settings);
    return res;
  },

  /**
   * Get student orders: /student/orders
   */
  async getOrders(options = {}) {
    return cacheService.withOfflineFallback('student_orders', async () => {
      try {
        const data = await apiClient('/student/orders', {
          timeout: options.timeout || 10000
        });
        return Array.isArray(data) ? data : [];
      } catch (_) {
        return [];
      }
    }, {
      ttl: options.ttl ?? 600000,
      forceRefresh: options.forceRefresh || false
    });
  }
};
