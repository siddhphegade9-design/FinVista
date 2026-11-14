'use strict';
/**
 * Transaction persistence. Every query is parameterised and filtered by user_id, so a user can only
 * ever read or change their own rows. Sorting uses a fixed allow-list (validation.SORTS), never user text.
 */
const db = require('../db/pool');
const { badRequest } = require('../utils/httpError');
const { loadCategorizer } = require('./categoryRules');
const { SORTS, normalizeImportRow } = require('../validation/transactions');

const EXPORT_LIMIT = 50_000;
const ALL_LIMIT = 20_000;

const SELECT = `
  SELECT t.id, t.occurred_on, t.description, t.type, t.amount::text AS amount,
         t.category_id, c.name AS category, t.category_source
    FROM transactions t
    JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id`;

const toApi = (row) => ({
  id: row.id,
  date: row.occurred_on,
  description: row.description,
  type: row.type,
  amount: Number(row.amount),
  categoryId: row.category_id,
  category: row.category,
  categorySource: row.category_source,
});

const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

/** Builds the WHERE clause shared by list, summary and export. */
function buildWhere(userId, f) {
  const params = [userId];
  const conds = ['t.user_id = $1'];
  const add = (sql, value) => { params.push(value); conds.push(sql.replace('?', `$${params.length}`)); };
  if (f.from) add('t.occurred_on >= ?', f.from);
  if (f.to) add('t.occurred_on <= ?', f.to);
  if (f.type) add('t.type = ?', f.type);
  if (f.categoryId) add('t.category_id = ?', f.categoryId);
  if (f.q) add("t.description ILIKE ? ESCAPE '\\'", `%${escapeLike(f.q)}%`);
  if (f.minPaise !== undefined) add('t.amount >= ?', (f.minPaise / 100).toFixed(2));
  if (f.maxPaise !== undefined) add('t.amount <= ?', (f.maxPaise / 100).toFixed(2));
  return { where: conds.join(' AND '), params };
}

/** One page of matching transactions plus totals over ALL matches (not just this page). */
async function list(userId, f) {
  const { where, params } = buildWhere(userId, f);
  const offset = (f.page - 1) * f.pageSize;
  const [rows, totals] = await Promise.all([
    db.query(`${SELECT} WHERE ${where} ORDER BY ${SORTS[f.sort]} LIMIT ${f.pageSize} OFFSET ${offset}`, params),
    db.query(
      `SELECT count(*)::int AS count,
              COALESCE(sum(t.amount) FILTER (WHERE t.type = 'income'), 0)::text AS income,
              COALESCE(sum(t.amount) FILTER (WHERE t.type = 'expense'), 0)::text AS expenses
         FROM transactions t WHERE ${where}`,
      params,
    ),
  ]);
  const { count, income, expenses } = totals.rows[0];
  const net = Math.round(Number(income) * 100 - Number(expenses) * 100) / 100;
  return {
    transactions: rows.rows.map(toApi),
    pagination: { page: f.page, pageSize: f.pageSize, total: count, totalPages: Math.max(1, Math.ceil(count / f.pageSize)) },
    summary: { income: Number(income), expenses: Number(expenses), net, count },
  };
}

/** Everything the dashboard needs in one call (capped, and says so when it is). */
async function listAll(userId) {
  const { rows } = await db.query(`${SELECT} WHERE t.user_id = $1 ORDER BY t.occurred_on DESC, t.created_at DESC LIMIT ${ALL_LIMIT + 1}`, [userId]);
  const truncated = rows.length > ALL_LIMIT;
  return { transactions: rows.slice(0, ALL_LIMIT).map(toApi), truncated };
}

/** Rows for CSV export, same filters as list but no paging. */
async function listForExport(userId, f) {
  const { where, params } = buildWhere(userId, f);
  const { rows } = await db.query(`${SELECT} WHERE ${where} ORDER BY ${SORTS[f.sort]} LIMIT ${EXPORT_LIMIT}`, params);
  return rows.map(toApi);
}

async function getById(userId, id) {
  const { rows } = await db.query(`${SELECT} WHERE t.user_id = $1 AND t.id = $2`, [userId, id]);
  return rows[0] ? toApi(rows[0]) : null;
}

/** The category must belong to this user and match the transaction type. Gives a friendly 400 instead of an FK error. */
async function assertCategory(client, userId, categoryId, type) {
  const { rows } = await client.query('SELECT 1 FROM categories WHERE id = $1 AND user_id = $2 AND kind = $3', [categoryId, userId, type]);
  if (rows.length === 0) throw badRequest('Please correct the highlighted fields.', { categoryId: `Choose a ${type} category.` });
}

/**
 * Chooses the category and how it was chosen. With no categoryId the rules decide (source 'rule'), falling
 * back to Other / Other income (source 'default'). With a categoryId the user's choice is kept; it counts as
 * 'rule' only if it is exactly what the rules would have picked, otherwise 'user'.
 */
async function resolveCategory(userId, v, categorizer) {
  const suggestion = categorizer.suggest(v.description, v.type);
  if (!v.categoryId) {
    if (suggestion) return { categoryId: suggestion.categoryId, source: 'rule' };
    const fallback = categorizer.fallbackId(v.type);
    if (!fallback) throw badRequest('Please correct the highlighted fields.', { categoryId: `Choose a ${v.type} category.` });
    return { categoryId: fallback, source: 'default' };
  }
  await assertCategory(db, userId, v.categoryId, v.type);
  return { categoryId: v.categoryId, source: suggestion && suggestion.categoryId === v.categoryId ? 'rule' : 'user' };
}

async function create(userId, v) {
  const choice = await resolveCategory(userId, v, await loadCategorizer(db, userId));
  const { rows } = await db.query(
    `INSERT INTO transactions (user_id, category_id, type, amount, description, occurred_on, category_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [userId, choice.categoryId, v.type, v.amount, v.description, v.date, choice.source],
  );
  return getById(userId, rows[0].id);
}

/** Full replacement of the editable fields. Returns null if the row is not this user's. */
async function update(userId, id, v) {
  const existing = await getById(userId, id);
  if (!existing) return null;
  const choice = await resolveCategory(userId, v, await loadCategorizer(db, userId));
  // Saving other changes without touching the category must not turn an automatic category into a "user" one.
  const unchanged = existing.categoryId === choice.categoryId && existing.type === v.type;
  const source = unchanged ? existing.categorySource : choice.source;
  const { rowCount } = await db.query(
    `UPDATE transactions SET category_id = $3, type = $4, amount = $5, description = $6, occurred_on = $7, category_source = $8
      WHERE id = $2 AND user_id = $1`,
    [userId, id, choice.categoryId, v.type, v.amount, v.description, v.date, source],
  );
  return rowCount ? getById(userId, id) : null;
}

async function remove(userId, id) {
  const { rowCount } = await db.query('DELETE FROM transactions WHERE id = $1 AND user_id = $2', [id, userId]);
  return rowCount > 0;
}

/**
 * Imports parsed CSV rows. Each row is validated on its own; valid rows are inserted together in one
 * transaction. A category named in the file wins; otherwise the categorisation rules choose one
 * ('rule'); otherwise the row goes to "Other" / "Other income" ('default'). Both are counted so the caller
 * can tell the user. With skipDuplicates, rows identical (date, type, amount, description)
 * to an existing transaction are skipped.
 */
async function importRows(userId, rawRows, { skipDuplicates = true, now = new Date() } = {}) {
  const skipped = [];
  const valid = [];
  rawRows.forEach((raw, i) => {
    const out = normalizeImportRow(raw, now);
    if (out.error) skipped.push({ row: i + 1, message: out.error });
    else valid.push({ row: i + 1, ...out.value });
  });

  const c = await loadCategorizer(db, userId);
  const ready = [];
  for (const r of valid) {
    // 1) a category named in the file that exists  2) the categorisation rules  3) Other / Other income
    const named = r.categoryName ? c.byKindName.get(`${r.type}:${r.categoryName.toLowerCase()}`)?.id : undefined;
    let categoryId = named;
    let source = 'user';
    if (!categoryId) {
      const suggestion = c.suggest(r.description, r.type);
      if (suggestion) { categoryId = suggestion.categoryId; source = 'rule'; } else { categoryId = c.fallbackId(r.type); source = 'default'; }
    }
    if (!categoryId) { skipped.push({ row: r.row, message: `No "${r.type === 'income' ? 'Other income' : 'Other'}" category exists to use as a fallback.` }); continue; }
    ready.push({ ...r, categoryId, source });
  }

  let toInsert = ready;
  if (skipDuplicates && ready.length) {
    const dates = ready.map((r) => r.date).sort();
    const { rows } = await db.query(
      'SELECT occurred_on, type, amount::text AS amount, lower(description) AS d FROM transactions WHERE user_id = $1 AND occurred_on BETWEEN $2 AND $3',
      [userId, dates[0], dates[dates.length - 1]],
    );
    const existing = new Set(rows.map((r) => `${r.occurred_on}|${r.type}|${r.amount}|${r.d}`));
    toInsert = [];
    for (const r of ready) {
      if (existing.has(`${r.date}|${r.type}|${r.amount}|${r.description.toLowerCase()}`)) skipped.push({ row: r.row, message: 'Already exists (same date, type, amount and description).' });
      else toInsert.push(r);
    }
  }

  if (toInsert.length) {
    await db.withTransaction((client) => client.query(
      `INSERT INTO transactions (user_id, category_id, type, amount, description, occurred_on, category_source)
       SELECT $1, t.cat, t.typ, t.amt, t.descr, t.dt, t.src
         FROM unnest($2::uuid[], $3::text[], $4::numeric[], $5::text[], $6::date[], $7::text[]) AS t(cat, typ, amt, descr, dt, src)`,
      [userId, toInsert.map((r) => r.categoryId), toInsert.map((r) => r.type), toInsert.map((r) => r.amount), toInsert.map((r) => r.description), toInsert.map((r) => r.date), toInsert.map((r) => r.source)],
    ));
  }
  skipped.sort((a, b) => a.row - b.row);
  return {
    imported: toInsert.length, skipped,
    categorizedByRules: toInsert.filter((r) => r.source === 'rule').length,
    defaultedToOther: toInsert.filter((r) => r.source === 'default').length,
  };
}

module.exports = { list, listAll, listForExport, getById, create, update, remove, importRows };
