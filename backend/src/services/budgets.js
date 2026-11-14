'use strict';
/** Budgets: per-user, per-month limits for expense categories (and an optional overall limit). */
const db = require('../db/pool');
const { badRequest, notFound } = require('../utils/httpError');
const calc = require('../budgets/calc');
const currencies = require('../config/currencies');
const users = require('./users');

const monthStart = (month) => `${month}-01`;
const todayIso = (now) => now.toISOString().slice(0, 10);
const MAX_PER_MONTH = 80;

async function getBudgets(userId, month, now = new Date()) {
  const [b, s] = await Promise.all([
    db.query(`SELECT b.id, b.category_id, c.name, b.limit_amount::text AS limit_amount
                FROM budgets b LEFT JOIN categories c ON c.id = b.category_id AND c.user_id = b.user_id
               WHERE b.user_id = $1 AND b.month = $2`, [userId, monthStart(month)]),
    db.query(`SELECT c.id AS category_id, c.name, sum(t.amount)::text AS amount
                FROM transactions t JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
               WHERE t.user_id = $1 AND t.type = 'expense' AND t.occurred_on >= $2::date AND t.occurred_on < ($2::date + interval '1 month')
               GROUP BY c.id, c.name`, [userId, monthStart(month)]),
  ]);
  return calc.buildBudgetView({
    month, today: todayIso(now),
    budgets: b.rows.map((r) => ({ id: r.id, categoryId: r.category_id, name: r.name, limit: r.limit_amount })),
    spent: s.rows.map((r) => ({ categoryId: r.category_id, name: r.name, amount: r.amount })),
  });
}

async function assertExpenseCategory(userId, categoryId) {
  const { rows } = await db.query('SELECT kind FROM categories WHERE id = $1 AND user_id = $2', [categoryId, userId]);
  if (!rows[0]) throw badRequest('Please correct the highlighted fields.', { categoryId: 'Choose one of your categories.' });
  if (rows[0].kind !== 'expense') throw badRequest('Please correct the highlighted fields.', { categoryId: 'Budgets are for expense categories.' });
}

/** Creates or updates the limit for (month, category). categoryId null = the overall budget. */
async function setBudget(userId, { month, categoryId, limit }) {
  if (categoryId) await assertExpenseCategory(userId, categoryId);
  const { rows: count } = await db.query('SELECT count(*)::int AS n FROM budgets WHERE user_id = $1 AND month = $2', [userId, monthStart(month)]);
  if (count[0].n >= MAX_PER_MONTH) throw badRequest(`A month can have up to ${MAX_PER_MONTH} budgets.`);
  const { rows } = await db.query(
    `INSERT INTO budgets (user_id, category_id, month, limit_amount) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, month, COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO UPDATE SET limit_amount = EXCLUDED.limit_amount
     RETURNING id, category_id, to_char(month, 'YYYY-MM') AS month, limit_amount::text AS limit_amount`,
    [userId, categoryId, monthStart(month), limit],
  );
  return { id: rows[0].id, categoryId: rows[0].category_id, month: rows[0].month, limit: Number(rows[0].limit_amount) };
}

async function removeBudget(userId, id) {
  return (await db.query('DELETE FROM budgets WHERE id = $1 AND user_id = $2', [id, userId])).rowCount > 0;
}

/** Copies budgets from one month to another, skipping categories that already have one there. */
async function copyBudgets(userId, { fromMonth, toMonth }) {
  const { rows: src } = await db.query('SELECT 1 FROM budgets WHERE user_id = $1 AND month = $2 LIMIT 1', [userId, monthStart(fromMonth)]);
  if (!src.length) throw badRequest('Nothing to copy.', { fromMonth: 'That month has no budgets.' });
  const { rowCount } = await db.query(
    `INSERT INTO budgets (user_id, category_id, month, limit_amount)
     SELECT user_id, category_id, $3::date, limit_amount FROM budgets WHERE user_id = $1 AND month = $2
     ON CONFLICT (user_id, month, COALESCE(category_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING`,
    [userId, monthStart(fromMonth), monthStart(toMonth)],
  );
  return { copied: rowCount };
}

async function suggestions(userId, now = new Date()) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1)).toISOString().slice(0, 10);
  const { rows } = await db.query(
    `SELECT to_char(date_trunc('month', t.occurred_on), 'YYYY-MM') AS month, c.id AS category_id, c.name, sum(t.amount)::text AS amount
       FROM transactions t JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
      WHERE t.user_id = $1 AND t.type = 'expense' AND t.occurred_on >= $2 GROUP BY 1, 2, 3`, [userId, from]);
  const currency = await users.getCurrency(userId);
  const unit = currencies.info(currency).budgetRound;
  const out = calc.suggestBudgets(rows.map((r) => ({ month: r.month, categoryId: r.category_id, name: r.name, amount: r.amount })), todayIso(now), unit * 100);
  return { ...out, note: `Suggestions are the average of your own recent months, rounded up to the next ${currencies.formatMoney(unit, currency)}. They describe what you spent, not what you should spend.` };
}

module.exports = { getBudgets, setBudget, removeBudget, copyBudgets, suggestions, notFound };
