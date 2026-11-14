'use strict';
/** Validation for tax estimator input. Money is rupees per year. Returns { value } or { errors }. */
const { RULES, YEARS, DEFAULT_YEAR, CITY_CHOICES } = require('../tax/rules');

const AGES = ['under60', '60-79', '80+'];
const MONEY_FIELDS = {
  grossSalary: 'Gross salary', basicSalary: 'Basic salary', hraReceived: 'HRA received', rentPaid: 'Rent paid',
  interestSavings: 'Savings account interest', interestDeposits: 'Deposit interest', otherIncome: 'Other income',
  employerNps: 'Employer NPS contribution', section80C: 'Section 80C investments', section80CCD1B: 'Extra NPS contribution',
  section80DSelf: 'Health insurance premium (self and family)', section80DParents: 'Health insurance premium (parents)',
  section80E: 'Education loan interest', homeLoanInterest: 'Home loan interest',
};
const MAX_MONEY = 1e10;

function parseMoney(raw) {
  if (raw === undefined || raw === null || raw === '') return 0;
  const text = String(raw).replace(/[₹,\s]/g, '');
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(text)) return null;
  const n = Number(text);
  return n <= MAX_MONEY ? n : null;
}

function checkYear(year) {
  return typeof year === 'string' && YEARS.includes(year) ? null : `Choose one of: ${YEARS.join(', ')}.`;
}

function validateInputs(body = {}) {
  const errors = {};
  const value = {};
  for (const [k, label] of Object.entries(MONEY_FIELDS)) {
    const n = parseMoney(body[k]);
    if (n === null) errors[k] = `${label}: enter an amount in rupees (numbers only, at most 2 decimals).`;
    else value[k] = n;
  }
  value.age = body.age === undefined || body.age === '' ? 'under60' : body.age;
  if (!AGES.includes(value.age)) errors.age = 'Choose an age group.';
  value.city = body.city === undefined || body.city === '' ? 'Other' : body.city;
  if (value.city !== 'Other' && !CITY_CHOICES.includes(value.city)) errors.city = 'Choose a city or "Other city".';
  value.parentsSenior = body.parentsSenior === true || body.parentsSenior === 'true';
  if (!errors.grossSalary && !errors.basicSalary && value.basicSalary > value.grossSalary) errors.basicSalary = 'Basic salary cannot be more than gross salary.';
  if (!errors.hraReceived && !errors.grossSalary && value.hraReceived > value.grossSalary) errors.hraReceived = 'HRA cannot be more than gross salary.';
  return Object.keys(errors).length ? { errors } : { value };
}

module.exports = { validateInputs, checkYear, MONEY_FIELDS, AGES, DEFAULT_YEAR, RULES };
