// Everything Moodloom works out about an image on its own: its size, a
// thumbnail, its colour palette and a few colour-character words. No model,
// no network: sharp for decoding and classic clustering for the palette.
import sharp from 'sharp';
import { kmeans } from '../lib/kmeans.js';
import { rgbToLab, labToRgb, rgbToHex, deltaE2000, describeColor, paletteTraits } from '../lib/color.js';

// Decoding untrusted images: cap the pixel count so a tiny file that expands
// to gigapixels (a decompression bomb) is refused instead of exhausting RAM.
const SHARP_OPTIONS = { limitInputPixels: 80_000_000, failOn: 'error' };

const SAMPLE_SIZE = 96; // palette is computed on a thumbnail at most this many px per side
const START_K = 8; // clusters to begin with, before merging near-identical ones
const MERGE_DELTA_E = 9; // centres closer than this (CIEDE2000) are one colour to the eye
const MIN_SHARE = 0.012; // drop specks under about 1% unless nothing else is left
const MAX_COLORS = 6;

export async function imageSize(buffer) {
  const meta = await sharp(buffer, SHARP_OPTIONS).metadata();
  // EXIF orientations 5 to 8 are rotated a quarter turn: swap the sides.
  const rotated = (meta.orientation || 1) >= 5;
  return {
    width: rotated ? meta.height : meta.width,
    height: rotated ? meta.width : meta.height,
    format: meta.format,
    animated: (meta.pages || 1) > 1,
  };
}

/**
 * Extracts a palette of up to six colours, most-used first.
 *
 * Method: shrink the image, convert every opaque pixel to CIELAB, run
 * k-means++ with k = 8, then merge any two cluster centres that are closer
 * than a just-clearly-noticeable difference (CIEDE2000 under 9). Starting
 * with more clusters than needed and merging is what lets a flat two-colour
 * poster come out as two swatches and a busy photo as six, without having
 * to guess k per image.
 *
 * @returns {Promise<Array<{hex: string, pct: number, name: string}>>}
 */
export async function extractPalette(buffer, { startK = START_K, mergeDeltaE = MERGE_DELTA_E, space = 'lab' } = {}) {
  const { data, info } = await sharp(buffer, SHARP_OPTIONS)
    .rotate()
    // Nearest-neighbour keeps real pixel colours. A smoothing kernel would
    // invent blends along every edge (a grey fringe between black and white)
    // and those blends then show up as palette colours that are not in the image.
    .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'inside', withoutEnlargement: true, kernel: 'nearest' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const total = info.width * info.height;
  const points = new Float32Array(total * 3);
  let n = 0;
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    if (data[o + 3] < 128) continue; // transparent pixels are not part of the picture
    const v = space === 'lab' ? rgbToLab(data[o], data[o + 1], data[o + 2]) : [data[o], data[o + 1], data[o + 2]];
    points[n * 3] = v[0];
    points[n * 3 + 1] = v[1];
    points[n * 3 + 2] = v[2];
    n++;
  }
  if (n === 0) return [];

  const result = kmeans(points.subarray(0, n * 3), 3, startK, { maxIterations: 24, seed: 7 });

  let clusters = [];
  for (let c = 0; c < result.k; c++) {
    if (result.counts[c] === 0) continue;
    const centre = [result.centroids[c * 3], result.centroids[c * 3 + 1], result.centroids[c * 3 + 2]];
    clusters.push({ lab: space === 'lab' ? centre : rgbToLab(...centre), count: result.counts[c] });
  }

  // Greedy merge: repeatedly fuse the closest pair until every remaining
  // pair is visibly different. The merged centre is the count-weighted mean.
  for (;;) {
    let best = null;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = deltaE2000(clusters[i].lab, clusters[j].lab);
        if (d < mergeDeltaE && (!best || d < best.d)) best = { i, j, d };
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
  const kept = clusters.filter((c, i) => i === 0 || c.count / n >= MIN_SHARE).slice(0, MAX_COLORS);
  const keptTotal = kept.reduce((sum, c) => sum + c.count, 0);

  return kept.map((c) => ({
    hex: rgbToHex(...labToRgb(...c.lab)),
    pct: Math.round((c.count / keptTotal) * 1000) / 10,
    name: describeColor(c.lab),
  }));
}

// A smaller copy for the board grid. Returns null when the original is
// already small enough to serve as it is.
export async function makeThumbnail(buffer, { maxWidth = 720 } = {}) {
  const meta = await sharp(buffer, SHARP_OPTIONS).metadata();
  if ((meta.width || 0) <= maxWidth && buffer.length < 220 * 1024) return null;
  return sharp(buffer, SHARP_OPTIONS)
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
}

// A bounded JPEG for sending to a vision model: enough to judge style,
// small enough to keep the request cheap.
export async function toModelImage(buffer, { maxSide = 768 } = {}) {
  return sharp(buffer, SHARP_OPTIONS)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();
}

export async function analyzeImage(buffer) {
  const size = await imageSize(buffer);
  const palette = await extractPalette(buffer);
  return { width: size.width, height: size.height, palette, traits: paletteTraits(palette) };
}

export { SHARP_OPTIONS };
