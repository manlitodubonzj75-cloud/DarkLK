/**
 * Offline & Fallback Cache Service for MSAL+ Web
 * Encrypted with AES-GCM 256 via cryptoStorage (152-FZ zero-knowledge client protection)
 * with zero-latency memory vault for instant rendering.
 * Ensures full app functionality even when lk.msal.ru is down, slow, or unreachable.
 */

import { cryptoStorage } from "./cryptoStorage.js";

const CACHE_PREFIX = "msal_cache_";
const FAST_PREFIX = "_fast_msal_cache_";

export const cacheService = {
  /**
   * Save data to encrypted cache with timestamp
   */
  set(key, data) {
    if (!key || data === undefined) return;
    try {
      const payload = {
        data,
        timestamp: Date.now()
      };
      // Memory vault is updated synchronously; encrypted ciphertext is saved to storage
      cryptoStorage.setItemFast(`${CACHE_PREFIX}${key}`, payload);
    } catch (e) {
      console.warn(`[Cache] Failed to write cache for key "${key}":`, e.message);
    }
  },

  /**
   * Read data from local cache (synchronous, memory vault)
   */
  get(key) {
    if (!key) return null;
    try {
      // 1. Check decrypted memory vault
      const payload = cryptoStorage.getItemSync(`${CACHE_PREFIX}${key}`);
      if (payload && payload.data !== undefined) {
        return payload.data;
      }

      // 2. Fallback check for legacy unencrypted fast storage and auto-migrate
      const rawFast = localStorage.getItem(`${FAST_PREFIX}${key}`);
      if (rawFast) {
        try {
          const parsed = JSON.parse(rawFast);
          if (parsed && parsed.data !== undefined) {
            // Remove unencrypted entry to protect user privacy
            localStorage.removeItem(`${FAST_PREFIX}${key}`);
            this.set(key, parsed.data);
            return parsed.data;
          }
        } catch (_) {}
      }

      return null;
    } catch (e) {
      console.warn(`[Cache] Failed to read cache for key "${key}":`, e.message);
      return null;
    }
  },

  /**
   * Check if a key exists in cache
   */
  has(key) {
    if (!key) return false;
    return this.get(key) !== null;
  },

  /**
   * Read cache metadata (timestamp, age)
   */
  getInfo(key) {
    if (!key) return null;
    try {
      const payload = cryptoStorage.getItemSync(`${CACHE_PREFIX}${key}`);
      if (payload && payload.timestamp) {
        return {
          timestamp: payload.timestamp,
          ageMs: Date.now() - payload.timestamp,
          isCached: true
        };
      }
      return null;
    } catch (_) {
      return null;
    }
  },

  /**
   * Remove a cached item
   */
  remove(key) {
    if (!key) return;
    cryptoStorage.removeItem(`${CACHE_PREFIX}${key}`);
    try {
      localStorage.removeItem(`${FAST_PREFIX}${key}`);
    } catch (_) {}
  },

  /**
   * Clear all cached data
   */
  clear() {
    const keys = Object.keys(localStorage);
    for (const k of keys) {
      if (k.startsWith(CACHE_PREFIX) || k.startsWith(FAST_PREFIX)) {
        try {
          localStorage.removeItem(k);
        } catch (_) {}
      }
    }
  },

  /**
   * Wrap an async API fetch call with stale-while-revalidate, TTL & offline fallback.
   * If network fails (site down / HTTP 5xx / timeout), gracefully returns cached copy.
   *
   * @param {string} key Cache key
   * @param {Function} fetcherFn Async fetcher function
   * @param {Object} options Options: { ttl?: number, forceRefresh?: boolean }
   */
  async withOfflineFallback(key, fetcherFn, options = {}) {
    const cached = this.get(key);
    const info = this.getInfo(key);
    const ttl = options.ttl || null;

    // Fast-path: if valid cache exists and is within TTL, return immediately without hitting network
    const isCachedValid = cached !== null && (!Array.isArray(cached) || cached.length > 0);
    if (!options.forceRefresh && ttl && isCachedValid && info && info.ageMs < ttl) {
      return cached;
    }

    try {
      // Attempt fresh fetch from server
      const freshData = await fetcherFn();

      // Only cache valid, non-empty data
      if (freshData !== null && freshData !== undefined) {
        if (Array.isArray(freshData)) {
          if (freshData.length > 0 || !Array.isArray(cached) || cached.length === 0) {
            this.set(key, freshData);
          }
          if (freshData.length === 0 && Array.isArray(cached) && cached.length > 0) {
            return cached;
          }
        } else if (typeof freshData === "object") {
          if (Object.keys(freshData).length > 0 || !cached) {
            this.set(key, freshData);
          }
        } else {
          this.set(key, freshData);
        }
        return freshData;
      }

      return cached !== null ? cached : freshData;
    } catch (error) {
      console.warn(`[Cache] Network fetch failed for "${key}". Falling back to offline cache:`, error.message);

      if (cached !== null) {
        return cached;
      }

      throw error;
    }
  }
};
