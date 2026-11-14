'use strict';
const path = require('path');
const express = require('express');
const config = require('./config/env');
const { securityHeaders } = require('./middleware/securityHeaders');
const { csrfGuard } = require('./middleware/csrf');
const { createRateLimiter } = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const apiRoutes = require('./routes');

const FRONTEND_DIR = path.join(__dirname, '..', '..', 'frontend');
const CHARTJS_DIR = path.join(__dirname, '..', '..', 'node_modules', 'chart.js', 'dist');

/** Files that live in frontend/ but are not part of the site: unit tests, package metadata and (in production) the dev styleguide. */
function blockNonPublicFiles(req, res, next) {
  let p;
  try { p = decodeURIComponent(req.path).toLowerCase(); } catch { return res.status(400).type('text/plain').send('Bad request'); }
  const blocked = /^\/(tests|node_modules)(\/|$)/.test(p) || p === '/package.json' || (config.isProduction && /^\/styleguide(\.html)?$/.test(p));
  if (blocked) return res.status(404).type('text/plain').send('Not found');
  return next();
}

/** Builds the Express app (separate from listen() so tests can use it). */
function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(express.json({ limit: '256kb' }));

  // API-wide protections: never cache, throttle per IP, block cross-site state changes.
  app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use('/api', createRateLimiter({ windowMs: 60_000, max: config.rateLimit.apiMax }));
  app.use('/api', csrfGuard);
  app.use('/api', apiRoutes);
  app.use('/api', notFound); // unknown API paths -> JSON 404

  // Chart.js is served from our own origin (no CDN) so the CSP stays strict.
  app.use('/vendor/chart.js', express.static(CHARTJS_DIR, { maxAge: '7d' }));
  app.use(blockNonPublicFiles);
  app.use(express.static(FRONTEND_DIR, { extensions: ['html'] }));

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
