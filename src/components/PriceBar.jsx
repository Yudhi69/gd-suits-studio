import React, { useState } from 'react';
import { formatMoney, needsPrice } from '../lib/pricing.js';
import { orderBreakdown, quoteDrift, suitsOf } from '../lib/quote.js';
import { Modal } from './ui.jsx';

/** Running total, always visible while the tailor builds - the brief's
 *  "all custom selections must dynamically add to the total price".
 *
 *  It is the whole order's total. On a wedding party the suit on screen is
 *  shown beside it, so the figure that moves when a lapel is changed is the
 *  one that changed. */
export default function PriceBar({ order, activeSuitId, overrides, right, steps, quote }) {
  const [open, setOpen] = useState(false);
  const live = orderBreakdown(order, overrides, steps);
  const drift = quoteDrift(quote, order, overrides, steps);
  // Once agreed, the agreed figure is the one on show.
  const { lines, total } = quote ?? live;
  const suits = suitsOf(order);
  // The quality sets the suit's price, so until there is one the total is
  // only what goes with the suit.
  const missing = quote ? [] : live.lines.filter(needsPrice);
  const thisSuit = suits.length > 1 && !quote
    ? live.lines.filter((l) => l.suitId === (activeSuitId ?? suits[0].id)).reduce((t, l) => t + l.amount, 0)
    : null;

  const groups = lines.reduce((acc, line) => {
    (acc[line.group] ??= []).push(line);
    return acc;
  }, {});

  return (
    <>
      <div className="price-bar">
        <div>
          <div className="tiny" style={{ color: 'var(--sidebar-soft)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
            {quote ? 'Agreed quote' : 'Running total'}
          </div>
          <div className="price-total">{formatMoney(total)}</div>
          {missing.length > 0 && (
            <div className="tiny price-unpriced" style={{ color: 'var(--sidebar-soft)' }}>
              {missing.some((l) => l.noQuality) ? 'The suit has no price until its quality is chosen'
                : missing.every((l) => l.item) ? 'Part of this order has no price yet'
                : 'The suit has no price yet in this quality'}
            </div>
          )}
          {thisSuit !== null && (
            <div className="tiny" style={{ color: 'var(--sidebar-soft)' }}>This suit {formatMoney(thisSuit)}</div>
          )}
        </div>
        <button className="btn btn-sm" onClick={() => setOpen(true)} style={{ background: 'transparent', borderColor: 'var(--sidebar-line)', color: 'var(--sidebar-text)' }}>
          {lines.length} line{lines.length === 1 ? '' : 's'} - view breakdown
        </button>
        {drift && (
          <span className="pill pill-warn" title={`Today's price list would make this ${formatMoney(drift.live.total)}`}>
            price list moved {drift.label}
          </span>
        )}
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
                      <span className="mono">{needsPrice(line) ? 'No price yet' : formatMoney(line.amount)}</span>
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
                Prices and option names come from Settings &rarr; Price list. Change them there and every
                quote that is not yet agreed follows.
              </p>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
