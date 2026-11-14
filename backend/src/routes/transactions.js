'use strict';
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { badRequest, notFound } = require('../utils/httpError');
const { requireAuth } = require('../middleware/auth');
const { toCsv } = require('../utils/csv');
const svc = require('../services/transactions');
const v = require('../validation/transactions');

const router = express.Router();
router.use(requireAuth); // every route below touches user data

const validated = ({ errors, value }) => {
  if (errors) throw badRequest('Please correct the highlighted fields.', errors);
  return value;
};
/** A malformed id can never match a row, so it is a 404 rather than a database error. */
const idOr404 = (id) => { if (!v.isUuid(id)) throw notFound('Transaction not found.'); return id; };

/** GET /api/transactions?from&to&type&categoryId&q&minAmount&maxAmount&sort&page&pageSize */
router.get('/', asyncHandler(async (req, res) => {
  res.json(await svc.list(req.user.id, validated(v.validateFilters(req.query))));
}));

/** GET /api/transactions/all -> every transaction (compact), for the dashboard calculations. */
router.get('/all', asyncHandler(async (req, res) => {
  res.json(await svc.listAll(req.user.id));
}));

/** GET /api/transactions/export -> CSV download of the filtered set (same filters as the list). */
router.get('/export', asyncHandler(async (req, res) => {
  const filters = validated(v.validateFilters(req.query, { paged: false }));
  const rows = await svc.listForExport(req.user.id, filters);
  const csv = toCsv(rows, [
    { header: 'Date', get: (r) => r.date, text: false },
    { header: 'Description', get: (r) => r.description },
    { header: 'Type', get: (r) => r.type, text: false },
    { header: 'Category', get: (r) => r.category },
    { header: 'Amount', get: (r) => r.amount.toFixed(2), text: false },
  ]);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="finvista-transactions-${stamp}.csv"`);
  res.send(csv);
}));

/** POST /api/transactions/import { rows: [{date, description, amount, type?, category?}], skipDuplicates? } */
router.post('/import', asyncHandler(async (req, res) => {
  const { rows, skipDuplicates } = validated(v.validateImportBody(req.body));
  res.json(await svc.importRows(req.user.id, rows, { skipDuplicates }));
}));

/** POST /api/transactions { type, amount, description, date, categoryId } -> 201 { transaction } */
router.post('/', asyncHandler(async (req, res) => {
  const value = validated(v.validateTransactionInput(req.body));
  res.status(201).json({ transaction: await svc.create(req.user.id, value) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const tx = await svc.getById(req.user.id, idOr404(req.params.id));
  if (!tx) throw notFound('Transaction not found.');
  res.json({ transaction: tx });
}));

/** PUT /api/transactions/:id  same body as create (full replacement of the editable fields). */
router.put('/:id', asyncHandler(async (req, res) => {
  const id = idOr404(req.params.id);
  const tx = await svc.update(req.user.id, id, validated(v.validateTransactionInput(req.body)));
  if (!tx) throw notFound('Transaction not found.');
  res.json({ transaction: tx });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  if (!(await svc.remove(req.user.id, idOr404(req.params.id)))) throw notFound('Transaction not found.');
  res.status(204).end();
}));

module.exports = router;
