import React from 'react';

/**
 * Line drawings of the choices that are hard to name.
 *
 * "Notch", "peak" and "shawl" are the trade's words, and a client who has
 * never had a suit made does not know them - which is the moment the choice
 * is being made, with GD's laptop turned round. A drawing settles it in a
 * second. Lapel width is worse: nobody pictures the difference between two
 * inches and four, and the four drawn side by side make it obvious.
 *
 * They are drawn here rather than downloaded. Every illustration of a lapel
 * worth copying belongs to somebody, and one that does not is a photograph of
 * a suit that is not GD's. These are geometry: a few hundred bytes, no
 * network, no licence, sharp at any size, and they take the theme's own ink
 * because they are drawn in `currentColor`.
 *
 * The shapes are the real ones. A notch has a step cut between the collar and
 * the lapel; a peak carries the lapel point up past the gorge; a shawl has no
 * seam at all - one curve from the break to the neck, and no collar tip.
 * Drawn wrong they would be worse than no drawing at all.
 */

/** Shoulders, neck, front edges, and the closure below the break. */
const BODY = (
  <>
    <path d="M 12 96 L 12 30 L 40 16" />
    <path d="M 88 96 L 88 30 L 60 16" />
    <path d="M 40 16 Q 50 22 60 16" />
    <path d="M 50 64 L 50 96" />
    <circle cx="50" cy="66" r="2.3" fill="currentColor" stroke="none" />
  </>
);

/** The collar band, from the neck down to its tip. A shawl has none. */
const COLLAR = 'M 50 21 L 40 25 L 35 31 L 42 31 L 50 26 Z';

/** A piece drawn on both fronts - the right is the left, mirrored. */
const Pair = ({ d, className }) => (
  <>
    <path className={className} d={d} />
    <path className={className} d={d} transform="translate(100 0) scale(-1 1)" />
  </>
);

function Jacket({ lapel, collar = COLLAR }) {
  return (
    <svg viewBox="0 0 100 100" className="sketch" aria-hidden="true" focusable="false">
      {BODY}
      {collar && <Pair className="sketch-collar" d={collar} />}
      <Pair className="sketch-lapel" d={lapel} />
    </svg>
  );
}

export const NotchLapel = () => <Jacket lapel="M 50 64 L 45 31 L 31 35 Z" />;
export const PeakLapel = () => <Jacket lapel="M 50 64 L 45 30 L 29 22 L 32 36 Z" />;
export const ShawlLapel = () => (
  <Jacket
    collar={null}
    lapel={
      'M 50 64 C 37 54 28 42 33 30 C 36 22 40 18 41 16 ' +
      'L 48 20 C 44 24 41 28 39 34 C 36 44 43 55 50 64 Z'
    }
  />
);

/**
 * Width, drawn on the same front so the four can be compared.
 *
 * `out` is where the lapel's outer corner sits: the further left, the wider
 * the lapel. They are in proportion to the inches the options name.
 */
const WidthLapel = ({ out, inner }) => <Jacket lapel={`M 50 64 L ${inner} 31 L ${out} 35 Z`} />;
export const SlimLapel = () => <WidthLapel out={39} inner={46} />;
export const StandardLapel = () => <WidthLapel out={35} inner={45} />;
export const WideLapel = () => <WidthLapel out={29} inner={44} />;
export const ExtraWideLapel = () => <WidthLapel out={25} inner={43} />;

/**
 * Which drawing belongs to which option, as `field id:option key`.
 *
 * A lookup rather than a property on the option, because an option GD adds
 * himself has no drawing and should not be made to carry an empty one.
 */
export const SKETCHES = {
  'lapel:notch': NotchLapel,
  'lapel:peak': PeakLapel,
  'lapel:shawl': ShawlLapel,
  'lapelWidth:slim': SlimLapel,
  'lapelWidth:standard': StandardLapel,
  'lapelWidth:wide': WideLapel,
  'lapelWidth:extra_wide': ExtraWideLapel,
};

export const sketchFor = (fieldId, optionKey) => SKETCHES[`${fieldId}:${optionKey}`] ?? null;
