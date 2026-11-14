import test from 'node:test';
import assert from 'node:assert/strict';
import {
  monthOf, shiftMonth, summarizeMonth, spendingByCategory, monthlySeries,
  budgetUtilization, overallBudgetRatio, recentTransactions, changeRatio, cumulativeSavings,
} from '../js/dashboard/metrics.js';

const T = [
  { id: 'a1', date: '2026-10-05', description: 'Salary', category: 'Salary', type: 'income', amount: 80000 },
  { id: 'a2', date: '2026-10-09', description: 'Rent', category: 'Housing', type: 'expense', amount: 25000 },
  { id: 'a3', date: '2026-11-01', description: 'Salary', category: 'Salary', type: 'income', amount: 85000.5 },
  { id: 'a4', date: '2026-11-03', description: 'Groceries', category: 'Food & Dining', type: 'expense', amount: 0.1 },
  { id: 'a5', date: '2026-11-03', description: 'Dinner', category: 'Food & Dining', type: 'expense', amount: 0.2 },
  { id: 'a6', date: '2026-11-10', description: 'Metro', category: 'Transport', type: 'expense', amount: 500 },
  { id: 'a7', date: '2026-11-12', description: 'Rent', category: 'Housing', type: 'expense', amount: 25000 },
];

test('monthOf / shiftMonth handle year boundaries', () => {
  assert.equal(monthOf('2026-11-14'), '2026-11');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-11', 2), '2027-01');
  assert.equal(shiftMonth('2026-11', 0), '2026-11');
});

test('summarizeMonth totals only that month', () => {
  const s = summarizeMonth(T, '2026-11');
  assert.equal(s.income, 85000.5);
  assert.equal(s.expenses, 25500.3); // 0.1 + 0.2 must not become 0.30000000000000004
  assert.equal(s.savings, 59500.2);
  assert.ok(Math.abs(s.savingsRate - 59500.2 / 85000.5) < 1e-12);
  assert.equal(s.transactionCount, 5);
});

test('summarizeMonth on empty month: zeros and null savings rate', () => {
  const s = summarizeMonth(T, '2026-01');
  assert.deepEqual([s.income, s.expenses, s.savings, s.savingsRate, s.transactionCount], [0, 0, 0, null, 0]);
});

test('savings can be negative when expenses exceed income', () => {
  const s = summarizeMonth([{ id: 'x', date: '2026-11-01', description: '', category: 'Other', type: 'income', amount: 100 }, { id: 'y', date: '2026-11-02', description: '', category: 'Other', type: 'expense', amount: 150 }], '2026-11');
  assert.equal(s.savings, -50);
  assert.equal(s.savingsRate, -0.5);
});

test('spendingByCategory sums expenses only, sorted desc', () => {
  const r = spendingByCategory(T, '2026-11');
  assert.deepEqual(r.map((x) => x.category), ['Housing', 'Transport', 'Food & Dining']);
  assert.equal(r[2].amount, 0.3);
});

test('monthlySeries returns count months oldest first, ending at endMonth', () => {
  const s = monthlySeries(T, '2026-11', 3);
  assert.deepEqual(s.map((m) => m.month), ['2026-09', '2026-10', '2026-11']);
  assert.equal(s[1].income, 80000);
});

test('budgetUtilization statuses and remaining', () => {
  const spending = [{ category: 'Food', amount: 4000 }, { category: 'Travel', amount: 900 }, { category: 'Fun', amount: 1200 }];
  const u = budgetUtilization([
    { category: 'Food', limit: 10000 }, { category: 'Travel', limit: 1000 }, { category: 'Fun', limit: 1000 }, { category: 'Gym', limit: 500 },
  ], spending);
  assert.deepEqual(u.map((x) => x.status), ['ok', 'warning', 'over', 'ok']);
  assert.equal(u[2].remaining, -200);
  assert.equal(u[3].spent, 0);
  assert.ok(Math.abs(overallBudgetRatio(u) - 6100 / 12500) < 1e-12);
});

test('budget with zero limit has null ratio; no budgets gives null overall', () => {
  const u = budgetUtilization([{ category: 'X', limit: 0 }], []);
  assert.equal(u[0].ratio, null);
  assert.equal(overallBudgetRatio([]), null);
});

test('recentTransactions orders newest first and limits', () => {
  const r = recentTransactions(T, 3);
  assert.deepEqual(r.map((t) => t.id), ['a7', 'a6', 'a5']);
});

test('changeRatio', () => {
  assert.equal(changeRatio(110, 100), 0.1);
  assert.equal(changeRatio(50, 0), null);
});

test('cumulativeSavings is all-time income minus expenses', () => {
  assert.equal(cumulativeSavings(T), 114500.2);
  assert.equal(cumulativeSavings([]), 0);
});
