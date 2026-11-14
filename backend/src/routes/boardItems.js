import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { projectAccess, touchProject } from '../middleware/project.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { HttpError } from '../lib/errors.js';
import { parse, z, idParam, text } from '../lib/validate.js';
import * as storage from '../lib/storage.js';
import { detectMedia } from '../services/mediaDetector.js';
import { fetchPagePreview } from '../services/pagePreview.js';
import { classifyUpload, cleanFileName, maxUploadBytes } from '../services/files.js';
import { imageSize } from '../services/analysis.js';
import { ITEM_COLUMNS, serializeItem } from '../services/serialize.js';
import { queueItem } from '../services/items.js';
import { enqueue } from '../lib/jobs.js';
import { assertCanStore } from '../services/plans.js';
import { loadProjectVectors } from '../services/ai/store.js';
import { nearest } from '../services/ai/similarity.js';

// mergeParams: mounted at /projects/:projectId/items
export const boardItemsRouter = Router({ mergeParams: true });
boardItemsRouter.use(requireAuth);

// Uploads land in a hidden temp folder first (express.static never serves
// dotfiles), under a random name, and only move into place once the bytes
// have been identified and accepted.
const TEMP_DIR = path.join(config.uploadsDir, '.incoming');
fs.mkdirSync(TEMP_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: TEMP_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: maxUploadBytes, files: 1, fields: 10, fieldSize: 20_000 },
});

function receiveFile(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new HttpError(413, `That file is too large (${Math.round(maxUploadBytes / 1048576)}MB max).`, 'FILE_TOO_LARGE'));
      }
      return next(new HttpError(400, 'That upload could not be read.', 'BAD_UPLOAD'));
    }
    next(err);
  });
}

const tagsSchema = z
  .array(z.string().trim().toLowerCase().min(1).max(40))
  .max(20, 'Up to 20 tags per reference')
  .transform((tags) => [...new Set(tags)]);

// A client-supplied category id is only trusted once it's confirmed to
// belong to THIS project.
async function resolveCategoryId(projectId, categoryId) {
  if (categoryId === undefined || categoryId === null || categoryId === '') return null;
  const id = idParam(String(categoryId));
  if (!id) throw new HttpError(400, 'Invalid category', 'BAD_CATEGORY');
  const check = await pool.query('SELECT id FROM categories WHERE id = $1 AND project_id = $2', [id, projectId]);
  if (check.rows.length === 0) throw new HttpError(400, 'Invalid category', 'BAD_CATEGORY');
  return id;
}

async function nextPosition(projectId) {
  const result = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next, COUNT(*)::int AS n FROM board_items WHERE project_id = $1',
    [projectId]
  );
  if (result.rows[0].n >= config.limits.itemsPerProject) {
    throw new HttpError(400, `A board holds up to ${config.limits.itemsPerProject} references. Split this project to add more.`, 'BOARD_FULL');
  }
  return result.rows[0].next;
}

// GET /projects/:projectId/items — the board, in position order.
boardItemsRouter.get('/', projectAccess('viewer'), async (req, res) => {
  const result = await pool.query(
    `SELECT ${ITEM_COLUMNS} FROM board_items WHERE project_id = $1 ORDER BY position ASC, id ASC`,
    [req.project.id]
  );
  res.json(result.rows.map(serializeItem));
});

/**
 * POST /projects/:projectId/items — capture a URL. THE core-loop endpoint:
 * what the extension calls the moment someone clicks "Add to Moodloom".
 * Body: { sourceUrl, title?, categoryId?, note?, tags?, pageUrl? }
 * pageUrl is where an image was found, when sourceUrl is the image itself.
 */
boardItemsRouter.post('/', projectAccess('editor'), async (req, res) => {
  const body = parse(
    z.object({
      sourceUrl: z.string({ error: 'sourceUrl is required' }).trim().min(1, 'sourceUrl is required').max(4000, 'That URL is too long'),
      title: text(300).optional().nullable(),
      note: text(5000).optional().nullable(),
      tags: tagsSchema.optional(),
      categoryId: z.union([z.number(), z.string(), z.null()]).optional(),
      pageUrl: z.string().trim().max(4000).optional().nullable(),
    }),
    req.body
  );

  let parsedUrl;
  try {
    parsedUrl = new URL(body.sourceUrl);
  } catch {
    throw new HttpError(400, 'sourceUrl must be a valid URL', 'BAD_URL');
  }
  // Only web addresses. A javascript: or data: URL stored here would later
  // be rendered as a clickable link.
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new HttpError(400, 'Only http and https links can be added', 'BAD_URL');
  }
  const normalizedUrl = parsedUrl.toString();
  const categoryId = await resolveCategoryId(req.project.id, body.categoryId);

  // Duplicate-capture guard: return the item that's already there instead of
  // a second copy (a double click, a retry on a slow connection).
  const existing = await pool.query(
    `SELECT ${ITEM_COLUMNS} FROM board_items WHERE project_id = $1 AND source_url = $2 LIMIT 1`,
    [req.project.id, normalizedUrl]
  );
  if (existing.rows.length > 0) {
    return res.status(200).json({ ...serializeItem(existing.rows[0]), alreadyOnBoard: true });
  }

  const detected = detectMedia(normalizedUrl);
  let thumbnailUrl = detected.thumbnailUrl;
  let title = body.title || null;
  const meta = { ...detected.meta };

  if (body.pageUrl) {
    try {
      const found = new URL(body.pageUrl);
      if (['http:', 'https:'].includes(found.protocol)) meta.foundOn = found.toString();
    } catch {
      /* not a URL: leave it out */
    }
  }

  // Best effort: the page's own preview image and title. If the site blocks
  // it or has none, the capture still succeeds without them.
  if (detected.wantsPreview) {
    const preview = await fetchPagePreview(normalizedUrl);
    if (!thumbnailUrl && preview.ogImage) thumbnailUrl = preview.ogImage;
    if (!title && preview.ogTitle) title = preview.ogTitle;
  }

  const position = await nextPosition(req.project.id);
  let inserted;
  try {
    inserted = await pool.query(
      `INSERT INTO board_items (project_id, source_url, media_type, title, note, tags, thumbnail_url, meta, position, category_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${ITEM_COLUMNS}`,
      [req.project.id, normalizedUrl, detected.mediaType, title, body.note || null, body.tags || [], thumbnailUrl, JSON.stringify(meta), position, categoryId, req.userId]
    );
  } catch (err) {
    // 23505 = unique_violation: two near-simultaneous captures of the same
    // URL raced past the check above. Same graceful answer, not a 500.
    if (err.code === '23505') {
      const winner = await pool.query(`SELECT ${ITEM_COLUMNS} FROM board_items WHERE project_id = $1 AND source_url = $2`, [
        req.project.id,
        normalizedUrl,
      ]);
      return res.status(200).json({ ...serializeItem(winner.rows[0]), alreadyOnBoard: true });
    }
    throw err;
  }

  await touchProject(req.project.id);
  queueItem(inserted.rows[0].id);
  res.status(201).json(serializeItem(inserted.rows[0]));
});

/**
 * POST /projects/:projectId/items/import — bring in many links at once
 * (a browser bookmarks export, a pasted list). Body:
 *   { links: [{ url, title? }], categoryId?, tag? }   up to 300 links
 * Rows are created straight away with no preview; each link's title and
 * preview image are then fetched in the background, one at a time, through
 * the same guarded fetch as a single capture. Links already on the board,
 * repeats within the list, and anything that isn't http(s) are skipped and
 * counted, never an error: one bad line shouldn't sink an import.
 */
boardItemsRouter.post('/import', projectAccess('editor'), uploadLimiter, async (req, res) => {
  const body = parse(
    z.object({
      links: z
        .array(z.object({ url: z.string().trim().max(4000), title: text(300).optional().nullable() }))
        .min(1, 'There are no links to import')
        .max(300, 'Import up to 300 links at a time'),
      categoryId: z.union([z.number(), z.string(), z.null()]).optional(),
      tag: z.string().trim().toLowerCase().max(40).optional(),
    }),
    req.body
  );
  const categoryId = await resolveCategoryId(req.project.id, body.categoryId);

  const seen = new Set();
  const wanted = [];
  let invalid = 0;
  let repeated = 0;
  for (const link of body.links) {
    let url;
    try {
      url = new URL(link.url);
    } catch {
      invalid++;
      continue;
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      invalid++;
      continue;
    }
    const normalized = url.toString();
    if (seen.has(normalized)) {
      repeated++;
      continue;
    }
    seen.add(normalized);
    wanted.push({ url: normalized, title: link.title || null });
  }

  const existing = await pool.query('SELECT source_url FROM board_items WHERE project_id = $1 AND source_url = ANY($2::text[])', [
    req.project.id,
    wanted.map((w) => w.url),
  ]);
  const have = new Set(existing.rows.map((r) => r.source_url));
  const fresh = wanted.filter((w) => !have.has(w.url));

  const count = await pool.query('SELECT COALESCE(MAX(position), -1) + 1 AS next, COUNT(*)::int AS n FROM board_items WHERE project_id = $1', [req.project.id]);
  const room = Math.max(0, config.limits.itemsPerProject - count.rows[0].n);
  const toAdd = fresh.slice(0, room);
  let position = count.rows[0].next;

  const added = [];
  for (const link of toAdd) {
    const detected = detectMedia(link.url);
    const inserted = await pool.query(
      `INSERT INTO board_items (project_id, source_url, media_type, title, tags, thumbnail_url, meta, position, category_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (project_id, source_url) DO NOTHING
       RETURNING id`,
      [req.project.id, link.url, detected.mediaType, link.title, body.tag ? [body.tag] : [], detected.thumbnailUrl, JSON.stringify(detected.meta || {}), position, categoryId, req.userId]
    );
    if (inserted.rows.length === 0) continue;
    position++;
    const id = inserted.rows[0].id;
    added.push(id);
    if (detected.wantsPreview) {
      enqueue(`preview for imported item ${id}`, async () => {
        const preview = await fetchPagePreview(link.url);
        if (preview.ogImage || preview.ogTitle) {
          await pool.query('UPDATE board_items SET thumbnail_url = COALESCE(thumbnail_url, $2), title = COALESCE(title, $3) WHERE id = $1', [id, preview.ogImage || null, preview.ogTitle || null]);
        }
        queueItem(id);
      });
    } else {
      queueItem(id);
    }
  }

  if (added.length) await touchProject(req.project.id);
  res.status(201).json({
    added: added.length,
    alreadyOnBoard: have.size,
    repeated,
    invalid,
    overLimit: fresh.length - toAdd.length,
  });
});

// ── comments on a reference ─────────────────────────────────────────────

// GET /projects/:projectId/items/comment-counts — { [itemId]: n } for the
// board's badges, in one query. Declared before the /:itemId routes.
boardItemsRouter.get('/comment-counts', projectAccess('viewer'), async (req, res) => {
  const result = await pool.query(
    `SELECT c.item_id, COUNT(*)::int AS n FROM item_comments c
     JOIN board_items i ON i.id = c.item_id WHERE i.project_id = $1 GROUP BY c.item_id`,
    [req.project.id]
  );
  res.json(Object.fromEntries(result.rows.map((r) => [r.item_id, r.n])));
});

async function itemInProject(req) {
  const id = idParam(req.params.itemId);
  if (!id) throw new HttpError(404, 'Item not found');
  const found = await pool.query('SELECT id FROM board_items WHERE id = $1 AND project_id = $2', [id, req.project.id]);
  if (found.rows.length === 0) throw new HttpError(404, 'Item not found');
  return id;
}

const commentRow = (row, userId) => ({
  id: row.id,
  body: row.body,
  author: row.display_name || row.email || 'Someone',
  mine: row.user_id === userId,
  created_at: row.created_at,
});
const COMMENT_SELECT = `SELECT c.id, c.body, c.user_id, c.created_at, u.display_name, u.email
  FROM item_comments c LEFT JOIN users u ON u.id = c.user_id`;

boardItemsRouter.get('/:itemId/comments', projectAccess('viewer'), async (req, res) => {
  const itemId = await itemInProject(req);
  const result = await pool.query(`${COMMENT_SELECT} WHERE c.item_id = $1 ORDER BY c.created_at ASC, c.id ASC`, [itemId]);
  res.json(result.rows.map((r) => commentRow(r, req.userId)));
});

// Viewers may comment: saying which reference they mean is why they were invited.
boardItemsRouter.post('/:itemId/comments', projectAccess('viewer'), uploadLimiter, async (req, res) => {
  const itemId = await itemInProject(req);
  const { body } = parse(z.object({ body: z.string({ error: 'Write something first' }).trim().min(1, 'Write something first').max(2000, 'Keep a comment under 2,000 characters') }), req.body);
  const count = await pool.query('SELECT COUNT(*)::int AS n FROM item_comments WHERE item_id = $1', [itemId]);
  if (count.rows[0].n >= 200) throw new HttpError(400, 'This reference has reached 200 comments.', 'TOO_MANY_COMMENTS');
  const inserted = await pool.query('INSERT INTO item_comments (item_id, user_id, body) VALUES ($1, $2, $3) RETURNING id', [itemId, req.userId, body]);
  const row = await pool.query(`${COMMENT_SELECT} WHERE c.id = $1`, [inserted.rows[0].id]);
  res.status(201).json(commentRow(row.rows[0], req.userId));
});

// Your own comment, or any comment if you own the project.
boardItemsRouter.delete('/:itemId/comments/:commentId', projectAccess('viewer'), async (req, res) => {
  const itemId = await itemInProject(req);
  const commentId = idParam(req.params.commentId);
  if (!commentId) throw new HttpError(404, 'Comment not found');
  const result = await pool.query(
    `DELETE FROM item_comments WHERE id = $1 AND item_id = $2 AND ($3 OR user_id = $4) RETURNING id`,
    [commentId, itemId, req.projectRole === 'owner', req.userId]
  );
  if (result.rows.length === 0) throw new HttpError(404, 'Comment not found');
  res.status(204).send();
});

/**
 * POST /projects/:projectId/items/upload — add a file from the user's own
 * computer, camera or clipboard. multipart/form-data, field "file", plus
 * optional categoryId, title, note.
 */
boardItemsRouter.post('/upload', projectAccess('editor'), uploadLimiter, receiveFile, async (req, res) => {
  if (!req.file) throw new HttpError(400, 'No file was uploaded.', 'BAD_UPLOAD');
  const tempPath = req.file.path;
  let finalKey = null;
  try {
    const fields = parse(
      z.object({ title: text(300).optional(), note: text(5000).optional(), categoryId: z.string().optional() }),
      req.body
    );
    const fileName = cleanFileName(req.file.originalname);
    const kind = await classifyUpload(tempPath, fileName, req.file.size);
    const categoryId = await resolveCategoryId(req.project.id, fields.categoryId);
    await assertCanStore(req.project.user_id, req.file.size);
    const position = await nextPosition(req.project.id);

    // Know the picture's proportions straight away so the board can lay it
    // out before the image has loaded. (The rest of the analysis is queued.)
    let width = null;
    let height = null;
    if (kind.mediaType === 'image' && kind.ext !== 'svg') {
      try {
        const size = await imageSize(await fsp.readFile(tempPath));
        width = size.width;
        height = size.height;
      } catch {
        throw new HttpError(415, 'That image could not be read. It may be damaged.', 'UNSUPPORTED_FILE');
      }
    }

    finalKey = storage.newKey(kind.ext);
    await fsp.rename(tempPath, storage.filePath(finalKey));

    const inserted = await pool.query(
      `INSERT INTO board_items
         (project_id, source_url, media_type, title, note, position, category_id, storage_key, file_name, file_size, mime_type, width, height, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING ${ITEM_COLUMNS}`,
      [
        req.project.id,
        `moodloom-upload:${finalKey}`,
        kind.mediaType,
        fields.title || null,
        fields.note || null,
        position,
        categoryId,
        finalKey,
        fileName,
        req.file.size,
        kind.mime,
        width,
        height,
        req.userId,
      ]
    );
    await touchProject(req.project.id);
    queueItem(inserted.rows[0].id);
    res.status(201).json(serializeItem(inserted.rows[0]));
  } catch (err) {
    // Whatever went wrong, don't leave the bytes behind with nothing
    // pointing at them.
    await fsp.unlink(tempPath).catch(() => {});
    if (finalKey) await storage.remove(finalKey);
    throw err;
  }
});

/**
 * POST /projects/:projectId/items/quote — a text card: a passage lifted
 * from a PDF on the board, or words typed in directly.
 * Body: { text, title?, categoryId?, fromItemId?, page? }
 */
boardItemsRouter.post('/quote', projectAccess('editor'), async (req, res) => {
  const body = parse(
    z.object({
      text: z.string({ error: 'text is required' }).trim().min(1, 'text is required').max(4000, 'That passage is too long (4,000 characters max)'),
      title: text(300).optional().nullable(),
      tags: tagsSchema.optional(),
      categoryId: z.union([z.number(), z.string(), z.null()]).optional(),
      fromItemId: z.number().int().positive().optional().nullable(),
      page: z.number().int().positive().max(100000).optional().nullable(),
    }),
    req.body
  );
  const categoryId = await resolveCategoryId(req.project.id, body.categoryId);
  const meta = {};
  if (body.fromItemId) {
    const source = await pool.query('SELECT id, title, file_name FROM board_items WHERE id = $1 AND project_id = $2', [
      body.fromItemId,
      req.project.id,
    ]);
    if (source.rows.length === 0) throw new HttpError(400, 'That source is not on this board', 'BAD_SOURCE');
    meta.fromItemId = source.rows[0].id;
    meta.fromTitle = source.rows[0].title || source.rows[0].file_name || null;
    if (body.page) meta.page = body.page;
  }
  const position = await nextPosition(req.project.id);
  const inserted = await pool.query(
    `INSERT INTO board_items (project_id, source_url, media_type, title, note, tags, meta, position, category_id, analyzed_at, created_by)
     VALUES ($1, $2, 'quote', $3, $4, $5, $6, $7, $8, now(), $9)
     RETURNING ${ITEM_COLUMNS}`,
    [req.project.id, `moodloom-quote:${crypto.randomUUID()}`, body.title || null, body.text, body.tags || [], JSON.stringify(meta), position, categoryId, req.userId]
  );
  await touchProject(req.project.id);
  res.status(201).json(serializeItem(inserted.rows[0]));
});

// POST /projects/:projectId/items/reorder — { ids: [...] } in the order the
// board should show them.
boardItemsRouter.post('/reorder', projectAccess('editor'), async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(z.number().int().positive()).min(1).max(config.limits.itemsPerProject) }), req.body);
  await pool.query(
    `UPDATE board_items i SET position = o.ord - 1
     FROM unnest($1::int[]) WITH ORDINALITY AS o(id, ord)
     WHERE i.id = o.id AND i.project_id = $2`,
    [ids, req.project.id]
  );
  res.json({ ok: true });
});

function itemId(req) {
  const id = idParam(req.params.itemId);
  if (!id) throw new HttpError(404, 'Item not found');
  return id;
}

// PATCH /projects/:projectId/items/:itemId — edit what the designer owns
// about a reference: its title, note, tags, category and place on the board.
boardItemsRouter.patch('/:itemId', projectAccess('editor'), async (req, res) => {
  const id = itemId(req);
  const body = parse(
    z.object({
      position: z.number().int().min(0).optional(),
      categoryId: z.union([z.number(), z.string(), z.null()]).optional(),
      title: text(300).nullable().optional(),
      note: text(5000).nullable().optional(),
      tags: tagsSchema.optional(),
    }),
    req.body
  );
  if (Object.keys(body).length === 0) throw new HttpError(400, 'Nothing to change', 'VALIDATION');
  const categoryId = body.categoryId !== undefined ? await resolveCategoryId(req.project.id, body.categoryId) : null;

  const result = await pool.query(
    `UPDATE board_items SET
       position = COALESCE($1, position),
       category_id = CASE WHEN $2 THEN $3 ELSE category_id END,
       title = CASE WHEN $4 THEN $5 ELSE title END,
       note = CASE WHEN $6 THEN $7 ELSE note END,
       tags = COALESCE($8::text[], tags)
     WHERE id = $9 AND project_id = $10
     RETURNING ${ITEM_COLUMNS}`,
    [
      body.position ?? null,
      body.categoryId !== undefined,
      categoryId,
      body.title !== undefined,
      body.title || null,
      body.note !== undefined,
      body.note || null,
      body.tags ?? null,
      id,
      req.project.id,
    ]
  );
  if (result.rows.length === 0) throw new HttpError(404, 'Item not found');
  await touchProject(req.project.id);
  res.json(serializeItem(result.rows[0]));
});

// DELETE /projects/:projectId/items/:itemId
boardItemsRouter.delete('/:itemId', projectAccess('editor'), async (req, res) => {
  const id = itemId(req);
  const result = await pool.query(
    'DELETE FROM board_items WHERE id = $1 AND project_id = $2 RETURNING storage_key, thumb_key',
    [id, req.project.id]
  );
  if (result.rows.length === 0) throw new HttpError(404, 'Item not found');
  await storage.removeMany([result.rows[0].storage_key, result.rows[0].thumb_key]);
  res.status(204).send();
});

// GET /projects/:projectId/items/:itemId/similar — "more like this", within
// the project, by feature-vector similarity.
boardItemsRouter.get('/:itemId/similar', projectAccess('viewer'), async (req, res) => {
  const id = itemId(req);
  const vectors = await loadProjectVectors(req.project.id);
  const target = vectors.find((v) => v.id === id);
  if (!target) return res.json({ available: false, items: [] });
  const ranked = nearest(target.vector, vectors.filter((v) => v.id !== id), 8).filter((r) => r.score > 0.35);
  if (ranked.length === 0) return res.json({ available: true, items: [] });
  const rows = await pool.query(`SELECT ${ITEM_COLUMNS} FROM board_items WHERE id = ANY($1::int[])`, [ranked.map((r) => r.id)]);
  const byId = new Map(rows.rows.map((r) => [r.id, r]));
  res.json({
    available: true,
    items: ranked.filter((r) => byId.has(r.id)).map((r) => ({ ...serializeItem(byId.get(r.id)), similarity: Math.round(r.score * 100) / 100 })),
  });
});
