// Decides what an uploaded file actually is, from its bytes rather than the
// name or Content-Type the browser sent (both are attacker-controlled), and
// whether Moodloom will hold it.
//
// Three tiers, matching the product rule "hold and reference, don't create":
//   preview  images, video, PDF, fonts: shown in the browser
//   hold     design/source files (.psd, .fig, .blend, …): stored and
//            downloadable, never rendered
//   refuse   anything else, and anything executable
import fs from 'fs/promises';
import path from 'path';
import { fileTypeFromBuffer } from 'file-type';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

const IMAGE = new Set(['png', 'jpg', 'gif', 'webp', 'avif']);
const VIDEO = new Set(['mp4', 'webm', 'mov', 'm4v']);
const FONT = new Set(['ttf', 'otf', 'woff', 'woff2']);

// Source and working files that are held but not previewed.
const HOLD_EXTENSIONS = new Set([
  'ai', 'eps', 'psd', 'psb', 'fig', 'sketch', 'xd', 'indd', 'afdesign', 'afphoto', 'aep', 'prproj',
  'blend', 'glb', 'gltf', 'obj', 'fbx', 'c4d', 'usdz',
  'zip', 'txt', 'md', 'csv', 'json', 'docx', 'pptx', 'xlsx', 'key', 'pages', 'numbers', 'heic', 'tiff', 'tif', 'bmp', 'ico', 'riv', 'lottie',
]);

// Never held, whatever the extension claims.
const REFUSED_DETECTED = new Set(['exe', 'dll', 'msi', 'elf', 'macho', 'dmg', 'deb', 'rpm', 'apk', 'jar', 'class', 'sh', 'bat', 'cmd', 'com', 'scr', 'lnk']);

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4',
  pdf: 'application/pdf',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
};

function looksLikeSvg(head) {
  const start = head.toString('utf8', 0, Math.min(head.length, 2048)).replace(/^﻿/, '').trimStart();
  return /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(start);
}

function looksLikeHtmlOrScript(head) {
  const start = head.toString('utf8', 0, Math.min(head.length, 1024)).trimStart().toLowerCase();
  return start.startsWith('<!doctype html') || start.startsWith('<html') || start.startsWith('<script') || start.startsWith('#!');
}

// The browser sends the file name as latin1 bytes; recover UTF-8, drop any
// path and control characters, cap the length. Used for display only, never
// as a path.
export function cleanFileName(raw) {
  let name = raw || 'file';
  try {
    name = Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    /* keep as sent */
  }
  // eslint-disable-next-line no-control-regex
  name = name.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (name.length > 180) {
    const ext = path.extname(name).slice(0, 12);
    name = name.slice(0, 180 - ext.length) + ext;
  }
  return name || 'file';
}

/**
 * @returns {Promise<{mediaType: 'image'|'video'|'pdf'|'font'|'file', ext: string, mime: string}>}
 * @throws HttpError 415 when the file is not something Moodloom holds, 413 when over the limit for its kind
 */
export async function classifyUpload(tempPath, originalName, size) {
  const handle = await fs.open(tempPath, 'r');
  const head = Buffer.alloc(Math.min(size, 8192));
  try {
    await handle.read(head, 0, head.length, 0);
  } finally {
    await handle.close();
  }

  const detected = await fileTypeFromBuffer(head);
  const nameExt = path.extname(originalName).slice(1).toLowerCase();
  let kind;

  if (nameExt === 'svg' && looksLikeSvg(head) && (!detected || detected.ext === 'xml' || detected.ext === 'svg')) {
    kind = { mediaType: 'image', ext: 'svg', mime: MIME.svg };
  } else if (detected) {
    const ext = detected.ext === 'jpeg' ? 'jpg' : detected.ext;
    if (REFUSED_DETECTED.has(ext)) throw new HttpError(415, 'Programs and installers can’t be added to a board.', 'UNSUPPORTED_FILE');
    if (IMAGE.has(ext)) kind = { mediaType: 'image', ext, mime: MIME[ext] };
    else if (VIDEO.has(ext)) kind = { mediaType: 'video', ext, mime: MIME[ext] };
    else if (ext === 'pdf') kind = { mediaType: 'pdf', ext: 'pdf', mime: MIME.pdf };
    else if (FONT.has(ext)) kind = { mediaType: 'font', ext, mime: MIME[ext] };
    else if (HOLD_EXTENSIONS.has(nameExt)) kind = { mediaType: 'file', ext: nameExt, mime: 'application/octet-stream' };
    // (A PDF-compatible .ai file is detected as PDF above and gets a preview.)
  } else if (HOLD_EXTENSIONS.has(nameExt) && !looksLikeHtmlOrScript(head)) {
    kind = { mediaType: 'file', ext: nameExt, mime: 'application/octet-stream' };
  }

  if (!kind) {
    throw new HttpError(
      415,
      'That file type isn’t supported yet. Images, video (MP4/WebM), PDF, fonts and common design files are.',
      'UNSUPPORTED_FILE'
    );
  }

  const limit =
    kind.mediaType === 'image'
      ? config.limits.imageBytes
      : kind.mediaType === 'video'
        ? config.limits.videoBytes
        : kind.mediaType === 'file'
          ? config.limits.fileBytes
          : config.limits.documentBytes;
  if (size > limit) {
    throw new HttpError(413, `That file is too large (${Math.round(limit / 1048576)}MB max for this type).`, 'FILE_TOO_LARGE');
  }
  return kind;
}

export const maxUploadBytes = Math.max(
  config.limits.imageBytes,
  config.limits.documentBytes,
  config.limits.videoBytes,
  config.limits.fileBytes
);

// File extensions that are safe to show inline when requested directly.
// Everything else under /uploads is sent as a download.
export const INLINE_EXTENSIONS = new Set([...IMAGE, 'svg', ...VIDEO, 'pdf', ...FONT]);
