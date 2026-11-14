import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { projectAccess } from '../middleware/project.js';
import { publicLimiter, authLimiter } from '../middleware/rateLimit.js';
import { HttpError } from '../lib/errors.js';
import { parse, z, idParam } from '../lib/validate.js';
import { ITEM_COLUMNS, serializeItem } from '../services/serialize.js';
import { assertCanAddMember, assertCanAddShareLink } from '../services/plans.js';
import { hashToken } from './auth.js';

// Two ways to let someone else see a project:
//
//   share links   read-only, no account needed, for showing a client. The
//                 link is the key: anyone holding it can view what it
//                 includes until the owner revokes it.
//   members       people with their own Moodloom account, added by a
//                 single-use invitation link, as a viewer or an editor.

// ── owner-side management, mounted at /projects/:projectId ──────────────
export const projectSharingRouter = Router({ mergeParams: true });
projectSharingRouter.use(requireAuth);

const LINK_FIELDS = 'id, token, include_board, include_notes, include_brand, include_brief, created_at';
const linkOptions = z.object({
  includeBoard: z.boolean().optional(),
  includeNotes: z.boolean().optional(),
  includeBrand: z.boolean().optional(),
  includeBrief: z.boolean().optional(),
});

function serializeLink(row) {
  return {
    id: row.id,
    url: `${config.appUrl}/s/${row.token}`,
    includeBoard: row.include_board,
    includeNotes: row.include_notes,
    includeBrand: row.include_brand,
    includeBrief: row.include_brief,
    created_at: row.created_at,
  };
}

projectSharingRouter.get('/share-links', projectAccess('owner'), async (req, res) => {
  const result = await pool.query(`SELECT ${LINK_FIELDS} FROM share_links WHERE project_id = $1 ORDER BY id`, [req.project.id]);
  res.json(result.rows.map(serializeLink));
});

projectSharingRouter.post('/share-links', projectAccess('owner'), async (req, res) => {
  const options = parse(linkOptions, req.body);
  await assertCanAddShareLink(req.project.user_id, req.project.id);
  const count = await pool.query('SELECT COUNT(*)::int AS n FROM share_links WHERE project_id = $1', [req.project.id]);
  if (count.rows[0].n >= 20) throw new HttpError(400, 'A project can have up to 20 share links.', 'TOO_MANY');
  // 192 bits from the system CSPRNG: not guessable, not enumerable.
  const token = crypto.randomBytes(24).toString('base64url');
  const result = await pool.query(
    `INSERT INTO share_links (project_id, token, include_board, include_notes, include_brand, include_brief, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${LINK_FIELDS}`,
    [req.project.id, token, options.includeBoard ?? true, options.includeNotes ?? false, options.includeBrand ?? false, options.includeBrief ?? false, req.userId]
  );
  res.status(201).json(serializeLink(result.rows[0]));
});

projectSharingRouter.patch('/share-links/:linkId', projectAccess('owner'), async (req, res) => {
  const id = idParam(req.params.linkId);
  if (!id) throw new HttpError(404, 'Share link not found');
  const o = parse(linkOptions, req.body);
  const result = await pool.query(
    `UPDATE share_links SET
       include_board = COALESCE($1, include_board), include_notes = COALESCE($2, include_notes),
       include_brand = COALESCE($3, include_brand), include_brief = COALESCE($4, include_brief)
     WHERE id = $5 AND project_id = $6 RETURNING ${LINK_FIELDS}`,
    [o.includeBoard ?? null, o.includeNotes ?? null, o.includeBrand ?? null, o.includeBrief ?? null, id, req.project.id]
  );
  if (result.rows.length === 0) throw new HttpError(404, 'Share link not found');
  res.json(serializeLink(result.rows[0]));
});

// Revoking is deleting: the link stops working immediately.
projectSharingRouter.delete('/share-links/:linkId', projectAccess('owner'), async (req, res) => {
  const id = idParam(req.params.linkId);
  if (!id) throw new HttpError(404, 'Share link not found');
  const result = await pool.query('DELETE FROM share_links WHERE id = $1 AND project_id = $2 RETURNING id', [id, req.project.id]);
  if (result.rows.length === 0) throw new HttpError(404, 'Share link not found');
  res.status(204).send();
});

// Everyone on the project can see who else is on it.
projectSharingRouter.get('/members', projectAccess('viewer'), async (req, res) => {
  const owner = await pool.query('SELECT id, email, display_name FROM users WHERE id = $1', [req.project.user_id]);
  const members = await pool.query(
    `SELECT u.id, u.email, u.display_name, m.role, m.created_at FROM project_members m JOIN users u ON u.id = m.user_id
     WHERE m.project_id = $1 ORDER BY m.created_at`,
    [req.project.id]
  );
  const person = (u, role) => ({ id: u.id, email: u.email, name: u.display_name, role, you: u.id === req.userId });
  const result = { members: [person(owner.rows[0], 'owner'), ...members.rows.map((m) => person(m, m.role))], invites: [] };
  if (req.projectRole === 'owner') {
    const invites = await pool.query(
      'SELECT id, role, expires_at, created_at FROM project_invites WHERE project_id = $1 AND used_at IS NULL AND expires_at > now() ORDER BY id',
      [req.project.id]
    );
    result.invites = invites.rows;
  }
  res.json(result);
});

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// POST invites — a single-use link that adds whoever accepts it. The raw
// token is returned once, here, and only its hash is kept.
projectSharingRouter.post('/invites', projectAccess('owner'), authLimiter, async (req, res) => {
  const { role } = parse(z.object({ role: z.enum(['viewer', 'editor']) }), req.body);
  await assertCanAddMember(req.project.user_id, req.project.id);
  const token = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const result = await pool.query(
    'INSERT INTO project_invites (project_id, token_hash, role, created_by, expires_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [req.project.id, hashToken(token), role, req.userId, expiresAt]
  );
  res.status(201).json({ id: result.rows[0].id, role, url: `${config.appUrl}/invite/${token}`, expiresAt: expiresAt.toISOString() });
});

projectSharingRouter.delete('/invites/:inviteId', projectAccess('owner'), async (req, res) => {
  const id = idParam(req.params.inviteId);
  if (!id) throw new HttpError(404, 'Invitation not found');
  await pool.query('DELETE FROM project_invites WHERE id = $1 AND project_id = $2', [id, req.project.id]);
  res.status(204).send();
});

projectSharingRouter.patch('/members/:userId', projectAccess('owner'), async (req, res) => {
  const id = idParam(req.params.userId);
  if (!id) throw new HttpError(404, 'Member not found');
  const { role } = parse(z.object({ role: z.enum(['viewer', 'editor']) }), req.body);
  const result = await pool.query(
    'UPDATE project_members SET role = $1 WHERE project_id = $2 AND user_id = $3 RETURNING user_id',
    [role, req.project.id, id]
  );
  if (result.rows.length === 0) throw new HttpError(404, 'Member not found');
  res.json({ ok: true, role });
});

// The owner can remove anyone; a member can remove themselves (leave).
projectSharingRouter.delete('/members/:userId', projectAccess('viewer'), async (req, res) => {
  const id = idParam(req.params.userId);
  if (!id) throw new HttpError(404, 'Member not found');
  if (req.projectRole !== 'owner' && id !== req.userId) {
    throw new HttpError(403, 'Only the project owner can remove other people.', 'FORBIDDEN_ROLE');
  }
  const result = await pool.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 RETURNING user_id', [req.project.id, id]);
  if (result.rows.length === 0) throw new HttpError(404, 'Member not found');
  res.status(204).send();
});

// ── public and invite endpoints, mounted at the API root ────────────────
export const publicSharingRouter = Router();

// What a share link exposes is decided by the link's own switches, checked
// here on every request. Internal ids of people, storage keys and anything
// not switched on are never included.
publicSharingRouter.get('/share/:token', publicLimiter, async (req, res) => {
  const token = req.params.token;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new HttpError(404, 'This link is not valid or has been turned off.');
  const found = await pool.query(
    `SELECT s.include_board, s.include_notes, s.include_brand, s.include_brief, p.id, p.name, p.brief, p.stage
     FROM share_links s JOIN projects p ON p.id = s.project_id WHERE s.token = $1`,
    [token]
  );
  const link = found.rows[0];
  if (!link) throw new HttpError(404, 'This link is not valid or has been turned off.');

  const payload = { project: { name: link.name, stage: link.stage }, includes: {
    board: link.include_board, notes: link.include_notes, brand: link.include_brand, brief: link.include_brief } };

  let brand = null;
  if (link.include_brand) {
    const kit = await pool.query('SELECT data FROM brand_kits WHERE project_id = $1', [link.id]);
    brand = kit.rows[0]?.data || {};
    payload.brand = brand;
  }
  if (link.include_brief) payload.brief = link.brief || {};
  if (link.include_notes) {
    const notes = await pool.query('SELECT content FROM workspace_notes WHERE project_id = $1', [link.id]);
    payload.notes = notes.rows[0]?.content || '';
  }

  const publicItem = (row) => {
    const { project_id, analyzed, ...item } = serializeItem(row); // eslint-disable-line no-unused-vars
    return item;
  };
  if (link.include_board) {
    const [categories, items] = await Promise.all([
      pool.query('SELECT id, name, position FROM categories WHERE project_id = $1 ORDER BY position, id', [link.id]),
      pool.query(`SELECT ${ITEM_COLUMNS} FROM board_items WHERE project_id = $1 ORDER BY position, id`, [link.id]),
    ]);
    payload.categories = categories.rows;
    payload.items = items.rows.map(publicItem);
  } else if (brand) {
    // Brand kit only: send just the board items the kit points at (logos,
    // fonts, example images), not the whole board.
    const ids = [
      ...(brand.logos || []).map((l) => l.itemId),
      ...(brand.typography || []).map((t) => t.itemId),
      ...(brand.imagery?.itemIds || []),
      ...(brand.patterns?.itemIds || []),
      ...(brand.rules || []).map((r) => r.itemId),
    ].filter((id) => Number.isInteger(id));
    const items = ids.length
      ? await pool.query(`SELECT ${ITEM_COLUMNS} FROM board_items WHERE project_id = $1 AND id = ANY($2::int[])`, [link.id, ids])
      : { rows: [] };
    payload.items = items.rows.map(publicItem);
  }

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.json(payload);
});

async function findInvite(token) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const result = await pool.query(
    `SELECT i.id, i.project_id, i.role, p.name AS project_name, p.user_id AS owner_id
     FROM project_invites i JOIN projects p ON p.id = i.project_id
     WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > now()`,
    [hashToken(token)]
  );
  return result.rows[0] || null;
}

// What an invitation is for, before accepting it.
publicSharingRouter.get('/invites/:token', publicLimiter, async (req, res) => {
  const invite = await findInvite(req.params.token);
  if (!invite) throw new HttpError(404, 'This invitation has expired or was already used.');
  res.json({ projectName: invite.project_name, role: invite.role });
});

// Accepting needs a saved account (email on file): membership on an
// anonymous account would vanish with that browser's storage.
publicSharingRouter.post('/invites/:token/accept', requireAuth, authLimiter, async (req, res) => {
  const invite = await findInvite(req.params.token);
  if (!invite) throw new HttpError(404, 'This invitation has expired or was already used.');
  if (!req.user.email) {
    throw new HttpError(403, 'Save your account with an email first, then open the invitation again.', 'CLAIM_REQUIRED');
  }
  if (invite.owner_id === req.userId) return res.json({ projectId: invite.project_id, role: 'owner' });

  // Consume the invitation atomically so two people can't both use it.
  const used = await pool.query('UPDATE project_invites SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id', [invite.id]);
  if (used.rows.length === 0) throw new HttpError(404, 'This invitation has expired or was already used.');
  await pool.query(
    `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [invite.project_id, req.userId, invite.role]
  );
  res.json({ projectId: invite.project_id, role: invite.role });
});

// GET /search?q= — across every project the caller can open: titles,
// notes, tags, file names and links.
publicSharingRouter.get('/search', requireAuth, async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().min(2, 'Type at least two characters').max(100) }), req.query);
  // Escape LIKE wildcards so a search for "100%" means that literally.
  const pattern = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const result = await pool.query(
    `SELECT ${ITEM_COLUMNS.split(',').map((c) => `i.${c.trim()}`).join(', ')}, p.name AS project_name
     FROM board_items i
     JOIN projects p ON p.id = i.project_id
     LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
     WHERE (p.user_id = $1 OR m.user_id IS NOT NULL)
       AND (i.title ILIKE $2 OR i.note ILIKE $2 OR i.file_name ILIKE $2
            OR (i.storage_key IS NULL AND i.media_type <> 'quote' AND i.source_url ILIKE $2)
            OR EXISTS (SELECT 1 FROM unnest(i.tags) t WHERE t ILIKE $2))
     ORDER BY i.created_at DESC LIMIT 60`,
    [req.userId, pattern]
  );
  res.json(result.rows.map((row) => ({ ...serializeItem(row), project_name: row.project_name })));
});
