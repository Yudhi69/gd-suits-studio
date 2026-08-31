import React, { useEffect, useRef, useState } from 'react';
import { Modal, Banner } from './ui.jsx';
import { normaliseDataUrl } from '../lib/image.js';

/**
 * Live camera capture. The shop's own webcam or a tethered phone camera is the
 * fastest way to get the front/side/back shots in, so this is offered
 * alongside the file picker rather than instead of it.
 */
export default function CameraCapture({ label, onCapture, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [error, setError] = useState(null);
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : { width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;

        // Labels only populate once permission is granted, so enumerate after.
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setDevices(all.filter((d) => d.kind === 'videoinput'));
      } catch (err) {
        if (cancelled) return;
        setError(
          err.name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow the camera for GD Suits Studio in System Settings > Privacy & Security > Camera, then reopen this window.'
            : err.name === 'NotFoundError'
              ? 'No camera was found on this machine. Use "Choose file" instead.'
              : `Could not start the camera: ${err.message}`
        );
      }
    }

    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);

  async function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const shot = await normaliseDataUrl(canvas.toDataURL('image/jpeg', 0.95));
      onCapture(shot);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Capture - ${label}`}
      onClose={onClose}
      wide
      footer={
        <>
          {devices.length > 1 && (
            <select className="select" style={{ maxWidth: 260 }} value={deviceId ?? ''} onChange={(e) => setDeviceId(e.target.value || null)}>
              <option value="">Default camera</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>
              ))}
            </select>
          )}
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" onClick={shoot} disabled={!!error || busy}>
            {busy ? 'Saving...' : 'Take photo'}
          </button>
        </>
      }
    >
      {error ? (
        <Banner kind="warn">{error}</Banner>
      ) : (
        <div style={{ background: '#1a1815', borderRadius: 10, overflow: 'hidden' }}>
          <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', display: 'block', maxHeight: '58vh' }} />
        </div>
      )}
      <p className="small muted" style={{ marginTop: 12, marginBottom: 0 }}>
        Even, indirect light gives the truest skin tone and fabric colour. Avoid shooting against a window.
      </p>
    </Modal>
  );
}
