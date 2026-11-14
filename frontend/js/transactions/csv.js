/**
 * CSV reading for the import dialog. Pure functions (no DOM, no network) so they are unit-tested in Node.
 * The server validates and normalises every value; this module only splits text into cells and maps
 * header names to the fields the import API expects.
 */

/** Picks the delimiter (comma, semicolon or tab) that appears most in the header line, ignoring quoted text. */
export function detectDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break;
    else if (!inQuotes && ch in counts) counts[ch] += 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
}

/**
 * RFC 4180 style parser: quoted cells, "" escapes, commas/newlines inside quotes, CRLF or LF, UTF-8 BOM.
 * Returns { rows: string[][], error?: string }. Completely blank lines are skipped.
 */
export function parseCsv(input) {
  const text = String(input ?? '').replace(/^﻿/, '');
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let quoted = false; // the current field started with a quote (so an empty "" is still a cell)

  const endField = () => { row.push(field); field = ''; quoted = false; };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0].trim() !== '' || quoted) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === '') { inQuotes = true; quoted = true; }
    else if (ch === delimiter) endField();
    else if (ch === '\n') endRow();
    else if (ch === '\r') { if (text[i + 1] === '\n') i += 1; endRow(); }
    else field += ch;
  }
  if (inQuotes) return { rows: [], error: 'A quoted value is never closed. Check the file for a stray " character.' };
  if (field !== '' || row.length > 0) endRow();
  return { rows };
}

const HEADER_ALIASES = {
  date: ['date', 'transaction date', 'txn date', 'value date', 'posting date'],
  description: ['description', 'narration', 'details', 'remarks', 'particulars', 'memo', 'payee', 'transaction details'],
  amount: ['amount', 'amt', 'transaction amount'],
  type: ['type', 'dr/cr', 'cr/dr', 'transaction type'],
  category: ['category'],
};

const normaliseHeader = (h) => String(h).trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Turns CSV text into import rows: [{ date, description, amount, type, category }].
 * Returns { rows, hasTypeColumn, hasCategoryColumn, rowCount } or { error } when required columns are missing.
 */
export function rowsFromCsv(text, { maxRows = 5000 } = {}) {
  const parsed = parseCsv(text);
  if (parsed.error) return { error: parsed.error };
  if (parsed.rows.length === 0) return { error: 'The file is empty.' };

  const header = parsed.rows[0].map(normaliseHeader);
  const index = {};
  for (const [field, names] of Object.entries(HEADER_ALIASES)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i !== -1) index[field] = i;
  }
  const missing = ['date', 'description', 'amount'].filter((f) => index[f] === undefined);
  if (missing.length) {
    return { error: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. The first row must be a header such as: Date, Description, Amount, Type, Category.` };
  }
  const body = parsed.rows.slice(1);
  if (body.length === 0) return { error: 'The file has a header but no transactions.' };
  if (body.length > maxRows) return { error: `This file has ${body.length} rows. Import at most ${maxRows} at a time.` };

  const cell = (r, field) => (index[field] === undefined ? '' : (r[index[field]] ?? '').trim());
  const rows = body.map((r) => ({ date: cell(r, 'date'), description: cell(r, 'description'), amount: cell(r, 'amount'), type: cell(r, 'type'), category: cell(r, 'category') }));
  return { rows, rowCount: rows.length, hasTypeColumn: index.type !== undefined, hasCategoryColumn: index.category !== undefined };
}

/** Splits rows into API-sized batches. */
export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
