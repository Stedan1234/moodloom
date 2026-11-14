import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, newUser, newProject, stop } from './helpers.js';

after(stop);

test('create, read, update and delete a project', async () => {
  const token = await newUser();
  assert.equal((await api('POST', '/projects', { token, body: { name: '   ' } })).status, 400);
  assert.equal((await api('POST', '/projects', { token, body: { name: 'x'.repeat(121) } })).status, 400);

  const project = await newProject(token, '  Rebrand  ');
  assert.equal(project.name, 'Rebrand');
  assert.equal(project.role, 'owner');
  assert.equal(project.stage, 'brief');
  assert.equal(project.ai_enabled, false, 'AI is off until the owner turns it on');

  const categories = await api('GET', `/projects/${project.id}/categories`, { token });
  assert.equal(categories.body.length, 4, 'starter categories are seeded');

  const patched = await api('PATCH', `/projects/${project.id}`, {
    token,
    body: { name: 'Rebrand 2', stage: 'concepts', brief: { client: 'Acme', keywords: ['calm', 'tactile'], deadline: '2027-01-31' } },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.name, 'Rebrand 2');
  assert.equal(patched.body.stage, 'concepts');
  assert.deepEqual(patched.body.brief.keywords, ['calm', 'tactile']);

  assert.equal((await api('PATCH', `/projects/${project.id}`, { token, body: { stage: 'nonsense' } })).status, 400);
  assert.equal((await api('PATCH', `/projects/${project.id}`, { token, body: { brief: { deadline: 'tomorrow' } } })).status, 400);
  assert.equal((await api('PATCH', `/projects/${project.id}`, { token, body: {} })).status, 400);

  const list = await api('GET', '/projects', { token });
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].item_count, 0);

  assert.equal((await api('DELETE', `/projects/${project.id}`, { token })).status, 204);
  assert.equal((await api('GET', `/projects/${project.id}`, { token })).status, 404);
});

test('one account can never read or change another account\'s project', async () => {
  const owner = await newUser();
  const stranger = await newUser();
  const project = await newProject(owner, 'Private');
  const p = `/projects/${project.id}`;
  await api('PUT', `${p}/workspace`, { token: owner, body: { content: '<p>secret</p>' } });
  const item = await api('POST', `${p}/items`, { token: owner, body: { sourceUrl: 'https://example.com/a.png' } });
  const category = (await api('GET', `${p}/categories`, { token: owner })).body[0];

  const attempts = [
    ['GET', p],
    ['PATCH', p, { name: 'Taken' }],
    ['DELETE', p],
    ['GET', `${p}/export`],
    ['GET', `${p}/items`],
    ['POST', `${p}/items`, { sourceUrl: 'https://example.com/b.png' }],
    ['POST', `${p}/items/quote`, { text: 'hello' }],
    ['POST', `${p}/items/reorder`, { ids: [item.body.id] }],
    ['PATCH', `${p}/items/${item.body.id}`, { note: 'x' }],
    ['DELETE', `${p}/items/${item.body.id}`],
    ['GET', `${p}/items/${item.body.id}/similar`],
    ['GET', `${p}/categories`],
    ['POST', `${p}/categories`, { name: 'x' }],
    ['PATCH', `${p}/categories/${category.id}`, { name: 'x' }],
    ['DELETE', `${p}/categories/${category.id}`],
    ['GET', `${p}/workspace`],
    ['PUT', `${p}/workspace`, { content: 'x' }],
    ['GET', `${p}/canvas`],
    ['PUT', `${p}/canvas`, { scene: { elements: [] } }],
    ['GET', `${p}/brand`],
    ['PUT', `${p}/brand`, { data: {} }],
    ['GET', `${p}/ai/status`],
    ['GET', `${p}/ai/digest`],
    ['POST', `${p}/ai/groupings`, {}],
    ['GET', `${p}/ai/direction`],
    ['POST', `${p}/ai/direction`, {}],
    ['GET', `${p}/share-links`],
    ['POST', `${p}/share-links`, {}],
    ['GET', `${p}/members`],
    ['POST', `${p}/invites`, { role: 'editor' }],
  ];
  for (const [method, path, body] of attempts) {
    const res = await api(method, path, { token: stranger, body });
    assert.equal(res.status, 404, `${method} ${path} should look like it doesn't exist (got ${res.status})`);
  }
  // …and nothing was changed.
  assert.equal((await api('GET', p, { token: owner })).body.name, 'Private');
  assert.equal((await api('GET', `${p}/items`, { token: owner })).body.length, 1);
  assert.equal((await api('GET', `${p}/workspace`, { token: owner })).body.content, '<p>secret</p>');
});

test('ids that are not numbers are a 404, not a server error', async () => {
  const token = await newUser();
  const project = await newProject(token);
  for (const path of ['/projects/abc', '/projects/1;drop', '/projects/99999999999999999999', `/projects/${project.id}/items/abc/similar`]) {
    assert.equal((await api('GET', path, { token })).status, 404, path);
  }
  assert.equal((await api('PATCH', `/projects/${project.id}/items/abc`, { token, body: { note: 'x' } })).status, 404);
  assert.equal((await api('DELETE', `/projects/${project.id}/categories/-1`, { token })).status, 404);
});

test('categories: create, rename, delete, and items survive a deleted category', async () => {
  const token = await newUser();
  const project = await newProject(token);
  const p = `/projects/${project.id}`;
  const created = await api('POST', `${p}/categories`, { token, body: { name: 'Type' } });
  assert.equal(created.status, 201);
  const item = await api('POST', `${p}/items`, { token, body: { sourceUrl: 'https://example.com/t.png', categoryId: created.body.id } });
  assert.equal(item.body.category_id, created.body.id);
  assert.equal((await api('PATCH', `${p}/categories/${created.body.id}`, { token, body: { name: 'Typography' } })).body.name, 'Typography');
  assert.equal((await api('DELETE', `${p}/categories/${created.body.id}`, { token })).status, 204);
  const items = await api('GET', `${p}/items`, { token });
  assert.equal(items.body.length, 1);
  assert.equal(items.body[0].category_id, null);
});

test('workspace notes, canvas and brand kit save and load', async () => {
  const token = await newUser();
  const project = await newProject(token);
  const p = `/projects/${project.id}`;

  assert.equal((await api('GET', `${p}/workspace`, { token })).body.content, '');
  assert.equal((await api('PUT', `${p}/workspace`, { token, body: { content: 42 } })).status, 400);
  await api('PUT', `${p}/workspace`, { token, body: { content: '<h1>Direction</h1>' } });
  assert.equal((await api('GET', `${p}/workspace`, { token })).body.content, '<h1>Direction</h1>');

  assert.equal((await api('GET', `${p}/canvas`, { token })).body.scene, null);
  assert.equal((await api('PUT', `${p}/canvas`, { token, body: { scene: 'nope' } })).status, 400);
  const scene = { elements: [{ id: 'a', type: 'rectangle', x: 1, y: 2 }], appState: { viewBackgroundColor: '#fff', collaborators: { x: 1 } }, files: {} };
  assert.equal((await api('PUT', `${p}/canvas`, { token, body: { scene } })).status, 200);
  const loaded = await api('GET', `${p}/canvas`, { token });
  assert.equal(loaded.body.scene.elements[0].id, 'a');
  assert.equal(loaded.body.scene.appState.collaborators, undefined, 'view state is not stored');

  assert.deepEqual((await api('GET', `${p}/brand`, { token })).body.data, {});
  const kit = { name: 'Acme', colors: [{ hex: '#C8452F', name: 'Madder', role: 'primary' }], rules: [{ kind: 'do', text: 'Leave room' }], surprise: 'dropped' };
  const saved = await api('PUT', `${p}/brand`, { token, body: { data: kit } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.colors[0].hex, '#C8452F');
  assert.equal(saved.body.data.surprise, undefined, 'unknown fields are not stored');
  assert.equal((await api('PUT', `${p}/brand`, { token, body: { data: { colors: [{ hex: 'red' }] } } })).status, 400);
});
