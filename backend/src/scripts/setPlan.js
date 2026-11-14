// Set an account's plan by hand (until a payment provider is wired up).
// Usage:  npm run set-plan -- you@example.com pro
import { pool } from '../db/pool.js';
import { PLANS } from '../services/plans.js';

const [email, plan] = process.argv.slice(2);
if (!email || !PLANS[plan]) {
  console.error(`Usage: npm run set-plan -- <email> <${Object.keys(PLANS).join('|')}>`);
  process.exit(1);
}
const result = await pool.query('UPDATE users SET plan = $1 WHERE email = $2 RETURNING id', [plan, email.trim().toLowerCase()]);
if (result.rowCount === 0) {
  console.error(`No account found with email ${email}.`);
  await pool.end();
  process.exit(1);
}
console.log(`${email} is now on the ${PLANS[plan].label} plan.`);
await pool.end();
