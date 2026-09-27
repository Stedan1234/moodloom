import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { UPLOADS_DIR, PUBLIC_BASE_URL } from '../config/uploads.js';
import { STARTER_CATEGORY_NAMES } from '../db/starterCategories.js';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

/**
 * Every query below filters by req.userId, so a project belonging to one user
 * is never visible or writable by another — this is the whole ownership model
 * for v1, since there is no team/sharing feature yet (explicitly deferred).
 */

// GET /projects — list all of the current user's projects
projectsRouter.get('/', async (req, res) => {
  const result = await pool.query(
    'SELECT id, name, created_at, updated_at FROM projects WHERE user_id = $1 ORDER BY updated_at DESC',
    [req.userId]
  );
  res.json(result.rows);
});

// POST /projects — create a new project (this is the "create new project on the fly"
// flow the capture extension needs)
projectsRouter.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const result = await pool.query(
    'INSERT INTO projects (user_id, name) VALUES ($1, $2) RETURNING id, name, created_at, updated_at',
    [req.userId, name.trim()]
  );

  // Seed a starter set of categories so a brand-new project isn't just one
  // undifferentiated board from the start — raised during dogfooding as a
  // way to separate design inspiration from post ideas from video direction
  // etc. Fully editable afterwards (see routes/categories.js); this is just
  // a helpful default, not a fixed structure.
  for (let i = 0; i < STARTER_CATEGORY_NAMES.length; i++) {
    await pool.query('INSERT INTO categories (project_id, name, position) VALUES ($1, $2, $3)', [
      result.rows[0].id,
      STARTER_CATEGORY_NAMES[i],
      i,
    ]);
  }

  res.status(201).json(result.rows[0]);
});

// Helper: confirms the project exists and belongs to req.userId, or sends a 404.
// Returns the project row on success, or null (after sending a response) on failure.
async function findOwnedProject(req, res) {
  const result = await pool.query(
    'SELECT id, name, created_at, updated_at FROM projects WHERE id = $1 AND user_id = $2',
    [req.params.id, req.userId]
  );
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Project not found' });
    return null;
  }
  return result.rows[0];
}

// GET /projects/:id — a single project's details
projectsRouter.get('/:id', async (req, res) => {
  const project = await findOwnedProject(req, res);
  if (!project) return;
  res.json(project);
});

// PATCH /projects/:id — rename a project
projectsRouter.patch('/:id', async (req, res) => {
  const project = await findOwnedProject(req, res);
  if (!project) return;

  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const result = await pool.query(
    'UPDATE projects SET name = $1, updated_at = now() WHERE id = $2 RETURNING id, name, created_at, updated_at',
    [name.trim(), project.id]
  );
  res.json(result.rows[0]);
});

// DELETE /projects/:id
projectsRouter.delete('/:id', async (req, res) => {
  const project = await findOwnedProject(req, res);
  if (!project) return;

  // Deleting a project cascades to its board_items in the DB (see schema.sql
  // FK), but that cascade never touches the filesystem — an uploaded image's
  // bytes would be orphaned in uploads/ forever otherwise. The single-item
  // DELETE route (boardItems.js) does this same cleanup for one item at a
  // time; this covers the "delete the whole project" path, which skips that
  // route entirely.
  const uploadPrefix = `${PUBLIC_BASE_URL}/uploads/`;
  const uploadedItems = await pool.query(
    'SELECT source_url FROM board_items WHERE project_id = $1 AND source_url LIKE $2',
    [project.id, `${uploadPrefix}%`]
  );
  for (const row of uploadedItems.rows) {
    const filename = row.source_url.slice(uploadPrefix.length);
    if (/^[a-zA-Z0-9-]+\.(png|jpg|jpeg|gif|webp)$/.test(filename)) {
      fs.unlink(path.join(UPLOADS_DIR, filename), (err) => {
        if (err && err.code !== 'ENOENT') {
          console.error(`Failed to delete uploaded file ${filename}:`, err.message);
        }
      });
    }
  }

  await pool.query('DELETE FROM projects WHERE id = $1', [project.id]);
  res.status(204).send();
});
