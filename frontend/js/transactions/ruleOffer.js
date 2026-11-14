/**
 * After a manual category choice, offer to remember it as a rule ("learning from corrections").
 * Resolves true when something changed that the list should reload for.
 */
import { el, qs } from '../core/dom.js';
import { api, ApiError } from '../core/api.js';
import { toast } from '../core/toast.js';

export async function offerRule(tx) {
  if (tx.categorySource !== 'user') return false; // rule-based results need no teaching
  let suggestedPattern;
  try {
    ({ suggestedPattern } = await api.post('/categories/suggest', { description: tx.description, type: tx.type }));
  } catch { return false; }
  if (!suggestedPattern) return false;

  return new Promise((resolve) => {
    let changed = false;
    const apply = el('input', { type: 'checkbox', id: 'rule-apply', checked: true });
    const dialog = el('dialog', { class: 'modal', 'aria-labelledby': 'rule-title' }, [
      el('h3', { id: 'rule-title' }, 'Remember this choice?'),
      el('p', {}, ['Always categorise descriptions containing ', el('strong', {}, `“${suggestedPattern}”`), ' as ', el('strong', {}, tx.category), '?']),
      el('label', { class: 'check', for: 'rule-apply' }, [apply, el('span', {}, 'Also update my earlier transactions that were categorised automatically. Ones you chose yourself are never changed.')]),
      el('div', { class: 'modal__actions' }, [
        el('button', { class: 'btn btn--secondary', type: 'button', id: 'rule-no' }, 'Not now'),
        el('button', { class: 'btn btn--primary', type: 'button', id: 'rule-yes' }, 'Create rule'),
      ]),
    ]);
    qs('#rule-no', dialog).addEventListener('click', () => dialog.close());
    qs('#rule-yes', dialog).addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const res = await api.post('/categories/rules', { pattern: suggestedPattern, categoryId: tx.categoryId, applyToExisting: apply.checked });
        changed = res.updated > 0;
        toast(res.updated ? `Rule saved. ${res.updated} earlier transaction${res.updated === 1 ? '' : 's'} updated.` : 'Rule saved.', 'success');
        dialog.close();
      } catch (err) {
        toast(err instanceof ApiError ? err.message : 'Could not save the rule.', 'error');
        e.target.disabled = false;
      }
    });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(changed); });
    document.body.append(dialog);
    dialog.showModal();
  });
}
