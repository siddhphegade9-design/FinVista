'use strict';
/** CSV writer for exports. Guards against spreadsheet formula injection. */

/** Cells that start with = + - @ (or tab/CR) would be run as formulas by Excel and Sheets; prefix an apostrophe. */
function guard(text) {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function cell(value, { text = true } = {}) {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = text ? guard(raw) : raw; // numbers are written as-is (they are never user text)
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** columns: [{ header, get(row), text? }] -> CSV text with CRLF line endings and a UTF-8 BOM for Excel. */
function toCsv(rows, columns) {
  const lines = [columns.map((c) => cell(c.header, { text: false })).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(c.get(row), { text: c.text !== false })).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

module.exports = { toCsv, guard };
