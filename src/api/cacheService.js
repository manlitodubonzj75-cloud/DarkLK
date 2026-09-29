/**
 * Offline & Fallback Cache Service for DarkMSAL
 * High-performance, zero-latency synchronous cache engine.
 * Ensures full app functionality even when lk.msal.ru is down, slow, or unreachable.
 * 
 * Invariant: Fresh fetched data ALWAYS replaces old cached data immediately.
 * Invariant: If device is offline or university server is unreachable, latest valid cache is returned.
 */

import { cryptoStorage } from './cryptoStorage.js';

const CACHE_PREFIX = "msal_cache_";

// Кэш хранится через cryptoStorage: в RAM — расшифрованный, на диске — AES-GCM (v2).
// cryptoStorage.init() расшифровывает все msal_cache_* до рендера, поэтому чтение синхронное.

// Удаляем мусор ранних сборок
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

// In-flight request deduplication map
const inFlightRequests = new Map();

function readPayload(key) {
  const payload = cryptoStorage.getItemSync(`${CACHE_PREFIX}${key}`);
  return payload && typeof payload === 'object' && 'data' in payload ? payload : null;
}

export const cacheService = {
  /**
   * Save data to local cache with timestamp (RAM сразу, диск — асинхронно и зашифрованно)
   */
  set(key, data) {
    if (!key || data === undefined) return;
    cryptoStorage.setItemFast(`${CACHE_PREFIX}${key}`, { data, timestamp: Date.now() });
  },

  /**
   * Synchronously read data from local cache
   */
  get(key) {
    if (!key) return null;
    const payload = readPayload(key);
    return payload && payload.data !== undefined ? payload.data : null;
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
    const payload = readPayload(key);
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
    cryptoStorage.removeItem(`${CACHE_PREFIX}${key}`);
  },

  /**
   * Clear all cached data
   */
  clear() {
    for (const k of cryptoStorage.keys(CACHE_PREFIX)) {
      cryptoStorage.removeItem(k);
    }
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

    // In-flight request deduplication:
    // If caller requests forceRefresh, drop any existing slow/unforced promise from the map
    if (options.forceRefresh) {
      inFlightRequests.delete(key);
    } else if (inFlightRequests.has(key)) {
      return inFlightRequests.get(key);
    }

    const requestStartTime = Date.now();

    const fetchPromise = (async () => {
      try {
        // Attempt fresh fetch from server
        const freshData = await fetcherFn();

        // Whenever fresh data is received from server, check sequencing and empty array guard
        if (freshData !== null && freshData !== undefined) {
          // Guard against out-of-order write (race conditions):
          // If a newer write already occurred while this network request was in-flight, do not overwrite it!
          const latestInfo = this.getInfo(key);
          const isStaleSequence = latestInfo && latestInfo.timestamp > requestStartTime;

          // Guard against network glitch returning [] and wiping valid populated cache without explicit forceRefresh
          const isAccidentalWipe = !options.forceRefresh &&
            Array.isArray(cached) && cached.length > 0 &&
            Array.isArray(freshData) && freshData.length === 0;

          if (!isStaleSequence && !isAccidentalWipe) {
            this.set(key, freshData);
          }

          return isAccidentalWipe ? cached : freshData;
        }

        return cached !== null ? cached : freshData;
      } catch (error) {
        console.warn(`[Cache] Network fetch failed for "${key}". Falling back to offline cache:`, error.message);

        if (cached !== null) {
          return cached;
        }

        throw error;
      }
    })();

    inFlightRequests.set(key, fetchPromise);
    try {
      return await fetchPromise;
    } finally {
      // Only remove if this promise is still the active one registered for the key
      if (inFlightRequests.get(key) === fetchPromise) {
        inFlightRequests.delete(key);
      }
    }
  }
};
