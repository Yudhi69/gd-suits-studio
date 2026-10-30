import { buildBreakdown, formatMoney, needsPrice } from './pricing.js';
import { CURRENCY } from './catalog.js';

/**
 * The agreed quote, and the difference between it and today's price list.
 *
 * A quote is recomputed live only while an order is still a draft. The moment
 * it leaves draft it is frozen, because by then the figure has been shown to a
 * client. Without this, adjusting a price - or removing an option a client had
 * chosen - silently rewrote the total on orders that were already agreed.
 */

/** The shape stored on the order. */
export function quoteFromSpec(spec, overrides, steps, status = 'approved') {
  const { lines, total } = buildBreakdown(spec, overrides, steps);
  return { lines, total, currency: CURRENCY, status };
}

/**
 * The suits an order is priced from.
 *
 * A loaded order carries them. A row from the order list carries their specs
 * as one string - `suit_specs`, separated by the record separator - so the
 * list can price every order without loading each one. A spec that will not
 * parse is priced as empty rather than taking the whole list down with it.
 */
export function suitsOf(order) {
  if (Array.isArray(order?.suits) && order.suits.length) return order.suits;
  if (typeof order?.suit_specs === 'string' && order.suit_specs) {
    return order.suit_specs.split('\u001e').map((text) => {
      try { return { spec: JSON.parse(text || '{}') }; } catch { return { spec: {} }; }
    });
  }
  let spec = order?.spec;
  if (!spec) {
    try { spec = JSON.parse(order?.spec_json || '{}'); } catch { spec = {}; }
  }
  return [{ spec }];
}

/** "Sipho Ndlovu - navy 3-piece", or "Sipho Ndlovu - suit 2" with nothing to tell them apart. */
export function suitName(suit, index, suits = []) {
  const person = `${suit?.name ?? ''} ${suit?.surname ?? ''}`.trim();
  const what = suit?.label || suit?.fabric_name || '';
  const theirs = suits.filter((s) => s.client_id === suit?.client_id);
  const base = person || `Suit ${index + 1}`;
  if (what) return `${base} - ${what}`;
  return theirs.length > 1 ? `${base} - suit ${theirs.indexOf(suit) + 1}` : base;
}

/**
 * The whole order's figures: every suit on it, each priced from its own spec.
 *
 * An order of one suit - nearly all of them - prices exactly as it always
 * has, line for line. With more than one, each suit's lines are grouped under
 * whose suit it is, because the groom's peak lapel and the best man's notch
 * are two different charges on one bill. Pricing only the suit on screen was
 * how a wedding party of five came to be quoted for one.
 */
export function orderBreakdown(order, overrides, steps) {
  const suits = suitsOf(order);
  if (suits.length === 1) return buildBreakdown(suits[0].spec ?? {}, overrides, steps);
  const lines = [];
  suits.forEach((suit, i) => {
    const group = suitName(suit, i, suits);
    for (const line of buildBreakdown(suit.spec ?? {}, overrides, steps).lines) {
      lines.push({ ...line, group, key: `${suit.id ?? i}/${line.key}`, suitId: suit.id ?? null });
    }
  });
  return { lines, total: lines.reduce((t, l) => t + l.amount, 0) };
}

/** The order's figures in the shape stored on it when they are agreed. */
export function quoteFromOrder(order, overrides, steps, status = 'approved') {
  const { lines, total } = orderBreakdown(order, overrides, steps);
  return { lines, total, currency: CURRENCY, status };
}

/**
 * The price list's lines as they stood when GD sent his figures, kept beside
 * them: [key, amount] for each line.
 */
export const basisOf = (lines) => lines.map((l) => [String(l.key), Number(l.amount) || 0]);

/** Whether the price list still gives exactly the lines it gave then. */
export function sameBasis(basis, lines) {
  return Array.isArray(basis) && basis.length === lines.length
    && lines.every((l, i) => Array.isArray(basis[i]) && basis[i][0] === String(l.key)
      && Math.abs(Number(basis[i][1]) - (Number(l.amount) || 0)) < 0.005);
}

/**
 * The figures the last informal quote went out with - GD's, after any he
 * changed - as long as the order is still what they were worked out for.
 *
 * Anything chosen, removed or repriced since, and they no longer describe this
 * order, so there are none: what was sent for a 2-piece is not a price for
 * the 3-piece it has become.
 */
export function sentFigures(order, list) {
  const sent = order?.informalQuote;
  if (!sent || !Array.isArray(sent.lines) || !sent.lines.length) return null;
  return sameBasis(sent.basis, list.lines) ? sent : null;
}

/**
 * What fixing the price fixes it at.
 *
 * The figures the client was last quoted, if the order is unchanged since;
 * otherwise the price list. Before GD could change the figures on the informal
 * quote these were always the same thing. Now a client who confirmed R10,000
 * would otherwise get a formal quote for the R10,550 on the price list.
 *
 * `listTotal` keeps what the price list said at the time, so a later change
 * to the price list is still noticed - and GD's own figure is not mistaken
 * for one.
 */
export function agreedQuote(order, overrides, steps, status = 'approved') {
  const list = orderBreakdown(order, overrides, steps);
  const sent = sentFigures(order, list);
  if (!sent) return { lines: list.lines, total: list.total, currency: CURRENCY, status };
  // A line sent at the bottom of its range was only ever "from" that figure,
  // so it keeps the range, and the summary still asks for the cloth's price.
  const ranged = new Map(list.lines.filter((l) => l.upTo).map((l) => [l.key, l]));
  return {
    lines: sent.lines.map((l) => (ranged.get(l.key)?.amount === l.amount ? { ...l, upTo: ranged.get(l.key).upTo } : l)),
    total: sent.total,
    currency: CURRENCY,
    status,
    listTotal: list.total,
    informalAt: sent.sentAt,
  };
}

/** Whether any line on these figures still has no price - see needsPrice. */
export const lacksPrice = (quote) => (quote?.lines ?? []).some(needsPrice);

/** Parses whatever the row carries, tolerating the pre-v7 empty string. */
export function readQuote(row) {
  if (!row) return null;
  if (row.quote && typeof row.quote === 'object') return row.quote;
  if (!row.quote_json) return null;
  try {
    return JSON.parse(row.quote_json);
  } catch {
    return null;
  }
}

/**
 * What to show as the order's value: the agreed figure once there is one,
 * otherwise the live one.
 */
export function quotedTotal(row, overrides, steps) {
  const locked = readQuote(row);
  if (locked) return locked.total;
  return orderBreakdown(row, overrides, steps).total;
}

/**
 * Whether today's price list would produce a different number for the whole
 * order. Measured against what the price list said when the quote was fixed,
 * so a figure GD chose himself is not reported as the price list moving; the
 * difference shown is what re-quoting would change for the client.
 */
export function quoteDrift(locked, order, overrides, steps) {
  if (!locked) return null;
  const live = orderBreakdown(order, overrides, steps);
  // A suit the price list can no longer price - an order from before the
  // qualities, with none chosen - has no figure to re-quote at: re-quoting
  // would take the suit off the price.
  if (live.lines.some(needsPrice)) return null;
  const then = Number.isFinite(locked.listTotal) ? locked.listTotal : locked.total;
  if (Math.abs(live.total - then) < 0.005) return null;
  const difference = live.total - locked.total;
  // Moved, but onto the very figure the client has: re-quoting would change nothing.
  if (Math.abs(difference) < 0.005) return null;
  return {
    live,
    difference,
    label: `${difference > 0 ? '+' : '-'}${formatMoney(Math.abs(difference))}`,
  };
}

/** An order is still open to repricing only while it is an unsent enquiry. */
export const isDraft = (status) =>
  !status || status === 'first_consultation' || status === 'enquiry' || status === 'draft';
