/**
 * Measurement units.
 *
 * Everything is stored in centimetres, always. The unit setting changes only
 * what is shown and what is typed - a client's body record has to stay
 * comparable across orders, and it would drift badly if some measurements were
 * saved as inches and others as centimetres depending on who took them.
 */

export const CM_PER_INCH = 2.54;

export const UNITS = [
  { key: 'cm', label: 'cm', short: 'cm' },
  { key: 'in', label: 'inches', short: '"' },
];

export const unitLabel = (unit) => (unit === 'in' ? 'inches' : 'centimetres');
export const unitShort = (unit) => (unit === 'in' ? 'in' : 'cm');

/** Sensible nudge for the number input's arrows in each unit. */
export const stepFor = (unit) => (unit === 'in' ? 0.25 : 0.5);

/** Stored centimetres -> what the field should show. */
export function toDisplay(cm, unit) {
  if (cm === null || cm === undefined || cm === '') return '';
  const n = Number(cm);
  if (!Number.isFinite(n)) return '';
  // Two decimals in inches because a quarter is 0.25 and an eighth 0.125;
  // one is plenty in centimetres, where a tailor works to the half.
  return unit === 'in' ? Number((n / CM_PER_INCH).toFixed(2)) : Number(n.toFixed(1));
}

/** What was typed -> centimetres to store. */
export function fromDisplay(value, unit) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return unit === 'in' ? Number((n * CM_PER_INCH).toFixed(2)) : Number(n.toFixed(2));
}

/** For read-only display: "104 cm" or "40.94 in". */
export function formatMeasure(cm, unit) {
  const shown = toDisplay(cm, unit);
  return shown === '' ? '-' : `${shown} ${unitShort(unit)}`;
}
