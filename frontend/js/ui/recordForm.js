/**
 * Generic add/edit dialog for simple records (SIPs, insurance policies).
 * openRecordForm({ title, fields, values, saveLabel, submit }) resolves with whatever `submit(body)` returned, or null if cancelled.
 * Field: { name, label, type: 'text'|'number'|'date'|'select'|'checkbox'|'textarea', options?: [[value, label]], hint?, full?, inputmode?, maxlength?, placeholder? }
 * Server validation messages (ApiError.details, keyed by field name) are shown under the matching field.
 */
import { el, qs } from '../core/dom.js';
import { ApiError } from '../core/api.js';
import { localizeLabel } from '../core/format.js';

export function openRecordForm({ title, fields, values = {}, saveLabel = 'Save', submit }) {
  return new Promise((resolve) => {
    let saved = null;
    const inputs = {};
    const nodes = fields.map((f) => {
      const id = `rf-${f.name}`;
      let input;
      if (f.type === 'select') {
        input = el('select', { class: 'select', id, name: f.name }, f.options.map(([v, l]) => el('option', { value: v }, l)));
        input.value = values[f.name] ?? f.options[0][0];
      } else if (f.type === 'checkbox') {
        input = el('input', { type: 'checkbox', id, name: f.name, checked: Boolean(values[f.name] ?? f.default) });
      } else if (f.type === 'textarea') {
        input = el('textarea', { class: 'input', id, name: f.name, rows: '2', maxlength: f.maxlength ?? 200 });
        input.value = values[f.name] ?? '';
      } else {
        input = el('input', { class: 'input', id, name: f.name, type: f.type === 'number' ? 'text' : f.type, inputmode: f.inputmode, autocomplete: 'off', maxlength: f.maxlength, placeholder: f.placeholder });
        input.value = values[f.name] ?? '';
      }
      inputs[f.name] = input;
      input.setAttribute('aria-describedby', `${id}-hint ${id}-error`);
      const error = el('div', { class: 'field__error', id: `${id}-error`, role: 'alert' });
      const hint = f.hint ? el('div', { class: 'field__hint', id: `${id}-hint` }, f.hint) : el('span', { id: `${id}-hint` });
      if (f.type === 'checkbox') return el('div', { class: 'field field--full' }, [el('label', { class: 'check', for: id }, [input, el('span', {}, localizeLabel(f.label))]), hint, error]);
      return el('div', { class: `field${f.full ? ' field--full' : ''}` }, [el('label', { class: 'field__label', for: id }, localizeLabel(f.label)), input, hint, error]);
    });
    const formError = el('div', { class: 'alert alert--danger form-error hidden', role: 'alert' });
    const saveButton = el('button', { class: 'btn btn--primary', type: 'submit' }, saveLabel);
    const form = el('form', { novalidate: true }, [formError, el('div', { class: 'form-grid' }, nodes), el('div', { class: 'modal__actions' }, [el('button', { class: 'btn btn--secondary', type: 'button', id: 'rf-cancel' }, 'Cancel'), saveButton])]);
    const dialog = el('dialog', { class: 'modal modal--wide', 'aria-labelledby': 'rf-title' }, [el('h3', { id: 'rf-title' }, title), form]);

    const showErrors = (details = {}) => {
      for (const f of fields) {
        qs(`#rf-${f.name}-error`, form).textContent = details[f.name] || '';
        inputs[f.name].setAttribute('aria-invalid', String(Boolean(details[f.name])));
      }
    };
    const setFormError = (m) => { formError.textContent = m || ''; formError.classList.toggle('hidden', !m); };
    const read = () => Object.fromEntries(fields.map((f) => [f.name, f.type === 'checkbox' ? inputs[f.name].checked : inputs[f.name].value.trim()]));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setFormError(''); showErrors();
      saveButton.disabled = true;
      try {
        saved = await submit(read());
        dialog.close();
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        if (err.status === 400 && err.details) { showErrors(err.details); qs('[aria-invalid="true"]', form)?.focus(); } else setFormError(err.message);
      } finally { saveButton.disabled = false; }
    });
    qs('#rf-cancel', form).addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { dialog.remove(); resolve(saved); });
    document.body.append(dialog);
    dialog.showModal();
    inputs[fields[0].name].focus();
  });
}
