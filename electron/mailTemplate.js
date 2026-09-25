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
  { key: 'fitting_date', describes: 'the first fitting date' },
  { key: 'final_fitting_date', describes: 'the final fitting and delivery date' },
  { key: 'delivery_date', describes: 'the delivery date' },
  { key: 'quote_block', describes: 'the priced lines, the total and the deposit' },
  { key: 'total', describes: 'the agreed total on its own' },
  { key: 'deposit', describes: 'half the total, which starts the work' },
  { key: 'gd_name', describes: 'your name' },
  { key: 'gd_role', describes: 'your title' },
  { key: 'gd_phone', describes: 'your telephone number' },
  { key: 'gd_email', describes: 'your email address' },
];

/**
 * What an order puts into the wording.
 *
 * Both the quote email and every standing reminder fill from this, so a
 * placeholder means the same thing wherever GD types it - and a new one is
 * added in a single place rather than in each email that wanted it.
 */
function buildValues(project, shop) {
  const money = (n) => `R${Math.round(Number(n) || 0).toLocaleString('en-ZA')}`;
  const quote = project.quote;
  const suits = project.suits ?? [];
  const people = project.members ?? [];

  // What is being made: one cloth, or a list when there is a party.
  const what = suits.length > 1
    ? [`${people.length} people, ${suits.length} suits:`,
       ...suits.map((s) => `  - ${`${s.name} ${s.surname}`.trim()}: ${s.label || s.fabric_name || 'suit'}`)].join('\n')
    : (suits[0]?.fabric_name
        ? `Cloth: ${suits[0].fabric_name}${suits[0].fabric_code ? ` (${suits[0].fabric_code})` : ''}`
        : '');

  const quoteBlock = quote?.lines?.length
    ? ['Quote:',
       ...quote.lines.map((l) => `  ${l.label}  ${money(l.amount)}`),
       '',
       `Total: ${money(quote.total)}`,
       `Deposit to start (${Math.round(shop.depositFraction * 100)}%): ${money((quote.total ?? 0) * shop.depositFraction)}`].join('\n')
    : 'I will follow up with the figures shortly.';

  return {
    client_first: project.name ?? '',
    client_name: `${project.name ?? ''} ${project.surname ?? ''}`.trim(),
    order_ref: project.order_ref ?? '',
    what,
    cloth: suits[0]?.fabric_name
      ? `${suits[0].fabric_name}${suits[0].fabric_code ? ` (${suits[0].fabric_code})` : ''}`
      : '',
    event_date: project.event_date ?? '',
    event_line: project.event_date ? `Needed by: ${project.event_date}` : '',
    fitting_date: project.first_fitting_date ?? '',
    final_fitting_date: project.final_fitting_date ?? '',
    delivery_date: project.delivery_date ?? '',
    quote_block: quoteBlock,
    total: quote ? money(quote.total) : '',
    deposit: quote ? money((quote.total ?? 0) * shop.depositFraction) : '',
    gd_name: shop.name, gd_role: shop.role, gd_phone: shop.phone, gd_email: shop.email,
    business_name: shop.businessName,
  };
}

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

module.exports = { DEFAULT_TEMPLATE, DEFAULT_SUBJECT, VARIABLES, fill, buildValues };
