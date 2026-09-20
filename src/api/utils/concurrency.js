/**
 * Concurrency Limiter (Queue / Semaphore)
 * Executes an array of async task functions with a maximum concurrent limit.
 * Prevents network saturation, socket exhaustion, and 1C/IIS backend throttling.
 *
 * @param {Array<() => Promise<any>>} taskFns Array of functions that return a Promise
 * @param {number} limit Maximum concurrent tasks in flight (default: 3)
 * @returns {Promise<Array<{status: 'fulfilled', value: any} | {status: 'rejected', reason: any}>>}
 */
export async function runWithConcurrency(taskFns, limit = 3) {
  if (!Array.isArray(taskFns) || taskFns.length === 0) {
    return [];
  }

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
    }
  }

  const workerCount = Math.min(limit, taskFns.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return results;
}
