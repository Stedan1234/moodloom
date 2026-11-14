import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  // Hosted Postgres (Render, Neon, Supabase) requires TLS; local doesn't offer it.
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

pool.on('error', (err) => {
  // An idle client dropping (database restart, network blip) should not take
  // the whole API down; pg replaces the client on the next query.
  console.error('Unexpected error on idle database client:', err.message);
});

// Runs fn inside a transaction, rolling back on any throw.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
