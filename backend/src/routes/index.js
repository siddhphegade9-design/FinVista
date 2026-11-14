'use strict';
/** Mounts every API router under /api. New feature routers are registered here. */
const express = require('express');
const health = require('./health');
const auth = require('./auth');
const transactions = require('./transactions');
const categories = require('./categories');
const analytics = require('./analytics');
const insights = require('./insights');
const investments = require('./investments');
const budgetRoutes = require('./budgets');
const advisor = require('./advisor');
const tax = require('./tax');
const reports = require('./reports');

const router = express.Router();
router.use('/health', health);
router.use('/auth', auth);
router.use('/transactions', transactions);
router.use('/categories', categories);
router.use('/analytics', analytics);
router.use('/forecast', insights.forecast);
router.use('/anomalies', insights.anomalies);
router.use('/sips', investments.sips);
router.use('/insurance', investments.insurance);
router.use('/budgets', budgetRoutes.budgets);
router.use('/simulator', budgetRoutes.simulator);
router.use('/advisor', advisor);
router.use('/tax', tax);
router.use('/reports', reports);

module.exports = router;
