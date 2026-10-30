import React from 'react';

/**
 * Which suit the garment pages are editing.
 *
 * It appears only when an order carries more than one, so a single client
 * ordering a single suit - which is most orders - sees nothing new at all.
 * When it does appear it is the only thing that changes: the pages beneath
 * behave exactly as they always have, on one suit at a time, rather than
 * becoming a wall of repeated forms.
 */
export default function SuitStrip({ suits = [], activeSuitId, onSelect }) {
  if (suits.length < 2) return null;

  return (
    <div className="suit-strip">
      <span className="suit-strip-label">Working on</span>
      <div className="suit-strip-tabs">
        {suits.map((suit) => {
          const person = `${suit.name} ${suit.surname}`.trim();
          const what = suit.label || suit.fabric_name || 'Suit';
          return (
            <button
              key={suit.id}
              type="button"
              className={`suit-tab ${suit.id === (activeSuitId ?? suits[0].id) ? 'active' : ''}`}
              onClick={() => onSelect(suit.id)}
              title={`${person} - ${what}`}
            >
              <span className="suit-tab-person">{person || 'Unnamed'}</span>
              <span className="suit-tab-what">{what}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
