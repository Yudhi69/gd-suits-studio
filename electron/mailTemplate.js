'use strict';

/**
 * The wording of the quote email, which belongs to GD rather than to the app.
 *
 * He writes it once in Settings and every quote goes out in his voice. The
 * placeholders are filled from the order when the draft is opened; anything
 * the app does not recognise is left exactly as typed, so a mis-spelled
 * placeholder shows up in the draft rather than vanishing silently.
 */

const DEFAULT_TEMPLATE = `Hi {client_first},

Thank you for coming in. Here is a summary of your order {order_ref}.

{what}
{event_line}
{quote_block}

This is a summary - the order form with the full specification and terms
follows separately.

Kind regards,
{gd_name}
{gd_role}
{gd_phone}
{gd_email}`;

const DEFAULT_SUBJECT = 'GD Suits - your order {order_ref}';

/** What GD can drop into the wording, and what each one becomes. */
const VARIABLES = [
  { key: 'client_first', describes: "the client's first name" },
  { key: 'client_name', describes: 'their full name' },
  { key: 'order_ref', describes: 'the order number, e.g. GD-2026-0042' },
  { key: 'what', describes: 'the cloth, or the list of people and suits' },
  { key: 'cloth', describes: 'the fabric and its code' },
  { key: 'event_date', describes: 'the date the suit is needed' },
  { key: 'event_line', describes: '"Needed by: ...", or nothing if no date is set' },
  { key: 'quote_block', describes: 'the priced lines, the total and the deposit' },
  { key: 'total', describes: 'the agreed total on its own' },
  { key: 'deposit', describes: 'half the total, which starts the work' },
  { key: 'gd_name', describes: 'your name' },
  { key: 'gd_role', describes: 'your title' },
  { key: 'gd_phone', describes: 'your telephone number' },
  { key: 'gd_email', describes: 'your email address' },
];

/**
 * Fills a template in. Only the placeholders listed above are replaced, and
 * a run of blank lines left by an empty one is collapsed so the draft does
 * not open with a hole in it.
 */
function fill(template, values) {
  const text = String(template ?? '').replace(/\{(\w+)\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? '') : whole
  );
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { DEFAULT_TEMPLATE, DEFAULT_SUBJECT, VARIABLES, fill };
