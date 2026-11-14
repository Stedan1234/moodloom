// Experiment 2: do the classic image features put images of the same style
// near each other, and which blocks of the vector earn their place?
// Experiment 3: does farthest-point selection cover a board better than
// taking a random handful or the most recent few?
import sharp from 'sharp';
import { featuresFromPixels, pixelsFor, CLASSIC_WEIGHTS } from '../../services/ai/embedders/classic.js';
import { cosine, diverseSubset, coverage } from '../../services/ai/similarity.js';
import { rgbToLab } from '../../lib/color.js';
import { rng, styleDataset } from './synthetic.js';

function unit(values) {
  const v = Float32Array.from(values);
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

// Baseline 1: the image's mean colour (3 numbers).
async function meanColour(buffer) {
  const { data } = await sharp(buffer).resize(1, 1, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lab = rgbToLab(data[0], data[1], data[2]);
  return unit([lab[0] / 100, lab[1] / 100, lab[2] / 100]);
}

// Baseline 2: the image shrunk to 8x8 and compared pixel by pixel.
async function tinyPixels(buffer) {
  const { data } = await sharp(buffer).resize(8, 8, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return unit(Array.from(data, (v) => v / 255 - 0.5));
}

function retrieval(vectors, labels) {
  const n = vectors.length;
  let top1 = 0;
  let precision5 = 0;
  let averagePrecision = 0;
  for (let i = 0; i < n; i++) {
    const ranked = [];
    for (let j = 0; j < n; j++) if (j !== i) ranked.push({ j, s: cosine(vectors[i], vectors[j]) });
    ranked.sort((a, b) => b.s - a.s);
    if (labels[ranked[0].j] === labels[i]) top1++;
    precision5 += ranked.slice(0, 5).filter((r) => labels[r.j] === labels[i]).length / 5;
    let hits = 0;
    let ap = 0;
    ranked.forEach((r, rank) => {
      if (labels[r.j] === labels[i]) {
        hits++;
        ap += hits / (rank + 1);
      }
    });
    averagePrecision += hits ? ap / hits : 0;
  }
  return { top1: +(top1 / n).toFixed(3), precisionAt5: +(precision5 / n).toFixed(3), meanAP: +(averagePrecision / n).toFixed(3) };
}

export async function runSimilarityEval({ perClass = 12, seed = 2026 } = {}) {
  const dataset = await styleDataset({ perClass, seed });
  const pixels = [];
  const started = performance.now();
  for (const item of dataset) pixels.push(await pixelsFor(item.buffer));
  const decodeMs = (performance.now() - started) / dataset.length;

  const featureStart = performance.now();
  const full = pixels.map((p) => featuresFromPixels(p));
  const featureMs = (performance.now() - featureStart) / dataset.length;

  const variants = {
    'classic-v1 (all four blocks)': full,
    'ablation: colour histogram only': pixels.map((p) => featuresFromPixels(p, { histogram: 1, layout: 0, edges: 0, stats: 0 })),
    'ablation: histogram + layout': pixels.map((p) => featuresFromPixels(p, { histogram: 1, layout: 0.7, edges: 0, stats: 0 })),
    'ablation: edges only (no colour)': pixels.map((p) => featuresFromPixels(p, { histogram: 0, layout: 0, edges: 1, stats: 0 })),
    'ablation: without edges': pixels.map((p) => featuresFromPixels(p, { ...CLASSIC_WEIGHTS, edges: 0 })),
    'baseline: mean colour': await Promise.all(dataset.map((d) => meanColour(d.buffer))),
    'baseline: 8x8 pixels': await Promise.all(dataset.map((d) => tinyPixels(d.buffer))),
  };

  const tasks = {
    'same style (colour family + structure, 36 classes)': dataset.map((d) => d.label),
    'same colour family (6 classes)': dataset.map((d) => d.family),
    'same structure (6 classes)': dataset.map((d) => d.structure),
  };
  const retrievalResults = [];
  for (const [task, labels] of Object.entries(tasks)) {
    const chance = 1 / new Set(labels).size;
    for (const [variant, vectors] of Object.entries(variants)) {
      retrievalResults.push({ task, variant, chance: +chance.toFixed(3), ...retrieval(vectors, labels) });
    }
  }

  // Experiment 3: choose 10 of the 432 to "show a model". How much of the
  // dataset's range do they represent?
  const items = dataset.map((d, i) => ({ id: d.id, vector: full[i], label: d.label, family: d.family, structure: d.structure }));
  const describe = (chosen) => ({
    coverage: coverage(items, chosen),
    families: new Set(chosen.map((c) => c.family)).size,
    structures: new Set(chosen.map((c) => c.structure)).size,
  });
  const diverse = describe(diverseSubset(items, 10));
  const firstTen = describe(items.slice(0, 10)); // "most recent" on a board added in order
  const r = rng(seed + 9);
  const randomRuns = Array.from({ length: 300 }, () => {
    const pool = items.slice();
    const pick = [];
    for (let i = 0; i < 10; i++) pick.push(pool.splice(Math.floor(r.next() * pool.length), 1)[0]);
    return describe(pick);
  });
  const avg = (key) => randomRuns.reduce((s, x) => s + x[key], 0) / randomRuns.length;
  const fmt = (x) => ({ coverage: +x.coverage.toFixed(3), families: +(+x.families).toFixed(2), structures: +(+x.structures).toFixed(2) });

  return {
    dataset: { images: dataset.length, classes: 36, perClass, seed },
    timing: { decodeMsPerImage: +decodeMs.toFixed(1), featureMsPerImage: +featureMs.toFixed(2), dims: full[0].length },
    retrieval: retrievalResults,
    selection: {
      choose: 10,
      from: items.length,
      'farthest-point (used)': fmt(diverse),
      'random (mean of 300 draws)': fmt({ coverage: avg('coverage'), families: avg('families'), structures: avg('structures') }),
      'first ten (a board added in order)': fmt(firstTen),
    },
  };
}
