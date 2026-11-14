/** Tax (India) page: compares the old and new regime from figures the user enters. The maths runs on the server. */
import { qs, el } from '../core/dom.js';
import { api, ApiError } from '../core/api.js';
import { formatCurrency } from '../core/format.js';
import { requireLogin } from '../core/auth.js';
import { toast } from '../core/toast.js';
import { renderSidebar, initDrawer } from '../ui/appShell.js';

initDrawer();
const money = (n) => formatCurrency(n, { whole: true });
const state = { year: null, rules: null };
const EMPTY = qs('#results-empty');

const GROUPS = [
  { title: 'About you', fields: [
    { key: 'age', label: 'Age group', type: 'select', options: [['under60', 'Under 60'], ['60-79', '60 to 79'], ['80+', '80 or above']] },
    { key: 'city', label: 'City you pay rent in', type: 'city' },
  ] },
  { title: 'Salary', fields: [
    { key: 'grossSalary', label: 'Gross salary for the year' },
    { key: 'basicSalary', label: 'Basic salary (with DA)', hint: 'Used for HRA and employer NPS limits.' },
    { key: 'hraReceived', label: 'HRA received' },
    { key: 'rentPaid', label: 'Rent paid for the year' },
    { key: 'employerNps', label: 'Employer NPS contribution', hint: 'Allowed in both regimes, up to a limit.' },
  ] },
  { title: 'Other income', fields: [
    { key: 'interestSavings', label: 'Savings account interest' },
    { key: 'interestDeposits', label: 'Fixed deposit interest' },
    { key: 'otherIncome', label: 'Any other taxable income' },
  ] },
  { title: 'Old regime deductions', fields: [
    { key: 'section80C', label: 'Section 80C (PPF, ELSS, EPF, life insurance…)' },
    { key: 'section80CCD1B', label: 'Extra NPS contribution (80CCD(1B))' },
    { key: 'section80DSelf', label: 'Health insurance: you and family (80D)' },
    { key: 'section80DParents', label: 'Health insurance: parents (80D)' },
    { key: 'parentsSenior', label: 'Parents are 60 or above', type: 'check' },
    { key: 'section80E', label: 'Education loan interest (80E)' },
    { key: 'homeLoanInterest', label: 'Home loan interest, self-occupied' },
  ] },
];

function buildForm(cities) {
  const root = qs('#fields');
  root.replaceChildren(...GROUPS.map((g) => el('fieldset', { class: 'tax-group' }, [
    el('legend', {}, g.title),
    ...g.fields.map((f) => {
      const id = `f-${f.key}`;
      if (f.type === 'check') return el('label', { class: 'tax-check' }, [el('input', { type: 'checkbox', id, name: f.key }), f.label]);
      let input;
      if (f.type === 'select') input = el('select', { class: 'select', id, name: f.key }, f.options.map(([v, t]) => el('option', { value: v }, t)));
      else if (f.type === 'city') input = el('select', { class: 'select', id, name: f.key }, [...cities.map((c) => el('option', { value: c }, c)), el('option', { value: 'Other', selected: true }, 'Other city')]);
      else input = el('input', { class: 'input', id, name: f.key, type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0' });
      return el('div', { class: 'field' }, [
        el('label', { class: 'field__label', for: id }, f.label), input,
        f.hint ? el('div', { class: 'field__hint' }, f.hint) : null,
        el('div', { class: 'field__error', id: `e-${f.key}`, role: 'alert' }),
      ].filter(Boolean));
    }),
  ])));
}

function readForm() {
  const body = {};
  for (const g of GROUPS) for (const f of g.fields) {
    const node = qs(`#f-${f.key}`);
    body[f.key] = f.type === 'check' ? node.checked : node.value.trim();
  }
  return body;
}
function fillForm(inputs) {
  for (const g of GROUPS) for (const f of g.fields) {
    const node = qs(`#f-${f.key}`);
    const v = inputs[f.key];
    if (f.type === 'check') node.checked = v === true;
    else if (v !== undefined && v !== null) node.value = f.type === 'select' || f.type === 'city' ? v : (v === 0 ? '' : String(v));
  }
}
function showErrors(details = {}) {
  for (const g of GROUPS) for (const f of g.fields) { const n = qs(`#e-${f.key}`); if (n) n.textContent = details[f.key] || ''; }
}
const msg = (text) => { qs('#form-msg').textContent = text; };
const errText = (err) => (err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');

function breakdown(r) {
  const rows = [];
  for (const l of r.lines) rows.push(el('tr', {}, [el('td', {}, [l.label, l.note ? el('span', { class: 'tax-note' }, l.note) : ''] ), el('td', {}, money(l.amount))]));
  for (const d of r.deductions) rows.push(el('tr', {}, [el('td', {}, [`Less: ${d.label}`, d.claimed > d.allowed && d.cap !== null ? el('span', { class: 'tax-note' }, `You entered ${money(d.claimed)}; the limit is ${money(d.cap)}.`) : (d.note ? el('span', { class: 'tax-note' }, d.note) : '')]), el('td', {}, money(-d.allowed))]));
  rows.push(el('tr', { class: 'tax-total' }, [el('td', {}, 'Taxable income'), el('td', {}, money(r.taxableIncome))]));
  for (const b of r.slabBands) rows.push(el('tr', {}, [el('td', {}, `${b.rate}% on ${money(b.amount)}`), el('td', {}, money(b.tax))]));
  if (r.rebate > 0) rows.push(el('tr', {}, [el('td', {}, ['Less: rebate / relief', r.rebateNote ? el('span', { class: 'tax-note' }, r.rebateNote) : '']), el('td', {}, money(-r.rebate))]));
  if (r.surcharge > 0) rows.push(el('tr', {}, [el('td', {}, [`Surcharge (${r.surchargePercent}%)`, r.surchargeMarginalRelief > 0 ? el('span', { class: 'tax-note' }, `After marginal relief of ${money(r.surchargeMarginalRelief)}.`) : '']), el('td', {}, money(r.surcharge))]));
  rows.push(el('tr', {}, [el('td', {}, `Health and education cess (${r.cessPercent}%)`), el('td', {}, money(r.cess))]));
  return el('table', { class: 'tax-table' }, el('tbody', {}, rows));
}

function regimeCard(r, better) {
  return el('section', { class: 'card tax-regime', dataset: { regime: r.regime, better: String(better) } }, [
    el('div', { class: 'card__title' }, [r.label, ' ', better ? el('span', { class: 'badge badge--positive' }, 'Lower tax') : '']),
    el('div', { class: 'tax-regime__total' }, money(r.totalTax)),
    el('div', { class: 'tax-hint' }, `About ${money(r.monthlyTax)} a month · ${r.effectiveRatePercent}% of income`),
    breakdown(r),
  ]);
}

function renderResult(result) {
  const c = result.comparison;
  qs('#results').replaceChildren(
    el('div', { class: 'alert alert--info tax-verdict', role: 'status' }, [el('strong', {}, c.summary), ' This is an estimate on the figures you entered.']),
    el('div', { class: 'tax-regimes' }, [regimeCard(result.new, c.better === 'new'), regimeCard(result.old, c.better === 'old')]),
    el('section', { class: 'card' }, [el('div', { class: 'card__title' }, 'What this estimate leaves out'), el('ul', { class: 'tax-assume' }, result.assumptions.map((a) => el('li', {}, a)))]),
  );
}

async function calculate() {
  showErrors(); msg('');
  try {
    const { result } = await api.post('/tax/calculate', { year: state.year, ...readForm() });
    renderResult(result);
  } catch (err) {
    if (err instanceof ApiError && err.details) { showErrors(err.details); msg('Please correct the highlighted fields.'); } else msg(errText(err));
  }
}

async function save() {
  showErrors();
  try { await api.put(`/tax/profile?year=${state.year}`, readForm()); toast('Figures saved.', 'success'); msg('Saved. Only these figures are stored, never the tax result.'); }
  catch (err) { if (err instanceof ApiError && err.details) { showErrors(err.details); msg('Please correct the highlighted fields.'); } else msg(errText(err)); }
}

async function useRecords() {
  try {
    const { items } = await api.get(`/tax/suggestions?year=${state.year}`);
    if (!items.length) { msg('No SIP or health insurance records apply to this tax year. Add them on the Investments and Insurance pages.'); return; }
    for (const i of items) qs(`#f-${i.field}`).value = String(i.amount);
    msg(`Filled ${items.length} ${items.length === 1 ? 'field' : 'fields'} from your records: ${items.map((i) => i.source).join(' ')} Check them against your proofs.`);
  } catch (err) { msg(errText(err)); }
}

async function loadYear(year) {
  state.year = year;
  const y = state.rules.years.find((r) => r.id === year);
  qs('#rules-note').textContent = `${y.act} Rules last checked ${y.verifiedOn} against published summaries. Confirm figures with the Income Tax Department (incometax.gov.in) before filing.`;
  const { profile } = await api.get(`/tax/profile?year=${year}`);
  qs('#tax-form').reset();
  if (profile) { fillForm(profile.inputs); msg(`Loaded your saved figures (updated ${new Date(profile.updatedAt).toLocaleDateString('en-IN')}).`); await calculate(); }
  else { msg(''); qs('#results').replaceChildren(EMPTY); }
}

/** Indian income tax is only for INR accounts. For any other currency the page shows this and nothing else. */
function showClosed(currency) {
  qs('#rules-note').classList.add('hidden');
  qs('.tax-grid').classList.add('hidden');
  qs('#year').closest('label').classList.add('hidden');
  qs('#results').replaceChildren();
  qs('#page-error').replaceChildren(el('section', { class: 'card', id: 'tax-closed', role: 'status' }, [
    el('div', { class: 'empty__title' }, 'Tax estimation is only available in India'),
    el('p', {}, `Your account currency is ${currency}. FinVista's tax tool follows Indian income-tax rules (INR) and is switched off for other currencies, so nothing is calculated or stored here.`),
    el('p', {}, 'If you are in India, change your currency to INR on the Account page and this tool will open again.'),
    el('a', { class: 'btn btn--primary btn--sm', href: '/account.html' }, 'Go to Account'),
  ]));
}

(async function init() {
  let user;
  try { user = await requireLogin(); }
  catch (err) { renderSidebar('tax', null); qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not verify your session: ${err.message}`)); return; }
  if (!user) return;
  renderSidebar('tax', user);
  if (user.currency !== 'INR') { showClosed(user.currency); return; }
  try {
    state.rules = await api.get('/tax/rules');
    buildForm(state.rules.cities);
    const sel = qs('#year');
    sel.replaceChildren(...state.rules.years.map((y) => el('option', { value: y.id }, y.id)));
    sel.value = state.rules.defaultYear;
    sel.addEventListener('change', () => loadYear(sel.value).catch((e) => msg(errText(e))));
    qs('#tax-form').addEventListener('submit', (e) => { e.preventDefault(); calculate(); });
    qs('#save-btn').addEventListener('click', save);
    qs('#suggest-btn').addEventListener('click', useRecords);
    await loadYear(state.rules.defaultYear);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'TAX_INDIA_ONLY') { showClosed(user.currency); return; }
    qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not load the tax page: ${errText(err)}`));
  }
})();
