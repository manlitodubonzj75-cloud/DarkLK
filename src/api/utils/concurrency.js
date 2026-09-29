/**
 * Concurrency Limiter (Queue / Semaphore) with Anti-WAF Traffic Jitter
 * Executes an array of async task functions with a maximum concurrent limit.
 * Adds human-like micro-jitter (80-220ms) between task dispatches to prevent
 * automated burst detection by university WAF/IIS rate limiters.
 *
 * @param {Array<() => Promise<any>>} taskFns Array of functions that return a Promise
 * @param {number} limit Maximum concurrent tasks in flight (default: 3)
 * @param {Object} options Configuration options ({ withJitter?: boolean })
 * @returns {Promise<Array<{status: 'fulfilled', value: any} | {status: 'rejected', reason: any}>>}
 */
export async function runWithConcurrency(taskFns, limit = 3, options = {}) {
  if (!Array.isArray(taskFns) || taskFns.length === 0) {
    return [];
  }

  const { withJitter = true } = options;
  const results = new Array(taskFns.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < taskFns.length) {
      const idx = currentIndex++;
      const fn = taskFns[idx];
      try {
        const val = await fn();
        results[idx] = { status: 'fulfilled', value: val };
      } catch (err) {
        results[idx] = { status: 'rejected', reason: err };
      }

      // Micro-jitter: 80ms - 220ms human-like randomized pause between consecutive requests
      if (withJitter && currentIndex < taskFns.length) {
        const jitterMs = Math.floor(Math.random() * 140) + 80;
        await new Promise((r) => setTimeout(r, jitterMs));
      }
    }
  }

  const workerCount = Math.min(limit, taskFns.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return results;
}
