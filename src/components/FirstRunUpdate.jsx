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
 * One of this app's own releases installs itself: Install, then Restart now
 * (or Later, and it goes in when he quits). Anything else - a custom update
 * address, a copy that cannot be replaced from where it is - is downloaded
 * for him to install by hand, and the prompt says exactly what that step is.
 */
export default function FirstRunUpdate({ update, platform, onClose, onReady }) {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [saved, setSaved] = useState(null);
  const [ready, setReady] = useState(!!update.ready);
  const toast = useToast();

  useEffect(() => api.updates.onProgress(setProgress), []);

  async function install() {
    setDownloading(true);
    setProgress(null);
    try {
      await api.updates.install();
      setReady(true);
      onReady?.();
    } catch (err) {
      toast(messageFor(err), 'err');
    } finally {
      setProgress(null);
      setDownloading(false);
    }
  }

  async function restart() {
    try {
      await api.updates.restart();
    } catch (err) {
      toast(messageFor(err), 'err');
    }
  }

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

        {progress && !saved && !ready && (
          <div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${progress.total ? Math.min(100, (progress.bytes / progress.total) * 100) : 0}%` }}
              />
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>
              {progress.phase === 'preparing'
                ? 'Downloaded and checked - getting it ready...'
                : `${megabytes(progress.bytes)} of ${progress.total ? megabytes(progress.total) : '?'} MB`}
            </div>
          </div>
        )}

        {update.canInstall ? (
          <Banner kind={ready ? 'ok' : 'info'}>
            <div>
              {ready
                ? 'Ready. Restart now to finish - or choose Later, and it goes in the next time you quit.'
                : 'Install downloads the new version, checks it, and puts it in place of this copy. There is nothing else to do.'}
              <div className="small" style={{ marginTop: 6, opacity: .85 }}>
                Your orders, clients, photographs and measurements are kept separately and are not touched.
                {mac && ' After the update your Mac may ask for your password once, so the new version can read your saved keys - choose Always Allow.'}
              </div>
            </div>
          </Banner>
        ) : saved ? (
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

        {!update.canInstall && update.installBlocked && (
          <div className="small faint">Why it does not install itself: {update.installBlocked}</div>
        )}

        <div className="inline">
          {update.canInstall && !ready && (
            <button className="btn btn-gold" onClick={install} disabled={downloading}>
              {downloading ? <><Spinner /> Installing...</> : `Install ${update.version}`}
            </button>
          )}
          {update.canInstall && ready && (
            <button className="btn btn-gold" onClick={restart}>Restart now</button>
          )}
          {!update.canInstall && !saved && update.canDownload && (
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
          {!update.canInstall && !saved && !update.canDownload && update.pageUrl && (
            <button className="btn btn-gold" onClick={() => api.updates.download({ url: update.pageUrl })}>
              Open the release page
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose} disabled={downloading}>
            {saved && !update.canInstall ? 'Done' : 'Later'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
