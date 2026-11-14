// k-means with k-means++ seeding, written out rather than imported so the
// behaviour is fully understood and deterministic: the same pixels always
// give the same palette (a seeded generator replaces Math.random), which
// matters both for tests and for a board not reshuffling its colours on
// re-analysis.

// Small, fast seeded PRNG (mulberry32).
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sqDist(points, i, centroids, c, dims) {
  let sum = 0;
  const pi = i * dims;
  const ci = c * dims;
  for (let d = 0; d < dims; d++) {
    const diff = points[pi + d] - centroids[ci + d];
    sum += diff * diff;
  }
  return sum;
}

/**
 * @param {Float32Array|Float64Array|number[]} points flat array, n * dims long
 * @param {number} dims dimensions per point
 * @param {number} k clusters wanted (reduced automatically if n < k)
 * @returns {{centroids: Float64Array, assignments: Int32Array, counts: Int32Array, k: number, iterations: number}}
 */
export function kmeans(points, dims, k, { maxIterations = 20, seed = 1, tolerance = 1e-3 } = {}) {
  const n = Math.floor(points.length / dims);
  const assignments = new Int32Array(n);
  if (n === 0) return { centroids: new Float64Array(0), assignments, counts: new Int32Array(0), k: 0, iterations: 0 };
  k = Math.max(1, Math.min(k, n));
  const random = seededRandom(seed);
  const centroids = new Float64Array(k * dims);

  // k-means++: first centre uniformly at random, each next centre chosen
  // with probability proportional to its squared distance from the nearest
  // centre already picked. Spreads the starting centres out, which avoids
  // most of the bad local optima plain random seeding falls into.
  const first = Math.floor(random() * n);
  for (let d = 0; d < dims; d++) centroids[d] = points[first * dims + d];
  const nearest = new Float64Array(n).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let total = 0;
    for (let i = 0; i < n; i++) {
      const dist = sqDist(points, i, centroids, c - 1, dims);
      if (dist < nearest[i]) nearest[i] = dist;
      total += nearest[i];
    }
    let pick = n - 1;
    if (total > 0) {
      let target = random() * total;
      for (let i = 0; i < n; i++) {
        target -= nearest[i];
        if (target <= 0) {
          pick = i;
          break;
        }
      }
    } else {
      pick = Math.floor(random() * n); // every remaining point duplicates a centre
    }
    for (let d = 0; d < dims; d++) centroids[c * dims + d] = points[pick * dims + d];
  }

  const counts = new Int32Array(k);
  const sums = new Float64Array(k * dims);
  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    counts.fill(0);
    sums.fill(0);
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const dist = sqDist(points, i, centroids, c, dims);
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      assignments[i] = best;
      counts[best]++;
      for (let d = 0; d < dims; d++) sums[best * dims + d] += points[i * dims + d];
    }
    let shift = 0;
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue; // an emptied cluster keeps its old centre
      for (let d = 0; d < dims; d++) {
        const next = sums[c * dims + d] / counts[c];
        shift += (next - centroids[c * dims + d]) ** 2;
        centroids[c * dims + d] = next;
      }
    }
    if (shift < tolerance) {
      iterations++;
      break;
    }
  }
  return { centroids, assignments, counts, k, iterations };
}
