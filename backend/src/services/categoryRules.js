'use strict';
/**
 * The user's categorisation rules, the suggestion lookup, and re-applying rules to existing transactions.
 * Rules only ever change transactions whose category was chosen automatically ('default' or 'rule');
 * a category the user picked themselves ('user') is never overridden.
 */
const db = require('../db/pool');
const { badRequest, notFound } = require('../utils/httpError');
const engine = require('../categorization/engine');

const REAPPLY_LIMIT = 5000;

/** Loads the user's categories and rules once and returns helpers built on them. */
async function loadCategorizer(client, userId) {
  const [cats, rules] = await Promise.all([
    client.query('SELECT id, name, kind FROM categories WHERE user_id = $1', [userId]),
    client.query('SELECT r.id, r.pattern, r.kind, r.category_id, c.name AS category FROM category_rules r JOIN categories c ON c.id = r.category_id AND c.user_id = r.user_id WHERE r.user_id = $1', [userId]),
  ]);
  const byKindName = new Map(cats.rows.map((c) => [`${c.kind}:${c.name.toLowerCase()}`, { id: c.id, name: c.name }]));
  const categorizer = engine.createCategorizer(rules.rows.map((r) => ({ pattern: r.pattern, kind: r.kind, categoryId: r.category_id, category: r.category })), byKindName);
  const fallbackId = (kind) => byKindName.get(`${kind}:${kind === 'income' ? 'other income' : 'other'}`)?.id ?? null;
  return { suggest: categorizer.suggest, fallbackId, categories: cats.rows, byKindName };
}

async function listRules(userId) {
  const { rows } = await db.query(
    `SELECT r.id, r.pattern, r.kind, r.category_id, c.name AS category
       FROM category_rules r JOIN categories c ON c.id = r.category_id AND c.user_id = r.user_id
      WHERE r.user_id = $1 ORDER BY r.kind DESC, c.name, r.pattern`,
    [userId],
  );
  return rows.map((r) => ({ id: r.id, pattern: r.pattern, kind: r.kind, categoryId: r.category_id, category: r.category }));
}

/** Creates (or re-points, when the pattern already exists) a rule. Returns { rule, updated }. */
async function createRule(userId, { pattern, categoryId, applyToExisting }) {
  const { rows: cat } = await db.query('SELECT id, name, kind FROM categories WHERE id = $1 AND user_id = $2', [categoryId, userId]);
  if (!cat[0]) throw badRequest('Please correct the highlighted fields.', { categoryId: 'Choose one of your categories.' });
  const { rows } = await db.query(
    `INSERT INTO category_rules (user_id, pattern, category_id, kind) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, kind, pattern) DO UPDATE SET category_id = EXCLUDED.category_id
     RETURNING id`,
    [userId, pattern, cat[0].id, cat[0].kind],
  );
  const rule = { id: rows[0].id, pattern, kind: cat[0].kind, categoryId: cat[0].id, category: cat[0].name };
  const updated = applyToExisting ? (await reapply(userId, { dryRun: false })).applied : 0;
  return { rule, updated };
}

async function removeRule(userId, id) {
  const { rowCount } = await db.query('DELETE FROM category_rules WHERE id = $1 AND user_id = $2', [id, userId]);
  if (!rowCount) throw notFound('Rule not found.');
}

/** What would the rules do with this description? { suggestion, suggestedPattern } */
async function suggest(userId, { description, type }) {
  const c = await loadCategorizer(db, userId);
  return { suggestion: c.suggest(description, type), suggestedPattern: engine.suggestPattern(description) };
}

/**
 * Re-runs the rules over automatically categorised transactions ('default' and 'rule' sources) and moves
 * those whose suggestion differs from their current category. With dryRun it only reports what would change.
 */
async function reapply(userId, { dryRun }) {
  const c = await loadCategorizer(db, userId);
  const { rows } = await db.query(
    `SELECT t.id, t.description, t.type, t.category_id, cur.name AS current_category
       FROM transactions t JOIN categories cur ON cur.id = t.category_id AND cur.user_id = t.user_id
      WHERE t.user_id = $1 AND t.category_source IN ('default', 'rule')
      ORDER BY t.occurred_on DESC, t.id LIMIT ${REAPPLY_LIMIT}`,
    [userId],
  );
  const changes = [];
  for (const t of rows) {
    const s = c.suggest(t.description, t.type);
    if (s && s.categoryId !== t.category_id) changes.push({ id: t.id, description: t.description, from: t.current_category, to: s.category, toId: s.categoryId, pattern: s.pattern });
  }
  let applied = 0;
  if (!dryRun && changes.length) {
    const res = await db.query(
      `UPDATE transactions t SET category_id = x.cat, category_source = 'rule'
         FROM unnest($2::uuid[], $3::uuid[]) AS x(id, cat)
        WHERE t.id = x.id AND t.user_id = $1 AND t.category_source IN ('default', 'rule')`,
      [userId, changes.map((x) => x.id), changes.map((x) => x.toId)],
    );
    applied = res.rowCount;
  }
  return { checked: rows.length, matchedCount: changes.length, applied, changes: changes.slice(0, 100).map(({ toId, ...rest }) => rest) };
}

module.exports = { loadCategorizer, listRules, createRule, removeRule, suggest, reapply };
