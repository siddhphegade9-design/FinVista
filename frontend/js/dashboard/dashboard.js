/** Dashboard page controller: loads data, calls metrics.js, renders the DOM and charts. */
import { qs, el } from '../core/dom.js';
import { formatCurrency, formatDateShort, formatPercent } from '../core/format.js';
import { applyChartTheme, chartPalette, chartColors } from '../core/chartTheme.js';
import { renderSidebar, initDrawer } from '../ui/appShell.js';
import { requireLogin, getSessionUser } from '../core/auth.js';
import { loadDashboardData, loadBudgets } from './dataSource.js';
import {
  currentMonthKey, shiftMonth, monthLabel, monthOf, summarizeMonth, spendingByCategory, monthlySeries,
  budgetUtilization, overallBudgetRatio, recentTransactions, changeRatio, cumulativeSavings,
} from './metrics.js';

const state = { data: null, month: currentMonthKey(), charts: {}, budgetsByMonth: new Map(), user: null };
const isPreview = new URLSearchParams(location.search).get('preview') === '1';

initDrawer();

/* ---------- small render helpers ---------- */

/** "▲ 4.2% vs Oct 2026" - `higherIsGood` decides whether an increase is green or red. */
function deltaNode(current, previous, prevMonth, higherIsGood) {
  const ratio = changeRatio(current, previous);
  if (ratio === null) return document.createTextNode(`No data for ${monthLabel(prevMonth)}`);
  const up = ratio >= 0;
  const good = up === higherIsGood;
  return el('span', { class: `stat__delta ${good ? 'stat__delta--up' : 'stat__delta--down'}` },
    `${up ? '▲' : '▼'} ${formatPercent(Math.abs(ratio))} vs ${monthLabel(prevMonth)}`);
}

function setSub(id, node) { qs(id).replaceChildren(node); }

function renderBanner() {
  const banner = qs('#banner');
  if (state.data.isSample) {
    banner.replaceChildren(el('div', { class: 'alert alert--warning', role: 'note' }, [
      el('span', {}, [el('strong', {}, 'Design preview: '), 'every number on this page is SAMPLE data, not your records. Nothing is saved. ', el('a', { href: '/dashboard.html' }, 'Exit preview')]),
    ]));
  } else if (state.data.transactions.length === 0) {
    banner.replaceChildren(el('div', { class: 'alert alert--info', role: 'note' }, [
      el('span', {}, ['You have no transactions yet, so there is nothing to chart. ', el('a', { href: '/transactions.html?new=1' }, 'Add your first transaction'), ' or ', el('a', { href: '/transactions.html' }, 'import a CSV'), '. You can also ', el('a', { href: '/dashboard.html?preview=1' }, 'view the dashboard with sample data'), '.']),
    ]));
  } else if (state.data.truncated) {
    banner.replaceChildren(el('div', { class: 'alert alert--warning', role: 'note' }, 'You have more transactions than the dashboard can load at once, so the figures below cover only the most recent 20,000.'));
  } else banner.replaceChildren();
}

/* ---------- sections ---------- */

function renderKpis() {
  const { transactions } = state.data;
  const prevMonth = shiftMonth(state.month, -1);
  const cur = summarizeMonth(transactions, state.month);
  const prev = summarizeMonth(transactions, prevMonth);

  qs('#kpi-income').textContent = formatCurrency(cur.income);
  setSub('#kpi-income-sub', deltaNode(cur.income, prev.income, prevMonth, true));
  qs('#kpi-expenses').textContent = formatCurrency(cur.expenses);
  setSub('#kpi-expenses-sub', deltaNode(cur.expenses, prev.expenses, prevMonth, false));

  const total = cumulativeSavings(transactions);
  const savings = qs('#kpi-savings');
  savings.textContent = formatCurrency(total);
  savings.classList.toggle('text-negative', total < 0);

  qs('#kpi-rate').textContent = cur.savingsRate === null ? '—' : formatPercent(cur.savingsRate);
  qs('#kpi-rate-sub').textContent = cur.savingsRate === null
    ? 'No income recorded this month'
    : `${formatCurrency(cur.savings, { whole: true })} saved this month`;
}

function upsertChart(key, canvasId, config) {
  if (state.charts[key]) {
    state.charts[key].data = config.data;
    state.charts[key].update();
  } else {
    state.charts[key] = new window.Chart(qs(canvasId), config);
  }
}

function toggleChart(wrapId, emptyId, hasData) {
  qs(wrapId).classList.toggle('hidden', !hasData);
  qs(emptyId).classList.toggle('hidden', hasData);
}

function renderCharts() {
  if (!window.Chart) return;
  const palette = chartPalette();
  const sem = chartColors();
  const series = monthlySeries(state.data.transactions, state.month, 6);
  const hasSeries = series.some((m) => m.income > 0 || m.expenses > 0);
  toggleChart('#bar-wrap', '#bar-empty', hasSeries);
  if (hasSeries) {
    upsertChart('bar', '#chart-bar', {
      type: 'bar',
      data: {
        labels: series.map((m) => monthLabel(m.month, { short: true })),
        datasets: [
          { label: 'Income', data: series.map((m) => m.income), backgroundColor: sem.positive, borderRadius: 3, maxBarThickness: 28 },
          { label: 'Expenses', data: series.map((m) => m.expenses), backgroundColor: sem.negative, borderRadius: 3, maxBarThickness: 28 },
        ],
      },
      options: { scales: { x: { grid: { display: false } }, y: { beginAtZero: true } }, plugins: { legend: { position: 'bottom' } } },
    });
  }

  qs('#breakdown-month').textContent = monthLabel(state.month);
  const spending = spendingByCategory(state.data.transactions, state.month);
  toggleChart('#donut-wrap', '#donut-empty', spending.length > 0);
  if (spending.length > 0) {
    upsertChart('donut', '#chart-donut', {
      type: 'doughnut',
      data: { labels: spending.map((s) => s.category), datasets: [{ data: spending.map((s) => s.amount), backgroundColor: spending.map((_, i) => palette[i % palette.length]) }] },
      options: { cutout: '66%', plugins: { legend: { position: 'bottom' } } },
    });
  }
}

/** Budgets for the selected month: sample data in preview, otherwise loaded once per month from the API. */
async function budgetsForMonth(month) {
  if (state.data.isSample) return state.data.budgets;
  if (!state.budgetsByMonth.has(month)) state.budgetsByMonth.set(month, await loadBudgets(month));
  return state.budgetsByMonth.get(month);
}

async function renderBudgets() {
  const host = qs('#budget-list');
  const badge = qs('#budget-overall');
  const month = state.month;
  let budgets;
  try { budgets = await budgetsForMonth(month); }
  catch (err) { host.replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not load budgets: ${err.message}`)); return; }
  if (month !== state.month) return; // the user moved to another month meanwhile
  const { transactions } = state.data;
  if (budgets.length === 0) {
    badge.textContent = '';
    host.replaceChildren(el('div', { class: 'empty' }, [el('div', { class: 'empty__title' }, 'No budgets for this month'), el('div', {}, 'Set spending limits by category and track them here.'), el('a', { class: 'btn btn--secondary btn--sm', href: '/budgets.html' }, 'Set budgets')]));
    return;
  }
  const util = budgetUtilization(budgets, spendingByCategory(transactions, state.month));
  const overall = overallBudgetRatio(util);
  badge.textContent = overall === null ? '' : `${formatPercent(overall, 0)} used overall`;
  host.replaceChildren(...util.map((u) => {
    const pct = u.ratio === null ? 0 : Math.min(u.ratio * 100, 100);
    const bar = el('div', { class: 'progress__bar' });
    bar.style.setProperty('--value', pct.toFixed(1));
    const cls = u.status === 'over' ? ' progress--danger' : u.status === 'warning' ? ' progress--warning' : '';
    const meta = u.status === 'over'
      ? `Over budget by ${formatCurrency(-u.remaining, { whole: true })}`
      : `${formatCurrency(u.remaining, { whole: true })} left`;
    return el('div', { class: 'budget-item' }, [
      el('div', { class: 'budget-item__head' }, [el('span', {}, u.category), el('span', { class: 'num text-muted' }, `${formatCurrency(u.spent, { whole: true })} / ${formatCurrency(u.limit, { whole: true })}`)]),
      el('div', { class: `progress${cls}`, role: 'progressbar', 'aria-label': `${u.category} budget`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)) }, bar),
      el('div', { class: 'budget-item__meta' }, meta),
    ]);
  }));
}

function renderTransactions() {
  const host = qs('#tx-wrap');
  const rows = recentTransactions(state.data.transactions.filter((t) => monthOf(t.date) <= state.month), 8);
  if (rows.length === 0) {
    host.replaceChildren(el('div', { class: 'empty' }, [el('div', { class: 'empty__title' }, 'No transactions yet'), el('div', {}, 'Your most recent income and expenses will be listed here.'), el('a', { class: 'btn btn--secondary btn--sm', href: '/transactions.html' }, 'Go to Transactions')]));
    return;
  }
  const body = rows.map((t) => el('tr', {}, [
    el('td', { class: 'col-date' }, formatDateShort(t.date)),
    el('td', {}, t.description),
    el('td', { class: 'col-cat' }, el('span', { class: 'badge' }, t.category)),
    el('td', { class: `num ${t.type === 'income' ? 'text-positive' : 'text-negative'}` }, `${t.type === 'income' ? '+' : '−'}${formatCurrency(t.amount)}`),
  ]));
  host.replaceChildren(el('div', { class: 'table-wrap' }, el('table', { class: 'table table--stack-mobile' }, [
    el('thead', {}, el('tr', {}, [el('th', { class: 'col-date' }, 'Date'), el('th', {}, 'Description'), el('th', { class: 'col-cat' }, 'Category'), el('th', { class: 'num' }, 'Amount')])),
    el('tbody', {}, body),
  ])));
}

function renderMonthNav() {
  const months = state.data.transactions.map((t) => monthOf(t.date)).sort();
  const earliest = months[0] ?? currentMonthKey();
  qs('#month-label').textContent = monthLabel(state.month);
  qs('#month-prev').disabled = state.month <= earliest;
  qs('#month-next').disabled = state.month >= currentMonthKey();
}

function greeting() {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const first = state.user?.fullName?.split(/\s+/)[0];
  const node = qs('#dash-greeting');
  node.replaceChildren(`${part}${first ? `, ` : ''}`, ...(first ? [el('strong', {}, first)] : []), `. Here's your money for ${monthLabel(state.month)}.`);
}

function render() {
  greeting();
  renderMonthNav();
  renderKpis();
  renderCharts();
  renderBudgets();
  renderTransactions();
}

qs('#month-prev').addEventListener('click', () => { state.month = shiftMonth(state.month, -1); render(); });
qs('#month-next').addEventListener('click', () => { state.month = shiftMonth(state.month, 1); render(); });

async function resolveUser() {
  // Real dashboard: login required (redirects to /login.html otherwise). Sample preview: public, uses no user data.
  if (!isPreview) return requireLogin();
  try { return await getSessionUser(); } catch { return null; }
}

(async function init() {
  let user;
  try {
    user = await resolveUser();
  } catch (err) {
    renderSidebar('dashboard', null);
    qs('#banner').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not verify your session: ${err.message}`));
    return;
  }
  if (!isPreview && !user) return; // redirecting to login
  state.user = user;
  renderSidebar('dashboard', user);
  if (window.Chart) applyChartTheme(window.Chart);
  try {
    state.data = await loadDashboardData({ preview: isPreview });
  } catch (err) {
    qs('#banner').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not load your transactions: ${err.message}`));
    return;
  }
  renderBanner();
  render();
})();
