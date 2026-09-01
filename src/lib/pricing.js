import { STEPS, CURRENCY, isVisible, allFieldsOf } from './catalog.js';

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

        // The suit type carries the base garment price rather than a delta.
        if (typeof opt.basePrice === 'number') {
          lines.push({
            group: 'Base',
            label: `${opt.label} suit`,
            amount: resolve(overrides, priceKeyForOption(field.id, opt.key), opt.basePrice),
            key: priceKeyForOption(field.id, opt.key),
          });
        }

        const delta = resolve(overrides, priceKeyForOption(field.id, opt.key), opt.price ?? 0);
        if (delta) {
          lines.push({
            group: step.title,
            label: `${field.label}: ${opt.label}`,
            amount: delta,
            key: priceKeyForOption(field.id, opt.key),
          });
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
  return `${CURRENCY}${n.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Every price the tailor can override, for the Settings price-list editor. */
export function priceCatalogEntries(steps = STEPS) {
  const entries = [];
  for (const field of allFieldsOf(steps)) {
    if (field.type === 'choice') {
      for (const opt of field.options ?? []) {
        const base = typeof opt.basePrice === 'number' ? opt.basePrice : opt.price ?? 0;
        entries.push({
          key: priceKeyForOption(field.id, opt.key),
          label: `${field.label} - ${opt.label}`,
          step: field.step,
          isBase: typeof opt.basePrice === 'number',
          defaultAmount: base,
          custom: !!field.custom,
          itemId: field.itemId,
        });
      }
    } else if (field.price) {
      entries.push({
        key: priceKeyForField(field.id),
        label: field.label,
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
