import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Where uploaded images actually live on disk. Separate from the repo so
// it's never accidentally committed (see .gitignore) and survives independent
// of code deploys.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// The base URL used to build a publicly-fetchable link to an uploaded file
// (stored directly in board_items.source_url / thumbnail_url, same as any
// other captured reference). Configurable because "localhost:3001" is only
// correct for local dev — a real deployment needs its real public origin.
export const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15MB — generous for a screenshot or a saved reference image, not so large it invites abuse

// Only these are accepted — an uploaded "image" is rendered directly in the
// browser and its bytes are trusted to actually be image data, so this is a
// real security boundary (rejecting e.g. .html or .svg-with-script, not just
// a UX nicety). SVG is deliberately excluded: it can carry embedded script.
export const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
