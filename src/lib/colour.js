/**
 * Offline colour analysis - skin tone from the client's face, dominant colours
 * from a fabric swatch. This runs entirely on canvas pixels with no network,
 * which is what lets the capture stage work in a shop with no signal.
 */

export const toHex = ({ r, g, b }) =>
  '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

export function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex ?? '');
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

function rgbToHsl({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/** Perceived lightness, used for depth banding and for contrast decisions. */
export function luminance({ r, g, b }) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Median of a pixel sample rather than the mean: a stray highlight, a
 * shadow or a stray hair skews an average badly but barely moves a median.
 */
function medianRgb(pixels) {
  if (!pixels.length) return { r: 0, g: 0, b: 0 };
  const pick = (key) => {
    const sorted = pixels.map((p) => p[key]).sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  return { r: pick('r'), g: pick('g'), b: pick('b') };
}

/**
 * Reads a disc of pixels around (x, y) from ImageData, dropping the extremes
 * so blown highlights and deep shadow do not pull the reading.
 */
export function sampleRegion(imageData, x, y, radius = 12) {
  const { width, height, data } = imageData;
  const pixels = [];

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const px = Math.round(x + dx);
      const py = Math.round(y + dy);
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const i = (py * width + px) * 4;
      if (data[i + 3] < 200) continue;
      pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
    }
  }
  if (!pixels.length) return null;

  // Trim the darkest and brightest tenth before taking the median.
  const byLum = pixels.slice().sort((a, b) => luminance(a) - luminance(b));
  const cut = Math.floor(byLum.length * 0.1);
  const core = byLum.slice(cut, byLum.length - cut || undefined);
  return medianRgb(core.length ? core : pixels);
}

const DEPTH_BANDS = [
  { max: 0.14, label: 'Deep Ebony' },
  { max: 0.22, label: 'Deep' },
  { max: 0.32, label: 'Rich Brown' },
  { max: 0.42, label: 'Tan' },
  { max: 0.52, label: 'Medium' },
  { max: 0.62, label: 'Light Medium' },
  { max: 0.72, label: 'Light' },
  { max: 0.82, label: 'Fair' },
  { max: 1.01, label: 'Very Fair' },
];

/**
 * Absolute chroma (max channel minus min, 0-1). HSL saturation is unreliable
 * at the extremes - it reports near-white and near-black as highly saturated -
 * so every "is this actually coloured?" test uses this instead.
 */
function chromaOf({ r, g, b }) {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/**
 * Undertone drives which fabrics flatter the client, so it is reported
 * separately from depth rather than folded into one label.
 *
 * Warmth is measured as a ratio rather than a raw R-B gap: on deep skin every
 * channel is low, so an absolute gap that reads "warm" on fair skin would
 * never trigger, and deep complexions would all be mislabelled neutral.
 */
function undertoneOf(rgb) {
  const { h } = rgbToHsl(rgb);
  const chroma = chromaOf(rgb);
  if (chroma < 0.06) return 'neutral';

  const warmthRatio = (rgb.r - rgb.b) / (rgb.r + rgb.b + 1);
  if (h > 45 && h <= 75) return 'olive';
  if (h >= 18 && h <= 45 && chroma > 0.15) return 'warm golden';
  if (warmthRatio > 0.22) return 'warm';
  if (warmthRatio < 0.08) return 'cool';
  return 'neutral';
}

export function classifySkinTone(rgb) {
  if (!rgb) return null;
  const lum = luminance(rgb);
  const depth = DEPTH_BANDS.find((band) => lum <= band.max)?.label ?? 'Medium';
  const undertone = undertoneOf(rgb);
  return {
    hex: toHex(rgb),
    rgb,
    depth,
    undertone,
    label: `${depth}, ${undertone} undertone`,
    luminance: Number(lum.toFixed(3)),
  };
}

/**
 * Fabric suggestions from measured tone. Deliberately conservative and
 * explainable - this is a starting point for the tailor's own judgement, not
 * a verdict, and it works with no connection.
 */
export function suggestFabrics(tone) {
  if (!tone) return [];
  const { luminance: lum, undertone } = tone;
  const out = [];

  if (lum < 0.3) {
    out.push({ name: 'Ivory / champagne', why: 'Maximum contrast against a deep complexion - reads striking in photographs.' });
    out.push({ name: 'Jewel emerald or burgundy', why: 'Saturated colour holds its own against deeper skin instead of being washed out.' });
    out.push({ name: 'Light grey', why: 'Softer contrast than white while still lifting the face.' });
  } else if (lum < 0.55) {
    out.push({ name: 'Navy', why: 'The safe, universally flattering base for mid-depth skin.' });
    out.push({ name: 'Charcoal', why: 'Formal without the harshness of black at this depth.' });
    out.push({ name: 'Olive or tobacco', why: 'Picks up warmth in mid-tone skin.' });
  } else {
    out.push({ name: 'Mid to dark navy', why: 'Adds the contrast that fair skin needs so the suit does not disappear.' });
    out.push({ name: 'Charcoal or slate', why: 'Defines the silhouette against a lighter complexion.' });
    out.push({ name: 'Avoid pale beige', why: 'Too close to fair skin - the outline of the suit is lost.' });
  }

  if (undertone.includes('warm') || undertone === 'olive') {
    out.push({ name: 'Warm accents - bronze, gold, rust', why: `A ${undertone} undertone sits well with warm metallics in the lining and pins.` });
  } else if (undertone === 'cool') {
    out.push({ name: 'Cool accents - silver, icy blue, plum', why: 'A cool undertone is complemented by cooler accessory colours.' });
  }
  return out;
}

/**
 * Dominant colours of a swatch by coarse colour-bucket voting - enough to name
 * the cloth's main colour and show a palette, without pulling in a
 * clustering library.
 */
export function extractPalette(imageData, count = 5) {
  const { data } = imageData;
  const buckets = new Map();
  const STEP = 4 * 4; // sample every 4th pixel; a swatch does not need every one

  for (let i = 0; i < data.length; i += STEP) {
    if (data[i + 3] < 200) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
    const entry = buckets.get(key);
    if (entry) {
      entry.r += r; entry.g += g; entry.b += b; entry.n += 1;
    } else {
      buckets.set(key, { r, g, b, n: 1 });
    }
  }

  const total = [...buckets.values()].reduce((sum, e) => sum + e.n, 0) || 1;
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((e) => {
      const rgb = { r: e.r / e.n, g: e.g / e.n, b: e.b / e.n };
      return { hex: toHex(rgb), rgb, share: Number((e.n / total).toFixed(3)) };
    });
}

/** Rough, human-readable name for a swatch colour, for notes and prompts. */
export function nameColour(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '';
  const { h, l } = rgbToHsl(rgb);
  if (chromaOf(rgb) < 0.06) {
    if (l < 0.12) return 'black';
    if (l < 0.3) return 'charcoal';
    if (l < 0.55) return 'grey';
    if (l < 0.85) return 'light grey';
    return 'white';
  }
  const hueName =
    h < 15 ? 'red' : h < 40 ? 'orange/tan' : h < 65 ? 'gold' : h < 90 ? 'olive' :
    h < 160 ? 'green' : h < 200 ? 'teal' : h < 250 ? 'blue' : h < 290 ? 'purple' :
    h < 330 ? 'magenta' : 'red';
  const depth = l < 0.22 ? 'deep ' : l < 0.4 ? 'dark ' : l > 0.75 ? 'pale ' : '';
  return `${depth}${hueName}`.trim();
}

/** Draws an image element to an offscreen canvas and returns its ImageData. */
export function imageDataFrom(img, maxSide = 900) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return { imageData: ctx.getImageData(0, 0, w, h), width: w, height: h, scale };
}
