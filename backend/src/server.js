import 'express-async-errors'; // must be imported before any router that uses async handlers
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { authRouter } from './routes/auth.js';
import { projectsRouter } from './routes/projects.js';
import { boardItemsRouter } from './routes/boardItems.js';
import { workspaceRouter } from './routes/workspace.js';

dotenv.config();

const app = express();

// CORS is wide open for local dev because the browser extension (task 2) calls
// this API from an extension origin, not a normal web origin — tighten this
// (allowlist the deployed extension ID + web app origin) before shipping past dogfooding.
app.use(cors());
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
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Moodloom backend listening on http://localhost:${PORT}`);
});
