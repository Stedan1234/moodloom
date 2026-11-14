// Every environment variable the backend reads is parsed and checked here,
// once, at startup. Nothing else in the codebase touches process.env, so a
// missing or unsafe setting fails loudly before the server accepts a request
// instead of surfacing later as a confusing runtime error.
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}
function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}
function list(value) {
  return (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
function stripSlash(url) {
  return url.replace(/\/+$/, '');
}

const nodeEnv = env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';
const isTest = nodeEnv === 'test';
const port = int(env.PORT, 3001);

const PLACEHOLDER_SECRET = 'replace-with-a-long-random-string';
const SECRET_HINT =
  'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))" and put it in backend/.env';

if (!env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
}
if (!env.JWT_SECRET || env.JWT_SECRET.trim().length === 0) {
  throw new Error(`JWT_SECRET is not set. ${SECRET_HINT}`);
}
if (env.JWT_SECRET === PLACEHOLDER_SECRET) {
  throw new Error(`JWT_SECRET is still the .env.example placeholder. ${SECRET_HINT}`);
}
if (isProd && env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET is too short for production (need 32+ characters of real entropy).');
}

const publicBaseUrl = stripSlash(env.PUBLIC_BASE_URL || `http://localhost:${port}`);
const appUrl = stripSlash(env.APP_URL || 'http://localhost:5173');

if (isProd) {
  for (const [name, value] of [['PUBLIC_BASE_URL', publicBaseUrl], ['APP_URL', appUrl]]) {
    if (!value.startsWith('https://')) {
      throw new Error(`${name} must be an https:// URL in production (got "${value}").`);
    }
  }
}

// Where uploaded files live. Outside the repo tree is fine (and expected on a
// host with a mounted persistent disk) — point UPLOADS_DIR at the mount.
const uploadsDir = path.resolve(env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'));
fs.mkdirSync(uploadsDir, { recursive: true });

// In production the API can also serve the built web app from the same
// origin (one service to deploy, no CORS, one CSP). Off unless the build
// exists or FRONTEND_DIST says where it is.
const defaultDist = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
const frontendDist = env.FRONTEND_DIST
  ? path.resolve(env.FRONTEND_DIST)
  : isProd && fs.existsSync(path.join(defaultDist, 'index.html'))
    ? defaultDist
    : null;

const llmProvider = (env.AI_LLM_PROVIDER || (env.ANTHROPIC_API_KEY ? 'anthropic' : 'none')).toLowerCase();
if (!['anthropic', 'mock', 'none'].includes(llmProvider)) {
  throw new Error(`AI_LLM_PROVIDER must be anthropic, mock or none (got "${llmProvider}").`);
}
if (llmProvider === 'anthropic' && !env.ANTHROPIC_API_KEY) {
  throw new Error('AI_LLM_PROVIDER=anthropic needs ANTHROPIC_API_KEY.');
}
if (llmProvider === 'mock' && isProd) {
  throw new Error('AI_LLM_PROVIDER=mock is for tests and demos only, not production.');
}
const embedder = (env.AI_EMBEDDER || 'classic').toLowerCase();
if (!['classic', 'clip', 'off'].includes(embedder)) {
  throw new Error(`AI_EMBEDDER must be classic, clip or off (got "${embedder}").`);
}

const MB = 1024 * 1024;

export const config = Object.freeze({
  env: nodeEnv,
  isProd,
  isTest,
  port,
  databaseUrl: env.DATABASE_URL,
  databaseSsl: bool(env.DATABASE_SSL, false),
  jwtSecret: env.JWT_SECRET,
  tokenTtl: env.TOKEN_TTL || '90d',
  allowedOrigins: list(env.ALLOWED_ORIGINS),
  trustProxy: env.TRUST_PROXY || null,
  publicBaseUrl,
  appUrl,
  uploadsDir,
  frontendDist,
  rateLimitDisabled: bool(env.RATE_LIMIT_DISABLED, false),
  logRequests: bool(env.LOG_REQUESTS, !isTest),
  // Tests run with no outside network; this makes every outbound fetch for a
  // user-supplied URL return "nothing found" at once instead of timing out.
  remoteFetchDisabled: isTest && bool(env.REMOTE_FETCH_DISABLED, false),
  smtp: {
    host: env.SMTP_HOST || null,
    port: int(env.SMTP_PORT, 587),
    secure: bool(env.SMTP_SECURE, false),
    user: env.SMTP_USER || null,
    pass: env.SMTP_PASS || null,
    from: env.MAIL_FROM || 'Moodloom <no-reply@localhost>',
  },
  ai: {
    llmProvider,
    anthropicKey: env.ANTHROPIC_API_KEY || null,
    model: env.AI_MODEL || 'claude-sonnet-5-5',
    embedder,
    clipModel: env.AI_CLIP_MODEL || 'Xenova/clip-vit-base-patch32',
    maxDirectionImages: int(env.AI_MAX_IMAGES, 10),
  },
  plans: {
    // Off by default so a local or early install is never locked out by a
    // limit. Turn on once pricing is decided.
    enforce: bool(env.ENFORCE_PLAN_LIMITS, false),
  },
  limits: {
    imageBytes: int(env.MAX_IMAGE_MB, 15) * MB,
    documentBytes: int(env.MAX_DOCUMENT_MB, 30) * MB,
    videoBytes: int(env.MAX_VIDEO_MB, 60) * MB,
    fileBytes: int(env.MAX_FILE_MB, 60) * MB,
    canvasBytes: 12 * MB,
    remoteImageBytes: 12 * MB,
    itemsPerProject: 2000,
  },
});
