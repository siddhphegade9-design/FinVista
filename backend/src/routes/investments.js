'use strict';
const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { badRequest, notFound } = require('../utils/httpError');
const { requireAuth } = require('../middleware/auth');
const { isUuid } = require('../validation/transactions');
const v = require('../validation/investments');
const svc = require('../services/investments');

const validated = ({ errors, value }) => {
  if (errors) throw badRequest('Please correct the highlighted fields.', errors);
  return value;
};
const idOr404 = (id, what) => { if (!isUuid(id)) throw notFound(`${what} not found.`); return id; };

/** /api/sips: SIP records with projections. */
const sips = express.Router();
sips.use(requireAuth);
sips.get('/', asyncHandler(async (req, res) => res.json(await svc.listSips(req.user.id))));
sips.post('/calculate', asyncHandler(async (req, res) => res.json(svc.calculate(validated(v.validateCalculator(req.body))))));
sips.post('/', asyncHandler(async (req, res) => res.status(201).json({ sip: await svc.createSip(req.user.id, validated(v.validateSip(req.body))) })));
sips.put('/:id', asyncHandler(async (req, res) => {
  const sip = await svc.updateSip(req.user.id, idOr404(req.params.id, 'Investment'), validated(v.validateSip(req.body)));
  if (!sip) throw notFound('Investment not found.');
  res.json({ sip });
}));
sips.delete('/:id', asyncHandler(async (req, res) => {
  if (!(await svc.removeSip(req.user.id, idOr404(req.params.id, 'Investment')))) throw notFound('Investment not found.');
  res.status(204).end();
}));

/** /api/insurance: policy records with renewal status. */
const insurance = express.Router();
insurance.use(requireAuth);
insurance.get('/', asyncHandler(async (req, res) => res.json(await svc.listPolicies(req.user.id))));
insurance.post('/', asyncHandler(async (req, res) => res.status(201).json({ policy: await svc.createPolicy(req.user.id, validated(v.validatePolicy(req.body))) })));
insurance.put('/:id', asyncHandler(async (req, res) => {
  const policy = await svc.updatePolicy(req.user.id, idOr404(req.params.id, 'Policy'), validated(v.validatePolicy(req.body)));
  if (!policy) throw notFound('Policy not found.');
  res.json({ policy });
}));
insurance.delete('/:id', asyncHandler(async (req, res) => {
  if (!(await svc.removePolicy(req.user.id, idOr404(req.params.id, 'Policy')))) throw notFound('Policy not found.');
  res.status(204).end();
}));

module.exports = { sips, insurance };
