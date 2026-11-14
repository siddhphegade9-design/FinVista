'use strict';
const express = require('express');
const { name, version } = require('../../../package.json');
const db = require('../db/pool');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

/**
 * GET /api/health
 * database: "not_configured" (no DATABASE_URL), "ok", or "unreachable".
 * Returns 503 only when a database IS configured but cannot be reached.
 */
router.get('/', asyncHandler(async (req, res) => {
  let database = 'not_configured';
  if (db.isConfigured()) database = (await db.checkConnection()) ? 'ok' : 'unreachable';
  const degraded = database === 'unreachable';
  res.status(degraded ? 503 : 200).json({
    status: degraded ? 'degraded' : 'ok',
    service: name,
    version,
    database,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
}));

module.exports = router;
