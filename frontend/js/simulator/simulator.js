/** What-if simulator: sends the chosen changes to the server, which returns a clearly labelled simulation. */
import { qs, el } from '../core/dom.js';
import { api, ApiError } from '../core/api.js';
import { formatCurrency, formatCompact } from '../core/format.js';
import { requireLogin } from '../core/auth.js';
import { applyChartTheme, chartPalette } from '../core/chartTheme.js';
import { renderSidebar, initDrawer } from '../ui/appShell.js';

initDrawer();
const money = (n) => formatCurrency(n, { whole: true });
const signed = (n) => `${n < 0 ? '−' : n > 0 ? '+' : ''}${money(Math.abs(n))}`;
let chart = null;
let manual = false;
let cutInputs = [];

const FIELD_ERRORS = {
  months: 'f-months', startingSavings: 'f-start', returnPercent: 'f-ret', incomeChange: 'f-ival', spendingChangePercent: 'f-spend',
  categoryCuts: 'f-cuts', oneOffAmount: 'f-oamt', oneOffMonth: 'f-omonth', goalAmount: 'f-goal', baselineIncome: 'f-binc', baselineExpenses: 'f-bexp',
};

function showErrors(details = {}) {
  for (const id of Object.values(FIELD_ERRORS)) qs(`#${id}-error`).textContent = '';
  for (const [key, msg] of Object.entries(details)) {
    const id = FIELD_ERRORS[key];
    if (id) qs(`#${id}-error`).textContent = msg;
  }
}

function buildBody() {
  const text = (id) => qs(`#${id}`).value.trim();
  const body = { months: text('f-months') || 12, startingSavings: text('f-start'), returnPercent: text('f-ret'), spendingChangePercent: text('f-spend') || 0, goalAmount: text('f-goal') };
  if (text('f-ival') !== '') body.incomeChange = { mode: qs('#f-imode').value, value: text('f-ival') };
  const cuts = cutInputs.filter((c) => c.input.value.trim() !== '' && Number(c.input.value) !== 0).map((c) => ({ category: c.category, percent: c.input.value.trim() }));
  if (cuts.length) body.categoryCuts = cuts;
  if (text('f-oamt') !== '') body.oneOff = { amount: text('f-oamt'), atMonth: text('f-omonth') };
  if (manual) { body.baselineIncome = text('f-binc'); body.baselineExpenses = text('f-bexp'); }
  return body;
}

function renderResult(r) {
  qs('#result-empty').classList.add('hidden');
  qs('#result').classList.remove('hidden');
  qs('#result-label').textContent = r.label;
  qs('#r-base-net').textContent = signed(r.baseline.monthlyNet);
  qs('#r-scen-net').textContent = signed(r.scenario.monthlyNet);
  qs('#r-months').textContent = String(r.months);
  qs('#r-end').textContent = money(r.scenario.endBalance);
  qs('#r-end-sub').textContent = `${signed(r.difference.endBalance)} compared with no change (${money(r.baseline.endBalance)})`;
  const goal = qs('#r-goal');
  goal.classList.toggle('hidden', !r.goal);
  if (r.goal) {
    const f = (m) => (m === null ? `not within ${r.months} months` : m === 0 ? 'already reached' : `about month ${m}`);
    goal.textContent = `Goal of ${money(r.goal.amount)}: with no change, ${f(r.goal.baselineMonths)}. With your changes, ${f(r.goal.scenarioMonths)}.`;
  }
  const [c1, c2] = chartPalette();
  chart?.destroy();
  chart = new window.Chart(qs('#chart-sim'), {
    type: 'line',
    data: {
      labels: r.series.map((s) => `M${s.month}`),
      datasets: [
        { label: 'No change (simulation)', data: r.series.map((s) => s.baseline), borderColor: c2, borderDash: [5, 4], pointRadius: 0, borderWidth: 2 },
        { label: 'With your changes (simulation)', data: r.series.map((s) => s.scenario), borderColor: c1, pointRadius: 0, borderWidth: 2.5 },
      ],
    },
    options: { scales: { y: { ticks: { callback: (v) => formatCompact(v) } } }, plugins: { legend: { position: 'bottom' } } },
  });
}

async function run(e) {
  e.preventDefault();
  showErrors();
  const btn = qs('#run');
  btn.disabled = true;
  try {
    const r = await api.post('/simulator', buildBody());
    if (r.status !== 'ok') {
      showErrors({ baselineIncome: 'Enter your typical monthly income.', baselineExpenses: 'Enter your typical monthly spending.' });
      return;
    }
    renderResult(r);
  } catch (err) {
    if (err instanceof ApiError && err.details) showErrors(err.details);
    else qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, err.message || 'Could not run the simulation.'));
  } finally { btn.disabled = false; }
}

async function loadBaseline() {
  const b = await api.get('/simulator/baseline');
  if (b.status !== 'ok') {
    manual = true;
    qs('#manual').classList.remove('hidden');
    const n = qs('#need-baseline');
    n.classList.remove('hidden');
    n.textContent = `Your recorded history is too short to work out a baseline (${b.completeMonths} of ${b.neededMonths} complete months). Enter your typical monthly income and spending below instead.`;
    return;
  }
  qs('#baseline-note').textContent = `Baseline from your recorded history: income ${money(b.monthlyIncome)} and spending ${money(b.monthlyExpenses)} per month. ${b.basis}`;
  const box = qs('#cuts');
  box.append(el('div', { class: 'field__label' }, 'Cut individual categories (%)'));
  for (const c of b.categories) {
    const id = `cut-${cutInputs.length}`;
    const input = el('input', { class: 'input', id, inputmode: 'decimal', autocomplete: 'off', placeholder: '0', 'aria-label': `Cut ${c.category} by percent` });
    cutInputs.push({ category: c.category, input });
    box.append(el('div', { class: 'cut-row' }, [el('label', { for: id }, `${c.category} (${money(c.monthly)}/month)`), input]));
  }
}

(async function init() {
  let user;
  try { user = await requireLogin(); }
  catch (err) { renderSidebar('simulator', null); qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not verify your session: ${err.message}`)); return; }
  if (!user) return;
  renderSidebar('simulator', user);
  applyChartTheme(window.Chart);
  try { await loadBaseline(); }
  catch (err) { qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not load your baseline: ${err.message}`)); }
  qs('#form').addEventListener('submit', run);
  qs('#sim').setAttribute('aria-busy', 'false');
})();
