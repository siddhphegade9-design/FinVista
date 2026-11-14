import { el } from '../core/dom.js';

/**
 * Promise-based confirmation dialog built on the native <dialog> element
 * (focus trapping and Esc handling come from the browser).
 * const ok = await confirmDialog({ title: 'Delete transaction?', message: '...', confirmLabel: 'Delete', danger: true });
 */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'modal', 'aria-labelledby': 'modal-title' }, [
      el('h3', { id: 'modal-title' }, title),
      el('p', {}, message),
      el('div', { class: 'modal__actions' }, [
        el('button', { class: 'btn btn--secondary', type: 'button', dataset: { result: 'cancel' } }, cancelLabel),
        el('button', { class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, type: 'button', dataset: { result: 'confirm' } }, confirmLabel),
      ]),
    ]);
    let result = false;
    dialog.addEventListener('click', (e) => {
      const choice = e.target.closest('[data-result]')?.dataset.result;
      if (choice) { result = choice === 'confirm'; dialog.close(); }
    });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(result); });
    document.body.append(dialog);
    dialog.showModal();
  });
}
