import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

// mergeParams so we can read :projectId (mounted at /projects/:projectId/workspace)
export const workspaceRouter = Router({ mergeParams: true });
workspaceRouter.use(requireAuth);

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

// GET /projects/:projectId/workspace — the v1 minimal workspace: plain text notes
// living next to the board, per mvp-scope.md (deliberately NOT a design canvas yet)
workspaceRouter.get('/', async (req, res) => {
  if (!(await assertProjectOwnership(req, res))) return;

  const result = await pool.query(
    'SELECT content, updated_at FROM workspace_notes WHERE project_id = $1',
    [req.params.projectId]
  );
  // No row yet just means an empty workspace — that's a normal, valid state.
  res.json(result.rows[0] || { content: '', updated_at: null });
});

// PUT /projects/:projectId/workspace — upsert the notes content
workspaceRouter.put('/', async (req, res) => {
  if (!(await assertProjectOwnership(req, res))) return;

  const { content } = req.body;
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'content (string) is required' });
  }

  const result = await pool.query(
    `INSERT INTO workspace_notes (project_id, content, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (project_id) DO UPDATE SET content = $2, updated_at = now()
     RETURNING content, updated_at`,
    [req.params.projectId, content]
  );
  res.json(result.rows[0]);
});
