'use strict';
/**
 * Fixed-window, in-memory rate limiter (no dependency).
 * Limitation: counters live in this process, so with several server instances each has its own
 * budget. Use a shared store (e.g. Redis) if you scale out.
 */
function createRateLimiter({ windowMs, max, keyFn = (req) => req.ip, skipSuccessful = false, now = Date.now, message = 'Too many requests. Please try again later.' }) {
  const hits = new Map(); // key -> { count, resetAt }

  const sweep = setInterval(() => {
    const t = now();
    for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
  }, Math.max(windowMs, 60_000));
  sweep.unref();

  function middleware(req, res, next) {
    const key = keyFn(req);
    if (key == null) return next();
    const t = now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= t) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - t) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message, retryAfterSeconds: retryAfter } });
    }
    if (skipSuccessful) {
      res.on('finish', () => { if (res.statusCode < 400 && entry.count > 0) entry.count -= 1; });
    }
    return next();
  }
  middleware.reset = () => hits.clear();
  return middleware;
}

module.exports = { createRateLimiter };
