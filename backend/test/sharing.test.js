import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, newUser, claimedUser, newProject, stop, upload, blockImage, jobs } from './helpers.js';

after(stop);

const tokenOf = (url) => url.split('/').pop();

test('a share link shows exactly what it was set to show, and stops when revoked', async () => {
  const owner = await newUser();
  const project = await newProject(owner, 'Client board');
  const p = `/projects/${project.id}`;
  await api('POST', `${p}/items`, { token: owner, body: { sourceUrl: 'https://example.com/a.png', note: 'private thought' } });
  await api('PUT', `${p}/workspace`, { token: owner, body: { content: '<p>internal notes</p>' } });
  await api('PATCH', p, { token: owner, body: { brief: { client: 'Acme' } } });
  await api('PUT', `${p}/brand`, { token: owner, body: { data: { name: 'Acme', colors: [{ hex: '#112233' }] } } });

  const link = await api('POST', `${p}/share-links`, { token: owner, body: {} });
  assert.equal(link.status, 201);
  assert.match(link.body.url, /^http:\/\/app\.test\/s\/[A-Za-z0-9_-]{32}$/);
  const token = tokenOf(link.body.url);

  // No account needed. Board only by default.
  const view = await api('GET', `/share/${token}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.project.name, 'Client board');
  assert.equal(view.body.items.length, 1);
  assert.equal(view.body.notes, undefined);
  assert.equal(view.body.brand, undefined);
  assert.equal(view.body.brief, undefined);
  assert.equal(view.body.items[0].project_id, undefined);
  assert.equal(view.headers.get('cache-control'), 'no-store');
  assert.match(view.headers.get('x-robots-tag'), /noindex/);

  await api('PATCH', `${p}/share-links/${link.body.id}`, { token: owner, body: { includeBoard: false, includeBrand: true, includeNotes: true, includeBrief: true } });
  const brandOnly = await api('GET', `/share/${token}`);
  assert.equal(brandOnly.body.brand.name, 'Acme');
  assert.equal(brandOnly.body.notes, '<p>internal notes</p>');
  assert.equal(brandOnly.body.brief.client, 'Acme');
  assert.deepEqual(brandOnly.body.items, [], 'the board is not included once switched off');
  assert.equal(brandOnly.body.categories, undefined);

  assert.equal((await api('GET', '/share/' + 'A'.repeat(32))).status, 404);
  assert.equal((await api('GET', '/share/short')).status, 404);

  assert.equal((await api('DELETE', `${p}/share-links/${link.body.id}`, { token: owner })).status, 204);
  assert.equal((await api('GET', `/share/${token}`)).status, 404, 'a revoked link is dead immediately');
});

test('a brand-only share link sends just the items the kit refers to', async () => {
  const owner = await newUser();
  const project = await newProject(owner);
  const p = `/projects/${project.id}`;
  const logo = (await upload(owner, project.id, await blockImage([{ color: '#000000', share: 1 }]), 'logo.png')).body;
  await api('POST', `${p}/items`, { token: owner, body: { sourceUrl: 'https://example.com/unrelated.png' } });
  await jobs.idle();
  await api('PUT', `${p}/brand`, { token: owner, body: { data: { logos: [{ itemId: logo.id, label: 'Primary' }] } } });
  const link = await api('POST', `${p}/share-links`, { token: owner, body: { includeBoard: false, includeBrand: true } });
  const view = await api('GET', `/share/${tokenOf(link.body.url)}`);
  assert.deepEqual(view.body.items.map((i) => i.id), [logo.id]);
});

test('invitations: need a saved account, work once, and grant exactly the role given', async () => {
  const owner = await claimedUser();
  const project = await newProject(owner.token, 'Team project');
  const p = `/projects/${project.id}`;
  const item = (await api('POST', `${p}/items`, { token: owner.token, body: { sourceUrl: 'https://example.com/a.png' } })).body;

  const invite = await api('POST', `${p}/invites`, { token: owner.token, body: { role: 'viewer' } });
  assert.equal(invite.status, 201);
  const inviteToken = tokenOf(invite.body.url);
  assert.equal((await api('POST', `${p}/invites`, { token: owner.token, body: { role: 'owner' } })).status, 400);

  const preview = await api('GET', `/invites/${inviteToken}`);
  assert.deepEqual(preview.body, { projectName: 'Team project', role: 'viewer' });

  const anonymous = await newUser();
  const refused = await api('POST', `/invites/${inviteToken}/accept`, { token: anonymous });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, 'CLAIM_REQUIRED');

  const viewer = await claimedUser();
  const accepted = await api('POST', `/invites/${inviteToken}/accept`, { token: viewer.token });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.role, 'viewer');
  const second = await claimedUser();
  assert.equal((await api('POST', `/invites/${inviteToken}/accept`, { token: second.token })).status, 404, 'an invitation works once');

  // A viewer can read everything…
  assert.equal((await api('GET', p, { token: viewer.token })).body.role, 'viewer');
  assert.equal((await api('GET', `${p}/items`, { token: viewer.token })).body.length, 1);
  assert.ok((await api('GET', '/projects', { token: viewer.token })).body.some((x) => x.id === project.id && x.role === 'viewer'));
  // …and change nothing.
  for (const [method, path, body] of [
    ['POST', `${p}/items`, { sourceUrl: 'https://example.com/b.png' }],
    ['PATCH', `${p}/items/${item.id}`, { note: 'x' }],
    ['DELETE', `${p}/items/${item.id}`],
    ['PUT', `${p}/workspace`, { content: 'x' }],
    ['PUT', `${p}/canvas`, { scene: { elements: [] } }],
    ['PUT', `${p}/brand`, { data: {} }],
    ['POST', `${p}/categories`, { name: 'x' }],
    ['PATCH', p, { stage: 'deliver' }],
    ['DELETE', p],
    ['POST', `${p}/share-links`, {}],
    ['POST', `${p}/invites`, { role: 'editor' }],
    ['POST', `${p}/ai/direction`, {}],
  ]) {
    assert.equal((await api(method, path, { token: viewer.token, body })).status, 403, `${method} ${path}`);
  }

  // Promote to editor: can work on the board, still can't run the project.
  const viewerId = (await api('GET', `${p}/members`, { token: owner.token })).body.members.find((m) => m.role === 'viewer').id;
  assert.equal((await api('PATCH', `${p}/members/${viewerId}`, { token: owner.token, body: { role: 'editor' } })).status, 200);
  assert.equal((await api('POST', `${p}/items`, { token: viewer.token, body: { sourceUrl: 'https://example.com/b.png' } })).status, 201);
  assert.equal((await api('PATCH', p, { token: viewer.token, body: { stage: 'research' } })).status, 200);
  assert.equal((await api('PATCH', p, { token: viewer.token, body: { name: 'Hijacked' } })).status, 403);
  assert.equal((await api('PATCH', p, { token: viewer.token, body: { aiEnabled: true } })).status, 403, 'only the owner can consent to AI');
  assert.equal((await api('DELETE', p, { token: viewer.token })).status, 403);
  assert.equal((await api('GET', `${p}/share-links`, { token: viewer.token })).status, 403);
  assert.equal((await api('DELETE', `${p}/members/${(await api('GET', `${p}/members`, { token: owner.token })).body.members[0].id}`, { token: viewer.token })).status, 403);

  // Leaving removes access at once.
  assert.equal((await api('DELETE', `${p}/members/${viewerId}`, { token: viewer.token })).status, 204);
  assert.equal((await api('GET', p, { token: viewer.token })).status, 404);
});

test('an expired or deleted invitation cannot be used', async () => {
  const owner = await claimedUser();
  const project = await newProject(owner.token);
  const invite = await api('POST', `/projects/${project.id}/invites`, { token: owner.token, body: { role: 'editor' } });
  assert.equal((await api('DELETE', `/projects/${project.id}/invites/${invite.body.id}`, { token: owner.token })).status, 204);
  const guest = await claimedUser();
  assert.equal((await api('POST', `/invites/${tokenOf(invite.body.url)}/accept`, { token: guest.token })).status, 404);
  assert.equal((await api('GET', `/invites/${tokenOf(invite.body.url)}`)).status, 404);
});
