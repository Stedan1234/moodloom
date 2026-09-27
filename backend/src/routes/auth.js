import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import { signToken, requireAuth } from '../middleware/auth.js';

export const authRouter = Router();

/**
 * POST /auth/anonymous
 * Creates a brand-new anonymous user with no email/password, and returns a token.
 * This is the default entry point: opening the extension or app for the first time
 * with no account should "just work" with zero friction.
 */
authRouter.post('/anonymous', async (req, res) => {
  const result = await pool.query(
    'INSERT INTO users DEFAULT VALUES RETURNING id, anon_token'
  );
  const user = result.rows[0];
  const token = signToken(user.id);
  res.status(201).json({ token, anonToken: user.anon_token });
});

/**
 * POST /auth/claim
 * Attaches an email + password to the CURRENT anonymous account, so it can be
 * recovered later from a different browser/device. Requires an existing valid token.
 */
authRouter.post('/claim', requireAuth, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.query('UPDATE users SET email = $1, password_hash = $2 WHERE id = $3', [
    email,
    passwordHash,
    req.userId,
  ]);
  res.json({ ok: true, email });
});

/**
 * POST /auth/login
 * Recovers an existing account (one that has already been claimed with email/password)
 * from a new browser/device.
 */
authRouter.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const result = await pool.query(
    'SELECT id, password_hash FROM users WHERE email = $1',
    [email]
  );
  const user = result.rows[0];
  if (!user || !user.password_hash) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = signToken(user.id);
  res.json({ token });
});
