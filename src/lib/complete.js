import { api } from './api.js';
import { agreedQuote, isDraft } from './quote.js';

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
  const total = order.quote?.total ?? agreedQuote(order, overrides, steps).total;
  // An order brought in from the old sheet carries the balance it had there.
  const owed = !order.quote && Number(order.imported_balance) > 0
    ? Number(order.imported_balance)
    : total - paidOn(order);
  const status = owed >= 0.005 ? 'completed_due' : 'completed_paid';
  if (isDraft(order.status) && !order.quote) {
    await api.projects.setQuote({ id, quote: agreedQuote(order, overrides, steps, status) });
  }
  await api.projects.update({ id, patch: { status } });
  return status;
}
