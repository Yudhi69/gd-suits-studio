import React, { useState } from 'react';
import { ConfirmButton, useToast } from './ui.jsx';

/**
 * Tailor notes, captured at every step of the process. The brief asks for the
 * maker's own comments to be stored alongside the spec at each stage, so this
 * panel is mounted on every screen and always writes against the current step.
 */
export default function NotesPanel({ step, notes = [], onAdd, onDelete, compact }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const forStep = notes.filter((n) => n.step === step);

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    try {
      await onAdd(body);
      setDraft('');
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>Notes</h3>
        <div className="spacer" />
        <span className="pill pill-quiet">{forStep.length}</span>
      </div>
      <div className="card-pad">
        <textarea
          className="textarea"
          placeholder={`What did the client say at this step? Anything to remember when cutting?`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
          }}
          style={compact ? { minHeight: 60 } : undefined}
        />
        <div className="inline" style={{ marginTop: 8, justifyContent: 'space-between' }}>
          <span className="tiny faint">Cmd/Ctrl + Enter to save</span>
          <button className="btn btn-sm btn-primary" onClick={submit} disabled={busy || !draft.trim()}>
            Add note
          </button>
        </div>

        {forStep.length > 0 && (
          <div style={{ marginTop: 14 }}>
            {forStep.map((n) => (
              <div key={n.id} className="note">
                <div className="note-head">
                  <span className="tiny faint">{n.created_at}</span>
                  <div style={{ flex: 1 }} />
                  <ConfirmButton className="btn btn-sm btn-ghost btn-danger" onConfirm={() => onDelete(n.id)} confirmLabel="Delete?">
                    Remove
                  </ConfirmButton>
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
