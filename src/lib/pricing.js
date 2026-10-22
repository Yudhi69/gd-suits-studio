import { STEPS, CURRENCY, MATERIAL_PRICES, isVisible, allFieldsOf } from './catalog.js';

/**
 * Price overrides are stored as a flat map so the tailor can retune the price
 * list from Settings without a rebuild:
 *   "base:three_piece"      -> base garment price
 *   "jacket.lapel:peak"     -> option delta
 *   "extras.shirt"          -> flat field price
 */
export function priceKeyForOption(fieldId, optionKey) {
  return `${fieldId}:${optionKey}`;
}

export function priceKeyForField(fieldId) {
  return fieldId;
}

function resolve(overrides, key, fallback) {
  const v = overrides?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** The field whose options set the garment's price - the material quality. */
const gridFieldOf = (steps) => allFieldsOf(steps).find((f) => f.priceGrid) ?? null;

/** "suitType:two_piece@premium_wool" - a suit type's price in one quality. */
export function gridPriceKey(suitKey, qualityKey) {
  return `${priceKeyForOption('suitType', suitKey)}@${qualityKey}`;
}

/**
 * The price of a suit type, in the quality chosen if there is one.
 *
 * A quality GD has not priced for that suit type yet is charged at the suit
 * type's own price and comes back `unpriced`, so every screen that shows it
 * can say so. With no quality chosen this is exactly the price it always was.
 */
export function suitPrice(suitOpt, quality, overrides = {}) {
  const own = resolve(overrides, priceKeyForOption('suitType', suitOpt.key), suitOpt.basePrice);
  if (!quality) return { amount: own, key: priceKeyForOption('suitType', suitOpt.key), unpriced: false };
  const key = gridPriceKey(suitOpt.key, quality.key);
  const listed = resolve(overrides, key, MATERIAL_PRICES[quality.key]?.[suitOpt.key] ?? null);
  return listed === null ? { amount: own, key, unpriced: true } : { amount: listed, key, unpriced: false };
}

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

        if (typeof opt.basePrice === 'number') {
          const quality = qualityOf(spec, steps);
          const price = suitPrice(opt, quality, overrides);
          lines.push({
            group: 'Base',
            label: quality ? `${opt.label} suit - ${quality.label}` : `${opt.label} suit`,
            amount: price.amount,
            key: price.key,
            ...(price.unpriced ? { unpriced: true } : {}),
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
      } else if (field.price) {
        // Toggles and text fields charge a flat fee once they carry a value.
        const filled = field.type === 'toggle' ? value === true : !!String(value ?? '').trim();
        if (!filled) continue;
        lines.push({
          group: step.title,
          label: field.label,
          amount: resolve(overrides, priceKeyForField(field.id), field.price),
          key: priceKeyForField(field.id),
        });
      }
    }
  }

  const total = lines.reduce((sum, l) => sum + l.amount, 0);
  return { lines, total };
}

export function formatMoney(amount) {
  const n = Number(amount) || 0;
  // "-R500", not "R-500": a discount GD adds to a quote is a negative line.
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
        const base = typeof opt.basePrice === 'number' ? opt.basePrice : opt.price ?? 0;
        entries.push({
          key: priceKeyForOption(field.id, opt.key),
          label: `${field.label} - ${opt.label}`,
          optionLabel: opt.label,
          optionDesc: opt.desc ?? '',
          renamed: !!opt.renamed,
          step: field.step,
          isBase: typeof opt.basePrice === 'number',
          defaultAmount: base,
          custom: !!field.custom,
          // Your own options on a built-in selector are edited where they
          // were added; renaming is for the built-in ones.
          customOption: !!opt.custom,
          itemId: field.itemId,
        });
      }
    } else if (field.price) {
      entries.push({
        key: priceKeyForField(field.id),
        label: field.label,
        optionLabel: field.label,
        renamed: !!field.renamed,
        step: field.step,
        isBase: false,
        defaultAmount: field.price,
        custom: !!field.custom,
        itemId: field.itemId,
      });
    }
  }
  return entries;
}

/**
 * The quality prices as a grid, for Settings: a row per quality, a column per
 * suit type, each cell its key, GD's own figure (if one is set), the figure
 * shipped with the app (if there is one), and what it falls back to.
 */
export function priceGrid(steps = STEPS, overrides = {}) {
  const field = gridFieldOf(steps);
  const suitField = allFieldsOf(steps).find((f) => f.id === 'suitType');
  if (!field || !suitField) return null;
  const suits = (suitField.options ?? []).filter((o) => typeof o.basePrice === 'number' && !o.retired);
  const qualities = (field.options ?? []).filter((o) => !o.retired);
  return {
    field,
    suits,
    rows: qualities.map((quality) => ({
      quality,
      cells: suits.map((suit) => {
        const key = gridPriceKey(suit.key, quality.key);
        const shipped = MATERIAL_PRICES[quality.key]?.[suit.key] ?? null;
        return {
          key,
          suit,
          shipped,
          own: typeof overrides[key] === 'number' ? overrides[key] : null,
          fallback: resolve(overrides, priceKeyForOption('suitType', suit.key), suit.basePrice),
        };
      }),
    })),
  };
}
