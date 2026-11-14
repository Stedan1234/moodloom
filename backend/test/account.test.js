import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import { api, newUser, claimedUser, newProject, stop, upload, blockImage, jobs, uploadsDir, pool } from './helpers.js';

after(stop);

const storedFiles = () => fs.readdirSync(uploadsDir).filter((f) => !f.startsWith('.'));

test('account shows plan, limits and usage', async () => {
  const user = await claimedUser();
  const project = await newProject(user.token);
  const png = await blockImage([{ color: '#123456', share: 1 }]);
  await upload(user.token, project.id, png, 'a.png');
  await jobs.idle();
  const account = await api('GET', '/account', { token: user.token });
  assert.equal(account.body.claimed, true);
  assert.equal(account.body.plan, 'free');
  assert.equal(account.body.limitsEnforced, false);
  assert.equal(account.body.usage.projects, 1);
  assert.equal(account.body.usage.storageBytes, png.length);
  assert.equal(account.body.ai.embedder.active, 'classic-v1');
});

test('a project export is a ZIP with the references, notes and files in it', async () => {
  const token = await newUser();
  const project = await newProject(token, 'Export / me: please');
  const p = `/projects/${project.id}`;
  await upload(token, project.id, await blockImage([{ color: '#abcdef', share: 1 }]), 'swatch.png', { note: 'keep this blue' });
  await api('POST', `${p}/items`, { token, body: { sourceUrl: 'https://example.com/page', title: 'A page' } });
  await api('PUT', `${p}/workspace`, { token, body: { content: '<h1>Plan</h1>' } });
  await api('PUT', `${p}/canvas`, { token, body: { scene: { elements: [{ id: 'r1', type: 'rectangle' }] } } });
  await jobs.idle();

  const res = await api('GET', `${p}/export`, { token, raw: true });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="[^"/\\:]+\.zip"/);
  assert.equal(res.buffer.subarray(0, 2).toString(), 'PK');
  const names = res.buffer.toString('latin1');
  for (const expected of ['README.txt', 'project.json', 'references.json', 'references.md', 'notes.html', 'sketch.excalidraw', 'files/swatch.png']) {
    assert.ok(names.includes(expected), `archive should contain ${expected}`);
  }
  assert.ok(!names.includes('Export / me'), 'the folder name inside the archive has no path characters');

  const all = await api('GET', '/account/export', { token, raw: true });
  assert.equal(all.buffer.subarray(0, 2).toString(), 'PK');
});

test('deleting an account needs confirmation and the password, and removes everything', async () => {
  const user = await claimedUser('my password here');
  const project = await newProject(user.token);
  await upload(user.token, project.id, await blockImage([{ color: '#ff8800', share: 1 }]), 'a.png');
  await jobs.idle();
  const filesBefore = storedFiles().length;
  assert.ok(filesBefore >= 1);

  assert.equal((await api('DELETE', '/account', { token: user.token, body: { password: 'my password here' } })).status, 400);
  assert.equal((await api('DELETE', '/account', { token: user.token, body: { confirm: 'DELETE', password: 'wrong' } })).status, 403);
  assert.equal((await api('DELETE', '/account', { token: user.token, body: { confirm: 'DELETE', password: 'my password here' } })).status, 204);

  assert.equal((await api('GET', '/account', { token: user.token })).status, 401);
  assert.equal((await pool.query('SELECT 1 FROM projects WHERE id = $1', [project.id])).rows.length, 0);
  assert.equal(storedFiles().length, filesBefore - 1, 'its files are gone from disk');
  assert.equal((await api('POST', '/auth/login', { body: { email: user.email, password: 'my password here' } })).status, 401);
});

test('an anonymous account can be deleted without a password', async () => {
  const token = await newUser();
  await newProject(token);
  assert.equal((await api('DELETE', '/account', { token, body: { confirm: 'DELETE' } })).status, 204);
});
