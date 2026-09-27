import rateLimit from 'express-rate-limit';

// Auth endpoints are the highest-value target for abuse (account creation
// spam, credential stuffing, and — since the pairing fix — brute-forcing a
// pairing code). None of them are behind requireAuth (they can't be, that's
// the point), so throttling by IP is the main defense available here.

// /auth/anonymous and /auth/login: generous enough for normal use, tight
// enough to blunt scripted abuse.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

// /auth/pair: this is the one that matters most. A pairing code is 8 chars
// from a 32-char alphabet (~1.1e12 combinations) with a 5-minute expiry, which
// is already unguessable at any plausible unthrottled rate — but "unthrottled"
// is the operative word, so cap attempts hard per IP regardless.
export const pairLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // matches the code's own expiry window
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many pairing attempts. Please wait a few minutes and try again.' },
});
