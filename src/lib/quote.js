import { buildBreakdown, formatMoney } from './pricing.js';
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

/** Whether today's price list would produce a different number for the whole order. */
export function quoteDrift(locked, order, overrides, steps) {
  if (!locked) return null;
  const live = orderBreakdown(order, overrides, steps);
  const difference = live.total - locked.total;
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
