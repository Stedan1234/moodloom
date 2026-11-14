import { config } from '../../../config.js';
import { classicEmbedder } from './classic.js';
import { clipEmbedder } from './clip.js';

let warned = false;
let clipUnavailable = false;

// Returns the embedder in use, or null when embeddings are switched off.
// If CLIP is selected but can't load (package missing, model download
// failed), fall back to the classic features so similarity keeps working,
// and say so once in the log.
export function getEmbedder() {
  if (config.ai.embedder === 'off') return null;
  if (config.ai.embedder === 'clip' && !clipUnavailable) return clipEmbedder;
  return classicEmbedder;
}

export async function embedImage(buffer) {
  const embedder = getEmbedder();
  if (!embedder) return null;
  try {
    return { model: embedder.name, vector: await embedder.embedImage(buffer), embedder };
  } catch (err) {
    if (embedder !== clipEmbedder) throw err;
    clipUnavailable = true;
    if (!warned) {
      warned = true;
      console.error(`CLIP embedder unavailable, using classic features instead: ${err.message}`);
    }
    return { model: classicEmbedder.name, vector: await classicEmbedder.embedImage(buffer), embedder: classicEmbedder };
  }
}

export function embedderStatus() {
  const embedder = getEmbedder();
  return {
    configured: config.ai.embedder,
    active: embedder ? embedder.name : null,
    semantic: Boolean(embedder?.semantic),
    fellBack: clipUnavailable,
  };
}
