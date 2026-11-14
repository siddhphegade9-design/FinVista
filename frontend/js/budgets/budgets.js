/** Budgets page: monthly limits per expense category compared with what was actually spent. */
import { qs, el } from '../core/dom.js';
import { api, ApiError } from '../core/api.js';
import { formatCurrency } from '../core/format.js';
import { requireLogin } from '../core/auth.js';
import { toast } from '../core/toast.js';
import { renderSidebar, initDrawer } from '../ui/appShell.js';
import { confirmDialog } from '../ui/modal.js';
import { openRecordForm } from '../ui/recordForm.js';

initDrawer();
const state = { month: new Date().toISOString().slice(0, 7), view: null, categories: [] };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const shift = (key, n) => { const [y, m] = key.split('-').map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const money = (n) => formatCurrency(n, { whole: true });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const errText = (err, fallback) => (err instanceof ApiError ? (err.details ? Object.values(err.details).join(' ') : err.message) : fallback);

const STATUS = { ok: ['On track', ''], watch: ['Close to limit', 'badge--warning'], over: ['Over budget', 'badge--negative'] };

function budgetRow(r, { overall = false } = {}) {
  const pct = r.usedRatio === null ? 100 : Math.min(100, r.usedRatio * 100);
  const bar = el('div', { class: 'progress__bar' });
  bar.style.setProperty('--value', pct.toFixed(1));
  const [label, cls] = STATUS[r.status];
  const left = r.remaining >= 0 ? `${money(r.remaining)} left` : `${money(-r.remaining)} over`;
  return el('div', { class: 'bud-row', dataset: { id: r.id, status: r.status } }, [
    el('div', { class: 'bud-row__head' }, [
      el('span', { class: 'bud-row__name' }, [r.category, ' ', el('span', { class: `badge ${cls}` }, label)]),
      el('span', { class: 'bud-row__nums' }, `${money(r.spent)} of ${money(r.limit)} · ${left}`),
    ]),
    el('div', { class: `progress${r.status === 'over' ? ' progress--danger' : r.status === 'watch' ? ' progress--warning' : ''}`, role: 'progressbar', 'aria-label': `${r.category} budget used`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)) }, bar),
    el('div', { class: 'bud-row__foot' }, [
      el('span', {}, r.pace || (r.usedRatio === null ? '' : `${Math.round(r.usedRatio * 100)}% used`)),
      el('span', { class: 'bud-row__actions' }, [
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-action': 'edit', 'aria-label': `Change budget for ${r.category}`, onclick: () => setBudget(overall ? { overall: true, limit: r.limit } : { categoryId: r.categoryId, limit: r.limit }) }, 'Change'),
        el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-action': 'remove', 'aria-label': `Remove budget for ${r.category}`, onclick: () => removeBudget(r) }, 'Remove'),
      ]),
    ]),
  ]);
}

function render() {
  const v = state.view;
  qs('#month-label').textContent = monthLabel(state.month);
  qs('#phase-note').textContent = v.phase === 'current'
    ? `This month is not finished: ${Math.round(v.elapsedRatio * 100)}% of it has passed. “Spent” is what you have recorded so far.`
    : v.phase === 'future' ? 'A future month: nothing has been spent yet. Budgets you set now apply when the month arrives.' : 'A finished month.';
  const t = v.totals;
  qs('#k-limit').textContent = money(t.limit);
  qs('#k-limit-sub').textContent = plural(t.budgetedCategories, 'category budget');
  qs('#k-spent').textContent = money(t.spentInBudgeted);
  qs('#k-spent-sub').textContent = `All spending this month: ${money(t.totalSpent)}`;
  qs('#k-remaining').textContent = money(t.remaining);
  qs('#k-remaining').classList.toggle('text-negative', t.remaining < 0);
  qs('#k-remaining-sub').textContent = t.remaining < 0 ? 'Over the combined limits' : 'Combined limits minus spending';
  const attn = t.overCount + t.watchCount;
  qs('#k-attn').textContent = String(attn);
  qs('#k-attn-sub').textContent = attn ? [t.overCount ? `${t.overCount} over` : null, t.watchCount ? `${t.watchCount} close to the limit` : null].filter(Boolean).join(', ') : 'Nothing close to a limit';

  qs('#overall-card').classList.toggle('hidden', !v.overall);
  qs('#overall').replaceChildren(...(v.overall ? [budgetRow(v.overall, { overall: true })] : []));
  qs('#rows').replaceChildren(...v.rows.map((r) => budgetRow(r)));
  qs('#empty').classList.toggle('hidden', v.rows.length > 0);
  qs('#unbudgeted').replaceChildren(...(v.unbudgeted.length ? v.unbudgeted.map((u) => el('div', { class: 'bud-row' }, [
    el('div', { class: 'bud-row__head' }, [el('span', { class: 'bud-row__name' }, u.category), el('span', { class: 'bud-row__nums' }, [money(u.spent), ' ', el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => setBudget({ categoryId: u.categoryId, limit: Math.ceil(u.spent / 100) * 100 }) }, 'Set a budget')])]),
  ])) : [el('p', { class: 'bud-note' }, v.totals.totalSpent ? 'Every category you spent in has a budget.' : 'No spending recorded this month.')]));
}

async function load() {
  qs('#bud').setAttribute('aria-busy', 'true');
  try {
    state.view = await api.get(`/budgets?month=${state.month}`);
    render();
    qs('#page-error').replaceChildren();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) { location.assign('/login.html?next=/budgets.html'); return; }
    qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not load budgets: ${err.message}`));
  } finally { qs('#bud').setAttribute('aria-busy', 'false'); }
}

async function setBudget(preset = {}) {
  const expense = state.categories.filter((c) => c.kind === 'expense');
  const options = [['', 'Overall (all spending)'], ...expense.map((c) => [c.id, c.name])];
  const saved = await openRecordForm({
    title: `Budget for ${monthLabel(state.month)}`,
    fields: [
      { name: 'categoryId', label: 'Category', type: 'select', options, full: true, hint: 'Setting a budget that already exists changes its limit.' },
      { name: 'limit', label: 'Monthly limit (₹)', type: 'number', inputmode: 'decimal', placeholder: '5000', full: true },
    ],
    values: { categoryId: preset.overall ? '' : (preset.categoryId ?? expense[0]?.id ?? ''), limit: preset.limit ? String(preset.limit) : '' },
    saveLabel: 'Save budget',
    submit: (v) => api.put('/budgets', { month: state.month, categoryId: v.categoryId || null, limit: v.limit }),
  });
  if (saved) { toast('Budget saved.', 'success'); await load(); }
}

async function removeBudget(r) {
  if (!(await confirmDialog({ title: `Remove the budget for “${r.category}”?`, message: `Only the limit for ${monthLabel(state.month)} is removed. Your transactions are not affected.`, confirmLabel: 'Remove', danger: true }))) return;
  try { await api.del(`/budgets/${r.id}`); toast('Budget removed.', 'success'); await load(); }
  catch (err) { toast(errText(err, 'Could not remove the budget.'), 'error'); }
}

async function copyLast() {
  try {
    const res = await api.post('/budgets/copy', { fromMonth: shift(state.month, -1), toMonth: state.month });
    toast(`${plural(res.copied, 'budget')} copied from ${monthLabel(shift(state.month, -1))}.`, 'success');
    await load();
  } catch (err) { toast(errText(err, 'Could not copy budgets.'), 'error'); }
}

async function suggest() {
  let s;
  try { s = await api.get('/budgets/suggestions'); } catch (err) { toast(errText(err, 'Could not load suggestions.'), 'error'); return; }
  const dialog = el('dialog', { class: 'modal modal--wide', 'aria-labelledby': 'sg-title' });
  const close = () => dialog.close();
  if (s.status !== 'ok') {
    dialog.append(el('h3', { id: 'sg-title' }, 'Not enough history yet'), el('p', {}, `Suggestions need at least ${s.neededMonths} complete months of spending. You have ${plural(s.completeMonths, 'complete month')}. You can still set budgets yourself.`), el('div', { class: 'modal__actions' }, [el('button', { class: 'btn btn--secondary', type: 'button', onclick: close }, 'Close')]));
  } else {
    const boxes = s.suggestions.map((x) => el('input', { type: 'checkbox', checked: true, 'aria-label': `Use ${x.category}`, dataset: { id: x.categoryId, limit: String(x.suggested) } }));
    const rows = s.suggestions.map((x, i) => el('tr', {}, [el('td', {}, boxes[i]), el('td', {}, x.category), el('td', { class: 'num' }, money(x.average)), el('td', { class: 'num' }, money(x.suggested))]));
    const apply = el('button', { class: 'btn btn--primary', type: 'button', id: 'sg-apply' }, 'Set selected budgets');
    apply.addEventListener('click', async () => {
      apply.disabled = true;
      try {
        for (const b of boxes.filter((x) => x.checked)) await api.put('/budgets', { month: state.month, categoryId: b.dataset.id, limit: b.dataset.limit });
        toast('Budgets set.', 'success'); close(); await load();
      } catch (err) { toast(errText(err, 'Could not set budgets.'), 'error'); apply.disabled = false; }
    });
    dialog.append(
      el('h3', { id: 'sg-title' }, `Suggestions for ${monthLabel(state.month)}`),
      el('p', { class: 'bud-note' }, `${s.note} Based on ${s.months.map(monthLabel).join(', ')}.`),
      el('table', { class: 'sg-table' }, [el('thead', {}, el('tr', {}, [el('th', {}, ''), el('th', {}, 'Category'), el('th', { class: 'num' }, 'Average spent'), el('th', { class: 'num' }, 'Suggested limit')])), el('tbody', {}, rows)]),
      el('div', { class: 'modal__actions' }, [el('button', { class: 'btn btn--secondary', type: 'button', onclick: close }, 'Cancel'), apply]),
    );
  }
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

(async function init() {
  let user;
  try { user = await requireLogin(); }
  catch (err) { renderSidebar('budgets', null); qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not verify your session: ${err.message}`)); return; }
  if (!user) return;
  renderSidebar('budgets', user);
  try { state.categories = (await api.get('/categories')).categories; }
  catch (err) { qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not load categories: ${err.message}`)); return; }
  qs('#prev-month').addEventListener('click', () => { state.month = shift(state.month, -1); load(); });
  qs('#next-month').addEventListener('click', () => { state.month = shift(state.month, 1); load(); });
  qs('#add-btn').addEventListener('click', () => setBudget());
  qs('#copy-btn').addEventListener('click', copyLast);
  qs('#suggest-btn').addEventListener('click', suggest);
  await load();
})();
