'use strict';
/** Category management. Every query is filtered by user_id. "Other" and "Other income" are protected fallbacks. */
const db = require('../db/pool');
const { badRequest, notFound, conflict } = require('../utils/httpError');
const { MAX_CATEGORIES_PER_USER } = require('../validation/categories');

const PROTECTED = new Set(['other', 'other income']);
const isProtected = (name) => PROTECTED.has(String(name).toLowerCase());

const toApi = (row) => ({ id: row.id, name: row.name, kind: row.kind, transactionCount: row.transaction_count ?? 0, protected: isProtected(row.name) });

/** All of the user's categories with how many transactions use each. Expenses first, fallbacks last in each group. */
async function list(userId) {
  const { rows } = await db.query(
    `SELECT c.id, c.name, c.kind, count(t.id)::int AS transaction_count
       FROM categories c LEFT JOIN transactions t ON t.category_id = c.id AND t.user_id = c.user_id
      WHERE c.user_id = $1
      GROUP BY c.id
      ORDER BY c.kind DESC, (lower(c.name) IN ('other', 'other income')), lower(c.name)`,
    [userId],
  );
  return rows.map(toApi);
}

async function create(userId, { name, kind }) {
  const { rows: count } = await db.query('SELECT count(*)::int AS n FROM categories WHERE user_id = $1', [userId]);
  if (count[0].n >= MAX_CATEGORIES_PER_USER) throw badRequest(`You can have at most ${MAX_CATEGORIES_PER_USER} categories.`, { name: 'Category limit reached.' });
  try {
    const { rows } = await db.query('INSERT INTO categories (user_id, name, kind) VALUES ($1, $2, $3) RETURNING id, name, kind', [userId, name, kind]);
    return toApi(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw conflict(`You already have a ${kind} category called "${name}".`);
    throw err;
  }
}

async function getOwned(client, userId, id) {
  const { rows } = await client.query('SELECT id, name, kind FROM categories WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!rows[0]) throw notFound('Category not found.');
  return rows[0];
}

async function rename(userId, id, { name }) {
  const current = await getOwned(db, userId, id);
  if (isProtected(current.name)) throw badRequest(`"${current.name}" is the fallback category and cannot be renamed.`, { name: 'This category cannot be renamed.' });
  if (isProtected(name)) throw badRequest('That name is reserved for the fallback categories.', { name: 'Choose another name.' });
  try {
    const { rows } = await db.query('UPDATE categories SET name = $3 WHERE id = $2 AND user_id = $1 RETURNING id, name, kind', [userId, id, name]);
    return toApi(rows[0]);
  } catch (err) {
    if (err.code === '23505') throw conflict(`You already have a ${current.kind} category called "${name}".`);
    throw err;
  }
}

/**
 * Deletes a category. Its transactions move to the fallback ("Other" / "Other income") and are marked
 * 'default' so rules can re-categorise them; its rules and budgets go with it (ON DELETE CASCADE).
 */
async function remove(userId, id) {
  return db.withTransaction(async (client) => {
    const current = await getOwned(client, userId, id);
    if (isProtected(current.name)) throw badRequest(`"${current.name}" is the fallback category and cannot be deleted.`);
    const fallbackName = current.kind === 'income' ? 'Other income' : 'Other';
    const { rows: fb } = await client.query('SELECT id FROM categories WHERE user_id = $1 AND kind = $2 AND lower(name) = lower($3)', [userId, current.kind, fallbackName]);
    if (!fb[0]) throw conflict(`The "${fallbackName}" category is missing, so transactions have nowhere to go.`);
    const moved = await client.query("UPDATE transactions SET category_id = $3, category_source = 'default' WHERE user_id = $1 AND category_id = $2", [userId, id, fb[0].id]);
    await client.query('DELETE FROM categories WHERE id = $1 AND user_id = $2', [id, userId]);
    return { reassigned: moved.rowCount, movedTo: fallbackName };
  });
}

module.exports = { list, create, rename, remove, isProtected };
