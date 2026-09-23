import React, { useState } from 'react';
import { api, messageFor } from '../lib/api.js';
import { formatMoney } from '../lib/pricing.js';
import { ALTERATION_STATUSES, FITTING_GARMENTS } from '../lib/catalog.js';
import { ConfirmButton, Empty, useToast } from './ui.jsx';

/**
 * Work that comes back after a fitting, with its own due date and cost.
 *
 * It lives with the fittings because that is where it starts: a garment is
 * tried on, something is wrong, and it goes back to the bench. Keeping it on
 * the order page meant writing up an alteration in a different part of the
 * app from the fitting that caused it.
 */
export default function AlterationsPanel({ project, reload }) {
  const toast = useToast();
  const run = async (fn, message) => {
    try { await fn(); await reload(); if (message) toast(message, 'ok'); }
    catch (err) { toast(messageFor(err), 'err'); }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>Alterations</h3>
        <div className="spacer" />
        <span className="tiny faint">Work that comes back after a fitting, with its own due date and cost</span>
      </div>
      <div className="card-pad">
        {(project.alterations ?? []).length === 0
          ? <Empty title="No alterations logged">Add one when a garment comes back needing work.</Empty>
          : (
            <table className="table">
              <thead>
                <tr><th>Garment</th><th>What</th><th>Type</th><th>Received</th><th>Due</th><th>Status</th><th style={{ textAlign: 'right' }}>Cost</th><th /></tr>
              </thead>
              <tbody>
                {project.alterations.map((a) => {
                  const late = a.due_on && a.due_on < new Date().toISOString().slice(0, 10)
                    && !['collected', 'cancelled'].includes(a.status);
                  return (
                    <tr key={a.id}>
                      <td style={{ textTransform: 'capitalize' }}>{a.garment || '-'}</td>
                      <td>{a.description || '-'}</td>
                      <td className="muted">{a.kind || '-'}</td>
                      <td className="mono small">{a.received_on || '-'}</td>
                      <td className={`mono small ${late ? 'overdue' : ''}`}>{a.due_on || '-'}{late ? ' — late' : ''}</td>
                      <td>
                        <select className="select" style={{ minWidth: 130 }} value={a.status}
                          onChange={(e) => run(() => api.alterations.update({ id: a.id, status: e.target.value }))}>
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
          )}
        <AddAlteration projectId={project.id} onAdded={() => run(async () => {}, 'Alteration logged')} reload={reload} />
      </div>
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function AddAlteration({ projectId, onAdded, reload }) {
  const [form, setForm] = useState({ garment: 'jacket', description: '', kind: '', receivedOn: today(), dueOn: '', cost: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit() {
    if (!form.description.trim()) { toast('Describe the alteration.', 'err'); return; }
    setBusy(true);
    try {
      await api.alterations.add({ projectId, ...form, cost: Number(form.cost) || 0 });
      setForm({ garment: 'jacket', description: '', kind: '', receivedOn: today(), dueOn: '', cost: '' });
      await reload();
      onAdded();
    } catch (err) { toast(messageFor(err), 'err'); } finally { setBusy(false); }
  }

  return (
    <div className="inline" style={{ marginTop: 12, alignItems: 'flex-end' }}>
      <select className="select" style={{ maxWidth: 130 }} value={form.garment} onChange={(e) => setForm({ ...form, garment: e.target.value })}>
        {FITTING_GARMENTS.map((g) => <option key={g} value={g}>{g[0].toUpperCase() + g.slice(1)}</option>)}
      </select>
      <input className="input" style={{ flex: 2 }} placeholder="Take in the waist 2cm" value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })} />
      <input className="input" placeholder="Type" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} />
      <input type="date" className="input" style={{ maxWidth: 150 }} title="Due" value={form.dueOn}
        onChange={(e) => setForm({ ...form, dueOn: e.target.value })} />
      <input type="number" className="input measure-input" style={{ width: 100 }} placeholder="Cost" value={form.cost}
        onChange={(e) => setForm({ ...form, cost: e.target.value })} />
      <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>Add</button>
    </div>
  );
}
