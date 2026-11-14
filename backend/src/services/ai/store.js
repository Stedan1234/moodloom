import { pool } from '../../db/pool.js';
import { getEmbedder } from './embedders/index.js';

export async function saveVector(itemId, model, vector) {
  await pool.query(
    `INSERT INTO item_embeddings (item_id, model, vector) VALUES ($1, $2, $3)
     ON CONFLICT (item_id) DO UPDATE SET model = $2, vector = $3, created_at = now()`,
    [itemId, model, Array.from(vector)]
  );
}

/** Map of item id to vector, for the embedder currently in use only. */
export async function loadVectors(itemIds) {
  const embedder = getEmbedder();
  const map = new Map();
  if (!embedder || itemIds.length === 0) return map;
  const result = await pool.query(
    'SELECT item_id, vector FROM item_embeddings WHERE item_id = ANY($1::int[]) AND model = $2',
    [itemIds, embedder.name]
  );
  for (const row of result.rows) map.set(row.item_id, Float32Array.from(row.vector));
  return map;
}

export async function loadProjectVectors(projectId) {
  const embedder = getEmbedder();
  if (!embedder) return [];
  const result = await pool.query(
    `SELECT e.item_id, e.vector, i.category_id, i.tags, i.meta
     FROM item_embeddings e JOIN board_items i ON i.id = e.item_id
     WHERE i.project_id = $1 AND e.model = $2`,
    [projectId, embedder.name]
  );
  return result.rows.map((row) => ({
    id: row.item_id,
    vector: Float32Array.from(row.vector),
    category: row.category_id,
    tags: row.tags || [],
    traits: row.meta?.traits || [],
  }));
}
