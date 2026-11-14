'use strict';
/** Pure tests for transaction validation, import normalisation and CSV writing (no database needed). */
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../src/validation/transactions');
const { toCsv } = require('../src/utils/csv');

const NOW = new Date('2026-11-14T10:00:00Z');
const CAT = '3f2b1c9e-8a4d-4e6f-9b1a-2c3d4e5f6a7b';
const good = { type: 'expense', amount: '1,250.50', description: '  Groceries   at   BigBasket ', date: '2026-11-14', categoryId: CAT };

test('parseAmountPaise: exact decimal parsing, no float rounding', () => {
  assert.equal(v.parseAmountPaise('1,234.5'), 123450);
  assert.equal(v.parseAmountPaise('₹ 500'), 50000);
  assert.equal(v.parseAmountPaise(12.5), 1250);
  assert.equal(v.parseAmountPaise('0.07'), 7);
  assert.equal(v.parseAmountPaise('9999999999.99'), 999999999999);
  for (const bad of ['0', '0.00', '-5', '1.234', '', 'abc', '1e5', '10000000000', null, undefined, {}, [], NaN, Infinity]) {
    assert.equal(v.parseAmountPaise(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
  assert.equal(v.paiseToString(12550), '125.50');
  assert.equal(v.paiseToString(7), '0.07');
});

test('validateTransactionInput: accepts a good body and normalises it', () => {
  const { value, errors } = v.validateTransactionInput(good, NOW);
  assert.equal(errors, undefined);
  assert.deepEqual(value, { type: 'expense', amount: '1250.50', description: 'Groceries at BigBasket', date: '2026-11-14', categoryId: CAT });
});

test('validateTransactionInput: reports every bad field', () => {
  const { errors } = v.validateTransactionInput({ type: 'transfer', amount: '-1', description: '   ', date: '2026-02-30', categoryId: 'nope' }, NOW);
  assert.deepEqual(Object.keys(errors).sort(), ['amount', 'categoryId', 'date', 'description', 'type']);
});

test('dates: real calendar dates only, no far-future, no ancient', () => {
  assert.equal(v.checkIsoDate('2026-02-28', NOW), null);
  assert.ok(v.checkIsoDate('2026-02-29', NOW), '2026 is not a leap year');
  assert.equal(v.checkIsoDate('2024-02-29', NOW), null);
  assert.ok(v.checkIsoDate('2026-13-01', NOW));
  assert.ok(v.checkIsoDate('26-11-14', NOW));
  assert.ok(v.checkIsoDate('1980-01-01', NOW));
  assert.equal(v.checkIsoDate('2026-11-15', NOW), null, 'one day of timezone slack');
  assert.ok(v.checkIsoDate('2026-11-16', NOW));
  assert.ok(v.checkIsoDate(20261114, NOW));
});

test('description: control characters stripped, length enforced', () => {
  assert.ok(v.validateTransactionInput({ ...good, description: 'x'.repeat(201) }, NOW).errors.description);
  assert.equal(v.validateTransactionInput({ ...good, description: 'a\u0000b\nc' }, NOW).value.description, 'a b c');
});

test('validateFilters: defaults, bounds and bad input', () => {
  assert.deepEqual(v.validateFilters({}).value, { from: undefined, to: undefined, type: undefined, categoryId: undefined, q: undefined, minPaise: undefined, maxPaise: undefined, sort: 'date_desc', page: 1, pageSize: 20 });
  const ok = v.validateFilters({ from: '2026-01-01', to: '2026-01-31', type: 'income', q: ' rent ', minAmount: '100', maxAmount: '5,000', sort: 'amount_asc', page: '3', pageSize: '50' }).value;
  assert.equal(ok.q, 'rent'); assert.equal(ok.minPaise, 10000); assert.equal(ok.maxPaise, 500000); assert.equal(ok.page, 3);
  for (const bad of [{ from: '2026-1-1' }, { from: '2026-02-30' }, { from: '2026-02-01', to: '2026-01-01' }, { type: 'x' }, { categoryId: 'x' },
    { page: '0' }, { page: 'a' }, { pageSize: '101' }, { sort: 'name; drop table' }, { q: 'x'.repeat(101) }, { minAmount: '9', maxAmount: '1' }, { q: ['a', 'b'] }]) {
    assert.ok(v.validateFilters(bad).errors, `should reject ${JSON.stringify(bad)}`);
  }
  assert.equal(v.validateFilters({ page: '9', pageSize: '500' }, { paged: false }).errors, undefined, 'paging ignored for export');
});

test('import dates: ISO and day-first formats; rejects impossible dates', () => {
  assert.equal(v.parseImportDate('2026-11-04'), '2026-11-04');
  assert.equal(v.parseImportDate('04/11/2026'), '2026-11-04');
  assert.equal(v.parseImportDate('4-11-2026'), '2026-11-04');
  assert.equal(v.parseImportDate('04.11.2026'), '2026-11-04');
  assert.equal(v.parseImportDate('31/04/2026'), null);
  assert.equal(v.parseImportDate('11/25/2026'), null, 'month-first is not accepted');
  assert.equal(v.parseImportDate(''), null);
});

test('import rows: type rules, signs, accounting negatives, aliases', () => {
  const row = (o) => v.normalizeImportRow({ date: '2026-11-01', description: 'x', amount: '100', ...o }, NOW);
  assert.equal(row({ type: 'Income' }).value.type, 'income');
  assert.equal(row({ type: 'DEBIT' }).value.type, 'expense');
  assert.equal(row({ type: 'cr' }).value.type, 'income');
  assert.equal(row({ amount: '-100' }).value.type, 'expense');
  assert.equal(row({ amount: '(100.50)' }).value.type, 'expense');
  assert.equal(row({ amount: '(100.50)' }).value.amount, '100.50');
  assert.equal(row({ amount: '+100' }).value.type, 'income');
  assert.equal(row({ type: 'income', amount: '-100' }).value.type, 'income', 'explicit type wins');
  assert.ok(row({ type: 'refund' }).error);
  assert.ok(row({ amount: 'abc' }).error);
  assert.ok(row({ amount: '0' }).error);
  assert.ok(row({ date: '2099-01-01' }).error);
  assert.ok(row({ description: '  ' }).error);
  assert.ok(v.normalizeImportRow(null, NOW).error);
  assert.ok(v.normalizeImportRow([], NOW).error);
  assert.equal(row({ description: "'=SUM(A1)" }).value.description, '=SUM(A1)', 'undoes the export formula guard');
  assert.equal(row({ category: 'Food & Dining' }).value.categoryName, 'Food & Dining');
});

test('import body: row count limits', () => {
  assert.ok(v.validateImportBody({}).errors);
  assert.ok(v.validateImportBody({ rows: [] }).errors);
  assert.ok(v.validateImportBody({ rows: new Array(501).fill({}) }).errors);
  assert.equal(v.validateImportBody({ rows: [{}] }).value.skipDuplicates, true);
  assert.equal(v.validateImportBody({ rows: [{}], skipDuplicates: false }).value.skipDuplicates, false);
});

test('toCsv: quoting, CRLF, BOM and formula-injection guard', () => {
  const csv = toCsv([
    { d: 'a, "b"', n: '=HYPERLINK("http://evil")', m: '1.00' },
    { d: 'line\nbreak', n: '+1', m: '2.50' },
    { d: '@cmd', n: '-5', m: '3.00' },
  ], [{ header: 'Desc', get: (r) => r.d }, { header: 'Note', get: (r) => r.n }, { header: 'Amount', get: (r) => r.m, text: false }]);
  assert.ok(csv.startsWith('﻿Desc,Note,Amount\r\n'));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[1], `"a, ""b""","'=HYPERLINK(""http://evil"")",1.00`);
  assert.ok(csv.includes(`"line\nbreak",'+1,2.50`), 'embedded newline stays inside quotes; leading + is guarded');
  assert.ok(csv.includes("'@cmd,'-5,3.00"));
  assert.ok(csv.endsWith('\r\n'));
});
