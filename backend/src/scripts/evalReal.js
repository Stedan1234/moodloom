// Measures "more like this" on YOUR OWN labelled references, so the numbers
// in docs/ai/ stop being about synthetic images only.
//
// 1. Make a folder with one sub-folder per style you'd call "the same kind
//    of thing", each holding at least 3 images:
//        my-set/
//          warm-serif-packaging/   a.jpg b.png …
//          night-photography/      …
//          flat-illustration/      …
//    The labels are your judgement as a designer. That is the point: the
//    question is whether the machine's idea of "alike" matches yours.
// 2. npm run ai:eval-real -- path/to/my-set
// 3. Read docs/ai/RESULTS-REAL.md. Nothing leaves this computer.
//
// Each image is used as a query against all the others; a hit is another
// image from the same folder. Reported for the full descriptor, for each
// block removed (does it earn its place on real images?), for two naive
// baselines, and for CLIP if AI_EMBEDDER=clip is set and the model loads.
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

process.env.DATABASE_URL ||= 'postgresql://unused';
process.env.JWT_SECRET ||= 'eval-only-secret-not-used-for-anything-0123456789';
const { featuresFromPixels, pixelsFor, CLASSIC_WEIGHTS } = await import('../services/ai/embedders/classic.js');
const { cosine } = await import('../services/ai/similarity.js');
const { config } = await import('../config.js');

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error('Usage: npm run ai:eval-real -- <folder with one sub-folder of images per style>');
  process.exit(1);
}
const IMAGE = /\.(png|jpe?g|webp|gif|avif)$/i;

const files = [];
for (const label of fs.readdirSync(dir).sort()) {
  const sub = path.join(dir, label);
  if (!fs.statSync(sub).isDirectory()) continue;
  const images = fs.readdirSync(sub).filter((f) => IMAGE.test(f)).sort();
  if (images.length < 3) {
    console.warn(`Skipping "${label}": needs at least 3 images, has ${images.length}.`);
    continue;
  }
  for (const f of images) files.push({ label, file: path.join(sub, f) });
}
const labels = [...new Set(files.map((f) => f.label))];
if (labels.length < 2) {
  console.error('Need at least two style folders with 3+ images each.');
  process.exit(1);
}

function unit(values) {
  let sum = 0;
  for (const v of values) sum += v * v;
  const norm = Math.sqrt(sum) || 1;
  return Array.from(values, (v) => v / norm);
}

function retrieval(vectors, tags) {
  const n = vectors.length;
  let top1 = 0;
  let p5 = 0;
  let map = 0;
  for (let i = 0; i < n; i++) {
    const ranked = [];
    for (let j = 0; j < n; j++) if (j !== i) ranked.push({ j, s: cosine(vectors[i], vectors[j]) });
    ranked.sort((a, b) => b.s - a.s);
    if (tags[ranked[0].j] === tags[i]) top1++;
    p5 += ranked.slice(0, 5).filter((r) => tags[r.j] === tags[i]).length / 5;
    let hits = 0;
    let ap = 0;
    ranked.forEach((r, rank) => {
      if (tags[r.j] === tags[i]) {
        hits++;
        ap += hits / (rank + 1);
      }
    });
    map += hits ? ap / hits : 0;
  }
  return { top1: +(top1 / n).toFixed(3), precisionAt5: +(p5 / n).toFixed(3), meanAP: +(map / n).toFixed(3) };
}

const tags = [];
const pixels = [];
const buffers = [];
let unreadable = 0;
for (const f of files) {
  try {
    const buffer = fs.readFileSync(f.file);
    pixels.push(await pixelsFor(buffer));
    buffers.push(buffer);
    tags.push(f.label);
  } catch {
    unreadable++;
  }
}

const without = (block) => ({ ...CLASSIC_WEIGHTS, [block]: 0 });
const variants = [
  ['classic-v1 (what Moodloom uses)', (i) => featuresFromPixels(pixels[i])],
  ['without colour histogram', (i) => featuresFromPixels(pixels[i], without('histogram'))],
  ['without colour layout', (i) => featuresFromPixels(pixels[i], without('layout'))],
  ['without edges', (i) => featuresFromPixels(pixels[i], without('edges'))],
  ['without global statistics', (i) => featuresFromPixels(pixels[i], without('stats'))],
  ['baseline: mean colour', async (i) => unit((await sharp(buffers[i]).flatten({ background: '#fff' }).resize(1, 1, { fit: 'fill' }).removeAlpha().raw().toBuffer()))],
  ['baseline: 8x8 pixels', async (i) => unit(await sharp(buffers[i]).flatten({ background: '#fff' }).resize(8, 8, { fit: 'fill' }).removeAlpha().raw().toBuffer())],
];

const rows = [];
for (const [name, make] of variants) {
  const vectors = [];
  for (let i = 0; i < pixels.length; i++) vectors.push(Array.from(await make(i)));
  rows.push({ variant: name, ...retrieval(vectors, tags) });
}

let clipNote = 'CLIP was not run (set AI_EMBEDDER=clip and install @huggingface/transformers to include it).';
if (config.ai.embedder === 'clip') {
  try {
    const { clipEmbedder } = await import('../services/ai/embedders/clip.js');
    const vectors = [];
    for (const buffer of buffers) vectors.push(Array.from(await clipEmbedder.embedImage(buffer)));
    rows.push({ variant: `CLIP (${config.ai.clipModel})`, ...retrieval(vectors, tags) });
    clipNote = 'CLIP ran on the same images.';
  } catch (err) {
    clipNote = `CLIP could not be loaded, so it is not in the table: ${err.message}`;
  }
}

// Chance: the share of the other images that carry the same label, averaged.
const perLabel = Object.fromEntries(labels.map((l) => [l, tags.filter((t) => t === l).length]));
const chance = +(tags.reduce((sum, t) => sum + (perLabel[t] - 1) / (tags.length - 1), 0) / tags.length).toFixed(3);

const table = [
  '| features | top-1 | P@5 | mAP |',
  '| --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.variant} | ${r.top1} | ${r.precisionAt5} | ${r.meanAP} |`),
].join('\n');

const md = `# Measured on real references

Generated by \`npm run ai:eval-real\` on ${new Date().toISOString().slice(0, 10)} (${os.cpus()[0]?.model || 'unknown CPU'}, Node ${process.version}).

${tags.length} images in ${labels.length} styles, labelled by hand: ${labels.map((l) => `${l} (${perLabel[l]})`).join(', ')}.${unreadable ? ` ${unreadable} files could not be read and were left out.` : ''}

Each image is a query against all the others; a hit is an image from the same style folder. By chance alone, top-1 and P@5 would be about ${chance}.

${table}

- **top-1**: the single nearest image is from the same style.
- **P@5**: share of the five nearest that are.
- **mAP**: mean average precision over the whole ranking.

${clipNote}

## Reading this

The labels are one person's judgement, and the set is small, so treat differences of a few points as noise. What is worth looking at: whether the full descriptor beats both baselines, which block hurts most when removed, and which styles it confuses (re-run with two of the folders at a time to see).
`;

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docs/ai/RESULTS-REAL.md');
fs.writeFileSync(out, md);
console.log(table);
console.log(`\nChance ≈ ${chance}. Written to ${out}`);
