// "Classic" image features: a hand-built descriptor of how an image LOOKS
// (its colours, where they sit, how busy and which way its edges run), with
// no neural network and nothing to download. It is the default embedder
// because it runs anywhere in a few milliseconds; the CLIP embedder
// (clip.js) is the upgrade when "looks alike" should also mean "is about
// the same thing".
//
// The vector has four blocks. Each block is L2-normalised on its own and
// then scaled by a weight, so no block can dominate just by having more
// dimensions. The weights were chosen by the ablation in
// scripts/evalSimilarity.js (results in docs/ai/).
//
//   colour histogram   144 dims  which colours, how much (CIELAB, 4x6x6 bins)
//   colour layout       48 dims  mean colour in each cell of a 4x4 grid
//   edge orientation    33 dims  8 directions x 2x2 cells, plus edge density
//   global statistics    5 dims  lightness / chroma means and spreads
import sharp from 'sharp';
import { rgbToLab } from '../../../lib/color.js';
import { SHARP_OPTIONS } from '../../analysis.js';

const SIZE = 64;
export const CLASSIC_WEIGHTS = { histogram: 1.0, layout: 0.7, edges: 0.8, stats: 0.4 };

const L_BINS = 4;
const A_BINS = 6;
const B_BINS = 6;
const GRID = 4;
const EDGE_CELLS = 2;
const ORIENTATIONS = 8;

function normalise(block) {
  let sum = 0;
  for (const v of block) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm > 0) for (let i = 0; i < block.length; i++) block[i] /= norm;
  return block;
}

function clampBin(value, min, max, bins) {
  const t = (value - min) / (max - min);
  return Math.max(0, Math.min(bins - 1, Math.floor(t * bins)));
}

export function featuresFromPixels(rgb, weights = CLASSIC_WEIGHTS) {
  const n = SIZE * SIZE;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lab = rgbToLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    L[i] = lab[0];
    A[i] = lab[1];
    B[i] = lab[2];
  }

  // 1. Colour histogram. Square-rooting the bin shares (the Hellinger
  //    transform) stops one large flat background from swamping everything.
  const histogram = new Float32Array(L_BINS * A_BINS * B_BINS);
  for (let i = 0; i < n; i++) {
    const bin =
      clampBin(L[i], 0, 100, L_BINS) * A_BINS * B_BINS +
      clampBin(A[i], -70, 70, A_BINS) * B_BINS +
      clampBin(B[i], -70, 70, B_BINS);
    histogram[bin]++;
  }
  for (let i = 0; i < histogram.length; i++) histogram[i] = Math.sqrt(histogram[i] / n);

  // 2. Colour layout: where the colours are, coarsely.
  const layout = new Float32Array(GRID * GRID * 3);
  const cell = SIZE / GRID;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const c = (Math.floor(y / cell) * GRID + Math.floor(x / cell)) * 3;
      const i = y * SIZE + x;
      layout[c] += L[i] / 100;
      layout[c + 1] += A[i] / 128;
      layout[c + 2] += B[i] / 128;
    }
  }
  for (let i = 0; i < layout.length; i++) layout[i] /= cell * cell;
  // Centre the lightness channel so "everything mid-grey" isn't a long vector.
  for (let i = 0; i < layout.length; i += 3) layout[i] -= 0.5;

  // 3. Edge orientation histogram from Sobel gradients on lightness. Captures
  //    texture and structure: grids, type, soft gradients, busy photographs.
  const edges = new Float32Array(EDGE_CELLS * EDGE_CELLS * ORIENTATIONS + 1);
  const edgeCell = SIZE / EDGE_CELLS;
  let strong = 0;
  for (let y = 1; y < SIZE - 1; y++) {
    for (let x = 1; x < SIZE - 1; x++) {
      const i = y * SIZE + x;
      const gx =
        L[i - SIZE + 1] + 2 * L[i + 1] + L[i + SIZE + 1] - L[i - SIZE - 1] - 2 * L[i - 1] - L[i + SIZE - 1];
      const gy =
        L[i + SIZE - 1] + 2 * L[i + SIZE] + L[i + SIZE + 1] - L[i - SIZE - 1] - 2 * L[i - SIZE] - L[i - SIZE + 1];
      const magnitude = Math.hypot(gx, gy);
      if (magnitude < 12) continue; // flat area or noise
      strong++;
      let angle = Math.atan2(gy, gx); // edge direction, folded to 0..pi
      if (angle < 0) angle += Math.PI;
      const bin = Math.min(ORIENTATIONS - 1, Math.floor((angle / Math.PI) * ORIENTATIONS));
      const c = Math.floor(y / edgeCell) * EDGE_CELLS + Math.floor(x / edgeCell);
      edges[c * ORIENTATIONS + bin] += magnitude;
    }
  }
  normalise(edges.subarray(0, edges.length - 1));
  edges[edges.length - 1] = strong / ((SIZE - 2) * (SIZE - 2)); // how much of the image is edge

  // 4. Global statistics.
  let meanL = 0;
  let meanC = 0;
  for (let i = 0; i < n; i++) {
    meanL += L[i];
    meanC += Math.hypot(A[i], B[i]);
  }
  meanL /= n;
  meanC /= n;
  let varL = 0;
  let varC = 0;
  for (let i = 0; i < n; i++) {
    varL += (L[i] - meanL) ** 2;
    varC += (Math.hypot(A[i], B[i]) - meanC) ** 2;
  }
  const stats = Float32Array.from([
    meanL / 100 - 0.5,
    Math.sqrt(varL / n) / 50,
    meanC / 100,
    Math.sqrt(varC / n) / 50,
    edges[edges.length - 1],
  ]);

  const blocks = [
    [normalise(histogram), weights.histogram],
    [normalise(layout), weights.layout],
    [normalise(Float32Array.from(edges)), weights.edges],
    [normalise(stats), weights.stats],
  ];
  const total = blocks.reduce((sum, [block, w]) => sum + (w > 0 ? block.length : 0), 0);
  const vector = new Float32Array(total);
  let offset = 0;
  for (const [block, w] of blocks) {
    if (w <= 0) continue;
    for (let i = 0; i < block.length; i++) vector[offset + i] = block[i] * w;
    offset += block.length;
  }
  return normalise(vector);
}

export async function pixelsFor(buffer) {
  const { data } = await sharp(buffer, SHARP_OPTIONS)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(SIZE, SIZE, { fit: 'fill' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

export const classicEmbedder = {
  name: 'classic-v1',
  semantic: false,
  async embedImage(buffer) {
    return featuresFromPixels(await pixelsFor(buffer));
  },
};
