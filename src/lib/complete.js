import { api } from './api.js';
import { agreedQuote, isDraft, lacksPrice } from './quote.js';
import { needsPrice } from './pricing.js';

/** Paid in, less anything refunded. */
const paidOn = (order) => (order.payments ?? []).reduce(
  (t, p) => t + (p.kind === 'refund' ? -p.amount : p.amount), 0
);

/**
 * Marks an order completed, which takes it off the current list and onto the
 * completed one.
 *
 * Completed is two statuses, because a finished suit is not finished for the
 * books until the balance is in: paid when nothing is owed on the figure the
 * client agreed, otherwise final deposit due. An order completed straight from
 * the consultation has its figure fixed first, as any order leaving draft
 * does - otherwise it would sit on the completed list with a price that still
 * moves with the price list.
 */
export async function completeOrder(id, overrides, steps) {
  const order = await api.projects.get({ id });
  const agreed = order.quote ? null : agreedQuote(order, overrides, steps);
  // An order brought in from the old sheet carries the balance it had there.
  const imported = !order.quote && Number(order.imported_balance) > 0;
  // Completed with no price for the suit, it would be paid for with nothing
  // paid towards the suit - and likewise an item with no price yet.
  if (agreed && !imported && lacksPrice(agreed)) {
    const items = agreed.lines.filter(needsPrice);
    throw new Error(items.every((l) => l.item)
      ? `${[...new Set(items.map((l) => l.label))].join(', ')} has no price yet - set it in Settings > Price list, or send its figure on the informal quote, before completing the order.`
      : items.some((l) => l.noQuality)
        ? 'The suit has no price yet - choose its material quality, or send its figure on the informal quote, before completing the order.'
        : 'The suit has no price yet in its quality - set it in Settings > Price list, or send its figure on the informal quote, before completing the order.');
  }
  const total = order.quote?.total ?? agreed.total;
  const owed = imported ? Number(order.imported_balance) : total - paidOn(order);
  const status = owed >= 0.005 ? 'completed_due' : 'completed_paid';
  if (isDraft(order.status) && !order.quote && !lacksPrice(agreed)) {
    await api.projects.setQuote({ id, quote: { ...agreed, status } });
  }
  await api.projects.update({ id, patch: { status } });
  return status;
}
