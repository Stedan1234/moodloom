/**
 * For a generic web page (not an image, not a known video provider), the
 * only preview a captured URL gets today is a bare text card — no visual at
 * all. Real dogfooding surfaced this immediately: capturing a portfolio site
 * like samuella.site as a reference is nearly useless without seeing it.
 *
 * The fix: fetch the page's own social-preview metadata (the same og:image /
 * og:title every modern site already sets for link unfurls on Twitter,
 * iMessage, Slack, etc.) and use that as the thumbnail. This is a real
 * screenshot-quality preview for the vast majority of sites, with zero
 * scraping fragility — we're reading tags the site published for exactly
 * this purpose.
 */

const FETCH_TIMEOUT_MS = 5000;
const MAX_HTML_BYTES = 500_000; // enough for <head>; avoids downloading huge pages just for two meta tags

// SSRF guard: this endpoint now makes an outbound request to a URL the
// CALLER supplies (via the capture request). Without this check, someone
// could get the server to hit its own internal network (a local admin
// panel, a cloud metadata endpoint, another service on localhost) and read
// back whatever it returns as a "thumbnail". Reject anything that isn't a
// plausible public hostname before ever fetching it.
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./, // link-local, includes cloud metadata endpoints (169.254.169.254)
  /^::1$/,
  /^\[?::1\]?$/,
  /\.local$/i,
];

function isPrivateHost(hostname) {
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

function extractMetaContent(html, property) {
  // Matches both attribute orders: <meta property="og:image" content="..."> and
  // <meta content="..." property="og:image">. Case-insensitive, single or double quotes.
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractTitleTag(html) {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : null;
}

/**
 * Fetches a page and pulls og:image / og:title (falling back to <title>).
 * Never throws — a preview is a nice-to-have, not something that should be
 * able to fail a capture. Returns { ogImage: string|null, ogTitle: string|null }.
 */
export async function fetchPagePreview(pageUrl) {
  let parsed;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return { ogImage: null, ogTitle: null };
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || isPrivateHost(parsed.hostname)) {
    return { ogImage: null, ogTitle: null };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(parsed.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Some sites serve a stripped-down (or blocked) response to an
        // unrecognized bot UA — a normal browser UA gets the real page.
        'User-Agent':
          'Mozilla/5.0 (compatible; Moodloom/0.1; +https://github.com/Stedan1234/moodloom)',
      },
    });

    if (!res.ok || !res.body) return { ogImage: null, ogTitle: null };

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return { ogImage: null, ogTitle: null };

    // Read only up to MAX_HTML_BYTES — the og tags are always in <head>, so
    // there's no reason to download an entire large page for this.
    const reader = res.body.getReader();
    let received = 0;
    let html = '';
    const decoder = new TextDecoder();
    while (received < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break; // no need to read further once we have <head>
    }
    reader.cancel().catch(() => {});

    let ogImage = extractMetaContent(html, 'og:image') || extractMetaContent(html, 'twitter:image');
    let ogTitle = extractMetaContent(html, 'og:title') || extractTitleTag(html);

    // og:image is sometimes a relative path — resolve it against the page URL.
    if (ogImage) {
      try {
        ogImage = new URL(ogImage, parsed).toString();
      } catch {
        ogImage = null;
      }
    }

    return { ogImage: ogImage || null, ogTitle: ogTitle || null };
  } catch {
    // Timeout, network error, blocked by the target site, malformed HTML —
    // all treated the same way: no preview, capture still succeeds.
    return { ogImage: null, ogTitle: null };
  } finally {
    clearTimeout(timeout);
  }
}

// Exported for testing the SSRF guard directly, without a real network call.
export { isPrivateHost };
