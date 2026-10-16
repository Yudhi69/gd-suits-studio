'use strict';

/**
 * A sheet as CSV, the way Excel opens it.
 *
 * Two things a plain join gets wrong. A cell holding a comma, a quote or a
 * line break - GD's design notes run to several lines - has to be quoted, or
 * the row splits. And a cell that starts with = + - @ is read by Excel as a
 * formula: a client name typed as `=HYPERLINK(...)` would become a live link
 * in GD's spreadsheet. Those are prefixed with an apostrophe, which Excel
 * shows as nothing and treats as "this is text".
 *
 * The byte-order mark tells Excel the file is UTF-8, so a name with an accent
 * does not open as mojibake.
 */
const FORMULA = /^[=+\-@\t\r]/;

function cell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  // A negative number is a number, not a formula.
  if (FORMULA.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  return `﻿${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

module.exports = { toCsv, cell };
