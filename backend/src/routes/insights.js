'use strict';
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const svc = require('../services/insights');

/** GET /api/forecast -> projection of the next 3 months from the last complete months (labelled as a projection). */
const forecast = express.Router();
forecast.use(requireAuth);
forecast.get('/', asyncHandler(async (req, res) => res.json(await svc.getForecast(req.user.id))));

/** GET /api/anomalies -> unusual spending in the last 90 days, with a plain-language reason for each. */
const anomalies = express.Router();
anomalies.use(requireAuth);
anomalies.get('/', asyncHandler(async (req, res) => res.json(await svc.getAnomalies(req.user.id))));

module.exports = { forecast, anomalies };
