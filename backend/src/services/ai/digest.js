// "What this board has in common", computed with no model at all: the
// colours its references share, how they lean (dark, warm, muted…), the
// tags used most and the mix of kinds. Always available, costs nothing,
// sends nothing anywhere; it is also the factual backbone a direction note
// is given so the language model doesn't have to guess at colour.
import { kmeans } from '../../lib/kmeans.js';
import { hexToLab, labToRgb, rgbToHex, deltaE2000, describeColor } from '../../lib/color.js';

function sharedPalette(items) {
  // Every swatch of every item becomes a weighted point: each item counts
  // once in total, split across its swatches by their share of the image.
  const points = [];
  const weights = [];
  for (const item of items) {
    for (const swatch of item.palette || []) {
      const lab = hexToLab(swatch.hex);
      if (!lab) continue;
      points.push(lab);
      weights.push((swatch.pct ?? 0) / 100);
    }
  }
  if (points.length === 0) return [];

  // Weighted k-means by repetition: each point is repeated in proportion to
  // its weight (resolution of 5%), which is simple and exact enough here.
  const expanded = [];
  points.forEach((p, i) => {
    const copies = Math.max(1, Math.round(weights[i] * 20));
    for (let c = 0; c < copies; c++) expanded.push(p[0], p[1], p[2]);
  });
  const result = kmeans(Float32Array.from(expanded), 3, 8, { maxIterations: 30, seed: 5 });

  let clusters = [];
  for (let c = 0; c < result.k; c++) {
    if (result.counts[c] === 0) continue;
    clusters.push({ lab: [result.centroids[c * 3], result.centroids[c * 3 + 1], result.centroids[c * 3 + 2]], count: result.counts[c] });
  }
  for (;;) {
    let best = null;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = deltaE2000(clusters[i].lab, clusters[j].lab);
        if (d < 10 && (!best || d < best.d)) best = { i, j, d };
      }
    }
    if (!best) break;
    const a = clusters[best.i];
    const b = clusters[best.j];
    const count = a.count + b.count;
    a.lab = a.lab.map((v, k) => (v * a.count + b.lab[k] * b.count) / count);
    a.count = count;
    clusters.splice(best.j, 1);
  }
  clusters.sort((a, b) => b.count - a.count);
  clusters = clusters.slice(0, 6);
  const total = clusters.reduce((sum, c) => sum + c.count, 0);
  return clusters.map((c) => ({
    hex: rgbToHex(...labToRgb(...c.lab)),
    pct: Math.round((c.count / total) * 1000) / 10,
    name: describeColor(c.lab),
  }));
}

function tally(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

export function buildDigest(items) {
  const analysed = items.filter((it) => it.palette?.length);
  const traits = tally(analysed.flatMap((it) => it.meta?.traits || [])).map(([trait, count]) => ({
    trait,
    share: Math.round((count / analysed.length) * 100),
  }));
  return {
    itemCount: items.length,
    analysedCount: analysed.length,
    palette: sharedPalette(analysed),
    // Only a lean that most of the board shares is worth stating.
    traits: traits.filter((t) => t.share >= 40),
    tags: tally(items.flatMap((it) => it.tags || []))
      .slice(0, 12)
      .map(([tag, count]) => ({ tag, count })),
    kinds: Object.fromEntries(tally(items.map((it) => it.media_type))),
    notedCount: items.filter((it) => it.note && it.note.trim()).length,
  };
}
