'use strict';
/**
 * Baseline security headers. Implemented by hand to avoid an extra dependency
 * at this stage; may be swapped for `helmet` in the hardening milestone.
 *
 * The CSP only allows our own origin (Chart.js is served locally from
 * /vendor, fonts use the system stack), so no third-party origins are needed.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const config = require('../config/env');

function securityHeaders(req, res, next) {
  res.removeHeader('X-Powered-By');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

module.exports = { securityHeaders, CSP };
