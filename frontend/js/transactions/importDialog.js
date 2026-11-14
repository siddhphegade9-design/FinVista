/** CSV import dialog: choose a file, preview it, send it to the server in batches, show the outcome. */
import { el, qs } from '../core/dom.js';
import { api, ApiError } from '../core/api.js';
import { rowsFromCsv, chunk } from './csv.js';

const BATCH = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Resolves true if anything was imported (so the page should reload), otherwise false. */
export function openImportDialog() {
  return new Promise((resolve) => {
    let parsed = null;
    let imported = 0;

    const fileInput = el('input', { class: 'input', id: 'import-file', type: 'file', accept: '.csv,text/csv,text/plain' });
    const message = el('div', { class: 'hidden', role: 'alert' });
    const preview = el('div');
    const skipDup = el('input', { type: 'checkbox', id: 'import-skipdup', checked: true });
    const options = el('label', { class: 'check hidden', for: 'import-skipdup' }, [skipDup, el('span', {}, 'Skip rows that already exist (same date, type, amount and description)')]);
    const result = el('div', { class: 'hidden' });
    const importButton = el('button', { class: 'btn btn--primary', type: 'button', id: 'import-run', disabled: true }, 'Import');
    const closeButton = el('button', { class: 'btn btn--secondary', type: 'button', id: 'import-close' }, 'Cancel');

    const dialog = el('dialog', { class: 'modal modal--wide', 'aria-labelledby': 'import-title' }, [
      el('h3', { id: 'import-title' }, 'Import transactions from CSV'),
      el('p', { class: 'import-help' }, 'The first row must be a header. Required columns: Date, Description, Amount. Optional: Type (income/expense, or credit/debit) and Category. Dates can be 2026-11-14 or 14/11/2026 (day first). Without a Type column, negative amounts are expenses and positive amounts are income. Rows without a recognised category go to "Other". At most 5,000 rows, 2 MB.'),
      el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'import-file' }, 'CSV file'), fileInput]),
      message, preview, options, result,
      el('div', { class: 'modal__actions' }, [closeButton, importButton]),
    ]);

    function setMessage(text, kind = 'danger') {
      message.className = text ? `alert alert--${kind}` : 'hidden';
      message.textContent = text || '';
    }

    function renderPreview() {
      const sample = parsed.rows.slice(0, 5);
      const notes = [];
      if (!parsed.hasTypeColumn) notes.push('No Type column found: negative amounts will be imported as expenses and positive amounts as income. Check the preview below.');
      if (!parsed.hasCategoryColumn) notes.push('No Category column found: every row will go to "Other" or "Other income". You can edit categories afterwards.');
      preview.replaceChildren(
        el('div', {}, `${parsed.rowCount} row${parsed.rowCount === 1 ? '' : 's'} found. First ${sample.length}:`),
        el('div', { class: 'table-wrap import-preview' }, el('table', { class: 'table' }, [
          el('thead', {}, el('tr', {}, ['Date', 'Description', 'Amount', 'Type', 'Category'].map((h) => el('th', {}, h)))),
          el('tbody', {}, sample.map((r) => el('tr', {}, [r.date, r.description, r.amount, r.type || '—', r.category || '—'].map((c) => el('td', {}, c))))),
        ])),
        ...notes.map((n) => el('div', { class: 'alert alert--info', role: 'note' }, n)),
      );
      options.classList.remove('hidden');
    }

    fileInput.addEventListener('change', async () => {
      parsed = null;
      preview.replaceChildren();
      options.classList.add('hidden');
      result.className = 'hidden';
      importButton.disabled = true;
      setMessage('');
      const file = fileInput.files[0];
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) { setMessage('That file is larger than 2 MB.'); return; }
      const out = rowsFromCsv(await file.text());
      if (out.error) { setMessage(out.error); return; }
      parsed = out;
      renderPreview();
      importButton.disabled = false;
    });

    importButton.addEventListener('click', async () => {
      if (!parsed) return;
      importButton.disabled = true;
      fileInput.disabled = true;
      closeButton.disabled = true;
      setMessage('');
      const totals = { imported: 0, categorizedByRules: 0, defaultedToOther: 0, skipped: [] };
      let offset = 0;
      try {
        for (const batch of chunk(parsed.rows, BATCH)) {
          importButton.textContent = `Importing… ${offset}/${parsed.rowCount}`;
          const res = await api.post('/transactions/import', { rows: batch, skipDuplicates: skipDup.checked });
          totals.imported += res.imported;
          totals.categorizedByRules += res.categorizedByRules;
          totals.defaultedToOther += res.defaultedToOther;
          totals.skipped.push(...res.skipped.map((s) => ({ row: s.row + offset, message: s.message })));
          offset += batch.length;
          imported = totals.imported;
        }
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        const done = totals.imported ? ` ${totals.imported} row${totals.imported === 1 ? ' was' : 's were'} imported before the error.` : '';
        setMessage(`${err.message}${done}`);
      }
      showResult(totals, offset === parsed.rowCount);
    });

    function showResult(t, complete) {
      preview.replaceChildren();
      options.classList.add('hidden');
      const lines = [el('strong', {}, `${t.imported} transaction${t.imported === 1 ? '' : 's'} imported.`)];
      if (t.skipped.length) lines.push(` ${t.skipped.length} row${t.skipped.length === 1 ? '' : 's'} skipped.`);
      if (t.categorizedByRules) lines.push(` ${t.categorizedByRules} categorised automatically from their descriptions.`);
      if (t.defaultedToOther) lines.push(` ${t.defaultedToOther} placed in "Other" / "Other income" because no category was given and no rule matched. You can fix these on the Categories page by adding a rule.`);
      const children = [el('div', { class: `alert alert--${t.imported ? 'success' : 'warning'}`, role: 'status' }, el('span', {}, lines))];
      if (t.skipped.length) {
        const shown = t.skipped.slice(0, 50);
        children.push(el('ul', { class: 'import-skipped' }, shown.map((s) => el('li', {}, `Row ${s.row}: ${s.message}`))));
        if (t.skipped.length > shown.length) children.push(el('div', { class: 'import-help' }, `…and ${t.skipped.length - shown.length} more.`));
      }
      result.replaceChildren(...children);
      result.className = '';
      closeButton.disabled = false;
      closeButton.textContent = 'Done';
      importButton.classList.add('hidden');
      if (!complete) { importButton.classList.remove('hidden'); importButton.textContent = 'Retry'; importButton.disabled = true; }
    }

    closeButton.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { dialog.remove(); resolve(imported > 0); });
    document.body.append(dialog);
    dialog.showModal();
    qs('#import-file', dialog).focus();
  });
}
