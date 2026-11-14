'use strict';
const config = require('./config/env');
const { createApp } = require('./app');
const { closePool, isConfigured } = require('./db/pool');
const { purgeExpired } = require('./auth/sessions');

if (config.isProduction && !isConfigured()) {
  console.error('DATABASE_URL is not set. Refusing to start in production without a database. See docs/DEPLOYMENT.md.');
  process.exit(1);
}

const server = createApp().listen(config.port, () => {
  console.log(`FinVista running at http://localhost:${config.port} (${config.nodeEnv})`);
  console.log(config.groq.apiKey ? `AI advisor: enabled (Groq), model ${config.groq.model}` : 'AI advisor: disabled (GROQ_API_KEY not set)');
  if (!isConfigured()) console.warn('DATABASE_URL is not set: database features are disabled. See .env.example.');
});

// Remove expired sessions at startup and hourly. Failures are logged, never fatal.
if (isConfigured()) {
  const purge = () => purgeExpired().catch((err) => console.warn('Session cleanup skipped:', err.message));
  purge();
  setInterval(purge, 60 * 60 * 1000).unref();
}

// Stop accepting connections, then release database connections.
function shutdown() {
  // Force exit if open keep-alive connections stop the server closing cleanly.
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
  if (server.closeIdleConnections) server.closeIdleConnections();
}
// Log, then exit so a supervisor restarts a process that may be in an unknown state.
process.on('unhandledRejection', (reason) => { console.error('Unhandled rejection:', reason instanceof Error ? reason.message : reason); shutdown(); });
process.on('uncaughtException', (err) => { console.error('Uncaught exception:', err.message); shutdown(); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
