// Works out what kind of board item a captured URL is. Video is embedded
// through the provider's own player (never re-hosted); the client builds the
// player from {provider, videoId}, so no HTML is stored or injected.

const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|avif|svg)$/i;
const VIDEO_FILE_EXTENSIONS = /\.(mp4|webm)$/i;

export function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?(?:[^#]*&)?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/(?:shorts|embed|live)\/)([\w-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractVimeoId(url) {
  const match = url.match(/vimeo\.com\/(?:video\/|channels\/[\w-]+\/|groups\/[\w-]+\/videos\/)?(\d{6,12})(?:[/?#]|$)/);
  return match ? match[1] : null;
}

/**
 * @returns {{mediaType: 'image'|'video'|'link', thumbnailUrl: string|null, meta: object, wantsPreview: boolean}}
 * wantsPreview: fetch the page's og:image/title to fill in a thumbnail or title.
 */
export function detectMedia(sourceUrl) {
  let pathname = '';
  try {
    pathname = new URL(sourceUrl).pathname;
  } catch {
    /* not parseable: treated as a plain link below */
  }

  const youTubeId = extractYouTubeId(sourceUrl);
  if (youTubeId) {
    return {
      mediaType: 'video',
      thumbnailUrl: `https://img.youtube.com/vi/${youTubeId}/hqdefault.jpg`,
      meta: { provider: 'youtube', videoId: youTubeId },
      wantsPreview: false,
    };
  }

  const vimeoId = extractVimeoId(sourceUrl);
  if (vimeoId) {
    return { mediaType: 'video', thumbnailUrl: null, meta: { provider: 'vimeo', videoId: vimeoId }, wantsPreview: true };
  }

  if (/instagram\.com\/(p|reel|reels|tv)\//.test(sourceUrl)) {
    // Instagram only allows embeds through an approved Meta app, so these
    // stay a click-through card. Its pages rarely expose a preview image to
    // a server either, but it costs nothing to try.
    return { mediaType: 'video', thumbnailUrl: null, meta: { provider: 'instagram' }, wantsPreview: true };
  }

  if (IMAGE_EXTENSIONS.test(pathname)) {
    return { mediaType: 'image', thumbnailUrl: sourceUrl, meta: {}, wantsPreview: false };
  }

  if (VIDEO_FILE_EXTENSIONS.test(pathname)) {
    return { mediaType: 'video', thumbnailUrl: null, meta: { provider: 'file' }, wantsPreview: false };
  }

  return { mediaType: 'link', thumbnailUrl: null, meta: {}, wantsPreview: true };
}

// For rows captured before meta existed: derive the player info on the fly.
export function videoMetaFor(sourceUrl) {
  const detected = detectMedia(sourceUrl);
  return detected.mediaType === 'video' ? detected.meta : {};
}
