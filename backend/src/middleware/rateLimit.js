import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

// Throttling is by client IP for anything reachable without a token (those
// endpoints have no other identity to key on) and by account for expensive
// signed-in actions. RATE_LIMIT_DISABLED exists for the automated tests,
// which make hundreds of requests from one address; it must never be set on
// a real deployment.
function limiter({ windowMs, limit, message, keyGenerator }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => config.rateLimitDisabled,
    message: { error: message, code: 'RATE_LIMITED' },
    ...(keyGenerator ? { keyGenerator } : {}),
  });
}

const MIN = 60 * 1000;
const byUser = (req) => `user:${req.userId}`;

// Account creation, login, claiming, pairing-code generation.
export const authLimiter = limiter({
  windowMs: 15 * MIN,
  limit: 20,
  message: 'Too many requests. Please wait a few minutes and try again.',
});

// Redeeming a pairing code: the endpoint a guessed code would be tried against.
export const pairLimiter = limiter({
  windowMs: 5 * MIN,
  limit: 10,
  message: 'Too many pairing attempts. Please wait a few minutes and try again.',
});

// Each forgot-password request can send an email.
export const resetLimiter = limiter({
  windowMs: 15 * MIN,
  limit: 5,
  message: 'Too many reset attempts. Please wait a few minutes and try again.',
});

// Unauthenticated read endpoints (share links, invite previews): generous
// for a real visitor, tight enough to make guessing tokens pointless.
export const publicLimiter = limiter({
  windowMs: 15 * MIN,
  limit: 120,
  message: 'Too many requests. Please wait a few minutes and try again.',
});

// A ceiling on everything else, so one client can't monopolise the API.
export const apiLimiter = limiter({
  windowMs: 5 * MIN,
  limit: 1500,
  message: 'You are going a little fast. Give it a minute.',
});

export const uploadLimiter = limiter({
  windowMs: 10 * MIN,
  limit: 120,
  keyGenerator: byUser,
  message: 'That is a lot of uploads at once. Give it a few minutes.',
});

// Calls that cost money (a language model) or real CPU (clustering).
export const aiLimiter = limiter({
  windowMs: 60 * MIN,
  limit: 30,
  keyGenerator: byUser,
  message: 'AI features are limited to 30 runs an hour. Try again shortly.',
});
