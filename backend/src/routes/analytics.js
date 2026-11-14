'use strict';
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { badRequest } = require('../utils/httpError');
const { requireAuth } = require('../middleware/auth');
const calc = require('../analytics/calc');
const svc = require('../services/analytics');

const router = express.Router();
router.use(requireAuth);

/** GET /api/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD (default: the last 6 calendar months). */
router.get('/', asyncHandler(async (req, res) => {
  const { errors, value } = calc.parseRange(req.query);
  if (errors) throw badRequest('Please correct the highlighted fields.', errors);
  res.json(await svc.getAnalytics(req.user.id, value));
}));

module.exports = router;
