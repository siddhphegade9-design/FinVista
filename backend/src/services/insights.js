'use strict';
/** Forecast and unusual-spending queries. Always scoped to the user; the maths lives in insights/. */
const db = require('../db/pool');
const { buildForecast } = require('../insights/forecast');
const { detectAnomalies } = require('../insights/anomalies');
const investments = require('./investments');
const users = require('./users');

const HISTORY_MONTHS = 12;
const MAX_ROWS = 20_000;

const startOfHistory = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - HISTORY_MONTHS, 1)).toISOString().slice(0, 10);

async function getForecast(userId, now = new Date()) {
  const from = startOfHistory(now);
  const [monthly, byCategory] = await Promise.all([
    db.query(`SELECT to_char(date_trunc('month', occurred_on), 'YYYY-MM') AS month, type, sum(amount)::text AS amount
                FROM transactions WHERE user_id = $1 AND occurred_on >= $2 GROUP BY 1, 2`, [userId, from]),
    db.query(`SELECT to_char(date_trunc('month', t.occurred_on), 'YYYY-MM') AS month, c.name AS category, sum(t.amount)::text AS amount
                FROM transactions t JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
               WHERE t.user_id = $1 AND t.type = 'expense' AND t.occurred_on >= $2 GROUP BY 1, 2`, [userId, from]),
  ]);
  const forecast = buildForecast(monthly.rows, byCategory.rows, now);
  // Planned commitments are reported beside the projection, not added to it: if the user also records SIP debits
  // or premiums as transactions they are already in the history, and adding them again would double count.
  forecast.commitments = {
    ...(await investments.commitments(userId, now)),
    note: 'Planned monthly outflows from your SIP and insurance records. They are not added to the projection above: if you also record them as transactions, they are already in your history.',
  };
  return forecast;
}

async function getAnomalies(userId, now = new Date()) {
  const { rows } = await db.query(
    `SELECT t.id, t.occurred_on AS date, t.description, t.amount::text AS amount, c.name AS category
       FROM transactions t JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
      WHERE t.user_id = $1 AND t.type = 'expense' AND t.occurred_on >= $2
      ORDER BY t.occurred_on DESC, t.id LIMIT ${MAX_ROWS}`,
    [userId, startOfHistory(now)],
  );
  const anomalies = detectAnomalies(rows, now, { currency: await users.getCurrency(userId) });
  return {
    checked: rows.length,
    anomalies,
    notice: 'These are transactions that look different from your usual pattern. They are not accusations of fraud or error: a gift, an annual premium or a one-off repair will often show up here.',
  };
}

module.exports = { getForecast, getAnomalies };
