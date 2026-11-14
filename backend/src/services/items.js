// The background work done for every new board item: measure it, make a
// thumbnail, pull its palette, compute its feature vector. Queued after the
// capture response has gone out (lib/jobs.js), so adding a reference stays
// instant.
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { enqueue } from '../lib/jobs.js';
import { safeFetch } from '../lib/safeFetch.js';
import * as storage from '../lib/storage.js';
import { analyzeImage, makeThumbnail } from './analysis.js';
import { embedImage, getEmbedder } from './ai/embedders/index.js';
import { saveVector } from './ai/store.js';

async function loadImageBytes(item) {
  if (item.storage_key) {
    // SVGs are served but never decoded on the server; other kinds of upload
    // (video, PDF, fonts, source files) have no pixels to analyse here.
    if (item.media_type !== 'image' || item.mime_type === 'image/svg+xml') return null;
    return storage.read(item.storage_key);
  }
  if (!item.thumbnail_url) return null;
  const res = await safeFetch(item.thumbnail_url, { maxBytes: config.limits.remoteImageBytes, accept: 'image/*' });
  if (!res?.ok || !res.contentType.startsWith('image/') || res.contentType.includes('svg')) return null;
  return res.body;
}

export async function processItem(itemId) {
  const found = await pool.query(
    'SELECT id, media_type, mime_type, storage_key, thumb_key, thumbnail_url, meta, tags FROM board_items WHERE id = $1',
    [itemId]
  );
  const item = found.rows[0];
  if (!item) return; // deleted before its turn came

  let update = { width: null, height: null, palette: null, meta: item.meta || {}, thumbKey: item.thumb_key };
  try {
    const bytes = await loadImageBytes(item);
    if (bytes) {
      const analysis = await analyzeImage(bytes);
      update.width = analysis.width;
      update.height = analysis.height;
      update.palette = analysis.palette;
      update.meta = { ...update.meta, traits: analysis.traits };

      if (item.storage_key && !item.thumb_key) {
        const thumb = await makeThumbnail(bytes);
        if (thumb) {
          update.thumbKey = storage.newKey('webp', { thumbOf: item.storage_key });
          await storage.save(update.thumbKey, thumb);
        }
      }

      const embedded = await embedImage(bytes);
      if (embedded) {
        await saveVector(item.id, embedded.model, embedded.vector);
        if (embedded.embedder.suggestTags) {
          const suggested = await embedded.embedder.suggestTags(embedded.vector).catch(() => []);
          if (suggested.length) update.meta = { ...update.meta, suggestedTags: suggested };
        }
      }
    }
  } catch (err) {
    // A reference that can't be analysed (corrupt image, unsupported
    // encoding) is still a perfectly good reference. Record that it was
    // looked at so it isn't retried forever.
    console.error(`Could not analyse item ${itemId}: ${err.message}`);
  }

  await pool.query(
    `UPDATE board_items SET
       width = COALESCE($2, width), height = COALESCE($3, height),
       palette = COALESCE($4::jsonb, palette), meta = $5::jsonb, thumb_key = $6, analyzed_at = now()
     WHERE id = $1`,
    [item.id, update.width, update.height, update.palette ? JSON.stringify(update.palette) : null, JSON.stringify(update.meta), update.thumbKey]
  );
}

export function queueItem(itemId) {
  enqueue(`analyse item ${itemId}`, () => processItem(itemId));
}

// At startup: pick up anything that was never analysed (captured before
// this feature existed, or queued when the process last stopped), and
// anything whose vector came from a different embedder than the one now in
// use. Capped per start so a big backlog is worked off gradually.
export async function queueBacklog({ limit = 300 } = {}) {
  const embedder = getEmbedder();
  const pending = await pool.query(
    `SELECT i.id FROM board_items i
     LEFT JOIN item_embeddings e ON e.item_id = i.id
     WHERE i.analyzed_at IS NULL
        OR ($1::text IS NOT NULL AND i.palette IS NOT NULL AND (e.item_id IS NULL OR e.model <> $1))
     ORDER BY i.id DESC LIMIT $2`,
    [embedder ? embedder.name : null, limit]
  );
  for (const row of pending.rows) queueItem(row.id);
  return pending.rows.length;
}
