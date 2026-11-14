import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { api, newUser, claimedUser, newProject, stop, pool } from './helpers.js';
import { outbox } from '../src/services/mailer.js';

after(stop);

test('anonymous account works immediately and is unclaimed', async () => {
  const token = await newUser();
  const me = await api('GET', '/account', { token });
  assert.equal(me.status, 200);
  assert.equal(me.body.claimed, false);
  assert.equal(me.body.email, null);
  assert.equal((await api('GET', '/auth/me', { token })).body.email, null);
});

test('requests without a valid token are refused', async () => {
  assert.equal((await api('GET', '/projects')).status, 401);
  assert.equal((await api('GET', '/projects', { token: 'garbage' })).status, 401);
});

test('a token signed with the wrong secret or with alg "none" is refused', async () => {
  const forged = jwt.sign({ userId: 1, tv: 0 }, 'not-the-secret');
  assert.equal((await api('GET', '/projects', { token: forged })).status, 401);
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"userId":1,"tv":0}').toString('base64url')}.`;
  assert.equal((await api('GET', '/projects', { token: none })).status, 401);
});

test('a token for a deleted account stops working', async () => {
  const token = await newUser();
  const { userId } = jwt.decode(token);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  assert.equal((await api('GET', '/projects', { token })).status, 401);
});

test('claim validates email and password', async () => {
  const token = await newUser();
  assert.equal((await api('POST', '/auth/claim', { token, body: { email: 'nope', password: 'longenough1' } })).status, 400);
  assert.equal((await api('POST', '/auth/claim', { token, body: { email: 'a@b.co', password: 'short' } })).status, 400);
  assert.equal((await api('POST', '/auth/claim', { token, body: { email: 'a@b.co', password: 'x'.repeat(73) } })).status, 400);
  assert.equal((await api('POST', '/auth/claim', { token, body: {} })).status, 400);
});

test('claim then login, case-insensitively, recovers the same account', async () => {
  const token = await newUser();
  const project = await newProject(token, 'Mine');
  const email = `Mixed.Case${Date.now()}@Example.com`;
  const claim = await api('POST', '/auth/claim', { token, body: { email, password: 'a good password' } });
  assert.equal(claim.status, 200);
  assert.equal(claim.body.email, email.toLowerCase());

  const login = await api('POST', '/auth/login', { body: { email: email.toUpperCase(), password: 'a good password' } });
  assert.equal(login.status, 200);
  const projects = await api('GET', '/projects', { token: login.body.token });
  assert.deepEqual(projects.body.map((p) => p.id), [project.id]);
});

test('an email can only be claimed once, and an account only claimed once', async () => {
  const first = await claimedUser();
  const other = await newUser();
  const dup = await api('POST', '/auth/claim', { token: other, body: { email: first.email.toUpperCase(), password: 'another password' } });
  assert.equal(dup.status, 409);
  const again = await api('POST', '/auth/claim', { token: first.token, body: { email: 'second@example.com', password: 'another password' } });
  assert.equal(again.status, 409);
});

test('login gives the same answer for a wrong password and an unknown email', async () => {
  const user = await claimedUser();
  const wrong = await api('POST', '/auth/login', { body: { email: user.email, password: 'wrong password' } });
  const unknown = await api('POST', '/auth/login', { body: { email: 'nobody-here@example.com', password: 'wrong password' } });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.body, unknown.body);
});

test('changing the password signs out old sessions and needs the current password', async () => {
  const user = await claimedUser('first password');
  const bad = await api('POST', '/account/password', { token: user.token, body: { currentPassword: 'nope', newPassword: 'second password' } });
  assert.equal(bad.status, 403);
  const ok = await api('POST', '/account/password', { token: user.token, body: { currentPassword: 'first password', newPassword: 'second password' } });
  assert.equal(ok.status, 200);
  assert.equal((await api('GET', '/projects', { token: user.token })).status, 401, 'old token must be dead');
  assert.equal((await api('GET', '/projects', { token: ok.body.token })).status, 200);
  assert.equal((await api('POST', '/auth/login', { body: { email: user.email, password: 'first password' } })).status, 401);
  assert.equal((await api('POST', '/auth/login', { body: { email: user.email, password: 'second password' } })).status, 200);
});

test('"sign out everywhere" kills every existing token', async () => {
  const user = await claimedUser();
  const second = (await api('POST', '/auth/login', { body: { email: user.email, password: user.password } })).body.token;
  const out = await api('POST', '/account/logout-all', { token: user.token });
  assert.equal(out.status, 200);
  assert.equal((await api('GET', '/projects', { token: user.token })).status, 401);
  assert.equal((await api('GET', '/projects', { token: second })).status, 401);
  assert.equal((await api('GET', '/projects', { token: out.body.token })).status, 200);
});

test('forgot password: same answer for any email, link works once, old sessions end', async () => {
  const user = await claimedUser('original password');
  outbox.length = 0;
  const unknown = await api('POST', '/auth/forgot-password', { body: { email: 'ghost@example.com' } });
  const known = await api('POST', '/auth/forgot-password', { body: { email: user.email.toUpperCase() } });
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.body, known.body);
  assert.equal(outbox.length, 1, 'only the real account gets an email');

  const token = /reset\?token=([a-f0-9]+)/.exec(outbox[0].text)[1];
  const stored = await pool.query('SELECT token_hash FROM password_reset_tokens');
  assert.ok(stored.rows.every((r) => r.token_hash !== token), 'the raw token is never stored');

  assert.equal((await api('POST', '/auth/reset-password', { body: { token: 'f'.repeat(64), password: 'brand new password' } })).status, 400);
  assert.equal((await api('POST', '/auth/reset-password', { body: { token, password: 'short' } })).status, 400);
  const reset = await api('POST', '/auth/reset-password', { body: { token, password: 'brand new password' } });
  assert.equal(reset.status, 200);
  assert.equal((await api('POST', '/auth/reset-password', { body: { token, password: 'yet another one' } })).status, 400, 'single use');
  assert.equal((await api('GET', '/projects', { token: user.token })).status, 401, 'sessions from before the reset are ended');
  assert.equal((await api('POST', '/auth/login', { body: { email: user.email, password: 'brand new password' } })).status, 200);
});

test('an expired reset link is refused', async () => {
  const user = await claimedUser();
  outbox.length = 0;
  await api('POST', '/auth/forgot-password', { body: { email: user.email } });
  const token = /reset\?token=([a-f0-9]+)/.exec(outbox[0].text)[1];
  await pool.query("UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute'");
  assert.equal((await api('POST', '/auth/reset-password', { body: { token, password: 'brand new password' } })).status, 400);
});

test('pairing code joins the extension to the same account, once', async () => {
  const token = await newUser();
  const project = await newProject(token, 'Paired');
  const code = await api('POST', '/auth/pairing-code', { token });
  assert.equal(code.status, 201);
  assert.match(code.body.code, /^[2-9A-HJKMNP-Z]{8}$/);

  const paired = await api('POST', '/auth/pair', { body: { code: code.body.code.toLowerCase() } });
  assert.equal(paired.status, 200);
  const seen = await api('GET', '/projects', { token: paired.body.token });
  assert.deepEqual(seen.body.map((p) => p.id), [project.id]);
  assert.equal((await api('POST', '/auth/pair', { body: { code: code.body.code } })).status, 400, 'a code works once');
  assert.equal((await api('POST', '/auth/pair', { body: { code: 'ZZZZZZZZ' } })).status, 400);
  assert.equal((await api('POST', '/auth/pair', { body: {} })).status, 400);
});
