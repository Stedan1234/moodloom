import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { detectMedia } from '../services/mediaDetector.js';
import { fetchPagePreview } from '../services/pagePreview.js';

// mergeParams so we can read :projectId from the parent router (mounted at /projects/:projectId/items)
export const boardItemsRouter = Router({ mergeParams: true });
boardItemsRouter.use(requireAuth);

// Confirms the project belongs to the current user before letting anything
// touch its items — same ownership check pattern as projects.js.
async function assertProjectOwnership(req, res) {
  const result = await pool.query('SELECT id FROM projects WHERE id = $1 AND user_id = $2', [
    req.params.projectId,
    req.userId,
  ]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Project not found' });
    return false;
  }
  return true;
}

// GET /projects/:projectId/items — the fixed-grid board contents, in position order
boardItemsRouter.get('/', async (req, res) => {
  if (!(await assertProjectOwnership(req, res))) return;

  const result = await pool.query(
    'SELECT id, source_url, media_type, title, thumbnail_url, embed_html, position, created_at FROM board_items WHERE project_id = $1 ORDER BY position ASC, created_at ASC',
    [req.params.projectId]
  );
  res.json(result.rows);
});

/**
 * POST /projects/:projectId/items — THE core-loop endpoint.
 * This is what the browser extension calls the moment someone hits
 * "Add to Moodloom" on a page — capture-at-source, in one action.
 * Body: { sourceUrl, title? }
 */
boardItemsRouter.post('/', async (req, res) => {
  if (!(await assertProjectOwnership(req, res))) return;

  const { sourceUrl, title } = req.body;
  if (!sourceUrl || !sourceUrl.trim()) {
    return res.status(400).json({ error: 'sourceUrl is required' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(sourceUrl.trim());
  } catch {
    return res.status(400).json({ error: 'sourceUrl must be a valid URL' });
  }

  const normalizedUrl = parsedUrl.toString();

  // Duplicate-capture guard: clicking "Add to board" twice (a double-click,
  // or a slow network making someone click again) previously created two
  // separate board items for the same reference. Instead of inserting again,
  // return the item that's already there — same shape, but with
  // alreadyOnBoard so the caller can tell the person nothing new was added,
  // rather than silently duplicating it on the board.
  const existing = await pool.query(
    `SELECT id, source_url, media_type, title, thumbnail_url, embed_html, position, created_at
     FROM board_items WHERE project_id = $1 AND source_url = $2
     ORDER BY created_at ASC LIMIT 1`,
    [req.params.projectId, normalizedUrl]
  );
  if (existing.rows.length > 0) {
    return res.status(200).json({ ...existing.rows[0], alreadyOnBoard: true });
  }

  const detected = detectMedia(normalizedUrl);
  let { mediaType, embedHtml, thumbnailUrl } = detected;
  let resolvedTitle = title?.trim() || null;

  // For a generic link (not an image, not a known video provider), the
  // capture used to save with zero visual — just a text card. Now fetch the
  // page's own social-preview image/title (what it already publishes for
  // Twitter/iMessage/Slack unfurls) and use that as a real thumbnail. Best
  // effort: if the site blocks this, times out, or has no og tags, the
  // capture still succeeds exactly as it did before — this only adds a
  // thumbnail when one is actually available.
  if (mediaType === 'link') {
    const preview = await fetchPagePreview(normalizedUrl);
    if (preview.ogImage) thumbnailUrl = preview.ogImage;
    if (!resolvedTitle && preview.ogTitle) resolvedTitle = preview.ogTitle;
  }

  const nextPosition = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM board_items WHERE project_id = $1',
    [req.params.projectId]
  );

  let result;
  try {
    result = await pool.query(
      `INSERT INTO board_items (project_id, source_url, media_type, title, thumbnail_url, embed_html, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, source_url, media_type, title, thumbnail_url, embed_html, position, created_at`,
      [
        req.params.projectId,
        normalizedUrl,
        mediaType,
        resolvedTitle,
        thumbnailUrl,
        embedHtml,
        nextPosition.rows[0].next,
      ]
    );
  } catch (err) {
    // 23505 = unique_violation. This means the SELECT-then-INSERT race above
    // actually happened (two near-simultaneous captures of the same URL) —
    // the database constraint caught what the earlier check couldn't. Same
    // graceful response as the normal duplicate path, not a 500.
    if (err.code === '23505') {
      const raceWinner = await pool.query(
        `SELECT id, source_url, media_type, title, thumbnail_url, embed_html, position, created_at
         FROM board_items WHERE project_id = $1 AND source_url = $2`,
        [req.params.projectId, normalizedUrl]
      );
      return res.status(200).json({ ...raceWinner.rows[0], alreadyOnBoard: true });
    }
    throw err;
  }

  await pool.query('UPDATE projects SET updated_at = now() WHERE id = $1', [req.params.projectId]);

  res.status(201).json(result.rows[0]);
});

// PATCH /projects/:projectId/items/:itemId — currently just supports reordering
// (position), since v1's board is a fixed grid, not a freeform canvas.
boardItemsRouter.patch('/:itemId', async (req, res) => {
  if (!(await assertProjectOwnership(req, res))) return;

  const { position } = req.body;
  if (typeof position !== 'number') {
    return res.status(400).json({ error: 'position (number) is required' });
  }

  const result = await pool.query(
    `UPDATE board_items SET position = $1
     WHERE id = $2 AND project_id = $3
     RETURNING id, source_url, media_type, title, thumbnail_url, embed_html, position, created_at`,
    [position, req.params.itemId, req.params.projectId]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Item not found' });
  }
  res.json(result.rows[0]);
});

// DELETE /projects/:projectId/items/:itemId
boardItemsRouter.delete('/:itemId', async (req, res) => {
  if (!(await assertProjectOwnership(req, res))) return;

  const result = await pool.query(
    'DELETE FROM board_items WHERE id = $1 AND project_id = $2 RETURNING id',
    [req.params.itemId, req.params.projectId]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Item not found' });
  }
  res.status(204).send();
});
