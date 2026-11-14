// Colour maths used by palette extraction, the classic image features and
// the evaluation scripts. Everything perceptual is done in CIELAB (D65):
// equal distances there are far closer to "looks equally different" than
// equal distances in RGB, which is the whole reason to cluster in it.

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(v) {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;

function f(t) {
  return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
}
function fInv(t) {
  const t3 = t ** 3;
  return t3 > EPS ? t3 : (116 * t - 16) / KAPPA;
}

export function rgbToLab(r, g, b) {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175;
  const z = lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041;
  const fx = f(x / XN);
  const fy = f(y / YN);
  const fz = f(z / ZN);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb(L, a, b) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const x = XN * fInv(fx);
  const y = YN * fInv(fy);
  const z = ZN * fInv(fz);
  const lr = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  const lg = x * -0.969266 + y * 1.8760108 + z * 0.041556;
  const lb = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
  return [linearToSrgb(lr), linearToSrgb(lg), linearToSrgb(lb)];
}

export function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hexToLab(hex) {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToLab(...rgb) : null;
}

export function deltaE76(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// CIEDE2000, the current standard colour-difference formula. Roughly: under
// 1 is invisible, 2 to 3 is noticeable side by side, over 10 is a different
// colour. Implemented from Sharma, Wu & Dalal (2005) and checked against
// their published test pairs in test/color.test.js.
export function deltaE2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h = (x, y) => {
    if (x === 0 && y === 0) return 0;
    const deg = Math.atan2(y, x) / rad;
    return deg >= 0 ? deg : deg + 360;
  };
  const h1p = h(a1p, b1);
  const h2p = h(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
    else hbarp = (h1p + h2p - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * rad) +
    0.24 * Math.cos(2 * hbarp * rad) +
    0.32 * Math.cos((3 * hbarp + 6) * rad) -
    0.2 * Math.cos((4 * hbarp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh)
  );
}

// Hue boundaries in CIELAB hue angle (degrees). Calibrated against familiar
// reference colours: pure red sits near 40, orange near 60, yellow near
// 103, green near 136, teal near 196, blue from about 270 to 306, purple and
// magenta near 328, rose near 0.
const HUES = [
  [15, 'rose'],
  [47, 'red'],
  [72, 'orange'],
  [95, 'amber'],
  [115, 'yellow'],
  [131, 'lime'],
  [175, 'green'],
  [215, 'teal'],
  [309, 'blue'],
  [322, 'violet'],
  [345, 'purple'],
  [360, 'rose'],
];

// A plain-language name for a colour ("deep teal", "pale amber", "warm
// grey"), built from its lightness, chroma and hue. Rule-based on purpose:
// it is predictable, needs no lookup table, and never produces a name like
// "darkolivegreen3" that nobody says out loud.
export function describeColor(lab) {
  const [L, a, b] = lab;
  const chroma = Math.hypot(a, b);
  let hue = (Math.atan2(b, a) * 180) / Math.PI;
  if (hue < 0) hue += 360;

  if (chroma < 9) {
    if (L > 97) return 'white';
    if (L > 86) return 'off-white';
    if (L < 8) return 'black';
    if (L < 22) return 'near black';
    const temp = b > 3 ? 'warm ' : b < -3 ? 'cool ' : '';
    return `${temp}${L > 62 ? 'light grey' : L < 42 ? 'dark grey' : 'grey'}`;
  }

  const base = HUES.find(([limit]) => hue < limit)[1];
  const earthy = base === 'orange' || base === 'amber' || (base === 'red' && hue > 30);

  // Names that already say how light or strong the colour is; no modifier.
  if (earthy && L < 50 && chroma < 50) return L < 28 ? 'dark brown' : 'brown';
  if ((base === 'orange' || base === 'amber' || base === 'yellow') && L > 70 && chroma < 30) return L > 84 ? 'cream' : 'beige';
  if (base === 'yellow' && L < 62) return 'olive';
  if (base === 'blue' && L < 30) return 'navy';
  if (base === 'green' && L < 35) return 'forest green';
  if ((base === 'red' || base === 'rose') && L > 68) return L > 84 ? 'pale pink' : 'pink';
  if (base === 'purple' && chroma > 90 && L > 50) return 'magenta';
  if (base === 'teal' && L > 78 && chroma > 35) return 'cyan';

  let modifier = '';
  if (chroma > 70) modifier = L < 26 ? 'deep' : 'vivid';
  else if (L > 82) modifier = 'pale';
  else if (L < 26) modifier = 'deep';
  else if (chroma < 22) modifier = 'muted';
  else if (L > 70) modifier = 'light';
  else if (L < 38) modifier = 'dark';
  return modifier ? `${modifier} ${base}` : base;
}

// A handful of words describing a whole palette ("dark", "warm", "muted"…),
// from the share-weighted averages of its colours. These become the
// automatic colour-character tags on an item.
export function paletteTraits(palette) {
  if (!palette?.length) return [];
  let L = 0;
  let chroma = 0;
  let warmth = 0;
  let total = 0;
  for (const swatch of palette) {
    const lab = hexToLab(swatch.hex);
    if (!lab) continue;
    const w = swatch.pct ?? 1;
    const c = Math.hypot(lab[1], lab[2]);
    L += lab[0] * w;
    chroma += c * w;
    // Warm colours sit toward +a (red) and +b (yellow); cool toward -b (blue).
    warmth += (lab[1] * 0.5 + lab[2]) * w;
    total += w;
  }
  if (total === 0) return [];
  L /= total;
  chroma /= total;
  warmth /= total;

  const traits = [];
  if (L < 35) traits.push('dark');
  else if (L > 78) traits.push('light');
  if (chroma < 8) traits.push('monochrome');
  else if (chroma < 22) traits.push('muted');
  else if (chroma > 48) traits.push('vivid');
  if (chroma >= 8) {
    if (warmth > 10) traits.push('warm');
    else if (warmth < -8) traits.push('cool');
  }
  return traits;
}
