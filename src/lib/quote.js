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
export function quotedTotal(row, spec, overrides, steps) {
  const locked = readQuote(row);
  if (locked) return locked.total;
  return buildBreakdown(spec, overrides, steps).total;
}

/** Whether today's price list would produce a different number. */
export function quoteDrift(locked, spec, overrides, steps) {
  if (!locked) return null;
  const live = buildBreakdown(spec, overrides, steps);
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
