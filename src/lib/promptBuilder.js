import { STEPS, SUIT_PARTS, isVisible, valueOf, colourWords } from './catalog.js';
import { clothDistance, hexToRgb, nameColour, rgbToLab } from './colour.js';

export const VIEWS = [
  // `camera` is the shot. `face` says what the camera can see of the client
  // from there, because the instruction to preserve a likeness and the
  // instruction to turn away from the lens will otherwise fight each other -
  // and the likeness wins, which is why every view used to come back front-on.
  {
    key: 'front',
    label: 'Front',
    camera: 'a straight-on FRONT view: the client faces the camera squarely, shoulders parallel to the lens',
    face: "The client's face is fully visible. Preserve their likeness exactly.",
  },
  {
    key: 'side',
    label: 'Side',
    camera: 'a full PROFILE view: the client is turned 90 degrees to the camera, facing the left edge of the frame, one shoulder nearest the lens',
    face: "Only the side of the client's head is visible, in profile. Do not turn the face toward the camera.",
  },
  {
    key: 'back',
    label: 'Back',
    camera: 'a BACK view: the client has their back to the camera, facing directly away, showing the centre seam, vents and shoulder line',
    face: 'The client faces AWAY from the camera. Their face must NOT be visible at all - the camera sees the back of their head and the back of the suit. Do not turn them around.',
  },
  {
    key: 'three_quarter',
    label: '3/4',
    camera: 'a THREE-QUARTER view: the client is turned about 45 degrees away from the camera, so one shoulder is nearer the lens and the far side of the jacket recedes',
    face: "The client's face is seen at three-quarters, turned partly away from the lens.",
  },
];

/**
 * Turns the spec into the ordered list of garment clauses a tailor would
 * actually say out loud. Fields declare their own phrasing via `prompt`;
 * anything without one falls back to "Label: Value" so a newly added option
 * still reaches the render instead of being silently dropped.
 */
export function describeGarment(spec = {}, steps = STEPS) {
  const clauses = [];

  for (const step of steps) {
    if (!isVisible(step, spec)) continue;

    for (const field of step.fields) {
      if (!isVisible(field, spec)) continue;
      const value = valueOf(field, spec);
      if (value === undefined || value === null || value === '' || value === false) continue;

      if (typeof field.prompt === 'function') {
        const phrase = field.prompt(value, spec);
        if (phrase) clauses.push(phrase);
        continue;
      }

      if (field.type === 'choice') {
        const opt = field.options?.find((o) => o.key === value);
        if (opt) clauses.push(`${field.label.toLowerCase()}: ${opt.label.toLowerCase()}`);
      } else if (field.type === 'multi') {
        const picked = (field.options ?? []).filter((o) => Array.isArray(value) && value.includes(o.key));
        if (picked.length) clauses.push(`${field.label.toLowerCase()}: ${picked.map((o) => o.label.toLowerCase()).join(', ')}`);
      } else if (field.type === 'toggle') {
        clauses.push(field.label.toLowerCase());
      } else if (field.colourText) {
        clauses.push(`${field.label.toLowerCase()}: ${colourWords(value)}`);
      } else if (String(value).trim()) {
        clauses.push(`${field.label.toLowerCase()}: ${String(value).trim()}`);
      }
    }
  }

  return clauses;
}

function skinToneClause(analysis = {}) {
  const bits = [];
  if (analysis.skinToneHex) {
    bits.push(`Match the client's complexion exactly - measured skin tone ${analysis.skinToneHex}${analysis.skinToneLabel ? ` (${analysis.skinToneLabel})` : ''}${analysis.undertone ? `, ${analysis.undertone} undertone` : ''}`);
  }
  if (analysis.build) bits.push(`build: ${analysis.build}`);
  if (analysis.posture) bits.push(`posture: ${analysis.posture}`);
  return bits.join('. ');
}

const PIECE_NAMES = { jacket: 'jacket', waistcoat: 'waistcoat', pants: 'trousers' };
const listed = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const percent = (share) => `${Math.round(share * 100)}%`;

/** The garments this suit is made of, named as the prompt names them. */
export function piecesOf(spec = {}) {
  return (SUIT_PARTS[spec.suitType] ?? SUIT_PARTS.two_piece).map((p) => PIECE_NAMES[p] ?? p);
}

/**
 * The colours measured from the swatch, with the tailor's own sample standing
 * in for whichever of them it is: he chose that pixel, so his reading of that
 * colour wins. A sample that matches none of them was taken from some other
 * cloth - on a wedding party, another man's - and is left out rather than
 * set against this suit's own swatch.
 */
function clothColours({ palette = [], sampled } = {}) {
  const pick = hexToRgb(sampled ?? '');
  if (!pick) return palette;
  const at = rgbToLab(pick);
  let nearest = -1, gap = 15;
  palette.forEach((c, i) => {
    const d = clothDistance(at, rgbToLab(hexToRgb(c.hex)));
    if (d <= gap) { gap = d; nearest = i; }
  });
  return palette.map((c, i) => (i === nearest ? { ...c, hex: sampled.toLowerCase() } : c));
}

/**
 * The cloth, in words that are the same in every view's prompt.
 *
 * The swatch photograph goes with every view, but a close-up does not say how
 * much of a suit an accent covers, and four separate renders each decided
 * that for themselves: a gold check that was a twentieth of the trousers in
 * three views was a third of them in the fourth, gathered into patches and
 * brighter. So the colours and shares measured from the swatch are stated,
 * and so is the plain fact the model kept forgetting - the trousers are the
 * same cloth as the jacket.
 */
export function describeCloth({ spec = {}, cloth = {} } = {}) {
  const pieces = piecesOf(spec);
  const lines = [
    pieces.length > 1
      ? `The cloth: the ${listed(pieces)} are ${pieces.length === 2 ? 'both' : 'all'} cut from the one bolt in the fabric swatch, so they are the same cloth - the same colours, the same pattern at the same scale, and the same amount of each colour on every piece.`
      : `The cloth: the ${pieces[0]} is cut from the cloth in the fabric swatch - the same colours, and the pattern at the same scale.`,
  ];

  const colours = clothColours(cloth);
  const name = (c) => `${nameColour(c.hex)} (${c.hex})`;
  if (colours.length === 1) {
    lines.push(`Measured from the swatch, it is a single colour, ${name(colours[0])}: add no other colour to it.`);
  } else if (colours.length > 1) {
    const [first, ...rest] = colours;
    const lead = first.share >= 0.5
      ? `${name(first)} is the ground, about ${percent(first.share)} of the cloth`
      : `${name(first)} about ${percent(first.share)}`;
    lines.push(`Measured from the swatch: ${lead}${rest.map((c) => `; ${name(c)} about ${percent(c.share)}`).join('')}.`);
    lines.push('Keep those proportions on every piece and from every angle.');
    // An accent is the colour that drifted: it is a small share of the cloth,
    // and every way of getting it wrong makes it more of one.
    const accents = [...new Set(rest.filter((c) => c.share < 0.2).map((c) => nameColour(c.hex)))];
    if (accents.length) {
      const one = accents.length === 1;
      lines.push(
        `${listed(accents.map((a) => `the ${a}`)).replace(/^t/, 'T')} ${one ? 'stays' : 'stay'} exactly as fine and as sparse as ${one ? 'it is' : 'they are'} in the swatch - never wider, larger, brighter, warmer or more saturated, and never gathered into patches or blocks.`
      );
    }
  } else {
    lines.push('Any pattern or accent colour stays exactly as fine and as sparse as it is in the swatch - never wider, larger, brighter, warmer or more saturated, and never gathered into patches or blocks.');
  }
  lines.push('Light and shade change how bright the cloth looks, never its colours.');
  return lines.join(' ');
}

/**
 * Composes the full render instruction.
 *
 * `refs` describes which reference images are attached, in order, so the model
 * is told what each attachment is for instead of guessing. `cloth` is what was
 * measured from the fabric swatch - `palette`, and the tailor's `sampled`
 * colour - and is only described when a swatch is among the refs.
 */
export function buildRenderPrompt({ spec = {}, client = {}, analysis = {}, view = 'front', refs = [], notes = '', steps = STEPS, cloth = {} }) {
  const viewDef = VIEWS.find((v) => v.key === view) ?? VIEWS[0];
  const clauses = describeGarment(spec, steps);
  const pieces = piecesOf(spec);
  const hasSwatch = refs.some((r) => r.role === 'swatch' && r.slot === 'fabric');
  const hasFront = refs.some((r) => r.role === 'consistency');

  const refLines = refs.map((r, i) => {
    const n = i + 1;
    if (r.role === 'subject') {
      // For a back view this reference is for build, hair and colouring -
      // asking for the face as well is what produced four front-on renders.
      return `Image ${n} (${r.label}): the client. Match this person's skin tone, hair and body proportions exactly${
        view === 'back' ? ' - their face is not visible in this shot' : ", and their face where the shot shows it"
      }.`;
    }
    if (r.role === 'swatch' && r.slot === 'fabric') return `Image ${n} (fabric swatch): the exact cloth the suit is cut from. Reproduce this colour, weave and pattern faithfully across the garment, at realistic garment scale.`;
    if (r.role === 'swatch' && r.slot === 'lining') return `Image ${n} (lining swatch): the lining cloth. Show it only where lining is genuinely visible.`;
    // The front of the same set, so the other views copy one cloth rather
    // than each inventing its own. It shows the wrong angle for every view it
    // is sent with, so what it is not for is said as plainly as what it is.
    if (r.role === 'consistency') {
      return `Image ${n} (${r.label}): this same suit, already rendered from the front for this set. Match its cloth exactly - the same colours, the same pattern at the same scale, and the same amount of each colour on the ${listed(pieces)} - along with its buttons, lapels and cut. Take nothing else from it: not its camera angle, its pose or its framing. This picture is the ${viewDef.label.toUpperCase()} view.`;
    }
    if (r.role === 'shoes') return `Image ${n} (shoes): the client's own shoes. Put exactly these on the client - the same style, colour, leather and finish, the same laces or buckles - with both feet fully in the frame.`;
    return `Image ${n} (${r.label}): styling reference for mood only - do not copy its garment details over the specification.`;
  });

  const parts = [];

  parts.push(
    'You are a master tailor\'s visualisation artist. Render a photorealistic, full-length studio photograph of the client wearing the bespoke suit specified below.'
  );

  // First, and again last. The shot is the thing most often lost when a long
  // specification follows it, so it is stated before the detail and restated
  // after it.
  parts.push(`THE SHOT - this is ${viewDef.label.toUpperCase()} and must not be any other angle: ${viewDef.camera}. ${viewDef.face}`);

  if (refLines.length) {
    parts.push(`Reference images, in order:\n${refLines.join('\n')}`);
  }

  const skin = skinToneClause(analysis);
  if (skin) parts.push(`Client: ${skin}.`);

  parts.push(`Garment specification - every detail is mandatory and must be visible and correct:\n- ${clauses.join('\n- ')}`);

  if (hasSwatch) parts.push(describeCloth({ spec, cloth }));

  // The lining is described on its own, because it is only glimpsed. It is
  // typed in words now; an order from the colour-wheel days still carries a
  // code, which is read out as words with the code beside it.
  const lining = String(spec.liningColour ?? '').trim();
  if (lining) {
    parts.push(
      `Lining colour is ${colourWords(lining)}; show a glimpse of it only if the jacket naturally opens.`
    );
  }

  parts.push(
    `Camera and styling: ${viewDef.camera}. Full length, head to shoes, subject centred with a little headroom. Clean seamless mid-grey studio backdrop, soft key light from camera left with a gentle fill, no harsh shadows. Shot on an 85mm lens at f/4 so the whole garment is sharp. Natural relaxed posture, arms at the sides, jacket buttoned as specified.`
  );

  if (notes?.trim()) parts.push(`Additional direction from the tailor: ${notes.trim()}`);

  const clothRule = hasSwatch || hasFront
    ? ` Do not reinterpret the cloth: its colours, the scale of its pattern and how much of each colour it has must match the ${hasSwatch && hasFront ? 'swatch and the front view' : hasSwatch ? 'swatch' : 'front view'}.`
    : '';
  parts.push(
    `Accuracy rules: the garment must match the specification exactly - button count, lapel style and width, pocket type, vents and hem are all checkable details, so get them right. Do not invent extra pockets, patterns, logos or accessories that were not specified.${clothRule} Do not change the client's build or colouring. Do not add text or watermarks to the image. Finally, check the angle before you answer: this must be the ${viewDef.label.toUpperCase()} view - ${viewDef.camera}.`
  );

  return parts.join('\n\n');
}

/**
 * A tweak keeps the previous render as the base image and asks for one
 * surgical change, so the client's likeness and the agreed details survive the
 * edit instead of being re-rolled from scratch.
 */
export function buildTweakPrompt({ instruction, spec = {}, view = 'front' }) {
  const viewDef = VIEWS.find((v) => v.key === view) ?? VIEWS[0];
  return [
    'Edit the attached suit visualisation. Image 1 is the current render and is the base you are modifying.',
    `Make exactly this change: ${instruction.trim()}`,
    `Keep everything else identical - the same person, skin tone, pose, lighting, background, and the same ${viewDef.label.toUpperCase()} angle (${viewDef.camera}). ${viewDef.face} Keep every other garment detail exactly as it is.`,
    'Return the edited photograph only, with no text or watermarks.',
  ].join('\n\n');
}

/** Plain-language spec sheet shown to the client and stored with the order. */
export function buildSpecSheet(spec = {}, steps = STEPS) {
  const sections = [];
  for (const step of steps) {
    if (!isVisible(step, spec)) continue;
    const rows = [];
    for (const field of step.fields) {
      if (!isVisible(field, spec)) continue;
      const value = valueOf(field, spec);
      if (value === undefined || value === null || value === '' || value === false) continue;
      let display;
      if (field.type === 'choice') display = field.options?.find((o) => o.key === value)?.label ?? String(value);
      else if (field.type === 'multi') {
        // An empty multi-select is nothing chosen, not a blank row on the sheet.
        const picked = (field.options ?? []).filter((o) => Array.isArray(value) && value.includes(o.key));
        if (!picked.length) continue;
        display = picked.map((o) => o.label).join(', ');
      } else if (field.type === 'toggle') display = 'Yes';
      else if (field.colourText) display = colourWords(value);
      else display = String(value);
      rows.push({ label: field.label, value: display });
    }
    if (rows.length) sections.push({ title: step.title, rows });
  }
  return sections;
}
