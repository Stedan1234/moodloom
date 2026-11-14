// The shapes the API sends out. Rows never go to the client as-is: internal
// columns (storage keys, raw embed HTML) stay internal, and upload URLs are
// built here from the storage key so stored data doesn't hard-code a domain.
import { publicUrl } from '../lib/storage.js';
import { videoMetaFor } from './mediaDetector.js';

export const ITEM_COLUMNS = `id, project_id, source_url, media_type, title, note, tags, thumbnail_url, width, height,
  palette, meta, storage_key, thumb_key, file_name, file_size, mime_type, position, category_id, analyzed_at, created_at`;

export function serializeItem(row) {
  const isUpload = Boolean(row.storage_key);
  let meta = row.meta || {};
  if (row.media_type === 'video' && !meta.provider) {
    meta = { ...meta, ...(isUpload ? { provider: 'file' } : videoMetaFor(row.source_url)) };
  }
  return {
    id: row.id,
    project_id: row.project_id,
    media_type: row.media_type,
    title: row.title,
    note: row.note,
    tags: row.tags || [],
    // For an upload this is the file itself; for a capture, the original page.
    source_url: isUpload ? publicUrl(row.storage_key) : row.media_type === 'quote' ? null : row.source_url,
    thumbnail_url: row.thumb_key
      ? publicUrl(row.thumb_key)
      : isUpload && row.media_type === 'image'
        ? publicUrl(row.storage_key)
        : isUpload
          ? null
          : row.thumbnail_url,
    width: row.width,
    height: row.height,
    palette: row.palette,
    meta,
    is_upload: isUpload,
    file_name: row.file_name,
    file_size: row.file_size === null || row.file_size === undefined ? null : Number(row.file_size),
    mime_type: row.mime_type,
    position: row.position,
    category_id: row.category_id,
    analyzed: Boolean(row.analyzed_at),
    created_at: row.created_at,
  };
}

export function serializeProject(row, role) {
  return {
    id: row.id,
    name: row.name,
    brief: row.brief || {},
    stage: row.stage,
    ai_enabled: row.ai_enabled,
    role: role || row.role,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
