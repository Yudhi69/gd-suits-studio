import React, { useRef, useState } from 'react';
import CameraCapture from './CameraCapture.jsx';
import { fileToDataUrl, imageFileFrom } from '../lib/image.js';
import { useToast } from './ui.jsx';

/**
 * One capture slot. Accepts a file picker, a drag-and-drop, a paste, or a
 * live camera shot - whichever is quickest for the tailor in the moment.
 */
export default function PhotoSlot({ slot, photo, onSave, onClear, onOpen }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function accept(file) {
    if (!file) return;
    setBusy(true);
    try {
      const { dataUrl, width, height } = await fileToDataUrl(file);
      await onSave({ dataUrl, meta: { width, height, source: 'file' } });
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        className={`photo-slot ${photo ? 'filled' : ''} ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); accept(imageFileFrom(e)); }}
      >
        <div
          className="photo-frame"
          onClick={() => (photo ? onOpen?.(photo) : inputRef.current?.click())}
          title={photo ? 'Click to open' : 'Click to choose a file'}
        >
          {busy ? (
            <div className="placeholder"><div className="spinner" style={{ margin: '0 auto' }} /></div>
          ) : photo ? (
            <img src={photo.url} alt={slot.label} />
          ) : (
            <div className="placeholder">
              <div className="big">+</div>
              <div className="tiny" style={{ marginTop: 4 }}>Drop, paste or click</div>
            </div>
          )}
        </div>

        <div className="photo-meta">
          <div style={{ fontWeight: 600, fontSize: 13 }}>{slot.label}</div>
          <div className="tiny faint" style={{ minHeight: 28 }}>{slot.hint}</div>
        </div>

        <div className="photo-actions">
          <button className="btn btn-sm btn-ghost" onClick={() => inputRef.current?.click()} disabled={busy}>File</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setCamera(true)} disabled={busy}>Camera</button>
          {photo && <button className="btn btn-sm btn-ghost btn-danger" onClick={() => onClear(photo)}>Clear</button>}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => { accept(e.target.files?.[0]); e.target.value = ''; }}
        />
      </div>

      {camera && (
        <CameraCapture
          label={slot.label}
          onClose={() => setCamera(false)}
          onCapture={({ dataUrl, width, height }) => onSave({ dataUrl, meta: { width, height, source: 'camera' } })}
        />
      )}
    </>
  );
}
