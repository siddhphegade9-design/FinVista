/** Forecast page: projections (clearly labelled) from /api/forecast and unusual spending from /api/anomalies. */
import { qs, el } from '../core/dom.js';
import { api, ApiError } from '../core/api.js';
import { formatCurrency, formatDate } from '../core/format.js';
import { applyChartTheme, chartPalette } from '../core/chartTheme.js';
import { requireLogin } from '../core/auth.js';
import { renderSidebar, initDrawer } from '../ui/appShell.js';

initDrawer();
let chart;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const range = (o) => `Likely range ${formatCurrency(o.low, { whole: true })} to ${formatCurrency(o.high, { whole: true })}`;
const chip = () => el('span', { class: 'fc-chip' }, 'projected');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function renderKpis(f) {
  const cur = f.currentMonth;
  qs('#k-now').textContent = formatCurrency(cur.expenses);
  qs('#k-now-sub').textContent = `Spent so far in ${monthLabel(cur.month)}. Income so far ${formatCurrency(cur.income)}.`;
  if (f.status !== 'ok') {
    for (const id of ['k-exp', 'k-inc', 'k-net']) qs(`#${id}`).textContent = '—';
    for (const id of ['k-exp-sub', 'k-inc-sub', 'k-net-sub']) qs(`#${id}`).textContent = 'Not enough history yet';
    return;
  }
  const next = f.projections[0];
  qs('#k-exp').textContent = formatCurrency(next.expenses.expected, { whole: true });
  qs('#k-inc').textContent = formatCurrency(next.income.expected, { whole: true });
  qs('#k-net').textContent = formatCurrency(next.net.expected, { whole: true });
  qs('#k-net').classList.toggle('text-negative', next.net.expected < 0);
  qs('#k-exp-sub').replaceChildren(`${monthLabel(next.month)}. ${range(next.expenses)}`, chip());
  qs('#k-inc-sub').replaceChildren(`${monthLabel(next.month)}. ${range(next.income)}`, chip());
  qs('#k-net-sub').replaceChildren(`${monthLabel(next.month)}. ${range(next.net)}`, chip());
  if (cur.expenses >= next.expenses.expected) {
    qs('#k-now-sub').textContent += ' Already at or above a usual month.';
  }
}

function renderChart(f) {
  const empty = f.status !== 'ok';
  qs('#w-fc').classList.toggle('hidden', empty);
  qs('#e-fc').classList.toggle('hidden', !empty);
  if (empty) {
    chart?.destroy(); chart = null;
    qs('#e-fc-title').textContent = 'Not enough history yet';
    qs('#e-fc-text').textContent = `A projection needs at least ${f.neededMonths} complete months of transactions. You have ${plural(f.completeMonths, 'complete month')}. Add or import more past transactions and this page will fill in. Nothing is guessed in the meantime.`;
    return;
  }
  const [c1, c2, c3] = chartPalette();
  const hist = f.history.map((h) => h.month);
  const proj = f.projections.map((p) => p.month);
  const labels = [...hist, ...proj].map(monthLabel);
  const pad = (arr, n, fill = null) => [...Array(n).fill(fill), ...arr];
  const actual = [...f.history.map((h) => h.expenses), ...proj.map(() => null)];
  const projected = pad(f.projections.map((p) => p.expenses.expected), hist.length);
  const low = pad(f.projections.map((p) => p.expenses.low), hist.length);
  const high = pad(f.projections.map((p) => p.expenses.high), hist.length);
  chart?.destroy();
  chart = new window.Chart(qs('#chart-fc'), {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Recorded spending', data: actual, backgroundColor: c1, borderRadius: 4, order: 3 },
        { type: 'bar', label: 'Projected spending (estimate)', data: projected, backgroundColor: 'rgba(148, 163, 184, 0.18)', borderColor: c2, borderWidth: 2, borderDash: [5, 4], borderRadius: 4, order: 2 },
        { type: 'line', label: 'Likely range, high', data: high, borderColor: c3, borderDash: [2, 4], pointRadius: 3, borderWidth: 1.5, fill: false, order: 1 },
        { type: 'line', label: 'Likely range, low', data: low, borderColor: c3, borderDash: [2, 4], pointRadius: 3, borderWidth: 1.5, fill: false, order: 1 },
      ],
    },
    options: { scales: { y: { beginAtZero: true } }, plugins: { legend: { position: 'bottom' } } },
  });
}

function renderTables(f) {
  qs('#method').textContent = f.method.description;
  const cat = qs('#cat-fc');
  const months = qs('#months-fc');
  if (f.status !== 'ok') {
    const msg = el('div', { class: 'empty' }, el('div', { class: 'empty__title' }, 'Not enough history yet'));
    cat.replaceChildren(msg);
    months.replaceChildren(el('div', { class: 'empty' }, el('div', { class: 'empty__title' }, 'Not enough history yet')));
    return;
  }
  cat.replaceChildren(...(f.categories.length ? f.categories.map((c) => el('div', { class: 'fc-row' }, [
    el('span', { class: 'fc-row__name' }, [c.category, el('span', { class: 'fc-row__range' }, `${range(c)}. Spent in ${c.monthsWithSpending} of the last ${f.completeMonths} months.`)]),
    el('span', { class: 'fc-row__value' }, [formatCurrency(c.expected, { whole: true }), chip()]),
  ])) : [el('div', { class: 'empty' }, el('div', { class: 'empty__title' }, 'No spending in the last months'))]));
  months.replaceChildren(...f.projections.map((p) => el('div', { class: 'fc-row' }, [
    el('span', { class: 'fc-row__name' }, [monthLabel(p.month), el('span', { class: 'fc-row__range' }, `Spending ${formatCurrency(p.expenses.expected, { whole: true })}, income ${formatCurrency(p.income.expected, { whole: true })}`)]),
    el('span', { class: `fc-row__value ${p.net.expected < 0 ? 'text-negative' : 'text-positive'}` }, [`${p.net.expected < 0 ? '−' : '+'}${formatCurrency(Math.abs(p.net.expected), { whole: true })}`, chip()]),
  ])));
}

function renderCommitments(f) {
  const c = f.commitments;
  const box = qs('#commit-text');
  if (!c || (!c.sipCount && !c.policyCount)) {
    box.replaceChildren('You have not added SIPs or insurance policies. ', el('a', { href: '/investments.html' }, 'Add a SIP'), ' or ', el('a', { href: '/insurance.html' }, 'a policy'), ' to see planned outflows here.');
    return;
  }
  box.replaceChildren(`SIPs: ${formatCurrency(c.sipMonthly, { whole: true })} a month across ${plural(c.sipCount, 'active SIP')}. Insurance premiums: about ${formatCurrency(c.insuranceMonthlyEquivalent, { whole: true })} a month across ${plural(c.policyCount, 'active policy', 'active policies')}. ${c.note}`);
}

const KIND_LABEL = { unusual_amount: 'Unusually large', category_spike: 'Category spike', possible_duplicate: 'Possible repeat' };

function renderAnomalies(a) {
  qs('#an-notice').textContent = a.notice;
  const list = qs('#an-list');
  if (!a.anomalies.length) {
    list.replaceChildren(el('div', { class: 'empty' }, [el('div', { class: 'empty__title' }, 'Nothing unusual found'), el('p', {}, a.checked ? `Checked ${plural(a.checked, 'expense')} against your own usual pattern.` : 'Add some expenses and they will be checked against your own usual pattern.')]));
    return;
  }
  list.replaceChildren(...a.anomalies.map((x) => el('div', { class: 'an-item', dataset: { kind: x.kind } }, [
    el('span', { class: `badge ${x.severity === 'high' ? 'badge--warning' : ''}` }, KIND_LABEL[x.kind]),
    el('div', { class: 'an-item__body' }, [
      el('span', { class: 'an-item__title' }, x.kind === 'category_spike' ? `${x.category}, ${monthLabel(x.month)}` : x.description),
      el('span', { class: 'an-item__reason' }, `${x.kind === 'category_spike' ? '' : `${formatDate(x.date)} · ${x.category}. `}${x.reason}`),
    ]),
    el('div', { class: 'an-item__amount' }, [formatCurrency(x.amount), x.kind === 'category_spike' ? '' : el('a', { href: `/transactions.html?q=${encodeURIComponent(x.description)}` }, 'View')]),
  ])));
}

(async function init() {
  let user;
  try { user = await requireLogin(); }
  catch (err) {
    renderSidebar('forecast', null);
    qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not verify your session: ${err.message}`));
    return;
  }
  if (!user) return;
  renderSidebar('forecast', user);
  applyChartTheme(window.Chart);
  try {
    const [f, a] = await Promise.all([api.get('/forecast'), api.get('/anomalies')]);
    renderKpis(f); renderChart(f); renderTables(f); renderCommitments(f); renderAnomalies(a);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) { location.assign('/login.html?next=/forecast.html'); return; }
    qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not load the forecast: ${err.message}`));
  } finally {
    qs('#forecast').setAttribute('aria-busy', 'false');
  }
})();
