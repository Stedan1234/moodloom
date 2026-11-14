// Vector maths over item embeddings: nearest neighbours, a diverse subset,
// and grouping. All vectors are L2-normalised, so cosine similarity is a dot
// product and "distance" below means 1 - cosine.
import { kmeans } from '../../lib/kmeans.js';

export function cosine(a, b) {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot;
}

/** The `limit` most similar candidates to `target`, best first. */
export function nearest(target, candidates, limit = 8) {
  return candidates
    .map((c) => ({ id: c.id, score: cosine(target, c.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** The item closest on average to all the others: the most typical one. */
export function medoid(items) {
  if (items.length === 0) return null;
  let best = items[0];
  let bestScore = -Infinity;
  for (const a of items) {
    let score = 0;
    for (const b of items) score += cosine(a.vector, b.vector);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

/**
 * Picks `count` items that cover the set as evenly as possible (greedy
 * k-centre, also called farthest-point sampling): start from the most
 * typical item, then repeatedly add whichever item is farthest from
 * everything chosen so far. Used to choose which references a language
 * model gets to see when a board has more than fit in one request, so the
 * sample represents the range of the board rather than its ten newest pins.
 */
export function diverseSubset(items, count) {
  if (items.length <= count) return items.slice();
  const chosen = [medoid(items)];
  const distance = new Map(items.map((it) => [it.id, 1 - cosine(it.vector, chosen[0].vector)]));
  while (chosen.length < count) {
    let far = null;
    let farDist = -1;
    for (const it of items) {
      const d = distance.get(it.id);
      if (d > farDist) {
        farDist = d;
        far = it;
      }
    }
    chosen.push(far);
    for (const it of items) {
      const d = 1 - cosine(it.vector, far.vector);
      if (d < distance.get(it.id)) distance.set(it.id, d);
    }
  }
  return chosen;
}

/** Mean distance from every item to its nearest chosen item (lower = better coverage). */
export function coverage(items, chosen) {
  if (items.length === 0 || chosen.length === 0) return 0;
  let sum = 0;
  for (const it of items) {
    let best = Infinity;
    for (const c of chosen) best = Math.min(best, 1 - cosine(it.vector, c.vector));
    sum += best;
  }
  return sum / items.length;
}

// Mean silhouette score for a clustering, with cosine distance. Ranges from
// -1 (wrong) to 1 (tight, well separated); used only to compare candidate k.
function silhouette(items, assignments, k) {
  const n = items.length;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const sums = new Float64Array(k);
    const counts = new Int32Array(k);
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      sums[assignments[j]] += 1 - cosine(items[i].vector, items[j].vector);
      counts[assignments[j]]++;
    }
    const own = assignments[i];
    if (counts[own] === 0) continue; // a cluster of one scores 0
    const a = sums[own] / counts[own];
    let b = Infinity;
    for (let c = 0; c < k; c++) if (c !== own && counts[c] > 0) b = Math.min(b, sums[c] / counts[c]);
    if (b === Infinity) continue;
    total += (b - a) / Math.max(a, b);
  }
  return total / n;
}

/**
 * Groups items into visually coherent clusters. k is not asked for: every
 * k from 2 up to a small maximum is tried and the one with the best
 * silhouette score wins. Returns [] when the items don't separate into
 * groups meaningfully (best score under `minScore`).
 */
export function suggestGroups(items, { maxK = 6, minScore = 0.08, seed = 11 } = {}) {
  const n = items.length;
  if (n < 4) return { groups: [], score: 0, k: 0 };
  const dims = items[0].vector.length;
  const flat = new Float32Array(n * dims);
  items.forEach((it, i) => flat.set(it.vector, i * dims));

  let best = null;
  const limit = Math.min(maxK, Math.floor(n / 2));
  for (let k = 2; k <= limit; k++) {
    const result = kmeans(flat, dims, k, { maxIterations: 30, seed });
    const score = silhouette(items, result.assignments, result.k);
    if (!best || score > best.score) best = { score, k: result.k, assignments: result.assignments };
  }
  if (!best || best.score < minScore) return { groups: [], score: best?.score ?? 0, k: 0 };

  const groups = [];
  for (let c = 0; c < best.k; c++) {
    const members = items.filter((_, i) => best.assignments[i] === c);
    if (members.length < 2) continue;
    groups.push({ items: members, representative: medoid(members) });
  }
  groups.sort((a, b) => b.items.length - a.items.length);
  return { groups, score: best.score, k: best.k };
}

/**
 * Suggests a category for one item by a similarity-weighted vote among its
 * k nearest already-categorised neighbours. Returns null unless one
 * category clearly wins.
 */
export function suggestCategory(target, labelled, { k = 5, minShare = 0.55, minSimilarity = 0.5 } = {}) {
  if (labelled.length < 3) return null;
  const neighbours = labelled
    .map((it) => ({ category: it.category, score: cosine(target, it.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  if (neighbours[0].score < minSimilarity) return null;
  const votes = new Map();
  let total = 0;
  for (const nb of neighbours) {
    const w = Math.max(nb.score, 0);
    votes.set(nb.category, (votes.get(nb.category) || 0) + w);
    total += w;
  }
  let winner = null;
  for (const [category, weight] of votes) if (!winner || weight > winner.weight) winner = { category, weight };
  const share = total > 0 ? winner.weight / total : 0;
  return share >= minShare ? { category: winner.category, confidence: Math.round(share * 100) / 100 } : null;
}
