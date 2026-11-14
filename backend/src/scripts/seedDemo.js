// Fills an account with a believable demo project, through the public API,
// so it exercises exactly what a real user's browser does.
//
//   npm run demo:seed                       (API on http://localhost:3001)
//   npm run demo:seed -- https://your.host  (somewhere else)
//   DEMO_OFFLINE=1 npm run demo:seed        (skip references that need the internet)
//
// It creates (or logs in to) demo@moodloom.test / moodloom-demo and adds a
// project called "Tide & Timber". Every image is drawn here from SVG, so
// there is nothing to download and nothing that belongs to anyone else.
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BASE = (process.argv[2] || 'http://localhost:3001').replace(/\/+$/, '') + '/api';
const EMAIL = process.env.DEMO_EMAIL || 'demo@moodloom.test';
const PASSWORD = process.env.DEMO_PASSWORD || 'moodloom-demo';
const OFFLINE = Boolean(process.env.DEMO_OFFLINE);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let token = null;
async function call(method, route, body, isForm = false) {
  const res = await fetch(BASE + route, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${route} -> ${res.status} ${data?.error || ''}`);
  return data;
}

// ── drawn references ────────────────────────────────────────────────────
const C = { rust: '#b5532f', sand: '#e9d8b9', cream: '#f6efe1', sea: '#1f4e5a', deep: '#12303a', kelp: '#51693a', sun: '#e9a23b', ink: '#1b1a17', foam: '#cfe0dc' };
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const grain = (w, h, o = 0.18) => `<filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${o} 0"/></filter><rect width="${w}" height="${h}" filter="url(#g)"/>`;
const waves = (w, y0, n, gap, color, sw = 6) =>
  Array.from({ length: n }, (_, i) => {
    const y = y0 + i * gap;
    let d = `M-20 ${y}`;
    for (let x = -20; x < w + 40; x += 60) d += ` q15 -${12 + (i % 3) * 3} 30 0 t30 0`;
    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;
  }).join('');

const ART = [
  {
    file: 'harbour-poster.png', title: 'Harbour festival poster', cat: 0, tags: ['poster', 'serif type', 'warm'],
    note: 'The way the wordmark is cropped by the edge. Confident without shouting.',
    svg: svg(900, 1200, `<rect width="900" height="1200" fill="${C.rust}"/><text x="-30" y="560" font-family="serif" font-size="520" font-weight="700" fill="${C.cream}" letter-spacing="-20">Tide</text><rect x="70" y="700" width="760" height="6" fill="${C.cream}"/><text x="70" y="790" font-family="serif" font-size="58" fill="${C.sand}">small batch, slow roast</text><text x="70" y="1110" font-family="sans-serif" font-size="30" fill="${C.sand}">Harbour Road, open from six</text><circle cx="745" cy="1010" r="78" fill="${C.sun}"/>${grain(900, 1200)}`),
  },
  {
    file: 'sea-horizon.png', title: 'Morning light on the water', cat: 0, tags: ['photography', 'calm'],
    note: 'This blue-green for the dark, not black.',
    svg: svg(1400, 900, `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3d9a8"/><stop offset=".48" stop-color="#e9b98a"/><stop offset=".5" stop-color="${C.sea}"/><stop offset="1" stop-color="${C.deep}"/></linearGradient></defs><rect width="1400" height="900" fill="url(#s)"/><circle cx="980" cy="395" r="70" fill="#fff3d6"/>${waves(1400, 520, 9, 42, 'rgba(255,255,255,.13)', 3)}<path d="M0 455 l260 -70 l150 40 l190 -95 l230 125 H0z" fill="${C.deep}" opacity=".85"/>${grain(1400, 900, 0.22)}`),
  },
  {
    file: 'bag-front.png', title: 'Kraft bag, one-colour print', cat: 0, tags: ['packaging', 'kraft'],
    note: 'One ink on kraft. Cheap to print and it looks deliberate.',
    svg: svg(900, 1100, `<rect width="900" height="1100" fill="${C.foam}"/><path d="M230 170 h440 l30 60 v760 a30 30 0 0 1 -30 30 h-440 a30 30 0 0 1 -30 -30 v-760z" fill="#c9a877"/><path d="M230 170 h440 l30 60 h-500z" fill="#b08f60"/><rect x="290" y="420" width="320" height="380" fill="${C.cream}"/><text x="450" y="540" text-anchor="middle" font-family="serif" font-size="92" font-weight="700" fill="${C.deep}">T&amp;T</text>${waves(900, 590, 3, 26, C.deep, 5).replace(/M-20/g, 'M300').replace(/d="M300 (\d+)[^"]*"/g, (m, y) => `d="M310 ${y} q20 -16 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0"`)}<text x="450" y="740" text-anchor="middle" font-family="sans-serif" font-size="26" fill="${C.deep}">ETHIOPIA  250g</text>${grain(900, 1100, 0.16)}`),
  },
  {
    file: 'wave-pattern.png', title: 'Wave repeat', cat: 3, tags: ['pattern'],
    note: 'Could wrap the cup sleeve.',
    svg: svg(1000, 1000, `<rect width="1000" height="1000" fill="${C.sea}"/>${waves(1000, 40, 24, 42, C.foam, 7)}`),
  },
  {
    file: 'type-specimen.png', title: 'Serif with a soft terminal', cat: 0, tags: ['typography', 'serif type'],
    note: 'Looking for this warmth in the letterforms. Not a slab.',
    svg: svg(1100, 800, `<rect width="1100" height="800" fill="${C.cream}"/><text x="70" y="430" font-family="serif" font-size="430" font-weight="700" fill="${C.ink}">Rg</text><text x="640" y="250" font-family="serif" font-size="64" fill="${C.rust}">Roast</text><text x="640" y="330" font-family="serif" font-size="64" font-style="italic" fill="${C.ink}">Grind</text><text x="640" y="410" font-family="serif" font-size="64" fill="${C.sea}">Pour</text><rect x="70" y="560" width="960" height="3" fill="${C.ink}"/><text x="70" y="640" font-family="sans-serif" font-size="30" fill="${C.ink}">ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789</text>`),
  },
  {
    file: 'awning.png', title: 'Striped awning, shop front', cat: 0, tags: ['storefront', 'stripes'],
    svg: svg(1200, 800, `<rect width="1200" height="800" fill="#d9c9aa"/><rect y="520" width="1200" height="280" fill="${C.deep}"/>${Array.from({ length: 12 }, (_, i) => `<path d="M${i * 100} 160 h100 l-14 190 h-100z" fill="${i % 2 ? C.cream : C.rust}"/>`).join('')}<rect x="120" y="390" width="330" height="330" fill="#f3e6c8"/><rect x="750" y="390" width="330" height="330" fill="#f3e6c8"/><rect x="520" y="390" width="160" height="410" fill="${C.kelp}"/><circle cx="655" cy="600" r="9" fill="${C.sun}"/>${grain(1200, 800, 0.2)}`),
  },
  {
    file: 'cup-overhead.png', title: 'Overhead, cup on timber', cat: 2, tags: ['photography', 'overhead'],
    note: 'The video should open on something this still.',
    svg: svg(1000, 1000, `<rect width="1000" height="1000" fill="#7a5638"/>${Array.from({ length: 9 }, (_, i) => `<rect x="0" y="${i * 115}" width="1000" height="3" fill="rgba(0,0,0,.18)"/>`).join('')}<circle cx="500" cy="500" r="290" fill="${C.cream}"/><circle cx="500" cy="500" r="238" fill="#3b2416"/><path d="M400 520 q100 -150 200 0 q-100 110 -200 0" fill="#d9b48a" opacity=".9"/><rect x="760" y="455" width="150" height="90" rx="45" fill="none" stroke="${C.cream}" stroke-width="40"/>${grain(1000, 1000, 0.25)}`),
  },
  {
    file: 'badge-marks.png', title: 'Round marks, three tries', cat: 3, tags: ['logo', 'badge'],
    svg: svg(1300, 560, `<rect width="1300" height="560" fill="${C.cream}"/>${[[230, C.deep], [650, C.rust], [1070, C.kelp]].map(([x, col], i) => `<circle cx="${x}" cy="280" r="170" fill="none" stroke="${col}" stroke-width="10"/><circle cx="${x}" cy="280" r="140" fill="${i === 1 ? col : 'none'}" stroke="${col}" stroke-width="3"/><text x="${x}" y="318" text-anchor="middle" font-family="serif" font-size="110" font-weight="700" fill="${i === 1 ? C.cream : col}">${['T', 'TT', 'T&amp;T'][i]}</text>`).join('')}`),
  },
  {
    file: 'menu-board.png', title: 'Menu board, hand-set', cat: 1, tags: ['layout', 'signage'],
    svg: svg(900, 1200, `<rect width="900" height="1200" fill="${C.deep}"/><text x="80" y="170" font-family="serif" font-size="96" fill="${C.cream}">Today</text><rect x="80" y="210" width="740" height="4" fill="${C.sun}"/>${['Filter', 'Flat white', 'Cortado', 'Cold brew', 'Oat anything', 'Cardamom bun', 'Toast, salted butter'].map((t, i) => `<text x="80" y="${330 + i * 108}" font-family="serif" font-size="56" fill="${C.cream}">${t}</text><text x="820" y="${330 + i * 108}" text-anchor="end" font-family="sans-serif" font-size="44" fill="${C.sand}">${['3', '3.6', '3.4', '4', '+.5', '3.2', '2.8'][i]}</text>`).join('')}${grain(900, 1200, 0.2)}`),
  },
  {
    file: 'night-window.png', title: 'One window lit', cat: 2, tags: ['photography', 'night'],
    note: 'Closing shot. Warm inside, blue outside.',
    svg: svg(1400, 800, `<defs><linearGradient id="n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d1b2a"/><stop offset="1" stop-color="#1c3550"/></linearGradient></defs><rect width="1400" height="800" fill="url(#n)"/><rect x="180" y="250" width="1040" height="550" fill="#0b1520"/><rect x="560" y="390" width="250" height="300" fill="#f2b65a"/><rect x="680" y="390" width="8" height="300" fill="#0b1520"/><rect x="560" y="535" width="250" height="8" fill="#0b1520"/><ellipse cx="685" cy="760" rx="330" ry="46" fill="#f2b65a" opacity=".18"/>${grain(1400, 800, 0.3)}`),
  },
  {
    file: 'colour-chips.png', title: 'Paint chips from the harbour wall', cat: 3, tags: ['palette'],
    svg: svg(1200, 500, `<rect width="1200" height="500" fill="#f2f0ea"/>${[C.deep, C.sea, C.kelp, C.sun, C.rust, C.sand].map((col, i) => `<rect x="${50 + i * 186}" y="60" width="170" height="380" fill="${col}"/><rect x="${50 + i * 186}" y="360" width="170" height="80" fill="#fff"/>`).join('')}`),
  },
  {
    file: 'label-sheet.png', title: 'Label sheet, three origins', cat: 1, tags: ['packaging', 'label'],
    svg: svg(1300, 760, `<rect width="1300" height="760" fill="#ddd6c8"/>${[[C.rust, 'KENYA'], [C.sea, 'PERU'], [C.kelp, 'SUMATRA']].map(([col, name], i) => `<rect x="${70 + i * 400}" y="90" width="360" height="580" fill="${C.cream}"/><rect x="${70 + i * 400}" y="90" width="360" height="150" fill="${col}"/><text x="${250 + i * 400}" y="190" text-anchor="middle" font-family="serif" font-size="60" font-weight="700" fill="${C.cream}">T&amp;T</text><text x="${250 + i * 400}" y="380" text-anchor="middle" font-family="sans-serif" font-size="46" fill="${C.ink}" letter-spacing="6">${name}</text><rect x="${130 + i * 400}" y="430" width="240" height="3" fill="${col}"/><text x="${250 + i * 400}" y="520" text-anchor="middle" font-family="serif" font-size="30" font-style="italic" fill="${C.ink}">washed, 1900m</text>`).join('')}`),
  },
  {
    file: 'tote.png', title: 'Tote, big mark', cat: 1, tags: ['merch'],
    svg: svg(900, 1050, `<rect width="900" height="1050" fill="${C.sun}"/><path d="M300 330 q0 -230 150 -230 q150 0 150 230" fill="none" stroke="#efe6d3" stroke-width="30"/><rect x="170" y="320" width="560" height="620" fill="#efe6d3"/><text x="450" y="700" text-anchor="middle" font-family="serif" font-size="300" font-weight="700" fill="${C.deep}">T</text>${waves(900, 770, 2, 30, C.deep, 6)}${grain(900, 1050, 0.15)}`),
  },
  {
    file: 'kelp-illustration.png', title: 'Kelp, cut paper', cat: 3, tags: ['illustration', 'organic'],
    svg: svg(800, 1100, `<rect width="800" height="1100" fill="${C.foam}"/>${[[200, C.kelp, 1], [400, C.sea, -1], [600, C.kelp, 1]].map(([x, col, dir]) => `<path d="M${x} 1100 C ${x + 120 * dir} 850, ${x - 120 * dir} 620, ${x + 60 * dir} 380 S ${x - 80 * dir} 120, ${x} 40" fill="none" stroke="${col}" stroke-width="46" stroke-linecap="round"/>${Array.from({ length: 6 }, (_, i) => `<ellipse cx="${x + (i % 2 ? 70 : -70) * dir}" cy="${930 - i * 150}" rx="62" ry="26" fill="${col}" transform="rotate(${i % 2 ? 30 : -30} ${x + (i % 2 ? 70 : -70) * dir} ${930 - i * 150})"/>`).join('')}`).join('')}`),
  },
];

// A two-page PDF built by hand (no dependency): a pretend client brief with
// selectable text, for trying "pin this passage".
function makePdf() {
  const pages = [
    ['Tide & Timber: notes from the first call', '', 'We roast in a converted net loft on Harbour Road. People walk past', 'on the way to the ferry and most of them do not know we are here.', '', 'We want the place to feel like the harbour at six in the morning:', 'quiet, a bit salty, warm when you step inside.', '', 'We do not want to look like every other speciality coffee brand.', 'No black and white minimalism. No hand-drawn chalk lettering.'],
    ['What we need', '', 'A name mark we can stamp on a kraft bag in one colour.', 'Labels for three origins that feel like a family.', 'A sign for above the door that reads from the ferry queue.', '', 'Budget is small. Anything that needs four inks is out.', 'We open on the first Saturday in March.'],
  ];
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageIds = [];
  const pagesId = objects.length + pages.length * 2 + 1;
  for (const lines of pages) {
    const esc = (t) => t.replace(/[\\()]/g, (ch) => `\\${ch}`);
    let stream = 'BT\n';
    lines.forEach((line, i) => {
      stream += `/${i === 0 ? 'F2' : 'F1'} ${i === 0 ? 22 : 13} Tf\n1 0 0 1 72 ${720 - i * (i === 0 ? 0 : 24) - (i > 0 ? 14 : 0)} Tm\n(${esc(line)}) Tj\n`;
    });
    stream += 'ET';
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> >>`));
  }
  add(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function upload(projectId, buffer, name, type, fields = {}) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type }), name);
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) form.append(k, String(v));
  return call('POST', `/projects/${projectId}/items/upload`, form, true);
}

async function main() {
  // account: log in if it exists, otherwise make one and claim it
  try {
    token = (await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD })).token;
  } catch {
    token = (await call('POST', '/auth/anonymous')).token;
    await call('POST', '/auth/claim', { email: EMAIL, password: PASSWORD });
    await call('PATCH', '/account', { displayName: 'Demo Designer' });
  }

  const project = await call('POST', '/projects', { name: 'Tide & Timber' });
  const pid = project.id;
  const cats = await call('GET', `/projects/${pid}/categories`);
  // Starter threads: Design Inspiration, Post & Content Ideas, Video Direction, Color & Brand
  await call('PATCH', `/projects/${pid}/categories/${cats[1].id}`, { name: 'Packaging & Print' });

  await call('PATCH', `/projects/${pid}`, {
    stage: 'concepts',
    brief: {
      client: 'Tide & Timber, a harbour-side coffee roaster',
      summary: 'A name mark, a label family for three origins, and a sign for above the door, ahead of opening in March.',
      audience: 'Ferry commuters who walk past twice a day, and locals who already buy good coffee somewhere else.',
      goals: 'Be noticed from the ferry queue. Feel like the harbour at six in the morning: quiet, a bit salty, warm inside.',
      deliverables: 'One-colour mark for kraft bags. Three origin labels. Door sign. A short opening film for social.',
      constraints: 'Small budget. Nothing that needs four inks. Has to work stamped by hand.',
      tone: 'Quiet, warm, unhurried. Not minimal black-and-white, not chalkboard lettering.',
      deadline: '2027-03-06',
      keywords: ['quiet', 'salt', 'warm inside', 'one ink', 'hand-stamped'],
    },
  });

  const ids = {};
  for (const art of ART) {
    const png = await sharp(Buffer.from(art.svg)).png().toBuffer();
    const item = await upload(pid, png, art.file, 'image/png', { title: art.title, note: art.note, categoryId: art.cat === null ? undefined : cats[art.cat].id });
    if (art.tags) await call('PATCH', `/projects/${pid}/items/${item.id}`, { tags: art.tags });
    ids[art.file] = item.id;
    process.stdout.write('.');
  }

  const pdf = await upload(pid, makePdf(), 'tide-and-timber-first-call.pdf', 'application/pdf', { title: 'Notes from the first call' });
  await call('POST', `/projects/${pid}/items/quote`, { text: 'We want the place to feel like the harbour at six in the morning: quiet, a bit salty, warm when you step inside.', fromItemId: pdf.id, page: 1, tags: ['brief'] });
  await call('POST', `/projects/${pid}/items/quote`, { text: 'Anything that needs four inks is out.', fromItemId: pdf.id, page: 2, categoryId: cats[1].id, tags: ['constraint'] });

  // A font file, if the web app's dependencies are installed alongside.
  const fontDir = path.resolve(__dirname, '../../../frontend/node_modules/@fontsource-variable/bricolage-grotesque/files');
  const fontFile = fs.existsSync(fontDir) && fs.readdirSync(fontDir).find((f) => /latin-wght-normal\.woff2$/.test(f));
  let fontId = null;
  if (fontFile) fontId = (await upload(pid, fs.readFileSync(path.join(fontDir, fontFile)), 'BricolageGrotesque-Variable.woff2', 'font/woff2', { title: 'Bricolage Grotesque (for signage)', categoryId: cats[0].id })).id;

  if (!OFFLINE) {
    await call('POST', `/projects/${pid}/items`, { sourceUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', title: 'Pacing reference: slow, wide, no cuts', categoryId: cats[2].id, tags: ['film', 'pacing'] }).catch(() => {});
    await call('POST', `/projects/${pid}/items`, { sourceUrl: 'https://en.wikipedia.org/wiki/Letterpress_printing', note: 'For the hand-stamped feel.', categoryId: cats[1].id }).catch(() => {});
  }

  await call('PUT', `/projects/${pid}/workspace`, {
    content:
      '<h1>Where this is going</h1><p>They keep saying <mark>six in the morning</mark>. The harbour, not the coffee. Start from the place.</p><h2>What I keep coming back to</h2><ul><li><p>Deep sea green instead of black</p></li><li><p>One warm colour doing all the work (the rust, or the sun yellow, not both)</p></li><li><p>A serif with soft terminals, stamped slightly off-register</p></li></ul><h2>To check with them</h2><ol><li><p>Is the wave too literal?</p></li><li><p>Can the door sign be painted rather than printed?</p></li></ol><blockquote><p>“We do not want to look like every other speciality coffee brand.”</p></blockquote>',
  });

  await call('PUT', `/projects/${pid}/brand`, {
    data: {
      name: 'Tide & Timber',
      tagline: 'Small batch, slow roast, Harbour Road.',
      story: 'A roastery in a converted net loft on the harbour. The coffee is careful; the place is unhurried. People find it on the way to the ferry and come back on purpose.',
      audience: 'Commuters with five minutes, locals with an hour.',
      values: [
        { name: 'Unhurried', description: 'Nothing is rushed, including the customer.' },
        { name: 'Plain', description: 'Say what it is. Kraft, one ink, the origin and the weight.' },
        { name: 'Of the harbour', description: 'Colours and shapes come from the water and the boats, not from coffee clichés.' },
      ],
      voice: {
        summary: 'Speaks like someone who has been up since five and is glad you came in.',
        traits: [{ name: 'Short', description: 'Few words. No exclamation marks.' }, { name: 'Warm', description: 'Dry humour is fine. Cleverness is not the point.' }],
        weSay: ['Open from six.', 'Ask what’s on filter.'],
        weDontSay: ['Artisanal', 'Elevate your morning ritual'],
      },
      logos: [
        { itemId: ids['badge-marks.png'], label: 'Round marks, working', usage: 'Three candidates. The middle one stamps best.', background: '#f6efe1' },
        { itemId: ids['tote.png'], label: 'Large mark', usage: 'Only when it can be at least a hand wide.' },
      ],
      logoRules: { clearSpace: 'The width of the T on every side.', minSize: '14mm stamped, 28px on screen.', donts: ['Outline it', 'Set it on a photograph', 'Use more than one colour'] },
      colors: [
        { hex: '#12303a', name: 'Deep water', role: 'primary', meaning: 'The harbour before sunrise.', usage: 'Type, the mark, large fields. Used instead of black.' },
        { hex: '#b5532f', name: 'Hull rust', role: 'accent', meaning: 'Paint on the working boats.', usage: 'One thing per layout: a label band, a price, a button.' },
        { hex: '#f6efe1', name: 'Sailcloth', role: 'neutral', meaning: 'Warm and unbleached.', usage: 'Backgrounds and labels.' },
        { hex: '#e9a23b', name: 'First light', role: 'secondary', usage: 'Sparingly, and never next to the rust.' },
      ],
      typography: [
        { role: 'display', family: 'A soft-terminal serif', weights: 'Bold', usage: 'The mark and headlines. Set large, tracked tight.', sample: 'Open from six' },
        ...(fontId ? [{ role: 'accent', family: 'Bricolage Grotesque', itemId: fontId, weights: 'Variable', usage: 'Signage and prices only.', sample: 'Filter 3 / Flat white 3.6' }] : []),
      ],
      imagery: { description: 'Still, wide, early. Natural light. Hands and objects more than faces.', itemIds: [ids['sea-horizon.png'], ids['cup-overhead.png'], ids['night-window.png']], avoid: 'Latte art close-ups. Anything with a filter on it.' },
      patterns: { description: 'A single hand-drawn wave line, repeated. Runs at one size only.', itemIds: [ids['wave-pattern.png'], ids['kelp-illustration.png']] },
      rules: [
        { kind: 'do', text: 'Leave kraft showing. The material is part of the brand.' },
        { kind: 'do', text: 'Use deep water where you would reach for black.' },
        { kind: 'dont', text: 'Put rust and first light side by side.' },
        { kind: 'dont', text: 'Add a second typeface for body text on packaging.' },
      ],
    },
  });

  // A second, smaller project so the home screen isn't a single card.
  const second = await call('POST', '/projects', { name: 'Stedan. site rebrand' });
  for (const art of [ART[4], ART[10], ART[7]]) {
    await upload(second.id, await sharp(Buffer.from(art.svg)).modulate({ hue: 200 }).png().toBuffer(), art.file, 'image/png', { title: art.title });
  }

  console.log(`\nDone. Log in as ${EMAIL} / ${PASSWORD}`);
  console.log(JSON.stringify({ projectId: pid, secondProjectId: second.id, pdfId: pdf.id, fontId, ids }));
}

main().catch((err) => {
  console.error(`\nSeeding failed: ${err.message}`);
  process.exit(1);
});
