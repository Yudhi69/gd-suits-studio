import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * A full-spectrum colour picker.
 *
 * Hue runs around the wheel and saturation outward from the centre, with
 * brightness on its own slider - between them every colour the eye can be
 * shown on this display is reachable by dragging one dot. The text field
 * accepts any CSS colour so a client's exact brand hex, an `rgb()` from a
 * supplier's spec or a plain name like `midnightblue` can be pasted straight
 * in.
 */

const SIZE = 216;
const RIM = 5;

/* ------------------------------------------------------------- conversion */

export function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function rgbToHsv({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

const toHex = ({ r, g, b }) =>
  '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');

/**
 * Parses any CSS colour by handing it to the canvas and reading back what it
 * normalised to. That inherits the browser's own parser, so named colours,
 * `rgb()`, `hsl()` and modern syntaxes all work without writing a parser -
 * and anything invalid leaves the sentinel untouched, which is how it is
 * detected.
 */
export function parseCssColour(value) {
  const input = String(value ?? '').trim();
  if (!input) return null;

  const ctx = document.createElement('canvas').getContext('2d');
  const SENTINEL = '#010203';
  ctx.fillStyle = SENTINEL;
  ctx.fillStyle = input;
  const normalised = ctx.fillStyle;

  // Unchanged sentinel means the browser rejected it - unless that is genuinely
  // what was asked for.
  if (normalised === SENTINEL && !/^#010203$/i.test(input.replace(/\s/g, ''))) return null;

  if (normalised.startsWith('#')) {
    return { r: parseInt(normalised.slice(1, 3), 16), g: parseInt(normalised.slice(3, 5), 16), b: parseInt(normalised.slice(5, 7), 16) };
  }
  const m = /rgba?\(([^)]+)\)/.exec(normalised);
  if (!m) return null;
  const [r, g, b] = m[1].split(',').map((n) => parseFloat(n));
  return { r, g, b };
}

/* ------------------------------------------------------------------ wheel */

function Wheel({ hsv, onChange }) {
  const canvasRef = useRef(null);
  const draggingRef = useRef(false);

  // The wheel is redrawn whenever brightness changes, so what is on it always
  // matches the colour that will actually be produced.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(SIZE, SIZE);
    const centre = SIZE / 2;
    const radius = centre - RIM;

    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = x - centre + 0.5;
        const dy = y - centre + 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const i = (y * SIZE + x) * 4;

        if (dist > radius + 1) { img.data[i + 3] = 0; continue; }

        let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (angle < 0) angle += 360;

        const { r, g, b } = hsvToRgb(angle, Math.min(1, dist / radius), hsv.v);
        img.data[i] = r;
        img.data[i + 1] = g;
        img.data[i + 2] = b;
        // Feather the rim so the circle does not look jagged.
        img.data[i + 3] = dist > radius ? Math.round((radius + 1 - dist) * 255) : 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [hsv.v]);

  const pick = useCallback(
    (event) => {
      const rect = canvasRef.current.getBoundingClientRect();
      const centre = SIZE / 2;
      const radius = centre - RIM;
      const dx = ((event.clientX - rect.left) / rect.width) * SIZE - centre;
      const dy = ((event.clientY - rect.top) / rect.height) * SIZE - centre;

      let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (angle < 0) angle += 360;
      const dist = Math.min(radius, Math.sqrt(dx * dx + dy * dy));

      onChange({ ...hsv, h: angle, s: dist / radius });
    },
    [hsv, onChange]
  );

  // Dragging continues outside the canvas, so the pointer is captured until release.
  useEffect(() => {
    const move = (e) => draggingRef.current && pick(e);
    const up = () => { draggingRef.current = false; };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [pick]);

  const centre = SIZE / 2;
  const radius = centre - RIM;
  const dotX = centre + Math.cos((hsv.h * Math.PI) / 180) * hsv.s * radius;
  const dotY = centre + Math.sin((hsv.h * Math.PI) / 180) * hsv.s * radius;
  const dotColour = toHex(hsvToRgb(hsv.h, hsv.s, hsv.v));

  return (
    <div className="wheel-wrap" style={{ width: SIZE, height: SIZE }}>
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        className="wheel-canvas"
        onPointerDown={(e) => { draggingRef.current = true; pick(e); }}
      />
      <span
        className="wheel-dot"
        style={{ left: dotX, top: dotY, background: dotColour }}
        aria-hidden="true"
      />
    </div>
  );
}

/* ----------------------------------------------------------------- picker */

export default function ColourPicker({ value, onChange, label }) {
  const [text, setText] = useState(value ?? '#000000');
  const [invalid, setInvalid] = useState(false);

  const rgb = useMemo(() => parseCssColour(value) ?? { r: 0, g: 0, b: 0 }, [value]);
  const [hsv, setHsv] = useState(() => rgbToHsv(rgb));

  // Follow the value when it is changed from outside, but leave the wheel
  // alone while the user is moving it - re-deriving hue from RGB makes the dot
  // jump around at very low saturation or brightness.
  useEffect(() => {
    setText(value ?? '');
    const parsed = parseCssColour(value);
    if (!parsed) return;
    const next = rgbToHsv(parsed);
    setHsv((cur) => (toHex(hsvToRgb(cur.h, cur.s, cur.v)) === toHex(parsed) ? cur : next));
  }, [value]);

  const commitHsv = (next) => {
    setHsv(next);
    const hex = toHex(hsvToRgb(next.h, next.s, next.v));
    setText(hex);
    setInvalid(false);
    onChange(hex);
  };

  const commitText = (raw) => {
    setText(raw);
    const parsed = parseCssColour(raw);
    if (!parsed) { setInvalid(true); return; }
    setInvalid(false);
    setHsv(rgbToHsv(parsed));
    onChange(toHex(parsed));
  };

  const pickFromScreen = async () => {
    try {
      const result = await new window.EyeDropper().open();
      commitText(result.sRGBHex);
    } catch {
      /* the picker was dismissed */
    }
  };

  const hueColour = toHex(hsvToRgb(hsv.h, hsv.s, 1));
  const current = toHex(hsvToRgb(hsv.h, hsv.s, hsv.v));

  return (
    <div className="colour-picker">
      <Wheel hsv={hsv} onChange={commitHsv} />

      <div className="colour-controls">
        <label className="tiny faint" htmlFor={`v-${label}`}>Brightness</label>
        <input
          id={`v-${label}`}
          type="range"
          className="value-slider"
          min="0"
          max="100"
          value={Math.round(hsv.v * 100)}
          style={{ background: `linear-gradient(90deg, #000, ${hueColour})` }}
          onChange={(e) => commitHsv({ ...hsv, v: Number(e.target.value) / 100 })}
        />

        <div className="inline" style={{ marginTop: 12, gap: 8 }}>
          <span className="swatch swatch-lg" style={{ background: current }} />
          <div style={{ flex: 1 }}>
            <label className="tiny faint" htmlFor={`css-${label}`}>CSS colour</label>
            <input
              id={`css-${label}`}
              className={`input mono ${invalid ? 'input-invalid' : ''}`}
              value={text}
              spellCheck={false}
              placeholder="#1b2a4a, rgb(27 42 74), midnightblue"
              onChange={(e) => commitText(e.target.value)}
              onBlur={() => { if (invalid) { setText(current); setInvalid(false); } }}
            />
            <div className="tiny faint" style={{ marginTop: 3 }}>
              {invalid
                ? 'Not a colour CSS understands - hex, rgb(), hsl() or a name.'
                : `hsl(${Math.round(hsv.h)} ${Math.round(hsv.s * 100)}% ${Math.round(hsv.v * 100)}%)`}
            </div>
          </div>
        </div>

        {typeof window !== 'undefined' && 'EyeDropper' in window && (
          <button type="button" className="btn btn-sm" style={{ marginTop: 10, width: '100%' }} onClick={pickFromScreen}>
            Pick a colour from the screen
          </button>
        )}
      </div>
    </div>
  );
}
