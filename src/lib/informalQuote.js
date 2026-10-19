import { formatMoney } from './pricing.js';
import { suitsOf, sentFigures } from './quote.js';
import { eventTypesWith } from './catalog.js';

/**
 * The informal quote: what the client is shown before anything is agreed.
 *
 * It is built from whatever has been chosen so far - the base garment alone is
 * enough - so GD can send one as early in the consultation as he likes and
 * send another after the client's changes.
 *
 * The figures start from the price list, and every one of them is GD's to
 * change before it goes: a line repriced, a discount added. What he sends is
 * what is recorded, and while the order stays as it was, those are the
 * figures the formal quote is fixed at too.
 *
 * It goes by email, with the client's renders attached; WhatsApp and the
 * clipboard carry the same words without the pictures.
 */

const DAY = 86400000;
const iso = (date) => new Date(date).toISOString().slice(0, 10);
const first = (name) => String(name ?? '').trim().split(/\s+/)[0] ?? '';
const clip = (text, n) => (String(text ?? '').length > n ? `${String(text).slice(0, n - 1)}…` : String(text ?? ''));
const cents = (n) => Math.round(n * 100) / 100;

/** The group a line GD adds himself goes under - a discount, a rush charge. */
export const ADDED = 'Adjustments';
export const isAdded = (line) => String(line?.key ?? '').startsWith('added/');

/** "14 Nov 2026", the way the date is said, whatever the machine's locale. */
export function prettyDate(value) {
  if (!value) return '';
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.valueOf())) return String(value);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Where GD's figures start: what he sent last time, if the order has not
 * changed since - so sending it again does not quietly undo his discount -
 * and otherwise the price list.
 *
 * `amounts` is one figure per price-list line, by its key; `added` are the
 * lines he wrote himself.
 */
export function startingFigures(order, list) {
  const amounts = Object.fromEntries(list.lines.map((l) => [l.key, l.amount]));
  const sent = sentFigures(order, list);
  if (!sent) return { amounts, added: [], fromSent: false };
  for (const line of sent.lines) {
    if (!isAdded(line) && line.key in amounts) amounts[line.key] = line.amount;
  }
  const added = sent.lines.filter(isAdded).map((l) => ({ label: l.label, amount: l.amount }));
  return { amounts, added, fromSent: true };
}

/** A figure as typed: blank is nothing, anything that is not a number is left as it was. */
function amountOf(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (String(value).trim() === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? cents(n) : fallback;
}

/**
 * The figures as they will go: the price list's lines at GD's amounts, then
 * his own lines. A line he added and left empty is not a line.
 */
export function figuresFrom(list, amounts = {}, added = []) {
  const lines = list.lines.map((l) => ({ ...l, amount: amountOf(amounts[l.key], l.amount) }));
  let n = 0;
  for (const a of added) {
    const label = String(a.label ?? '').trim();
    const amount = amountOf(a.amount, 0);
    if (!label && !amount) continue;
    lines.push({ group: ADDED, label: clip(label || 'Adjustment', 120), amount, key: `added/${n++}` });
  }
  return { lines, total: cents(lines.reduce((t, l) => t + l.amount, 0)) };
}

/**
 * The summary, as plain data, from the figures GD has settled on. Only what
 * the client needs: first names, never a phone number, address or
 * measurement.
 */
export function informalQuote({ order, figures, business = {}, customOptions = [], today = new Date() }) {
  const suits = suitsOf(order);
  const multi = suits.length > 1;
  const days = business.informalValidDays ?? 14;
  const fraction = business.depositFraction ?? 0.5;
  const minor = !!order.is_minor && !!order.secondary_name;
  const priced = figures.lines.filter((l) => !isAdded(l));
  const pair = (l) => [clip(l.label, 80), l.amount];

  // A party's lines are keyed by whose suit they are - see orderBreakdown.
  const sections = multi
    ? suits.map((suit, i) => {
      const mine = priced.filter((l) => String(l.key).startsWith(`${suit.id ?? i}/`));
      const who = [first(suit.name ?? order.name), suit.label || suit.fabric_name || ''].filter(Boolean).join(' - ');
      return { t: clip(who || `Suit ${i + 1}`, 80), l: mine.map(pair), st: cents(mine.reduce((t, l) => t + l.amount, 0)) };
    })
    : [{ t: '', l: priced.map(pair), st: cents(priced.reduce((t, l) => t + l.amount, 0)) }];
  const event = eventTypesWith(customOptions).find((e) => e.key === order.event_type);

  return {
    ref: order.order_ref || '',
    at: iso(today),
    until: iso(new Date(today).getTime() + days * DAY),
    to: first(minor ? order.secondary_name : order.name),
    who: first(order.name),
    ev: event && event.key !== 'other' ? event.label : clip(order.event_other || '', 60),
    evd: order.event_date || '',
    shop: { n: business.businessName || 'GD Suits', p: business.phone || '' },
    s: sections,
    x: figures.lines.filter(isAdded).map(pair),
    tot: figures.total,
    dep: cents(figures.total * fraction),
    depPct: Math.round(fraction * 100),
  };
}

/**
 * The message: the greeting, every line, the total and the deposit, and what
 * happens next. Plain text, because the same words go by email and WhatsApp.
 * `renders` is the sentence saying which pictures are attached, when some are.
 */
export function quoteMessage(payload, { renders = '' } = {}) {
  const hello = payload.to ? `Hi ${payload.to},` : 'Hi,';
  const occasion = [payload.ev, prettyDate(payload.evd)].filter(Boolean).join(' on ');
  const forWhom = payload.to && payload.who && payload.to !== payload.who ? ` for ${payload.who}` : '';
  const intro = `${hello} here is your informal quote from ${payload.shop.n}${forWhom}${occasion ? ` - ${occasion}` : ''}.`;
  const ref = payload.ref ? ` (${payload.ref})` : '';

  const body = payload.s.flatMap((suit) => [
    ...(suit.t ? [suit.t] : []),
    ...suit.l.map(([label, amount]) => `${label}: ${formatMoney(amount)}`),
    ...(payload.s.length > 1 ? [`Subtotal: ${formatMoney(suit.st)}`] : []),
    '',
  ]);
  const added = payload.x.length ? [...payload.x.map(([label, amount]) => `${label}: ${formatMoney(amount)}`), ''] : [];
  const totals = [
    `Total: ${formatMoney(payload.tot)}`,
    payload.depPct ? `Deposit to start (${payload.depPct}%): ${formatMoney(payload.dep)}` : '',
  ].filter(Boolean);
  const close = [
    `This is an informal quote, valid until ${prettyDate(payload.until)}. Reply to confirm, or tell us what you would like changed, and we will send you the formal quote.`,
    payload.shop.p ? `${payload.shop.n} · ${payload.shop.p}` : payload.shop.n,
  ];

  return [
    intro, '', `Informal quote${ref}`, '',
    ...body, ...added, ...totals, '',
    ...(renders ? [renders, ''] : []),
    ...close,
  ].join('\n');
}

/** The email subject. */
export function quoteSubject(payload) {
  return `Your informal quote from ${payload.shop.n}${payload.ref ? ` - ${payload.ref}` : ''}`;
}
