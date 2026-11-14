import { Router } from 'express';
import { pool, withTransaction } from '../db/pool.js';
import { requireAuth } from '../middleware/auth.js';
import { projectAccess } from '../middleware/project.js';
import { STARTER_CATEGORY_NAMES } from '../db/starterCategories.js';
import { parse, z, requiredText, text } from '../lib/validate.js';
import * as storage from '../lib/storage.js';
import { publicUrl } from '../lib/storage.js';
import { serializeProject } from '../services/serialize.js';
import { assertCanCreateProject } from '../services/plans.js';
import { streamProjectExport } from '../services/exporter.js';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

export const STAGES = ['brief', 'research', 'concepts', 'refine', 'deliver'];

const briefSchema = z.object({
  client: text(200).optional(),
  summary: text(2000).optional(),
  audience: text(2000).optional(),
  goals: text(2000).optional(),
  deliverables: text(2000).optional(),
  constraints: text(2000).optional(),
  tone: text(600).optional(),
  deadline: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-01-31'), z.literal('')]).optional(),
  keywords: z.array(text(40)).max(24).optional(),
});

// GET /projects — every project the caller owns or has been added to, with
// enough for a card: item count and a few preview images.
projectsRouter.get('/', async (req, res) => {
  const result = await pool.query(
    `SELECT p.id, p.name, p.brief, p.stage, p.ai_enabled, p.created_at, p.updated_at,
            CASE WHEN p.user_id = $1 THEN 'owner' ELSE m.role END AS role,
            (SELECT COUNT(*)::int FROM board_items i WHERE i.project_id = p.id) AS item_count,
            (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
               SELECT i.thumb_key, i.storage_key, i.thumbnail_url, i.media_type, i.palette
               FROM board_items i
               WHERE i.project_id = p.id AND (i.thumb_key IS NOT NULL OR i.thumbnail_url IS NOT NULL OR (i.storage_key IS NOT NULL AND i.media_type = 'image'))
               ORDER BY i.position DESC, i.id DESC LIMIT 4
             ) t) AS covers
     FROM projects p
     LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
     WHERE p.user_id = $1 OR m.user_id IS NOT NULL
     ORDER BY p.updated_at DESC`,
    [req.userId]
  );
  res.json(
    result.rows.map((row) => ({
      ...serializeProject(row),
      item_count: row.item_count,
      covers: row.covers.map((c) => ({
        url: c.thumb_key ? publicUrl(c.thumb_key) : c.storage_key ? publicUrl(c.storage_key) : c.thumbnail_url,
        color: c.palette?.[0]?.hex || null,
      })),
    }))
  );
});

// POST /projects — create a project (also what the extension's "new project
// on the fly" calls). Seeds the starter categories.
projectsRouter.post('/', async (req, res) => {
  const { name } = parse(z.object({ name: requiredText(120, 'name') }), req.body);
  await assertCanCreateProject(req.userId);

  const project = await withTransaction(async (client) => {
    const created = await client.query(
      'INSERT INTO projects (user_id, name) VALUES ($1, $2) RETURNING id, name, brief, stage, ai_enabled, created_at, updated_at',
      [req.userId, name]
    );
    for (let i = 0; i < STARTER_CATEGORY_NAMES.length; i++) {
      await client.query('INSERT INTO categories (project_id, name, position) VALUES ($1, $2, $3)', [
        created.rows[0].id,
        STARTER_CATEGORY_NAMES[i],
        i,
      ]);
    }
    return created.rows[0];
  });
  res.status(201).json(serializeProject(project, 'owner'));
});

// GET /projects/:projectId
projectsRouter.get('/:projectId', projectAccess('viewer'), async (req, res) => {
  res.json(serializeProject(req.project));
});

// PATCH /projects/:projectId — rename, edit the brief, move the stage, or
// switch AI on/off. Editors can change the working fields; the name and the
// AI consent switch are the owner's.
projectsRouter.patch('/:projectId', projectAccess('editor'), async (req, res) => {
  const body = parse(
    z.object({
      name: requiredText(120, 'name').optional(),
      brief: briefSchema.optional(),
      stage: z.enum(STAGES).optional(),
      aiEnabled: z.boolean().optional(),
    }),
    req.body
  );
  if ((body.name !== undefined || body.aiEnabled !== undefined) && req.projectRole !== 'owner') {
    return res.status(403).json({ error: 'Only the project owner can do that.', code: 'FORBIDDEN_ROLE' });
  }
  if (Object.keys(body).length === 0) return res.status(400).json({ error: 'Nothing to change', code: 'VALIDATION' });

  const result = await pool.query(
    `UPDATE projects SET
       name = COALESCE($1, name),
       brief = COALESCE($2::jsonb, brief),
       stage = COALESCE($3, stage),
       ai_enabled = COALESCE($4, ai_enabled),
       updated_at = now()
     WHERE id = $5
     RETURNING id, name, brief, stage, ai_enabled, created_at, updated_at`,
    [body.name ?? null, body.brief ? JSON.stringify(body.brief) : null, body.stage ?? null, body.aiEnabled ?? null, req.project.id]
  );
  res.json(serializeProject(result.rows[0], req.projectRole));
});

// DELETE /projects/:projectId — owner only. The database cascade removes
// the rows; the stored files have to be removed by hand.
projectsRouter.delete('/:projectId', projectAccess('owner'), async (req, res) => {
  const files = await pool.query(
    'SELECT storage_key, thumb_key FROM board_items WHERE project_id = $1 AND storage_key IS NOT NULL',
    [req.project.id]
  );
  await pool.query('DELETE FROM projects WHERE id = $1', [req.project.id]);
  await storage.removeMany(files.rows.flatMap((r) => [r.storage_key, r.thumb_key]));
  res.status(204).send();
});

// GET /projects/:projectId/export — the whole project as a ZIP.
projectsRouter.get('/:projectId/export', projectAccess('viewer'), async (req, res) => {
  await streamProjectExport(req.project, res);
});
