// "Download your whole project": every reference, note and file as one ZIP
// that makes sense without Moodloom. This is the data-ownership promise:
// the app is cloud-based, and nothing in it is trapped there.
//
// Layout inside the archive (one folder per project):
//   README.txt             what each file is
//   project.json           name, brief, stage, categories
//   references.json        every board item with its note, tags and palette
//   references.md          the same, readable, with links
//   notes.html             the workspace notes
//   brand-kit.json         the brand kit, if started
//   sketch.excalidraw      the sketch canvas (opens at excalidraw.com)
//   direction-notes.md     AI direction notes, with what they were based on
//   files/                 the uploaded files themselves
import { ZipArchive } from 'archiver';
import { pool } from '../db/pool.js';
import * as storage from '../lib/storage.js';
import { ITEM_COLUMNS, serializeItem } from './serialize.js';

function safeName(name, fallback = 'project') {
  // eslint-disable-next-line no-control-regex
  const cleaned = String(name || '').replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return cleaned.replace(/^\.+/, '') || fallback;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

const README = `This folder is an export of a Moodloom project.

project.json        the project's name, brief, stage and categories
references.json     every reference on the board (data)
references.md       the same list, readable, with links
notes.html          the workspace notes (open in any browser)
brand-kit.json      the brand kit, if one was started
sketch.excalidraw   the sketch canvas; open it at https://excalidraw.com
direction-notes.md  AI-written direction notes, if any, with their sources
files/              files that were uploaded to the board

References captured from the web are listed by link; only files that were
uploaded to Moodloom are included as files.
`;

async function addProject(archive, projectId, folder) {
  const [project, categories, items, notes, brand, canvas, directions] = await Promise.all([
    pool.query('SELECT id, name, brief, stage, created_at, updated_at FROM projects WHERE id = $1', [projectId]),
    pool.query('SELECT id, name, position FROM categories WHERE project_id = $1 ORDER BY position, id', [projectId]),
    pool.query(`SELECT ${ITEM_COLUMNS} FROM board_items WHERE project_id = $1 ORDER BY position, id`, [projectId]),
    pool.query('SELECT content FROM workspace_notes WHERE project_id = $1', [projectId]),
    pool.query('SELECT data FROM brand_kits WHERE project_id = $1', [projectId]),
    pool.query('SELECT scene FROM canvases WHERE project_id = $1', [projectId]),
    pool.query(
      'SELECT content, model, prompt_version, source_item_ids, created_at FROM direction_notes WHERE project_id = $1 ORDER BY created_at',
      [projectId]
    ),
  ]);
  const p = project.rows[0];
  if (!p) return;
  const categoryName = new Map(categories.rows.map((c) => [c.id, c.name]));
  const add = (name, content) => archive.append(content, { name: `${folder}/${name}` });

  add('README.txt', README);
  add('project.json', JSON.stringify({ ...p, categories: categories.rows }, null, 2));

  const usedNames = new Set();
  const exported = [];
  const lines = [`# ${p.name}: references`, ''];
  for (const row of items.rows) {
    const item = serializeItem(row);
    let file = null;
    if (row.storage_key && (await storage.exists(row.storage_key))) {
      const ext = row.storage_key.split('.').pop();
      let base = safeName((row.file_name || '').replace(/\.[^.]+$/, ''), `reference-${row.id}`);
      let candidate = `${base}.${ext}`;
      for (let n = 2; usedNames.has(candidate.toLowerCase()); n++) candidate = `${base}-${n}.${ext}`;
      usedNames.add(candidate.toLowerCase());
      file = `files/${candidate}`;
      archive.append(storage.readStream(row.storage_key), { name: `${folder}/${file}` });
    }
    exported.push({
      id: item.id,
      kind: item.media_type,
      title: item.title,
      note: item.note,
      tags: item.tags,
      category: categoryName.get(item.category_id) || null,
      link: item.is_upload ? null : item.source_url,
      file,
      palette: item.palette,
      added: item.created_at,
    });
    const heading = item.title || (item.media_type === 'quote' ? 'Quote' : item.file_name || item.source_url || `Reference ${item.id}`);
    lines.push(`## ${heading}`);
    lines.push(`- Kind: ${item.media_type}${categoryName.get(item.category_id) ? ` · ${categoryName.get(item.category_id)}` : ''}`);
    if (!item.is_upload && item.source_url) lines.push(`- Link: ${item.source_url}`);
    if (file) lines.push(`- File: ${file}`);
    if (item.tags.length) lines.push(`- Tags: ${item.tags.join(', ')}`);
    if (item.palette?.length) lines.push(`- Palette: ${item.palette.map((s) => `${s.hex} (${s.name})`).join(', ')}`);
    if (item.note) lines.push('', item.note);
    lines.push('');
  }
  add('references.json', JSON.stringify(exported, null, 2));
  add('references.md', lines.join('\n'));

  const html = notes.rows[0]?.content || '';
  add(
    'notes.html',
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(p.name)}: notes</title>` +
      `<style>body{font:16px/1.6 Georgia,serif;max-width:42rem;margin:3rem auto;padding:0 1rem}</style></head><body>` +
      `${/^\s*</.test(html) ? html : `<p>${escapeHtml(html).replace(/\n/g, '</p><p>')}</p>`}</body></html>`
  );

  if (brand.rows[0]) add('brand-kit.json', JSON.stringify(brand.rows[0].data, null, 2));
  if (canvas.rows[0]) add('sketch.excalidraw', canvas.rows[0].scene);

  if (directions.rows.length) {
    const md = [`# ${p.name}: direction notes`, ''];
    for (const d of directions.rows) {
      const c = d.content;
      md.push(`## ${new Date(d.created_at).toISOString().slice(0, 10)}`, '', c.statement || '', '');
      for (const theme of c.themes || []) md.push(`### ${theme.name}`, theme.description, `Based on references: ${(theme.evidence || []).join(', ') || 'none cited'}`, '');
      if (c.typography) md.push(`**Type:** ${c.typography}`, '');
      if (c.imagery) md.push(`**Imagery:** ${c.imagery}`, '');
      for (const [label, key] of [['Avoid', 'avoid'], ['Tensions', 'tensions'], ['Gaps', 'gaps'], ['Next steps', 'next_steps']]) {
        if (c[key]?.length) md.push(`**${label}:**`, ...c[key].map((x) => `- ${x}`), '');
      }
      md.push(`_Written by ${d.model} (${d.prompt_version}) from reference ids ${d.source_item_ids.join(', ')}._`, '');
    }
    add('direction-notes.md', md.join('\n'));
  }
}

function startZip(res, fileName) {
  const ascii = safeName(fileName, 'moodloom-export').replace(/[^\x20-\x7e]/g, '_');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${ascii}.zip"; filename*=UTF-8''${encodeURIComponent(safeName(fileName))}.zip`);
  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on('error', (err) => {
    console.error('Export failed:', err.message);
    res.destroy(err);
  });
  archive.pipe(res);
  return archive;
}

export async function streamProjectExport(project, res) {
  const archive = startZip(res, `${project.name} (Moodloom)`);
  await addProject(archive, project.id, safeName(project.name));
  await archive.finalize();
}

export async function streamAccountExport(userId, res) {
  const projects = await pool.query('SELECT id, name FROM projects WHERE user_id = $1 ORDER BY id', [userId]);
  const archive = startZip(res, 'Moodloom export');
  const used = new Set();
  for (const p of projects.rows) {
    let folder = safeName(p.name);
    for (let n = 2; used.has(folder.toLowerCase()); n++) folder = `${safeName(p.name)} (${n})`;
    used.add(folder.toLowerCase());
    await addProject(archive, p.id, folder);
  }
  if (projects.rows.length === 0) archive.append('No projects yet.\n', { name: 'README.txt' });
  await archive.finalize();
}
