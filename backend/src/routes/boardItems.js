import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { detectMedia } from '../services/mediaDetector.js';

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

  const { mediaType, embedHtml, thumbnailUrl } = detectMedia(parsedUrl.toString());

  const nextPosition = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM board_items WHERE project_id = $1',
    [req.params.projectId]
  );

  const result = await pool.query(
    `INSERT INTO board_items (project_id, source_url, media_type, title, thumbnail_url, embed_html, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, source_url, media_type, title, thumbnail_url, embed_html, position, created_at`,
    [
      req.params.projectId,
      parsedUrl.toString(),
      mediaType,
      title?.trim() || null,
      thumbnailUrl,
      embedHtml,
      nextPosition.rows[0].next,
    ]
  );

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
