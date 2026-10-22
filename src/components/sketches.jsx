import React from 'react';

/**
 * Line drawings of the choices that are hard to name - lapels, pockets and
 * shirt collars.
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

/** Where the shoulder line runs, so a wide peak's point stays on the jacket. */
const shoulderY = (x) => 30 - (x - 12) / 2;

/**
 * A lapel of each style at a given width.
 *
 * `out` is where the lapel's outer corner sits: the further left, the wider
 * the lapel; `inner` is the gorge, where it meets the collar. A peak carries
 * its point up past the gorge, but never over the shoulder; a shawl is the one
 * curve, its width the bulge of that curve.
 */
const LAPELS = {
  notch: (out, inner) => `M 50 64 L ${inner} 31 L ${out} 35 Z`,
  peak: (out, inner) => {
    const tip = out - 6;
    return `M 50 64 L ${inner} 30 L ${tip} ${Math.max(22, shoulderY(tip) + 0.5)} L ${out - 3} 36 Z`;
  },
  shawl: (out) => {
    const w = (out - 35) * 0.7;
    return `M 50 64 C ${37 + w / 2} 54 ${28 + w} 42 ${33 + w} 30 C ${36 + w / 2} 22 40 18 41 16 ` +
      'L 48 20 C 44 24 41 28 39 34 C 36 44 43 55 50 64 Z';
  },
};

/** The widths, in proportion to the inches the options name. */
const WIDTHS = {
  slim: [39, 46],
  standard: [35, 45],
  wide: [29, 44],
  extra_wide: [25, 43],
};

const lapelPath = (style, width = 'standard') => {
  const [out, inner] = WIDTHS[width] ?? WIDTHS.standard;
  return (LAPELS[style] ?? LAPELS.notch)(out, inner);
};

function Lapel({ style, width }) {
  return <Jacket lapel={lapelPath(style, width)} collar={style === 'shawl' ? null : COLLAR} />;
}

export const NotchLapel = () => <Lapel style="notch" />;
export const PeakLapel = () => <Lapel style="peak" />;
export const ShawlLapel = () => <Lapel style="shawl" />;

/**
 * Width, drawn on the same front so the four can be compared - and in the
 * lapel already chosen, because two inches of peak is not two inches of
 * notch. Nothing chosen yet draws a notch, the plainest of the three.
 */
const widthOf = (width) => ({ spec }) => <Lapel style={spec?.lapel} width={width} />;
export const SlimLapel = widthOf('slim');
export const StandardLapel = widthOf('standard');
export const WideLapel = widthOf('wide');
export const ExtraWideLapel = widthOf('extra_wide');

/**
 * The hip pockets, drawn on the front of the jacket.
 *
 * GD asked for a picture here for the same reason as the lapels: "flap",
 * "patch" and "slanted" are words the client has to be shown. A flap hangs
 * from a welt; a patch is a pocket sewn on top of the cloth, so it has a
 * bottom and corners; a slanted pocket is a flap set at an angle, higher
 * toward the front and lower toward the side seam, the way a riding jacket's
 * is cut. (It was drawn the other way up until GD's review of 20 October.)
 */
const POCKETS = {
  flap: { welt: 'M 17 77 L 37 77', pocket: 'M 17 77 L 37 77 L 37 85 L 17 85 Z' },
  patch: { welt: 'M 17 76 L 37 76', pocket: 'M 17 72 L 37 72 L 37 89 Q 37 92 34 92 L 20 92 Q 17 92 17 89 Z' },
  slanted: { pocket: 'M 17 81 L 37 74 L 38 81 L 18 88 Z' },
};

/**
 * The third pocket: a small ticket pocket above the right hip pocket, in the
 * hip pockets' own style. The wearer's right is the left of the drawing.
 */
const TICKETS = {
  flap: { welt: 'M 20 68 L 34 68', pocket: 'M 20 68 L 34 68 L 34 73 L 20 73 Z' },
  patch: { welt: 'M 20 61 L 34 61', pocket: 'M 20 59 L 34 59 L 34 65 Q 34 67 32 67 L 22 67 Q 20 67 20 65 Z' },
  slanted: { pocket: 'M 20 71 L 34 66 L 34.5 70.5 L 20.5 75.5 Z' },
};

function Pockets({ pocket = 'flap', ticket = false }) {
  const hip = POCKETS[pocket] ?? POCKETS.flap;
  const small = ticket ? TICKETS[pocket] ?? TICKETS.flap : null;
  // The whole front, lapels and all, so it reads as a jacket at a glance; the
  // pockets sit at the hip, below the button.
  return (
    <svg viewBox="0 0 100 100" className="sketch" aria-hidden="true" focusable="false">
      {BODY}
      <Pair className="sketch-collar" d={COLLAR} />
      <Pair d={lapelPath('notch')} />
      {hip.welt && <Pair d={hip.welt} />}
      <Pair className="sketch-lapel" d={hip.pocket} />
      {small && (
        <>
          {small.welt && <path d={small.welt} />}
          <path className="sketch-collar" d={small.pocket} />
        </>
      )}
    </svg>
  );
}

export const FlapPocket = () => <Pockets pocket="flap" />;
export const PatchPocket = () => <Pockets pocket="patch" />;
export const SlantedPocket = () => <Pockets pocket="slanted" />;
export const ThirdPocket = ({ spec }) => <Pockets pocket={spec?.pockets} ticket />;

/**
 * Shirt collars, seen from the front: the shirt's shoulders and placket, and
 * the collar's two leaves. A turn-down collar is told apart by where its points
 * fall - long and close for a pointed collar, spread out sideways for a
 * cutaway, buttoned to the shirt for a button-down. A band stands up round the
 * neck: plain for a Chinese collar, with its front corners turned down into
 * small wings for a wing tip.
 */
const SHIRT = (
  <>
    <path d="M 30 33 L 6 46" />
    <path d="M 70 33 L 94 46" />
    <path d="M 50 40 L 50 98" />
    <circle cx="50" cy="60" r="1.8" fill="currentColor" stroke="none" />
    <circle cx="50" cy="78" r="1.8" fill="currentColor" stroke="none" />
    <circle cx="50" cy="96" r="1.8" fill="currentColor" stroke="none" />
  </>
);

/** A turn-down collar's left leaf, from the back of the neck to its point. */
const leaf = ([px, py], [c1x, c1y], [c2x, c2y]) =>
  `M 30 24 C ${c1x} ${c1y} ${c2x} ${c2y} ${px} ${py} L 49 41 C 45 36 41 30 38 21 Z`;

/** A standing band's left half, its front corner rounded or square. */
const BAND = 'M 30 22 Q 40 27 45 29 Q 48 30 48 33 L 48 38 Q 40 36 30 32 Z';
const SQUARE_BAND = 'M 30 22 Q 40 27 48 30 L 48 38 Q 40 36 30 32 Z';

function Collar({ d, band = false, extra = null }) {
  return (
    <svg viewBox="0 0 100 100" className="sketch" aria-hidden="true" focusable="false">
      {SHIRT}
      <path d={band ? 'M 30 22 Q 50 12 70 22' : 'M 30 24 Q 50 14 70 24'} />
      <Pair className="sketch-collar" d={d} />
      {extra}
    </svg>
  );
}

export const StandardCollar = () => <Collar d={leaf([37, 56], [31, 36], [34, 47])} />;
export const PointedCollar = () => <Collar d={leaf([42, 64], [31, 38], [37, 53])} />;
export const CutawayCollar = () => <Collar d={leaf([24, 47], [27, 30], [23, 40])} />;
export const ButtonDownCollar = () => (
  <Collar
    d={leaf([37, 56], [31, 36], [34, 47])}
    extra={<Pair d="M 34.8 51 a 2.2 2.2 0 1 0 4.4 0 a 2.2 2.2 0 1 0 -4.4 0 Z" className="sketch-button" />}
  />
);
export const WingCollar = () => (
  <Collar band d={SQUARE_BAND} extra={<Pair className="sketch-lapel" d="M 48 30 L 40 37 L 48 37 Z" />} />
);
export const ChineseCollar = () => <Collar band d={BAND} />;

/**
 * Which drawing belongs to which option, as `field id:option key` - or the
 * field id alone, for a switch. Each is drawn with the order's spec, so a
 * drawing can follow what has already been chosen: the lapel widths are drawn
 * in the chosen lapel, the third pocket in the chosen pockets.
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
  'pockets:flap': FlapPocket,
  'pockets:patch': PatchPocket,
  'pockets:slanted': SlantedPocket,
  thirdPocket: ThirdPocket,
  'shirtCollar:standard': StandardCollar,
  'shirtCollar:cutaway': CutawayCollar,
  'shirtCollar:pointed': PointedCollar,
  'shirtCollar:button_down': ButtonDownCollar,
  'shirtCollar:wing': WingCollar,
  'shirtCollar:chinese': ChineseCollar,
};

export const sketchFor = (fieldId, optionKey) =>
  SKETCHES[optionKey === undefined ? fieldId : `${fieldId}:${optionKey}`] ?? null;
