'use strict';
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { badRequest, HttpError } = require('../utils/httpError');
const { requireAuth } = require('../middleware/auth');
const v = require('../validation/tax');
const svc = require('../services/tax');

const router = express.Router();
router.use(requireAuth);
// Indian income tax only makes sense for an Indian (INR) account. For any other currency the whole tool is closed.
router.use((req, res, next) => (req.user.currency === 'INR' ? next() : next(new HttpError(403, 'TAX_INDIA_ONLY', 'Tax estimation is only available in India (INR accounts). Your account currency is ' + req.user.currency + '.'))));

const validated = ({ errors, value }) => {
  if (errors) throw badRequest('Please correct the highlighted fields.', errors);
  return value;
};
const yearOf = (raw) => {
  const year = raw === undefined ? v.DEFAULT_YEAR : raw;
  const e = v.checkYear(year);
  if (e) throw badRequest('Please correct the highlighted fields.', { year: e });
  return year;
};

/** GET /api/tax/rules: the rule sets the calculator knows about, with limits and when they were last checked. */
router.get('/rules', (req, res) => res.json({ defaultYear: v.DEFAULT_YEAR, cities: svc.CITY_CHOICES, years: svc.rulesSummary() }));
/** GET /api/tax/profile?year= */
router.get('/profile', asyncHandler(async (req, res) => res.json({ year: yearOf(req.query.year), profile: await svc.getProfile(req.user.id, yearOf(req.query.year)) })));
/** PUT /api/tax/profile?year= { ...inputs } saves the figures */
router.put('/profile', asyncHandler(async (req, res) => {
  const year = yearOf(req.query.year);
  res.json({ year, profile: await svc.saveProfile(req.user.id, year, validated(v.validateInputs(req.body))) });
}));
/** GET /api/tax/suggestions?year= figures worked out from the user's SIP and insurance records */
router.get('/suggestions', asyncHandler(async (req, res) => res.json(await svc.suggestions(req.user.id, yearOf(req.query.year)))));
/** POST /api/tax/calculate { year, ...inputs } compares both regimes. Nothing is saved. */
router.post('/calculate', asyncHandler(async (req, res) => {
  const year = yearOf(req.body && req.body.year);
  res.json({ year, result: svc.calculate(year, validated(v.validateInputs(req.body))) });
}));

module.exports = router;
