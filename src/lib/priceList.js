import { allFieldsOf } from './catalog.js';
import { priceKeyForOption, priceKeyForField, gridPriceKey } from './pricing.js';

/**
 * The shop's own price list: every figure the built-in options are charged
 * at, kept in the shop's database. The app ships no figures of its own.
 *
 *   { prices: { "suitType:two_piece@premium_wool": 1230, "lapelStyle:peak": 45, "shirt": 410 },
 *     upTo:   { "suitType:two_piece@luxury": 2870 } }
 *
 * The keys are the ones Settings stores the shop's changes under
 * (`priceOverrides`), and those changes still sit on top: the list is what a
 * price goes back to, the overrides are what the shop has changed since. A
 * range's top is kept apart because it is not a price - the order is charged
 * the bottom, and says "from" until the shop sets its own figure.
 *
 * A copy that has been in use was given its list by an earlier version, which
 * saved the figures it then carried, once. A shop without one prices
 * everything in Settings.
 */

const isFigure = (n) => typeof n === 'number' && Number.isFinite(n);

/** The quality field's partner: the suit types a quality is priced for. */
const suitTypesOf = (fields) => (fields.find((f) => f.id === 'suitType')?.options ?? []).filter((o) => o.base);

/**
 * The steps with the list's figures on them. A figure the list does not have
 * is left as it was - for a built-in option, none - so a short list never
 * prices anything at a figure nobody set.
 */
export function withPriceList(steps, list) {
  if (!list) return steps;
  const prices = list.prices ?? {};
  const tops = list.upTo ?? {};
  const suits = suitTypesOf(allFieldsOf(steps));
  const figure = (map, key, shipped) => (isFigure(map[key]) ? map[key] : shipped);

  const priced = (field) => {
    if (field.custom) return field;
    if (field.type !== 'choice' && field.type !== 'multi') {
      const price = figure(prices, priceKeyForField(field.id), field.price);
      return price === undefined ? field : { ...field, price };
    }
    if (!Array.isArray(field.options)) return field;
    return {
      ...field,
      options: field.options.map((opt) => {
        if (opt.custom) return opt;
        if (field.priceGrid) {
          const grid = { prices: { ...opt.prices }, upTo: { ...opt.upTo } };
          for (const suit of suits) {
            const key = gridPriceKey(suit.key, opt.key);
            const price = figure(prices, key, grid.prices[suit.key]);
            const top = figure(tops, key, grid.upTo[suit.key]);
            if (price !== undefined) grid.prices[suit.key] = price;
            if (top !== undefined) grid.upTo[suit.key] = top;
          }
          return { ...opt, ...grid };
        }
        if (opt.base) return opt;
        const price = figure(prices, priceKeyForOption(field.id, opt.key), opt.price);
        return price === undefined ? opt : { ...opt, price };
      }),
    };
  };

  return steps.map((step) => ({ ...step, fields: step.fields.map(priced) }));
}
