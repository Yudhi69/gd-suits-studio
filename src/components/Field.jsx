import React, { useState } from 'react';
import { Switch, DebouncedInput } from './ui.jsx';
import ColourPicker from './ColourPicker.jsx';
import { formatMoney } from '../lib/pricing.js';

/**
 * Renders one catalog field. Every control in the builder comes through here,
 * so adding an option to `catalog.js` is all it takes to extend the flow.
 */
export default function Field({ field, spec, overrides = {}, onChange }) {
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
            return (
              <button
                key={opt.key}
                type="button"
                className={`option ${value === opt.key ? 'selected' : ''}`}
                onClick={() => onChange(field.id, value === opt.key && !field.required ? undefined : opt.key)}
              >
                <div className="option-label">{opt.label}</div>
                {opt.desc && <div className="option-desc">{opt.desc}</div>}
                {amount > 0 && (
                  <div className="option-price">
                    {typeof opt.basePrice === 'number' ? '' : '+'}{formatMoney(amount)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
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
