import { Router } from 'express';
import { pool } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { projectAccess } from '../middleware/project.js';
import { HttpError } from '../lib/errors.js';
import { parse, z, idParam, requiredText } from '../lib/validate.js';

// mergeParams: mounted at /projects/:projectId/categories
export const categoriesRouter = Router({ mergeParams: true });
categoriesRouter.use(requireAuth);

const FIELDS = 'id, name, position, created_at';
const MAX_CATEGORIES = 40;

categoriesRouter.get('/', projectAccess('viewer'), async (req, res) => {
  const result = await pool.query(
    `SELECT ${FIELDS} FROM categories WHERE project_id = $1 ORDER BY position ASC, id ASC`,
    [req.project.id]
  );
  res.json(result.rows);
});

// POST — create a category. Optionally files a set of items into it in the
// same step ({ name, itemIds }), which is how an accepted "suggested
// grouping" becomes a real category.
categoriesRouter.post('/', projectAccess('editor'), async (req, res) => {
  const { name, itemIds } = parse(
    z.object({ name: requiredText(60, 'name'), itemIds: z.array(z.number().int().positive()).max(2000).optional() }),
    req.body
  );
  const next = await pool.query(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next, COUNT(*)::int AS n FROM categories WHERE project_id = $1',
    [req.project.id]
  );
  if (next.rows[0].n >= MAX_CATEGORIES) throw new HttpError(400, `A project can have up to ${MAX_CATEGORIES} categories.`, 'TOO_MANY');
  const result = await pool.query(
    `INSERT INTO categories (project_id, name, position) VALUES ($1, $2, $3) RETURNING ${FIELDS}`,
    [req.project.id, name, next.rows[0].next]
  );
  if (itemIds?.length) {
    await pool.query('UPDATE board_items SET category_id = $1 WHERE project_id = $2 AND id = ANY($3::int[])', [
      result.rows[0].id,
      req.project.id,
      itemIds,
    ]);
  }
  res.status(201).json(result.rows[0]);
});

function categoryId(req) {
  const id = idParam(req.params.categoryId);
  if (!id) throw new HttpError(404, 'Category not found');
  return id;
}

categoriesRouter.patch('/:categoryId', projectAccess('editor'), async (req, res) => {
  const id = categoryId(req);
  const { name, position } = parse(
    z.object({ name: requiredText(60, 'name').optional(), position: z.number().int().min(0).optional() }),
    req.body
  );
  if (name === undefined && position === undefined) throw new HttpError(400, 'name or position is required', 'VALIDATION');
  const result = await pool.query(
    `UPDATE categories SET name = COALESCE($1, name), position = COALESCE($2, position)
     WHERE id = $3 AND project_id = $4 RETURNING ${FIELDS}`,
    [name ?? null, position ?? null, id, req.project.id]
  );
  if (result.rows.length === 0) throw new HttpError(404, 'Category not found');
  res.json(result.rows[0]);
});

// Deleting a category does not delete its items; they become uncategorized.
categoriesRouter.delete('/:categoryId', projectAccess('editor'), async (req, res) => {
  const id = categoryId(req);
  const result = await pool.query('DELETE FROM categories WHERE id = $1 AND project_id = $2 RETURNING id', [id, req.project.id]);
  if (result.rows.length === 0) throw new HttpError(404, 'Category not found');
  res.status(204).send();
});
