import { Router } from 'express';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { projectAccess, touchProject } from '../middleware/project.js';
import { HttpError } from '../lib/errors.js';

// The sketch canvas: one Excalidraw scene per project, stored as its JSON
// text. The server treats it as an opaque document; it is only ever handed
// back to the canvas library, never rendered as HTML.
// mergeParams: mounted at /projects/:projectId/canvas
export const canvasRouter = Router({ mergeParams: true });
canvasRouter.use(requireAuth);

canvasRouter.get('/', projectAccess('viewer'), async (req, res) => {
  const result = await pool.query('SELECT scene, updated_at FROM canvases WHERE project_id = $1', [req.project.id]);
  if (result.rows.length === 0) return res.json({ scene: null, updated_at: null });
  let scene = null;
  try {
    scene = JSON.parse(result.rows[0].scene);
  } catch {
    scene = null;
  }
  res.json({ scene, updated_at: result.rows[0].updated_at });
});

canvasRouter.put('/', projectAccess('editor'), async (req, res) => {
  const scene = req.body?.scene;
  if (!scene || typeof scene !== 'object' || Array.isArray(scene) || !Array.isArray(scene.elements)) {
    throw new HttpError(400, 'scene must be a canvas document', 'VALIDATION');
  }
  if (scene.elements.length > 20000) throw new HttpError(400, 'That sketch has too many elements to save', 'VALIDATION');
  // Only the parts of the document that are the drawing. View state
  // (selection, zoom, collaborators) is the viewer's business, not saved.
  const document = {
    type: 'excalidraw',
    version: 2,
    source: 'moodloom',
    elements: scene.elements,
    appState: { viewBackgroundColor: typeof scene.appState?.viewBackgroundColor === 'string' ? scene.appState.viewBackgroundColor.slice(0, 32) : '#ffffff' },
    files: scene.files && typeof scene.files === 'object' && !Array.isArray(scene.files) ? scene.files : {},
  };
  const serialised = JSON.stringify(document);
  if (Buffer.byteLength(serialised) > config.limits.canvasBytes) {
    throw new HttpError(413, 'That sketch is too large to save. Remove a few large images from it.', 'FILE_TOO_LARGE');
  }
  const result = await pool.query(
    `INSERT INTO canvases (project_id, scene, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (project_id) DO UPDATE SET scene = $2, updated_at = now()
     RETURNING updated_at`,
    [req.project.id, serialised]
  );
  await touchProject(req.project.id);
  res.json({ ok: true, updated_at: result.rows[0].updated_at });
});
