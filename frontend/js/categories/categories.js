/** Categories page: manage categories, keyword rules, and re-apply rules to existing transactions. */
import { qs, el } from '../core/dom.js';
import { api, ApiError } from '../core/api.js';
import { requireLogin } from '../core/auth.js';
import { toast } from '../core/toast.js';
import { renderSidebar, initDrawer } from '../ui/appShell.js';
import { confirmDialog } from '../ui/modal.js';

initDrawer();
const state = { categories: [], rules: [], builtin: [] };
const KIND_LABEL = { expense: 'Expense', income: 'Income' };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const errorMessage = (err, fallback) => (err instanceof ApiError ? (err.details ? Object.values(err.details).join(' ') : err.message) : fallback);

/* ------------------------------------------------------------- categories */

function renderCategories() {
  const groups = ['expense', 'income'].map((kind) => el('div', { class: 'cat-group' }, [
    el('h3', {}, `${KIND_LABEL[kind]} categories`),
    el('ul', { class: 'cat-rows' }, state.categories.filter((c) => c.kind === kind).map((c) => el('li', { class: 'cat-row', dataset: { id: c.id } }, [
      el('span', { class: 'cat-row__name' }, c.name),
      el('span', { class: 'cat-row__meta' }, plural(c.transactionCount, 'transaction')),
      c.protected
        ? el('span', { class: 'cat-row__meta' }, 'Default')
        : el('span', { class: 'cat-row__actions' }, [
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-action': 'rename', 'aria-label': `Rename ${c.name}`, onclick: () => renameCategory(c) }, 'Rename'),
          el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-action': 'delete', 'aria-label': `Delete ${c.name}`, onclick: () => deleteCategory(c) }, 'Delete'),
        ]),
    ]))),
  ]));
  qs('#cat-list').replaceChildren(...groups);
  qs('#cat-list').setAttribute('aria-busy', 'false');

  const select = qs('#rule-category');
  const keep = select.value;
  select.replaceChildren(...['expense', 'income'].map((kind) => el('optgroup', { label: `${KIND_LABEL[kind]} categories` },
    state.categories.filter((c) => c.kind === kind).map((c) => el('option', { value: c.id }, c.name)))));
  if (state.categories.some((c) => c.id === keep)) select.value = keep;
}

function renameDialog(category) {
  return new Promise((resolve) => {
    const input = el('input', { class: 'input', id: 'rename-input', maxlength: '40', value: category.name, autocomplete: 'off', 'aria-describedby': 'rename-error' });
    const error = el('div', { class: 'field__error', id: 'rename-error', role: 'alert' });
    const save = el('button', { class: 'btn btn--primary', type: 'submit' }, 'Save');
    const form = el('form', { novalidate: true }, [
      el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'rename-input' }, 'Category name'), input, error]),
      el('div', { class: 'modal__actions' }, [el('button', { class: 'btn btn--secondary', type: 'button', id: 'rename-cancel' }, 'Cancel'), save]),
    ]);
    const dialog = el('dialog', { class: 'modal', 'aria-labelledby': 'rename-title' }, [el('h3', { id: 'rename-title' }, 'Rename category'), form]);
    let done = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      try { await api.patch(`/categories/${category.id}`, { name: input.value }); done = true; dialog.close(); }
      catch (err) { error.textContent = errorMessage(err, 'Could not rename the category.'); input.setAttribute('aria-invalid', 'true'); }
      finally { save.disabled = false; }
    });
    qs('#rename-cancel', form).addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { dialog.remove(); resolve(done); });
    document.body.append(dialog);
    dialog.showModal();
    input.select();
  });
}

async function renameCategory(category) { if (await renameDialog(category)) { toast('Category renamed.', 'success'); await refresh(); } }

async function deleteCategory(category) {
  const target = category.kind === 'income' ? 'Other income' : 'Other';
  const n = category.transactionCount;
  const ok = await confirmDialog({
    title: `Delete “${category.name}”?`,
    message: `${n ? `${plural(n, 'transaction')} will move to “${target}”. ` : ''}Rules and budgets that use this category are deleted too. This cannot be undone.`,
    confirmLabel: 'Delete', danger: true,
  });
  if (!ok) return;
  try {
    const res = await api.del(`/categories/${category.id}`);
    toast(res.reassigned ? `Category deleted. ${plural(res.reassigned, 'transaction')} moved to ${res.movedTo}.` : 'Category deleted.', 'success');
    await refresh();
  } catch (err) { toast(errorMessage(err, 'Could not delete the category.'), 'error'); }
}

/* ------------------------------------------------------------------ rules */

function renderRules() {
  const list = qs('#rule-list');
  list.setAttribute('aria-busy', 'false');
  if (!state.rules.length) {
    list.replaceChildren(el('div', { class: 'empty' }, [el('div', { class: 'empty__title' }, 'No rules of your own yet'), el('p', {}, 'The built-in keywords below still apply. Add a rule when FinVista puts something in the wrong place.')]));
    return;
  }
  list.replaceChildren(el('ul', { class: 'cat-rows' }, state.rules.map((r) => el('li', { class: 'cat-row', dataset: { id: r.id } }, [
    el('span', { class: 'cat-row__name' }, ['Contains ', el('code', {}, r.pattern), ` → ${r.category}`]),
    el('span', { class: 'cat-row__meta' }, KIND_LABEL[r.kind]),
    el('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'data-action': 'delete-rule', 'aria-label': `Delete rule ${r.pattern}`, onclick: () => deleteRule(r) }, 'Delete'),
  ]))));
}

async function deleteRule(rule) {
  try { await api.del(`/categories/rules/${rule.id}`); toast('Rule deleted. Existing transactions keep their categories.', 'success'); await refresh(); }
  catch (err) { toast(errorMessage(err, 'Could not delete the rule.'), 'error'); }
}

function renderBuiltin() {
  qs('#builtin-list').replaceChildren(...state.builtin.map((b) => el('details', {}, [
    el('summary', {}, `${b.category} (${KIND_LABEL[b.kind].toLowerCase()})`),
    el('p', {}, b.keywords.join(', ')),
  ])));
}

/* ------------------------------------------------------------ apply rules */

async function previewApply() {
  const out = qs('#apply-result');
  const btn = qs('#apply-btn');
  btn.disabled = true;
  try {
    const res = await api.post('/categories/reapply', { dryRun: true });
    if (!res.matchedCount) {
      out.replaceChildren(el('div', { class: 'alert alert--info', role: 'status' }, `Checked ${plural(res.checked, 'automatically categorised transaction')}. Nothing needs to change.`));
      return;
    }
    const shown = res.changes.map((c) => el('li', {}, `${c.description}: ${c.from} → ${c.to}`));
    const confirm = el('button', { class: 'btn btn--primary btn--sm', type: 'button', id: 'apply-confirm', onclick: applyNow }, `Apply to ${plural(res.matchedCount, 'transaction')}`);
    out.replaceChildren(el('div', { class: 'alert alert--info', role: 'status' }, [
      el('strong', {}, `Preview: ${plural(res.matchedCount, 'transaction')} would change. `),
      'Nothing has been changed yet.',
      el('ul', { class: 'cat-changes' }, shown),
      res.matchedCount > shown.length ? el('div', { class: 'cat-help' }, `…and ${res.matchedCount - shown.length} more.`) : '',
      el('div', {}, confirm),
    ]));
  } catch (err) {
    out.replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, errorMessage(err, 'Could not preview the changes.')));
  } finally { btn.disabled = false; }
}

async function applyNow() {
  const out = qs('#apply-result');
  const btn = qs('#apply-confirm');
  if (btn) btn.disabled = true;
  try {
    const res = await api.post('/categories/reapply', { dryRun: false });
    out.replaceChildren(el('div', { class: 'alert alert--success', role: 'status' }, `${plural(res.applied, 'transaction')} updated.`));
    await refresh();
  } catch (err) {
    out.replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, errorMessage(err, 'Could not apply the rules.')));
  }
}

/* ------------------------------------------------------------------- init */

async function refresh() {
  const [cats, rules] = await Promise.all([api.get('/categories'), api.get('/categories/rules')]);
  state.categories = cats.categories;
  state.rules = rules.rules;
  state.builtin = rules.builtin;
  renderCategories();
  renderRules();
  renderBuiltin();
}

function wireForms() {
  qs('#cat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = qs('#cat-name');
    qs('#cat-error').textContent = '';
    input.setAttribute('aria-invalid', 'false');
    try {
      await api.post('/categories', { name: input.value, kind: qs('#cat-kind').value });
      input.value = '';
      toast('Category added.', 'success');
      await refresh();
    } catch (err) {
      qs('#cat-error').textContent = errorMessage(err, 'Could not add the category.');
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
  });
  qs('#rule-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = qs('#rule-pattern');
    qs('#rule-error').textContent = '';
    input.setAttribute('aria-invalid', 'false');
    try {
      await api.post('/categories/rules', { pattern: input.value, categoryId: qs('#rule-category').value });
      input.value = '';
      toast('Rule saved. New transactions will use it. Use “Apply rules” to update earlier ones.', 'success');
      await refresh();
    } catch (err) {
      qs('#rule-error').textContent = errorMessage(err, 'Could not save the rule.');
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
  });
  qs('#apply-btn').addEventListener('click', previewApply);
}

(async function init() {
  let user;
  try { user = await requireLogin(); }
  catch (err) {
    renderSidebar('categories', null);
    qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not verify your session: ${err.message}`));
    return;
  }
  if (!user) return;
  renderSidebar('categories', user);
  wireForms();
  try { await refresh(); }
  catch (err) { qs('#page-error').replaceChildren(el('div', { class: 'alert alert--danger', role: 'alert' }, `Could not load categories: ${err.message}`)); }
})();
