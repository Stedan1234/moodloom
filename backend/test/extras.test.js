import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, newUser, claimedUser, newProject, stop, upload, blockImage, jobs } from './helpers.js';

after(stop);

test('bulk import: adds new links, skips duplicates, repeats and non-web links', async () => {
  const token = await newUser();
  const project = await newProject(token);
  const p = `/projects/${project.id}`;
  await api('POST', `${p}/items`, { token, body: { sourceUrl: 'https://example.com/already' } });

  const res = await api('POST', `${p}/items/import`, {
    token,
    body: {
      tag: 'Imported',
      links: [
        { url: 'https://example.com/a', title: 'A' },
        { url: 'https://example.com/a' },
        { url: 'https://example.com/already' },
        { url: 'javascript:alert(1)' },
        { url: 'not a link' },
        { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      ],
    },
  });
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { added: 2, alreadyOnBoard: 1, repeated: 1, invalid: 2, overLimit: 0 });
  await jobs.idle();

  const items = (await api('GET', `${p}/items`, { token })).body;
  assert.equal(items.length, 3);
  const a = items.find((i) => i.source_url === 'https://example.com/a');
  assert.equal(a.title, 'A');
  assert.deepEqual(a.tags, ['imported']);
  assert.equal(items.find((i) => i.media_type === 'video').meta.provider, 'youtube');
  assert.ok(!items.some((i) => (i.source_url || '').startsWith('javascript')));

  assert.equal((await api('POST', `${p}/items/import`, { token, body: { links: [] } })).status, 400);
  assert.equal((await api('POST', `${p}/items/import`, { token, body: { links: Array.from({ length: 301 }, (_, i) => ({ url: `https://example.com/${i}` })) } })).status, 400);
  assert.equal((await api('POST', `${p}/items/import`, { token, body: { links: [{ url: 'https://example.com/x' }], categoryId: 999999 } })).status, 400);
});

test('bulk import needs edit access', async () => {
  const owner = await claimedUser();
  const viewer = await claimedUser();
  const project = await newProject(owner.token);
  const invite = await api('POST', `/projects/${project.id}/invites`, { token: owner.token, body: { role: 'viewer' } });
  await api('POST', `/invites/${invite.body.url.split('/').pop()}/accept`, { token: viewer.token });
  const res = await api('POST', `/projects/${project.id}/items/import`, { token: viewer.token, body: { links: [{ url: 'https://example.com/a' }] } });
  assert.equal(res.status, 403);
  const stranger = await newUser();
  assert.equal((await api('POST', `/projects/${project.id}/items/import`, { token: stranger, body: { links: [{ url: 'https://example.com/a' }] } })).status, 404);
});

test('comments: members can comment, strangers cannot, deletion is limited', async () => {
  const owner = await claimedUser();
  const viewer = await claimedUser();
  const stranger = await newUser();
  const project = await newProject(owner.token);
  const p = `/projects/${project.id}`;
  const item = (await upload(owner.token, project.id, await blockImage([['#cc3333', 1]]), 'a.png')).body;
  const invite = await api('POST', `${p}/invites`, { token: owner.token, body: { role: 'viewer' } });
  await api('POST', `/invites/${invite.body.url.split('/').pop()}/accept`, { token: viewer.token });

  assert.equal((await api('POST', `${p}/items/${item.id}/comments`, { token: owner.token, body: { body: '   ' } })).status, 400);
  const mine = await api('POST', `${p}/items/${item.id}/comments`, { token: owner.token, body: { body: 'The red is the point. <script>alert(1)</script>' } });
  assert.equal(mine.status, 201);
  assert.equal(mine.body.mine, true);
  const theirs = await api('POST', `${p}/items/${item.id}/comments`, { token: viewer.token, body: { body: 'This one.' } });
  assert.equal(theirs.status, 201, 'a viewer can comment');

  const list = await api('GET', `${p}/items/${item.id}/comments`, { token: viewer.token });
  assert.equal(list.body.length, 2);
  assert.equal(list.body[0].body, 'The red is the point. <script>alert(1)</script>', 'stored and returned as plain text');
  assert.equal(list.body[0].mine, false);
  assert.equal(list.body[1].mine, true);
  assert.deepEqual((await api('GET', `${p}/items/comment-counts`, { token: owner.token })).body, { [item.id]: 2 });

  assert.equal((await api('GET', `${p}/items/${item.id}/comments`, { token: stranger })).status, 404);
  assert.equal((await api('POST', `${p}/items/${item.id}/comments`, { token: stranger, body: { body: 'hi' } })).status, 404);

  // a viewer can't delete the owner's comment; the owner can delete anyone's
  assert.equal((await api('DELETE', `${p}/items/${item.id}/comments/${mine.body.id}`, { token: viewer.token })).status, 404);
  assert.equal((await api('DELETE', `${p}/items/${item.id}/comments/${theirs.body.id}`, { token: owner.token })).status, 204);

  // a comment id from another project's item can't be reached through this one
  const other = await newProject(owner.token, 'Other');
  const otherItem = (await upload(owner.token, other.id, await blockImage([['#3333cc', 1]]), 'b.png')).body;
  assert.equal((await api('DELETE', `/projects/${other.id}/items/${otherItem.id}/comments/${mine.body.id}`, { token: owner.token })).status, 404);

  // deleting the reference takes its comments with it
  await api('DELETE', `${p}/items/${item.id}`, { token: owner.token });
  assert.deepEqual((await api('GET', `${p}/items/comment-counts`, { token: owner.token })).body, {});
});
