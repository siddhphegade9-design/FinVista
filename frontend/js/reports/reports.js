/** Reports page: financial health score and a printable monthly report. Figures come from the server. */
import { qs, el } from '../core/dom.js';
import { api, ApiError } from '../core/api.js';
import { formatCurrency } from '../core/format.js';
import { requireLogin } from '../core/auth.js';
import { renderSidebar, initDrawer } from '../ui/appShell.js';

initDrawer();
const state = { month: new Date().toISOString().slice(0, 7) };
const money = (n) => formatCurrency(n, { whole: true });
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const shift = (key, n) => { const [y, m] = key.split('-').map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const errBox = (text) => el('div', { class: 'alert alert--danger', role: 'alert' }, text);
const errText = (e) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
const pctText = (r) => (r === null || r === undefined ? '' : `${r > 0 ? '+' : ''}${(r * 100).toFixed(1)}%`);

function progress(label, ratio, cls = '') {
  const bar = el('div', { class: 'progress__bar' });
  const pct = Math.max(0, Math.min(100, ratio * 100));
  bar.style.setProperty('--value', pct.toFixed(1));
  return el('div', { class: `progress${cls}`, role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)) }, bar);
}

const BAND_BADGE = { Strong: 'badge--positive', Good: 'badge--info', Fair: 'badge--warning', 'Needs attention': 'badge--negative' };

function renderScore(s) {
  const root = qs('#score');
  const comps = s.components.map((c) => el('div', { class: 'rep-comp', dataset: { key: c.key, scored: String(c.scored) } }, [
    el('div', { class: 'rep-comp__head' }, [el('span', {}, c.label), el('span', { class: 'rep-comp__pts' }, c.scored ? `${c.points} of ${c.weight} points` : 'Not scored')]),
    progress(`${c.label} score`, c.scored ? c.points / c.weight : 0),
    el('div', { class: 'rep-comp__why' }, c.explanation),
    c.tip ? el('div', { class: 'rep-comp__tip' }, c.tip) : '',
  ]));
  const top = s.status === 'ok'
    ? el('div', { class: 'rep-score__top' }, [
      el('div', { class: 'rep-score__num', id: 'score-num' }, [String(s.score), el('small', {}, ' / 100')]),
      el('div', { class: 'rep-score__meta' }, [el('span', { class: `badge ${BAND_BADGE[s.band]}` }, s.band), el('span', { class: 'rep-hint' }, s.message)]),
    ])
    : el('div', { class: 'alert alert--info', id: 'score-none', role: 'status' }, s.message);
  root.replaceChildren(top, ...comps, el('p', { class: 'rep-foot' }, s.notice));
  qs('#score-card').setAttribute('aria-busy', 'false');
}

function table(headers, rows) {
  return el('table', { class: 'rep-table' }, [
    el('thead', {}, el('tr', {}, headers.map((h) => el('th', { scope: 'col' }, h)))),
    el('tbody', {}, rows.map((r) => el('tr', {}, r.map((c) => el('td', {}, c))))),
  ]);
}
const empty = (text) => el('p', { class: 'rep-hint' }, text);

function renderReport(r) {
  qs('#month-label').textContent = monthLabel(r.month);
  qs('#report-title').textContent = `Monthly report: ${monthLabel(r.month)}`;
  qs('#report-note').textContent = r.status === 'future' ? 'A future month: nothing is recorded yet.' : (r.notice || 'A finished month.');
  const p = r.previousMonth;
  qs('#k-income').textContent = money(r.totals.income);
  qs('#k-income-sub').textContent = (p.incomeChange === null || r.status !== 'complete') ? `Last month: ${money(p.income)}` : `${pctText(p.incomeChange)} vs last month`;
  qs('#k-expenses').textContent = money(r.totals.expenses);
  qs('#k-expenses-sub').textContent = (p.expensesChange === null || r.status !== 'complete') ? `Last month: ${money(p.expenses)}` : `${pctText(p.expensesChange)} vs last month`;
  qs('#k-net').textContent = money(r.totals.net);
  qs('#k-net-sub').textContent = r.totals.savingsRate === null ? 'No income recorded' : `${(r.totals.savingsRate * 100).toFixed(0)}% of income`;
  qs('#k-count').textContent = String(r.totals.count);
  qs('#k-count-sub').textContent = 'recorded this month';

  qs('#categories').replaceChildren(...(r.expenseCategories.length
    ? r.expenseCategories.map((c) => el('div', { class: 'rep-cat' }, [el('div', { class: 'rep-cat__head' }, [el('span', {}, c.name), el('span', {}, `${money(c.amount)} · ${Math.round(c.share * 100)}%`)]), progress(`${c.name} share of spending`, c.share)]))
    : [empty('No spending recorded this month.')]));

  const b = r.budgets;
  const bRows = [...(b.overall ? [b.overall] : []), ...b.rows];
  const STATUS = { ok: 'On track', watch: 'Close to limit', over: 'Over budget' };
  qs('#budgets').replaceChildren(bRows.length
    ? table(['Budget', 'Status', 'Spent of limit'], bRows.map((x) => [x.category, STATUS[x.status], `${money(x.spent)} of ${money(x.limit)}`]))
    : empty('No budgets were set for this month. Spending in all categories is unbudgeted.'));

  qs('#top').replaceChildren(r.topExpenses.length
    ? table(['Date', 'Description', 'Category', 'Amount'], r.topExpenses.map((t) => [t.date, t.description, t.category, money(t.amount)]))
    : empty('No expenses recorded this month.'));

  qs('#unusual').replaceChildren(r.unusual.length
    ? el('div', {}, [el('p', { class: 'rep-hint' }, r.unusualNotice), table(['Date', 'What stood out', 'Amount'], r.unusual.map((u) => [u.date, u.reason || u.kind, u.amount ? money(u.amount) : '—']))])
    : empty('Nothing looked unusual compared with your usual pattern.'));

  const c = r.commitments;
  qs('#commitments').replaceChildren(el('p', { class: 'rep-hint' }, `Active SIPs: ${c.sipCount} (${money(c.sipMonthly)} a month). Active insurance policies: ${c.policyCount} (about ${money(c.insuranceMonthlyEquivalent)} a month). These are today's records, not a per-month history.`));
  qs('#csv-link').setAttribute('href', `/api/transactions/export?from=${r.from}&to=${r.to}`);
  qs('#report').setAttribute('aria-busy', 'false');
}

async function loadReport() {
  qs('#report').setAttribute('aria-busy', 'true');
  qs('#month-label').textContent = monthLabel(state.month);
  try { renderReport(await api.get(`/reports/monthly?month=${state.month}`)); qs('#page-error').replaceChildren(); }
  catch (e) { qs('#page-error').replaceChildren(errBox(`Could not load the report: ${errText(e)}`)); }
}

(async function init() {
  let user;
  try { user = await requireLogin(); }
  catch (err) { renderSidebar('reports', null); qs('#page-error').replaceChildren(errBox(`Could not verify your session: ${err.message}`)); return; }
  if (!user) return;
  renderSidebar('reports', user);
  qs('#prev-month').addEventListener('click', () => { state.month = shift(state.month, -1); loadReport(); });
  qs('#next-month').addEventListener('click', () => { state.month = shift(state.month, 1); loadReport(); });
  qs('#print-btn').addEventListener('click', () => window.print());
  api.get('/reports/health-score').then(renderScore).catch((e) => qs('#score').replaceChildren(errBox(`Could not load the score: ${errText(e)}`)));
  await loadReport();
})();
