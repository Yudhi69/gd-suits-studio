import { nameColour } from './colour.js';

/**
 * The single source of truth for every option in the suit builder.
 *
 * The UI is generated from this file - add a field here and it appears in the
 * flow, in the price breakdown, in the spec sheet and in the AI render prompt
 * with no other code changes. Prices are in ZAR and are editable at runtime
 * from Settings (overrides are stored in the local DB and merged over these
 * defaults by `lib/pricing.js`).
 */

export const CURRENCY = 'R';

export const EVENT_TYPES = [
  { key: 'wedding', label: 'Wedding' },
  { key: 'matric', label: 'Matric Ball' },
  { key: 'graduation', label: 'Graduation' },
  { key: 'birthday', label: 'Birthday' },
  { key: 'business', label: 'Business' },
  { key: 'other', label: 'Other' },
];

/** Base garment prices, selected in the `suitType` field below. */
export const BASE_PRICES = {
  two_piece: 4500,
  three_piece: 5800,
};

/**
 * Photo slots captured in the Capture step. `role` feeds the AI prompt builder:
 * `subject` photos anchor the client's likeness and body, `swatch` photos are
 * colour/texture references.
 */
export const PHOTO_SLOTS = [
  { key: 'front', label: 'Front', role: 'subject', hint: 'Full body, arms relaxed at sides, neutral stance.' },
  { key: 'side', label: 'Side', role: 'subject', hint: 'Profile view - shows posture, stomach and seat.' },
  { key: 'back', label: 'Back', role: 'subject', hint: 'Shows shoulder slope, blades and seat.' },
  { key: 'face', label: 'Face', role: 'subject', hint: 'Head and shoulders in even light - used for skin tone.' },
  { key: 'fabric', label: 'Fabric', role: 'swatch', hint: 'Fill the frame with the cloth, flat and in daylight.' },
  { key: 'lining', label: 'Lining', role: 'swatch', hint: 'The lining cloth or pattern.' },
  { key: 'inspiration', label: 'Reference', role: 'reference', hint: 'Any photo the client brought in as a reference.' },
];

/**
 * The builder flow. Each step is a screen; each field renders a control.
 *
 * field.type   choice | toggle | text | longtext | number | colour | measure
 * field.price  flat delta added when the field is truthy (toggle/text fields)
 * option.price delta added when that option is chosen
 * field.showIf predicate over the working spec - hides dependent fields
 * field.prompt how the value is phrased for the AI render prompt
 */
export const STEPS = [
  {
    key: 'base',
    title: 'Base Garment',
    blurb: 'Everything else branches off this choice.',
    fields: [
      {
        id: 'suitType',
        label: 'Suit Type',
        type: 'choice',
        required: true,
        prompt: (v) => (v === 'three_piece' ? 'a three-piece suit (jacket, waistcoat and trousers)' : 'a two-piece suit (jacket and trousers)'),
        options: [
          { key: 'two_piece', label: '2-Piece', desc: 'Jacket and pants', price: 0, basePrice: BASE_PRICES.two_piece },
          { key: 'three_piece', label: '3-Piece', desc: 'Adds a waistcoat', price: 0, basePrice: BASE_PRICES.three_piece },
        ],
      },
    ],
  },

  {
    key: 'jacket',
    title: 'Jacket',
    blurb: 'The silhouette the client will be judged on from across the room.',
    fields: [
      {
        id: 'jacketFit',
        label: 'Fit',
        type: 'choice',
        required: true,
        prompt: (v) => `a ${v} fit through the body`,
        options: [
          { key: 'slim', label: 'Slim', desc: 'Close to the body', price: 0 },
          { key: 'medium', label: 'Medium', desc: 'In between', price: 0 },
          { key: 'loose', label: 'Loose', desc: 'Relaxed drape', price: 0 },
        ],
      },
      {
        id: 'lapel',
        label: 'Lapel',
        type: 'choice',
        required: true,
        prompt: (v) => `${v} lapels`,
        options: [
          { key: 'notch', label: 'Notch', desc: 'Classic business', price: 0 },
          { key: 'peak', label: 'Peak', desc: 'Formal, upward points', price: 250 },
          { key: 'shawl', label: 'Shawl', desc: 'Rounded, black tie', price: 350 },
        ],
      },
      {
        id: 'lapelWidth',
        label: 'Lapel Width',
        type: 'choice',
        required: true,
        prompt: (v, spec) => {
          const inches = { standard: '2.5', wide: '3.5', slim: '2' }[v] ?? spec.lapelWidthCustom ?? '3';
          return `lapels ${inches} inches wide`;
        },
        options: [
          { key: 'standard', label: 'Standard', desc: '2.5 inch', price: 0 },
          { key: 'wide', label: 'Wide', desc: '3.5 inch', price: 0 },
          { key: 'slim', label: 'Slim', desc: '2 inch', price: 0 },
          { key: 'custom', label: 'Custom', desc: 'Specify below', price: 200 },
        ],
      },
      {
        id: 'lapelWidthCustom',
        label: 'Custom lapel width (inches)',
        type: 'number',
        step: 0.25,
        min: 1.5,
        max: 5,
        showIf: (s) => s.lapelWidth === 'custom',
      },
      {
        id: 'tuxedoFinish',
        label: 'Tuxedo Finish',
        type: 'choice',
        required: true,
        prompt: (v) => (v === 'satin' ? 'satin-faced tuxedo lapels and satin buttons' : 'a plain self-faced lapel, no satin'),
        options: [
          { key: 'plain', label: 'No - Plain', desc: 'Self-faced lapel', price: 0 },
          { key: 'satin', label: 'Yes - Satin', desc: 'Satin facings', price: 650 },
        ],
      },
      {
        id: 'breast',
        label: 'Button Configuration',
        type: 'choice',
        required: true,
        // The button-count field below states the breast style in full, so
        // this one stays out of the prompt to avoid saying it twice.
        prompt: () => null,
        options: [
          { key: 'single', label: 'Single Breasted', price: 0 },
          { key: 'double', label: 'Double Breasted', price: 400 },
        ],
      },
      {
        id: 'buttonsSingle',
        label: 'Number of Buttons',
        type: 'choice',
        showIf: (s) => s.breast === 'single',
        prompt: (v) => `single breasted with ${v} button${v === '1' ? '' : 's'}`,
        options: [
          { key: '1', label: '1 Button', price: 0 },
          { key: '2', label: '2 Button', price: 0 },
          { key: '3', label: '3 Button', price: 0 },
        ],
      },
      {
        id: 'buttonsDouble',
        label: 'Number of Buttons',
        type: 'choice',
        showIf: (s) => s.breast === 'double',
        prompt: (v) => `double breasted with a ${v}-button front`,
        options: [
          { key: '6', label: '6 Button', desc: '6x2', price: 0 },
          { key: '4', label: '4 Button', desc: '4x2', price: 0 },
          { key: '2', label: '2 Button', price: 0 },
          { key: '1', label: '1 Button', price: 0 },
        ],
      },
      {
        id: 'pockets',
        label: 'Pockets',
        type: 'choice',
        required: true,
        prompt: (v) => `${v} pockets`,
        options: [
          { key: 'flap', label: 'Flap', desc: 'Standard', price: 0 },
          { key: 'patch', label: 'Patch', desc: 'Softer, casual', price: 150 },
          { key: 'slanted', label: 'Slanted', desc: 'Hacking pockets', price: 200 },
        ],
      },
      {
        id: 'vents',
        label: 'Vents',
        type: 'choice',
        required: true,
        prompt: (v) => (v === 'none' ? 'no vents' : `${v} vent${v === 'double' ? 's' : ''}`),
        options: [
          { key: 'single', label: 'Single', price: 0 },
          { key: 'double', label: 'Double', desc: 'Side vents', price: 120 },
          { key: 'none', label: 'None', desc: 'Clean back', price: 0 },
        ],
      },
      {
        id: 'sleeveButtons',
        label: 'Sleeve Buttons',
        type: 'choice',
        required: true,
        prompt: (v) => `${v} working cuff buttons`,
        options: [
          { key: '3', label: '3 Buttons', price: 0 },
          { key: '4', label: '4 Buttons', price: 0 },
        ],
      },
    ],
  },

  {
    key: 'pants',
    title: 'Pants',
    blurb: 'Fit and hem decide whether the whole suit reads sharp or sloppy.',
    fields: [
      {
        id: 'pantsFit',
        label: 'Fit',
        type: 'choice',
        required: true,
        prompt: (v) => `${v.replace('_', ' ')} trousers`,
        options: [
          { key: 'slim', label: 'Slim', price: 0 },
          { key: 'tapered', label: 'Tapered', price: 0 },
          { key: 'straight', label: 'Straight', price: 0 },
          { key: 'boot_leg', label: 'Boot Leg', price: 0 },
          { key: 'wide_leg', label: 'Wide Leg', price: 0 },
        ],
      },
      {
        id: 'pleats',
        label: 'Pleats',
        type: 'choice',
        required: true,
        prompt: (v) => (v === 'none' ? 'a flat front' : `${v} pleats`),
        options: [
          { key: 'none', label: 'None', desc: 'Flat front', price: 0 },
          { key: 'single', label: 'Single', price: 120 },
          { key: 'double', label: 'Double', price: 180 },
        ],
      },
      {
        id: 'waistband',
        label: 'Waistband',
        type: 'choice',
        required: true,
        prompt: (v) => (v === 'side_adjusters' ? 'side adjusters instead of belt loops' : 'belt loops'),
        options: [
          { key: 'belt_loops', label: 'Belt Loops', price: 0 },
          { key: 'side_adjusters', label: 'Side Adjusters', desc: 'No belt needed', price: 180 },
        ],
      },
      {
        id: 'waistbandJoin',
        label: 'Waistband Join',
        type: 'choice',
        required: true,
        prompt: (v) => `a ${v.replace('_', ' ')} waistband fastening`,
        options: [
          { key: 'clips', label: 'Clips', price: 0 },
          { key: 'single_button', label: 'Single Button', price: 0 },
          { key: 'double_button', label: 'Double Button', price: 80 },
        ],
      },
      {
        id: 'hem',
        label: 'Hem Finish',
        type: 'choice',
        required: true,
        prompt: (v, s) => (v === 'turn_up' ? `turn-up (cuffed) hems, ${s.turnUpWidth || 'slim'} width` : 'a plain hem'),
        options: [
          { key: 'plain', label: 'Plain', price: 0 },
          { key: 'turn_up', label: 'Turn-Up', desc: 'Cuffed', price: 150 },
        ],
      },
      {
        id: 'turnUpWidth',
        label: 'Turn-Up Width',
        type: 'choice',
        showIf: (s) => s.hem === 'turn_up',
        prompt: () => null, // already stated by the hem clause
        options: [
          { key: 'slim', label: 'Slim', price: 0 },
          { key: 'wide', label: 'Wide', price: 0 },
        ],
      },
    ],
  },

  {
    key: 'waistcoat',
    title: 'Waistcoat',
    blurb: 'Only shown on a 3-piece.',
    showIf: (s) => s.suitType === 'three_piece',
    fields: [
      {
        id: 'wcShape',
        label: 'Shape',
        type: 'choice',
        prompt: (v) => `a ${v.replace('_', '-')} waistcoat opening`,
        options: [
          { key: 'v_cut', label: 'V-Cut', price: 0 },
          { key: 'u_shape', label: 'U-Shape', price: 0 },
        ],
      },
      {
        id: 'wcBreast',
        label: 'Button Style',
        type: 'choice',
        prompt: (v) => `a ${v} breasted waistcoat`,
        options: [
          { key: 'single', label: 'Single Breasted', price: 0 },
          { key: 'double', label: 'Double Breasted', price: 300 },
        ],
      },
      {
        id: 'wcButtons',
        label: 'Number of Buttons',
        type: 'choice',
        prompt: (v) => `${v} waistcoat buttons`,
        options: [
          { key: '3', label: '3 Buttons', desc: 'Low cut', price: 0 },
          { key: '4', label: '4 Buttons', desc: 'Standard', price: 0 },
          { key: '5', label: '5 Buttons', desc: 'High cut', price: 0 },
        ],
      },
      {
        id: 'wcLapel',
        label: 'Lapel',
        type: 'choice',
        prompt: (v) => (v === 'lapel' ? 'with lapels on the waistcoat' : 'with a collarless waistcoat'),
        options: [
          { key: 'no_lapel', label: 'No Lapel', price: 0 },
          { key: 'lapel', label: 'Lapel', price: 250 },
        ],
      },
      {
        id: 'wcPockets',
        label: 'Pocket Style',
        type: 'choice',
        prompt: (v) => (v === 'none' ? 'no waistcoat pockets' : 'standard waistcoat pockets'),
        options: [
          { key: 'none', label: 'No Pockets', price: 0 },
          { key: 'standard', label: 'Standard Pockets', price: 120 },
        ],
      },
    ],
  },

  {
    key: 'extras',
    title: 'Extras',
    blurb: 'Shirt, neckwear and pins - each one adds to the total.',
    fields: [
      { id: 'shirt', label: 'Shirt', type: 'toggle', price: 850, prompt: (v) => (v ? 'a matching dress shirt' : null) },
      {
        id: 'shirtCollar',
        label: 'Collar Type',
        type: 'choice',
        showIf: (s) => s.shirt,
        prompt: (v) => `a ${v.replace('_', ' ')} shirt collar`,
        options: [
          { key: 'spread', label: 'Spread', price: 0 },
          { key: 'cutaway', label: 'Cutaway', price: 60 },
          { key: 'classic', label: 'Classic Point', price: 0 },
          { key: 'wing', label: 'Wing', desc: 'Black tie', price: 90 },
        ],
      },
      { id: 'shirtButtonColour', label: 'Button Colour', type: 'colour', showIf: (s) => s.shirt, default: '#ffffff', prompt: () => null },
      {
        id: 'shirtCuff',
        label: 'Cuff Style',
        type: 'choice',
        showIf: (s) => s.shirt,
        prompt: (v) => (v === 'french' ? 'french cuffs with cufflinks' : 'barrel cuffs'),
        options: [
          { key: 'barrel', label: 'Barrel', price: 0 },
          { key: 'french', label: 'French', desc: 'Cufflinks', price: 180 },
        ],
      },
      { id: 'shirtFinishes', label: 'Custom shirt finishes', type: 'longtext', showIf: (s) => s.shirt, placeholder: 'Contrast collar, placket detail, monogram on cuff...',
        prompt: (v) => `shirt detail: ${v}` },

      { id: 'neckwear', label: 'Tie / Bow Tie', type: 'toggle', prompt: (v, s) => (v ? `a ${s.neckwearType === 'bow' ? 'bow tie' : 'tie'}` : null) },
      {
        id: 'neckwearType',
        label: 'Type',
        type: 'choice',
        showIf: (s) => s.neckwear,
        prompt: () => null, // the neckwear toggle already names it
        options: [
          { key: 'tie', label: 'Tie', price: 350 },
          { key: 'bow', label: 'Bow Tie', price: 300 },
        ],
      },
      { id: 'neckwearColour', label: 'Neckwear Colour', type: 'colour', showIf: (s) => s.neckwear,
        default: '#7b1113',
        prompt: (v, s) => `the ${s.neckwearType === 'bow' ? 'bow tie' : 'tie'} in ${nameColour(v)} (${v})` },

      { id: 'lapelPin', label: 'Lapel Pin', type: 'toggle', price: 250, prompt: (v) => (v ? 'a lapel pin' : null) },
      { id: 'lapelPinNote', label: 'Pin option', type: 'text', showIf: (s) => s.lapelPin, placeholder: 'Gold rose, feather, crest...',
        prompt: (v) => `the lapel pin is ${v}` },
    ],
  },

  {
    key: 'details',
    title: 'Detail Customisation',
    blurb: 'The premium touches - lining, monogram, stitching.',
    fields: [
      {
        id: 'liningMode',
        label: 'Lining',
        type: 'choice',
        prompt: () => null, // the lining is described in its own prompt paragraph
        options: [
          { key: 'colour', label: 'Choose Colour', price: 0 },
          { key: 'pattern', label: 'Upload Pattern', desc: 'Custom cloth', price: 450 },
        ],
      },
      { id: 'liningColour', label: 'Lining Colour', type: 'colour', showIf: (s) => s.liningMode === 'colour', default: '#1b2a4a', prompt: () => null },
      { id: 'monogramPocket', label: 'Monogram - pocket', type: 'text', price: 200, maxLength: 24, placeholder: 'e.g. G.D.',
        prompt: (v) => `a monogram reading "${v}" on the pocket` },
      { id: 'monogramLining', label: 'Monogram - lining', type: 'text', price: 200, maxLength: 40, placeholder: 'e.g. Tailored for Sipho, 2026',
        // Lining text is almost never visible on a worn suit - noted for the
        // spec sheet, kept out of the render so the model does not paint it on.
        prompt: () => null },
      { id: 'monogramOther', label: 'Monogram - other (sleeve, etc.)', type: 'text', price: 200, maxLength: 40, prompt: () => null },
      {
        id: 'stitching',
        label: 'Stitching & Piping',
        type: 'choice',
        prompt: (v) => `${v} contrast stitching and piping`,
        options: [
          { key: 'black', label: 'Black', price: 0 },
          { key: 'white', label: 'White', price: 0 },
        ],
      },
    ],
  },
];

/** Guided measurement fields, grouped by garment. Values are in centimetres. */
export const MEASUREMENTS = {
  jacket: {
    label: 'Jacket',
    fields: [
      { id: 'chest', label: 'Chest', hint: 'Around the fullest part, tape level under the arms.' },
      { id: 'waist', label: 'Waist (jacket)', hint: 'At the natural waist, roughly the navel.' },
      { id: 'seat', label: 'Seat', hint: 'Fullest part of the hips.' },
      { id: 'shoulder', label: 'Shoulder', hint: 'Seam point to seam point across the back.' },
      { id: 'sleeve', label: 'Sleeve Length', hint: 'Shoulder point to the wrist bone, arm slightly bent.' },
      { id: 'jacketLength', label: 'Jacket Length', hint: 'Base of the collar to the desired hem.' },
      { id: 'bicep', label: 'Bicep', hint: 'Around the fullest part of the upper arm.' },
      { id: 'neck', label: 'Neck', hint: 'Around the base of the neck, one finger of ease.' },
    ],
  },
  waistcoat: {
    label: 'Waistcoat',
    fields: [
      { id: 'wcChest', label: 'Chest', hint: 'Same level as the jacket chest.' },
      { id: 'wcWaist', label: 'Waist', hint: 'Natural waist, snug.' },
      { id: 'wcFrontLength', label: 'Front Length', hint: 'Shoulder seam to the point of the hem.' },
      { id: 'wcBackLength', label: 'Back Length', hint: 'Base of collar to the back hem.' },
    ],
  },
  pants: {
    label: 'Pants',
    fields: [
      { id: 'pantWaist', label: 'Waist', hint: 'Where the trouser is intended to sit.' },
      { id: 'pantSeat', label: 'Seat', hint: 'Fullest part, feet together.' },
      { id: 'thigh', label: 'Thigh', hint: 'Around the fullest part, 2cm below the crotch.' },
      { id: 'knee', label: 'Knee', hint: 'Around the knee cap.' },
      { id: 'hemOpening', label: 'Hem Opening', hint: 'Desired width across the opening, doubled.' },
      { id: 'outseam', label: 'Outseam', hint: 'Waistband to the desired break at the shoe.' },
      { id: 'inseam', label: 'Inseam', hint: 'Crotch to the hem.' },
      { id: 'rise', label: 'Rise', hint: 'Crotch seam up to the top of the waistband.' },
    ],
  },
};

/** Garments a fitting session records notes and photos against. */
export const FITTING_GARMENTS = ['jacket', 'waistcoat', 'pants', 'shirt'];

/** Flattened field lookup, used by pricing and the prompt builder. */
export const ALL_FIELDS = STEPS.flatMap((s) => s.fields.map((f) => ({ ...f, step: s.key })));

export function fieldById(id) {
  return ALL_FIELDS.find((f) => f.id === id);
}

/** True when a step or field should be visible for the given spec. */
export function isVisible(node, spec) {
  return typeof node.showIf === 'function' ? !!node.showIf(spec) : true;
}


/* ------------------------------------------- the tailor's own catalog ------ */

/**
 * Turns a stored custom item into a catalog field.
 *
 * The shape is identical to a built-in field, which is the point: once merged,
 * a custom item renders in the builder, prices into the quote, appears on the
 * spec sheet and reaches the render prompt through exactly the same code paths
 * as everything shipped in this file.
 */
export function customItemToField(item) {
  const base = {
    id: item.field_id,
    label: item.label,
    desc: item.description || '',
    custom: true,
    itemId: item.id,
  };

  if (item.kind === 'choice') {
    return {
      ...base,
      type: 'choice',
      options: (item.options ?? []).map((o) => ({
        key: o.key,
        label: o.label,
        desc: o.desc ?? '',
        price: Number(o.price) || 0,
      })),
      // A phrase supplied by the tailor wins; otherwise the label and the
      // chosen option are read out plainly.
      prompt: (value, spec) => {
        const chosen = (item.options ?? []).find((o) => o.key === value);
        if (!chosen) return null;
        return item.prompt
          ? `${item.prompt}: ${chosen.label.toLowerCase()}`
          : `${item.label.toLowerCase()}: ${chosen.label.toLowerCase()}`;
      },
    };
  }

  return {
    ...base,
    type: 'toggle',
    price: Number(item.price) || 0,
    prompt: (value) => (value ? item.prompt || item.label.toLowerCase() : null),
  };
}

/**
 * The effective builder flow: the built-in steps with any custom items folded
 * into them, followed by whatever categories the shop has added of its own.
 */
export function buildSteps(customCategories = [], customItems = []) {
  const active = customItems.filter((i) => i.active !== 0);
  const byCategory = active.reduce((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});

  const builtIn = STEPS.map((step) => {
    const extra = byCategory[step.key] ?? [];
    if (!extra.length) return step;
    return { ...step, fields: [...step.fields, ...extra.map(customItemToField)] };
  });

  const added = customCategories.map((category) => ({
    key: category.key,
    title: category.title,
    blurb: category.blurb || '',
    custom: true,
    categoryId: category.id,
    fields: (byCategory[category.key] ?? []).map(customItemToField),
  }));

  return [...builtIn, ...added];
}

/** Flattened fields for any step list, custom or not. */
export function allFieldsOf(steps) {
  return steps.flatMap((step) => step.fields.map((f) => ({ ...f, step: step.key })));
}
