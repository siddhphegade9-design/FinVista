'use strict';
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { badRequest, notFound } = require('../utils/httpError');
const { requireAuth } = require('../middleware/auth');
const { isUuid } = require('../validation/transactions');
const v = require('../validation/budgets');
const svc = require('../services/budgets');
const simulator = require('../services/simulator');

const validated = ({ errors, value }) => {
  if (errors) throw badRequest('Please correct the highlighted fields.', errors);
  return value;
};

/** /api/budgets */
const budgets = express.Router();
budgets.use(requireAuth);
/** GET /api/budgets?month=YYYY-MM (default: this month) */
budgets.get('/', asyncHandler(async (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const error = v.checkMonth(month);
  if (error) throw badRequest('Please correct the highlighted fields.', { month: error });
  res.json(await svc.getBudgets(req.user.id, month));
}));
budgets.get('/suggestions', asyncHandler(async (req, res) => res.json(await svc.suggestions(req.user.id))));
/** PUT /api/budgets { month, categoryId|null, limit } -> creates or updates that month's limit */
budgets.put('/', asyncHandler(async (req, res) => res.json({ budget: await svc.setBudget(req.user.id, validated(v.validateBudgetInput(req.body))) })));
budgets.post('/copy', asyncHandler(async (req, res) => res.json(await svc.copyBudgets(req.user.id, validated(v.validateCopy(req.body))))));
budgets.delete('/:id', asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id) || !(await svc.removeBudget(req.user.id, req.params.id))) throw notFound('Budget not found.');
  res.status(204).end();
}));

/** /api/simulator */
const sim = express.Router();
sim.use(requireAuth);
sim.get('/baseline', asyncHandler(async (req, res) => res.json(await simulator.baselineInfo(req.user.id))));
sim.post('/', asyncHandler(async (req, res) => res.json(await simulator.run(req.user.id, validated(v.validateSimulation(req.body))))));

module.exports = { budgets, simulator: sim };
