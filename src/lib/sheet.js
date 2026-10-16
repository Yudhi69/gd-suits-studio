import { allFieldsOf, colourWords, isVisible } from './catalog.js';

/**
 * An order's specification as the one line each of GD's workbook gave it -
 * DESIGN, LINING, SHIRT - so the database page reads like the sheet he kept.
 *
 * Worked out from the spec rather than stored, so it is always what the order
 * says now. An order imported from the workbook, or one GD has written over
 * on the database page, carries its own text, and that wins.
 */
const DESIGN = [
  ['suitType'],
  ['jacketFit', (l) => `${l} fit`],
  ['lapel', (l) => `${l} lapel`],
  ['lapelWidth', (l) => `${l} width`],
  ['tuxedoFinish', (l, v) => (v === 'satin' ? 'Tuxedo finish' : null)],
  ['breast'],
  ['buttonsSingle'],
  ['buttonsDouble'],
  ['pockets', (l) => `${l} pockets`],
  ['vents', (l, v) => (v === 'none' ? 'No vents' : `${l} vents`)],
  ['wcShape', (l) => `${l} waistcoat`],
  ['pantsFit', (l) => `${l} pants`],
  ['pleats', (l, v) => (v === 'none' ? null : `${l} pleats`)],
  ['hem', (l, v) => (v === 'turn_up' ? 'Turn-ups' : null)],
];

function words(fields, spec, id, shape) {
  const field = fields.get(id);
  if (!field || !isVisible(field, spec)) return null;
  const value = spec[id];
  if (value === undefined || value === null || value === '' || value === false) return null;
  let label;
  if (field.type === 'choice') label = field.options?.find((o) => o.key === value)?.label ?? String(value);
  else if (field.type === 'toggle') label = field.label;
  else label = field.colourText ? colourWords(value) : String(value);
  return shape ? shape(label, value) : label;
}

export function sheetSummaries(spec = {}, steps = []) {
  const fields = new Map(allFieldsOf(steps).map((f) => [f.id, f]));
  const say = (id, shape) => words(fields, spec, id, shape);
  const design = DESIGN.map(([id, shape]) => say(id, shape)).filter(Boolean).join(' · ');
  const lining = [say('liningMode'), say('liningColour'), say('liningCode')].filter(Boolean).join(' · ');
  const shirt = spec.shirt
    ? ['Shirt', say('shirtColour'), say('shirtCollar', (l) => `${l} collar`), say('shirtCuff')].filter(Boolean).join(' · ')
    : '';
  return { design, lining, shirt };
}
