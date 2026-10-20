'use strict';

/**
 * When a date on an order moves, two things still say the old one.
 *
 * The appointment notes brought over from GD's workbook read like
 * "MEASUREMENTS: 18/01/2025  FIRST FITTING: 25/01/2025  FINAL FITTING: ...",
 * and the import took the order's dates from exactly that text. Moving the
 * fitting on the Schedule card left the note giving the old day, so the order
 * contradicted itself. The date after the matching label is now rewritten to
 * the new one.
 *
 * The old date is not simply lost, either. A move is written to the order's
 * notes - "First fitting moved from 14 Nov 2026 to 21 Nov 2026." - so the
 * history GD used to read in his notes is still there, in plain words.
 *
 * Pure, so it can be checked without a database: db.editProject does the
 * reading and writing.
 */

const { ANCHORS } = require('./mailRules');

// The labels GD writes, and the field the import read each one into. The
// workbook's "MEASUREMENTS:" is the first visit, which the import stores as the
// consultation date, so that is the date that rewrites it.
const NOTE_LABELS = {
  consultation_date: /MEASUREMENTS?\s*:/i,
  first_fitting_date: /FIRST\s+FITTING\s*:/i,
  final_fitting_date: /FINAL\s+FITTING\s*:/i,
};
const ANY_LABEL = /MEASUREMENTS?\s*:|FIRST\s+FITTING\s*:|FINAL\s+FITTING\s*:/i;
const DATE_TOKEN = /\d{1,2}\/\d{1,2}\/\d{2,5}/;
// How far past a label the import looked for its date.
const REACH = 24;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-21" as GD writes it in a note: "21/11/2026". */
const asNoteDate = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * "2026-11-21" as "21 Nov 2026". Spelt out by hand rather than through the
 * machine's locale, so the note reads the same on every computer.
 */
function spoken(iso) {
  if (!ISO.test(iso)) return iso;
  const month = MONTHS[Number(iso.slice(5, 7)) - 1];
  return month ? `${Number(iso.slice(8, 10))} ${month} ${iso.slice(0, 4)}` : iso;
}

/**
 * The notes with the date after `key`'s label set to `to`, or taken out when
 * `to` is empty.
 *
 * Only a date the import itself would have read is touched: the first one
 * within reach of the label, and never past the next label, so
 * "MEASUREMENTS: FIRST FITTING: 25/01/2025" has no measurement date to change.
 * A label with no date after it gets one written straight after it, so a
 * date taken off and booked again is back in the notes. Text with no label
 * is left exactly as written.
 */
function rewriteNotes(text, key, to) {
  const label = NOTE_LABELS[key];
  if (!label || typeof text !== 'string' || (to !== '' && !ISO.test(to))) return text;
  const found = label.exec(text);
  if (!found) return text;
  const start = found.index + found[0].length;
  const rest = text.slice(start);
  const next = rest.search(ANY_LABEL);
  const date = DATE_TOKEN.exec(rest.slice(0, next < 0 ? REACH : Math.min(REACH, next)));
  if (!date) {
    if (!to) return text;
    return `${text.slice(0, start)} ${asNoteDate(to)}${/^\s/.test(rest) || !rest ? '' : ' '}${rest}`;
  }
  const at = start + date.index;
  const after = at + date[0].length;
  if (to) return text.slice(0, at) + asNoteDate(to) + text.slice(after);
  // Cleared: the date goes, and the space before it, so "FIRST FITTING:" is
  // left reading as not booked.
  return text.slice(0, at).replace(/[ \t]+$/, '') + text.slice(after);
}

/**
 * What an edit to an order should actually write, and every date it changes.
 *
 * `before` is the order as stored, `patch` the checked fields from the page.
 * An edit that writes the notes itself keeps its own words. Which changes are
 * worth a note is for the caller: a date set for the first time is not a
 * move, but it can finish one that was taken off a minute ago.
 */
function plan(before, patch) {
  const changes = [];
  const ownNotes = patch.appointment_notes !== undefined;
  const original = String(before.appointment_notes ?? '');
  let notes = original;
  for (const { key, label } of ANCHORS) {
    if (patch[key] === undefined) continue;
    const from = String(before[key] ?? '');
    const to = String(patch[key] ?? '');
    if (from === to) continue;
    if (!ownNotes) notes = rewriteNotes(notes, key, to);
    changes.push({ key, label, from, to });
  }
  const write = { ...patch };
  if (!ownNotes && notes !== original) write.appointment_notes = notes;
  return { patch: write, changes };
}

/** "First fitting moved from 14 Nov 2026 to 21 Nov 2026." */
function describe({ label, from, to }) {
  return to
    ? `${label} moved from ${spoken(from)} to ${spoken(to)}.`
    : `${label} taken off (it was ${spoken(from)}).`;
}

module.exports = { NOTE_LABELS, rewriteNotes, plan, describe, spoken };
