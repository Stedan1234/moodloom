// Runs with rate limiting ON (the other test files switch it off).
process.env.TEST_RATE_LIMIT_DISABLED = 'false';
const { test, after } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { api, stop } = await import('./helpers.js');

after(stop);

test('guessing pairing codes is cut off after ten tries', async () => {
  const statuses = [];
  for (let i = 0; i < 12; i++) statuses.push((await api('POST', '/auth/pair', { body: { code: `GUESS${String(i).padStart(3, '0')}` } })).status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(400));
  assert.deepEqual(statuses.slice(10), [429, 429]);
});

test('password-reset requests are limited to five per window', async () => {
  const statuses = [];
  for (let i = 0; i < 7; i++) statuses.push((await api('POST', '/auth/forgot-password', { body: { email: 'someone@example.com' } })).status);
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
});

test('login attempts are limited', async () => {
  let limited = 0;
  for (let i = 0; i < 25; i++) {
    const res = await api('POST', '/auth/login', { body: { email: 'victim@example.com', password: `guess-number-${i}` } });
    if (res.status === 429) limited++;
  }
  assert.ok(limited >= 5, `expected the tail of 25 rapid attempts to be refused (got ${limited})`);
});
