// Runs with plan limits switched ON (they are off by default), to check
// that each limit is actually enforced and that upgrading lifts it.
process.env.TEST_ENFORCE_PLAN_LIMITS = 'true';
const { test, after } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { api, claimedUser, newProject, stop, pool } = await import('./helpers.js');

after(stop);

test('the free plan stops at its project limit; pro does not', async () => {
  const user = await claimedUser();
  for (let i = 0; i < 3; i++) await newProject(user.token, `P${i}`);
  const fourth = await api('POST', '/projects', { token: user.token, body: { name: 'One too many' } });
  assert.equal(fourth.status, 402);
  assert.equal(fourth.body.code, 'PLAN_LIMIT');

  await pool.query("UPDATE users SET plan = 'pro' WHERE email = $1", [user.email]);
  assert.equal((await api('POST', '/projects', { token: user.token, body: { name: 'Now fine' } })).status, 201);
  const account = await api('GET', '/account', { token: user.token });
  assert.equal(account.body.plan, 'pro');
  assert.equal(account.body.limitsEnforced, true);
});

test('share links and collaborators are limited on the free plan', async () => {
  const user = await claimedUser();
  const project = await newProject(user.token);
  const p = `/projects/${project.id}`;
  assert.equal((await api('POST', `${p}/share-links`, { token: user.token, body: {} })).status, 201);
  assert.equal((await api('POST', `${p}/share-links`, { token: user.token, body: {} })).status, 402);

  const invite = await api('POST', `${p}/invites`, { token: user.token, body: { role: 'viewer' } });
  const guest = await claimedUser();
  await api('POST', `/invites/${invite.body.url.split('/').pop()}/accept`, { token: guest.token });
  assert.equal((await api('POST', `${p}/invites`, { token: user.token, body: { role: 'viewer' } })).status, 402);
});

test('direction notes are metered per month against the owner', async () => {
  const user = await claimedUser();
  const project = await newProject(user.token);
  await api('PATCH', `/projects/${project.id}`, { token: user.token, body: { aiEnabled: true } });
  const { userId } = JSON.parse(Buffer.from(user.token.split('.')[1], 'base64url').toString());
  for (let i = 0; i < 5; i++) await pool.query("INSERT INTO usage_events (user_id, kind) VALUES ($1, 'direction_note')", [userId]);
  const res = await api('POST', `/projects/${project.id}/ai/direction`, { token: user.token, body: {} });
  assert.equal(res.status, 402);
  // Last month's usage does not count.
  await pool.query("UPDATE usage_events SET created_at = now() - interval '40 days' WHERE user_id = $1", [userId]);
  const next = await api('POST', `/projects/${project.id}/ai/direction`, { token: user.token, body: {} });
  assert.equal(next.status, 400, 'past the plan check; now refused only for having no references');
});
