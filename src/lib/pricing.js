import { STEPS, CURRENCY, isVisible, allFieldsOf } from './catalog.js';

/**
 * Price overrides are stored as a flat map so the tailor can retune the price
 * list from Settings without a rebuild:
 *   "suitType:two_piece@premium_wool" -> a suit type's price in a quality
 *   "jacket.lapel:peak"     -> option delta
 *   "extras.shirt"          -> flat field price
 */
export function priceKeyForOption(fieldId, optionKey) {
  return `${fieldId}:${optionKey}`;
}

export function priceKeyForField(fieldId) {
  return fieldId;
}

const isFigure = (n) => typeof n === 'number' && Number.isFinite(n);

function resolve(overrides, key, fallback) {
  const v = overrides?.[key];
  return isFigure(v) ? v : fallback;
}

/**
 * A toggle or text field that is sold on its own - a shirt, express making.
 * Built-in ones are marked `priced` and take their figure from the shop's
 * price list; one the shop added carries its own figure.
 */
export const isPricedField = (field) => !!field.priced || (isFigure(field.price) && field.price !== 0);

/**
 * A toggle or text field's figure as the shop has it: its own change in
 * Settings, otherwise the price list's. Null when it has none.
 */
export function fieldFigure(field, overrides = {}) {
  return resolve(overrides, priceKeyForField(field.id), isFigure(field.price) ? field.price : null);
}

/** The field whose options set the garment's price - the material quality. */
const gridFieldOf = (steps) => allFieldsOf(steps).find((f) => f.priceGrid) ?? null;

/** "suitType:two_piece@premium_wool" - a suit type's price in one quality. */
export function gridPriceKey(suitKey, qualityKey) {
  return `${priceKeyForOption('suitType', suitKey)}@${qualityKey}`;
}

/**
 * The price of a suit type in the quality chosen.
 *
 * The suit type has no price of its own: the quality sets it. So with no
 * quality chosen, in a quality the shop has not priced for that suit type
 * yet, or as a custom request, there is no figure. It comes back at 0 and
 * `unpriced` - `noQuality` or `quoted` saying why - so every screen that
 * shows it can say so, and no quote goes to a client until it has one (see
 * needsPrice).
 *
 * A quality priced as a range comes back at the bottom of it, with `upTo` the
 * top - until the shop sets its own figure for the pair, which is then the
 * price.
 */
export function suitPrice(suitOpt, quality, overrides = {}) {
  if (!quality) return { amount: 0, key: priceKeyForOption('suitType', suitOpt.key), unpriced: true, noQuality: true };
  const key = gridPriceKey(suitOpt.key, quality.key);
  // Priced by the cloth it turns out to be, never by a figure of its own.
  if (quality.quoted) return { amount: 0, key, unpriced: true, quoted: true };
  const listed = resolve(overrides, key, quality.prices?.[suitOpt.key] ?? null);
  if (listed === null) return { amount: 0, key, unpriced: true };
  const upTo = typeof overrides?.[key] === 'number' ? null : quality.upTo?.[suitOpt.key] ?? null;
  return upTo > listed ? { amount: listed, key, unpriced: false, upTo } : { amount: listed, key, unpriced: false };
}

/**
 * A line still without a figure - a suit with no quality, or none priced for
 * it, or an item sold on its own that the price list has no figure for - and
 * none put in on the quote. Such a line is never sent or fixed: a client
 * quoted R0 for the suit is quoted for the buttons.
 */
export const needsPrice = (line) => !!line?.unpriced && !(Math.abs(Number(line.amount) || 0) > 0);

/** The quality chosen on this spec, as its option, or null. */
export function qualityOf(spec = {}, steps = STEPS) {
  const field = gridFieldOf(steps);
  if (!field || !spec[field.id] || !isVisible(field, spec)) return null;
  return field.options?.find((o) => o.key === spec[field.id]) ?? null;
}

/**
 * Walks the visible spec and returns every chargeable line plus the total.
 * Only visible fields are charged - hiding a field (e.g. waistcoat options on a
 * 2-piece) must never leave a stale charge on the invoice.
 */
export function buildBreakdown(spec = {}, overrides = {}, steps = STEPS) {
  const lines = [];

  for (const step of steps) {
    if (!isVisible(step, spec)) continue;

    for (const field of step.fields) {
      if (!isVisible(field, spec)) continue;
      const value = spec[field.id];

      if (field.type === 'choice') {
        if (!value) continue;
        const opt = field.options?.find((o) => o.key === value);
        if (!opt) continue;

        // An option is either the base garment price or a delta on top of it -
        // never both. They share one override key, so charging both would
        // double the base price the moment a tailor edited it in Settings.
        const key = priceKeyForOption(field.id, opt.key);

        if (opt.base) {
          const quality = qualityOf(spec, steps);
          const price = suitPrice(opt, quality, overrides);
          lines.push({
            group: 'Base',
            label: quality ? `${opt.label} suit - ${quality.label}` : `${opt.label} suit`,
            amount: price.amount,
            key: price.key,
            ...(price.unpriced ? { unpriced: true } : {}),
            ...(price.noQuality ? { noQuality: true } : {}),
            ...(price.quoted ? { quoted: true } : {}),
            ...(price.upTo ? { upTo: price.upTo } : {}),
          });
          continue;
        }

        const delta = resolve(overrides, key, opt.price ?? 0);
        if (delta) {
          lines.push({
            group: step.title,
            label: `${field.label}: ${opt.label}`,
            amount: delta,
            key,
          });
        }
      } else if (field.type === 'multi') {
        // Every chosen extra is charged on its own, under its own override key,
        // so the tailor can reprice "side adjusters" without touching the rest.
        for (const opt of field.options ?? []) {
          if (!Array.isArray(value) || !value.includes(opt.key)) continue;
          const key = priceKeyForOption(field.id, opt.key);
          const delta = resolve(overrides, key, opt.price ?? 0);
          if (delta) lines.push({ group: step.title, label: `${field.label}: ${opt.label}`, amount: delta, key });
        }
      } else if (isPricedField(field)) {
        // Toggles and text fields charge a flat fee once they carry a value -
        // or, with no figure for it yet, say so rather than charge nothing.
        const filled = field.type === 'toggle' ? value === true : !!String(value ?? '').trim();
        if (!filled) continue;
        const key = priceKeyForField(field.id);
        const amount = fieldFigure(field, overrides);
        lines.push({
          group: step.title,
          label: field.label,
          amount: amount ?? 0,
          key,
          // `item` tells it apart from a suit with no price, for the wording.
          ...(amount === null ? { unpriced: true, item: true } : {}),
        });
      }
    }
  }

  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return { lines, total };
}

/**
 * Each line still at the bottom of a range, once - "2-Piece suit - Luxury
 * Wool, R9,100 to R15,600" - for the warning that it is not the cloth's price.
 */
export function rangesOf(lines = []) {
  return [...new Set(lines.filter((l) => l.upTo).map((l) => `${l.label}, ${formatMoney(l.amount)} to ${formatMoney(l.upTo)}`))];
}

export function formatMoney(amount) {
  const n = Number(amount) || 0;
  // "-R125", not "R-125": a discount added to a quote is a negative line.
  const sign = n < 0 ? '-' : '';
  return `${sign}${CURRENCY}${Math.abs(n).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Every price the tailor can override, for the Settings price-list editor. */
export function priceCatalogEntries(steps = STEPS) {
  const entries = [];
  for (const field of allFieldsOf(steps)) {
    // Priced in its own grid - see priceGrid below.
    if (field.priceGrid) continue;
    if (field.type === 'choice' || field.type === 'multi') {
      for (const opt of field.options ?? []) {
        // An option taken off the list is not offered, so it is not priced
        // here either; an order that already has it keeps its price.
        if (opt.retired) continue;
        entries.push({
          key: priceKeyForOption(field.id, opt.key),
          label: `${field.label} - ${opt.label}`,
          optionLabel: opt.label,
          optionDesc: opt.desc ?? '',
          renamed: !!opt.renamed,
          step: field.step,
          // A suit type is listed to be renamed; its price is in the grid.
          isBase: !!opt.base,
          defaultAmount: opt.base ? null : opt.price ?? 0,
          custom: !!field.custom,
          // Your own options on a built-in selector are edited where they
          // were added; renaming is for the built-in ones.
          customOption: !!opt.custom,
          itemId: field.itemId,
        });
      }
    } else if (isPricedField(field)) {
      entries.push({
        key: priceKeyForField(field.id),
        label: field.label,
        optionLabel: field.label,
        renamed: !!field.renamed,
        step: field.step,
        isBase: false,
        defaultAmount: isFigure(field.price) ? field.price : null,
        custom: !!field.custom,
        itemId: field.itemId,
      });
    }
  }
  return entries;
}

/**
 * The quality prices as a grid, for Settings: a row per quality, a column per
 * suit type, each cell its key, the figure set in Settings (if one is), and
 * the figure on the shop's price list (if there is one - lib/priceList.js).
 */
export function priceGrid(steps = STEPS, overrides = {}) {
  const field = gridFieldOf(steps);
  const suitField = allFieldsOf(steps).find((f) => f.id === 'suitType');
  if (!field || !suitField) return null;
  const suits = (suitField.options ?? []).filter((o) => o.base && !o.retired);
  // A quality priced by whatever cloth is found has nothing to set here.
  const qualities = (field.options ?? []).filter((o) => !o.retired && !o.quoted);
  return {
    field,
    suits,
    rows: qualities.map((quality) => ({
      quality,
      cells: suits.map((suit) => {
        const key = gridPriceKey(suit.key, quality.key);
        const shipped = quality.prices?.[suit.key] ?? null;
        return {
          key,
          suit,
          shipped,
          own: typeof overrides[key] === 'number' ? overrides[key] : null,
          upTo: quality.upTo?.[suit.key] ?? null,
        };
      }),
    })),
  };
}
