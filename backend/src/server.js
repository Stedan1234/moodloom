import { config } from './config.js';
import { createApp } from './app.js';
import { pool } from './db/pool.js';
import { queueBacklog } from './services/items.js';
import { embedderStatus } from './services/ai/embedders/index.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Moodloom backend listening on http://localhost:${config.port}`);
  console.log(
    `  AI: direction notes ${config.ai.llmProvider === 'none' ? 'off (no ANTHROPIC_API_KEY)' : `via ${config.ai.llmProvider}`}; ` +
      `similarity via ${embedderStatus().active || 'nothing (AI_EMBEDDER=off)'}`
  );
  if (config.frontendDist) console.log(`  Serving the web app from ${config.frontendDist}`);
  if (config.rateLimitDisabled) console.warn('  WARNING: rate limiting is disabled (RATE_LIMIT_DISABLED). Never run a public server like this.');

  queueBacklog()
    .then((n) => n > 0 && console.log(`  Analysing ${n} reference(s) in the background.`))
    .catch((err) => console.error('Could not queue the analysis backlog:', err.message));
});

// Finish in-flight requests, then close the pool, when the host asks the
// process to stop (a deploy, a restart).
function shutdown(signal) {
  console.log(`${signal} received, shutting down.`);
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
