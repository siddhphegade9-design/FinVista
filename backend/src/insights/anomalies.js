'use strict';
/**
 * Unusual-spending detection. Rule-based and explainable. These are things that look different from the
 * user's own pattern, NOT fraud findings: a wedding gift or an annual premium is unusual and perfectly fine.
 *
 *  1. unusual_amount     - one expense far above the usual size for its category (robust z-score on the median).
 *  2. category_spike     - a month's total for a category far above its own recent months.
 *  3. possible_duplicate - same amount and description within two days.
 *
 * Each rule has a minimum amount and minimum history so that small or thin data never raises alerts.
 */
const { toPaise, fromPaise } = require('../analytics/calc');
const { median, mad, mean, stdDev } = require('./stats');
const currencies = require('../config/currencies');

const CONFIG = Object.freeze({
  lookbackDays: 90,             // only transactions this recent are reported
  minCategoryTransactions: 8,   // history needed before judging single amounts in a category
  modifiedZ: 3.5,               // Iglewicz-Hoaglin threshold for outliers
  minRatioToMedian: 2,          // and at least this many times the typical amount
  minAmountPaise: 50_000,       // ignore anything under INR 500
  spikeMinPriorMonths: 3,
  spikeSigma: 2,
  spikeMinRatio: 1.5,
  spikeMinIncreasePaise: 100_000, // at least INR 1,000 above the usual month
  duplicateWindowDays: 2,
  duplicateMinAmountPaise: 10_000,
});

const DAY = 86_400_000;
const dayNum = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim();
const monthOf = (iso) => iso.slice(0, 7);
const nextMonth = (key) => { const [y, m] = key.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const prevMonth = (key) => { let [y, m] = key.split('-').map(Number); m -= 1; if (m === 0) { m = 12; y -= 1; } return `${y}-${String(m).padStart(2, '0')}`; };

/** @param txs [{ id, date:'YYYY-MM-DD', description, amount, category }] expenses only */
function detectAnomalies(txs, now = new Date(), { currency = currencies.DEFAULT_CURRENCY } = {}) {
  // Amount thresholds are written in INR terms; scale them so they are sensible in the user's currency (not an exchange rate).
  const k = currencies.info(currency).thresholdScale;
  const cfg = { ...CONFIG, minAmountPaise: CONFIG.minAmountPaise * k, spikeMinIncreasePaise: CONFIG.spikeMinIncreasePaise * k, duplicateMinAmountPaise: CONFIG.duplicateMinAmountPaise * k };
  const inr = (paise) => currencies.formatMoney(fromPaise(paise), currency);
  const today = now.toISOString().slice(0, 10);
  const cutoff = dayNum(today) - cfg.lookbackDays;
  const rows = txs.map((t) => ({ ...t, paise: toPaise(t.amount) }));
  const out = [];

  // 1. Unusual single amounts, judged against the category's own history (including the transaction itself).
  const byCat = new Map();
  for (const r of rows) { if (!byCat.has(r.category)) byCat.set(r.category, []); byCat.get(r.category).push(r); }
  for (const [category, list] of byCat) {
    if (list.length < cfg.minCategoryTransactions) continue;
    const amounts = list.map((r) => r.paise);
    const med = median(amounts);
    const dev = mad(amounts);
    for (const r of list) {
      if (dayNum(r.date) < cutoff || r.paise < cfg.minAmountPaise) continue;
      const ratio = med > 0 ? r.paise / med : Infinity;
      // MAD of 0 (many identical amounts) makes the z-score meaningless, so fall back to the ratio alone with a higher bar.
      const z = dev > 0 ? (0.6745 * (r.paise - med)) / dev : null;
      const flagged = z === null ? ratio >= cfg.minRatioToMedian * 2.5 : z > cfg.modifiedZ && ratio >= cfg.minRatioToMedian;
      if (!flagged) continue;
      out.push({
        kind: 'unusual_amount', severity: ratio >= 5 ? 'high' : 'medium', transactionId: r.id, date: r.date, description: r.description,
        category, amount: fromPaise(r.paise),
        reason: `${inr(r.paise)} is about ${ratio.toFixed(1)}× your usual ${category} transaction (typical ${inr(Math.round(med))}, based on ${list.length} transactions).`,
      });
    }
  }

  // 2. Category spikes: last complete month and the current month so far, against the months before them.
  const monthly = new Map(); // category -> Map(month -> paise)
  for (const r of rows) {
    if (!monthly.has(r.category)) monthly.set(r.category, new Map());
    const m = monthly.get(r.category);
    m.set(monthOf(r.date), (m.get(monthOf(r.date)) || 0) + r.paise);
  }
  const current = monthOf(today);
  const last = prevMonth(current);
  for (const [category, m] of monthly) {
    for (const month of [last]) { // the current month is unfinished, so it is never judged as a spike
      const amount = m.get(month) || 0;
      const priorKeys = [...m.keys()].filter((k) => k < month);
      const first = priorKeys.length ? priorKeys.sort()[0] : null;
      if (!first) continue;
      // Count every month between the first one with data and the month before `month` (empty months are 0).
      const prior = [];
      for (let k = first; k < month; k = nextMonth(k)) prior.push(m.get(k) || 0);
      if (prior.length < cfg.spikeMinPriorMonths) continue;
      const avg = mean(prior);
      const sd = stdDev(prior);
      if (amount - avg < cfg.spikeMinIncreasePaise) continue;
      if (avg > 0 && amount < avg * cfg.spikeMinRatio) continue;
      if (amount <= avg + cfg.spikeSigma * sd) continue;
      out.push({
        kind: 'category_spike', severity: avg > 0 && amount >= avg * 2.5 ? 'high' : 'medium', transactionId: null, date: `${month}-01`, description: null,
        category, amount: fromPaise(amount), month,
        reason: `${category} spending in ${month} was ${inr(amount)}, compared with a usual ${inr(Math.round(avg))} a month over the ${prior.length} months before.`,
      });
    }
  }

  // 3. Possible duplicates: same amount and description within two days.
  const groups = new Map();
  for (const r of rows) {
    if (r.paise < cfg.duplicateMinAmountPaise) continue;
    const key = `${r.paise}|${norm(r.description)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
    for (let i = 1; i < list.length; i += 1) {
      const a = list[i - 1];
      const b = list[i];
      if (dayNum(b.date) < cutoff) continue;
      if (dayNum(b.date) - dayNum(a.date) > cfg.duplicateWindowDays) continue;
      out.push({
        kind: 'possible_duplicate', severity: 'low', transactionId: b.id, date: b.date, description: b.description, category: b.category, amount: fromPaise(b.paise),
        reason: `Same amount (${inr(b.paise)}) and description as another transaction on ${a.date}. It may be a repeated entry, or a genuine repeat purchase.`,
      });
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.date.localeCompare(a.date) || b.amount - a.amount);
  return out;
}

module.exports = { CONFIG, detectAnomalies };
