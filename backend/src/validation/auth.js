'use strict';
/**
 * Input validation for auth endpoints. Each validator returns
 * { value } on success or { errors: { field: message } } on failure.
 * Strings are trimmed/normalised here; passwords are never trimmed or altered.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 10;
const MAX_PASSWORD = 128; // upper bound stops huge inputs being used to burn CPU in scrypt

// A tiny blocklist of the most common passwords that still pass a length check.
const COMMON = new Set([
  'password12', 'password123', 'password1234', '1234567890', '12345678910', 'qwertyuiop', 'qwerty12345',
  'iloveyou123', 'admin12345', 'welcome123', 'letmein1234', 'abcdefghij', '0123456789', 'passw0rd123',
]);

const isString = (v) => typeof v === 'string';

function normalizeEmail(raw) {
  return isString(raw) ? raw.trim().toLowerCase() : '';
}

function checkEmail(raw, errors) {
  const email = normalizeEmail(raw);
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';
  return email;
}

function checkName(raw, errors) {
  const name = isString(raw) ? raw.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > 100) errors.fullName = 'Enter your name (2 to 100 characters).';
  return name;
}

function checkNewPassword(raw, errors, field = 'password', email = '') {
  if (!isString(raw) || raw.length < MIN_PASSWORD) errors[field] = `Use at least ${MIN_PASSWORD} characters.`;
  else if (raw.length > MAX_PASSWORD) errors[field] = `Use at most ${MAX_PASSWORD} characters.`;
  else if (COMMON.has(raw.toLowerCase()) || (email && raw.toLowerCase() === email)) errors[field] = 'That password is too easy to guess. Choose another.';
  return raw;
}

const result = (errors, value) => (Object.keys(errors).length ? { errors } : { value });

const { DEFAULT_CURRENCY, CODES, isSupported } = require('../config/currencies');

/** Optional on registration (defaults to INR). */
function checkCurrency(raw, errors, { optional = false } = {}) {
  if (optional && (raw === undefined || raw === null || raw === '')) return DEFAULT_CURRENCY;
  if (!isSupported(raw)) { errors.currency = `Choose one of: ${CODES.join(', ')}.`; return null; }
  return raw;
}

function validateCurrency(body = {}) {
  const errors = {};
  const currency = checkCurrency(body.currency, errors);
  return result(errors, { currency });
}

function validateRegistration(body = {}) {
  const errors = {};
  const email = checkEmail(body.email, errors);
  const fullName = checkName(body.fullName, errors);
  const password = checkNewPassword(body.password, errors, 'password', email);
  const currency = checkCurrency(body.currency, errors, { optional: true });
  return result(errors, { email, fullName, password, currency });
}

function validateLogin(body = {}) {
  const errors = {};
  const email = normalizeEmail(body.email);
  if (!email || email.length > 254) errors.email = 'Enter your email address.';
  if (!isString(body.password) || body.password.length === 0 || body.password.length > MAX_PASSWORD) errors.password = 'Enter your password.';
  return result(errors, { email, password: body.password });
}

function validateProfile(body = {}) {
  const errors = {};
  const fullName = checkName(body.fullName, errors);
  return result(errors, { fullName });
}

function validatePasswordChange(body = {}, email = '') {
  const errors = {};
  if (!isString(body.currentPassword) || !body.currentPassword || body.currentPassword.length > MAX_PASSWORD) errors.currentPassword = 'Enter your current password.';
  const newPassword = checkNewPassword(body.newPassword, errors, 'newPassword', email);
  if (!errors.newPassword && newPassword === body.currentPassword) errors.newPassword = 'Choose a password different from your current one.';
  return result(errors, { currentPassword: body.currentPassword, newPassword });
}

function validatePasswordConfirm(body = {}) {
  const errors = {};
  if (!isString(body.password) || !body.password || body.password.length > MAX_PASSWORD) errors.password = 'Enter your password to confirm.';
  return result(errors, { password: body.password });
}

module.exports = {
  validateRegistration, validateCurrency, validateLogin, validateProfile, validatePasswordChange, validatePasswordConfirm,
  MIN_PASSWORD, MAX_PASSWORD,
};
