import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { projectAccess, touchProject } from '../middleware/project.js';
import { parse, z } from '../lib/validate.js';

// mergeParams: mounted at /projects/:projectId/workspace
export const workspaceRouter = Router({ mergeParams: true });
workspaceRouter.use(requireAuth);

const MAX_NOTES_CHARS = 800_000;

// GET — the project's notes (HTML from the editor; plain text for notes
// written before rich text existed). No row yet is an empty workspace.
workspaceRouter.get('/', projectAccess('viewer'), async (req, res) => {
  const result = await pool.query('SELECT content, updated_at FROM workspace_notes WHERE project_id = $1', [req.project.id]);
  res.json(result.rows[0] || { content: '', updated_at: null });
});

// PUT — save the notes. The HTML is stored as written and is only ever
// rendered back through the editor's own schema (which drops scripts and
// unknown markup), in the app and on shared pages alike.
workspaceRouter.put('/', projectAccess('editor'), async (req, res) => {
  const { content } = parse(
    z.object({ content: z.string({ error: 'content (string) is required' }).max(MAX_NOTES_CHARS, 'These notes are too long to save') }),
    req.body
  );
  const result = await pool.query(
    `INSERT INTO workspace_notes (project_id, content, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (project_id) DO UPDATE SET content = $2, updated_at = now()
     RETURNING content, updated_at`,
    [req.project.id, content]
  );
  await touchProject(req.project.id);
  res.json(result.rows[0]);
});
