import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { pool } from './pool.js';
import { STARTER_CATEGORY_NAMES } from './starterCategories.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  await pool.query(schema);
  await backfillStarterCategories();
  console.log('Migration complete.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
