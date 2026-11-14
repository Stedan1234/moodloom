import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { api, newUser, newProject, stop, baseUrl } from './helpers.js';
import { checkUrl, isPublicAddress, guardedLookup, safeFetch } from '../src/lib/safeFetch.js';
import { deltaE2000, rgbToLab, labToRgb } from '../src/lib/color.js';
import { cleanFileName } from '../src/services/files.js';
import { isValidKey, filePath } from '../src/lib/storage.js';

after(stop);

test('security headers are set on API responses', async () => {
  const res = await api('GET', '/health');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.ok(res.headers.get('referrer-policy'));
  const apiRes = await api('GET', '/projects');
  assert.match(apiRes.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(apiRes.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('CORS: the app origin and the extension are allowed, other sites are not', async () => {
  const allowed = await api('GET', '/health', { headers: { origin: 'http://app.test' } });
  assert.equal(allowed.status, 200);
  const ok = await api('GET', '/projects', { headers: { origin: 'http://app.test' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://app.test');
  const ext = await api('GET', '/projects', { headers: { origin: 'chrome-extension://abcdefghijklmnop' } });
  assert.equal(ext.headers.get('access-control-allow-origin'), 'chrome-extension://abcdefghijklmnop');
  const evil = await api('GET', '/projects', { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
});

test('malformed and oversized bodies get a clean 4xx with no internals', async () => {
  const token = await newUser();
  const bad = await api('POST', '/projects', { token, body: '{"name": ', headers: { 'content-type': 'application/json' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.code, 'BAD_JSON');
  const project = await newProject(token);
  const huge = await api('PUT', `/projects/${project.id}/workspace`, { token, body: { content: 'x'.repeat(1_200_000) } });
  assert.equal(huge.status, 413);
  for (const res of [bad, huge]) assert.ok(!JSON.stringify(res.body).includes('node_modules'), 'no stack trace in the response');
  assert.equal((await api('GET', '/nope', { token })).status, 404);
});

test('SQL metacharacters in input are stored as text, not executed', async () => {
  const token = await newUser();
  const name = "Robert'); DROP TABLE projects;--";
  const project = await newProject(token, name);
  assert.equal(project.name, name);
  assert.equal((await api('GET', '/projects', { token })).body.length, 1);
  assert.equal((await api('GET', `/search?q=${encodeURIComponent("'; DROP TABLE users;--")}`, { token })).status, 200);
});

test('SSRF guard: which addresses count as public', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1',
    '::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '224.0.0.1', '255.255.255.255', 'not-an-ip']) {
    assert.equal(isPublicAddress(ip), false, `${ip} must be refused`);
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111']) {
    assert.equal(isPublicAddress(ip), true, `${ip} is public`);
  }
});

test('SSRF guard: which URLs are refused before any request is made', () => {
  for (const url of [
    'http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/', 'http://10.1.2.3/x',
    'http://0x7f.0.0.1/', 'http://2130706433/', 'http://017700000001/', 'http://foo.localhost/', 'http://printer.local/', 'http://db.internal/',
    'file:///etc/passwd', 'gopher://example.com/', 'ftp://example.com/', 'http://user:pass@example.com/', 'http://example.com:22/', 'http://example.com:6379/',
    'not a url', '',
  ]) {
    assert.equal(checkUrl(url), null, `${url} must be refused`);
  }
  assert.ok(checkUrl('https://example.com/page?x=1'));
  assert.ok(checkUrl('http://example.com:8080/'));
});

test('SSRF guard: a hostname that resolves to a private address is refused at connect time', async () => {
  // "localhost" resolves to loopback: the lookup itself must fail.
  await new Promise((resolve) => {
    guardedLookup('localhost', { all: true }, (err, addresses) => {
      assert.ok(err, 'lookup must error');
      assert.equal(err.code, 'ESSRF');
      assert.equal(addresses, undefined);
      resolve();
    });
  });
  // And a real listening local server is unreachable through safeFetch.
  const server = http.createServer((req, res) => res.end('internal secret')).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const result = await safeFetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(result, null);
  const viaApiPort = await safeFetch(`${baseUrl}/api/health`);
  assert.equal(viaApiPort, null);
  server.close();
});

test('file names and storage keys cannot be used to reach other paths', () => {
  assert.equal(cleanFileName('../../../etc/passwd'), 'passwd');
  assert.equal(cleanFileName('C:\\Users\\me\\logo.png'), 'logo.png');
  assert.equal(cleanFileName('a\u0000b\nc.png'), 'abc.png');
  assert.equal(cleanFileName(''), 'file');
  assert.ok(cleanFileName('x'.repeat(400) + '.png').length <= 180);
  for (const key of ['../secret.png', 'a/b.png', '..', '.env', 'file.png', '123e4567-e89b-12d3-a456-426614174000.png/../../x']) {
    assert.equal(isValidKey(key), false, key);
    assert.throws(() => filePath(key));
  }
  assert.equal(isValidKey('123e4567-e89b-12d3-a456-426614174000.png'), true);
  assert.equal(isValidKey('123e4567-e89b-12d3-a456-426614174000.thumb.webp'), true);
});

test('colour maths matches published reference values', () => {
  // CIEDE2000 test pairs from Sharma, Wu & Dalal (2005).
  const pairs = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, -1, 2], [50, 0, 0], 2.3669],
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  for (const [a, b, expected] of pairs) assert.ok(Math.abs(deltaE2000(a, b) - expected) < 1e-4, `ΔE00 ${expected}`);
  const white = rgbToLab(255, 255, 255);
  assert.ok(Math.abs(white[0] - 100) < 0.01 && Math.abs(white[1]) < 0.01 && Math.abs(white[2]) < 0.01);
  for (const rgb of [[200, 30, 90], [0, 0, 0], [12, 200, 180], [255, 255, 0]]) assert.deepEqual(labToRgb(...rgbToLab(...rgb)), rgb);
});
