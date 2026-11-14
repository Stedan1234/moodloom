import { z } from 'zod';
import { HttpError } from './errors.js';

// Parses request input against a schema and throws a 400 with a readable
// message on the first problem. Unknown keys are dropped (zod's default for
// objects), so a route only ever sees fields it declared.
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
  throw new HttpError(400, `${where}${issue.message}`, 'VALIDATION');
}

// Positive integer id from a URL segment. A non-numeric id is a 404, the
// same as an id that doesn't exist — never a database type error.
export function idParam(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const n = Number(value);
  return n <= 2147483647 ? n : null;
}

export const text = (max) => z.string().trim().max(max);
export const requiredText = (max, label = 'This field') =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `${label} is too long (max ${max} characters)`);

export const emailSchema = z
  .string({ error: 'email is required' })
  .trim()
  .toLowerCase()
  .max(254, 'email is too long')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Enter a valid email address');

// bcrypt only reads the first 72 bytes of a password. Rather than silently
// ignoring the rest, refuse longer ones when a password is being SET.
export const newPasswordSchema = z
  .string({ error: 'password is required' })
  .min(8, 'Password must be at least 8 characters')
  .refine((p) => Buffer.byteLength(p, 'utf8') <= 72, 'Password is too long (max 72 bytes)');

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a colour like #1a2b3c');

export { z };
