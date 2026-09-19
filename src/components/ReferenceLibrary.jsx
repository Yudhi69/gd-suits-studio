import React, { useRef, useState } from 'react';
import { api, clientMedia } from '../lib/api.js';
import { fileToDataUrl, imageFileFrom } from '../lib/image.js';
import { ConfirmButton, Empty, Modal, useToast, DebouncedInput } from './ui.jsx';
import DownloadButton from './DownloadButton.jsx';

const KINDS = [
  { key: 'style', label: 'Style' },
  { key: 'fabric', label: 'Fabric' },
  { key: 'lining', label: 'Lining' },
  { key: 'fit', label: 'Fit' },
];

/**
 * The client's reference images.
 *
 * These belong to the *client*, not to one order: a returning client's taste
 * is the most useful thing a tailor can carry forward, so references outlive
 * the suit they were gathered for and can be attached to any future render.
 */
export default function ReferenceLibrary({
  clientId,
  projectId,
  references,
  onChanged,
  selectable = false,
  selected = [],
  onToggleSelect,
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all');
  const toast = useToast();

  const shown = filter === 'all' ? references : references.filter((r) => r.kind === filter);

  async function addFiles(files) {
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    setBusy(true);
    try {
      for (const file of images) {
        const { dataUrl } = await fileToDataUrl(file);
        await api.references.add({
          clientId,
          projectId,
          dataUrl,
          kind: 'style',
          title: file.name.replace(/\.[^.]+$/, '').slice(0, 60),
        });
      }
      await onChanged();
      toast(`${images.length} reference${images.length === 1 ? '' : 's'} added`, 'ok');
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="stack"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
      onPaste={(e) => { const f = imageFileFrom(e); if (f) addFiles([f]); }}
    >
      <div className="inline">
        <div className="stepper" style={{ flex: 1 }}>
          <button className={`step-tab ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
            All <span className="num">{references.length}</span>
          </button>
          {KINDS.map((k) => {
            const n = references.filter((r) => r.kind === k.key).length;
            return (
              <button key={k.key} className={`step-tab ${filter === k.key ? 'active' : ''}`} onClick={() => setFilter(k.key)}>
                {k.label} <span className="num">{n}</span>
              </button>
            );
          })}
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? 'Adding...' : 'Add references'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {shown.length === 0 ? (
        <Empty title="No reference images yet">
          Drop in the pictures the client brings - a lapel they like, a colour, a photo off a phone.
          They stay on the client's file and can be fed into any future render.
        </Empty>
      ) : (
        <div className="grid grid-4">
          {shown.map((ref) => {
            const picked = selected.includes(ref.id);
            return (
              <div key={ref.id} className={`ref-card ${picked ? 'picked' : ''}`}>
                <div
                  className="ref-thumb"
                  onClick={() => (selectable ? onToggleSelect(ref.id) : setEditing(ref))}
                  title={selectable ? 'Use in the next render' : 'Edit details'}
                >
                  <img src={clientMedia(clientId, ref.filename)} alt={ref.title || 'Reference'} />
                  <DownloadButton chip src={clientMedia(clientId, ref.filename)} name={ref.title || 'reference'} />
                </div>
                {ref.times_used > 0 && <div className="ref-badge">used {ref.times_used}x</div>}
                <button
                  className={`ref-star ${ref.favourite ? 'on' : ''}`}
                  title={ref.favourite ? 'Unpin' : 'Pin as a favourite'}
                  onClick={async () => {
                    await api.references.update({ id: ref.id, favourite: !ref.favourite });
                    onChanged();
                  }}
                >
                  ★
                </button>
                <div className="ref-body">
                  <div className="small" style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {ref.title || 'Untitled'}
                  </div>
                  <div className="tiny faint">{KINDS.find((k) => k.key === ref.kind)?.label ?? ref.kind}</div>
                  {selectable && (
                    <button
                      className={`btn btn-sm ${picked ? 'btn-gold' : ''}`}
                      style={{ width: '100%', marginTop: 7 }}
                      onClick={() => onToggleSelect(ref.id)}
                    >
                      {picked ? 'In this render' : 'Use'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <Modal
          title="Reference details"
          onClose={() => setEditing(null)}
          footer={
            <>
              <ConfirmButton
                className="btn btn-danger"
                confirmLabel="Delete for good?"
                onConfirm={async () => {
                  await api.references.delete({ id: editing.id });
                  setEditing(null);
                  onChanged();
                }}
              >
                Delete
              </ConfirmButton>
              <div className="spacer" />
              <button className="btn btn-primary" onClick={() => setEditing(null)}>Done</button>
            </>
          }
        >
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <img
              src={clientMedia(clientId, editing.filename)}
              alt=""
              style={{ maxWidth: 220, borderRadius: 10, border: '1px solid var(--line)' }}
            />
            <DownloadButton src={clientMedia(clientId, editing.filename)} name={editing.title || 'reference'} className="btn-sm" />
            <div style={{ flex: 2 }}>
              <div className="field">
                <label>Title</label>
                <DebouncedInput
                  className="input"
                  value={editing.title}
                  onCommit={async (v) => {
                    await api.references.update({ id: editing.id, title: v });
                    setEditing({ ...editing, title: v });
                    onChanged();
                  }}
                />
              </div>
              <div className="field">
                <label>Kind</label>
                <select
                  className="select"
                  value={editing.kind}
                  onChange={async (e) => {
                    await api.references.update({ id: editing.id, kind: e.target.value });
                    setEditing({ ...editing, kind: e.target.value });
                    onChanged();
                  }}
                >
                  {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Tags</label>
                <DebouncedInput
                  className="input"
                  placeholder="peak lapel, navy, slim"
                  value={editing.tags}
                  onCommit={async (v) => {
                    await api.references.update({ id: editing.id, tags: v });
                    setEditing({ ...editing, tags: v });
                    onChanged();
                  }}
                />
                <div className="hint">Tags are what makes the style history searchable later.</div>
              </div>
              <div className="field">
                <label>Notes</label>
                <DebouncedInput
                  as="textarea"
                  className="textarea"
                  value={editing.notes}
                  onCommit={async (v) => {
                    await api.references.update({ id: editing.id, notes: v });
                    setEditing({ ...editing, notes: v });
                    onChanged();
                  }}
                />
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
