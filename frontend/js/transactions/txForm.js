/** Add / edit transaction dialog. Resolves with the saved transaction, or null if cancelled. */
import { el, qs } from '../core/dom.js';
import { api, ApiError } from '../core/api.js';
import { parseAmount } from '../core/format.js';
import { localizeLabel } from '../core/format.js';

const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const FIELDS = ['type', 'amount', 'date', 'description', 'categoryId'];

/**
 * openTransactionForm({ categories, transaction }) - pass `transaction` to edit, omit it to add.
 * categories: [{ id, name, kind }]
 */
export function openTransactionForm({ categories, transaction = null }) {
  return new Promise((resolve) => {
    const editing = Boolean(transaction);
    let saved = null;

    const typeRadio = (value, label) => el('label', {}, [
      el('input', { type: 'radio', name: 'type', value, checked: (transaction?.type ?? 'expense') === value }),
      el('span', {}, label),
    ]);
    const fieldError = (name) => el('div', { class: 'field__error', id: `tx-${name}-error`, role: 'alert' });

    const typeGroup = el('div', { class: 'field field--full' }, [
      el('span', { class: 'field__label', id: 'tx-type-label' }, 'Type'),
      el('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': 'tx-type-label' }, [typeRadio('expense', 'Expense'), typeRadio('income', 'Income')]),
      fieldError('type'),
    ]);
    const amount = el('input', { class: 'input', id: 'tx-amount', name: 'amount', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', required: true, 'aria-describedby': 'tx-amount-error', value: transaction ? transaction.amount.toFixed(2) : '' });
    const date = el('input', { class: 'input', id: 'tx-date', name: 'date', type: 'date', required: true, max: todayLocal(), value: transaction?.date ?? todayLocal(), 'aria-describedby': 'tx-date-error' });
    const description = el('input', { class: 'input', id: 'tx-description', name: 'description', type: 'text', maxlength: '200', required: true, autocomplete: 'off', placeholder: 'e.g. Groceries at BigBasket', 'aria-describedby': 'tx-description-error', value: transaction?.description ?? '' });
    const category = el('select', { class: 'select', id: 'tx-categoryId', name: 'categoryId', 'aria-describedby': 'tx-categoryId-hint tx-categoryId-error' });
    const hint = el('div', { class: 'field__hint', id: 'tx-categoryId-hint', 'aria-live': 'polite' });
    const formError = el('div', { class: 'alert alert--danger form-error hidden', role: 'alert' });
    const saveButton = el('button', { class: 'btn btn--primary', type: 'submit' }, editing ? 'Save changes' : 'Add transaction');

    const form = el('form', { novalidate: true }, [
      formError,
      el('div', { class: 'form-grid' }, [
        typeGroup,
        el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'tx-amount' }, localizeLabel('Amount (₹)')), amount, fieldError('amount')]),
        el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'tx-date' }, 'Date'), date, fieldError('date')]),
        el('div', { class: 'field field--full' }, [el('label', { class: 'field__label', for: 'tx-description' }, 'Description'), description, fieldError('description')]),
        el('div', { class: 'field field--full' }, [el('label', { class: 'field__label', for: 'tx-categoryId' }, 'Category'), category, hint, fieldError('categoryId')]),
      ]),
      el('div', { class: 'modal__actions' }, [el('button', { class: 'btn btn--secondary', type: 'button', id: 'tx-cancel' }, 'Cancel'), saveButton]),
    ]);

    const dialog = el('dialog', { class: 'modal modal--wide', 'aria-labelledby': 'tx-form-title' }, [el('h3', { id: 'tx-form-title' }, editing ? 'Edit transaction' : 'Add transaction'), form]);

    const currentType = () => qs('input[name="type"]:checked', form).value;
    function fillCategories(keep) {
      const type = currentType();
      category.replaceChildren(el('option', { value: '' }, 'Automatic (from the description)'), ...categories.filter((c) => c.kind === type).map((c) => el('option', { value: c.id }, c.name)));
      category.value = categories.some((c) => c.id === keep && c.kind === type) ? keep : '';
    }
    fillCategories(transaction?.categoryId);

    /* Live suggestion: only while the category is left on "Automatic". A manual choice always wins. */
    let suggestTimer;
    let suggestSeq = 0;
    function showSuggestion() {
      clearTimeout(suggestTimer);
      const text = description.value.trim();
      if (category.value) { hint.textContent = ''; return; }
      if (!text) { hint.textContent = 'Leave on Automatic and FinVista will pick a category from the description.'; return; }
      const seq = ++suggestSeq;
      suggestTimer = setTimeout(async () => {
        try {
          const res = await api.post('/categories/suggest', { description: text, type: currentType() });
          if (seq !== suggestSeq || category.value) return;
          if (res.suggestion) {
            const why = res.suggestion.source === 'user-rule' ? `your rule “${res.suggestion.pattern}”` : `keyword “${res.suggestion.pattern}”`;
            hint.textContent = `Will be categorised as ${res.suggestion.category} (matched ${why}).`;
          } else {
            hint.textContent = `No rule matches, so this will go to ${currentType() === 'income' ? 'Other income' : 'Other'}. Pick a category to choose it yourself.`;
          }
        } catch {
          if (seq === suggestSeq) hint.textContent = '';
        }
      }, 300);
    }
    description.addEventListener('input', showSuggestion);
    category.addEventListener('change', showSuggestion);
    form.addEventListener('change', (e) => { if (e.target.name === 'type') { fillCategories(category.value); showSuggestion(); } });
    showSuggestion();

    function showErrors(details = {}) {
      for (const f of FIELDS) {
        qs(`#tx-${f}-error`, form).textContent = details[f] || '';
        const input = qs(`[name="${f}"]`, form);
        if (input && input.type !== 'radio') input.setAttribute('aria-invalid', String(Boolean(details[f])));
      }
    }
    const setFormError = (message) => { formError.textContent = message || ''; formError.classList.toggle('hidden', !message); };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setFormError('');
      // Quick client checks for instant feedback; the server repeats and is the authority.
      const parsed = parseAmount(amount.value);
      const local = {};
      if (parsed === null || parsed <= 0) local.amount = 'Enter an amount greater than 0 with at most 2 decimal places.';
      if (!date.value) local.date = 'Choose a date.';
      if (!description.value.trim()) local.description = 'Enter a description.';
      showErrors(local);
      if (Object.keys(local).length) { qs('[aria-invalid="true"]', form)?.focus(); return; }

      const body = { type: currentType(), amount: amount.value.trim(), date: date.value, description: description.value, categoryId: category.value || null };
      saveButton.disabled = true;
      try {
        const res = editing ? await api.put(`/transactions/${transaction.id}`, body) : await api.post('/transactions', body);
        saved = res.transaction;
        dialog.close();
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        if (err.status === 400 && err.details) { showErrors(err.details); qs('[aria-invalid="true"]', form)?.focus(); } else setFormError(err.message);
      } finally {
        saveButton.disabled = false;
      }
    });

    qs('#tx-cancel', form).addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { dialog.remove(); resolve(saved); });
    document.body.append(dialog);
    dialog.showModal();
    amount.focus();
  });
}
