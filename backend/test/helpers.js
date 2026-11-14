// Shared setup for the API tests. Each test file runs in its own process:
// it gets a real server on a random port, a real Postgres test database
// (wiped at the start), a throwaway uploads folder and the mock language
// model. Nothing here talks to the internet.
import os from 'os';
import fs from 'fs';
import path from 'path';

const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moodloom-test-uploads-'));
const defaults = {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql://moodloom:moodloom_dev@localhost:5432/moodloom_test',
  JWT_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
  PORT: '0',
  ALLOWED_ORIGINS: 'http://app.test',
  APP_URL: 'http://app.test',
  PUBLIC_BASE_URL: 'http://files.test',
  UPLOADS_DIR: uploadsDir,
  RATE_LIMIT_DISABLED: 'true',
  REMOTE_FETCH_DISABLED: 'true',
  AI_LLM_PROVIDER: 'mock',
  AI_EMBEDDER: 'classic',
  ANTHROPIC_API_KEY: '',
  ENFORCE_PLAN_LIMITS: 'false',
  MAX_IMAGE_MB: '1',
  SMTP_HOST: '',
  FRONTEND_DIST: '',
  TRUST_PROXY: '',
};
// A test file may set a variable before importing this module to override it.
for (const [key, value] of Object.entries(defaults)) {
  if (process.env[`TEST_${key}`] !== undefined) process.env[key] = process.env[`TEST_${key}`];
  else process.env[key] = value;
}

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db/pool.js');
const { runMigrations } = await import('../src/db/migrate.js');
const jobs = await import('../src/lib/jobs.js');
const { default: sharp } = await import('sharp');

await runMigrations({ log: () => {} });
await pool.query('TRUNCATE users, usage_events RESTART IDENTITY CASCADE');

const server = createApp().listen(0);
await new Promise((resolve) => server.once('listening', resolve));
export const baseUrl = `http://127.0.0.1:${server.address().port}`;
export { pool, jobs, uploadsDir };

export async function stop() {
  await jobs.idle();
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
  fs.rmSync(uploadsDir, { recursive: true, force: true });
}

/** Calls the API. Returns { status, body, headers }. */
export async function api(method, urlPath, { token, body, headers = {}, raw = false } = {}) {
  const res = await fetch(`${baseUrl}${urlPath.startsWith('/uploads') || urlPath.startsWith('/health') ? '' : '/api'}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : body instanceof FormData || typeof body === 'string' ? body : JSON.stringify(body),
  });
  if (raw) return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
  const textBody = await res.text();
  let parsed = null;
  try {
    parsed = textBody ? JSON.parse(textBody) : null;
  } catch {
    parsed = textBody;
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

export async function newUser() {
  const res = await api('POST', '/auth/anonymous');
  return res.body.token;
}

let counter = 0;
export async function claimedUser(password = 'correct horse battery') {
  const token = await newUser();
  const email = `person${++counter}-${Date.now()}@example.com`;
  const res = await api('POST', '/auth/claim', { token, body: { email, password } });
  if (res.status !== 200) throw new Error(`claim failed: ${JSON.stringify(res.body)}`);
  return { token, email, password };
}

export async function newProject(token, name = 'Test project') {
  const res = await api('POST', '/projects', { token, body: { name } });
  if (res.status !== 201) throw new Error(`project create failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

/** A PNG made of flat colour blocks: [{color:'#rrggbb', share: 0..1}] left to right. */
export async function blockImage(blocks, { width = 300, height = 200 } = {}) {
  let x = 0;
  const rects = blocks
    .map((b) => {
      const w = Math.round(b.share * width);
      const rect = `<rect x="${x}" y="0" width="${w + 1}" height="${height}" fill="${b.color}"/>`;
      x += w;
      return rect;
    })
    .join('');
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rects}</svg>`)).png().toBuffer();
}

export async function upload(token, projectId, buffer, fileName, fields = {}, type = 'application/octet-stream') {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  form.append('file', new Blob([buffer], { type }), fileName);
  return api('POST', `/projects/${projectId}/items/upload`, { token, body: form });
}

export { sharp };
