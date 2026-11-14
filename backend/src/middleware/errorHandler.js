'use strict';
/** Unified JSON error responses. Internal details are never leaked in production. */
const config = require('../config/env');

function notFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } });
}

/** Maps errors thrown by body-parser to stable codes. */
function bodyParserCode(err) {
  if (err.type === 'entity.parse.failed') return { status: 400, code: 'INVALID_JSON', message: 'Request body is not valid JSON.' };
  if (err.type === 'entity.too.large') return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' };
  return null;
}

/** Database not configured / not reachable -> 503 instead of a generic 500. */
function databaseCode(err) {
  if (err.code === 'DB_NOT_CONFIGURED') return { status: 503, code: 'DATABASE_NOT_CONFIGURED', message: 'The database is not configured.' };
  if (['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', '57P01', '08006', '08001'].includes(err.code) || /timeout exceeded when trying to connect/i.test(err.message || '')) {
    return { status: 503, code: 'DATABASE_UNAVAILABLE', message: 'The database is temporarily unavailable.' };
  }
  return null;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const mapped = bodyParserCode(err) ?? databaseCode(err);
  const status = mapped?.status ?? (Number.isInteger(err.status) ? err.status : 500);
  if (status >= 500 && !(mapped && status === 503)) console.error(err);
  const expose = status < 500 || !config.isProduction || (mapped && status === 503);
  const body = {
    code: mapped?.code ?? err.code ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'),
    message: mapped?.message ?? (expose ? err.message : 'Something went wrong.'),
  };
  if (err.details !== undefined && status < 500) body.details = err.details;
  res.status(status).json({ error: body });
}

module.exports = { notFound, errorHandler };
