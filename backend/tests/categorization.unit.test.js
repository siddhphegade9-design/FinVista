'use strict';
/** Pure tests for the categorisation engine and the built-in rule data. */
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('../src/categorization/engine');
const BUILTIN = require('../src/categorization/builtinRules');
const defaults = require('../src/config/defaultCategories');
const v = require('../src/validation/categories');

const cats = new Map();
for (const kind of ['expense', 'income']) for (const name of defaults[kind]) cats.set(`${kind}:${name.toLowerCase()}`, { id: `id-${name}`, name });
const plain = engine.createCategorizer([], cats);
const withRules = (rules) => engine.createCategorizer(rules, cats);
const name = (s) => s?.category ?? null;

test('normalize: case, punctuation, ampersands, whitespace', () => {
  assert.equal(engine.normalize('Swiggy*Order #4821 (BLR)'), 'swiggy order 4821 blr');
  assert.equal(engine.normalize('  Food & Dining  '), 'food and dining');
  assert.equal(engine.normalize(null), '');
  assert.equal(engine.normalize('A---B___C'), 'a b c');
});

test('built-in rules match whole words only', () => {
  assert.equal(name(plain.suggest('Monthly rent', 'expense')), 'Housing');
  assert.equal(plain.suggest('Parental leave top-up', 'expense'), null, '"rent" inside "parental" must not match');
  assert.equal(plain.suggest('Rental car', 'expense'), null);
  assert.equal(plain.suggest('Swiggyx', 'expense'), null);
  assert.equal(name(plain.suggest('SWIGGY*ORDER #1', 'expense')), 'Food & Dining');
  assert.equal(name(plain.suggest('Booking.com Goa', 'expense')), 'Travel', 'dots become spaces: "booking com"');
  assert.equal(name(plain.suggest('Amazon Pay', 'expense')), 'Shopping');
});

test('built-in rules respect the transaction type', () => {
  assert.equal(name(plain.suggest('Dividend HDFC', 'income')), 'Investments');
  assert.equal(plain.suggest('Dividend HDFC', 'expense'), null);
  assert.equal(name(plain.suggest('Salary credit Nov', 'income')), 'Salary');
  assert.equal(plain.suggest('Salary credit Nov', 'expense'), null);
});

test('unknown or empty descriptions give no suggestion', () => {
  assert.equal(plain.suggest('Bolagh', 'expense'), null);
  assert.equal(plain.suggest('', 'expense'), null);
  assert.equal(plain.suggest('   ', 'expense'), null);
});

test('longest matching keyword wins inside the built-in tier', () => {
  const s = plain.suggest('Pizza Hut dinner', 'expense');
  assert.equal(s.pattern, 'pizza hut');
  assert.equal(s.source, 'builtin-rule');
});

test("the user's rules beat the built-in ones, are kind-specific, and the longest user pattern wins", () => {
  const mine = withRules([
    { pattern: 'swiggy', kind: 'expense', categoryId: 'id-Shopping', category: 'Shopping' },
    { pattern: 'swiggy instamart', kind: 'expense', categoryId: 'id-Housing', category: 'Housing' },
    { pattern: 'acme', kind: 'income', categoryId: 'id-Freelance', category: 'Freelance' },
  ]);
  assert.equal(name(mine.suggest('Swiggy dinner', 'expense')), 'Shopping');
  assert.equal(name(mine.suggest('Swiggy Instamart order', 'expense')), 'Housing');
  assert.equal(mine.suggest('Swiggy dinner', 'expense').source, 'user-rule');
  assert.equal(name(mine.suggest('ACME Ltd payout', 'income')), 'Freelance');
  assert.equal(mine.suggest('ACME Ltd payout', 'expense'), null, 'an income rule never applies to an expense');
});

test('a deleted or renamed built-in target is skipped, not guessed', () => {
  const smaller = new Map([...cats].filter(([k]) => k !== 'expense:food & dining'));
  assert.equal(engine.createCategorizer([], smaller).suggest('Swiggy', 'expense'), null);
});

test('suggestPattern picks the first meaningful word', () => {
  assert.equal(engine.suggestPattern('UPI payment to Swiggy order 123'), 'swiggy');
  assert.equal(engine.suggestPattern('Zomato'), 'zomato');
  assert.equal(engine.suggestPattern('NEFT 123456 Acme Corp'), 'acme');
  assert.equal(engine.suggestPattern('123 45'), '');
  assert.equal(engine.suggestPattern('to'), '');
  assert.equal(engine.suggestPattern(''), '');
});

test('built-in rule data is consistent', () => {
  const seen = new Map();
  for (const rule of BUILTIN) {
    assert.ok(defaults[rule.kind].includes(rule.category), `${rule.category} must be a default ${rule.kind} category`);
    for (const k of rule.keywords) {
      assert.equal(engine.normalize(k), k, `keyword "${k}" must already be normalised`);
      assert.ok(k.length >= 3, `keyword "${k}" is too short`);
      const key = `${rule.kind}:${k}`;
      assert.ok(!seen.has(key), `keyword "${k}" appears in both ${seen.get(key)} and ${rule.category}`);
      seen.set(key, rule.category);
    }
  }
  assert.ok(Object.isFrozen(BUILTIN));
});

test('validation: rules, categories, suggest requests', () => {
  const id = '3f2b1c9e-8a4d-4e6f-9b1a-2c3d4e5f6a7b';
  assert.deepEqual(v.validateRule({ pattern: '  Swiggy!! ', categoryId: id }).value, { pattern: 'swiggy', categoryId: id, applyToExisting: false });
  assert.equal(v.validateRule({ pattern: 'x', categoryId: id }).errors.pattern.length > 0, true);
  assert.ok(v.validateRule({ pattern: '12345', categoryId: id }).errors.pattern, 'digits only is not a merchant');
  assert.ok(v.validateRule({ pattern: 'a'.repeat(61), categoryId: id }).errors.pattern);
  assert.ok(v.validateRule({ pattern: 'swiggy', categoryId: 'nope' }).errors.categoryId);
  assert.ok(v.validateRule({ pattern: 42, categoryId: id }).errors.pattern);
  assert.equal(v.validateRule({ pattern: 'swiggy', categoryId: id, applyToExisting: true }).value.applyToExisting, true);
  assert.equal(v.validateRule({ pattern: 'swiggy', categoryId: id, applyToExisting: 'yes' }).value.applyToExisting, false);
  assert.deepEqual(v.validateNewCategory({ name: '  Pets  &  Care ', kind: 'expense' }).value, { name: 'Pets & Care', kind: 'expense' });
  assert.ok(v.validateNewCategory({ name: '', kind: 'expense' }).errors.name);
  assert.ok(v.validateNewCategory({ name: 'x'.repeat(61), kind: 'expense' }).errors.name);
  assert.ok(v.validateNewCategory({ name: 'Ok', kind: 'savings' }).errors.kind);
  assert.ok(v.validateRename({ name: ' ' }).errors.name);
  assert.ok(v.validateCategorizeBody({ description: '', type: 'expense' }).errors.description);
  assert.ok(v.validateCategorizeBody({ description: 'x', type: 'y' }).errors.type);
});
