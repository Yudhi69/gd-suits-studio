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
  { key: 'religious', label: 'Religious' },
  // Kept as `business` so the orders already filed under it keep their type;
  // GD calls it corporate.
  { key: 'business', label: 'Corporate' },
  { key: 'other', label: 'Other' },
];

/** Base garment prices, selected in the `suitType` field below. */
export const BASE_PRICES = {
  two_piece: 4500,
  three_piece: 5800,
  // Sold on their own. Starting figures - every one of these is editable in
  // Settings, where the shop's real prices live.
  blazer_only: 3200,
  waistcoat_only: 1500,
  pants_only: 1700,
};

/** Which garments a base choice actually includes. */
export const SUIT_PARTS = {
  two_piece: ['jacket', 'pants'],
  three_piece: ['jacket', 'waistcoat', 'pants'],
  blazer_only: ['jacket'],
  waistcoat_only: ['waistcoat'],
  pants_only: ['pants'],
};
export const includesPart = (suitType, part) =>
  (SUIT_PARTS[suitType] ?? SUIT_PARTS.two_piece).includes(part);

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
        prompt: (v) => ({
          two_piece: 'a two-piece suit (jacket and trousers)',
          three_piece: 'a three-piece suit (jacket, waistcoat and trousers)',
          blazer_only: 'a single blazer, worn on its own',
          waistcoat_only: 'a single waistcoat, worn on its own',
          pants_only: 'a single pair of trousers, worn on their own',
        })[v] ?? 'a two-piece suit (jacket and trousers)',
        options: [
          { key: 'two_piece', label: '2-Piece', desc: 'Jacket and pants', price: 0, basePrice: BASE_PRICES.two_piece },
          { key: 'three_piece', label: '3-Piece', desc: 'Adds a waistcoat', price: 0, basePrice: BASE_PRICES.three_piece },
          { key: 'blazer_only', label: 'Single Blazer', desc: 'Jacket alone', price: 0, basePrice: BASE_PRICES.blazer_only },
          { key: 'waistcoat_only', label: 'Single Waistcoat', desc: 'Waistcoat alone', price: 0, basePrice: BASE_PRICES.waistcoat_only },
          { key: 'pants_only', label: 'Single Pants', desc: 'Trousers alone', price: 0, basePrice: BASE_PRICES.pants_only },
        ],
      },
    ],
  },

  {
    key: 'lining',
    title: 'Lining & Stitching',
    blurb: 'Chosen with the cloth, not buried in the detail page.',
    fields: [
      {
        id: 'liningMode',
        label: 'Lining',
        type: 'choice',
        prompt: () => null, // described in its own paragraph of the render prompt
        options: [
          { key: 'colour', label: 'Choose Colour', price: 0 },
          { key: 'pattern', label: 'Upload Pattern', desc: 'Custom cloth', price: 450 },
        ],
      },
      { id: 'liningColour', label: 'Lining Colour & Pattern', type: 'colour', showIf: (s) => s.liningMode === 'colour',
        default: '#1b2a4a', prompt: () => null },
      { id: 'liningCode', label: 'Lining Material Code', type: 'text', mono: true, placeholder: 'e.g. LN 1116', prompt: () => null },
      { id: 'liningCollage', label: 'Custom lining - upload collage', type: 'images', slot: 'lining_collage',
        showIf: (s) => s.liningMode === 'pattern',
        hint: 'The artwork the lining is printed from. Several images can be added.',
        prompt: () => null },
      {
        id: 'stitching',
        label: 'Stitching & Piping',
        type: 'choice',
        // White and black only. GD was explicit: these are the only choices.
        prompt: (v) => `${v} contrast stitching and piping`,
        options: [
          { key: 'white', label: 'White', price: 0 },
          { key: 'black', label: 'Black', price: 0 },
        ],
      },
    ],
  },

  {
    key: 'jacket',
    title: 'Jacket',
    blurb: 'The silhouette the client will be judged on from across the room.',
    showIf: (s) => includesPart(s.suitType ?? 'two_piece', 'jacket'),
    fields: [
      {
        id: 'jacketFit',
        label: 'Fit',
        type: 'choice',
        required: true,
        prompt: (v) => `a ${v} fit through the body`,
        options: [
          { key: 'slim', label: 'Slim', desc: 'Close to the body', price: 0 },
          { key: 'medium', label: 'Standard', desc: 'In between', price: 0 },
          { key: 'loose', label: 'Loose', desc: 'Relaxed drape', price: 0 },
          { key: 'oversized', label: 'Oversized', desc: 'Deliberately large', price: 0 },
          { key: 'other', label: 'Other', desc: 'Describe below', price: 0 },
        ],
      },
      {
        id: 'jacketFitOther',
        label: 'Describe the fit',
        type: 'text',
        showIf: (s) => s.jacketFit === 'other',
        prompt: (v) => `fit: ${v}`,
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
          const inches = { slim: '2', standard: '2.5', wide: '3.5', extra_wide: '4' }[v] ?? spec.lapelWidthCustom ?? '3';
          return `lapels ${inches} inches wide`;
        },
        options: [
          { key: 'slim', label: 'Slim', desc: '2 inch', price: 0 },
          { key: 'standard', label: 'Standard', desc: '2.5 inch', price: 0 },
          { key: 'wide', label: 'Wide', desc: '3.5 inch', price: 0 },
          { key: 'extra_wide', label: 'Extra Wide', desc: '4 inch', price: 0 },
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
        prompt: (v, spec) =>
          v === 'satin'
            ? `satin-faced tuxedo lapels and satin buttons${spec.tuxedoColour ? ` in ${spec.tuxedoColour}` : ''}`
            : 'a plain self-faced lapel, no satin',
        options: [
          { key: 'plain', label: 'No', desc: 'Self-faced lapel', price: 0 },
          { key: 'satin', label: 'Yes', desc: 'Satin facings', price: 650 },
        ],
      },
      {
        id: 'tuxedoColour',
        label: 'Tuxedo Finish Colour',
        type: 'colour',
        showIf: (s) => s.tuxedoFinish === 'satin',
        default: '#111111',
        prompt: () => null, // named in the tuxedo clause above
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
        id: 'buttonColour',
        label: 'Button Finish',
        type: 'choice',
        required: true,
        prompt: (v, spec) =>
          v === 'custom'
            ? `buttons in ${nameColour(spec.buttonColourCustom || '#c9a227')}`
            : `${v} buttons`,
        options: [
          { key: 'neutral', label: 'Neutral', desc: 'Matched to the cloth', price: 0 },
          { key: 'gold', label: 'Gold', price: 180 },
          { key: 'silver', label: 'Silver', price: 180 },
          { key: 'custom', label: 'Other Colour', desc: 'Pick below', price: 240 },
        ],
      },
      {
        id: 'buttonColourCustom',
        label: 'Button Colour',
        type: 'colour',
        showIf: (s) => s.buttonColour === 'custom',
        default: '#c9a227',
        prompt: () => null, // already named by the finish clause above
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
        id: 'thirdPocket',
        label: 'Third Pocket',
        type: 'toggle',
        price: 140,
        prompt: () => 'a third ticket pocket above the right hip pocket',
      },
      {
        id: 'vents',
        label: 'Vents (slits)',
        type: 'choice',
        required: true,
        prompt: (v) => (v === 'none' ? 'no vents' : `${v} vent${v === 'double' ? 's' : ''}`),
        options: [
          { key: 'none', label: 'None', desc: 'Clean back', price: 0 },
          { key: 'single', label: 'Single', price: 0 },
          { key: 'double', label: 'Double', desc: 'Side vents', price: 120 },
        ],
      },
    ],
  },

  {
    key: 'waistcoat',
    title: 'Waistcoat',
    blurb: 'Shown on a 3-piece, or when a waistcoat is ordered on its own.',
    showIf: (s) => includesPart(s.suitType ?? 'two_piece', 'waistcoat'),
    fields: [
      {
        id: 'wcShape',
        label: 'Shape',
        type: 'choice',
        prompt: (v) => `a ${v.replace('_', '-')} waistcoat opening`,
        options: [
          { key: 'v_cut', label: 'V-Cut', price: 0 },
          { key: 'u_shape', label: 'U-Shape (French Cut)', price: 0 },
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
        id: 'wcButtonsSingle',
        label: 'Number of Buttons',
        type: 'choice',
        showIf: (s) => (s.wcBreast ?? 'single') === 'single',
        prompt: (v) => `${v} waistcoat buttons`,
        options: [
          { key: '4', label: '4 Buttons', desc: 'Standard', price: 0 },
          { key: '5', label: '5 Buttons', desc: 'High cut', price: 0 },
          { key: '6', label: '6 Buttons', desc: 'Very high cut', price: 0 },
        ],
      },
      {
        id: 'wcButtonsDouble',
        label: 'Number of Buttons',
        type: 'choice',
        showIf: (s) => s.wcBreast === 'double',
        prompt: (v) => `${v} waistcoat buttons`,
        options: [
          { key: '6', label: '6 Buttons', desc: 'Standard', price: 0 },
          { key: '8', label: '8 Buttons', desc: 'High cut', price: 0 },
        ],
      },
      {
        id: 'wcLapel',
        label: 'Lapel',
        type: 'choice',
        prompt: (v) => (v === 'lapel' ? 'with lapels on the waistcoat' : 'with a collarless waistcoat'),
        options: [
          { key: 'no_lapel', label: 'No', price: 0 },
          { key: 'lapel', label: 'Yes', price: 250 },
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
    key: 'pants',
    title: 'Pants',
    blurb: 'Fit and hem decide whether the whole suit reads sharp or sloppy.',
    showIf: (s) => includesPart(s.suitType ?? 'two_piece', 'pants'),
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
          { key: 'custom', label: 'Custom', desc: 'Explain below', price: 0 },
        ],
      },
      {
        id: 'pantsFitOther',
        label: 'Describe the fit',
        type: 'text',
        showIf: (s) => s.pantsFit === 'custom',
        prompt: (v) => `trouser fit: ${v}`,
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
        id: 'waistbandJoin',
        label: 'Waistband Join',
        type: 'choice',
        required: true,
        prompt: (v) => `a ${v.replace('_', ' ')} waistband fastening`,
        options: [
          { key: 'clips', label: 'Clips', price: 0 },
          { key: 'single_button', label: 'Single Button', price: 0 },
          { key: 'double_button', label: 'Double Button', price: 80 },
          { key: 'other', label: 'Other', desc: 'Explain below', price: 0 },
        ],
      },
      {
        id: 'waistbandJoinOther',
        label: 'Describe the fastening',
        type: 'text',
        showIf: (s) => s.waistbandJoin === 'other',
        prompt: (v) => `waistband fastening: ${v}`,
      },
      {
        id: 'waistbandExtras',
        label: 'Waistband Extras',
        type: 'multi',
        hint: 'Choose as many as the trousers carry.',
        prompt: (v, spec) => {
          const names = { belt_loops: 'belt loops', side_adjusters: 'side adjusters', elastic_band: 'an elastic waistband' };
          const parts = (Array.isArray(v) ? v : []).map((k) => (k === 'other' ? spec.waistbandExtrasOther : names[k])).filter(Boolean);
          return parts.length ? `a waistband with ${parts.join(', ')}` : null;
        },
        options: [
          { key: 'belt_loops', label: 'Belt Loops', price: 0 },
          { key: 'side_adjusters', label: 'Side Adjusters', desc: 'No belt needed', price: 180 },
          { key: 'elastic_band', label: 'Elastic Band', price: 90 },
          { key: 'other', label: 'Other', desc: 'Explain below', price: 0 },
        ],
      },
      {
        id: 'waistbandExtrasOther',
        label: 'Describe the waistband extra',
        type: 'text',
        showIf: (s) => Array.isArray(s.waistbandExtras) && s.waistbandExtras.includes('other'),
        prompt: () => null, // already carried by the extras clause
      },
      {
        id: 'bottomFinish',
        label: 'Bottom Finish',
        type: 'choice',
        required: true,
        prompt: (v, spec) => ({
          slim: 'a slim, tapered finish through the bottom of the leg',
          straight: 'a straight cut through the bottom of the leg',
          boot_leg: 'a boot-leg opening at the bottom of the leg',
          wide_leg: 'a wide opening at the bottom of the leg',
          other: spec.bottomFinishOther ? `a ${spec.bottomFinishOther} finish at the bottom of the leg` : null,
        })[v],
        options: [
          { key: 'slim', label: 'Slim Fit (Tapered)', price: 0 },
          { key: 'straight', label: 'Straight Cut', price: 0 },
          { key: 'boot_leg', label: 'Boot Leg', price: 0 },
          { key: 'wide_leg', label: 'Wide Leg', price: 0 },
          { key: 'other', label: 'Other', desc: 'Explain below', price: 0 },
        ],
      },
      {
        id: 'bottomFinishOther',
        label: 'Describe the bottom finish',
        type: 'text',
        showIf: (s) => s.bottomFinish === 'other',
        prompt: () => null, // carried by the bottom-finish clause
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
    key: 'extras',
    title: 'Extras',
    blurb: 'Shirt, neckwear, pins, shoes - each one adds to the total.',
    fields: [
      { id: 'shirt', label: 'Shirt', type: 'toggle', price: 850, prompt: (v) => (v ? 'a matching dress shirt' : null) },
      { id: 'shirtColour', label: 'Shirt Colour', type: 'colour', showIf: (s) => s.shirt, default: '#ffffff',
        prompt: (v) => `the shirt in ${nameColour(v)} (${v})` },
      { id: 'shirtCode', label: 'Shirt Material Code', type: 'text', mono: true, showIf: (s) => s.shirt,
        placeholder: 'e.g. MPT 1747', prompt: () => null },
      {
        id: 'shirtCollar',
        label: 'Collar Type',
        type: 'choice',
        showIf: (s) => s.shirt,
        prompt: (v) => `a ${({ standard: 'standard', cutaway: 'cutaway', wing: 'winged' })[v] ?? v} shirt collar`,
        options: [
          { key: 'standard', label: 'Standard', price: 0 },
          { key: 'cutaway', label: 'Cutaway', price: 60 },
          { key: 'wing', label: 'Winged', desc: 'Black tie', price: 90 },
        ],
      },
      {
        id: 'shirtCuff',
        label: 'Cuff Style',
        type: 'choice',
        showIf: (s) => s.shirt,
        prompt: (v) => (v === 'french' ? 'double (french) cuffs with cufflinks' : 'single cuffs'),
        options: [
          { key: 'barrel', label: 'Single Cuff', price: 0 },
          { key: 'french', label: 'Double Cuff (French)', desc: 'Cufflinks', price: 180 },
        ],
      },
      {
        id: 'shirtButtonColour',
        label: 'Shirt Button Colour',
        type: 'choice',
        showIf: (s) => s.shirt,
        prompt: (v) => (v === 'neutral' ? null : `${v.replace('_', ' ')} shirt buttons`),
        options: [
          { key: 'neutral', label: 'Neutral', desc: 'Matching the shirt', price: 0 },
          { key: 'white', label: 'White', price: 0 },
          { key: 'black', label: 'Black', price: 0 },
          { key: 'metallic_silver', label: 'Metallic Silver', price: 120 },
          { key: 'metallic_gold', label: 'Metallic Gold', price: 120 },
        ],
      },
      {
        id: 'shirtChest',
        label: 'Shirt Chest',
        type: 'choice',
        showIf: (s) => s.shirt,
        prompt: (v) => (v === 'pleated' ? 'a pleated shirt front' : null),
        options: [
          { key: 'normal', label: 'Normal', price: 0 },
          { key: 'pleated', label: 'Pleated', desc: 'Black tie', price: 220 },
        ],
      },
      { id: 'shirtFinishes', label: 'Custom shirt finishes', type: 'longtext', showIf: (s) => s.shirt,
        placeholder: 'Contrast collar, placket detail, hidden buttons...', prompt: (v) => `shirt detail: ${v}` },

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
      { id: 'neckwearColour', label: 'Tie Colour', type: 'colour', showIf: (s) => s.neckwear, default: '#7b1113',
        prompt: (v, s) => `the ${s.neckwearType === 'bow' ? 'bow tie' : 'tie'} in ${nameColour(v)} (${v})` },
      {
        id: 'pocketSquare',
        label: 'Pocket Square',
        type: 'choice',
        showIf: (s) => s.neckwear,
        prompt: (v, s) =>
          v === 'same' ? 'a pocket square in the same cloth as the tie'
            : v === 'different' ? `a pocket square in ${nameColour(s.pocketSquareColour ?? '#ffffff')}`
            : null,
        options: [
          { key: 'none', label: 'None', price: 0 },
          { key: 'same', label: 'Same as tie', price: 150 },
          { key: 'different', label: 'Different colour', price: 150 },
        ],
      },
      { id: 'pocketSquareColour', label: 'Pocket Square Colour', type: 'colour',
        showIf: (s) => s.pocketSquare === 'different', default: '#ffffff', prompt: () => null },
      { id: 'tieReference', label: 'Tie reference photo', type: 'images', slot: 'tie_reference',
        showIf: (s) => s.neckwear,
        hint: 'A picture of the tie or the cloth it is made from.',
        prompt: () => null },

      { id: 'lapelChain', label: 'Lapel Chain', type: 'toggle', price: 180, prompt: (v) => (v ? 'a lapel chain' : null) },
      { id: 'lapelPin', label: 'Lapel Pin', type: 'toggle', price: 250, prompt: (v) => (v ? 'a lapel pin' : null) },
      { id: 'lapelPinNote', label: 'Pin option', type: 'text', showIf: (s) => s.lapelPin, placeholder: 'Gold rose, feather, crest...',
        prompt: (v) => `the lapel pin is ${v}` },

      { id: 'shoes', label: 'Shoes', type: 'toggle', prompt: (v, s) => (v ? `dress shoes${s.shoesNote ? ` - ${s.shoesNote}` : ''}` : null) },
      { id: 'shoesNote', label: 'Shoe detail', type: 'text', showIf: (s) => s.shoes, placeholder: 'Black oxford, size 9...', prompt: () => null },
      { id: 'socks', label: 'Socks', type: 'toggle', prompt: (v, s) => (v ? `socks${s.socksNote ? ` - ${s.socksNote}` : ''}` : null) },
      { id: 'socksNote', label: 'Sock detail', type: 'text', showIf: (s) => s.socks, placeholder: 'Burgundy, mid-calf...', prompt: () => null },
    ],
  },

  {
    key: 'details',
    title: 'Detail Customisation',
    blurb: 'Custom lining, monogram and anything else the client asked for.',
    fields: [
      { id: 'customLining', label: 'Custom Lining', type: 'toggle', price: 450,
        prompt: (v) => (v ? null : null) },
      {
        id: 'customLiningScope',
        label: 'Custom lining goes in',
        type: 'choice',
        showIf: (s) => s.customLining,
        prompt: (v) => (v === 'jacket_waistcoat' ? 'custom lining in the jacket and the waistcoat' : 'custom lining in the jacket only'),
        options: [
          { key: 'jacket', label: 'Jacket only', price: 0 },
          { key: 'jacket_waistcoat', label: 'Jacket and waistcoat', price: 250 },
        ],
      },
      {
        id: 'monogramLocations',
        label: 'Embroidery Monogram',
        type: 'multi',
        hint: 'Where the monogram is embroidered. Choose as many as apply.',
        prompt: (v, spec) => {
          if (!Array.isArray(v) || !v.length || !spec.monogramText) return null;
          // Only the places actually visible on a worn suit reach the render;
          // the rest are for the spec sheet and the bench.
          const visible = { jacket_collar: 'under the jacket collar', shirt_cuff: 'on the shirt cuff', shirt_collar: 'on the shirt collar' };
          const shown = v.map((k) => visible[k]).filter(Boolean);
          return shown.length ? `a monogram reading "${spec.monogramText}" ${shown.join(' and ')}` : null;
        },
        options: [
          { key: 'jacket_collar', label: 'Jacket collar', price: 200 },
          { key: 'jacket_pocket', label: 'Inside jacket pocket', price: 200 },
          { key: 'jacket_lining', label: 'Inside jacket lining', price: 200 },
          { key: 'shirt_cuff', label: 'Shirt cuff', price: 200 },
          { key: 'shirt_collar', label: 'Shirt collar', price: 200 },
          { key: 'other', label: 'Other', desc: 'Specify below', price: 200 },
        ],
      },
      { id: 'monogramText', label: 'Monogram text', type: 'text', maxLength: 40, placeholder: 'e.g. G.D.',
        showIf: (s) => Array.isArray(s.monogramLocations) && s.monogramLocations.length > 0,
        prompt: () => null },
      { id: 'monogramOtherPlace', label: 'Where else', type: 'text', maxLength: 60,
        showIf: (s) => Array.isArray(s.monogramLocations) && s.monogramLocations.includes('other'),
        prompt: () => null },
      { id: 'designRequests', label: 'Any other customisation', type: 'longtext',
        placeholder: 'Anything the client asked for that is not covered above...',
        prompt: (v) => v },
    ],
  },
];

/**
 * The measurement set, worded exactly as GD's order form asks clients for
 * them, so a form filled in online transcribes straight across. Stored in
 * centimetres regardless of the unit on screen.
 */
export const MEASUREMENTS = {
  jacket: {
    label: 'Jacket',
    fields: [
      { id: 'jacketLength', label: 'Length (blazer front)', hint: 'Base of the collar to the desired hem.' },
      { id: 'shoulder', label: 'Shoulders (shoulder to shoulder)', hint: 'Seam point to seam point across the back.' },
      { id: 'sleeve', label: 'Sleeve length', hint: 'Shoulder point to the wrist bone, arm slightly bent.' },
      { id: 'sleeveOpening', label: 'Sleeve opening', hint: 'Around the cuff opening.' },
      { id: 'bicep', label: 'Bicep (flex)', hint: 'Around the fullest part of the upper arm, flexed.' },
      { id: 'neck', label: 'Neck', hint: 'Around the base of the neck, one finger of ease.' },
      { id: 'chest', label: 'Chest / bust', hint: 'Around the fullest part, tape level under the arms.' },
      { id: 'waist', label: 'Waist (over the belly button)', hint: 'Around the waist, level with the navel.' },
      { id: 'seat', label: 'Hip (over groin area)', hint: 'Around the fullest part of the hips.' },
    ],
  },
  waistcoat: {
    label: 'Waistcoat',
    fields: [
      { id: 'wcChest', label: 'Chest', hint: 'Same level as the jacket chest.' },
      { id: 'wcWaist', label: 'Waist', hint: 'Natural waist, snug.' },
      { id: 'wcFrontLength', label: 'Front length', hint: 'Shoulder seam to the point of the hem.' },
      { id: 'wcLength', label: 'Waistcoat length' },
      { id: 'wcBackLength', label: 'Back length', hint: 'Base of collar to the back hem.' },
    ],
  },
  pants: {
    label: 'Trousers',
    fields: [
      { id: 'outseam', label: 'Length (outside leg)', hint: 'Waistband to the desired break at the shoe.' },
      { id: 'pantWaist', label: 'Waist', hint: 'Where the trouser is intended to sit.' },
      { id: 'pantSeat', label: 'Hip loop (over groin area)', hint: 'Fullest part, feet together.' },
      { id: 'thigh', label: 'Thigh loop', hint: 'Around the fullest part, 2cm below the crotch.' },
      { id: 'ankleLoop', label: 'Bottom', hint: 'Around the ankle opening.' },
      { id: 'rise', label: 'Crotch', hint: 'Crotch seam up to the top of the waistband.' },
      { id: 'knee', label: 'Knee', hint: 'Around the knee cap. Not on the order form - useful for a close cut.' },
    ],
  },
};

/**
 * The order pipeline.
 *
 * This replaces the workbook's sheet-per-stage split - Suit Progress, Current
 * Orders, Completed were the same orders at different points, with the client
 * keyed by name in each. One field, one place to look.
 */
/**
 * The stages GD actually works in. "Ready for first fitting" is the suit
 * waiting on the rail, which is not the same as the fitting itself, and a
 * finished job is not finished as far as the books go until the balance is in
 * - so completed splits in two.
 */
export const PROJECT_STATUSES = [
  { key: 'first_consultation', label: 'First consultation', pill: 'pill-quiet', open: true },
  { key: 'quoted', label: 'Quoted', pill: 'pill-quiet', open: true },
  { key: 'deposit_paid', label: 'Deposit paid (production pending)', pill: 'pill', open: true },
  { key: 'in_production', label: 'In production', pill: 'pill', open: true },
  { key: 'ready_first_fitting', label: 'Ready for first fitting', pill: 'pill-warn', open: true },
  { key: 'alterations', label: 'Alterations', pill: 'pill-warn', open: true },
  { key: 'ready_final_fit', label: 'Ready for final fit', pill: 'pill-warn', open: true },
  { key: 'completed_due', label: 'Completed (final deposit due)', pill: 'pill-warn', open: false },
  { key: 'completed_paid', label: 'Completed (paid)', pill: 'pill-ok', open: false },
];

/** The stages where the work is done, whatever the money is doing. */
export const COMPLETED_STATUSES = ['completed_due', 'completed_paid'];
export const isCompleted = (key) => COMPLETED_STATUSES.includes(key);

/**
 * The dates an order runs to, in the order they happen. One list, so the
 * schedule, the warnings and the exported form cannot drift apart.
 */
export const PROCESS_DATES = [
  { key: 'consultation_date', label: 'First consultation' },
  { key: 'measurement_date', label: 'Measurement date' },
  { key: 'first_fitting_date', label: 'First fitting' },
  { key: 'final_fitting_date', label: 'Final fitting & delivery' },
  { key: 'review_date', label: 'Review date' },
];

export const statusLabel = (key) =>
  PROJECT_STATUSES.find((s) => s.key === key)?.label ?? key;
export const statusPill = (key) =>
  PROJECT_STATUSES.find((s) => s.key === key)?.pill ?? 'pill-quiet';

/** Orders still needing work - the old "Current Orders" sheet. */
export const isOpenStatus = (key) => PROJECT_STATUSES.find((s) => s.key === key)?.open ?? true;

/** The two fittings a suit goes through, plus room for an extra visit. */
export const FITTING_KINDS = [
  { key: 'first', label: 'First fitting', blurb: 'Where the real corrections are marked up.' },
  { key: 'final', label: 'Final fitting', blurb: 'Sign-off before delivery.' },
  { key: 'extra', label: 'Additional fitting', blurb: 'An extra visit between the two.' },
];

export const fittingLabel = (key) => FITTING_KINDS.find((k) => k.key === key)?.label ?? 'Fitting';

/** Money in, against the 50% deposit GD's terms require before cutting. */
export const PAYMENT_KINDS = [
  { key: 'deposit', label: 'Deposit' },
  { key: 'part_payment', label: 'Part payment' },
  { key: 'balance', label: 'Balance' },
  { key: 'refund', label: 'Refund' },
];

export const ALTERATION_STATUSES = [
  { key: 'received', label: 'Received', pill: 'pill-quiet' },
  { key: 'in_progress', label: 'In progress', pill: 'pill-warn' },
  { key: 'ready', label: 'Ready', pill: 'pill' },
  { key: 'collected', label: 'Collected', pill: 'pill-ok' },
  { key: 'cancelled', label: 'Cancelled', pill: 'pill-quiet' },
];

export const EXTRA_STATUSES = [
  { key: 'ordered', label: 'Ordered', pill: 'pill-quiet' },
  { key: 'received', label: 'Received', pill: 'pill' },
  { key: 'fitted', label: 'Fitted', pill: 'pill-warn' },
  { key: 'delivered', label: 'Delivered', pill: 'pill-ok' },
  { key: 'cancelled', label: 'Cancelled', pill: 'pill-quiet' },
];

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
/**
 * Appends the shop's own options to a selector that already exists.
 *
 * These extend a field rather than adding one - another lapel shape, another
 * event type - so they are merged onto the end of the option list and behave
 * identically from there on.
 */
export function withCustomOptions(field, customOptions = []) {
  if (field.type !== 'choice') return field;
  const mine = customOptions.filter((o) => o.field_id === field.id && o.active !== 0);
  if (!mine.length) return field;

  const extra = mine.map((o) => ({
    key: o.option_key,
    label: o.label,
    desc: o.description || '',
    price: Number(o.price) || 0,
    custom: true,
    optionId: o.id,
    promptText: o.prompt || '',
  }));

  const options = [...(field.options ?? []), ...extra];
  const originalPrompt = field.prompt;

  return {
    ...field,
    options,
    // A built-in field's phrasing function knows nothing about these keys, so
    // custom choices are described from their own wording (or their label)
    // and everything else falls through to the original.
    prompt: (value, spec) => {
      const mineChosen = extra.find((o) => o.key === value);
      if (mineChosen) {
        return mineChosen.promptText || `${field.label.toLowerCase()}: ${mineChosen.label.toLowerCase()}`;
      }
      if (typeof originalPrompt === 'function') return originalPrompt(value, spec);
      const opt = options.find((o) => o.key === value);
      return opt ? `${field.label.toLowerCase()}: ${opt.label.toLowerCase()}` : null;
    },
  };
}

/** Event types, with any the shop has added of its own. */
export function eventTypesWith(customOptions = []) {
  const mine = customOptions
    .filter((o) => o.field_id === 'eventType' && o.active !== 0)
    .map((o) => ({ key: o.option_key, label: o.label, custom: true, optionId: o.id }));
  return [...EVENT_TYPES, ...mine];
}

export function buildSteps(customCategories = [], customItems = [], customOptions = []) {
  const active = customItems.filter((i) => i.active !== 0);
  const byCategory = active.reduce((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});

  const decorate = (fields) => fields.map((f) => withCustomOptions(f, customOptions));

  const builtIn = STEPS.map((step) => {
    const extra = byCategory[step.key] ?? [];
    return { ...step, fields: decorate([...step.fields, ...extra.map(customItemToField)]) };
  });

  const added = customCategories.map((category) => ({
    key: category.key,
    title: category.title,
    blurb: category.blurb || '',
    custom: true,
    categoryId: category.id,
    fields: decorate((byCategory[category.key] ?? []).map(customItemToField)),
  }));

  return [...builtIn, ...added];
}

/** Flattened fields for any step list, custom or not. */
export function allFieldsOf(steps) {
  return steps.flatMap((step) => step.fields.map((f) => ({ ...f, step: step.key })));
}
