// A very small in-process background queue. Analysing an image (palette,
// size, feature vector) takes tens of milliseconds to a few seconds and must
// never hold up the capture request that triggered it, so it runs here after
// the response has gone out.
//
// Deliberately simple: no persistence. Work that was queued when the process
// stopped is picked up again at next start by the backfill in
// services/analysis.js (anything with analyzed_at IS NULL).
const CONCURRENCY = 2;

const queue = [];
let running = 0;
let idleWaiters = [];

function next() {
  while (running < CONCURRENCY && queue.length > 0) {
    const job = queue.shift();
    running++;
    Promise.resolve()
      .then(job.fn)
      .catch((err) => console.error(`Background job "${job.name}" failed: ${err.message}`))
      .finally(() => {
        running--;
        if (running === 0 && queue.length === 0) {
          const waiters = idleWaiters;
          idleWaiters = [];
          waiters.forEach((resolve) => resolve());
        }
        next();
      });
  }
}

export function enqueue(name, fn) {
  queue.push({ name, fn });
  // Defer so the caller's response is written before any work starts.
  setImmediate(next);
}

// Resolves once nothing is queued or running. Used by tests and scripts.
export function idle() {
  if (running === 0 && queue.length === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}
