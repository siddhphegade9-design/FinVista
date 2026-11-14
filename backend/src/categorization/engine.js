'use strict';
/**
 * Deterministic categorisation: no AI, no guessing. A description is normalised (lower case, letters and
 * digits only, single spaces) and compared with keyword rules as whole words. The user's own rules are
 * checked first, then the built-in rules; within a tier the longest matching keyword wins (then
 * alphabetical, so results are stable).
 */
const BUILTIN = require('./builtinRules');

/** "Swiggy*Order #4821 (BLR)" -> "swiggy order 4821 blr" */
function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9ऀ-ॿ]+/g, ' ') // keep Devanagari letters too
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when `pattern` (already normalised) occurs in `normalized` as whole words. */
const containsWords = (normalized, pattern) => pattern.length > 0 && ` ${normalized} `.includes(` ${pattern} `);

/** Words that say nothing about the merchant, so they are never suggested as a rule pattern. */
const NOISE = new Set([
  'upi', 'payment', 'paid', 'pay', 'to', 'from', 'for', 'the', 'and', 'order', 'purchase', 'pos', 'txn', 'transaction', 'ref', 'bill', 'neft', 'imps', 'rtgs',
  'debit', 'credit', 'card', 'online', 'transfer', 'via', 'ltd', 'pvt', 'private', 'limited', 'india', 'inc', 'bank', 'cash', 'withdrawal',
]);

/** Proposes a rule pattern for a description: its first meaningful word ("Swiggy order 123" -> "swiggy"), or ''. */
function suggestPattern(description) {
  const word = normalize(description).split(' ').find((w) => w.length >= 3 && !/^\d+$/.test(w) && !NOISE.has(w));
  return word ?? '';
}

/**
 * Builds a categoriser from the user's rules. userRules: [{ pattern, kind, categoryId, category }].
 * Returns { suggest(description, type) } where suggest gives
 *   { categoryId, category, source: 'user-rule' | 'builtin-rule', pattern }  or null.
 * `categoriesByKindName` maps `${kind}:${lowercase name}` to { id, name } for resolving built-in rules.
 */
function createCategorizer(userRules = [], categoriesByKindName = new Map()) {
  const pick = (candidates) => candidates.sort((a, b) => b.pattern.length - a.pattern.length || a.pattern.localeCompare(b.pattern))[0] ?? null;

  function suggest(description, type) {
    const text = normalize(description);
    if (!text) return null;

    const mine = pick(userRules.filter((r) => r.kind === type && containsWords(text, r.pattern)).map((r) => ({ ...r })));
    if (mine) return { categoryId: mine.categoryId, category: mine.category, source: 'user-rule', pattern: mine.pattern };

    const hits = [];
    for (const rule of BUILTIN) {
      if (rule.kind !== type) continue;
      const category = categoriesByKindName.get(`${rule.kind}:${rule.category.toLowerCase()}`);
      if (!category) continue; // the user deleted or renamed that category
      for (const keyword of rule.keywords) if (containsWords(text, keyword)) hits.push({ pattern: keyword, categoryId: category.id, category: category.name });
    }
    const builtin = pick(hits);
    return builtin ? { categoryId: builtin.categoryId, category: builtin.category, source: 'builtin-rule', pattern: builtin.pattern } : null;
  }

  return { suggest };
}

module.exports = { normalize, containsWords, suggestPattern, createCategorizer, BUILTIN };
