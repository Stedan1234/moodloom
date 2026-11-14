import 'express-async-errors'; // must load before any router with async handlers
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import multer from 'multer';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { HttpError } from './lib/errors.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { INLINE_EXTENSIONS } from './services/files.js';
import { authRouter } from './routes/auth.js';
import { accountRouter } from './routes/account.js';
import { projectsRouter } from './routes/projects.js';
import { boardItemsRouter } from './routes/boardItems.js';
import { categoriesRouter } from './routes/categories.js';
import { workspaceRouter } from './routes/workspace.js';
import { canvasRouter } from './routes/canvas.js';
import { brandKitRouter } from './routes/brandKit.js';
import { aiRouter } from './routes/ai.js';
import { projectSharingRouter, publicSharingRouter } from './routes/sharing.js';

function corsOptions() {
  // The web app's origin(s) come from ALLOWED_ORIGINS. The browser extension
  // calls from chrome-extension://<id>, allowed generically: this API has no
  // cookies or other ambient credentials to hand over, only bearer tokens a
  // caller already holds, so allowing the scheme grants nothing by itself.
  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true); // curl, same-origin, server-to-server
      if (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) return callback(null, true);
      if (config.allowedOrigins.includes(origin) || origin === config.appUrl) return callback(null, true);
      callback(new HttpError(403, 'This origin is not allowed to call this API.', 'CORS'));
    },
    maxAge: 600,
  };
}

// Content-Security-Policy for the web app when this server also serves it.
// Scripts only from our own origin (no inline, no eval), so even if markup
// were ever injected it could not run code or send the stored token away.
function appCsp() {
  return {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      // The editor and canvas libraries set styles on elements directly.
      styleSrc: ["'self'", "'unsafe-inline'"],
      // References are images from anywhere on the web.
      imgSrc: ["'self'", 'data:', 'blob:', 'https:', ...(config.isProd ? [] : ['http:'])],
      mediaSrc: ["'self'", 'blob:', 'https:'],
      fontSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      frameSrc: ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
    },
  };
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // Rate limiting keys off req.ip. Behind a reverse proxy that is the
  // proxy's address unless Express is told to trust X-Forwarded-For; trusting
  // it when NOT behind one would let any client spoof its way round the limits.
  if (config.trustProxy) app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);

  // Security headers on everything. The API itself returns JSON, so it gets
  // the strictest possible policy; /uploads and the web app set their own.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    })
  );

  if (config.logRequests) {
    app.use((req, res, next) => {
      const started = Date.now();
      res.on('finish', () => {
        // Log the matched route pattern, never the raw URL: share and invite
        // links carry their secret in the path.
        const route = req.route ? `${req.baseUrl}${req.route.path}` : req.path.startsWith('/api') ? '(unmatched api route)' : '(static)';
        if (route !== '(static)') console.log(`${req.method} ${route} ${res.statusCode} ${Date.now() - started}ms`);
      });
      next();
    });
  }

  app.get(['/health', '/api/health'], async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, service: 'moodloom-backend' });
    } catch {
      res.status(503).json({ ok: false, service: 'moodloom-backend' });
    }
  });

  // Uploaded files. They are user-supplied bytes, so each response is locked
  // down: no MIME sniffing, a sandboxing CSP (an SVG or PDF opened directly
  // can't run script or reach this origin's storage), and anything that
  // isn't a known previewable type is sent as a download.
  app.use(
    '/uploads',
    cors(),
    express.static(config.uploadsDir, {
      dotfiles: 'ignore',
      index: false,
      fallthrough: false,
      maxAge: '365d',
      immutable: true,
      setHeaders(res, filePath) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
        const ext = path.extname(filePath).slice(1).toLowerCase();
        if (!INLINE_EXTENSIONS.has(ext)) res.setHeader('Content-Disposition', 'attachment');
      },
    }),
    // express.static with fallthrough:false raises on a miss; make it a plain 404.
    (err, req, res, next) => {
      // A miss, a dotfile, a malformed or traversal path: all just "not found".
      const status = err.status || err.statusCode;
      if (status && status < 500) return res.status(404).json({ error: 'Not found' });
      next(err);
    }
  );

  const api = express.Router();
  api.use(helmet.contentSecurityPolicy({ useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }));
  api.use(cors(corsOptions()));
  api.use(apiLimiter);
  // The sketch canvas embeds images, so it alone gets a larger body limit.
  api.use('/projects/:projectId/canvas', express.json({ limit: '16mb' }));
  api.use(express.json({ limit: '1mb' }));

  api.use('/auth', authRouter);
  api.get('/auth/me', (req, res, next) => {
    req.url = '/me';
    accountRouter(req, res, next);
  });
  api.use('/account', accountRouter);
  api.use('/projects', projectsRouter);
  api.use('/projects/:projectId/items', boardItemsRouter);
  api.use('/projects/:projectId/categories', categoriesRouter);
  api.use('/projects/:projectId/workspace', workspaceRouter);
  api.use('/projects/:projectId/canvas', canvasRouter);
  api.use('/projects/:projectId/brand', brandKitRouter);
  api.use('/projects/:projectId/ai', aiRouter);
  api.use('/projects/:projectId', projectSharingRouter);
  api.use('/', publicSharingRouter);
  api.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  // Optionally serve the built web app from this same origin.
  if (config.frontendDist) {
    const csp = helmet.contentSecurityPolicy(appCsp());
    app.use(csp, express.static(config.frontendDist, { index: false, maxAge: '1h' }));
    app.get('*', csp, (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.frontendDist, 'index.html'));
    });
  }

  // Everything that goes wrong lands here. Known errors keep their status
  // and message; anything unexpected is logged in full on the server and
  // reported to the client as a bare 500 with no internals.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return res.destroy();
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    }
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: 'That upload could not be read.', code: 'BAD_UPLOAD' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'That request is too large.', code: 'TOO_LARGE' });
    }
    if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
      return res.status(400).json({ error: 'The request body is not valid JSON.', code: 'BAD_JSON' });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
