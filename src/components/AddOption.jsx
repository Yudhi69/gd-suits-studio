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

/**
 * GD's own words - and price - for a built-in option or switch, edited where
 * it is chosen rather than in Settings.
 *
 * It writes the same two lists the Settings price list does, under the same
 * keys, so a change made here shows there too. Only the words and the figure
 * change: the option's key, and so every order that already chose it, stays
 * as it was, and an agreed quote keeps its figures. Both lists are read fresh
 * before they are written, so an edit made in Settings meanwhile is not lost.
 */
export function BuiltInEditor({ field, option = null, overrides = {}, onClose, onSaved, onPricesChanged }) {
  const key = option ? `${field.id}:${option.key}` : field.id;
  const shown = option ?? field;
  const isBase = typeof option?.basePrice === 'number';
  const defaultPrice = option ? (isBase ? option.basePrice : option.price ?? 0) : field.price ?? 0;
  // A quality is priced by suit type, in its own grid in Settings; a switch
  // that costs nothing has no price to edit.
  const priced = !field.priceGrid && (!!option || field.price > 0);
  const [form, setForm] = useState({
    label: shown.label ?? '',
    desc: shown.desc ?? '',
    price: typeof overrides[key] === 'number' ? String(overrides[key]) : '',
  });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function write(change) {
    setBusy(true);
    try {
      await change();
      onSaved();
    } catch (err) {
      toast(messageFor(err), 'err');
    } finally {
      setBusy(false);
    }
  }

  const save = () => write(async () => {
    const label = form.label.trim();
    const desc = form.desc.trim();
    const price = String(form.price).trim();
    if (price !== '' && !(Number.isFinite(Number(price)) && Number(price) >= 0)) {
      throw new Error('The price has to be a number of rand, 0 or more.');
    }
    if (label !== (shown.label ?? '') || desc !== (shown.desc ?? '')) {
      const labels = { ...((await api.settings.get({ key: 'labelOverrides', fallback: {} })) ?? {}) };
      if (!label) delete labels[key];
      else labels[key] = { label, desc };
      await api.settings.set({ key: 'labelOverrides', value: labels });
    }
    const was = typeof overrides[key] === 'number' ? String(overrides[key]) : '';
    if (priced && price !== was) {
      const prices = { ...((await api.settings.get({ key: 'priceOverrides', fallback: {} })) ?? {}) };
      if (price === '') delete prices[key];
      else prices[key] = Number(price);
      await api.settings.set({ key: 'priceOverrides', value: prices });
      onPricesChanged?.(prices);
    }
  });

  const restore = () => write(async () => {
    const labels = { ...((await api.settings.get({ key: 'labelOverrides', fallback: {} })) ?? {}) };
    delete labels[key];
    await api.settings.set({ key: 'labelOverrides', value: labels });
  });

  return (
    <Modal
      title={`Edit "${shown.label}"`}
      onClose={onClose}
      footer={
        <>
          {shown.renamed && (
            <button className="btn btn-ghost" onClick={restore} disabled={busy}>Use the built-in wording</button>
          )}
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="builtin-name">Name</label>
        <input id="builtin-name" className="input" autoFocus value={form.label} maxLength={120}
          onChange={(e) => setForm({ ...form, label: e.target.value })} />
      </div>

      <div className="field">
        <label htmlFor="builtin-note">Short note <span className="faint" style={{ fontWeight: 400 }}>(optional)</span></label>
        <input id="builtin-note" className="input" value={form.desc} maxLength={200} placeholder="Shown under the name"
          onChange={(e) => setForm({ ...form, desc: e.target.value })} />
      </div>

      {priced ? (
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="builtin-price">{isBase ? 'Price' : 'Extra cost'} ({CURRENCY})</label>
          <input id="builtin-price" type="number" min="0" className="input" style={{ maxWidth: 180 }}
            value={form.price} placeholder={String(defaultPrice)}
            onChange={(e) => setForm({ ...form, price: e.target.value })} />
          <div className="hint">
            Leave blank for the built-in {CURRENCY}{defaultPrice}. The same figure as in Settings &gt; Price list:
            every order not yet agreed is re-priced; an agreed quote keeps its figures.
            {isBase && ' This is the price with no material quality chosen - each quality has its own, in the grid there.'}
          </div>
        </div>
      ) : field.priceGrid && (
        <p className="hint" style={{ marginBottom: 0 }}>
          A quality is priced by suit type, in Settings &gt; Price list.
        </p>
      )}

      <p className="tiny faint" style={{ marginBottom: 0 }}>
        Only the words change - every order that already chose this keeps it.
      </p>
    </Modal>
  );
}
