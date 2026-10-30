'use strict';

/**
 * The Google spreadsheet the app keeps as a copy of its database.
 *
 * Until the data moves to a proper database, GD wants one to open in a
 * browser. The app makes a blank spreadsheet in GD's Google account and fills
 * it: a tab per table, a row per record, its id first, the columns named as
 * they are in the database, so moving to a real one later is a copy rather
 * than a translation. It is a copy, written one way: the app is still where
 * the data lives, and an edit made in the spreadsheet is overwritten by the
 * next write.
 *
 * Which columns go is a list, not "everything in the table": a column added
 * to the database later stays on this machine until someone decides it
 * should leave. What goes is what the switch on the Connections page says
 * goes - names, telephone numbers, email addresses, the orders and the notes
 * kept on them, payments, alterations and extras. Dates of birth, postal
 * addresses, a minor's guardian, measurements, the notes on the Client page
 * and photographs stay here.
 *
 * Pure: db.mirror reads the rows, main.js does the talking to Google.
 */

const TABS = [
  {
    key: 'clients',
    title: 'Clients',
    columns: ['id', 'name', 'surname', 'contact', 'email', 'created_at', 'updated_at'],
  },
  {
    key: 'orders',
    title: 'Orders',
    columns: [
      'id', 'order_ref', 'client_id', 'status', 'title', 'event_type', 'event_other', 'event_date',
      'quantity', 'fabric_name', 'fabric_code', 'supplier', 'design', 'lining', 'shirt',
      'consultation_date', 'first_appointment', 'measurement_date', 'first_fitting_date',
      'final_fitting_date', 'delivery_date', 'review_date', 'measurements_done',
      'measurement_form_received', 'form_printed', 'agreed_total', 'imported_balance',
      'comments', 'appointment_notes', 'created_at', 'updated_at',
    ],
  },
  {
    key: 'payments',
    title: 'Payments',
    columns: ['id', 'project_id', 'kind', 'amount', 'paid_on', 'method', 'reference', 'note', 'created_at'],
  },
  {
    key: 'alterations',
    title: 'Alterations',
    columns: [
      'id', 'project_id', 'suit_id', 'garment', 'kind', 'description', 'status',
      'received_on', 'due_on', 'confirmed_on', 'cost', 'note', 'created_at',
    ],
  },
  {
    key: 'extras',
    title: 'Extras',
    columns: ['id', 'project_id', 'extra_type', 'colour', 'quantity', 'status', 'unit_price', 'note', 'created_at'],
  },
];

// Google refuses a whole write if one cell is longer than this.
const CELL_LIMIT = 50000;

/**
 * The quote GD agreed, if one was fixed. A quote still being worked out is
 * priced from the catalogue on the page and is not stored, so it has no total
 * here.
 */
function agreedTotal(quoteJson) {
  if (!quoteJson) return '';
  try {
    const total = JSON.parse(quoteJson)?.total;
    return typeof total === 'number' && Number.isFinite(total) ? total : '';
  } catch {
    return '';
  }
}

/**
 * One cell as written. Written RAW, so text is never read as a formula: a
 * client called "=IMPORTXML(...)" is a name in the spreadsheet, not a request
 * to somewhere else.
 */
function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  const text = String(value);
  return text.length > CELL_LIMIT ? text.slice(0, CELL_LIMIT) : text;
}

/** Every tab as its header and rows, from what db.mirror read. */
function grids(data) {
  return TABS.map((tab) => {
    const rows = (data?.[tab.key] ?? []).map((record) => {
      const row = tab.key === 'orders' ? { ...record, agreed_total: agreedTotal(record.quote_json) } : record;
      return tab.columns.map((c) => cell(row[c]));
    });
    return { title: tab.title, values: [tab.columns, ...rows] };
  });
}

/** "A", "B", ... "Z", "AA" - a column as a range names it. */
function columnName(n) {
  let name = '';
  for (let i = Math.max(1, n); i > 0; i = Math.floor((i - 1) / 26)) {
    name = String.fromCharCode(65 + ((i - 1) % 26)) + name;
  }
  return name;
}

const range = (title, from, to) => `'${title}'!${from}${to ? `:${to}` : ''}`;

/**
 * A new, blank spreadsheet with every tab in place, wide enough for its
 * columns (Google's default of 26 is narrower than an order), and its header
 * row frozen.
 */
function createBody(title) {
  return {
    properties: { title },
    sheets: TABS.map((tab, index) => ({
      properties: {
        title: tab.title,
        index,
        gridProperties: { frozenRowCount: 1, rowCount: 1000, columnCount: Math.max(26, tab.columns.length) },
      },
    })),
  };
}

/**
 * What has to change in the spreadsheet's shape before the rows fit: a tab
 * GD deleted is made again, and a tab with too few rows or columns for what
 * is about to be written is grown. `existing` is Google's own list of tabs.
 */
function shapeRequests(existing, grid) {
  const requests = [];
  for (const g of grid) {
    const width = g.values[0].length;
    const found = existing.find((s) => s.title === g.title);
    if (!found) {
      requests.push({ addSheet: { properties: {
        title: g.title,
        gridProperties: { frozenRowCount: 1, rowCount: Math.max(1000, g.values.length), columnCount: Math.max(26, width) },
      } } });
      continue;
    }
    const rows = found.gridProperties?.rowCount ?? 0;
    const cols = found.gridProperties?.columnCount ?? 0;
    if (rows < g.values.length || cols < width) {
      requests.push({ updateSheetProperties: {
        properties: {
          sheetId: found.sheetId,
          gridProperties: { rowCount: Math.max(rows, g.values.length), columnCount: Math.max(cols, width) },
        },
        fields: 'gridProperties(rowCount,columnCount)',
      } });
    }
  }
  return requests;
}

/** Every tab written from its top-left corner, as text and numbers, never formulas. */
function writeBody(grid) {
  return {
    valueInputOption: 'RAW',
    data: grid.map((g) => ({ range: range(g.title, 'A1'), majorDimension: 'ROWS', values: g.values })),
  };
}

/**
 * The rows left over from a longer, earlier write, cleared after the new
 * rows are in. Writing first and trimming after means the spreadsheet is
 * never seen empty, and a write that fails half way leaves the last good
 * copy rather than nothing. `sizes` is each tab's grid after any growing.
 */
function trimBody(grid, sizes) {
  const ranges = [];
  for (const g of grid) {
    const size = sizes[g.title];
    if (!size || g.values.length >= size.rows) continue;
    ranges.push(range(g.title, `A${g.values.length + 1}`, `${columnName(size.cols)}${size.rows}`));
  }
  return { ranges };
}

const tabsOf = (spreadsheet) => (spreadsheet?.sheets ?? []).map((s) => s.properties ?? {});

/**
 * Writes the whole copy. `call(method, path, body)` is one Sheets API call
 * (google.sheets with a token): this module decides what is sent, never how.
 *
 * Three calls, four when a tab has to be made again or grown - however many
 * rows there are: read the tabs, fix their shape if needed, write every tab
 * at once, clear what is left below.
 */
async function push(call, spreadsheetId, data) {
  const id = encodeURIComponent(spreadsheetId);
  const grid = grids(data);
  const fields = new URLSearchParams({ fields: 'sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))' });
  let tabs = tabsOf(await call('GET', `/${id}?${fields}`));
  const shape = shapeRequests(tabs, grid);
  if (shape.length) {
    const done = await call('POST', `/${id}:batchUpdate`, {
      requests: shape,
      includeSpreadsheetInResponse: true,
      responseIncludeGridData: false,
    });
    tabs = tabsOf(done.updatedSpreadsheet);
  }
  await call('POST', `/${id}/values:batchUpdate`, writeBody(grid));
  const sizes = Object.fromEntries(tabs.map((t) => [t.title, {
    rows: t.gridProperties?.rowCount ?? 0,
    cols: t.gridProperties?.columnCount ?? 0,
  }]));
  const trim = trimBody(grid, sizes);
  if (trim.ranges.length) await call('POST', `/${id}/values:batchClear`, trim);
  return Object.fromEntries(grid.map((g) => [g.title, g.values.length - 1]));
}

/** The address GD opens it at. The id is checked by the caller first. */
const urlFor = (spreadsheetId) => `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

module.exports = {
  TABS, CELL_LIMIT, agreedTotal, cell, grids, columnName,
  createBody, shapeRequests, writeBody, trimBody, push, urlFor,
};
