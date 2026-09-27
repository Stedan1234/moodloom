import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';

// mergeParams so we can read :projectId from the parent router (mounted at /projects/:projectId/categories)
export const categoriesRouter = Router({ mergeParams: true });
categoriesRouter.use(requireAuth);

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

// GET /projects/:projectId/categories
categoriesRouter.get('/', async (req, res) => {
  if (!(await assertProjectOwnership(req, res))) return;

  const result = await pool.query(
    'SELECT id, name, position, created_at FROM categories WHERE project_id = $1 ORDER BY position ASC, created_at ASC',
    [req.params.projectId]
  );
  res.json(result.rows);
});

// POST /projects/:projectId/categories — create a new category (e.g. after
// dogfooding turns up a grouping the starter set didn't anticipate)
categoriesRouter.post('/', async (req, res) => {
  if (!(await assertProjectOwnership(req, res))) return;

  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  const nextPosition = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM categories WHERE project_id = $1',
    [req.params.projectId]
  );

  const result = await pool.query(
    'INSERT INTO categories (project_id, name, position) VALUES ($1, $2, $3) RETURNING id, name, position, created_at',
    [req.params.projectId, name.trim(), nextPosition.rows[0].next]
  );
  res.status(201).json(result.rows[0]);
});

// PATCH /projects/:projectId/categories/:categoryId — rename or reorder
categoriesRouter.patch('/:categoryId', async (req, res) => {
  if (!(await assertProjectOwnership(req, res))) return;

  const { name, position } = req.body;
  if (name === undefined && position === undefined) {
    return res.status(400).json({ error: 'name or position is required' });
  }
  if (name !== undefined && !name.trim()) {
    return res.status(400).json({ error: 'name cannot be empty' });
  }

  const result = await pool.query(
    `UPDATE categories SET
       name = COALESCE($1, name),
       position = COALESCE($2, position)
     WHERE id = $3 AND project_id = $4
     RETURNING id, name, position, created_at`,
    [name?.trim() ?? null, position ?? null, req.params.categoryId, req.params.projectId]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Category not found' });
  }
  res.json(result.rows[0]);
});

// DELETE /projects/:projectId/categories/:categoryId — deleting a category
// does NOT delete its items; the FK (ON DELETE SET NULL, see schema.sql)
// just un-categorizes them back to "Uncategorized".
categoriesRouter.delete('/:categoryId', async (req, res) => {
  if (!(await assertProjectOwnership(req, res))) return;

  const result = await pool.query('DELETE FROM categories WHERE id = $1 AND project_id = $2 RETURNING id', [
    req.params.categoryId,
    req.params.projectId,
  ]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Category not found' });
  }
  res.status(204).send();
});
