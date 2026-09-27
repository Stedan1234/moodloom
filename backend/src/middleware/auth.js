import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET;
const PLACEHOLDER_SECRET = 'replace-with-a-long-random-string';

// Every token this API issues is only as safe as this secret. Fail loudly
// and immediately (not on the first request) rather than silently signing
// tokens with nothing, or with the literal placeholder from .env.example —
// both would let anyone forge a valid token for any user id.
if (!JWT_SECRET || JWT_SECRET.trim().length === 0) {
  throw new Error(
    'JWT_SECRET is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))" and put it in backend/.env'
  );
}
if (JWT_SECRET === PLACEHOLDER_SECRET) {
  throw new Error(
    'JWT_SECRET is still set to the .env.example placeholder value. Generate a real one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
  );
}
if (process.env.NODE_ENV === 'production' && JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET is too short for production use (need 32+ characters of real entropy).');
}

export function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '90d' });
}

/**
 * Requires a valid Bearer token. Attaches req.userId.
 * Every route that touches projects/board_items/workspace_notes must use this,
 * so one user can never read or write another user's data.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }
  const token = header.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
