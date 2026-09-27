import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { pool } from './pool.js';
import { STARTER_CATEGORY_NAMES } from './starterCategories.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The unique index on (project_id, source_url) — added for the duplicate-
// capture guard — can only be created if the data is actually already
// unique. On a database where the SAME url got captured twice into the
// same project before that guard existed (e.g. during earlier manual
// testing, clicking "Add to board" twice), the index creation in schema.sql
// fails outright with a duplicate-key error, and the whole migration aborts
// before anything after it (including the categories feature) ever runs.
// This runs first and keeps the oldest row per duplicate (project_id,
// source_url) pair, deleting the rest — so the index can always be created.
// Safe to run every time: it's a no-op once there are no duplicates left.
async function dedupeBoardItemsBeforeUniqueIndex() {
  const tableExists = await pool.query(`
    SELECT 1 FROM information_schema.tables WHERE table_name = 'board_items'
  `);
  if (tableExists.rows.length === 0) return; // fresh install — nothing to clean up yet

  const result = await pool.query(`
    DELETE FROM board_items a
    USING board_items b
    WHERE a.id > b.id
      AND a.project_id = b.project_id
      AND a.source_url = b.source_url
  `);
  if (result.rowCount > 0) {
    console.log(
      `Removed ${result.rowCount} duplicate board item(s) (same URL captured twice into the same project before the duplicate-capture guard existed) so the unique index could be created.`
    );
  }
}

// New projects get the starter set at creation time (routes/projects.js).
// Projects that already existed before categories were introduced never got
// that — this backfills any project with zero categories so it isn't stuck
// permanently uncategorized just for having been created earlier.
async function backfillStarterCategories() {
  const projects = await pool.query(`
    SELECT p.id FROM projects p
    LEFT JOIN categories c ON c.project_id = p.id
    GROUP BY p.id
    HAVING COUNT(c.id) = 0
  `);
  for (const project of projects.rows) {
    for (let i = 0; i < STARTER_CATEGORY_NAMES.length; i++) {
      await pool.query('INSERT INTO categories (project_id, name, position) VALUES ($1, $2, $3)', [
        project.id,
        STARTER_CATEGORY_NAMES[i],
        i,
      ]);
    }
  }
  if (projects.rows.length > 0) {
    console.log(`Seeded starter categories for ${projects.rows.length} existing project(s).`);
  }
}

async function migrate() {
  const schema = readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  console.log('Running migration...');
  await dedupeBoardItemsBeforeUniqueIndex();
  await pool.query(schema);
  await backfillStarterCategories();
  console.log('Migration complete.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
