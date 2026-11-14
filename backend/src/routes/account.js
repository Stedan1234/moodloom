import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../db/pool.js';
import { config } from '../config.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { HttpError } from '../lib/errors.js';
import { parse, z, newPasswordSchema, text } from '../lib/validate.js';
import * as storage from '../lib/storage.js';
import { getUsage, limitsFor } from '../services/plans.js';
import { streamAccountExport } from '../services/exporter.js';
import { embedderStatus } from '../services/ai/embedders/index.js';

export const accountRouter = Router();
accountRouter.use(requireAuth);

// GET /account — who is signed in, their plan, and what they have used.
accountRouter.get('/', async (req, res) => {
  const usage = await getUsage(req.userId);
  const limits = limitsFor(req.user.plan);
  res.json({
    email: req.user.email,
    displayName: req.user.display_name,
    claimed: Boolean(req.user.email),
    plan: req.user.plan,
    planLabel: limits.label,
    limitsEnforced: config.plans.enforce,
    limits,
    usage,
    ai: {
      directionNotes: config.ai.llmProvider !== 'none',
      llmProvider: config.ai.llmProvider,
      embedder: embedderStatus(),
    },
  });
});

// Kept for older clients (the v1 web app and extension call /auth/me).
accountRouter.get('/me', async (req, res) => {
  res.json({ email: req.user.email || null });
});

accountRouter.patch('/', async (req, res) => {
  const { displayName } = parse(z.object({ displayName: text(80).nullable() }), req.body);
  await pool.query('UPDATE users SET display_name = $1 WHERE id = $2', [displayName || null, req.userId]);
  res.json({ ok: true, displayName: displayName || null });
});

async function assertPassword(userId, password) {
  const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  const hash = result.rows[0]?.password_hash;
  if (!hash) return; // an unclaimed account has no password to check
  if (!password || !(await bcrypt.compare(String(password), hash))) {
    throw new HttpError(403, 'That password is not right.', 'BAD_PASSWORD');
  }
}

// POST /account/password — change password; signs out every other session.
accountRouter.post('/password', authLimiter, async (req, res) => {
  const { currentPassword, newPassword } = parse(
    z.object({ currentPassword: z.string().max(1000), newPassword: newPasswordSchema }),
    req.body
  );
  if (!req.user.email) throw new HttpError(400, 'Save your account with an email first.', 'CLAIM_REQUIRED');
  await assertPassword(req.userId, currentPassword);
  const hash = await bcrypt.hash(newPassword, 10);
  const updated = await pool.query(
    'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 RETURNING id, token_version',
    [hash, req.userId]
  );
  res.json({ token: signToken(updated.rows[0]) });
});

// POST /account/logout-all — every token already issued stops working,
// including the extension's. Returns a fresh one for this browser.
accountRouter.post('/logout-all', async (req, res) => {
  const updated = await pool.query(
    'UPDATE users SET token_version = token_version + 1 WHERE id = $1 RETURNING id, token_version',
    [req.userId]
  );
  await pool.query('DELETE FROM pairing_codes WHERE user_id = $1', [req.userId]);
  res.json({ token: signToken(updated.rows[0]) });
});

// GET /account/export — everything the account owns, as one ZIP.
accountRouter.get('/export', async (req, res) => {
  await streamAccountExport(req.userId, res);
});

// DELETE /account — permanent. Removes the account, every project it owns,
// and the stored files behind them.
accountRouter.delete('/', authLimiter, async (req, res) => {
  const { password, confirm } = parse(z.object({ password: z.string().max(1000).optional(), confirm: z.string().optional() }), req.body);
  if (confirm !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm.', 'CONFIRM_REQUIRED');
  await assertPassword(req.userId, password);

  const keys = await withTransaction(async (client) => {
    const files = await client.query(
      `SELECT i.storage_key, i.thumb_key FROM board_items i JOIN projects p ON p.id = i.project_id
       WHERE p.user_id = $1 AND i.storage_key IS NOT NULL`,
      [req.userId]
    );
    await client.query('DELETE FROM users WHERE id = $1', [req.userId]);
    return files.rows.flatMap((r) => [r.storage_key, r.thumb_key]);
  });
  await storage.removeMany(keys);
  res.status(204).send();
});
