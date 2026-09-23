import React, { useState } from 'react';
import { api, messageFor } from '../../lib/api.js';
import { formatMoney } from '../../lib/pricing.js';
import { PAYMENT_KINDS } from '../../lib/catalog.js';
import { ConfirmButton, DebouncedInput, Empty, Switch, useToast } from '../../components/ui.jsx';
import PartyPanel from '../../components/PartyPanel.jsx';

/**
 * The order as a job rather than a design: the cloth it is cut from, how many,
 * what has been paid, what still has to be altered, and which extras are
 * outstanding.
 *
 * These were five separate spreadsheet tabs keyed by the client's name. Keeping
 * them on the order means the money and the work can never drift apart from
 * the suit they belong to.
 */
export default function OrderStep({ ctx, business }) {
  const { project, updateProject, reload } = ctx;
  const toast = useToast();

  const quoted = project.quote?.total ?? 0;
  const paid = (project.payments ?? []).reduce(
    (t, p) => t + (p.kind === 'refund' ? -p.amount : p.amount), 0
  );
  const outstanding = Math.max(0, quoted - paid);
  const depositFraction = business?.depositFraction ?? 0.5;
  const depositTarget = quoted * depositFraction;
  const depositMet = quoted > 0 && paid >= depositTarget;

  const run = async (fn, message) => {
    try { await fn(); await reload(); if (message) toast(message, 'ok'); }
    catch (err) { toast(messageFor(err), 'err'); }
  };

  return (
    <div className="stack">
      <PartyPanel project={project} reload={reload} />

      <div className="row" style={{ alignItems: 'flex-start' }}>
        {/* ---------------------------------------------------- the job --- */}
        <div style={{ flex: 2, minWidth: 440 }}>
          <div className="card">
            <div className="card-head"><h3>Order details</h3></div>
            <div className="card-pad">
              <div className="field" style={{ maxWidth: 160 }}>
                <label>Number of suits</label>
                <DebouncedInput type="number" min="1" className="input" value={project.quantity ?? 1}
                  onCommit={(v) => updateProject({ quantity: Number(v) || 1 })} />
              </div>
              {/* The three things that identify the cloth, read together. */}
              <div className="grid grid-3">
                <div className="field">
                  <label>Fabric colour</label>
                  <DebouncedInput className="input" placeholder="Midnight blue"
                    value={project.fabric_name} onCommit={(v) => updateProject({ fabric_name: v })} />
                </div>
                <div className="field">
                  <label>Material code</label>
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
                  The terms require {Math.round(depositFraction * 100)}% ({formatMoney(depositTarget)}) before cutting starts.
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

      {/* Free text as GD wrote it in the spreadsheet. Shown as a record
          rather than as pickers, because these predate the catalogue. */}
      {project.import_source && (
        <div className="card">
          <div className="card-head">
            <h3>From the workbook</h3>
            <div className="spacer" />
            <span className="tiny faint">Imported from the {project.import_source.toLowerCase()} sheet</span>
          </div>
          <div className="card-pad">
            {[['Design', project.design], ['Lining', project.lining], ['Shirt', project.shirt]]
              .filter(([, v]) => v)
              .map(([label, value]) => (
                <div className="field" key={label}>
                  <label>{label}</label>
                  <DebouncedInput as="textarea" className="textarea" value={value}
                    onCommit={(v) => updateProject({ [label.toLowerCase()]: v })} />
                </div>
              ))}
            {project.imported_balance > 0 && (
              <div className="banner banner-warn">
                Balance on the sheet: <strong>{formatMoney(project.imported_balance)}</strong>
                {project.balance_note && <> — written as "{project.balance_note}"</>}
                . Not counted in the figures above until it is confirmed and recorded as a payment.
              </div>
            )}
            {project.form_url && (
              <p className="small" style={{ margin: '10px 0 0' }}>
                Measurement form: <span className="mono tiny">{project.form_url}</span>
              </p>
            )}
          </div>
        </div>
      )}

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

