import React, { useState } from 'react';
import { api, messageFor } from '../../lib/api.js';
import { formatMoney } from '../../lib/pricing.js';
import { PAYMENT_KINDS, ALTERATION_STATUSES, EXTRA_STATUSES, FITTING_GARMENTS } from '../../lib/catalog.js';
import { ConfirmButton, DebouncedInput, Empty, Switch, useToast } from '../../components/ui.jsx';

/**
 * The order as a job rather than a design: the cloth it is cut from, how many,
 * what has been paid, what still has to be altered, and which extras are
 * outstanding.
 *
 * These were five separate spreadsheet tabs keyed by the client's name. Keeping
 * them on the order means the money and the work can never drift apart from
 * the suit they belong to.
 */
export default function OrderStep({ ctx }) {
  const { project, updateProject, reload } = ctx;
  const toast = useToast();

  const quoted = project.quote?.total ?? 0;
  const paid = (project.payments ?? []).reduce(
    (t, p) => t + (p.kind === 'refund' ? -p.amount : p.amount), 0
  );
  const outstanding = Math.max(0, quoted - paid);
  const depositTarget = quoted * 0.5;
  const depositMet = quoted > 0 && paid >= depositTarget;

  const run = async (fn, message) => {
    try { await fn(); await reload(); if (message) toast(message, 'ok'); }
    catch (err) { toast(messageFor(err), 'err'); }
  };

  return (
    <div className="stack">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {/* ---------------------------------------------------- the job --- */}
        <div style={{ flex: 2, minWidth: 440 }}>
          <div className="card">
            <div className="card-head"><h3>The job</h3></div>
            <div className="card-pad">
              <div className="row">
                <div className="field" style={{ maxWidth: 140 }}>
                  <label>Number of suits</label>
                  <DebouncedInput type="number" min="1" className="input" value={project.quantity ?? 1}
                    onCommit={(v) => updateProject({ quantity: Number(v) || 1 })} />
                </div>
                <div className="field">
                  <label>Fabric</label>
                  <DebouncedInput className="input" placeholder="Midnight blue birdseye"
                    value={project.fabric_name} onCommit={(v) => updateProject({ fabric_name: v })} />
                </div>
              </div>
              <div className="row">
                <div className="field">
                  <label>Code / colour</label>
                  <DebouncedInput className="input mono" placeholder="e.g. B-2241"
                    value={project.fabric_code} onCommit={(v) => updateProject({ fabric_code: v })} />
                </div>
                <div className="field">
                  <label>Supplier</label>
                  <DebouncedInput className="input" value={project.supplier}
                    onCommit={(v) => updateProject({ supplier: v })} />
                </div>
              </div>

              <hr className="divider" />

              <div className="row">
                <div className="field">
                  <label>First appointment</label>
                  <DebouncedInput className="input" type="date" value={project.first_appointment}
                    onCommit={(v) => updateProject({ first_appointment: v })} />
                </div>
                <div className="field">
                  <label>Paperwork</label>
                  <div className="toggle-row" style={{ marginBottom: 6 }}>
                    <span className="small">Measurement form received</span>
                    <Switch checked={!!project.measurement_form_received}
                      onChange={(v) => updateProject({ measurement_form_received: v })} />
                  </div>
                  <div className="toggle-row">
                    <span className="small">Form printed</span>
                    <Switch checked={!!project.form_printed}
                      onChange={(v) => updateProject({ form_printed: v })} />
                  </div>
                </div>
              </div>

              <div className="field">
                <label>Appointment notes</label>
                <DebouncedInput as="textarea" className="textarea" value={project.appointment_notes}
                  onCommit={(v) => updateProject({ appointment_notes: v })} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Comments</label>
                <DebouncedInput as="textarea" className="textarea" value={project.comments}
                  placeholder="Anything about this order worth remembering..."
                  onCommit={(v) => updateProject({ comments: v })} />
              </div>
            </div>
          </div>
        </div>

        {/* --------------------------------------------------- the money --- */}
        <div style={{ flex: 1, minWidth: 320 }}>
          <div className="card">
            <div className="card-head">
              <h3>Money</h3>
              <div className="spacer" />
              {quoted === 0
                ? <span className="pill pill-quiet">Not quoted</span>
                : depositMet
                  ? <span className="pill pill-ok">Deposit met</span>
                  : <span className="pill pill-warn">Deposit short</span>}
            </div>
            <div className="card-pad">
              <div className="price-line"><span className="muted">Quoted</span><span className="mono">{formatMoney(quoted)}</span></div>
              <div className="price-line"><span className="muted">Paid</span><span className="mono">{formatMoney(paid)}</span></div>
              <div className="price-line" style={{ fontWeight: 700 }}>
                <span>Balance due</span><span className="mono">{formatMoney(outstanding)}</span>
              </div>

              {quoted > 0 && !depositMet && (
                <div className="banner banner-warn" style={{ marginTop: 10 }}>
                  The terms require 50% ({formatMoney(depositTarget)}) before cutting starts.
                  Short by {formatMoney(depositTarget - paid)}.
                </div>
              )}

              <hr className="divider" />
              <RowList
                rows={project.payments ?? []}
                empty="No payments recorded."
                render={(p) => (
                  <>
                    <span style={{ fontWeight: 600 }}>
                      {PAYMENT_KINDS.find((k) => k.key === p.kind)?.label ?? p.kind}
                    </span>
                    <span className="tiny faint">
                      {[p.paid_on, p.method, p.reference].filter(Boolean).join(' · ') || 'no date'}
                    </span>
                  </>
                )}
                amount={(p) => (p.kind === 'refund' ? -p.amount : p.amount)}
                onDelete={(id) => run(() => api.payments.delete({ id }), 'Payment removed')}
              />
              <AddPayment projectId={project.id} suggested={outstanding} onAdded={() => run(async () => {}, 'Payment recorded')} reload={reload} />
            </div>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------- alterations --- */}
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

      {/* ------------------------------------------------------ extras --- */}
      <div className="card">
        <div className="card-head">
          <h3>Extras</h3>
          <div className="spacer" />
          <span className="tiny faint">Shirts, ties, pins - tracked separately because they arrive separately</span>
        </div>
        <div className="card-pad">
          {(project.extras ?? []).length === 0
            ? <Empty title="No extras on this order" />
            : (
              <table className="table">
                <thead><tr><th>Type</th><th>Colour</th><th>Qty</th><th>Status</th><th style={{ textAlign: 'right' }}>Value</th><th /></tr></thead>
                <tbody>
                  {project.extras.map((x) => (
                    <tr key={x.id}>
                      <td style={{ fontWeight: 600 }}>{x.extra_type}</td>
                      <td>{x.colour || '-'}</td>
                      <td className="mono">{x.quantity}</td>
                      <td>
                        <select className="select" style={{ minWidth: 130 }} value={x.status}
                          onChange={(e) => run(() => api.extras.update({ id: x.id, status: e.target.value }))}>
                          {EXTRA_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatMoney(x.unit_price * x.quantity)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <ConfirmButton className="btn btn-sm btn-ghost btn-danger" confirmLabel="Delete?"
                          onConfirm={() => run(() => api.extras.delete({ id: x.id }), 'Extra removed')}>
                          Remove
                        </ConfirmButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          <AddExtra projectId={project.id} onAdded={() => run(async () => {}, 'Extra added')} reload={reload} />
        </div>
      </div>
    </div>
  );
}

function RowList({ rows, render, amount, onDelete, empty }) {
  if (!rows.length) return <p className="small faint" style={{ margin: 0 }}>{empty}</p>;
  return rows.map((row) => (
    <div className="price-line" key={row.id}>
      <span style={{ display: 'flex', flexDirection: 'column' }}>{render(row)}</span>
      <span className="inline">
        <span className="mono">{formatMoney(amount(row))}</span>
        <ConfirmButton className="btn btn-sm btn-ghost btn-danger" confirmLabel="?" onConfirm={() => onDelete(row.id)}>×</ConfirmButton>
      </span>
    </div>
  ));
}

const today = () => new Date().toISOString().slice(0, 10);

function AddPayment({ projectId, suggested, onAdded, reload }) {
  const [form, setForm] = useState({ kind: 'deposit', amount: '', paidOn: today(), method: '', reference: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit() {
    if (!Number(form.amount)) { toast('Enter an amount.', 'err'); return; }
    setBusy(true);
    try {
      await api.payments.add({ projectId, ...form, amount: Number(form.amount) });
      setForm({ kind: 'deposit', amount: '', paidOn: today(), method: '', reference: '' });
      await reload();
      onAdded();
    } catch (err) { toast(messageFor(err), 'err'); } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div className="inline">
        <select className="select" style={{ maxWidth: 130 }} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
          {PAYMENT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
        <input type="number" className="input measure-input" style={{ width: 110 }} placeholder={suggested ? String(Math.round(suggested)) : '0'}
          value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        <input type="date" className="input" style={{ maxWidth: 150 }} value={form.paidOn}
          onChange={(e) => setForm({ ...form, paidOn: e.target.value })} />
      </div>
      <div className="inline" style={{ marginTop: 6 }}>
        <input className="input" placeholder="Method (EFT, cash)" value={form.method}
          onChange={(e) => setForm({ ...form, method: e.target.value })} />
        <input className="input" placeholder="Reference / proof" value={form.reference}
          onChange={(e) => setForm({ ...form, reference: e.target.value })} />
        <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>Record</button>
      </div>
    </div>
  );
}

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

function AddExtra({ projectId, onAdded, reload }) {
  const [form, setForm] = useState({ extraType: '', colour: '', quantity: 1, unitPrice: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit() {
    if (!form.extraType.trim()) { toast('Name the extra.', 'err'); return; }
    setBusy(true);
    try {
      await api.extras.add({ projectId, ...form, quantity: Number(form.quantity) || 1, unitPrice: Number(form.unitPrice) || 0 });
      setForm({ extraType: '', colour: '', quantity: 1, unitPrice: '' });
      await reload();
      onAdded();
    } catch (err) { toast(messageFor(err), 'err'); } finally { setBusy(false); }
  }

  return (
    <div className="inline" style={{ marginTop: 12, alignItems: 'flex-end' }}>
      <input className="input" style={{ flex: 2 }} placeholder="Shirt, tie, pocket square..." value={form.extraType}
        onChange={(e) => setForm({ ...form, extraType: e.target.value })} />
      <input className="input" placeholder="Colour" value={form.colour} onChange={(e) => setForm({ ...form, colour: e.target.value })} />
      <input type="number" className="input measure-input" style={{ width: 80 }} title="Quantity" value={form.quantity}
        onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
      <input type="number" className="input measure-input" style={{ width: 110 }} placeholder="Unit price" value={form.unitPrice}
        onChange={(e) => setForm({ ...form, unitPrice: e.target.value })} />
      <button className="btn btn-primary btn-sm" onClick={submit} disabled={busy}>Add</button>
    </div>
  );
}
