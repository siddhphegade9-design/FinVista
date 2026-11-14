'use strict';
/**
 * Central, validated runtime configuration.
 * All environment access goes through this module so the rest of the code
 * never reads process.env directly and secrets stay in one place.
 */
require('dotenv').config();

const NODE_ENV = process.env.NODE_ENV || 'development';

function parsePort(value, fallback) {
  const port = Number.parseInt(value ?? '', 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const config = Object.freeze({
  nodeEnv: NODE_ENV,
  isProduction: NODE_ENV === 'production',
  port: parsePort(process.env.PORT, 3000),
  databaseUrl: process.env.DATABASE_URL || '',
  // Set DATABASE_SSL=true for hosted Postgres that requires TLS.
  databaseSsl: process.env.DATABASE_SSL === 'true',
  // Set TRUST_PROXY=true only when running behind a reverse proxy you control (so client IPs are read correctly).
  trustProxy: process.env.TRUST_PROXY === 'true',
  session: Object.freeze({
    cookieName: 'fv_session',
    ttlDays: parsePositiveInt(process.env.SESSION_TTL_DAYS, 7),
  }),
  rateLimit: Object.freeze({
    // General API limit per IP per minute.
    apiMax: parsePositiveInt(process.env.API_RATE_LIMIT_PER_MIN, 300),
    // Login/register/password attempts per IP (and per email) per window.
    authMax: parsePositiveInt(process.env.AUTH_RATE_LIMIT_MAX, 10),
    authWindowMs: parsePositiveInt(process.env.AUTH_RATE_LIMIT_WINDOW_MIN, 15) * 60_000,
  }),
  // AI advisor provider: Groq (free plan, no billing). Backend-only; the key never reaches the browser.
  groq: Object.freeze({
    apiKey: process.env.GROQ_API_KEY || '',
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
    // Only change the base URL to point at a proxy or (in tests) a local fake server.
    baseUrl: (process.env.GROQ_API_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
    timeoutMs: parsePositiveInt(process.env.GROQ_TIMEOUT_MS, 30_000),
    // gpt-oss models accept low, medium or high. Lower = faster and uses fewer of the free plan's tokens.
    reasoningEffort: ['low', 'medium', 'high'].includes((process.env.GROQ_REASONING_EFFORT || '').trim().toLowerCase()) ? process.env.GROQ_REASONING_EFFORT.trim().toLowerCase() : 'low',
    // Upper bound on the reply (reasoning + answer). Kept modest because the free plan allows 8,000 tokens per minute.
    maxOutputTokens: parsePositiveInt(process.env.GROQ_MAX_OUTPUT_TOKENS, 1500),
  }),
  advisor: Object.freeze({
    // Advisor questions allowed per user per hour (the free plan has shared daily limits, see docs/ADVISOR.md).
    maxPerHour: parsePositiveInt(process.env.ADVISOR_MAX_PER_HOUR, 20),
  }),
});

module.exports = config;
