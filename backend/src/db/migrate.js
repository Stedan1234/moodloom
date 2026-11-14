import { readFileSync, statSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import { pool } from './pool.js';
import { config } from '../config.js';
import { STARTER_CATEGORY_NAMES } from './starterCategories.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The unique index on (project_id, source_url) can only be created if the
// data is already unique. A database that captured the same URL twice before
// the duplicate guard existed would fail the whole migration, so remove
// those first (keeping the oldest). A no-op once there are none.
async function dedupeBoardItemsBeforeUniqueIndex(log) {
  const tableExists = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_name = 'board_items' AND table_schema = current_schema()"
  );
  if (tableExists.rows.length === 0) return;

  const result = await pool.query(`
    DELETE FROM board_items a
    USING board_items b
    WHERE a.id > b.id
      AND a.project_id = b.project_id
      AND a.source_url = b.source_url
  `);
  if (result.rowCount > 0) {
    log(`Removed ${result.rowCount} duplicate board item(s) so the unique index could be created.`);
  }
}

// Projects created before categories existed never got the starter set.
async function backfillStarterCategories(log) {
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
  if (projects.rows.length > 0) log(`Seeded starter categories for ${projects.rows.length} existing project(s).`);
}

// Emails are compared case-insensitively from now on by always storing them
// lowercase. Lowercase any older mixed-case rows, skipping the (unlikely)
// case where that would collide with another account.
async function normalizeEmails(log) {
  const result = await pool.query(`
    UPDATE users u SET email = lower(u.email)
    WHERE u.email IS NOT NULL AND u.email <> lower(u.email)
      AND NOT EXISTS (SELECT 1 FROM users o WHERE o.id <> u.id AND o.email = lower(u.email))
  `);
  if (result.rowCount > 0) log(`Lowercased ${result.rowCount} stored email address(es).`);
}

// v1 stored an upload only as an absolute URL (PUBLIC_BASE_URL/uploads/<file>).
// Uploads are now identified by storage_key, with the URL derived on the way
// out. Fill storage_key (and size) for those older rows. Only URLs under OUR
// uploads path are touched: plenty of ordinary captured references contain
// "/uploads/" too (every WordPress site), and those must stay remote.
async function backfillStorageKeys(log) {
  const rows = await pool.query(
    `SELECT id, source_url FROM board_items
     WHERE storage_key IS NULL AND source_url ~ '^https?://[^/]+/uploads/[A-Za-z0-9-]+\\.(png|jpg|jpeg|gif|webp)$'`
  );
  let filled = 0;
  for (const row of rows.rows) {
    const key = row.source_url.slice(row.source_url.lastIndexOf('/') + 1);
    let size = null;
    try {
      size = statSync(path.join(config.uploadsDir, key)).size;
    } catch {
      continue; // not a file we hold, so it is someone else's URL after all
    }
    const ext = key.split('.').pop();
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    await pool.query(
      'UPDATE board_items SET storage_key = $1, file_size = $2, mime_type = $3 WHERE id = $4',
      [key, size, mime, row.id]
    );
    filled++;
  }
  if (filled > 0) log(`Linked ${filled} earlier upload(s) to their stored files.`);
}

export async function runMigrations({ log = console.log } = {}) {
  const schema = readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await dedupeBoardItemsBeforeUniqueIndex(log);
  await pool.query(schema);
  await backfillStarterCategories(log);
  await normalizeEmails(log);
  await backfillStorageKeys(log);
}

// Run directly: `npm run migrate`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('Running migration...');
  runMigrations()
    .then(async () => {
      console.log('Migration complete.');
      await pool.end();
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
