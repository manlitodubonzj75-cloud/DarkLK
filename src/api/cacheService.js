/**
 * Offline & Fallback Cache Service for DarkMSAL
 * High-performance, zero-latency synchronous cache engine.
 * Ensures full app functionality even when lk.msal.ru is down, slow, or unreachable.
 * 
 * Invariant: Fresh fetched data ALWAYS replaces old cached data immediately.
 * Invariant: If device is offline or university server is unreachable, latest valid cache is returned.
 */

const CACHE_PREFIX = "msal_cache_";
const memoryCache = new Map();

// Run immediate cleanup of legacy/orphaned keys from early builds
if (typeof localStorage !== 'undefined') {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('_fast_msal_cache_')) {
        localStorage.removeItem(k);
      }
    }
  } catch (_) {}
}

export const cacheService = {
  /**
   * Save data to local cache with timestamp
   * Instantly available in memory and persisted synchronously to localStorage
   */
  set(key, data) {
    if (!key || data === undefined) return;
    try {
      const payload = {
        data,
        timestamp: Date.now()
      };

      // 1. Instant RAM cache
      memoryCache.set(key, payload);

      // 2. Synchronous disk persistence
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(payload));
      }
    } catch (e) {
      console.warn(`[Cache] Failed to write cache for key "${key}":`, e.message);
    }
  },

  /**
   * Synchronously read data from local cache
   * Checks RAM first, then localStorage
   */
  get(key) {
    if (!key) return null;

    // 1. Check in-memory Map
    if (memoryCache.has(key)) {
      const mem = memoryCache.get(key);
      if (mem && mem.data !== undefined) {
        return mem.data;
      }
    }

    // 2. Check localStorage
    if (typeof localStorage === 'undefined') return null;

    try {
      const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
      if (!raw) return null;

      // Handle legacy encrypted prefix if present
      if (raw.startsWith('enc_v1:')) {
        // Discard legacy encrypted entry so it doesn't mask fresh data
        localStorage.removeItem(`${CACHE_PREFIX}${key}`);
        return null;
      }

      const parsed = JSON.parse(raw);
      if (parsed && parsed.data !== undefined) {
        memoryCache.set(key, parsed);
        return parsed.data;
      }

      return null;
    } catch (e) {
      console.warn(`[Cache] Failed to parse cache for key "${key}":`, e.message);
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

    let payload = memoryCache.get(key);
    if (!payload && typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
        if (raw && !raw.startsWith('enc_v1:')) {
          payload = JSON.parse(raw);
          if (payload) memoryCache.set(key, payload);
        }
      } catch (_) {}
    }

    if (payload && payload.timestamp) {
      return {
        timestamp: payload.timestamp,
        ageMs: Date.now() - payload.timestamp,
        isCached: true
      };
    }
    return null;
  },

  /**
   * Remove a cached item
   */
  remove(key) {
    if (!key) return;
    memoryCache.delete(key);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(`${CACHE_PREFIX}${key}`);
      } catch (_) {}
    }
  },

  /**
   * Clear all cached data
   */
  clear() {
    memoryCache.clear();
    if (typeof localStorage !== 'undefined') {
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && (k.startsWith(CACHE_PREFIX) || k.startsWith('_fast_msal_cache_'))) {
            localStorage.removeItem(k);
          }
        }
      } catch (_) {}
    }
  },

  /**
   * Wrap an async API fetch call with stale-while-revalidate & offline fallback.
   * - If forced or TTL expired: tries network fetch.
   * - When fresh data is received: ALWAYS saves to cache, replacing any stale copy.
   * - If network fails (no internet, server 500, timeout): gracefully returns cached copy.
   *
   * @param {string} key Cache key
   * @param {Function} fetcherFn Async fetcher function
   * @param {Object} options Options: { ttl?: number, forceRefresh?: boolean }
   */
  async withOfflineFallback(key, fetcherFn, options = {}) {
    const cached = this.get(key);
    const info = this.getInfo(key);
    const ttl = options.ttl || null;

    // Fast-path: if valid cache exists and is within TTL, return immediately without network
    const isCachedValid = cached !== null && (!Array.isArray(cached) || cached.length > 0);
    if (!options.forceRefresh && ttl && isCachedValid && info && info.ageMs < ttl) {
      return cached;
    }

    try {
      // Attempt fresh fetch from server
      const freshData = await fetcherFn();

      // Whenever fresh data is received from server, immediately replace cache
      if (freshData !== null && freshData !== undefined) {
        this.set(key, freshData);
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
