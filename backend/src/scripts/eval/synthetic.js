// Procedurally generated test images with KNOWN ground truth, so the
// analysis code can be measured rather than eyeballed. Everything is driven
// by a seeded generator: the same seed always produces the same dataset, so
// any number in docs/ai/RESULTS.md can be reproduced exactly.
import sharp from 'sharp';
import { seededRandom } from '../../lib/kmeans.js';
import { rgbToLab, labToRgb, rgbToHex, deltaE2000 } from '../../lib/color.js';

export function rng(seed) {
  const next = seededRandom(seed);
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
  };
}

function randomLab(r) {
  // Sample in LCh so the colours span the gamut a designer actually uses,
  // then keep only those that survive a round trip through sRGB.
  for (;;) {
    const L = r.range(12, 94);
    const C = r.next() < 0.25 ? r.range(0, 8) : r.range(15, 75);
    const h = r.range(0, Math.PI * 2);
    const lab = [L, C * Math.cos(h), C * Math.sin(h)];
    const back = rgbToLab(...labToRgb(...lab));
    if (deltaE2000(lab, back) < 1) return back;
  }
}

/** n colours, every pair at least `minDeltaE` apart (clearly different to the eye). */
export function randomPalette(r, n, minDeltaE = 22) {
  const colors = [];
  let guard = 0;
  while (colors.length < n && guard++ < 5000) {
    const lab = randomLab(r);
    if (colors.every((c) => deltaE2000(c, lab) >= minDeltaE)) colors.push(lab);
  }
  return colors;
}

/** Shares summing to 1, each at least `min`. */
export function randomShares(r, n, min = 0.08) {
  const raw = Array.from({ length: n }, () => r.range(0.2, 1));
  const total = raw.reduce((a, b) => a + b, 0);
  const free = 1 - n * min;
  return raw.map((v) => min + (v / total) * free);
}

const hex = (lab) => rgbToHex(...labToRgb(...lab));

/** Flat vertical blocks of each colour, widths proportional to shares. */
export function blocksSvg(colors, shares, size = 240) {
  let x = 0;
  const rects = colors
    .map((c, i) => {
      const w = shares[i] * size;
      const rect = `<rect x="${x.toFixed(2)}" y="0" width="${(w + 0.5).toFixed(2)}" height="${size}" fill="${hex(c)}"/>`;
      x += w;
      return rect;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" shape-rendering="crispEdges">${rects}</svg>`;
}

export async function render(svg, { noise = 0, jpegQuality = null, seed = 1 } = {}) {
  let image = sharp(Buffer.from(svg));
  if (noise > 0) {
    const { data, info } = await image.removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const r = seededRandom(seed);
    for (let i = 0; i < data.length; i++) {
      // Sum of three uniforms: close enough to Gaussian for sensor-like noise.
      const g = (r() + r() + r() - 1.5) * 2 * noise;
      data[i] = Math.max(0, Math.min(255, Math.round(data[i] + g)));
    }
    image = sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } });
  }
  return jpegQuality ? image.jpeg({ quality: jpegQuality }).toBuffer() : image.png().toBuffer();
}

// ── a labelled "style" dataset for retrieval ────────────────────────────
// A class is a colour family crossed with a structure. Members of a class
// share both but differ in the details (exact shades, counts, positions),
// the way a set of references in one style do.
const FAMILIES = [
  { name: 'ink & paper', base: [[12, 0, 0], [95, 0, 3]] },
  { name: 'warm earth', base: [[48, 45, 38], [75, 12, 60], [30, 12, 14]] },
  { name: 'cool sea', base: [[25, 8, -30], [62, -25, -22], [88, -6, -8]] },
  { name: 'forest', base: [[30, -22, 14], [58, -36, 34], [90, -4, 18]] },
  { name: 'candy', base: [[62, 62, -8], [82, 6, 70], [68, -42, -28]] },
  { name: 'dusk', base: [[22, 28, -38], [48, 52, -6], [78, 22, 30]] },
];
const STRUCTURES = ['blocks', 'vstripes', 'hstripes', 'dots', 'checker', 'gradient'];

function jitter(r, lab, amount) {
  return [lab[0] + r.range(-amount, amount), lab[1] + r.range(-amount, amount), lab[2] + r.range(-amount, amount)];
}

function structureSvg(r, structure, colors, size) {
  const c = colors.map(hex);
  const bg = c[0];
  let body = '';
  if (structure === 'blocks') {
    return blocksSvg(colors, randomShares(r, colors.length, 0.15), size);
  } else if (structure === 'vstripes' || structure === 'hstripes') {
    const bands = r.int(8, 16);
    const w = size / bands;
    for (let i = 0; i < bands; i++) {
      body += structure === 'vstripes'
        ? `<rect x="${i * w}" y="0" width="${w + 0.5}" height="${size}" fill="${c[i % c.length]}"/>`
        : `<rect x="0" y="${i * w}" width="${size}" height="${w + 0.5}" fill="${c[i % c.length]}"/>`;
    }
  } else if (structure === 'dots') {
    const n = r.int(4, 7);
    const step = size / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      body += `<circle cx="${(x + 0.5) * step}" cy="${(y + 0.5) * step}" r="${step * r.range(0.26, 0.36)}" fill="${c[1 + ((x + y) % (c.length - 1))]}"/>`;
    }
  } else if (structure === 'checker') {
    const n = r.int(4, 8);
    const step = size / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if ((x + y) % 2) body += `<rect x="${x * step}" y="${y * step}" width="${step + 0.5}" height="${step + 0.5}" fill="${c[1 + ((x * 3 + y) % (c.length - 1))]}"/>`;
    }
  } else if (structure === 'gradient') {
    const angle = r.int(0, 3) * 45;
    const stops = c.map((col, i) => `<stop offset="${(i / (c.length - 1)) * 100}%" stop-color="${col}"/>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)">${stops}</linearGradient></defs><rect width="${size}" height="${size}" fill="url(#g)"/></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="${bg}"/>${body}</svg>`;
}

/**
 * @returns {Promise<Array<{id:number, family:string, structure:string, label:string, buffer:Buffer}>>}
 */
export async function styleDataset({ perClass = 12, seed = 2026, size = 200, noise = 4 } = {}) {
  const r = rng(seed);
  const items = [];
  let id = 0;
  for (const family of FAMILIES) {
    for (const structure of STRUCTURES) {
      for (let i = 0; i < perClass; i++) {
        const colors = family.base.map((lab) => rgbToLab(...labToRgb(...jitter(r, lab, 6))));
        const svg = structureSvg(r, structure, colors, size);
        items.push({
          id: id++,
          family: family.name,
          structure,
          label: `${family.name} / ${structure}`,
          buffer: await render(svg, { noise, seed: seed + id }),
        });
      }
    }
  }
  return items;
}

export { FAMILIES, STRUCTURES };
