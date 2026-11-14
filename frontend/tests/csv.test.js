import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, rowsFromCsv, detectDelimiter, chunk } from '../js/transactions/csv.js';

test('parseCsv: plain rows, CRLF and LF, trailing newline, blank lines skipped', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n\r\n3,4\n').rows, [['a', 'b'], ['1', '2'], ['3', '4']]);
  assert.deepEqual(parseCsv('a,b\n1,2').rows, [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('').rows, []);
});

test('parseCsv: quotes, escaped quotes, delimiters and newlines inside cells', () => {
  const { rows } = parseCsv('d,n\n"a, b","say ""hi"""\n"line1\nline2",x\n');
  assert.deepEqual(rows, [['d', 'n'], ['a, b', 'say "hi"'], ['line1\nline2', 'x']]);
});

test('parseCsv: BOM removed, empty quoted cell kept, unclosed quote reported', () => {
  assert.deepEqual(parseCsv('﻿a,b\n"",2').rows, [['a', 'b'], ['', '2']]);
  assert.match(parseCsv('a,b\n"oops,2').error, /never closed/);
});

test('detectDelimiter: comma, semicolon, tab; ignores delimiters inside quotes', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.equal(detectDelimiter('"a,b,c";d\n'), ';');
  assert.equal(detectDelimiter('single'), ',');
  assert.deepEqual(parseCsv('Date;Amount\n01/02/2026;1,5').rows, [['Date', 'Amount'], ['01/02/2026', '1,5']]);
});

test('rowsFromCsv: maps headers case-insensitively with bank-style aliases', () => {
  const out = rowsFromCsv('Transaction Date,Narration,Amt,CR/DR,Category\n2026-11-01,Salary,"60,000",CR,Salary\n');
  assert.equal(out.hasTypeColumn, true);
  assert.equal(out.hasCategoryColumn, true);
  assert.deepEqual(out.rows, [{ date: '2026-11-01', description: 'Salary', amount: '60,000', type: 'CR', category: 'Salary' }]);
});

test('rowsFromCsv: type and category are optional, required columns are enforced', () => {
  const ok = rowsFromCsv('date,description,amount\n01/11/2026,Rent,-15000');
  assert.equal(ok.hasTypeColumn, false);
  assert.equal(ok.rows[0].type, '');
  assert.match(rowsFromCsv('date,amount\n1,2').error, /Missing column: description/);
  assert.match(rowsFromCsv('foo,bar\n1,2').error, /Missing columns: date, description, amount/);
  assert.match(rowsFromCsv('date,description,amount').error, /no transactions/);
  assert.match(rowsFromCsv('').error, /empty/);
  assert.match(rowsFromCsv('date,description,amount\n1,2,3\n4,5,6', { maxRows: 1 }).error, /at most 1/);
});

test('rowsFromCsv: short rows give empty cells (the server then reports them)', () => {
  assert.deepEqual(rowsFromCsv('date,description,amount\n2026-01-01,Only desc').rows[0], { date: '2026-01-01', description: 'Only desc', amount: '', type: '', category: '' });
});

test('chunk: splits into batches', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 2), []);
});
