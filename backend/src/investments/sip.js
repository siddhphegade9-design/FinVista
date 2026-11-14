'use strict';
/**
 * SIP maths. Pure functions (no database, the date is passed in). All money is integer paise.
 *
 * Model (stated to the user on the page):
 *  - Instalment k (k = 0, 1, 2 ...) is paid on the start date plus k months (clamped to month end).
 *  - Each year the instalment rises by the step-up percentage: amount_k = amount * (1 + step)^floor(k / 12).
 *  - The assumed annual return r compounds monthly at i = (1 + r)^(1/12) - 1; an instalment grows by (1 + i)
 *    for every whole month since it was paid.
 *  - "Scheduled" amounts assume every instalment was actually paid. They are not bank records.
 *  - Values are projections from the return the user assumed. Real returns vary and can be negative.
 */
const toDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; };
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = ({ y, m, d }) => `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Date of instalment k: start date plus k months, clamped (31 Jan + 1 month = 28/29 Feb). */
function instalmentDate(start, k) {
  const s = typeof start === 'string' ? toDate(start) : start;
  const total = s.y * 12 + (s.m - 1) + k;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return { y, m, d: Math.min(s.d, daysIn(y, m)) };
}

const cmp = (a, b) => (a.y - b.y) || (a.m - b.m) || (a.d - b.d);

/** Whole months from date a to date b (b on or after a); a month-end clamp counts as reaching the day. */
function wholeMonths(a, b) {
  let n = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < Math.min(a.d, daysIn(b.y, b.m))) n -= 1;
  return Math.max(0, n);
}

/** Number of instalments paid on or before `asOf` (capped by the duration). */
function instalmentsDue(sip, asOfIso) {
  const asOf = toDate(asOfIso);
  const start = toDate(sip.startDate);
  if (cmp(start, asOf) > 0) return 0;
  const max = sip.durationMonths ?? 1200;
  let n = 0;
  while (n < max && cmp(instalmentDate(start, n), asOf) <= 0) n += 1;
  return n;
}

/** Instalment amount in paise for index k, with the yearly step-up. */
const instalmentPaise = (sip, k) => Math.round(sip.monthlyPaise * (1 + sip.stepUpPercent / 100) ** Math.floor(k / 12));

const monthlyRate = (annualPercent) => (1 + annualPercent / 100) ** (1 / 12) - 1;

/** Money invested and modelled value on a date, for the first `count` instalments only counted if due by asOf. */
function positionAt(sip, asOfIso, { stopAt = null } = {}) {
  const asOf = toDate(asOfIso);
  const start = toDate(sip.startDate);
  let n = instalmentsDue(sip, asOfIso);
  if (stopAt !== null) n = Math.min(n, stopAt);
  const i = monthlyRate(sip.expectedReturnPercent);
  let invested = 0;
  let value = 0;
  for (let k = 0; k < n; k += 1) {
    const amt = instalmentPaise(sip, k);
    invested += amt;
    value += amt * (1 + i) ** wholeMonths(instalmentDate(start, k), asOf);
  }
  return { instalments: n, investedPaise: invested, valuePaise: Math.round(value) };
}

/** The instalment (paise) due next month onward: the current step-up level as of `asOfIso`. */
function currentInstalmentPaise(sip, asOfIso) {
  const n = instalmentsDue(sip, asOfIso);
  const ended = sip.durationMonths !== null && sip.durationMonths !== undefined && n >= sip.durationMonths;
  if (ended || !sip.isActive) return 0;
  return instalmentPaise(sip, n); // the next instalment
}

/** End date of the SIP, or null when ongoing. */
function endDate(sip) {
  if (sip.durationMonths === null || sip.durationMonths === undefined) return null;
  return iso(instalmentDate(sip.startDate, sip.durationMonths - 1));
}

/**
 * Projection at the planned end (or `horizonYears` ahead for an ongoing SIP) assuming every instalment
 * up to that point is paid.
 */
function projectToEnd(sip, asOfIso, horizonYears = 10) {
  const end = sip.durationMonths ? iso(instalmentDate(sip.startDate, sip.durationMonths)) : iso(instalmentDate(asOfIso, horizonYears * 12));
  const p = positionAt(sip, end);
  return { date: end, ongoing: !sip.durationMonths, ...p, gainPaise: p.valuePaise - p.investedPaise };
}

/** One SIP's headline numbers as of today. */
function describe(sip, asOfIso, horizonYears = 10) {
  const now = positionAt(sip, asOfIso);
  const end = projectToEnd(sip, asOfIso, horizonYears);
  const n = instalmentsDue(sip, asOfIso);
  const finished = sip.durationMonths ? n >= sip.durationMonths : false;
  return { instalmentsPaid: now.instalments, scheduledInvestedPaise: now.investedPaise, modelledValuePaise: now.valuePaise, nextInstalmentPaise: currentInstalmentPaise(sip, asOfIso), finished, end };
}

/** Yearly series for a chart: for each year 0..years from `asOfIso`, total scheduled invested and modelled value. */
function growthSeries(sips, asOfIso, years = 10) {
  const out = [];
  for (let y = 0; y <= years; y += 1) {
    const date = iso(instalmentDate(asOfIso, y * 12));
    let invested = 0;
    let value = 0;
    for (const s of sips) {
      if (!s.isActive) continue;
      const p = positionAt(s, date);
      invested += p.investedPaise;
      value += p.valuePaise;
    }
    out.push({ year: y, date, investedPaise: invested, valuePaise: value });
  }
  return out;
}

/** Stand-alone calculator: no stored record. */
function calculate({ monthlyPaise, years, stepUpPercent = 0, expectedReturnPercent }, asOfIso) {
  const sip = { startDate: asOfIso, durationMonths: Math.round(years * 12), monthlyPaise, stepUpPercent, expectedReturnPercent, isActive: true };
  const end = projectToEnd(sip, asOfIso);
  return { months: sip.durationMonths, investedPaise: end.investedPaise, valuePaise: end.valuePaise, gainPaise: end.gainPaise };
}

module.exports = { instalmentDate, wholeMonths, instalmentsDue, instalmentPaise, monthlyRate, positionAt, currentInstalmentPaise, endDate, projectToEnd, describe, growthSeries, calculate };
