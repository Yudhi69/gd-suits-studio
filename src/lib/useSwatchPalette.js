import { useEffect, useState } from 'react';
import { loadImage } from './image.js';
import { fabricPalette, imageDataFrom } from './colour.js';

/**
 * Measured once per photograph. A swatch is never edited in place - a new
 * photo is a new file with a new name - so the address is a safe key, and the
 * Cloth and Preview steps share one measurement rather than taking two.
 */
const measured = new Map();

export function measureSwatch(src) {
  if (!measured.has(src)) {
    // Photos are stored at most 1800px on the long edge; measuring at that
    // size keeps a fine line a line rather than a blur into the ground.
    measured.set(
      src,
      loadImage(src)
        .then((img) => fabricPalette(imageDataFrom(img, 1800).imageData))
        .catch(() => [])
    );
  }
  return measured.get(src);
}

/** The colours of the swatch at `src` and the share of each, or null while measuring. */
export default function useSwatchPalette(src) {
  const [palette, setPalette] = useState(null);
  useEffect(() => {
    let live = true;
    setPalette(null);
    if (src) measureSwatch(src).then((p) => { if (live) setPalette(p); });
    return () => { live = false; };
  }, [src]);
  return palette;
}
