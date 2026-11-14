'use strict';
/** Validation for category and category-rule endpoints. Validators return { value } or { errors }. */
const { normalize } = require('../categorization/engine');
const { isUuid } = require('./transactions');

const KINDS = ['income', 'expense'];
const MAX_CATEGORIES_PER_USER = 60;
const result = (errors, value) => (Object.keys(errors).length ? { errors } : { value });
const cleanName = (raw) => (typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : '');
const NAME_ERROR = 'Enter a name (1 to 60 characters).';

function validateNewCategory(body = {}) {
  const errors = {};
  const name = cleanName(body.name);
  if (name.length < 1 || name.length > 60) errors.name = NAME_ERROR;
  if (!KINDS.includes(body.kind)) errors.kind = 'Choose income or expense.';
  return result(errors, { name, kind: body.kind });
}

function validateRename(body = {}) {
  const errors = {};
  const name = cleanName(body.name);
  if (name.length < 1 || name.length > 60) errors.name = NAME_ERROR;
  return result(errors, { name });
}

/** A rule pattern is stored normalised: letters, digits and single spaces, 3 to 60 characters. */
function validateRule(body = {}) {
  const errors = {};
  const pattern = normalize(body.pattern);
  if (typeof body.pattern !== 'string' || pattern.length < 3 || pattern.length > 60) errors.pattern = 'Enter 3 to 60 letters or digits, for example a merchant name.';
  else if (/^\d+$/.test(pattern.replace(/ /g, ''))) errors.pattern = 'The text to match must contain letters, not only digits.';
  if (!isUuid(body.categoryId)) errors.categoryId = 'Choose a category.';
  return result(errors, { pattern, categoryId: body.categoryId, applyToExisting: body.applyToExisting === true });
}

function validateCategorizeBody(body = {}) {
  const errors = {};
  if (typeof body.description !== 'string' || body.description.trim() === '' || body.description.length > 200) errors.description = 'Enter a description.';
  if (!KINDS.includes(body.type)) errors.type = 'Choose income or expense.';
  return result(errors, { description: body.description, type: body.type });
}

module.exports = { KINDS, MAX_CATEGORIES_PER_USER, validateNewCategory, validateRename, validateRule, validateCategorizeBody, cleanName };
