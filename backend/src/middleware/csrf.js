'use strict';
/**
 * CSRF defence for cookie-authenticated JSON APIs, layered on SameSite=Lax cookies:
 *  1. Browsers mark cross-site requests with Sec-Fetch-Site / Origin: reject those that are not same-origin.
 *  2. Mutating requests that carry a body must be application/json, which a plain cross-site <form> cannot send.
 */
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function csrfGuard(req, res, next) {
  if (SAFE.has(req.method)) return next();

  const site = req.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return res.status(403).json({ error: { code: 'CROSS_SITE_BLOCKED', message: 'Cross-site requests are not allowed.' } });
  }
  const origin = req.get('origin');
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === req.get('host'); } catch { ok = false; }
    if (!ok) return res.status(403).json({ error: { code: 'CROSS_SITE_BLOCKED', message: 'Cross-site requests are not allowed.' } });
  }
  // Only requests that actually carry a body need a JSON content type. (A body-less POST such as
  // logout still sends "Content-Length: 0", which req.is() would otherwise treat as a non-JSON body.)
  const hasBody = Number(req.get('content-length') || 0) > 0 || Boolean(req.get('transfer-encoding'));
  if (hasBody && !req.is('application/json')) {
    return res.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Send JSON with Content-Type: application/json.' } });
  }
  return next();
}

module.exports = { csrfGuard };
