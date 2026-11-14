import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { authLimiter, pairLimiter, resetLimiter } from '../middleware/rateLimit.js';
import { sendMail } from '../services/mailer.js';
import { HttpError } from '../lib/errors.js';
import { parse, z, emailSchema, newPasswordSchema } from '../lib/validate.js';

export const authRouter = Router();

// Compared against when a login names an email that has no account, so the
// request takes the same time either way and response timing can't be used
// to discover which emails are registered. (A bcrypt hash of a random
// string nobody knows.)
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * POST /auth/anonymous
 * Creates a brand-new anonymous account and returns its token. This is the
 * zero-friction entry point: opening the app for the first time works
 * without signing up.
 */
authRouter.post('/anonymous', authLimiter, async (req, res) => {
  const result = await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id, token_version');
  res.status(201).json({ token: signToken(result.rows[0]) });
});

/**
 * POST /auth/claim
 * Attaches an email + password to the CURRENT anonymous account so it can be
 * recovered from another browser or device.
 */
authRouter.post('/claim', requireAuth, authLimiter, async (req, res) => {
  const { email, password } = parse(z.object({ email: emailSchema, password: newPasswordSchema }), req.body);
  if (req.user.email) throw new HttpError(409, 'This account already has an email on file.', 'ALREADY_CLAIMED');

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await pool.query('UPDATE users SET email = $1, password_hash = $2 WHERE id = $3', [email, passwordHash, req.userId]);
  } catch (err) {
    if (err.code === '23505') throw new HttpError(409, 'An account with this email already exists', 'EMAIL_TAKEN');
    throw err;
  }
  res.json({ ok: true, email });
});

/**
 * POST /auth/login
 * Signs in to an account that has been claimed with email + password.
 */
authRouter.post('/login', authLimiter, async (req, res) => {
  const { email, password } = parse(
    z.object({ email: emailSchema, password: z.string({ error: 'password is required' }).min(1, 'password is required').max(1000) }),
    req.body
  );
  const result = await pool.query('SELECT id, password_hash, token_version FROM users WHERE email = $1', [email]);
  const user = result.rows[0];
  const valid = await bcrypt.compare(password, user?.password_hash || DUMMY_HASH);
  if (!user || !user.password_hash || !valid) {
    throw new HttpError(401, 'Invalid email or password', 'BAD_CREDENTIALS');
  }
  res.json({ token: signToken(user) });
});

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * POST /auth/forgot-password
 * Emails a single-use reset link. Always answers the same way whether or not
 * the email has an account.
 */
authRouter.post('/forgot-password', resetLimiter, async (req, res) => {
  const { email } = parse(z.object({ email: emailSchema }), req.body);

  const result = await pool.query('SELECT id FROM users WHERE email = $1 AND password_hash IS NOT NULL', [email]);
  const user = result.rows[0];
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);
    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, hashToken(token), new Date(Date.now() + RESET_TTL_MS)]
    );
    try {
      await sendMail({
        to: email,
        subject: 'Reset your Moodloom password',
        text:
          `Someone asked to reset the password for this Moodloom account.\n\n` +
          `Open this link to choose a new password (valid for 1 hour, one use):\n` +
          `${config.appUrl}/reset?token=${token}\n\n` +
          `If that wasn't you, ignore this email and your password stays the same.`,
      });
    } catch (err) {
      // Don't leak delivery failures to the caller (it would reveal the account exists).
      console.error('Failed to send reset email:', err.message);
    }
  }
  res.json({ ok: true, message: 'If an account exists for that email, a reset link is on its way.' });
});

/**
 * POST /auth/reset-password
 * Redeems a reset token and sets a new password. The token is consumed
 * atomically so it can't be used twice, and every session the account had
 * is signed out.
 */
authRouter.post('/reset-password', resetLimiter, async (req, res) => {
  const { token, password } = parse(
    z.object({ token: z.string({ error: 'token is required' }).min(1).max(200), password: newPasswordSchema }),
    req.body
  );
  const consumed = await pool.query(
    `UPDATE password_reset_tokens SET used_at = now()
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [hashToken(token)]
  );
  if (consumed.rows.length === 0) {
    throw new HttpError(400, 'This reset link is invalid or has expired. Request a new one.', 'BAD_RESET_TOKEN');
  }
  const userId = consumed.rows[0].user_id;
  const passwordHash = await bcrypt.hash(password, 10);
  const updated = await pool.query(
    'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 RETURNING id, token_version',
    [passwordHash, userId]
  );
  await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
  res.json({ token: signToken(updated.rows[0]) });
});

// Unambiguous alphabet (no 0/O, 1/I/L) so a code can be read aloud or typed
// without second-guessing a character.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;
const CODE_TTL_MS = 5 * 60 * 1000;

function generateCode() {
  let code = '';
  // randomInt is uniform; taking bytes modulo the alphabet size would favour
  // the first few characters slightly.
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return code;
}

/**
 * POST /auth/pairing-code
 * Called by the signed-in web app: a short-lived, one-time code the browser
 * extension redeems to join this same account.
 */
authRouter.post('/pairing-code', requireAuth, authLimiter, async (req, res) => {
  await pool.query('DELETE FROM pairing_codes WHERE user_id = $1 OR expires_at < now()', [req.userId]);
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await pool.query('INSERT INTO pairing_codes (code, user_id, expires_at) VALUES ($1, $2, $3)', [code, req.userId, expiresAt]);
  res.status(201).json({ code, expiresAt: expiresAt.toISOString() });
});

/**
 * POST /auth/pair
 * Called by the extension (no token yet) to redeem a pairing code. One use:
 * the code is deleted the moment it is redeemed.
 */
authRouter.post('/pair', pairLimiter, async (req, res) => {
  const { code } = parse(z.object({ code: z.string({ error: 'code is required' }).trim().min(1, 'code is required').max(32) }), req.body);
  const result = await pool.query(
    'DELETE FROM pairing_codes WHERE code = $1 AND expires_at > now() RETURNING user_id',
    [code.toUpperCase()]
  );
  if (result.rows.length === 0) {
    throw new HttpError(400, 'That code is invalid or has expired. Generate a new one from the web app.', 'BAD_PAIRING_CODE');
  }
  const user = await pool.query('SELECT id, token_version FROM users WHERE id = $1', [result.rows[0].user_id]);
  res.json({ token: signToken(user.rows[0]) });
});
