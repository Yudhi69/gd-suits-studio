import { STEPS, isVisible } from './catalog.js';
import { nameColour } from './colour.js';

export const VIEWS = [
  { key: 'front', label: 'Front', camera: 'straight-on front view, subject facing the camera' },
  { key: 'side', label: 'Side', camera: 'full profile side view, subject turned 90 degrees' },
  { key: 'back', label: 'Back', camera: 'back view, showing the vents and shoulder line' },
  { key: 'three_quarter', label: '3/4', camera: 'three-quarter view, subject turned about 30 degrees' },
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
      const value = spec[field.id];
      if (value === undefined || value === null || value === '' || value === false) continue;

      if (typeof field.prompt === 'function') {
        const phrase = field.prompt(value, spec);
        if (phrase) clauses.push(phrase);
        continue;
      }

      if (field.type === 'choice') {
        const opt = field.options?.find((o) => o.key === value);
        if (opt) clauses.push(`${field.label.toLowerCase()}: ${opt.label.toLowerCase()}`);
      } else if (field.type === 'toggle') {
        clauses.push(field.label.toLowerCase());
      } else if (field.type === 'colour') {
        clauses.push(`${field.label.toLowerCase()} in ${value}`);
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

/**
 * Composes the full render instruction.
 *
 * `refs` describes which reference images are attached, in order, so the model
 * is told what each attachment is for instead of guessing.
 */
export function buildRenderPrompt({ spec = {}, client = {}, analysis = {}, view = 'front', refs = [], notes = '', steps = STEPS }) {
  const viewDef = VIEWS.find((v) => v.key === view) ?? VIEWS[0];
  const clauses = describeGarment(spec, steps);

  const refLines = refs.map((r, i) => {
    const n = i + 1;
    if (r.role === 'subject') return `Image ${n} (${r.label}): the client. Preserve this person's face, skin tone, hair and body proportions exactly.`;
    if (r.role === 'swatch' && r.slot === 'fabric') return `Image ${n} (fabric swatch): the exact cloth the suit is cut from. Reproduce this colour, weave and pattern faithfully across the garment, at realistic garment scale.`;
    if (r.role === 'swatch' && r.slot === 'lining') return `Image ${n} (lining swatch): the lining cloth. Show it only where lining is genuinely visible.`;
    return `Image ${n} (${r.label}): styling reference for mood only - do not copy its garment details over the specification.`;
  });

  const parts = [];

  parts.push(
    'You are a master tailor\'s visualisation artist. Render a photorealistic, full-length studio photograph of the client wearing the bespoke suit specified below.'
  );

  if (refLines.length) {
    parts.push(`Reference images, in order:\n${refLines.join('\n')}`);
  }

  const skin = skinToneClause(analysis);
  if (skin) parts.push(`Client: ${skin}.`);

  parts.push(`Garment specification - every detail is mandatory and must be visible and correct:\n- ${clauses.join('\n- ')}`);

  if (spec.liningMode === 'colour' && spec.liningColour) {
    parts.push(
      `Lining colour is ${nameColour(spec.liningColour)} (${spec.liningColour}); show a glimpse of it only if the jacket naturally opens.`
    );
  }

  parts.push(
    `Camera and styling: ${viewDef.camera}. Full length, head to shoes, subject centred with a little headroom. Clean seamless mid-grey studio backdrop, soft key light from camera left with a gentle fill, no harsh shadows. Shot on an 85mm lens at f/4 so the whole garment is sharp. Natural relaxed posture, arms at the sides, jacket buttoned as specified.`
  );

  if (notes?.trim()) parts.push(`Additional direction from the tailor: ${notes.trim()}`);

  parts.push(
    'Accuracy rules: the garment must match the specification exactly - button count, lapel style and width, pocket type, vents and hem are all checkable details, so get them right. Do not invent extra pockets, patterns, logos or accessories that were not specified. Do not restyle the client\'s face or body. Do not add text or watermarks to the image.'
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
    `Keep everything else identical - the same person, face, skin tone, pose, lighting, background and ${viewDef.camera}. Keep every other garment detail exactly as it is.`,
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
      const value = spec[field.id];
      if (value === undefined || value === null || value === '' || value === false) continue;
      let display;
      if (field.type === 'choice') display = field.options?.find((o) => o.key === value)?.label ?? String(value);
      else if (field.type === 'toggle') display = 'Yes';
      else display = String(value);
      rows.push({ label: field.label, value: display });
    }
    if (rows.length) sections.push({ title: step.title, rows });
  }
  return sections;
}
