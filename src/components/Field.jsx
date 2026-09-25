import React, { useRef, useState } from 'react';
import { Switch, DebouncedInput } from './ui.jsx';
import ColourPicker from './ColourPicker.jsx';
import { AddOptionTile, OptionEditor } from './AddOption.jsx';
import { fileToDataUrl } from '../lib/image.js';
import { useToast, ConfirmButton } from './ui.jsx';
import DownloadButton from './DownloadButton.jsx';
import { formatMoney } from '../lib/pricing.js';
import { sketchFor } from './sketches.jsx';

/**
 * Renders one catalog field. Every control in the builder comes through here,
 * so adding an option to `catalog.js` is all it takes to extend the flow.
 */
export default function Field({ field, spec, overrides = {}, onChange, onCatalogChanged, media }) {
  const [editingOption, setEditingOption] = useState(null);
  const value = spec[field.id];

  const priceFor = (opt) => {
    const key = `${field.id}:${opt.key}`;
    const base = typeof opt.basePrice === 'number' ? opt.basePrice : opt.price ?? 0;
    const amount = typeof overrides[key] === 'number' ? overrides[key] : base;
    return amount;
  };

  if (field.type === 'choice') {
    return (
      <div className="field">
        <label>{field.label}</label>
        <div className="options">
          {field.options.map((opt) => {
            const amount = priceFor(opt);
            const Sketch = sketchFor(field.id, opt.key);
            return (
              <button
                key={opt.key}
                type="button"
                className={`option ${value === opt.key ? 'selected' : ''}`}
                onClick={() => onChange(field.id, value === opt.key && !field.required ? undefined : opt.key)}
              >
                {Sketch && <Sketch />}
                <div className="option-label">{opt.label}</div>
                {opt.desc && <div className="option-desc">{opt.desc}</div>}
                {amount > 0 && (
                  <div className="option-price">
                    {typeof opt.basePrice === 'number' ? '' : '+'}{formatMoney(amount)}
                  </div>
                )}
                {opt.custom && (
                  <span
                    className="option-edit"
                    role="button"
                    tabIndex={0}
                    title="Edit this option"
                    onClick={(e) => { e.stopPropagation(); setEditingOption(opt); }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), setEditingOption(opt))}
                  >
                    edit
                  </span>
                )}
              </button>
            );
          })}
          {onCatalogChanged && (
            <AddOptionTile fieldId={field.id} fieldLabel={field.label} onAdded={onCatalogChanged} />
          )}
        </div>

        {editingOption && (
          <OptionEditor
            fieldId={field.id}
            fieldLabel={field.label}
            existing={{
              id: editingOption.optionId,
              label: editingOption.label,
              price: editingOption.price,
              description: editingOption.desc,
              prompt: editingOption.promptText,
            }}
            onClose={() => setEditingOption(null)}
            onSaved={() => { setEditingOption(null); onCatalogChanged?.(); }}
          />
        )}
      </div>
    );
  }

  if (field.type === 'toggle') {
    return (
      <div className="field">
        <div className="toggle-row">
          <div>
            <div style={{ fontWeight: 600 }}>{field.label}</div>
            {field.price > 0 && <div className="tiny faint">+{formatMoney(overrides[field.id] ?? field.price)}</div>}
          </div>
          <Switch checked={!!value} onChange={(v) => onChange(field.id, v)} />
        </div>
      </div>
    );
  }

  // Several answers at once - waistband extras, the places a monogram goes.
  // Stored as an array of option keys, in the order the catalogue lists them
  // so the spec sheet and the prompt read the same way every time.
  if (field.type === 'multi') {
    const chosen = Array.isArray(value) ? value : [];
    const toggle = (key) =>
      onChange(field.id, field.options.filter((o) => (o.key === key ? !chosen.includes(key) : chosen.includes(o.key))).map((o) => o.key));
    return (
      <div className="field">
        <label>{field.label}</label>
        {field.hint && <div className="hint" style={{ marginTop: -2 }}>{field.hint}</div>}
        {/* The same grid every single-choice field uses. It was "option-grid",
            a class with no style behind it, so each tile sized itself to its own
            words - five widths in one row, and "Other" taller than the rest
            because it is the only one with a second line. */}
        <div className="options options-even" style={{ marginTop: 8 }}>
          {field.options.map((opt) => (
            <button
              type="button"
              key={opt.key}
              className={`option ${chosen.includes(opt.key) ? 'selected' : ''}`}
              onClick={() => toggle(opt.key)}
              aria-pressed={chosen.includes(opt.key)}
            >
              <div className="option-label">{opt.label}</div>
              {opt.desc && <div className="option-desc">{opt.desc}</div>}
              {opt.price > 0 && <div className="option-price">+{formatMoney(overrides[`${field.id}:${opt.key}`] ?? opt.price)}</div>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // A short answer - a material code, a size. Distinct from longtext, which is
  // a paragraph and gets a textarea.
  if (field.type === 'text') {
    return (
      <div className="field">
        <label>{field.label}</label>
        {field.hint && <div className="hint" style={{ marginTop: -2 }}>{field.hint}</div>}
        <DebouncedInput
          className={`input ${field.mono ? 'mono' : ''}`}
          placeholder={field.placeholder ?? ''}
          value={value ?? ''}
          onCommit={(v) => onChange(field.id, v)}
        />
      </div>
    );
  }

  if (field.type === 'images') {
    return <ImageField field={field} media={media} />;
  }

  if (field.type === 'colour') {
    return <ColourField field={field} value={value} onChange={onChange} />;
  }

  if (field.type === 'number') {
    return (
      <div className="field">
        <label>{field.label}</label>
        <DebouncedInput
          type="number"
          className="input"
          style={{ maxWidth: 160 }}
          step={field.step}
          min={field.min}
          max={field.max}
          value={value ?? ''}
          onCommit={(v) => onChange(field.id, v === '' ? undefined : Number(v))}
        />
      </div>
    );
  }

  if (field.type === 'longtext') {
    return (
      <div className="field">
        <label>{field.label}</label>
        <DebouncedInput
          as="textarea"
          className="textarea"
          placeholder={field.placeholder}
          value={value ?? ''}
          onCommit={(v) => onChange(field.id, v)}
        />
      </div>
    );
  }

  return (
    <div className="field">
      <label>
        {field.label}
        {field.price > 0 && <span className="faint" style={{ fontWeight: 400 }}> - +{formatMoney(overrides[field.id] ?? field.price)} when filled</span>}
      </label>
      <DebouncedInput
        className="input"
        placeholder={field.placeholder}
        maxLength={field.maxLength}
        value={value ?? ''}
        onCommit={(v) => onChange(field.id, v)}
      />
    </div>
  );
}


/**
 * A colour field opens the wheel in place rather than in a dialog - picking a
 * lining colour is a small decision and should not take over the screen.
 */
function ColourField({ field, value, onChange }) {
  const [open, setOpen] = useState(false);
  const current = value ?? field.default ?? '#000000';

  return (
    <div className="field">
      <label>{field.label}</label>
      <button type="button" className="colour-trigger" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="swatch" style={{ background: current }} />
        <span className="mono">{current}</span>
        <span className="tiny faint" style={{ marginLeft: 'auto' }}>{open ? 'Done' : 'Change'}</span>
      </button>
      {open && (
        <div className="colour-panel">
          <ColourPicker label={field.id} value={current} onChange={(v) => onChange(field.id, v)} />
        </div>
      )}
    </div>
  );
}


/**
 * A set of images attached to the order rather than a value on the spec - the
 * lining collage is artwork, not a choice. Several can be added, because a
 * collage is usually assembled from more than one picture.
 */
function ImageField({ field, media }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  if (!media) return null;
  const images = media.photosFor(field.slot);

  async function add(files) {
    const picked = [...files].filter((f) => f.type.startsWith('image/'));
    if (!picked.length) return;
    setBusy(true);
    try {
      for (const file of picked) {
        const { dataUrl, width, height } = await fileToDataUrl(file);
        await media.add({ slot: field.slot, dataUrl, meta: { width, height } });
      }
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <label>{field.label}</label>
      {field.hint && <div className="hint" style={{ marginTop: -2 }}>{field.hint}</div>}

      <div
        className="swatch-row"
        style={{ marginTop: 8 }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}
      >
        {images.map((photo) => (
          <div key={photo.id} style={{ position: 'relative' }}>
            <img
              src={media.urlFor(photo.filename)}
              alt=""
              style={{ width: 92, height: 92, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }}
            />
            <DownloadButton chip src={media.urlFor(photo.filename)} name={field.label} />
            <ConfirmButton
              className="ref-star"
              confirmLabel="!"
              onConfirm={() => media.remove(photo.id)}
            >
              x
            </ConfirmButton>
          </div>
        ))}

        <button
          type="button"
          className="btn"
          style={{ width: 92, height: 92, display: 'grid', placeItems: 'center' }}
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? '...' : '+'}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => { add(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}
