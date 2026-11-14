import test from 'node:test';
import assert from 'node:assert/strict';
import { rangeForPreset, checkCustomRange, monthName, PRESETS } from '../js/analytics/ranges.js';

const NOW = new Date(2026, 10, 14, 15, 0); // 14 Nov 2026, local time

test('presets: rolling month ranges start on the 1st and end today', () => {
  assert.deepEqual(rangeForPreset('6m', NOW), { from: '2026-06-01', to: '2026-11-14' });
  assert.deepEqual(rangeForPreset('3m', NOW), { from: '2026-09-01', to: '2026-11-14' });
  assert.deepEqual(rangeForPreset('12m', NOW), { from: '2025-12-01', to: '2026-11-14' });
});

test('presets: year ranges and year boundaries', () => {
  assert.deepEqual(rangeForPreset('ytd', NOW), { from: '2026-01-01', to: '2026-11-14' });
  assert.deepEqual(rangeForPreset('lastyear', NOW), { from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(rangeForPreset('6m', new Date(2026, 1, 3)), { from: '2025-09-01', to: '2026-02-03' });
});

test('presets: custom and unknown keys give null; every preset has a label', () => {
  assert.equal(rangeForPreset('custom', NOW), null);
  assert.equal(rangeForPreset('nope', NOW), null);
  assert.ok(PRESETS.every((p) => p.key && p.label));
});

test('custom range checks', () => {
  assert.equal(checkCustomRange('2026-01-01', '2026-02-01'), null);
  assert.equal(checkCustomRange('2026-01-01', '2026-01-01'), null);
  assert.match(checkCustomRange('', '2026-02-01'), /both/);
  assert.match(checkCustomRange('2026-03-01', '2026-02-01'), /not be before/);
});

test('monthName formats YYYY-MM keys', () => {
  assert.match(monthName('2026-01'), /Jan 2026/);
  assert.match(monthName('2025-12', { short: true }), /Dec/);
});
