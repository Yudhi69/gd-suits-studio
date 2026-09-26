import React, { useEffect, useState } from 'react';
import { api, messageFor } from '../lib/api.js';
import { Banner, Modal, Spinner, useToast } from './ui.jsx';

const megabytes = (bytes) => (Number(bytes || 0) / (1024 * 1024)).toFixed(1);

/**
 * The first time an installed copy opens and finds it is not the newest.
 *
 * A package sent out a few versions ago is what most first installs will be,
 * so the first launch says so plainly and offers the current one - rather than
 * a small flag in the corner that he may not notice for weeks.
 *
 * It downloads; it does not install. These builds are not signed with an
 * Apple Developer ID, so macOS will not let an app replace itself, and this
 * app never runs what it downloads - so the last step, dragging the new copy
 * into Applications, is his. The prompt says exactly what that step is.
 */
export default function FirstRunUpdate({ update, platform, onClose }) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [saved, setSaved] = useState(null);
  const toast = useToast();

  useEffect(() => api.updates.onProgress(setProgress), []);

  async function download() {
    setDownloading(true);
    setProgress(null);
    try {
      setSaved(await api.updates.fetch());
    } catch (err) {
      toast(messageFor(err), 'err');
    } finally {
      setDownloading(false);
    }
  }

  const mac = platform === 'darwin';

  return (
    <Modal title="A newer version is available" onClose={onClose}>
      <div className="stack">
        <p style={{ margin: 0 }}>
          This copy is version <strong>{update.current}</strong>. The current version is{' '}
          <strong>{update.version}</strong>.
        </p>

        {update.notes && (
          <div className="note" style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflowY: 'auto' }}>
            {update.notes}
          </div>
        )}

        {progress && !saved && (
          <div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${progress.total ? Math.min(100, (progress.bytes / progress.total) * 100) : 0}%` }}
              />
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              {megabytes(progress.bytes)} of {progress.total ? megabytes(progress.total) : '?'} MB
            </div>
          </div>
        )}

        {saved ? (
          <Banner kind="ok">
            <div>
              Saved to your Downloads folder as <span className="mono">{saved.name}</span>.
              <div style={{ marginTop: 8 }}>
                {mac
                  ? 'Quit GD Suits Studio, open that file, and drag the app into Applications - replacing this one when asked.'
                  : 'Quit GD Suits Studio, then open that file and follow the installer.'}
              </div>
              <div className="small" style={{ marginTop: 6, opacity: .85 }}>
                Your orders, clients, photographs and measurements are kept separately and are not touched.
              </div>
            </div>
          </Banner>
        ) : !update.canDownload ? (
          <Banner kind="info">
            This release has no file for this machine that the app will download. The release page has it.
          </Banner>
        ) : null}

        <div className="inline">
          {!saved && update.canDownload && (
            <button className="btn btn-gold" onClick={download} disabled={downloading}>
              {downloading ? <><Spinner /> Downloading...</> : `Download ${update.version}`}
            </button>
          )}
          {saved && (
            <button
              className="btn btn-gold"
              onClick={async () => {
                try { await api.updates.reveal(); } catch (err) { toast(messageFor(err), 'err'); }
              }}
            >
              {mac ? 'Show in Finder' : 'Show in folder'}
            </button>
          )}
          {!saved && !update.canDownload && update.pageUrl && (
            <button className="btn btn-gold" onClick={() => api.updates.download({ url: update.pageUrl })}>
              Open the release page
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose} disabled={downloading}>
            {saved ? 'Done' : 'Later'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
