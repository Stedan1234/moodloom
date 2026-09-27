/**
 * Given a raw captured URL, works out what kind of board item this is and,
 * for video, builds the embed markup — WITHOUT re-hosting the video ourselves
 * (per mvp-scope.md: embed via provider iframe/oEmbed, never re-host).
 *
 * This is intentionally simple for v1: pattern-match on known providers first,
 * fall back to file-extension sniffing for images, and otherwise treat it as a
 * generic link. The two providers explicitly named in the founder's own
 * described pain point (YouTube, Instagram) are handled; anything else still
 * saves fine as a plain link rather than failing.
 */

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|avif|svg)(\?.*)?$/i;

function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function isInstagramUrl(url) {
  return /instagram\.com\/(p|reel|tv)\//.test(url);
}

export function detectMedia(sourceUrl) {
  const youTubeId = extractYouTubeId(sourceUrl);
  if (youTubeId) {
    return {
      mediaType: 'video',
      embedHtml: `<iframe src="https://www.youtube.com/embed/${youTubeId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`,
      thumbnailUrl: `https://img.youtube.com/vi/${youTubeId}/hqdefault.jpg`,
    };
  }

  if (isInstagramUrl(sourceUrl)) {
    // Known v1 limitation (flagged in mvp-scope.md): Instagram's oEmbed endpoint
    // requires an authenticated Meta app review to use in production, which is
    // out of scope for the MVP. We still save the reference as a "video" type
    // with no inline embed yet, rather than failing the capture — it renders
    // as a link-out card with a thumbnail placeholder until that's resolved.
    return {
      mediaType: 'video',
      embedHtml: null,
      thumbnailUrl: null,
    };
  }

  if (IMAGE_EXTENSIONS.test(sourceUrl)) {
    return {
      mediaType: 'image',
      embedHtml: null,
      thumbnailUrl: sourceUrl,
    };
  }

  return {
    mediaType: 'link',
    embedHtml: null,
    thumbnailUrl: null,
  };
}
