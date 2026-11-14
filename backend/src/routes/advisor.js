'use strict';
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { badRequest } = require('../utils/httpError');
const { requireAuth } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimit');
const config = require('../config/env');
const { validateAsk } = require('../ai/prompt');
const advisor = require('../services/advisor');

const router = express.Router();
router.use(requireAuth);

/** GET /api/advisor/status -> whether the server has an AI key (never the key), the suggested questions, limits */
router.get('/status', (req, res) => res.json(advisor.status()));

/** GET /api/advisor/data -> exactly the figures the advisor is given (transparency; nothing is sent to the AI provider) */
router.get('/data', asyncHandler(async (req, res) => res.json({ facts: await advisor.getFacts(req.user.id) })));

const askLimiter = createRateLimiter({
  windowMs: 3_600_000, max: config.advisor.maxPerHour, keyFn: (req) => req.user?.id ?? null,
  message: 'You have reached the hourly limit for advisor questions. Please try again later.',
});

/** POST /api/advisor/ask { preset? , question? } */
router.post('/ask', asyncHandler(async (req, res, next) => {
  const { errors, value } = validateAsk(req.body);
  if (errors) throw badRequest('Please correct the highlighted fields.', errors);
  req.askValue = value;
  next();
}), askLimiter, asyncHandler(async (req, res) => res.json(await advisor.ask(req.user.id, req.askValue))));

module.exports = router;
