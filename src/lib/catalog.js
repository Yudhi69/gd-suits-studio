import { nameColour } from './colour.js';

/**
 * The single source of truth for every option in the suit builder.
 *
 * The UI is generated from this file - add a field here and it appears in the
 * flow, in the price breakdown, in the spec sheet and in the AI render prompt
 * with no other code changes.
 *
 * It carries no prices. Every figure is the shop's own and lives in its
 * database: the price list it keeps (`lib/priceList.js`) and what it sets in
 * Settings on top (`lib/pricing.js`). An option with no figure costs nothing
 * extra; a suit, or an item marked `priced`, with no figure is "no price yet"
 * and no quote goes out until it has one.
 */

export const CURRENCY = 'R';

/**
 * A colour as it is typed - "burgundy" - and, on an order taken while colours
 * were still picked off a wheel, the stored code read out as words with the
 * code beside it, so an old order still says something a person understands.
 */
export function colourWords(value) {
  const text = String(value ?? '').trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return `${nameColour(text)} (${text})`;
  return text;
}

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

/**
 * The cloth's quality. The quality sets the price of the garment: the shop
 * prices each one by suit type, in the grid in Settings. The suit type has no
 * price of its own, so a suit with no quality chosen, or in a quality the
 * shop has not priced for it, has no price yet - flagged wherever it is
 * shown, so a guess never passes for a price.
 */
export const MATERIALS = [
  { key: 'standard_wool', label: 'Standard Wool Blend' },
  { key: 'premium_wool', label: 'Premium Wool Blend' },
  { key: 'super_fine', label: 'Super Fine Wool' },
  { key: 'italian', label: 'Italian Wool' },
  { key: 'premium_italian', label: 'Premium Italian Wool' },
  { key: 'luxury', label: 'Luxury Wool', desc: 'Priced by the cloth' },
  { key: 'linen', label: 'Linen' },
  // A cloth the shop has to find first. It is priced as whichever quality the
  // cloth turns out to be, so it has no figure of its own - `quoted` keeps it
  // out of the grid in Settings and out of the comparisons.
  { key: 'custom_request', label: 'Custom Request', desc: 'Quoted once the material is found', quoted: true },
  { key: 'material_supplied', label: 'Material Supplied', desc: "The client's own cloth" },
];

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

export const PART_LABELS = { jacket: 'Jacket', waistcoat: 'Waistcoat', pants: 'Pants' };

/**
 * A two- or three-tone suit: each piece cut from its own cloth, with its own
 * colour, code and supplier - `{ part, colour, code, supplier }` per piece the
 * suit type has. Null for a suit in one cloth, and for a suit type with only
 * one piece, which cannot be in two.
 */
export function clothsOf(spec = {}) {
  if (!spec.multiTone) return null;
  const parts = SUIT_PARTS[spec.suitType] ?? SUIT_PARTS.two_piece;
  if (parts.length < 2) return null;
  return parts.map((part) => ({ part, ...(spec.cloths?.[part] ?? {}) }));
}

/**
 * The cloths in the suit's own three columns - "Jacket B-2241 · Pants B-2250"
 * - which is what the order list, the database sheet and the emails already
 * show. A value every piece shares is said once.
 */
export function clothColumns(cloths) {
  const column = (key) => {
    const filled = cloths.filter((c) => String(c[key] ?? '').trim());
    const values = [...new Set(filled.map((c) => String(c[key]).trim()))];
    if (values.length === 1 && filled.length === cloths.length) return values[0].slice(0, 160);
    return filled.map((c) => `${PART_LABELS[c.part] ?? c.part} ${String(c[key]).trim()}`).join(' · ').slice(0, 160);
  };
  return { fabric_name: column('colour'), fabric_code: column('code'), supplier: column('supplier') };
}

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
  // The pair the client will wear, so the render shows their shoes. Not sold
  // by GD, so not on the bill - it was on the Extras page until shoes and
  // socks came off it, and is a photograph like the others.
  { key: 'shoes', label: "Client's shoes", role: 'shoes', hint: 'Optional. The pair they will wear - it goes into the render.' },
  { key: 'fabric', label: 'Fabric', role: 'swatch', hint: 'Fill the frame with the cloth, flat and in daylight.' },
  { key: 'lining', label: 'Lining', role: 'swatch', hint: 'The lining cloth or pattern.' },
  { key: 'inspiration', label: 'Reference', role: 'reference', hint: 'Any photo the client brought in as a reference.' },
];

/**
 * The builder flow. Each step is a screen; each field renders a control.
 *
 * field.type   choice | multi | toggle | text | longtext | number | images | photo
 * field.priced a thing sold on its own (toggle/text fields): charged its figure
 *              once it carries a value, and "no price yet" until it has one
 * field.price  that figure - from the shop's price list, never shipped here
 * field.from   the price is where it starts - "from R..." - and the shop settles it
 * option.price delta added when that option is chosen, from the price list too
 * field.showIf predicate over the working spec - hides dependent fields
 * field.section a small heading drawn above the field, to group a long page
 * field.colourText a colour typed as words; an old stored hex is read out too
 * option.retired no longer offered, but still read, priced and printed on the
 *              orders that already chose it, so removing an option from GD's
 *              list never rewrites a suit that has been sold
 * field.prompt how the value is phrased for the AI render prompt
 */
export const STEPS = [
  {
    key: 'base',
    title: 'Base Garment',
    blurb: 'What the client is ordering. This page alone is enough for an informal quote.',
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
        // `base`: the garment itself, priced by its quality rather than by a
        // figure of its own.
        options: [
          { key: 'three_piece', label: '3-Piece', desc: 'Jacket, waistcoat and pants', price: 0, base: true },
          { key: 'two_piece', label: '2-Piece', desc: 'Jacket and pants', price: 0, base: true },
          { key: 'blazer_only', label: 'Single Blazer', desc: 'Jacket alone', price: 0, base: true },
          { key: 'pants_only', label: 'Single Pants', desc: 'Trousers alone', price: 0, base: true },
          { key: 'waistcoat_only', label: 'Single Waistcoat', desc: 'Waistcoat alone', price: 0, base: true },
        ],
      },
      {
        // Sets the price of the suit rather than adding to it, so its options
        // carry no price of their own: each carries what every suit type
        // costs in it (`prices`) and the top of any range (`upTo`), both from
        // the shop's price list and shown in a grid in Settings. Left unset,
        // the suit has no price yet: the suit type alone does not set one.
        id: 'material',
        label: 'Material Quality',
        type: 'choice',
        priceGrid: true,
        prompt: () => null, // the swatch shows the cloth; its grade does not change the picture
        options: MATERIALS.map((m) => ({ ...m, price: 0, prices: {}, upTo: {} })),
      },

      // What goes with the suit. Chosen here, with its colour, so the base
      // page alone prices the whole order; the Extras page only asks for the
      // detail of what was ticked here.
      { id: 'shirt', label: 'Shirt', desc: 'Tailored, Egyptian cotton', type: 'toggle', priced: true, from: true, section: 'Add to the order',
        prompt: (v) => (v ? 'a matching dress shirt' : null) },
      { id: 'shirtColour', label: 'Shirt colour', type: 'text', colourText: true, showIf: (s) => s.shirt,
        placeholder: 'White, light blue, ivory...', prompt: (v) => `the shirt in ${colourWords(v)}` },

      // Made to order: the client chooses the colour, length, button style and
      // finishing, and the price goes up from here with the material. Not in
      // the render, which shows the suit.
      { id: 'coat', label: 'Custom Coat', desc: 'Priced by the material', type: 'toggle', priced: true, from: true, prompt: () => null },
      { id: 'coatDetails', label: 'Coat details', type: 'longtext', showIf: (s) => s.coat,
        placeholder: 'Colour, length, button style, finishing...', prompt: () => null },

      { id: 'neckwear', label: 'Tie / Bow Tie', type: 'toggle',
        prompt: (v, s) => (v ? `a ${s.neckwearType === 'bow' ? 'bow tie' : 'tie'}` : null) },
      {
        id: 'neckwearType',
        label: 'Tie or bow tie',
        type: 'choice',
        showIf: (s) => s.neckwear,
        prompt: () => null, // the neckwear toggle already names it
        options: [
          // With its pocket square, if one is wanted: the two are priced together.
          { key: 'tie', label: 'Tie' },
          { key: 'bow', label: 'Bow Tie' },
        ],
      },
      { id: 'neckwearColour', label: 'Tie / bow tie colour', type: 'text', colourText: true, showIf: (s) => s.neckwear,
        placeholder: 'Burgundy, silver paisley...',
        prompt: (v, s) => `the ${s.neckwearType === 'bow' ? 'bow tie' : 'tie'} in ${colourWords(v)}` },

      { id: 'lapelChain', label: 'Lapel Chain', type: 'toggle', priced: true, prompt: (v) => (v ? 'a lapel chain' : null) },
      { id: 'lapelPin', label: 'Lapel Pin', type: 'toggle', priced: true, prompt: (v) => (v ? 'a lapel pin' : null) },
      { id: 'tiePin', label: 'Tie Pin', desc: 'A bar', type: 'toggle', priced: true, from: true, prompt: (v) => (v ? 'a tie pin' : null) },
      { id: 'cufflinks', label: 'Cuff Links', desc: 'A pair', type: 'toggle', priced: true, from: true, prompt: (v) => (v ? 'cufflinks' : null) },
      // Sold boxed, as one thing, beside the two on their own.
      { id: 'cufflinkSet', label: 'Cuff Links & Tie Pin Set', desc: 'Matching, in a box', type: 'toggle', priced: true,
        prompt: (v) => (v ? 'cufflinks and a matching tie pin' : null) },

      { id: 'express', label: 'Express', desc: 'Made in a week or less', type: 'toggle', priced: true, section: 'Turnaround',
        prompt: () => null },
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
          { key: 'medium', label: 'Medium', desc: 'In between', price: 0 },
          { key: 'comfortable', label: 'Comfortable', desc: 'A little room', price: 0 },
          { key: 'loose', label: 'Loose', desc: 'Relaxed drape', price: 0 },
          { key: 'oversized', label: 'Oversized', desc: 'Deliberately large', price: 0 },
          { key: 'other', label: 'Other', desc: 'Describe below', price: 0, retired: true },
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
          { key: 'peak', label: 'Peak', desc: 'Formal, upward points' },
          { key: 'shawl', label: 'Shawl', desc: 'Rounded, black tie' },
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
          { key: 'custom', label: 'Custom', desc: 'Specify below' },
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
            ? `satin-faced tuxedo lapels and satin buttons${spec.tuxedoColour ? ` in ${colourWords(spec.tuxedoColour)}` : ''}`
            : 'a plain self-faced lapel, no satin',
        options: [
          { key: 'plain', label: 'No', desc: 'Self-faced lapel', price: 0 },
          { key: 'satin', label: 'Yes', desc: 'Milano satin, covered buttons' },
        ],
      },
      {
        id: 'tuxedoColour',
        label: 'Tuxedo Finish Colour',
        type: 'text',
        colourText: true,
        showIf: (s) => s.tuxedoFinish === 'satin',
        placeholder: 'Black, midnight blue...',
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
          { key: 'double', label: 'Double Breasted' },
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
            ? (spec.buttonColourCustom ? `buttons in ${colourWords(spec.buttonColourCustom)}` : 'buttons in a contrasting colour')
            : `${v} buttons`,
        options: [
          { key: 'neutral', label: 'Neutral', desc: 'Matched to the cloth', price: 0 },
          { key: 'gold', label: 'Gold' },
          { key: 'silver', label: 'Silver' },
          { key: 'custom', label: 'Other Colour', desc: 'Describe below' },
        ],
      },
      {
        id: 'buttonColourCustom',
        label: 'Button Colour',
        type: 'text',
        colourText: true,
        showIf: (s) => s.buttonColour === 'custom',
        placeholder: 'Horn brown, mother of pearl...',
        prompt: () => null, // already named by the finish clause above
      },
      {
        id: 'pockets',
        label: 'Pockets',
        type: 'choice',
        required: true,
        prompt: (v) => (v === 'slanted'
          ? 'slanted (hacking) hip pockets, each sloping down from its front edge toward the side seam'
          : `${v} pockets`),
        options: [
          { key: 'flap', label: 'Flap', desc: 'Standard', price: 0 },
          { key: 'patch', label: 'Patch', desc: 'Softer, casual' },
          { key: 'slanted', label: 'Slanted', desc: 'Hacking pockets' },
        ],
      },
      {
        id: 'thirdPocket',
        label: 'Third Pocket',
        type: 'toggle',
        priced: true,
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
          { key: 'double', label: 'Double', desc: 'Side vents' },
        ],
      },
    ],
  },

  {
    // After the jacket, where GD wants it: the lining is chosen once the
    // jacket it goes in has been designed.
    key: 'lining',
    title: 'Lining & Stitching',
    blurb: 'Chosen with the cloth, not buried in the detail page.',
    fields: [
      {
        id: 'liningMode',
        label: 'Lining',
        type: 'choice',
        prompt: () => null, // described in its own paragraph of the render prompt
        // The keys are from when these read "choose a colour" and "upload a
        // pattern". Kept, so the orders already filed under them keep their
        // choice and their price.
        options: [
          { key: 'colour', label: 'Standard', desc: 'From the lining range', price: 0 },
          { key: 'vinyl', label: 'Vinyl Print', desc: 'Custom text, inside the blazer on both sides' },
          // 2M of print, for the blazer. The waistcoat as well takes 3M - see
          // customLiningScope.
          { key: 'pattern', label: 'Digital Print', desc: 'Custom imagery' },
        ],
      },
      // Typed, not picked off a colour wheel: a lining is matched from stock
      // by eye and code, and a wheel promised a shade nobody could guarantee.
      { id: 'liningColour', label: 'Lining colour', type: 'text', colourText: true,
        placeholder: 'Burgundy, navy paisley...', prompt: () => null },
      { id: 'liningCode', label: 'Lining Material Code', type: 'text', mono: true, placeholder: 'e.g. LN 9041', prompt: () => null },
      { id: 'liningText', label: 'Lining text', type: 'text', showIf: (s) => s.liningMode === 'vinyl',
        placeholder: 'Names, a date, a few words...', maxLength: 200, prompt: () => null },
      { id: 'liningCollage', label: 'Custom lining - upload collage', type: 'images', slot: 'lining_collage',
        showIf: (s) => s.liningMode === 'pattern',
        hint: 'The artwork the lining is printed from. Several images can be added.',
        prompt: () => null },
      {
        // Was on the detail page, beside a second "custom lining" switch that
        // charged for the same thing twice.
        id: 'customLiningScope',
        label: 'Custom lining goes in',
        type: 'choice',
        showIf: (s) => s.liningMode === 'pattern' && includesPart(s.suitType ?? 'two_piece', 'waistcoat'),
        prompt: (v) => (v === 'jacket_waistcoat' ? 'custom lining in the jacket and the waistcoat' : 'custom lining in the jacket only'),
        options: [
          { key: 'jacket', label: 'Jacket only', desc: '2M', price: 0 },
          // More lining: 3M against the jacket's 2M.
          { key: 'jacket_waistcoat', label: 'Jacket and waistcoat', desc: '3M' },
        ],
      },
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
          { key: 'double', label: 'Double Breasted' },
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
          { key: 'lapel', label: 'Yes' },
        ],
      },
      {
        id: 'wcPockets',
        label: 'Pocket Style',
        type: 'choice',
        prompt: (v) => (v === 'none' ? 'no waistcoat pockets' : 'standard waistcoat pockets'),
        options: [
          { key: 'none', label: 'No Pockets', price: 0 },
          { key: 'standard', label: 'Standard Pockets' },
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
          { key: 'single', label: 'Single' },
          { key: 'double', label: 'Double' },
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
          { key: 'double_button', label: 'Double Button' },
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
          { key: 'side_adjusters', label: 'Side Adjusters', desc: 'No belt needed' },
          { key: 'elastic_band', label: 'Elastic Band' },
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
          { key: 'turn_up', label: 'Turn-Up', desc: 'Cuffed' },
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
    // The detail of what was ticked on the base garment page. Shoes and socks
    // are gone - GD does not sell them. The photo of the client's own shoes,
    // which is for the render rather than the bill, moved to the photographs.
    key: 'extras',
    title: 'Extras',
    blurb: 'The detail of the shirt, tie and pins chosen on the base garment page.',
    empty: 'Nothing to detail yet - tick a shirt, a tie or a lapel pin on the Base Garment page.',
    fields: [
      // `recall` draws the answers already given on the base garment page
      // above the field, filled in and editable here too - the same answer,
      // not a second copy of it, so it is charged and printed once.
      { id: 'shirtCode', label: 'Shirt Material Code', type: 'text', mono: true, showIf: (s) => s.shirt,
        section: 'Shirt', recall: ['shirtColour'], placeholder: 'e.g. MPT 9063', prompt: () => null },
      {
        id: 'shirtCollar',
        label: 'Collar Type',
        type: 'choice',
        showIf: (s) => s.shirt,
        prompt: (v, s) => (v === 'custom'
          ? (s.shirtCollarCustom ? `a shirt collar: ${s.shirtCollarCustom}` : null)
          : `a ${({
            standard: 'standard', cutaway: 'cutaway', pointed: 'pointed', button_down: 'button-down',
            wing: 'wing-tip', chinese: 'mandarin (Chinese)',
          })[v] ?? v} shirt collar`),
        options: [
          { key: 'standard', label: 'Standard', price: 0 },
          { key: 'cutaway', label: 'Cutaway' },
          { key: 'pointed', label: 'Pointed', price: 0 },
          { key: 'button_down', label: 'Button Down', price: 0 },
          { key: 'wing', label: 'Wing Tip', desc: 'Black tie' },
          { key: 'chinese', label: 'Chinese', desc: 'Mandarin, no points', price: 0 },
          { key: 'custom', label: 'Custom', desc: 'Explain below', price: 0 },
        ],
      },
      { id: 'shirtCollarCustom', label: 'Describe the collar', type: 'text', showIf: (s) => s.shirt && s.shirtCollar === 'custom',
        prompt: () => null }, // carried by the collar clause
      {
        id: 'shirtCuff',
        label: 'Cuff Type',
        type: 'choice',
        showIf: (s) => s.shirt,
        prompt: (v) => ({
          hybrid: 'single convertible cuffs that take a button or a cufflink',
          french: 'double (french) cuffs with cufflinks',
          barrel: 'single cuffs',
        })[v] ?? null,
        options: [
          { key: 'hybrid', label: 'Single Hybrid', desc: 'Button and cuff', price: 0 },
          { key: 'french', label: 'Double Cuff (French)', desc: 'Cufflinks' },
          { key: 'barrel', label: 'Single Cuff', price: 0, retired: true },
        ],
      },
      {
        id: 'shirtButtonColour',
        label: 'Shirt Button',
        type: 'choice',
        showIf: (s) => s.shirt,
        prompt: (v) => ({
          white: 'white shirt buttons',
          black: 'black shirt buttons',
          metallic: 'metallic shirt buttons',
          covered: 'shirt buttons covered in the shirt cloth',
          metallic_silver: 'metallic silver shirt buttons',
          metallic_gold: 'metallic gold shirt buttons',
        })[v] ?? null,
        options: [
          { key: 'white', label: 'White', price: 0 },
          { key: 'black', label: 'Black', price: 0 },
          { key: 'metallic', label: 'Metallic' },
          { key: 'covered', label: 'Material Covered' },
          { key: 'neutral', label: 'Neutral', desc: 'Matching the shirt', price: 0, retired: true },
          { key: 'metallic_silver', label: 'Metallic Silver', retired: true },
          { key: 'metallic_gold', label: 'Metallic Gold', retired: true },
        ],
      },
      {
        id: 'shirtChest',
        label: 'Shirt Chest',
        type: 'choice',
        showIf: (s) => s.shirt,
        prompt: (v) => (v === 'pleated' ? 'a pleated shirt front' : null),
        options: [
          { key: 'normal', label: 'Plain', price: 0 },
          { key: 'pleated', label: 'Pleated', desc: 'Black tie' },
        ],
      },
      { id: 'shirtFinishes', label: 'Custom shirt finishes', type: 'longtext', showIf: (s) => s.shirt,
        placeholder: 'Contrast collar, placket detail, hidden buttons...', prompt: (v) => `shirt detail: ${v}` },

      { id: 'tieReference', label: 'Tie photo', type: 'images', slot: 'tie_reference',
        showIf: (s) => s.neckwear, section: 'Tie', recall: ['neckwearType', 'neckwearColour'],
        hint: 'A picture of the tie, or the cloth it is made from.',
        prompt: () => null },
      {
        id: 'pocketSquare',
        label: 'Pocket Square',
        type: 'choice',
        showIf: (s) => s.neckwear,
        prompt: (v, s) =>
          v === 'same' ? 'a pocket square in the same cloth as the tie'
            : v === 'different' ? (s.pocketSquareColour ? `a pocket square in ${colourWords(s.pocketSquareColour)}` : 'a pocket square')
            : null,
        options: [
          // In the tie's price: the tie or bow tie and its pocket square are
          // priced together.
          { key: 'none', label: 'None', price: 0 },
          { key: 'same', label: 'Same as tie', price: 0 },
          { key: 'different', label: 'Different colour', price: 0 },
        ],
      },
      { id: 'pocketSquareColour', label: 'Pocket Square Colour', type: 'text', colourText: true,
        showIf: (s) => s.neckwear && s.pocketSquare === 'different', placeholder: 'White, gold paisley...', prompt: () => null },
      { id: 'pocketSquareReference', label: 'Pocket square photo', type: 'images', slot: 'pocket_square_reference',
        // Not for one in the tie's cloth: the tie photo already shows it.
        showIf: (s) => s.neckwear && s.pocketSquare === 'different',
        hint: 'A picture of the pocket square, or its cloth.',
        prompt: () => null },

      { id: 'lapelPinNote', label: 'Pin option', type: 'text', showIf: (s) => s.lapelPin, section: 'Lapel pin',
        placeholder: 'Gold rose, feather, crest...', prompt: (v) => `the lapel pin is ${v}` },
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
      // Two arms are rarely the same, so both are taken, side by side. The
      // left keeps the old single "bicep" id, so a figure already on file is
      // not lost - it simply reads as the left.
      { id: 'bicep', label: 'Bicep (flex)', hint: 'Around the fullest part of the upper arm, flexed.',
        pair: { id: 'bicepRight', sides: ['Left', 'Right'] } },
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
      { id: 'outseam', label: 'Length (outside leg)', hint: 'From the waistband to the ground.' },
      { id: 'pantWaist', label: 'Waist', hint: 'Where the trouser is intended to sit.' },
      { id: 'pantSeat', label: 'Hip loop (over groin area)', hint: 'Fullest part, feet together.' },
      { id: 'thigh', label: 'Thigh loop', hint: 'Around the thigh.' },
      { id: 'knee', label: 'Knee loop', hint: 'Around the knee.' },
      { id: 'ankleLoop', label: 'Bottom', hint: 'Around the ankle opening.' },
      { id: 'rise', label: 'Crotch', hint: 'Crotch seam up to the top of the waistband.' },
    ],
  },
};

/**
 * Every single figure a garment takes, one row each, with a pair split into
 * its two sides. What the measurement form, the summary, the sanity check and
 * the alterations log all list, so a field added above reaches every one.
 */
export function measureRows(garment) {
  const group = MEASUREMENTS[garment];
  if (!group) return [];
  return group.fields.flatMap((f) => (f.pair
    ? [
        { id: f.id, label: `${f.label} - ${f.pair.sides[0].toLowerCase()}`, hint: f.hint },
        { id: f.pair.id, label: `${f.label} - ${f.pair.sides[1].toLowerCase()}`, hint: f.hint },
      ]
    : [{ id: f.id, label: f.label, hint: f.hint }]));
}

/** The garments an order is measured for, by what its base garment includes. */
export function measuredGarments(suitType) {
  // The jacket and trouser figures are the body record and are always taken;
  // the waistcoat's only when one is being made.
  return Object.keys(MEASUREMENTS).filter((g) => g !== 'waistcoat' || includesPart(suitType ?? 'two_piece', 'waistcoat'));
}

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

/**
  * What a field is actually set to.
  *
  * A field with a default shows that default the moment it appears, so as far
  * as the tailor is concerned it is chosen. The lining colour was the case
  * that gave this away: the swatch read navy, the spec held nothing, and the
  * render prompt said nothing about lining at all.
  */
export const valueOf = (field, spec = {}) => {
  const value = spec[field.id];
  return value === undefined && field.default !== undefined ? field.default : value;
};

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

/** Money in, against the deposit the shop's terms require before cutting. */
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

/**
 * GD's own wording over a built-in field or option.
 *
 * Keyed exactly as the price list is - `jacketFit:medium` for an option,
 * `shirt` for a field - so a row in Settings renames and reprices the same
 * thing. Only the words change: the option's key, and so every order that
 * already chose it, stays exactly as it was.
 */
export function withLabels(field, labels = {}) {
  const own = labels[field.id];
  // A switch has a note under its name too, edited the way an option's is.
  const named = own?.label || own?.desc !== undefined
    ? { ...field, label: own.label || field.label, ...(own.desc !== undefined ? { desc: own.desc } : {}), renamed: true }
    : field;
  if (!Array.isArray(named.options)) return named;
  return {
    ...named,
    options: named.options.map((o) => {
      const l = labels[`${field.id}:${o.key}`];
      if (!l) return o;
      return { ...o, label: l.label || o.label, desc: l.desc !== undefined ? l.desc : o.desc, renamed: true };
    }),
  };
}

export function buildSteps(customCategories = [], customItems = [], customOptions = [], labels = {}) {
  const active = customItems.filter((i) => i.active !== 0);
  // An item filed under a page that no longer exists - the detail page went in
  // October - is shown on Extras rather than silently dropped from the flow.
  const known = new Set([...STEPS.map((s) => s.key), ...customCategories.map((c) => c.key)]);
  const byCategory = active.reduce((acc, item) => {
    (acc[known.has(item.category) ? item.category : 'extras'] ??= []).push(item);
    return acc;
  }, {});

  const decorate = (fields) => fields.map((f) => withCustomOptions(f, customOptions));

  const builtIn = STEPS.map((step) => {
    const extra = byCategory[step.key] ?? [];
    return {
      ...step,
      fields: decorate([...step.fields.map((f) => withLabels(f, labels)), ...extra.map(customItemToField)]),
    };
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
