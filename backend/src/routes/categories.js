'use strict';
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { badRequest, notFound } = require('../utils/httpError');
const { requireAuth } = require('../middleware/auth');
const { isUuid } = require('../validation/transactions');
const v = require('../validation/categories');
const categories = require('../services/categories');
const rules = require('../services/categoryRules');
const { BUILTIN } = require('../categorization/engine');

const router = express.Router();
router.use(requireAuth);

const validated = ({ errors, value }) => {
  if (errors) throw badRequest('Please correct the highlighted fields.', errors);
  return value;
};
const idOr404 = (id, what) => { if (!isUuid(id)) throw notFound(`${what} not found.`); return id; };

/** GET /api/categories -> { categories: [{ id, name, kind, transactionCount, protected }] } */
router.get('/', asyncHandler(async (req, res) => res.json({ categories: await categories.list(req.user.id) })));

router.post('/', asyncHandler(async (req, res) => {
  res.status(201).json({ category: await categories.create(req.user.id, validated(v.validateNewCategory(req.body))) });
}));

/** GET /api/categories/rules -> the user's rules plus the read-only built-in keyword lists. */
router.get('/rules', asyncHandler(async (req, res) => {
  res.json({ rules: await rules.listRules(req.user.id), builtin: BUILTIN.map((r) => ({ category: r.category, kind: r.kind, keywords: r.keywords })) });
}));

/** POST /api/categories/rules { pattern, categoryId, applyToExisting? } -> 201 { rule, updated } */
router.post('/rules', asyncHandler(async (req, res) => {
  res.status(201).json(await rules.createRule(req.user.id, validated(v.validateRule(req.body))));
}));

router.delete('/rules/:id', asyncHandler(async (req, res) => {
  await rules.removeRule(req.user.id, idOr404(req.params.id, 'Rule'));
  res.status(204).end();
}));

/** POST /api/categories/suggest { description, type } -> { suggestion|null, suggestedPattern } */
router.post('/suggest', asyncHandler(async (req, res) => {
  res.json(await rules.suggest(req.user.id, validated(v.validateCategorizeBody(req.body))));
}));

/** POST /api/categories/reapply { dryRun? } -> what the rules would change (or changed) among auto-categorised transactions */
router.post('/reapply', asyncHandler(async (req, res) => {
  res.json(await rules.reapply(req.user.id, { dryRun: req.body?.dryRun !== false }));
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  res.json({ category: await categories.rename(req.user.id, idOr404(req.params.id, 'Category'), validated(v.validateRename(req.body))) });
}));

/** DELETE /api/categories/:id -> { reassigned, movedTo }. Transactions move to Other / Other income. */
router.delete('/:id', asyncHandler(async (req, res) => {
  res.json(await categories.remove(req.user.id, idOr404(req.params.id, 'Category')));
}));

module.exports = router;
