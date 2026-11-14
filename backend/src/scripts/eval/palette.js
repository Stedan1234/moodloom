// Experiment 1: how accurately does palette extraction recover colours that
// are known to be in an image, and what does each design choice contribute?
import sharp from 'sharp';
import { extractPalette } from '../../services/analysis.js';
import { hexToLab, rgbToLab, rgbToHex, deltaE2000 } from '../../lib/color.js';
import { rng, randomPalette, randomShares, blocksSvg, render } from './synthetic.js';

// Baseline: the "popularity" method. Quantise RGB to 4 bits per channel,
// count, and return the most common bins. Simple and widely used.
async function popularityPalette(buffer, max = 6) {
  const { data, info } = await sharp(buffer).resize(96, 96, { fit: 'inside', kernel: 'nearest' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = new Map();
  const n = info.width * info.height;
  for (let i = 0; i < n; i++) {
    const key = ((data[i * 3] >> 4) << 8) | ((data[i * 3 + 1] >> 4) << 4) | (data[i * 3 + 2] >> 4);
    const bin = bins.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bin.count++;
    bin.r += data[i * 3];
    bin.g += data[i * 3 + 1];
    bin.b += data[i * 3 + 2];
    bins.set(key, bin);
  }
  return [...bins.values()]
    .filter((b) => b.count / n >= 0.012)
    .sort((a, b) => b.count - a.count)
    .slice(0, max)
    .map((b) => ({ hex: rgbToHex(Math.round(b.r / b.count), Math.round(b.g / b.count), Math.round(b.b / b.count)), pct: (b.count / n) * 100 }));
}

// Ablation: same pipeline, but the thumbnail is made with a smoothing
// kernel instead of nearest-neighbour.
async function smoothedInput(buffer) {
  return sharp(buffer).resize(96, 96, { fit: 'inside' }).png().toBuffer();
}

const METHODS = {
  'Moodloom (Lab k-means++, k=8, merge ΔE<9)': (b) => extractPalette(b),
  'ablation: cluster in RGB instead of Lab': (b) => extractPalette(b, { space: 'rgb' }),
  'ablation: no merge step (k=8 as is)': (b) => extractPalette(b, { mergeDeltaE: 0 }),
  'ablation: smoothed thumbnail (not nearest)': async (b) => extractPalette(await smoothedInput(b)),
  'baseline: popularity (4-bit RGB bins)': (b) => popularityPalette(b),
};

function score(truth, shares, palette) {
  const extracted = palette.map((s) => ({ lab: hexToLab(s.hex), pct: s.pct }));
  let sumDelta = 0;
  let recovered = 0;
  let shareError = 0;
  for (let i = 0; i < truth.length; i++) {
    let best = { d: Infinity, pct: 0 };
    for (const e of extracted) {
      const d = deltaE2000(truth[i], e.lab);
      if (d < best.d) best = { d, pct: e.pct };
    }
    const d = Math.min(best.d, 50);
    sumDelta += d;
    if (best.d < 5) {
      recovered++;
      shareError += Math.abs(best.pct - shares[i] * 100);
    }
  }
  return {
    meanDeltaE: sumDelta / truth.length,
    recall: recovered / truth.length,
    shareError: recovered ? shareError / recovered : null,
    countError: Math.abs(extracted.length - truth.length),
    extra: Math.max(0, extracted.length - truth.length),
  };
}

export async function runPaletteEval({ images = 150, seed = 41 } = {}) {
  const conditions = [
    { name: 'clean', options: {} },
    { name: 'noise σ≈6', options: { noise: 6 } },
    { name: 'JPEG q=60', options: { jpegQuality: 60 } },
    { name: 'noise + JPEG q=40', options: { noise: 6, jpegQuality: 40 } },
  ];
  const results = [];
  for (const condition of conditions) {
    const r = rng(seed);
    const cases = [];
    for (let i = 0; i < images; i++) {
      const n = r.int(2, 5);
      const truth = randomPalette(r, n);
      const shares = randomShares(r, truth.length);
      cases.push({ truth, shares, buffer: await render(blocksSvg(truth, shares), { ...condition.options, seed: seed + i }) });
    }
    for (const [method, fn] of Object.entries(METHODS)) {
      const scores = [];
      const started = performance.now();
      for (const c of cases) scores.push(score(c.truth, c.shares, await fn(c.buffer)));
      const ms = (performance.now() - started) / cases.length;
      const mean = (key) => {
        const values = scores.map((s) => s[key]).filter((v) => v !== null);
        return values.reduce((a, b) => a + b, 0) / values.length;
      };
      results.push({
        condition: condition.name,
        method,
        images: cases.length,
        meanDeltaE: +mean('meanDeltaE').toFixed(2),
        recall: +mean('recall').toFixed(3),
        shareErrorPts: +mean('shareError').toFixed(2),
        extraColours: +mean('extra').toFixed(2),
        exactCount: +(scores.filter((s) => s.countError === 0).length / scores.length).toFixed(3),
        msPerImage: +ms.toFixed(1),
      });
    }
  }
  return results;
}
