import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { authLimiter, pairLimiter } from '../middleware/rateLimit.js';

export const authRouter = Router();

/**
 * POST /auth/anonymous
 * Creates a brand-new anonymous user with no email/password, and returns a token.
 * This is the default entry point: opening the extension or app for the first time
 * with no account should "just work" with zero friction.
 */
authRouter.post('/anonymous', authLimiter, async (req, res) => {
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
authRouter.post('/claim', requireAuth, authLimiter, async (req, res) => {
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
 * GET /auth/me
 * Tells the caller whether the CURRENT account has been claimed (has an
 * email on file) or is still a bare anonymous account. Used by the web app
 * to decide whether to show the "back up your account" prompt — an
 * anonymous account has no recovery path at all if its token is ever lost
 * (browser storage cleared, JWT_SECRET rotated, etc.), so this is a real
 * data-loss risk, not just a nice-to-have reminder.
 */
authRouter.get('/me', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT email FROM users WHERE id = $1', [req.userId]);
  res.json({ email: result.rows[0]?.email || null });
});

/**
 * POST /auth/login
 * Recovers an existing account (one that has already been claimed with email/password)
 * from a new browser/device.
 */
authRouter.post('/login', authLimiter, async (req, res) => {
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

// Unambiguous alphabet (no 0/O, 1/I/L) so a human can read a code aloud or
// type it without second-guessing a character. 8 chars from a 32-char
// alphabet is ~1.1e12 possible codes, combined with a 5-minute expiry and
// one-time redemption (deleted the moment it's used) — brute-forcing this
// within its lifetime is not practically feasible.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;
const CODE_TTL_MS = 5 * 60 * 1000;

function generateCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/**
 * POST /auth/pairing-code
 * Called by the WEB APP (already authenticated) to generate a short-lived,
 * one-time code the browser extension can redeem to log into this same
 * account. This is the fix for a real gap: without it, the extension and web
 * app silently create two separate anonymous accounts and never see each
 * other's data.
 */
authRouter.post('/pairing-code', requireAuth, authLimiter, async (req, res) => {
  // Clear out this user's old unused codes first so there's never more than
  // one live code per account lying around.
  await pool.query(
    'DELETE FROM pairing_codes WHERE user_id = $1',
    [req.userId]
  );

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await pool.query(
    'INSERT INTO pairing_codes (code, user_id, expires_at) VALUES ($1, $2, $3)',
    [code, req.userId, expiresAt]
  );

  res.status(201).json({ code, expiresAt: expiresAt.toISOString() });
});

/**
 * POST /auth/pair
 * Called by the EXTENSION (no token yet) to redeem a pairing code generated
 * by the web app, and get back a token for that SAME account. One-time use:
 * the code is deleted the moment it's redeemed, whether or not it succeeds
 * against an expired row, so it can't be replayed.
 */
authRouter.post('/pair', pairLimiter, async (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'code is required' });
  }

  const normalized = code.trim().toUpperCase();

  const result = await pool.query(
    'DELETE FROM pairing_codes WHERE code = $1 AND expires_at > now() RETURNING user_id',
    [normalized]
  );

  if (result.rows.length === 0) {
    return res.status(400).json({ error: 'That code is invalid or has expired. Generate a new one from the web app.' });
  }

  const token = signToken(result.rows[0].user_id);
  res.json({ token });
});
