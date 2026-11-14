/** Analytics page: loads aggregates from /api/analytics and renders KPIs, charts and ranked lists. */
import { qs, el } from '../core/dom.js';
import { api, ApiError } from '../core/api.js';
import { formatCurrency, formatDate, formatPercent } from '../core/format.js';
import { applyChartTheme, chartPalette } from '../core/chartTheme.js';
import { requireLogin } from '../core/auth.js';
import { renderSidebar, initDrawer } from '../ui/appShell.js';
import { PRESETS, rangeForPreset, checkCustomRange, monthName } from './ranges.js';

const state = { charts: {}, controller: null, preset: '6m' };

initDrawer();

/* ---------------------------------------------------------------- helpers */

function upsertChart(key, canvasId, config) {
  if (state.charts[key]) { state.charts[key].destroy(); } // config shapes differ between loads, so rebuild
  state.charts[key] = new window.Chart(qs(canvasId), config);
}

/** Shows the chart when there is data, otherwise its empty state (and drops any stale chart). */
function toggle(key, wrapId, emptyId, hasData) {
  qs(wrapId).classList.toggle('hidden', !hasData);
  qs(emptyId).classList.toggle('hidden', hasData);
  if (!hasData && state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
}

/** "▲ 12.5% vs previous period". For expenses an increase is the unfavourable direction. */
function changeNode(ratio, higherIsGood, label) {
  if (ratio === null) return el('span', { class: 'compare' }, `No data in the ${label} to compare`);
  const up = ratio >= 0;
  const good = up === higherIsGood;
  return el('span', { class: `stat__delta ${good ? 'stat__delta--up' : 'stat__delta--down'}` }, `${up ? '▲' : '▼'} ${formatPercent(Math.abs(ratio))} vs previous period`);
}

const sharePct = (share) => `${(share * 100).toFixed(1)}%`;

/* ---------------------------------------------------------------- render */

function renderKpis(a) {
  const { totals, comparison } = a;
  qs('#k-income').textContent = formatCurrency(totals.income);
  qs('#k-income-sub').replaceChildren(changeNode(comparison.incomeChange, true, 'previous period'));
  qs('#k-expenses').textContent = formatCurrency(totals.expenses);
  qs('#k-expenses-sub').replaceChildren(changeNode(comparison.expensesChange, false, 'previous period'));
  const net = qs('#k-net');
  net.textContent = formatCurrency(totals.net);
  net.classList.toggle('text-negative', totals.net < 0);
  net.classList.toggle('text-positive', totals.net > 0);
  qs('#k-net-sub').textContent = totals.savingsRate === null ? 'No income in this period, so no savings rate' : `Savings rate ${formatPercent(totals.savingsRate)}`;
  qs('#k-avg').textContent = formatCurrency(totals.avgMonthlyExpenses, { whole: true });
  qs('#k-avg-sub').textContent = a.includesCurrentMonth
    ? `Over ${a.months} month${a.months === 1 ? '' : 's'}; the current month is not finished, so this is understated`
    : `Over ${a.months} month${a.months === 1 ? '' : 's'}`;
}

function renderCharts(a) {
  if (!window.Chart) return;
  const palette = chartPalette();
  const labels = a.monthly.map((m) => monthName(m.month, { short: true }));
  const anyData = a.totals.count > 0;

  toggle('trend', '#w-trend', '#e-trend', anyData);
  if (anyData) {
    upsertChart('trend', '#chart-trend', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'Income', data: a.monthly.map((m) => m.income), backgroundColor: palette[2], borderRadius: 6, maxBarThickness: 26, order: 2 },
          { type: 'bar', label: 'Expenses', data: a.monthly.map((m) => m.expenses), backgroundColor: palette[4], borderRadius: 6, maxBarThickness: 26, order: 2 },
          { type: 'line', label: 'Net', data: a.monthly.map((m) => m.net), borderColor: palette[1], backgroundColor: palette[1], tension: 0.3, pointRadius: 3, order: 1 },
        ],
      },
      options: { scales: { x: { grid: { display: false } } }, plugins: { legend: { position: 'bottom' } } },
    });
  }

  toggle('cum', '#w-cum', '#e-cum', anyData);
  if (anyData) {
    upsertChart('cum', '#chart-cum', {
      type: 'line',
      data: { labels, datasets: [{ label: 'Running net savings', data: a.cumulativeNet.map((m) => m.value), borderColor: palette[0], backgroundColor: 'rgba(139, 92, 246, 0.16)', fill: true, tension: 0.3, pointRadius: 3 }] },
      options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } } } },
    });
  }

  const cats = a.expenseCategories;
  toggle('donut', '#w-donut', '#e-donut', cats.length > 0);
  if (cats.length) {
    const shown = cats.slice(0, 7);
    const rest = cats.slice(7).reduce((s, c) => s + c.amount, 0);
    const names = shown.map((c) => c.name).concat(rest > 0 ? ['All other categories'] : []);
    const values = shown.map((c) => c.amount).concat(rest > 0 ? [Math.round(rest * 100) / 100] : []);
    upsertChart('donut', '#chart-donut', {
      type: 'doughnut',
      data: { labels: names, datasets: [{ data: values, backgroundColor: names.map((_, i) => palette[i % palette.length]), borderWidth: 0 }] },
      options: { cutout: '64%', plugins: { legend: { position: 'bottom' } } },
    });
  }

  const trend = a.categoryTrend;
  toggle('stack', '#w-stack', '#e-stack', trend.series.length > 0);
  if (trend.series.length) {
    upsertChart('stack', '#chart-stack', {
      type: 'bar',
      data: {
        labels,
        datasets: trend.series.map((s, i) => ({ label: s.name, data: s.values, backgroundColor: s.categoryId === null ? palette[7] : palette[i % palette.length], borderWidth: 0, maxBarThickness: 34 })),
      },
      options: { scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true } }, plugins: { legend: { position: 'bottom' } } },
    });
  }

  const hasWeek = a.weekdays.some((d) => d.expenses > 0);
  toggle('week', '#w-week', '#e-week', hasWeek);
  if (hasWeek) {
    upsertChart('week', '#chart-week', {
      type: 'bar',
      data: { labels: a.weekdays.map((d) => d.name), datasets: [{ label: 'Expenses', data: a.weekdays.map((d) => d.expenses), backgroundColor: palette[3], borderRadius: 6, maxBarThickness: 34 }] },
      options: { plugins: { legend: { display: false } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true } } },
    });
  }
}

function emptyBlock(title, text) {
  return el('div', { class: 'empty' }, [el('div', { class: 'empty__title' }, title), text ? el('div', {}, text) : '']);
}

function categoryRows(list, kindLabel, palette) {
  if (!list.length) return emptyBlock(`No ${kindLabel} in this period`);
  return list.map((c, i) => {
    const bar = el('div', { class: 'progress__bar' });
    bar.style.setProperty('--value', (c.share * 100).toFixed(1));
    bar.style.setProperty('--cat-color', palette[i % palette.length]);
    return el('div', { class: 'cat-row' }, [
      el('div', { class: 'cat-row__head' }, [el('span', {}, c.name), el('span', { class: 'num' }, `${formatCurrency(c.amount)} · ${sharePct(c.share)}`)]),
      el('div', { class: 'progress', role: 'progressbar', 'aria-label': `${c.name} share`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(c.share * 100)) }, bar),
      el('div', { class: 'cat-row__meta' }, `${c.count} transaction${c.count === 1 ? '' : 's'}`),
    ]);
  });
}

function renderLists(a) {
  const palette = chartPalette();
  qs('#cat-list').replaceChildren(...[].concat(categoryRows(a.expenseCategories, 'expenses', palette)));
  qs('#income-list').replaceChildren(...[].concat(categoryRows(a.incomeCategories, 'income', palette.slice().reverse())));
  const top = a.topExpenses;
  qs('#top-list').replaceChildren(...(top.length ? top.map((t, i) => el('div', { class: 'rank' }, [
    el('span', { class: 'rank__n' }, String(i + 1)),
    el('span', { class: 'rank__body' }, [t.description, el('span', { class: 'rank__sub' }, `${t.category} · ${formatDate(t.date)}`)]),
    el('span', { class: 'num text-negative' }, `−${formatCurrency(t.amount)}`),
  ])) : [emptyBlock('No expenses in this period')]));
}

function render(a) {
  qs('#range-summary').textContent = `${formatDate(a.range.from)} to ${formatDate(a.range.to)} · ${a.totals.count} transaction${a.totals.count === 1 ? '' : 's'} · compared with ${formatDate(a.previousRange.from)} to ${formatDate(a.previousRange.to)}`;
  renderKpis(a);
  renderCharts(a);
  renderLists(a);
}

/* ------------------------------------------------------------------- data */

function currentRange() {
  if (state.preset === 'custom') {
    const from = qs('#range-from').value;
    const to = qs('#range-to').value;
    const problem = checkCustomRange(from, to);
    if (problem) return { problem };
    return { from, to };
  }
  return rangeForPreset(state.preset);
}

async function load() {
  const range = currentRange();
  const notice = qs('#notice');
  if (range.problem) {
    notice.replaceChildren(range.problem === 'Choose both a start and an end date.' ? '' : el('div', { class: 'alert alert--warning', role: 'alert' }, range.problem));
    return;
  }
  notice.replaceChildren();
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  const grid = qs('#analytics');
  grid.setAttribute('aria-busy', 'true');
  try {
    render(await api.get(`/analytics?${new URLSearchParams(range)}`, { signal: controller.signal }));
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (err instanceof ApiError && err.status === 401) { location.assign('/login.html?next=/analytics.html'); return; }
    notice.replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not load analytics: ${err.message}`));
  } finally {
    if (state.controller === controller) grid.setAttribute('aria-busy', 'false');
  }
}

function setPreset(key) {
  state.preset = key;
  const custom = key === 'custom';
  qs('#range-custom').classList.toggle('hidden', !custom);
  qs('#range-custom-to').classList.toggle('hidden', !custom);
  if (custom && !qs('#range-from').value) {
    const last = rangeForPreset('6m');
    qs('#range-from').value = last.from;
    qs('#range-to').value = last.to;
  }
  load();
}

(async function init() {
  let user;
  try {
    user = await requireLogin();
  } catch (err) {
    renderSidebar('analytics', null);
    qs('#notice').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not verify your session: ${err.message}`));
    return;
  }
  if (!user) return;
  renderSidebar('analytics', user);
  if (window.Chart) applyChartTheme(window.Chart);
  const select = qs('#range-preset');
  select.replaceChildren(...PRESETS.map((p) => el('option', { value: p.key }, p.label)));
  select.value = state.preset;
  select.addEventListener('change', () => setPreset(select.value));
  qs('#range-form').addEventListener('submit', (e) => e.preventDefault());
  for (const id of ['range-from', 'range-to']) qs(`#${id}`).addEventListener('change', load);
  await load();
})();
