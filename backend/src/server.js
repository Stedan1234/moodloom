import 'express-async-errors'; // must be imported before any router that uses async handlers
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { authRouter } from './routes/auth.js';
import { projectsRouter } from './routes/projects.js';
import { boardItemsRouter } from './routes/boardItems.js';
import { workspaceRouter } from './routes/workspace.js';
import { corsOptions } from './config/cors.js';

dotenv.config();

const app = express();

// express-rate-limit (below) keys its counters off req.ip. Behind a reverse
// proxy/load balancer, req.ip is the PROXY's address unless Express is told
// to trust the X-Forwarded-For header it sets — without this, every real
// client would share one rate-limit bucket (or the proxy's own IP would get
// blocked instead of the actual abuser). Only enable this once actually
// deployed behind a known, trusted proxy (set TRUST_PROXY, e.g. to "1" for
// one hop) — trusting it by default on plain localhost would let a client
// spoof X-Forwarded-For to bypass rate limiting entirely.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', process.env.TRUST_PROXY);
}

// Allowlists the web app's own origin(s) (via ALLOWED_ORIGINS) plus any
// chrome-extension:// origin (see config/cors.js for why that's safe) —
// replaces the previous wide-open cors() with no restriction at all.
app.use(cors(corsOptions()));
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'moodloom-backend' });
});

app.use('/auth', authRouter);
app.use('/projects', projectsRouter);
app.use('/projects/:projectId/items', boardItemsRouter);
app.use('/projects/:projectId/workspace', workspaceRouter);

// Catch-all error handler. `express-async-errors` (imported above) makes any
// rejected promise inside a route handler land here instead of hanging the request.
app.use((err, req, res, next) => {
  if (err.message?.startsWith('Origin ') && err.message?.includes('not allowed by CORS')) {
    return res.status(403).json({ error: 'This origin is not allowed to call this API.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Moodloom backend listening on http://localhost:${PORT}`);
});
