import React, { useState } from 'react';
import { api, messageFor } from '../lib/api.js';
import { CURRENCY } from '../lib/catalog.js';
import { Modal, ConfirmButton, useToast } from './ui.jsx';

/**
 * Adds one more choice to a selector that already exists.
 *
 * A shop's list is never quite the built-in list - there is always a house
 * lapel, a local event, a cloth finish nobody else offers. Rather than making
 * the tailor go to Settings and back, the option is added where it is missed,
 * and is available on every order from then on.
 */
export function AddOptionTile({ fieldId, fieldLabel, onAdded, compact }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`option option-add ${compact ? 'option-add-compact' : ''}`}
        onClick={() => setOpen(true)}
        title={`Add another ${fieldLabel.toLowerCase()} option`}
      >
        <span className="option-add-plus">+</span>
        <span className="option-label">Add option</span>
      </button>

      {open && (
        <OptionEditor
          fieldId={fieldId}
          fieldLabel={fieldLabel}
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); onAdded?.(); }}
        />
      )}
    </>
  );
}

export function OptionEditor({ fieldId, fieldLabel, existing, onClose, onSaved }) {
  const [form, setForm] = useState({
    label: existing?.label ?? '',
    price: existing?.price ?? '',
    description: existing?.description ?? '',
    prompt: existing?.prompt ?? '',
  });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function save() {
    if (!form.label.trim()) { toast('Give the option a name.', 'err'); return; }
    setBusy(true);
    try {
      const payload = {
        label: form.label.trim(),
        price: Number(form.price) || 0,
        description: form.description.trim(),
        prompt: form.prompt.trim(),
      };
      if (existing) await api.catalog.updateOption({ id: existing.id, ...payload });
      else await api.catalog.addOption({ fieldId, ...payload });
      onSaved();
    } catch (err) {
      toast(messageFor(err), 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={existing ? `Edit "${existing.label}"` : `Add a ${fieldLabel.toLowerCase()} option`}
      onClose={onClose}
      footer={
        <>
          {existing && (
            <ConfirmButton
              className="btn btn-danger"
              confirmLabel="Delete for good?"
              onConfirm={async () => { await api.catalog.deleteOption({ id: existing.id }); onSaved(); }}
            >
              Delete
            </ConfirmButton>
          )}
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save option'}</button>
        </>
      }
    >
      <div className="field">
        <label>Name</label>
        <input className="input" autoFocus value={form.label} placeholder={`Another ${fieldLabel.toLowerCase()}`}
          onChange={(e) => setForm({ ...form, label: e.target.value })} />
      </div>

      <div className="field">
        <label>Extra cost ({CURRENCY})</label>
        <input type="number" className="input" style={{ maxWidth: 180 }} value={form.price} placeholder="0"
          onChange={(e) => setForm({ ...form, price: e.target.value })} />
        <div className="hint">Added to the quote when this option is chosen. Leave at 0 if it costs the same.</div>
      </div>

      <div className="field">
        <label>Short note <span className="faint" style={{ fontWeight: 400 }}>(optional)</span></label>
        <input className="input" value={form.description} placeholder="Shown under the name"
          onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label>How should the AI draw it? <span className="faint" style={{ fontWeight: 400 }}>(optional)</span></label>
        <input className="input" value={form.prompt} placeholder="a bespoke cravat-notch lapel"
          onChange={(e) => setForm({ ...form, prompt: e.target.value })} />
        <div className="hint">
          Wording added to the render prompt when this option is chosen. Leave blank to use the name.
        </div>
      </div>
    </Modal>
  );
}
