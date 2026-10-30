import React, { useRef, useState } from 'react';
import { Switch, DebouncedInput } from './ui.jsx';
import { AddOptionTile, OptionEditor, BuiltInEditor } from './AddOption.jsx';
import { fileToDataUrl } from '../lib/image.js';
import { useToast, ConfirmButton } from './ui.jsx';
import DownloadButton from './DownloadButton.jsx';
import PhotoSlot from './PhotoSlot.jsx';
import { fieldFigure, formatMoney, isPricedField, suitPrice } from '../lib/pricing.js';
import { sketchFor } from './sketches.jsx';
import { colourWords } from '../lib/catalog.js';

/**
 * The options a field offers. One GD has taken off the list is not offered
 * again, but an order that already chose it still shows it, chosen - hiding it
 * there would make the suit look unspecified when it is not.
 */
const offered = (options = [], value) =>
  options.filter((o) => !o.retired || (Array.isArray(value) ? value.includes(o.key) : value === o.key));

/**
 * Renders one catalog field. Every control in the builder comes through here,
 * so adding an option to `catalog.js` is all it takes to extend the flow.
 */
export default function Field({ field, spec, overrides = {}, onChange, onCatalogChanged, onOverridesChanged, media, quality = null, suitOpt = null }) {
  const [editing, setEditing] = useState(null);
  const value = spec[field.id];

  const priceFor = (opt) => {
    const key = `${field.id}:${opt.key}`;
    // A suit type has no price of its own - its quality sets it.
    if (opt.base) return 0;
    const amount = typeof overrides[key] === 'number' ? overrides[key] : opt.price ?? 0;
    return amount;
  };

  // Every preset can be reworded where it is chosen. One added in the builder
  // is edited as it was added; a built-in one keeps its key and gets GD's own
  // words over it. A whole item made in Settings is edited there, with its
  // options, so it has no button here.
  const editable = (opt) => !!onCatalogChanged && (opt?.custom || !field.custom);
  const EditButton = ({ opt = null, inline = false }) => (
    <span
      className={`option-edit ${inline ? 'option-edit-inline' : ''}`}
      role="button"
      tabIndex={0}
      title={opt ? 'Edit this option' : 'Edit this switch'}
      aria-label={`Edit ${(opt ?? field).label}`}
      onClick={(e) => { e.stopPropagation(); setEditing({ opt }); }}
      onKeyDown={(e) => e.key === 'Enter' && (e.stopPropagation(), e.preventDefault(), setEditing({ opt }))}
    >
      edit
    </span>
  );

  const editor = editing && (editing.opt?.custom ? (
    <OptionEditor
      fieldId={field.id}
      fieldLabel={field.label}
      existing={{
        id: editing.opt.optionId,
        label: editing.opt.label,
        price: editing.opt.price,
        description: editing.opt.desc,
        prompt: editing.opt.promptText,
      }}
      onClose={() => setEditing(null)}
      onSaved={() => { setEditing(null); onCatalogChanged?.(); }}
    />
  ) : (
    <BuiltInEditor
      field={field}
      option={editing.opt}
      overrides={overrides}
      onClose={() => setEditing(null)}
      onSaved={() => { setEditing(null); onCatalogChanged?.(); }}
      onPricesChanged={onOverridesChanged}
    />
  ));

  if (field.type === 'choice') {
    return (
      <div className="field">
        <label>{field.label}</label>
        <div className="options">
          {offered(field.options, value).map((opt) => {
            const Sketch = sketchFor(field.id, opt.key);
            const price = tilePrice(field, opt, { quality, suitOpt, overrides, amount: priceFor(opt) });
            return (
              <button
                key={opt.key}
                type="button"
                className={`option ${value === opt.key ? 'selected' : ''}`}
                onClick={() => onChange(field.id, value === opt.key && !field.required ? undefined : opt.key)}
              >
                {Sketch && <Sketch spec={spec} />}
                <div className="option-label">{opt.label}</div>
                {opt.retired
                  ? <div className="option-desc">No longer offered</div>
                  : opt.desc && <div className="option-desc">{opt.desc}</div>}
                {price}
                {editable(opt) && <EditButton opt={opt} />}
              </button>
            );
          })}
          {onCatalogChanged && (
            <AddOptionTile fieldId={field.id} fieldLabel={field.label} onAdded={onCatalogChanged} />
          )}
        </div>
        {editor}
      </div>
    );
  }

  if (field.type === 'toggle') {
    const Sketch = sketchFor(field.id);
    return (
      <div className="field">
        <div className={`toggle-row ${value ? 'on' : ''}`}>
          {Sketch && <Sketch spec={spec} />}
          <div style={{ flex: 1 }}>
            {/* The words switch it too, not only the small switch beside them. */}
            <label htmlFor={`toggle-${field.id}`} style={{ fontWeight: 600, cursor: 'pointer', margin: 0 }}>{field.label}</label>
            {field.desc && <div className="tiny faint">{field.desc}</div>}
            <FieldPrice field={field} overrides={overrides}>
              {(amount) => <div className="tiny faint">{amount === null ? 'No price yet' : `${field.from ? 'From ' : '+'}${formatMoney(amount)}`}</div>}
            </FieldPrice>
          </div>
          {editable(null) && <EditButton inline />}
          <Switch id={`toggle-${field.id}`} checked={!!value} onChange={(v) => onChange(field.id, v)} />
        </div>
        {editor}
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
          {offered(field.options, chosen).map((opt) => (
            <button
              type="button"
              key={opt.key}
              className={`option ${chosen.includes(opt.key) ? 'selected' : ''}`}
              onClick={() => toggle(opt.key)}
              aria-pressed={chosen.includes(opt.key)}
            >
              <div className="option-label">{opt.label}</div>
              {opt.desc && <div className="option-desc">{opt.desc}</div>}
              {priceFor(opt) > 0 && <div className="option-price">+{formatMoney(priceFor(opt))}</div>}
              {editable(opt) && <EditButton opt={opt} />}
            </button>
          ))}
        </div>
        {editor}
      </div>
    );
  }

  // A short answer - a material code, a size, a colour in words. Distinct from
  // longtext, which is a paragraph and gets a textarea.
  if (field.type === 'text') {
    // A colour from an order taken while colours came off a wheel is a code
    // like #7b1113; it is still the client's choice, so it is said in words
    // beside the box rather than left as a code nobody can read.
    const fromWheel = field.colourText && /^#[0-9a-f]{6}$/i.test(String(value ?? '').trim());
    return (
      <div className="field">
        <label>{field.label}</label>
        {field.hint && <div className="hint" style={{ marginTop: -2 }}>{field.hint}</div>}
        <DebouncedInput
          className={`input ${field.mono ? 'mono' : ''}`}
          placeholder={field.placeholder ?? ''}
          maxLength={field.maxLength}
          value={value ?? ''}
          onCommit={(v) => onChange(field.id, v)}
        />
        {fromWheel && (
          <div className="hint">Picked on the old colour wheel: {colourWords(value)}. Type the colour in words to replace it.</div>
        )}
      </div>
    );
  }

  if (field.type === 'images') {
    return <ImageField field={field} media={media} />;
  }

  if (field.type === 'photo') {
    return <SinglePhotoField field={field} media={media} />;
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
        <FieldPrice field={field} overrides={overrides}>
          {(amount) => <span className="faint" style={{ fontWeight: 400 }}> - {amount === null ? 'no price yet' : `+${formatMoney(amount)} when filled`}</span>}
        </FieldPrice>
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
 * A toggle or text field's price, shown by `children` as the shop has it -
 * its own figure, or null when it is sold on its own and has none yet. One
 * that costs nothing shows nothing.
 */
function FieldPrice({ field, overrides, children }) {
  if (!isPricedField(field)) return null;
  const amount = fieldFigure(field, overrides);
  if (amount !== null && !(amount > 0)) return null;
  return children(amount);
}

/**
 * The figure on a choice tile.
 *
 * A suit type is shown at its price in the quality chosen, and with none
 * chosen has no figure: the quality sets it. A quality is shown at the price
 * of the suit type chosen, since that is what picking it would cost. A pair
 * the shop has not priced yet says so rather than showing a figure the client could
 * take as agreed, and one priced as a range shows all of it.
 */
const figure = (price) => (price.upTo ? `${formatMoney(price.amount)} - ${formatMoney(price.upTo)}` : formatMoney(price.amount));

function tilePrice(field, opt, { quality, suitOpt, overrides, amount }) {
  if (opt.base && field.id === 'suitType') {
    if (!quality) return null;
    const price = suitPrice(opt, quality, overrides);
    return (
      <div className="option-price">
        {price.unpriced ? <span className="faint">Price to confirm</span> : figure(price)}
      </div>
    );
  }
  if (field.priceGrid) {
    if (!suitOpt) return null;
    const price = suitPrice(suitOpt, opt, overrides);
    return (
      <div className="option-price">
        {price.unpriced ? <span className="faint">Price to confirm</span> : `${suitOpt.label} ${figure(price)}`}
        {amount > 0 && ` +${formatMoney(amount)}`}
      </div>
    );
  }
  if (!(amount > 0)) return null;
  return <div className="option-price">+{formatMoney(amount)}</div>;
}

/**
 * A set of images attached to the order rather than a value on the spec - the
 * lining collage is artwork, not a choice. Several can be added, because a
 * collage is usually assembled from more than one picture.
 */
/**
 * One photograph that stands for something in the render - the shoes. The
 * same card the Capture and Cloth steps use, camera included, because it is
 * the same job: take one picture, and take it again if it is wrong.
 */
function SinglePhotoField({ field, media }) {
  if (!media?.photoFor) return null;
  const photo = media.photoFor(field.slot);
  return (
    <div className="field">
      <div className="photo-grid">
        <PhotoSlot
          slot={{ key: field.slot, label: field.label, hint: field.hint }}
          photo={photo ? { ...photo, url: media.urlFor(photo.filename) } : null}
          onSave={({ dataUrl, meta }) => media.add({ slot: field.slot, dataUrl, meta })}
          onClear={(p) => media.remove(p.id)}
        />
      </div>
    </div>
  );
}

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
