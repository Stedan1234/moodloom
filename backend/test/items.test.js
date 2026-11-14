import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { api, newUser, newProject, stop, upload, blockImage, jobs, uploadsDir, sharp, pool } from './helpers.js';

after(stop);

const storedFiles = () => fs.readdirSync(uploadsDir).filter((f) => !f.startsWith('.'));

test('capturing a URL: validation, media detection and the duplicate guard', async () => {
  const token = await newUser();
  const p = `/projects/${(await newProject(token)).id}`;

  assert.equal((await api('POST', `${p}/items`, { token, body: {} })).status, 400);
  assert.equal((await api('POST', `${p}/items`, { token, body: { sourceUrl: 'not a url' } })).status, 400);
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'ftp://x.example/a']) {
    assert.equal((await api('POST', `${p}/items`, { token, body: { sourceUrl: bad } })).status, 400, bad);
  }

  const yt = await api('POST', `${p}/items`, { token, body: { sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'A video' } });
  assert.equal(yt.status, 201);
  assert.equal(yt.body.media_type, 'video');
  assert.deepEqual(yt.body.meta, { provider: 'youtube', videoId: 'dQw4w9WgXcQ' });
  assert.equal(yt.body.embed_html, undefined, 'no stored HTML is ever sent to the client');

  const img = await api('POST', `${p}/items`, { token, body: { sourceUrl: 'https://example.com/pic.JPG?size=2', pageUrl: 'https://example.com/post', tags: ['Poster', 'poster', ' type '] } });
  assert.equal(img.body.media_type, 'image');
  assert.equal(img.body.meta.foundOn, 'https://example.com/post');
  assert.deepEqual(img.body.tags, ['poster', 'type'], 'tags are lowercased, trimmed and de-duplicated');

  const link = await api('POST', `${p}/items`, { token, body: { sourceUrl: 'https://example.com/article' } });
  assert.equal(link.body.media_type, 'link');

  const again = await api('POST', `${p}/items`, { token, body: { sourceUrl: 'https://example.com/article' } });
  assert.equal(again.status, 200);
  assert.equal(again.body.alreadyOnBoard, true);
  assert.equal(again.body.id, link.body.id);

  // Ten truly simultaneous captures of one new URL still make exactly one item.
  const burst = await Promise.all(
    Array.from({ length: 10 }, () => api('POST', `${p}/items`, { token, body: { sourceUrl: 'https://example.com/race.png' } }))
  );
  assert.ok(burst.every((r) => r.status === 200 || r.status === 201));
  const all = await api('GET', `${p}/items`, { token });
  assert.equal(all.body.filter((i) => i.source_url === 'https://example.com/race.png').length, 1);
});

test('a category id from another project is refused', async () => {
  const token = await newUser();
  const a = await newProject(token, 'A');
  const b = await newProject(token, 'B');
  const foreign = (await api('GET', `/projects/${b.id}/categories`, { token })).body[0].id;
  const res = await api('POST', `/projects/${a.id}/items`, { token, body: { sourceUrl: 'https://example.com/x.png', categoryId: foreign } });
  assert.equal(res.status, 400);
  const item = await api('POST', `/projects/${a.id}/items`, { token, body: { sourceUrl: 'https://example.com/x.png' } });
  assert.equal((await api('PATCH', `/projects/${a.id}/items/${item.body.id}`, { token, body: { categoryId: foreign } })).status, 400);
  assert.equal((await upload(token, a.id, await blockImage([{ color: '#ff0000', share: 1 }]), 'x.png', { categoryId: foreign })).status, 400);
  assert.equal(storedFiles().length, 0, 'a rejected upload leaves no file behind');
});

test('uploading an image: stored under a generated name, measured, analysed in the background', async () => {
  const token = await newUser();
  const project = await newProject(token);
  const p = `/projects/${project.id}`;
  const png = await blockImage([{ color: '#1c1b19', share: 0.6 }, { color: '#f4f3ef', share: 0.3 }, { color: '#c8452f', share: 0.1 }], { width: 1600, height: 900 });

  const res = await upload(token, project.id, png, '../../etc/passwd.png', { title: 'Poster', note: 'the red' }, 'image/png');
  assert.equal(res.status, 201);
  assert.equal(res.body.media_type, 'image');
  assert.equal(res.body.is_upload, true);
  assert.equal(res.body.file_name, 'passwd.png', 'any path in the client file name is discarded');
  assert.equal(res.body.width, 1600);
  assert.equal(res.body.height, 900);
  assert.match(res.body.source_url, /^http:\/\/files\.test\/uploads\/[a-f0-9-]{36}\.png$/);
  assert.equal(res.body.storage_key, undefined, 'internal storage keys are not exposed');

  await jobs.idle();
  const item = (await api('GET', `${p}/items`, { token })).body[0];
  assert.equal(item.analyzed, true);
  assert.ok(item.palette.length >= 3);
  assert.equal(item.palette[0].name, 'near black');
  assert.ok(Math.abs(item.palette[0].pct - 60) < 3, `dominant share ≈ 60% (got ${item.palette[0].pct})`);
  assert.ok(item.palette.some((s) => s.name === 'red'));
  assert.match(item.thumbnail_url, /\.thumb\.webp$/, 'a large image gets a smaller thumbnail');
  assert.equal(storedFiles().length, 2);

  // Served back with locked-down headers.
  const file = await api('GET', new URL(item.source_url).pathname, { raw: true });
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  assert.match(file.headers.get('content-security-policy'), /sandbox/);
  assert.equal(file.headers.get('content-disposition'), null);

  assert.equal((await api('DELETE', `${p}/items/${item.id}`, { token })).status, 204);
  assert.equal(storedFiles().length, 0, 'deleting the item deletes the file and its thumbnail');
});

test('file types are decided by the bytes, not the name', async () => {
  const token = await newUser();
  const project = await newProject(token);
  const png = await blockImage([{ color: '#336699', share: 1 }]);
  const before = storedFiles().length;

  // HTML and a Windows executable, each dressed up as a PNG.
  assert.equal((await upload(token, project.id, Buffer.from('<!doctype html><script>alert(1)</script>'), 'cute.png', {}, 'image/png')).status, 415);
  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);
  assert.equal((await upload(token, project.id, exe, 'holiday.png', {}, 'image/png')).status, 415);
  assert.equal((await upload(token, project.id, Buffer.from('#!/bin/sh\nrm -rf /'), 'notes.txt')).status, 415);
  assert.equal((await upload(token, project.id, Buffer.from('plain words'), 'thing.unknownext')).status, 415);
  assert.equal(storedFiles().length, before, 'refused files are not kept');

  // A real PNG with a misleading name is still stored as what it is.
  const disguised = await upload(token, project.id, png, 'report.pdf');
  assert.equal(disguised.status, 201);
  assert.equal(disguised.body.media_type, 'image');
  assert.match(disguised.body.source_url, /\.png$/);

  const pdf = await upload(token, project.id, Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF'), 'Brief.pdf');
  assert.equal(pdf.status, 201);
  assert.equal(pdf.body.media_type, 'pdf');
  assert.equal(pdf.body.thumbnail_url, null);

  const svg = await upload(token, project.id, Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'logo.svg');
  assert.equal(svg.status, 201);
  assert.equal(svg.body.media_type, 'image');
  const served = await api('GET', new URL(svg.body.source_url).pathname, { raw: true });
  assert.match(served.headers.get('content-security-policy'), /sandbox/, 'an SVG opened directly cannot run its script');

  const source = await upload(token, project.id, Buffer.from('8BPS' + '\0'.repeat(60)), 'layout.psd');
  assert.equal(source.status, 201);
  assert.equal(source.body.media_type, 'file');
  const download = await api('GET', new URL(source.body.source_url).pathname, { raw: true });
  assert.equal(download.headers.get('content-disposition'), 'attachment', 'source files are downloads, never rendered');
  await jobs.idle();
});

test('an image over the size limit is refused and not kept', async () => {
  const token = await newUser();
  const project = await newProject(token);
  const before = storedFiles().length;
  // Random noise doesn't compress: comfortably over the 1MB test limit.
  const big = await sharp(crypto.randomBytes(700 * 700 * 3), { raw: { width: 700, height: 700, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
  assert.ok(big.length > 1024 * 1024);
  const res = await upload(token, project.id, big, 'big.png');
  assert.equal(res.status, 413);
  assert.equal(storedFiles().length, before);
  assert.equal(fs.readdirSync(path.join(uploadsDir, '.incoming')).length, 0, 'the temp copy is cleaned up');
});

test('the temp upload folder is never served', async () => {
  fs.writeFileSync(path.join(uploadsDir, '.incoming', 'probe'), 'secret');
  assert.equal((await api('GET', '/uploads/.incoming/probe', { raw: true })).status, 404);
  assert.equal((await api('GET', '/uploads/..%2f..%2fpackage.json', { raw: true })).status, 404);
  fs.unlinkSync(path.join(uploadsDir, '.incoming', 'probe'));
});

test('notes, tags, title, quotes and reordering', async () => {
  const token = await newUser();
  const project = await newProject(token);
  const p = `/projects/${project.id}`;
  const a = (await api('POST', `${p}/items`, { token, body: { sourceUrl: 'https://example.com/a.png' } })).body;
  const b = (await api('POST', `${p}/items`, { token, body: { sourceUrl: 'https://example.com/b.png' } })).body;

  const patched = await api('PATCH', `${p}/items/${a.id}`, { token, body: { note: 'Love the spacing', tags: ['Layout'], title: 'Cover' } });
  assert.equal(patched.body.note, 'Love the spacing');
  assert.deepEqual(patched.body.tags, ['layout']);
  assert.equal(patched.body.title, 'Cover');
  const cleared = await api('PATCH', `${p}/items/${a.id}`, { token, body: { note: null } });
  assert.equal(cleared.body.note, null);
  assert.equal(cleared.body.title, 'Cover', 'fields that were not sent are left alone');
  assert.equal((await api('PATCH', `${p}/items/${a.id}`, { token, body: { tags: Array(21).fill('x').map((x, i) => x + i) } })).status, 400);
  assert.equal((await api('PATCH', `${p}/items/${a.id}`, { token, body: {} })).status, 400);

  const quote = await api('POST', `${p}/items/quote`, { token, body: { text: 'Trains, mountains, a record player.', fromItemId: a.id, page: 12 } });
  assert.equal(quote.status, 201);
  assert.equal(quote.body.media_type, 'quote');
  assert.equal(quote.body.note, 'Trains, mountains, a record player.');
  assert.equal(quote.body.source_url, null);
  assert.deepEqual([quote.body.meta.fromItemId, quote.body.meta.page], [a.id, 12]);
  assert.equal((await api('POST', `${p}/items/quote`, { token, body: { text: 'x', fromItemId: 999999 } })).status, 400);

  assert.equal((await api('POST', `${p}/items/reorder`, { token, body: { ids: [quote.body.id, b.id, a.id] } })).status, 200);
  const order = (await api('GET', `${p}/items`, { token })).body.map((i) => i.id);
  assert.deepEqual(order, [quote.body.id, b.id, a.id]);
});

test('deleting a project removes its stored files', async () => {
  const token = await newUser();
  const project = await newProject(token);
  const before = storedFiles().length;
  await upload(token, project.id, await blockImage([{ color: '#00aa55', share: 1 }]), 'a.png');
  await upload(token, project.id, await blockImage([{ color: '#aa0055', share: 1 }]), 'b.png');
  await jobs.idle();
  assert.equal(storedFiles().length, before + 2);
  assert.equal((await api('DELETE', `/projects/${project.id}`, { token })).status, 204);
  assert.equal(storedFiles().length, before);
});

test('search finds references by title, note, tag and link across projects, and only your own', async () => {
  const token = await newUser();
  const other = await newUser();
  const p1 = await newProject(token, 'One');
  const p2 = await newProject(token, 'Two');
  const theirs = await newProject(other, 'Theirs');
  await api('POST', `/projects/${p1.id}/items`, { token, body: { sourceUrl: 'https://example.com/a.png', title: 'Kinfolk cover' } });
  await api('POST', `/projects/${p2.id}/items`, { token, body: { sourceUrl: 'https://example.com/b.png', note: 'kinfolk-ish spacing', tags: ['editorial'] } });
  await api('POST', `/projects/${theirs.id}/items`, { token: other, body: { sourceUrl: 'https://example.com/c.png', title: 'Kinfolk too' } });

  const found = await api('GET', '/search?q=KINFOLK', { token });
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.map((i) => i.project_name).sort(), ['One', 'Two']);
  assert.equal((await api('GET', '/search?q=editorial', { token })).body.length, 1);
  assert.equal((await api('GET', '/search?q=%25', { token })).status, 400, 'too short');
  assert.equal((await api('GET', '/search?q=%25%25', { token })).body.length, 0, 'a % is searched for literally, not as a wildcard');
  await pool.query('SELECT 1');
});
