// Where uploaded bytes live. One small interface (save / read / remove /
// path) so the rest of the code never builds a filesystem path from anything
// user-influenced, and so a different backend (S3-compatible object storage)
// can replace this file later without touching the routes.
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config.js';

// Keys are always generated here: a UUID, an optional ".thumb", and an
// extension from a fixed set. Anything else is refused before it gets near
// the filesystem, including a key read back from the database.
const KEY_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(\.thumb)?\.[a-z0-9]{2,5}$/;

export function isValidKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key);
}

export function newKey(ext, { thumbOf = null } = {}) {
  const cleanExt = String(ext).replace(/^\./, '').toLowerCase();
  if (!/^[a-z0-9]{2,5}$/.test(cleanExt)) throw new Error(`Bad extension: ${ext}`);
  if (thumbOf) return `${thumbOf.split('.')[0]}.thumb.${cleanExt}`;
  return `${crypto.randomUUID()}.${cleanExt}`;
}

export function filePath(key) {
  if (!isValidKey(key)) throw new Error('Invalid storage key');
  return path.join(config.uploadsDir, key);
}

export function publicUrl(key) {
  return `${config.publicBaseUrl}/uploads/${key}`;
}

export async function save(key, buffer) {
  await fsp.writeFile(filePath(key), buffer);
}

export async function read(key) {
  return fsp.readFile(filePath(key));
}

export function readStream(key) {
  return fs.createReadStream(filePath(key));
}

export async function exists(key) {
  if (!isValidKey(key)) return false;
  try {
    await fsp.access(filePath(key));
    return true;
  } catch {
    return false;
  }
}

// Best effort: a file that is already gone is not an error.
export async function remove(key) {
  if (!isValidKey(key)) return;
  try {
    await fsp.unlink(filePath(key));
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Could not delete stored file ${key}: ${err.message}`);
  }
}

export async function removeMany(keys) {
  await Promise.all(keys.filter(Boolean).map((key) => remove(key)));
}
