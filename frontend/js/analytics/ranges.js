/** Date-range presets for the analytics page. Pure functions (local calendar dates), unit-tested. */

const pad = (n) => String(n).padStart(2, '0');
export const isoOf = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const todayIso = (now) => isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate());

export const PRESETS = [
  { key: '6m', label: 'Last 6 months' },
  { key: '3m', label: 'Last 3 months' },
  { key: '12m', label: 'Last 12 months' },
  { key: 'ytd', label: 'This year so far' },
  { key: 'lastyear', label: 'Last year' },
  { key: 'custom', label: 'Custom range' },
];

/** First day of the month `back` months before the current one, through today. */
function lastMonths(now, count) {
  const first = new Date(now.getFullYear(), now.getMonth() - (count - 1), 1);
  return { from: isoOf(first.getFullYear(), first.getMonth() + 1, 1), to: todayIso(now) };
}

/** Returns { from, to } for a preset key, or null for 'custom' / unknown keys. */
export function rangeForPreset(key, now = new Date()) {
  switch (key) {
    case '3m': return lastMonths(now, 3);
    case '6m': return lastMonths(now, 6);
    case '12m': return lastMonths(now, 12);
    case 'ytd': return { from: isoOf(now.getFullYear(), 1, 1), to: todayIso(now) };
    case 'lastyear': return { from: isoOf(now.getFullYear() - 1, 1, 1), to: isoOf(now.getFullYear() - 1, 12, 31) };
    default: return null;
  }
}

/** Checks a custom range typed by the user. Returns an error message or null. */
export function checkCustomRange(from, to) {
  if (!from || !to) return 'Choose both a start and an end date.';
  if (from > to) return 'The end date must not be before the start date.';
  return null;
}

/** "Jan 2026" / "Dec 2025" style label for a YYYY-MM key. */
export function monthName(key, { short = false } = {}) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', short ? { month: 'short', year: '2-digit' } : { month: 'short', year: 'numeric' });
}
