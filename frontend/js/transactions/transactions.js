/** Transactions page: list, filter, paginate, add, edit, delete, import and export. */
import { qs, el } from '../core/dom.js';
import { api, ApiError } from '../core/api.js';
import { formatCurrency, formatDate, formatDateShort } from '../core/format.js';
import { requireLogin } from '../core/auth.js';
import { toast } from '../core/toast.js';
import { renderSidebar, initDrawer } from '../ui/appShell.js';
import { confirmDialog } from '../ui/modal.js';
import { openTransactionForm } from './txForm.js';
import { openImportDialog } from './importDialog.js';
import { offerRule } from './ruleOffer.js';

const PAGE_SIZE = 20;
const state = { categories: [], page: 1, totalPages: 1, total: 0, hasAny: null, controller: null };

initDrawer();

/** Reads the filter controls into the query-string object the API expects (empty values omitted). */
function currentFilters() {
  const f = {
    q: qs('#f-q').value.trim(), type: qs('#f-type').value, categoryId: qs('#f-category').value,
    from: qs('#f-from').value, to: qs('#f-to').value, sort: qs('#f-sort').value,
  };
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
}
const toQuery = (obj) => new URLSearchParams(obj).toString();
const hasActiveFilters = () => Object.keys(currentFilters()).some((k) => k !== 'sort');

function updateExportLink() {
  const { sort, ...rest } = currentFilters();
  const query = toQuery({ ...rest, ...(sort ? { sort } : {}) });
  qs('#export-link').setAttribute('href', `/api/transactions/export${query ? `?${query}` : ''}`);
}

/* ---------------------------------------------------------------- rendering */

function renderSummary(summary) {
  qs('#sum-income').textContent = formatCurrency(summary.income);
  qs('#sum-expenses').textContent = formatCurrency(summary.expenses);
  const net = qs('#sum-net');
  net.textContent = formatCurrency(summary.net);
  net.classList.toggle('text-negative', summary.net < 0);
  net.classList.toggle('text-positive', summary.net > 0);
  qs('#sum-count').textContent = String(summary.count);
}

function renderEmpty() {
  const filtered = hasActiveFilters();
  const actions = filtered
    ? [el('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: clearFilters }, 'Clear filters')]
    : [el('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: addTransaction }, '+ Add your first transaction'), ' ', el('button', { class: 'btn btn--secondary btn--sm', type: 'button', onclick: importCsv }, 'Import a CSV')];
  return el('div', { class: 'empty' }, [
    el('div', { class: 'empty__title' }, filtered ? 'No transactions match these filters' : 'No transactions yet'),
    el('p', {}, filtered ? 'Try a wider date range or fewer filters.' : 'Add income and expenses one at a time, or import a CSV file.'),
    el('div', {}, actions),
  ]);
}

function renderTable(rows) {
  const body = rows.map((t) => el('tr', { dataset: { id: t.id } }, [
    el('td', { class: 'col-date' }, [el('span', { class: 'date-full' }, formatDate(t.date)), el('span', { class: 'date-short' }, formatDateShort(t.date))]),
    el('td', { class: 'desc' }, t.description),
    el('td', { class: 'col-cat' }, [el('span', { class: 'badge' }, t.category), t.categorySource === 'user' ? '' : el('span', { class: 'auto-tag', title: t.categorySource === 'default' ? 'No rule matched, so FinVista placed this in Other. Edit it to choose a category.' : 'Categorised automatically by a rule. Edit it to change.' }, t.categorySource === 'default' ? 'unmatched' : 'auto')]),
    el('td', { class: `num ${t.type === 'income' ? 'text-positive' : 'text-negative'}` }, `${t.type === 'income' ? '+' : '−'}${formatCurrency(t.amount)}`),
    el('td', { class: 'col-actions' }, el('span', { class: 'tx-actions' }, [
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-action': 'edit', 'aria-label': `Edit ${t.description}`, onclick: () => editTransaction(t) }, 'Edit'),
      el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-action': 'delete', 'aria-label': `Delete ${t.description}`, onclick: () => deleteTransaction(t) }, 'Delete'),
    ])),
  ]));
  return el('div', { class: 'table-wrap' }, el('table', { class: 'table tx-table' }, [
    el('thead', {}, el('tr', {}, [
      el('th', { class: 'col-date' }, 'Date'), el('th', {}, 'Description'), el('th', { class: 'col-cat' }, 'Category'),
      el('th', { class: 'num' }, 'Amount'), el('th', { class: 'col-actions' }, el('span', { class: 'sr-only' }, 'Actions')),
    ])),
    el('tbody', {}, body),
  ]));
}

function renderPager(pagination) {
  const pager = qs('#pager');
  if (pagination.total === 0) { pager.replaceChildren(); return; }
  const start = (pagination.page - 1) * pagination.pageSize + 1;
  const end = Math.min(pagination.page * pagination.pageSize, pagination.total);
  pager.replaceChildren(
    el('span', {}, `Showing ${start}–${end} of ${pagination.total}`),
    el('span', { class: 'pager__buttons' }, [
      el('button', { class: 'btn btn--secondary btn--sm', type: 'button', id: 'prev-page', disabled: pagination.page <= 1, onclick: () => goToPage(pagination.page - 1) }, 'Previous'),
      el('span', { class: 'num' }, `Page ${pagination.page} of ${pagination.totalPages}`),
      el('button', { class: 'btn btn--secondary btn--sm', type: 'button', id: 'next-page', disabled: pagination.page >= pagination.totalPages, onclick: () => goToPage(pagination.page + 1) }, 'Next'),
    ]),
  );
}

/* --------------------------------------------------------------------- data */

async function load() {
  state.controller?.abort(); // a newer request replaces an older one still in flight
  const controller = new AbortController();
  state.controller = controller;
  const body = qs('#tx-body');
  body.setAttribute('aria-busy', 'true');
  qs('#filter-error').textContent = '';
  updateExportLink();
  try {
    const res = await api.get(`/transactions?${toQuery({ ...currentFilters(), page: state.page, pageSize: PAGE_SIZE })}`, { signal: controller.signal });
    if (res.pagination.page > res.pagination.totalPages) { state.page = res.pagination.totalPages; return load(); } // e.g. deleted the last row of the last page
    state.total = res.pagination.total;
    renderSummary(res.summary);
    body.replaceChildren(res.transactions.length ? renderTable(res.transactions) : renderEmpty());
    renderPager(res.pagination);
    qs('#page-error').replaceChildren();
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (err instanceof ApiError && err.status === 401) { location.assign('/login.html?next=/transactions.html'); return; }
    if (err instanceof ApiError && err.status === 400 && err.details) { qs('#filter-error').textContent = Object.values(err.details).join(' '); }
    else qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not load transactions: ${err.message}`));
  } finally {
    if (state.controller === controller) body.setAttribute('aria-busy', 'false');
  }
}

function goToPage(page) { state.page = page; load(); qs('#tx-title').scrollIntoView({ block: 'start' }); }
function applyFilters() { state.page = 1; load(); }

function clearFilters() {
  for (const id of ['f-q', 'f-type', 'f-category', 'f-from', 'f-to']) qs(`#${id}`).value = '';
  qs('#f-sort').value = 'date_desc';
  applyFilters();
}

/* ------------------------------------------------------------------ actions */

async function addTransaction() {
  const saved = await openTransactionForm({ categories: state.categories });
  if (!saved) return;
  toast('Transaction added.', 'success');
  load();
  await offerRule(saved).then((r) => { if (r) load(); });
}
async function editTransaction(tx) {
  const saved = await openTransactionForm({ categories: state.categories, transaction: tx });
  if (!saved) return;
  toast('Transaction updated.', 'success');
  load();
  // Only a changed category is a "correction" worth learning from.
  if (saved.categoryId !== tx.categoryId) await offerRule(saved).then((r) => { if (r) load(); });
}
async function deleteTransaction(tx) {
  const ok = await confirmDialog({
    title: 'Delete this transaction?',
    message: `${tx.description} · ${formatCurrency(tx.amount)} on ${formatDate(tx.date)}. This cannot be undone.`,
    confirmLabel: 'Delete', danger: true,
  });
  if (!ok) return;
  try {
    await api.del(`/transactions/${tx.id}`);
    toast('Transaction deleted.', 'success');
    load();
  } catch (err) {
    toast(err instanceof ApiError ? err.message : 'Could not delete the transaction.', 'error');
  }
}
async function importCsv() { if (await openImportDialog()) { state.page = 1; load(); } }

/* --------------------------------------------------------------------- init */

function wireFilters() {
  let timer;
  qs('#f-q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(applyFilters, 300); });
  for (const id of ['f-type', 'f-category', 'f-from', 'f-to', 'f-sort']) qs(`#${id}`).addEventListener('change', applyFilters);
  qs('#filters').addEventListener('submit', (e) => e.preventDefault());
  qs('#clear-filters').addEventListener('click', clearFilters);
  qs('#add-btn').addEventListener('click', addTransaction);
  qs('#import-btn').addEventListener('click', importCsv);
}

(async function init() {
  let user;
  try {
    user = await requireLogin();
  } catch (err) {
    renderSidebar('transactions', null);
    qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not verify your session: ${err.message}`));
    return;
  }
  if (!user) return; // redirecting to login
  renderSidebar('transactions', user);
  try {
    state.categories = (await api.get('/categories')).categories;
  } catch (err) {
    qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not load categories: ${err.message}`));
    return;
  }
  const select = qs('#f-category');
  for (const [label, kind] of [['Expense categories', 'expense'], ['Income categories', 'income']]) {
    const group = el('optgroup', { label }, state.categories.filter((c) => c.kind === kind).map((c) => el('option', { value: c.id }, c.name)));
    select.append(group);
  }
  const presetQ = new URLSearchParams(location.search).get('q');
  if (presetQ) qs('#f-q').value = presetQ.slice(0, 100); // e.g. a link from the Forecast page's unusual-spending list
  wireFilters();
  await load();
  if (new URLSearchParams(location.search).get('new') === '1') { history.replaceState(null, '', '/transactions.html'); addTransaction(); }
})();
