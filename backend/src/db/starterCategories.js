// Shared between project creation (routes/projects.js) and the one-time
// backfill for projects that existed before categories did (db/migrate.js) —
// kept in one place so the two never drift apart.
export const STARTER_CATEGORY_NAMES = [
  'Design Inspiration',
  'Post & Content Ideas',
  'Video Direction',
  'Color & Brand',
];
