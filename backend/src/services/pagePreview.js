// For an ordinary web page, read the social-preview tags it already
// publishes for link unfurls (og:image, og:title) and use them as the card's
// thumbnail and title. Goes through safeFetch, so a caller-supplied URL can
// never be used to reach the server's own network.
import { safeFetch } from '../lib/safeFetch.js';

const MAX_HTML_BYTES = 600_000;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'" };

function decodeEntities(text) {
  return text
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
      const key = code.toLowerCase();
      if (ENTITIES[key] !== undefined) return ENTITIES[key];
      if (key.startsWith('#x')) return safeFromCodePoint(parseInt(key.slice(2), 16), whole);
      if (key.startsWith('#')) return safeFromCodePoint(parseInt(key.slice(1), 10), whole);
      return whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function safeFromCodePoint(n, fallback) {
  return Number.isFinite(n) && n > 31 && n <= 0x10ffff ? String.fromCodePoint(n) : fallback;
}

function extractMeta(html, key) {
  // Both attribute orders, property= or name=, single or double quotes.
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*?content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*?(?:property|name)=["']${key}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractTitleTag(html) {
  const match = html.match(/<title[^>]*>([^<]{1,500})<\/title>/i);
  return match ? match[1] : null;
}

/**
 * Never throws. Returns { ogImage, ogTitle } with nulls when nothing usable
 * was found; the capture succeeds either way.
 */
export async function fetchPagePreview(pageUrl) {
  const empty = { ogImage: null, ogTitle: null };
  const res = await safeFetch(pageUrl, {
    maxBytes: MAX_HTML_BYTES,
    accept: 'text/html,application/xhtml+xml',
    // The tags live in <head>; stop reading as soon as it has closed.
    stopWhen: (chunks) => /<\/head>/i.test(chunks[chunks.length - 1].toString('latin1')),
  });
  if (!res || !res.ok || !res.contentType.includes('html')) return empty;

  const html = res.body.toString('utf8');
  let ogImage = extractMeta(html, 'og:image') || extractMeta(html, 'og:image:url') || extractMeta(html, 'twitter:image');
  const rawTitle = extractMeta(html, 'og:title') || extractTitleTag(html);

  if (ogImage) {
    try {
      const resolved = new URL(decodeEntities(ogImage), res.finalUrl);
      ogImage = ['http:', 'https:'].includes(resolved.protocol) ? resolved.toString() : null;
    } catch {
      ogImage = null;
    }
  }
  const ogTitle = rawTitle ? decodeEntities(rawTitle).slice(0, 300) : null;
  return { ogImage: ogImage || null, ogTitle: ogTitle || null };
}
