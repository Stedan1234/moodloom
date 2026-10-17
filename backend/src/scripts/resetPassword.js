// Founder/admin escape hatch: set a new password for an account directly in
// the database. Usage:  npm run reset-password -- you@example.com NewPassword123
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
dotenv.config();
const { pool } = await import('../db/pool.js');

const [email, newPassword] = process.argv.slice(2);
if (!email || !newPassword) {
  console.error('Usage: npm run reset-password -- <email> <new-password>');
  process.exit(1);
}
if (newPassword.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const hash = await bcrypt.hash(newPassword, 10);
const result = await pool.query(
  'UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id',
  [hash, email.trim()]
);
if (result.rowCount === 0) {
  console.error(`No account found with email ${email}.`);
  await pool.end();
  process.exit(1);
}
await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [result.rows[0].id]);
console.log(`Password updated for ${email}. You can log in now.`);
await pool.end();
