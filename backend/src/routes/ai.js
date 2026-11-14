import { Router } from 'express';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { projectAccess } from '../middleware/project.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { HttpError } from '../lib/errors.js';
import { parse, z, idParam, text } from '../lib/validate.js';
import { ITEM_COLUMNS, serializeItem } from '../services/serialize.js';
import { assertCanRunDirection, recordUsage } from '../services/plans.js';
import { loadProjectVectors } from '../services/ai/store.js';
import { suggestGroups, suggestCategory, cosine } from '../services/ai/similarity.js';
import { buildDigest } from '../services/ai/digest.js';
import { generateDirection, getLlmProvider } from '../services/ai/direction.js';
import { getEmbedder, embedderStatus } from '../services/ai/embedders/index.js';

// mergeParams: mounted at /projects/:projectId/ai
export const aiRouter = Router({ mergeParams: true });
aiRouter.use(requireAuth);

async function resolveCategory(projectId, raw) {
  if (raw === undefined || raw === null || raw === '' || raw === 'all') return null;
  const id = idParam(String(raw));
  if (!id) throw new HttpError(400, 'Invalid category', 'BAD_CATEGORY');
  const check = await pool.query('SELECT id FROM categories WHERE id = $1 AND project_id = $2', [id, projectId]);
  if (check.rows.length === 0) throw new HttpError(400, 'Invalid category', 'BAD_CATEGORY');
  return id;
}

// GET status — what is switched on for this project, and how far the
// background analysis has got.
aiRouter.get('/status', projectAccess('viewer'), async (req, res) => {
  const embedder = getEmbedder();
  const counts = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE i.palette IS NOT NULL)::int AS with_palette,
            COUNT(e.item_id) FILTER (WHERE e.model = $2)::int AS embedded
     FROM board_items i LEFT JOIN item_embeddings e ON e.item_id = i.id
     WHERE i.project_id = $1`,
    [req.project.id, embedder ? embedder.name : '']
  );
  res.json({
    aiEnabled: req.project.ai_enabled,
    directionNotes: { available: Boolean(getLlmProvider()), provider: config.ai.llmProvider, model: getLlmProvider()?.model || null },
    embedder: embedderStatus(),
    counts: counts.rows[0],
  });
});

// GET digest — what the board (or one category) has in common. Computed
// locally from palettes and tags; no model, nothing leaves the server.
aiRouter.get('/digest', projectAccess('viewer'), async (req, res) => {
  const categoryId = await resolveCategory(req.project.id, req.query.categoryId);
  const params = [req.project.id];
  let where = 'project_id = $1';
  if (categoryId) {
    params.push(categoryId);
    where += ' AND category_id = $2';
  }
  const rows = await pool.query(`SELECT id, media_type, tags, palette, meta, note FROM board_items WHERE ${where}`, params);
  res.json(buildDigest(rows.rows));
});

// POST groupings — suggest how the uncategorised references could be
// grouped, by clustering their feature vectors. Nothing is changed; the
// client shows the suggestion and the designer decides.
aiRouter.post('/groupings', projectAccess('editor'), aiLimiter, async (req, res) => {
  const vectors = await loadProjectVectors(req.project.id);
  const loose = vectors.filter((v) => v.category === null);
  if (loose.length < 4) {
    return res.json({ groups: [], reason: 'Needs at least four uncategorised references that have been analysed.' });
  }
  const { groups, score } = suggestGroups(loose);
  if (groups.length === 0) {
    return res.json({ groups: [], reason: 'These references don’t fall into clear visual groups.', score: Math.round(score * 100) / 100 });
  }
  const ids = groups.flatMap((g) => g.items.map((it) => it.id));
  const rows = await pool.query(`SELECT ${ITEM_COLUMNS} FROM board_items WHERE id = ANY($1::int[])`, [ids]);
  const byId = new Map(rows.rows.map((r) => [r.id, serializeItem(r)]));
  res.json({
    score: Math.round(score * 100) / 100,
    groups: groups.map((g) => {
      // A starting name from what the group's members most share.
      const counts = new Map();
      for (const it of g.items) for (const label of [...it.tags, ...it.traits]) counts.set(label, (counts.get(label) || 0) + 1);
      const shared = [...counts.entries()].filter(([, n]) => n >= Math.ceil(g.items.length * 0.6)).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([l]) => l);
      return {
        suggestedName: shared.length ? shared.join(' · ') : '',
        representativeId: g.representative.id,
        items: g.items.map((it) => byId.get(it.id)).filter(Boolean),
      };
    }),
  });
});

// GET suggest-category?itemId= — which existing category a reference most
// resembles, or null when it isn't clear.
aiRouter.get('/suggest-category', projectAccess('viewer'), async (req, res) => {
  const id = idParam(String(req.query.itemId || ''));
  if (!id) throw new HttpError(400, 'itemId is required', 'VALIDATION');
  const vectors = await loadProjectVectors(req.project.id);
  const target = vectors.find((v) => v.id === id);
  if (!target) return res.json({ suggestion: null });
  const labelled = vectors.filter((v) => v.id !== id && v.category !== null);
  const suggestion = suggestCategory(target.vector, labelled);
  res.json({ suggestion: suggestion ? { categoryId: suggestion.category, confidence: suggestion.confidence } : null });
});

// GET search?q= — find references by describing them ("warm serif
// packaging"). Only with the CLIP embedder, which can compare text with
// images; the classic features cannot.
aiRouter.get('/search', projectAccess('viewer'), aiLimiter, async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().min(2, 'Type at least two characters').max(200) }), req.query);
  const embedder = getEmbedder();
  if (!embedder?.embedText) return res.json({ available: false, items: [] });
  let queryVector;
  try {
    queryVector = await embedder.embedText(q);
  } catch (err) {
    console.error(`Description search unavailable: ${err.message}`);
    return res.json({ available: false, items: [] });
  }
  const vectors = await loadProjectVectors(req.project.id);
  const ranked = vectors
    .map((v) => ({ id: v.id, score: cosine(queryVector, v.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  const rows = await pool.query(`SELECT ${ITEM_COLUMNS} FROM board_items WHERE id = ANY($1::int[])`, [ranked.map((r) => r.id)]);
  const byId = new Map(rows.rows.map((r) => [r.id, r]));
  res.json({ available: true, items: ranked.filter((r) => byId.has(r.id)).map((r) => ({ ...serializeItem(byId.get(r.id)), similarity: Math.round(r.score * 100) / 100 })) });
});

const NOTE_FIELDS = 'id, project_id, category_id, content, model, prompt_version, source_item_ids, created_at';

// GET direction — the project's direction notes, newest first.
aiRouter.get('/direction', projectAccess('viewer'), async (req, res) => {
  const result = await pool.query(
    `SELECT ${NOTE_FIELDS} FROM direction_notes WHERE project_id = $1 ORDER BY created_at DESC LIMIT 30`,
    [req.project.id]
  );
  res.json(result.rows);
});

// POST direction — write a direction note from the board (or one category).
// This is the one feature that sends project content to a third party, so
// it needs the owner's consent switch (project.ai_enabled) to be on.
aiRouter.post('/direction', projectAccess('editor'), aiLimiter, async (req, res) => {
  const body = parse(
    z.object({ categoryId: z.union([z.number(), z.string(), z.null()]).optional(), focus: text(300).optional() }),
    req.body
  );
  if (!getLlmProvider()) {
    throw new HttpError(503, 'Direction notes need an AI key on the server (ANTHROPIC_API_KEY).', 'AI_NOT_CONFIGURED');
  }
  if (!req.project.ai_enabled) {
    throw new HttpError(
      403,
      'AI is off for this project. The owner can turn it on; doing so allows the chosen references to be sent to the AI provider.',
      'AI_CONSENT_REQUIRED'
    );
  }
  const categoryId = await resolveCategory(req.project.id, body.categoryId);
  await assertCanRunDirection(req.project.user_id);
  const note = await generateDirection({ project: req.project, categoryId, focus: body.focus || '', userId: req.userId });
  await recordUsage(req.project.user_id, 'direction_note');
  res.status(201).json(note);
});

aiRouter.delete('/direction/:noteId', projectAccess('editor'), async (req, res) => {
  const id = idParam(req.params.noteId);
  if (!id) throw new HttpError(404, 'Note not found');
  const result = await pool.query('DELETE FROM direction_notes WHERE id = $1 AND project_id = $2 RETURNING id', [id, req.project.id]);
  if (result.rows.length === 0) throw new HttpError(404, 'Note not found');
  res.status(204).send();
});
