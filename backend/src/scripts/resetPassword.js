// Founder/admin escape hatch: set a new password for an account directly in
// the database, and sign that account out everywhere.
// Usage:  npm run reset-password -- you@example.com NewPassword123
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';

const [email, newPassword] = process.argv.slice(2);
if (!email || !newPassword) {
  console.error('Usage: npm run reset-password -- <email> <new-password>');
  process.exit(1);
}
if (newPassword.length < 8 || Buffer.byteLength(newPassword, 'utf8') > 72) {
  console.error('Password must be 8 to 72 characters.');
  process.exit(1);
}

const hash = await bcrypt.hash(newPassword, 10);
const result = await pool.query(
  'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE email = $2 RETURNING id',
  [hash, email.trim().toLowerCase()]
);
if (result.rowCount === 0) {
  console.error(`No account found with email ${email}.`);
  await pool.end();
  process.exit(1);
}
await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [result.rows[0].id]);
console.log(`Password updated for ${email}. You can log in now.`);
await pool.end();
