'use strict';
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { badRequest } = require('../utils/httpError');
const { requireAuth } = require('../middleware/auth');
const { checkMonth } = require('../validation/budgets');
const svc = require('../services/reports');

const router = express.Router();
router.use(requireAuth);

/** GET /api/reports/health-score */
router.get('/health-score', asyncHandler(async (req, res) => res.json(await svc.healthScore(req.user.id))));
/** GET /api/reports/monthly?month=YYYY-MM (default: this month) */
router.get('/monthly', asyncHandler(async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const error = checkMonth(month);
  if (error) throw badRequest('Please correct the highlighted fields.', { month: error });
  res.json(await svc.monthlyReport(req.user.id, month));
}));

module.exports = router;
