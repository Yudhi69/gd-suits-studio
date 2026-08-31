import React, { useEffect, useRef, useState } from 'react';
import { imageDataFrom, sampleRegion, classifySkinTone, extractPalette, nameColour, toHex } from '../lib/colour.js';
import { loadImage } from '../lib/image.js';

/**
 * Click a photo to read the colour under the cursor.
 *
 * For a face this gives the client's skin tone; for a swatch it gives the
 * cloth colour. Both run on canvas pixels with no network, which is the point:
 * the measurement is available before any AI is involved, and it is what gets
 * handed to the render prompt so the model is told the tone rather than
 * guessing it from a photo.
 */
export default function ColourSampler({ src, mode = 'skin', value, onPick, radius = 12 }) {
  const canvasRef = useRef(null);
  const dataRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [palette, setPalette] = useState([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);

    loadImage(src)
      .then((img) => {
        if (cancelled) return;
        const { imageData, width, height } = imageDataFrom(img, 900);
        dataRef.current = imageData;

        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);

        if (mode === 'swatch') setPalette(extractPalette(imageData, 6));
        setReady(true);
      })
      .catch((e) => !cancelled && setError(e.message));

    return () => { cancelled = true; };
  }, [src, mode]);

  function positionFrom(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function read(event) {
    if (!dataRef.current) return null;
    const { x, y } = positionFrom(event);
    const rgb = sampleRegion(dataRef.current, x, y, radius);
    if (!rgb) return null;
    return mode === 'skin'
      ? classifySkinTone(rgb)
      : { hex: toHex(rgb), rgb, label: nameColour(toHex(rgb)) };
  }

  return (
    <div className="stack">
      {error && <div className="banner banner-warn">{error}</div>}

      <div style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          className="sampler-canvas"
          onMouseMove={(e) => ready && setHover(read(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => { const picked = read(e); if (picked) onPick(picked); }}
        />
        {!ready && !error && <div className="progress-note muted">Loading photo...</div>}
      </div>

      <div className="inline">
        <div className="swatch swatch-lg" style={{ background: (hover ?? value)?.hex ?? '#00000010' }} />
        <div>
          <div style={{ fontWeight: 600 }}>
            {(hover ?? value)?.hex ?? 'Click the photo to sample'}
          </div>
          <div className="small muted">
            {(hover ?? value)?.label ?? (mode === 'skin'
              ? 'Click an evenly lit part of the cheek or forehead - avoid highlights and shadow.'
              : 'Click the flattest, most representative part of the cloth.')}
          </div>
          {hover && <div className="tiny faint">Click to lock this reading in.</div>}
        </div>
      </div>

      {mode === 'swatch' && palette.length > 0 && (
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>Dominant colours in this swatch</div>
          <div className="swatch-row">
            {palette.map((p) => (
              <button
                key={p.hex}
                className="swatch"
                title={`${p.hex} - ${nameColour(p.hex)} (${Math.round(p.share * 100)}%)`}
                style={{ background: p.hex, cursor: 'pointer' }}
                onClick={() => onPick({ hex: p.hex, rgb: p.rgb, label: nameColour(p.hex) })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
