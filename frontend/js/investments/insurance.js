/** Insurance page: policy records, premium totals and renewal reminders. */
import { qs, el } from '../core/dom.js';
import { api, ApiError } from '../core/api.js';
import { formatCurrency, formatDate } from '../core/format.js';
import { requireLogin } from '../core/auth.js';
import { toast } from '../core/toast.js';
import { renderSidebar, initDrawer } from '../ui/appShell.js';
import { confirmDialog } from '../ui/modal.js';
import { openRecordForm } from '../ui/recordForm.js';

initDrawer();
let data = null;

const TYPES = [['health', 'Health'], ['term_life', 'Term life'], ['life', 'Life (other)'], ['motor', 'Motor'], ['home', 'Home'], ['travel', 'Travel'], ['other', 'Other']];
const FREQ = [['yearly', 'Yearly'], ['half_yearly', 'Half-yearly'], ['quarterly', 'Quarterly'], ['monthly', 'Monthly']];
const TYPE_LABEL = Object.fromEntries(TYPES);
const FREQ_LABEL = Object.fromEntries(FREQ);
const money = (n) => formatCurrency(n, { whole: true });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const FIELDS = [
  { name: 'name', label: 'Policy name', type: 'text', full: true, maxlength: 80, placeholder: 'e.g. Family floater health plan' },
  { name: 'insurer', label: 'Insurer (optional)', type: 'text', maxlength: 80 },
  { name: 'policyType', label: 'Type', type: 'select', options: TYPES },
  { name: 'sumAssured', label: 'Cover / sum assured (₹)', type: 'number', inputmode: 'decimal', placeholder: '1000000' },
  { name: 'premium', label: 'Premium per payment (₹)', type: 'number', inputmode: 'decimal' },
  { name: 'premiumFrequency', label: 'Paid', type: 'select', options: FREQ },
  { name: 'nextDueDate', label: 'Next premium due', type: 'date' },
  { name: 'notes', label: 'Notes (optional)', type: 'textarea', full: true },
  { name: 'isActive', label: 'Active (untick if lapsed or cancelled)', type: 'checkbox', default: true },
];
const toForm = (p) => (p ? { name: p.name, insurer: p.insurer ?? '', policyType: p.policyType, sumAssured: String(p.sumAssured), premium: String(p.premium), premiumFrequency: p.premiumFrequency, nextDueDate: p.nextDueDate, notes: p.notes ?? '', isActive: p.isActive } : { isActive: true, premiumFrequency: 'yearly' });

async function editPolicy(policy) {
  const saved = await openRecordForm({
    title: policy ? 'Edit policy' : 'Add policy', fields: FIELDS, values: toForm(policy), saveLabel: policy ? 'Save changes' : 'Add policy',
    submit: (v) => (policy ? api.put(`/insurance/${policy.id}`, v) : api.post('/insurance', v)),
  });
  if (saved) { toast(policy ? 'Policy updated.' : 'Policy added.', 'success'); await load(); }
}
async function deletePolicy(policy) {
  if (!(await confirmDialog({ title: `Delete “${policy.name}”?`, message: 'This removes the record from FinVista only; it does not cancel the policy. It cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
  try { await api.del(`/insurance/${policy.id}`); toast('Policy deleted.', 'success'); await load(); }
  catch (err) { toast(err instanceof ApiError ? err.message : 'Could not delete.', 'error'); }
}

const fact = (label, value) => el('div', { class: 'inv-fact' }, [el('dt', {}, label), el('dd', {}, value)]);

function renewalBadge(p) {
  if (p.renewalStatus === 'overdue') return el('span', { class: 'badge badge--negative' }, `Overdue by ${plural(-p.daysUntilDue, 'day')}`);
  if (p.renewalStatus === 'due_soon') return el('span', { class: 'badge badge--warning' }, p.daysUntilDue === 0 ? 'Due today' : `Due in ${plural(p.daysUntilDue, 'day')}`);
  if (p.renewalStatus === 'inactive') return el('span', { class: 'badge' }, 'Inactive');
  return el('span', { class: 'badge' }, `Due in ${plural(p.daysUntilDue, 'day')}`);
}

function renderPolicy(p) {
  const sub = [TYPE_LABEL[p.policyType], p.insurer, `${money(p.premium)} ${FREQ_LABEL[p.premiumFrequency].toLowerCase()}`].filter(Boolean).join(' · ');
  return el('article', { class: `card inv-item${p.isActive ? '' : ' inv-paused'}`, dataset: { id: p.id } }, [
    el('div', { class: 'inv-item__head' }, [
      el('div', {}, [el('h3', { class: 'inv-item__title' }, [p.name, ' ', renewalBadge(p)]), el('div', { class: 'inv-item__sub' }, sub)]),
      el('span', { class: 'inv-item__actions' }, [
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-action': 'edit', 'aria-label': `Edit ${p.name}`, onclick: () => editPolicy(p) }, 'Edit'),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-action': 'delete', 'aria-label': `Delete ${p.name}`, onclick: () => deletePolicy(p) }, 'Delete'),
      ]),
    ]),
    el('dl', { class: 'inv-facts' }, [fact('Cover', money(p.sumAssured)), fact('Per year', money(p.annualPremium)), fact('Per month (equivalent)', formatCurrency(p.monthlyEquivalent)), fact('Next due', formatDate(p.nextDueDate))]),
    p.notes ? el('div', { class: 'inv-item__sub' }, p.notes) : '',
  ]);
}

function render() {
  const { policies, summary } = data;
  qs('#k-annual').textContent = money(summary.annualPremium);
  qs('#k-annual-sub').textContent = summary.activeCount ? `Across ${plural(summary.activeCount, 'active policy', 'active policies')}` : 'No active policies';
  qs('#k-monthly').textContent = formatCurrency(summary.monthlyEquivalent);
  qs('#k-count').textContent = String(summary.activeCount);
  qs('#k-count-sub').textContent = summary.count > summary.activeCount ? `${summary.count - summary.activeCount} inactive` : 'All records active';
  const attention = summary.dueSoon + summary.overdue;
  qs('#k-due').textContent = String(attention);
  qs('#k-due-sub').textContent = attention ? [summary.overdue ? `${summary.overdue} overdue` : null, summary.dueSoon ? `${summary.dueSoon} due within 30 days` : null].filter(Boolean).join(', ') : 'Nothing due in the next 30 days';
  qs('#model-note').textContent = data.note;
  const cover = Object.entries(summary.coverByType);
  qs('#cover-list').replaceChildren(...(cover.length ? cover.map(([t, v]) => el('li', {}, [el('span', {}, TYPE_LABEL[t]), el('span', {}, money(v))])) : [el('li', {}, 'No active policies yet.')]));
  qs('#pol-list').replaceChildren(...(policies.length ? policies.map(renderPolicy) : [el('div', { class: 'card empty' }, [el('div', { class: 'empty__title' }, 'No policies yet'), el('p', {}, 'Add your health, term or other policies with their premium and next due date.'), el('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => editPolicy(null) }, '+ Add your first policy')])]));
}

async function load() {
  try {
    data = await api.get('/insurance');
    render();
    qs('#page-error').replaceChildren();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) { location.assign('/login.html?next=/insurance.html'); return; }
    qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not load your policies: ${err.message}`));
  } finally { qs('#ins').setAttribute('aria-busy', 'false'); }
}

(async function init() {
  let user;
  try { user = await requireLogin(); }
  catch (err) { renderSidebar('insurance', null); qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not verify your session: ${err.message}`)); return; }
  if (!user) return;
  renderSidebar('insurance', user);
  qs('#add-btn').addEventListener('click', () => editPolicy(null));
  await load();
})();
