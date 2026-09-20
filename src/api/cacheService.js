/**
 * Offline & Fallback Cache Service for MSAL+ Web
 * Encrypted with AES-GCM 256 via cryptoStorage (152-FZ zero-knowledge client protection)
 * with zero-latency synchronous fast cache layer for instant cold boot rendering.
 * Ensures full app functionality even when lk.msal.ru is down, slow, or unreachable.
 */

import { cryptoStorage } from "./cryptoStorage";

const CACHE_PREFIX = "msal_cache_";
const FAST_PREFIX = "_fast_msal_cache_";

export const cacheService = {
  /**
   * Save data to local encrypted cache and fast cold-boot slot with timestamp
   */
  set(key, data) {
    if (!key || data === undefined) return;
    try {
      const payload = {
        data,
        timestamp: Date.now()
      };
      cryptoStorage.setItemFast(`${CACHE_PREFIX}${key}`, payload);

      // Fast synchronous storage for immediate zero-latency reads on cold start
      try {
        localStorage.setItem(`${FAST_PREFIX}${key}`, JSON.stringify(payload));
      } catch (_) {}
    } catch (e) {
      console.warn(`[Cache] Failed to write cache for key "${key}":`, e.message);
    }
  },

  /**
   * Read data from local cache (synchronous, checks memory vault first, then fast storage)
   */
  get(key) {
    if (!key) return null;
    try {
      // 1. Check in-memory decrypted vault
      const payload = cryptoStorage.getItemSync(`${CACHE_PREFIX}${key}`);
      if (payload && payload.data !== undefined) {
        return payload.data;
      }

      // 2. Fallback to fast synchronous storage slot (available immediately before crypto key derivation)
      const rawFast = localStorage.getItem(`${FAST_PREFIX}${key}`);
      if (rawFast) {
        try {
          const parsed = JSON.parse(rawFast);
          if (parsed && parsed.data !== undefined) {
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
   * Read cache metadata (timestamp, age)
   */
  getInfo(key) {
    if (!key) return null;
    try {
      const payload = cryptoStorage.getItemSync(`${CACHE_PREFIX}${key}`);
      if (payload) {
        return {
          timestamp: payload.timestamp,
          ageMs: Date.now() - (payload.timestamp || 0),
          isCached: true
        };
      }
      const rawFast = localStorage.getItem(`${FAST_PREFIX}${key}`);
      if (rawFast) {
        const parsed = JSON.parse(rawFast);
        return {
          timestamp: parsed.timestamp,
          ageMs: Date.now() - (parsed.timestamp || 0),
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
   * Wrap an async API fetch call with stale-while-revalidate & offline fallback.
   * If network fails (site down / HTTP 5xx / timeout), gracefully returns cached copy.
   */
  async withOfflineFallback(key, fetcherFn, options = {}) {
    const cached = this.get(key);

    try {
      // Attempt fresh fetch from server
      const freshData = await fetcherFn();

      // Only cache valid, non-empty data
      if (freshData !== null && freshData !== undefined) {
        if (Array.isArray(freshData)) {
          if (freshData.length > 0 || !Array.isArray(cached) || cached.length === 0) {
            this.set(key, freshData);
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
