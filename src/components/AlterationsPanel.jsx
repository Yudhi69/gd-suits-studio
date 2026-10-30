import React, { useMemo, useState } from 'react';
import { api, messageFor } from '../lib/api.js';
import { formatMoney } from '../lib/pricing.js';
import { ALTERATION_STATUSES, MEASUREMENTS, measureRows, measuredGarments } from '../lib/catalog.js';
import { suitName } from '../lib/quote.js';
import { toDisplay, fromDisplay, unitShort, unitLabel, stepFor } from '../lib/units.js';
import { ConfirmButton, Empty, useToast } from './ui.jsx';

/**
 * Work that comes back after a fitting, with its own due date and cost.
 *
 * It lives with the fittings because that is where it starts: a garment is
 * tried on, something is wrong, and it goes back to the bench.
 *
 * An alteration follows the measurement list, as GD asked: pick the garment
 * and its measurements are laid out with the figure on file beside each, and
 * the change is typed against the one that is changing - "-2" on the waist.
 * Logging it moves the measurement, so the measurement page always shows the
 * garment as it now is; cancelling or deleting it moves the figure back.
 */
const GARMENT_LABEL = { jacket: 'Jacket', waistcoat: 'Waistcoat', pants: 'Trousers', shirt: 'Shirt' };

const signed = (n, unit) => {
  const shown = toDisplay(Math.abs(n), unit);
  return `${n > 0 ? '+' : '-'}${shown} ${unitShort(unit)}`;
};

export default function AlterationsPanel({ project, reload, unit = 'cm', activeSuitId }) {
  const toast = useToast();
  const run = async (fn, message) => {
    try { await fn(); await reload(); if (message) toast(message, 'ok'); }
    catch (err) { toast(messageFor(err), 'err'); }
  };
  const suits = project.suits ?? [];
  const multi = suits.length > 1;
  const nameOf = (suitId) => {
    const i = suits.findIndex((s) => s.id === suitId);
    return i >= 0 ? suitName(suits[i], i, suits) : '';
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>Alterations</h3>
        <div className="spacer" />
        <span className="tiny faint">Changes go onto the measurements; cancelling one puts them back</span>
      </div>
      <div className="card-pad">
        {(project.alterations ?? []).length === 0
          ? <Empty title="No alterations logged">Add one when a garment comes back needing work.</Empty>
          : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Garment</th><th>Changes</th><th>Type</th><th>Received</th><th>Due</th><th>Status</th>
                    <th style={{ textAlign: 'right' }}>Cost</th><th />
                  </tr>
                </thead>
                <tbody>
                  {project.alterations.map((a) => {
                    const late = a.due_on && a.due_on < new Date().toISOString().slice(0, 10)
                      && !['collected', 'cancelled'].includes(a.status);
                    return (
                      <tr key={a.id} className={a.status === 'cancelled' ? 'row-cancelled' : ''}>
                        <td>
                          {GARMENT_LABEL[a.garment] ?? (a.garment || '-')}
                          {multi && a.suit_id && <div className="tiny faint">{nameOf(a.suit_id)}</div>}
                        </td>
                        <td>
                          {(a.changes ?? []).map((c) => (
                            <div key={c.fieldId} className="small">
                              <strong>{c.label || c.fieldId}</strong> {signed(c.change, unit)}
                              {c.before !== null && c.after !== null && (
                                <span className="faint mono tiny"> ({toDisplay(c.before, unit)} &rarr; {toDisplay(c.after, unit)})</span>
                              )}
                              {c.before === null && <span className="faint tiny"> (not measured yet)</span>}
                            </div>
                          ))}
                          {a.description && <div className="small muted">{a.description}</div>}
                          {!a.description && !(a.changes ?? []).length && '-'}
                        </td>
                        <td className="muted">{a.kind || '-'}</td>
                        <td className="mono small">{a.received_on || '-'}</td>
                        <td className={`mono small ${late ? 'overdue' : ''}`}>{a.due_on || '-'}{late ? ' — late' : ''}</td>
                        <td>
                          <select className="select" style={{ minWidth: 130 }} value={a.status}
                            onChange={(e) => run(
                              () => api.alterations.update({ id: a.id, status: e.target.value }),
                              e.target.value === 'cancelled' && (a.changes ?? []).length ? 'Cancelled - measurements put back' : null
                            )}>
                            {ALTERATION_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select>
                        </td>
                        <td className="mono" style={{ textAlign: 'right' }}>{formatMoney(a.cost)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <ConfirmButton className="btn btn-sm btn-ghost btn-danger" confirmLabel="Delete?"
                            onConfirm={() => run(() => api.alterations.delete({ id: a.id }), 'Alteration removed')}>
                            Remove
                          </ConfirmButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        <AddAlteration
          project={project}
          unit={unit}
          activeSuitId={activeSuitId}
          onAdded={(n) => run(async () => {}, n ? `Alteration logged - ${n} measurement${n === 1 ? '' : 's'} updated` : 'Alteration logged')}
        />
      </div>
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function AddAlteration({ project, unit, activeSuitId, onAdded }) {
  const suits = project.suits ?? [];
  const [suitId, setSuitId] = useState(activeSuitId ?? suits[0]?.id ?? null);
  const suit = suits.find((s) => s.id === suitId) ?? suits[0] ?? null;
  const garments = [...measuredGarments(suit?.spec?.suitType ?? project.spec?.suitType), 'shirt'];
  const [garment, setGarment] = useState(garments[0]);
  const [changes, setChanges] = useState({});
  const [form, setForm] = useState({ description: '', kind: '', dueOn: '', cost: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const rows = useMemo(() => measureRows(garment), [garment]);
  const onFile = (fieldId) => project.measurements.find((m) => m.garment === garment && m.field_id === fieldId
    && (suit ? m.suit_id === suit.id : true))?.value ?? null;

  // What has been typed, in centimetres - the stored unit, whatever is shown.
  const typed = rows
    .map((r) => ({ fieldId: r.id, label: r.label, change: fromDisplay(changes[r.id] ?? '', unit) }))
    .filter((c) => Number.isFinite(c.change) && c.change !== 0);

  function reset(nextGarment = garment) {
    setGarment(nextGarment);
    setChanges({});
  }

  async function submit() {
    if (!typed.length && !form.description.trim()) {
      toast('Type a change against a measurement, or describe the alteration.', 'err');
      return;
    }
    setBusy(true);
    try {
      await api.alterations.add({
        projectId: project.id,
        suitId: suit?.id,
        garment,
        changes: typed,
        description: form.description.trim(),
        kind: form.kind,
        receivedOn: today(),
        dueOn: form.dueOn,
        cost: Number(form.cost) || 0,
      });
      setForm({ description: '', kind: '', dueOn: '', cost: '' });
      setChanges({});
      onAdded(typed.length);
    } catch (err) { toast(messageFor(err), 'err'); } finally { setBusy(false); }
  }

  return (
    <div className="alteration-form">
      <div className="price-group-title">Log an alteration</div>
      <div className="inline" style={{ flexWrap: 'wrap', marginBottom: 8 }}>
        {suits.length > 1 && (
          <select className="select" style={{ maxWidth: 240 }} value={suit?.id ?? ''}
            onChange={(e) => { setSuitId(Number(e.target.value)); reset(); }} aria-label="Which suit">
            {suits.map((s, i) => <option key={s.id} value={s.id}>{suitName(s, i, suits)}</option>)}
          </select>
        )}
        <div className="unit-switch" role="group" aria-label="Garment">
          {garments.map((g) => (
            <button key={g} type="button" className={g === garment ? 'active' : ''} aria-pressed={g === garment}
              onClick={() => reset(g)}>
              {GARMENT_LABEL[g]}
            </button>
          ))}
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="alteration-rows">
          {rows.map((r) => {
            const now = onFile(r.id);
            const change = fromDisplay(changes[r.id] ?? '', unit);
            const after = now !== null && Number.isFinite(change) && change !== 0 ? Math.round((now + change) * 100) / 100 : null;
            return (
              <div className="alteration-row" key={r.id}>
                <span className="small">{r.label}</span>
                <span className="mono small faint">{now === null ? 'not taken' : `${toDisplay(now, unit)} ${unitShort(unit)}`}</span>
                <input
                  type="number"
                  step={stepFor(unit)}
                  className="input measure-input"
                  placeholder="±"
                  aria-label={`Change to ${r.label}`}
                  value={changes[r.id] ?? ''}
                  onChange={(e) => setChanges({ ...changes, [r.id]: e.target.value })}
                />
                <span className="mono small">{after !== null ? <>&rarr; {toDisplay(after, unit)} {unitShort(unit)}</> : ''}</span>
              </div>
            );
          })}
          <div className="hint">Minus takes in, plus lets out - in {unitLabel(unit)}, as on the measurement page.</div>
        </div>
      ) : (
        <p className="small faint" style={{ margin: '0 0 8px' }}>
          {GARMENT_LABEL[garment]} alterations are described rather than measured.
        </p>
      )}

      <div className="inline" style={{ marginTop: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <input className="input" style={{ flex: 2, minWidth: 200 }} placeholder="Anything else - re-set the sleeve, move a button"
          value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <input className="input" style={{ maxWidth: 140 }} placeholder="Type" value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value })} />
        <input type="date" className="input" style={{ maxWidth: 150 }} title="Due" value={form.dueOn}
          onChange={(e) => setForm({ ...form, dueOn: e.target.value })} />
        <input type="number" className="input measure-input" style={{ width: 100 }} placeholder="Cost" value={form.cost}
          onChange={(e) => setForm({ ...form, cost: e.target.value })} />
        <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>
          {typed.length ? `Log ${typed.length} change${typed.length === 1 ? '' : 's'}` : 'Log alteration'}
        </button>
      </div>
      {MEASUREMENTS[garment] && typed.some((c) => onFile(c.fieldId) === null) && (
        <div className="hint">A measurement that was never taken has nothing to change - it is logged as written.</div>
      )}
    </div>
  );
}
