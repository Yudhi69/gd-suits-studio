import React, { useState } from 'react';
import { buildBreakdown, formatMoney } from '../lib/pricing.js';
import { Modal } from './ui.jsx';

/** Running total, always visible while the tailor builds - the brief's
 *  "all custom selections must dynamically add to the total price". */
export default function PriceBar({ spec, overrides, right, steps }) {
  const [open, setOpen] = useState(false);
  const { lines, total } = buildBreakdown(spec, overrides, steps);

  const groups = lines.reduce((acc, line) => {
    (acc[line.group] ??= []).push(line);
    return acc;
  }, {});

  return (
    <>
      <div className="price-bar">
        <div>
          <div className="tiny" style={{ color: 'var(--sidebar-soft)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
            Running total
          </div>
          <div className="price-total">{formatMoney(total)}</div>
        </div>
        <button className="btn btn-sm" onClick={() => setOpen(true)} style={{ background: 'transparent', borderColor: 'var(--sidebar-line)', color: 'var(--sidebar-text)' }}>
          {lines.length} line{lines.length === 1 ? '' : 's'} - view breakdown
        </button>
        <div style={{ flex: 1 }} />
        {right}
      </div>

      {open && (
        <Modal title="Price breakdown" onClose={() => setOpen(false)}>
          {lines.length === 0 ? (
            <p className="muted">Nothing selected yet.</p>
          ) : (
            <>
              {Object.entries(groups).map(([group, groupLines]) => (
                <div key={group}>
                  <div className="price-group-title">{group}</div>
                  {groupLines.map((line, i) => (
                    <div className="price-line" key={`${line.key}-${i}`}>
                      <span>{line.label}</span>
                      <span className="mono">{formatMoney(line.amount)}</span>
                    </div>
                  ))}
                </div>
              ))}
              <hr className="divider" />
              <div className="price-line" style={{ fontSize: 17, fontWeight: 700 }}>
                <span>Total</span>
                <span>{formatMoney(total)}</span>
              </div>
              <p className="tiny faint" style={{ marginTop: 14 }}>
                Prices come from the list in Settings. Change them there and every quote follows.
              </p>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
