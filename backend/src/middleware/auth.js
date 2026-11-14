import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { pool } from '../db/pool.js';

// Tokens are HS256 JWTs carrying the user id and the account's
// token_version at signing time. The algorithm is pinned on verify so a
// token can't downgrade it, and the version is compared against the
// database on every request so "sign out everywhere", a password change or
// a password reset really does kill tokens that are already out there.
export function signToken(user) {
  return jwt.sign({ userId: user.id, tv: user.token_version ?? 0 }, config.jwtSecret, {
    expiresIn: config.tokenTtl,
    algorithm: 'HS256',
  });
}

async function userFromRequest(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return { error: 'Missing or malformed Authorization header' };
  let payload;
  try {
    payload = jwt.verify(header.slice('Bearer '.length), config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return { error: 'Invalid or expired token' };
  }
  if (!Number.isInteger(payload.userId)) return { error: 'Invalid or expired token' };

  const result = await pool.query(
    'SELECT id, email, plan, token_version, display_name FROM users WHERE id = $1',
    [payload.userId]
  );
  const user = result.rows[0];
  // Tokens issued before versions existed carry no `tv`; they stay valid
  // until the account's version first moves off zero.
  if (!user || user.token_version !== (payload.tv ?? 0)) return { error: 'Invalid or expired token' };
  return { user };
}

/**
 * Requires a valid Bearer token. Attaches req.userId and req.user.
 * Every route that touches someone's data goes through this first.
 */
export async function requireAuth(req, res, next) {
  const { user, error } = await userFromRequest(req);
  if (!user) return res.status(401).json({ error });
  req.userId = user.id;
  req.user = user;
  next();
}
