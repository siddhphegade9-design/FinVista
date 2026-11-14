/** Investments (SIP) page: records, estimates, growth chart and a what-if calculator. All maths is done by the API. */
import { qs, el } from '../core/dom.js';
import { api, ApiError } from '../core/api.js';
import { formatCurrency, formatDate } from '../core/format.js';
import { applyChartTheme, chartPalette } from '../core/chartTheme.js';
import { requireLogin } from '../core/auth.js';
import { toast } from '../core/toast.js';
import { renderSidebar, initDrawer } from '../ui/appShell.js';
import { confirmDialog } from '../ui/modal.js';
import { openRecordForm } from '../ui/recordForm.js';

initDrawer();
let chart;
let data = null;

const TYPES = [['mutual_fund', 'Mutual fund'], ['elss', 'ELSS (tax-saving fund)'], ['ppf', 'PPF'], ['nps', 'NPS'], ['stock', 'Stocks'], ['other', 'Other']];
const TYPE_LABEL = Object.fromEntries(TYPES);
const money = (n) => formatCurrency(n, { whole: true });
const est = () => el('span', { class: 'inv-tag' }, 'estimate');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const FIELDS = [
  { name: 'name', label: 'Name', type: 'text', full: true, maxlength: 80, placeholder: 'e.g. Nifty 50 index fund' },
  { name: 'instrumentType', label: 'Type', type: 'select', options: TYPES },
  { name: 'monthlyAmount', label: 'Monthly amount (₹)', type: 'number', inputmode: 'decimal', placeholder: '5000' },
  { name: 'startDate', label: 'First instalment date', type: 'date' },
  { name: 'durationMonths', label: 'Duration (months)', type: 'number', inputmode: 'numeric', hint: 'Leave blank if there is no planned end.' },
  { name: 'stepUpPercent', label: 'Yearly step-up (%)', type: 'number', inputmode: 'decimal', hint: 'How much the instalment rises each year. 0 if it stays the same.' },
  { name: 'expectedReturnPercent', label: 'Return you assume (% a year)', type: 'number', inputmode: 'decimal', hint: 'Your own assumption for estimates, not a promise.' },
  { name: 'currentValue', label: 'Current value you know (₹, optional)', type: 'number', inputmode: 'decimal', hint: 'From your statement. Shown separately from estimates.' },
  { name: 'currentValueAsOf', label: 'Value as of (date)', type: 'date' },
  { name: 'notes', label: 'Notes (optional)', type: 'textarea', full: true },
  { name: 'isActive', label: 'Active (untick if paused or stopped)', type: 'checkbox', default: true },
];

const toForm = (s) => (s ? { name: s.name, instrumentType: s.instrumentType, monthlyAmount: String(s.monthlyAmount), startDate: s.startDate, durationMonths: s.durationMonths ?? '', stepUpPercent: String(s.stepUpPercent || ''), expectedReturnPercent: String(s.expectedReturnPercent), currentValue: s.currentValue === null ? '' : String(s.currentValue), currentValueAsOf: s.currentValueAsOf ?? '', notes: s.notes ?? '', isActive: s.isActive } : { startDate: today(), isActive: true });
const toBody = (v) => ({ ...v, durationMonths: v.durationMonths === '' ? null : v.durationMonths, currentValue: v.currentValue === '' ? null : v.currentValue, currentValueAsOf: v.currentValueAsOf === '' ? null : v.currentValueAsOf });

async function editSip(sip) {
  const saved = await openRecordForm({
    title: sip ? 'Edit SIP or investment' : 'Add SIP or investment', fields: FIELDS, values: toForm(sip), saveLabel: sip ? 'Save changes' : 'Add',
    submit: (v) => (sip ? api.put(`/sips/${sip.id}`, toBody(v)) : api.post('/sips', toBody(v))),
  });
  if (saved) { toast(sip ? 'Investment updated.' : 'Investment added.', 'success'); await load(); }
}

async function deleteSip(sip) {
  if (!(await confirmDialog({ title: `Delete “${sip.name}”?`, message: 'This removes the record from FinVista only. It cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
  try { await api.del(`/sips/${sip.id}`); toast('Investment deleted.', 'success'); await load(); }
  catch (err) { toast(err instanceof ApiError ? err.message : 'Could not delete.', 'error'); }
}

const fact = (label, value, { estimate = false } = {}) => el('div', { class: `inv-fact${estimate ? ' inv-fact--est' : ''}` }, [el('dt', {}, label), el('dd', {}, [value, estimate ? est() : ''])]);

function renderSip(s) {
  const term = s.durationMonths ? `${plural(s.durationMonths, 'month')} (ends ${formatDate(s.endDate)})` : 'Ongoing';
  const sub = [TYPE_LABEL[s.instrumentType], `${money(s.monthlyAmount)} a month`, s.stepUpPercent ? `${s.stepUpPercent}% yearly step-up` : null, `${s.expectedReturnPercent}% assumed return`, `from ${formatDate(s.startDate)}`, term].filter(Boolean).join(' · ');
  const status = !s.isActive ? 'Paused or stopped' : s.finished ? 'Completed' : null;
  const facts = [
    fact('Instalments so far', `${s.instalmentsPaid} (${money(s.scheduledInvested)})`),
    fact('Next instalment', s.nextInstalment ? money(s.nextInstalment) : '—'),
    fact('Value now (modelled)', money(s.modelledValue), { estimate: true }),
  ];
  if (s.currentValue !== null) facts.push(fact(`Value you recorded (${formatDate(s.currentValueAsOf)})`, money(s.currentValue)));
  facts.push(fact(s.projection.ongoing ? `In 10 years (${formatDate(s.projection.date)})` : `At the end (${formatDate(s.projection.date)})`, `${money(s.projection.value)} from ${money(s.projection.invested)} put in`, { estimate: true }));
  facts.push(fact('Estimated gain at that date', money(s.projection.gain), { estimate: true }));
  return el('article', { class: `card inv-item${s.isActive ? '' : ' inv-paused'}`, dataset: { id: s.id } }, [
    el('div', { class: 'inv-item__head' }, [
      el('div', {}, [el('h3', { class: 'inv-item__title' }, [s.name, status ? el('span', { class: 'badge' }, status) : '']), el('div', { class: 'inv-item__sub' }, sub)]),
      el('span', { class: 'inv-item__actions' }, [
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-action': 'edit', 'aria-label': `Edit ${s.name}`, onclick: () => editSip(s) }, 'Edit'),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-action': 'delete', 'aria-label': `Delete ${s.name}`, onclick: () => deleteSip(s) }, 'Delete'),
      ]),
    ]),
    el('dl', { class: 'inv-facts' }, facts),
    s.notes ? el('div', { class: 'inv-item__sub' }, s.notes) : '',
  ]);
}

function render() {
  const { sips, summary, growth } = data;
  qs('#k-monthly').textContent = money(summary.monthlyCommitment);
  qs('#k-monthly-sub').textContent = `${plural(summary.activeCount, 'active SIP')}, at today's instalment`;
  qs('#k-invested').textContent = money(summary.scheduledInvested);
  qs('#k-recorded').textContent = summary.recordedValueCount ? money(summary.recordedValue) : '—';
  qs('#k-recorded-sub').textContent = summary.recordedValueCount ? `Your own figures for ${plural(summary.recordedValueCount, 'investment')}` : 'Add a current value from your statement';
  const last = growth[growth.length - 1];
  qs('#k-future').textContent = summary.activeCount ? money(last.value) : '—';
  qs('#k-future-sub').replaceChildren(summary.activeCount ? `From ${money(last.invested)} put in` : 'No active SIPs', summary.activeCount ? est() : '');
  qs('#model-note').textContent = data.note;

  const any = summary.activeCount > 0;
  qs('#w-growth').classList.toggle('hidden', !any);
  qs('#e-growth').classList.toggle('hidden', any);
  chart?.destroy(); chart = null;
  if (any) {
    const [c1, c2] = chartPalette();
    chart = new window.Chart(qs('#chart-growth'), {
      type: 'line',
      data: {
        labels: growth.map((g) => (g.year === 0 ? 'Today' : `+${g.year}y`)),
        datasets: [
          { label: 'Scheduled money put in', data: growth.map((g) => g.invested), borderColor: c1, backgroundColor: c1, pointRadius: 3, tension: 0.2 },
          { label: 'Estimated value (at your assumed returns)', data: growth.map((g) => g.value), borderColor: c2, backgroundColor: c2, borderDash: [6, 4], pointRadius: 3, tension: 0.2 },
        ],
      },
      options: { scales: { y: { beginAtZero: true } }, plugins: { legend: { position: 'bottom' } } },
    });
  }
  qs('#sip-list').replaceChildren(...(sips.length ? sips.map(renderSip) : [el('div', { class: 'card empty' }, [el('div', { class: 'empty__title' }, 'No SIPs or investments yet'), el('p', {}, 'Add one with its monthly amount, start date, duration and the return you assume.'), el('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => editSip(null) }, '+ Add your first SIP')])]));
}

async function load() {
  try {
    data = await api.get('/sips');
    render();
    qs('#page-error').replaceChildren();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) { location.assign('/login.html?next=/investments.html'); return; }
    qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not load your investments: ${err.message}`));
  } finally { qs('#inv').setAttribute('aria-busy', 'false'); }
}

function wireCalculator() {
  const ids = { monthlyAmount: 'c-amount', years: 'c-years', stepUpPercent: 'c-step', expectedReturnPercent: 'c-return' };
  qs('#calc').addEventListener('submit', async (e) => {
    e.preventDefault();
    for (const id of Object.values(ids)) qs(`#${id}-error`).textContent = '';
    const body = Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, qs(`#${id}`).value.trim()]));
    try {
      const r = await api.post('/sips/calculate', body);
      qs('#calc-result').replaceChildren(el('div', { class: 'alert alert--info', role: 'status' }, [
        el('div', {}, [`Putting in ${money(r.invested)} over ${r.months} months could grow to about `, el('strong', {}, money(r.value)), ', a gain of about ', el('strong', {}, money(r.gain)), '. ', est()]),
        el('div', { class: 'inv-note' }, r.note),
      ]));
    } catch (err) {
      qs('#calc-result').replaceChildren();
      if (err instanceof ApiError && err.details) { for (const [k, id] of Object.entries(ids)) qs(`#${id}-error`).textContent = err.details[k] || ''; }
      else toast(err.message, 'error');
    }
  });
}

(async function init() {
  let user;
  try { user = await requireLogin(); }
  catch (err) { renderSidebar('investments', null); qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not verify your session: ${err.message}`)); return; }
  if (!user) return;
  renderSidebar('investments', user);
  applyChartTheme(window.Chart);
  qs('#add-btn').addEventListener('click', () => editSip(null));
  wireCalculator();
  await load();
})();
