import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, messageFor } from '../lib/api.js';
import { formatMoney } from '../lib/pricing.js';
import { quotedTotal, quoteFromOrder, isDraft, suitsOf } from '../lib/quote.js';
import { sheetSummaries } from '../lib/sheet.js';
import { prettyDate } from '../lib/informalQuote.js';
import {
  PROJECT_STATUSES, ALTERATION_STATUSES, EXTRA_STATUSES, isOpenStatus, statusLabel, statusPill, MEASUREMENTS,
} from '../lib/catalog.js';
import { Spinner, useToast } from '../components/ui.jsx';
import { toDisplay, unitShort } from '../lib/units.js';

/**
 * GD's workbook, as a view over the database.
 *
 * Five tabs with the sheet's own names and the sheet's own columns, so the
 * spreadsheet he has kept for years reads the same here - and every cell that
 * is a fact about the order can be changed in place. A cell that is worked
 * out (the quoted figure, the balance, the suit count) says so and is changed
 * where it comes from instead. Nothing here is a second copy: an edit is the
 * order itself changing, and the order page shows it straight away.
 *
 * "Export" writes the tab as a spreadsheet file Excel opens.
 */
const TABS = [
  { key: 'current', label: 'Current orders' },
  { key: 'completed', label: 'Completed' },
  { key: 'progress', label: 'Suit progress' },
  { key: 'alterations', label: 'Alterations' },
  { key: 'extras', label: 'Extras' },
];

const PROGRESS = [
  { key: 'in_production', label: 'In production' },
  { key: 'ready_first_fitting', label: 'First fitting' },
  { key: 'alterations', label: 'Alterations' },
  { key: 'ready_final_fit', label: 'Final fitting' },
];

const PAGE = 200;

export default function Database({ steps, overrides, onOpenProject, unit = 'cm' }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('current');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    try { setData(await api.database.sheet()); }
    catch (err) { toast(messageFor(err), 'err'); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setLimit(PAGE); }, [tab, query]);

  /** Saves a change, then reads the sheet back so what shows is what is stored. */
  const save = useCallback(async (fn, message) => {
    try { await fn(); await load(); if (message) toast(message, 'ok'); }
    catch (err) { toast(messageFor(err), 'err'); await load(); }
  }, [load, toast]);

  /**
   * A status change that takes an order out of draft fixes its price, as it
   * does from the order page - otherwise an order moved on here would carry
   * no agreed figure until someone happened to open it.
   */
  const setStatus = useCallback((row, status) => save(async () => {
    if (isDraft(row.status) && !isDraft(status) && !row.quote_json) {
      const order = await api.projects.get({ id: row.id });
      await api.projects.setQuote({ id: row.id, quote: quoteFromOrder(order, overrides, steps, status) });
    }
    await api.projects.update({ id: row.id, patch: { status } });
  }), [save, overrides, steps]);

  // Each order's worked-out columns, once per load rather than once per cell.
  const orders = useMemo(() => (data?.orders ?? []).map((row) => {
    const suits = suitsOf(row);
    const summary = sheetSummaries(suits[0]?.spec ?? {}, steps);
    const more = suits.length > 1 ? ` (+${suits.length - 1} more suit${suits.length > 2 ? 's' : ''})` : '';
    const quoted = quotedTotal(row, overrides, steps);
    const legacy = !row.quote_json && row.imported_balance > 0;
    return {
      ...row,
      client: `${row.name ?? ''} ${row.surname ?? ''}`.trim(),
      designShown: row.design || (summary.design ? summary.design + more : ''),
      liningShown: row.lining || summary.lining,
      shirtShown: row.shirt || summary.shirt,
      designDerived: !row.design,
      liningDerived: !row.lining,
      shirtDerived: !row.shirt,
      quoted,
      balance: legacy ? row.imported_balance : Math.max(0, quoted - row.paid),
      legacyBalance: legacy,
      firstAppointment: row.consultation_date || row.first_appointment || '',
    };
  }), [data, overrides, steps]);

  const q = query.trim().toLowerCase();
  const hit = (...parts) => !q || parts.join(' ').toLowerCase().includes(q);

  const shownOrders = orders.filter((o) => (tab === 'completed' ? !isOpenStatus(o.status) : isOpenStatus(o.status)))
    .filter((o) => hit(o.client, o.order_ref, o.fabric_name, o.fabric_code, o.designShown, o.comments, o.contact, o.email));
  const shownAlterations = (data?.alterations ?? [])
    .filter((a) => hit(a.name, a.surname, a.order_ref, a.description, a.kind));
  const shownExtras = (data?.extras ?? []).filter((e) => hit(e.name, e.surname, e.order_ref, e.extra_type, e.colour));

  const patchProject = (row, patch, message) => save(() => api.projects.update({ id: row.id, patch }), message);
  const patchClient = (row, patch) => save(() => api.clients.patch({ id: row.client_id, patch }));
  const splitName = (text) => {
    const parts = String(text).trim().split(/\s+/);
    return { name: parts[0] ?? '', surname: parts.slice(1).join(' ') };
  };

  /** The tab as rows of text, header first - what Excel will show. */
  function exportRows() {
    if (tab === 'current' || tab === 'completed') {
      return [
        ['REF', 'CLIENT', 'EVENT DATE', 'FABRIC', 'CODE / COLOUR', 'DESIGN', 'LINING', 'QUANTITY', 'SHIRT', 'BALANCE DUE',
          'MEASUREMENT FORM', 'FORM PRINTED', 'QUOTED', 'CONTACT DETAILS', 'EMAIL', 'APPOINTMENT NOTES', 'FIRST APPOINTMENT',
          'COMMENTS', 'STATUS'],
        ...shownOrders.map((o) => [
          o.order_ref, o.client, o.event_date, o.fabric_name, o.fabric_code, o.designShown, o.liningShown, o.suit_count,
          o.shirtShown, o.balance, o.measurement_form_received ? 'YES' : '', o.form_printed ? 'YES' : '', o.quoted,
          o.contact, o.email, o.appointment_notes, o.firstAppointment, o.comments, statusLabel(o.status),
        ]),
      ];
    }
    if (tab === 'progress') {
      return [
        ['CLIENT', 'QUANTITY', ...PROGRESS.map((p) => p.label.toUpperCase())],
        ...orders.filter((o) => isOpenStatus(o.status)).filter((o) => hit(o.client, o.order_ref))
          .map((o) => [o.client, o.suit_count, ...PROGRESS.map((p) => (o.status === p.key ? 'X' : ''))]),
      ];
    }
    if (tab === 'alterations') {
      return [
        ['CLIENT', 'ITEM DESCRIPTION', 'ALTERATION TYPE', 'STATUS', 'DATE RECEIVED', 'DUE DATE', 'CONFIRMED', 'COSTING'],
        ...shownAlterations.map((a) => [
          `${a.name} ${a.surname}`.trim(), describeAlteration(a, unit), a.kind,
          ALTERATION_STATUSES.find((s) => s.key === a.status)?.label ?? a.status,
          a.received_on, a.due_on, a.confirmed_on, a.cost,
        ]),
      ];
    }
    return [
      ['CLIENT', 'EXTRA TYPE', 'COLOUR', 'QUANTITY', 'STATUS'],
      ...shownExtras.map((e) => [
        `${e.name} ${e.surname}`.trim(), e.extra_type, e.colour, e.quantity,
        EXTRA_STATUSES.find((s) => s.key === e.status)?.label ?? e.status,
      ]),
    ];
  }

  async function exportTab() {
    setExporting(true);
    try {
      const label = TABS.find((t) => t.key === tab)?.label ?? 'Database';
      const res = await api.database.export({ name: `GD Suits - ${label}`, rows: exportRows() });
      if (res?.saved) toast(`Exported ${res.rows} row${res.rows === 1 ? '' : 's'} to ${res.name}`, 'ok');
    } catch (err) {
      toast(messageFor(err), 'err');
    } finally {
      setExporting(false);
    }
  }

  const count = {
    current: orders.filter((o) => isOpenStatus(o.status)).length,
    completed: orders.filter((o) => !isOpenStatus(o.status)).length,
    progress: orders.filter((o) => isOpenStatus(o.status)).length,
    alterations: data?.alterations?.length ?? 0,
    extras: data?.extras?.length ?? 0,
  };

  return (
    <>
      <div className="topbar">
        <h1>Database</h1>
        <div className="spacer" />
        <input className="input" style={{ maxWidth: 260 }} placeholder="Search this sheet..."
          value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="btn" onClick={exportTab} disabled={exporting || !data}>
          {exporting ? <><Spinner /> Exporting...</> : 'Export to Excel'}
        </button>
      </div>

      <div className="content wide">
        <div className="stepper" style={{ marginBottom: 14 }}>
          {TABS.map((t) => (
            <button key={t.key} className={`step-tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label} <span className="faint tiny">{count[t.key]}</span>
            </button>
          ))}
        </div>
        <p className="tiny faint" style={{ margin: '0 0 12px' }}>
          Click any cell to change it - it changes the order itself. Grey text is worked out from the order&apos;s
          specification; typing over it keeps your own words instead. Quoted, balance and quantity are worked out
          from the order and are changed there.
        </p>

        {!data ? <div className="center" style={{ padding: 40 }}><Spinner /></div> : (
          <div className="card table-scroll db-sheet">
            {(tab === 'current' || tab === 'completed') && (
              <table className="table db-table">
                <thead>
                  <tr>
                    <th>Ref</th><th>Client</th><th>Event date</th><th>Fabric</th><th>Code / colour</th><th>Design</th>
                    <th>Lining</th><th>Qty</th><th>Shirt</th><th className="num">Balance due</th><th>Form</th>
                    <th>Printed</th><th className="num">Quoted</th><th>Contact</th><th>Email</th>
                    <th>Appointment notes</th><th>First appointment</th><th>Comments</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shownOrders.slice(0, limit).map((o) => (
                    <tr key={o.id}>
                      <td className="nowrap"><button className="link mono tiny" onClick={() => onOpenProject(o.id)} title="Open the order">{o.order_ref || 'open'}</button></td>
                      <td><Cell value={o.client} onSave={(v) => patchClient(o, splitName(v))} strong /></td>
                      <td><Cell value={o.event_date} type="date" onSave={(v) => patchProject(o, { event_date: v })} /></td>
                      <td><Cell value={o.fabric_name} onSave={(v) => patchProject(o, { fabric_name: v })} /></td>
                      <td><Cell value={o.fabric_code} onSave={(v) => patchProject(o, { fabric_code: v })} mono /></td>
                      <td className="wide-cell"><Cell value={o.design} shown={o.designShown} derived={o.designDerived} multiline onSave={(v) => patchProject(o, { design: v })} /></td>
                      <td><Cell value={o.lining} shown={o.liningShown} derived={o.liningDerived} onSave={(v) => patchProject(o, { lining: v })} /></td>
                      <td className="num" title="The number of suits on the order - add one on the order page">{o.suit_count}</td>
                      <td><Cell value={o.shirt} shown={o.shirtShown} derived={o.shirtDerived} onSave={(v) => patchProject(o, { shirt: v })} /></td>
                      <td className="num mono" title={o.legacyBalance ? 'As written on the old sheet - not yet confirmed as a payment' : 'Quoted less paid'}>
                        {o.balance ? formatMoney(o.balance) : '-'}{o.legacyBalance && <span className="faint"> *</span>}
                      </td>
                      <td className="tick"><Check checked={!!o.measurement_form_received} label="Measurement form received" onChange={(v) => patchProject(o, { measurement_form_received: v })} /></td>
                      <td className="tick"><Check checked={!!o.form_printed} label="Form printed" onChange={(v) => patchProject(o, { form_printed: v })} /></td>
                      <td className="num mono">{o.quoted ? formatMoney(o.quoted) : '-'}</td>
                      <td><Cell value={o.contact} onSave={(v) => patchClient(o, { contact: v })} /></td>
                      <td><Cell value={o.email} onSave={(v) => patchClient(o, { email: v })} /></td>
                      <td className="wide-cell"><Cell value={o.appointment_notes} multiline onSave={(v) => patchProject(o, { appointment_notes: v })} /></td>
                      <td><Cell value={o.firstAppointment} type="date" onSave={(v) => patchProject(o, { consultation_date: v })} /></td>
                      <td className="wide-cell"><Cell value={o.comments} multiline onSave={(v) => patchProject(o, { comments: v })} /></td>
                      <td>
                        <select className="select select-sm" value={o.status} aria-label="Status" onChange={(e) => setStatus(o, e.target.value)}>
                          {PROJECT_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'progress' && (
              <table className="table db-table">
                <thead>
                  <tr><th>Client</th><th className="num">Qty</th>{PROGRESS.map((p) => <th key={p.key} className="center-cell">{p.label}</th>)}<th>Now</th></tr>
                </thead>
                <tbody>
                  {orders.filter((o) => isOpenStatus(o.status)).filter((o) => hit(o.client, o.order_ref)).slice(0, limit).map((o) => (
                    <tr key={o.id}>
                      <td><button className="link" onClick={() => onOpenProject(o.id)}>{o.client}</button></td>
                      <td className="num">{o.suit_count}</td>
                      {PROGRESS.map((p) => (
                        <td key={p.key} className="center-cell">
                          <button
                            className={`progress-mark ${o.status === p.key ? 'on' : ''}`}
                            aria-pressed={o.status === p.key}
                            aria-label={`${o.client}: ${p.label}`}
                            onClick={() => o.status !== p.key && setStatus(o, p.key)}
                          >
                            {o.status === p.key ? 'X' : ''}
                          </button>
                        </td>
                      ))}
                      <td><span className={`pill ${statusPill(o.status)}`}>{statusLabel(o.status)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'alterations' && (
              shownAlterations.length === 0 ? <p className="small faint" style={{ padding: 16, margin: 0 }}>No alterations yet - they are logged on an order&apos;s Fitting page.</p> : (
                <table className="table db-table">
                  <thead>
                    <tr><th>Client</th><th>Item description</th><th>Alteration type</th><th>Status</th><th>Date received</th><th>Due date</th><th>Confirmed</th><th className="num">Costing</th></tr>
                  </thead>
                  <tbody>
                    {shownAlterations.slice(0, limit).map((a) => (
                      <tr key={a.id}>
                        <td><button className="link" onClick={() => onOpenProject(a.project_id)}>{`${a.name} ${a.surname}`.trim()}</button></td>
                        <td className="wide-cell">
                          {(a.changes ?? []).length > 0 && <div className="small">{describeChanges(a, unit)}</div>}
                          <Cell value={a.description} multiline onSave={(v) => save(() => api.alterations.update({ id: a.id, description: v }))} />
                        </td>
                        <td><Cell value={a.kind} onSave={(v) => save(() => api.alterations.update({ id: a.id, kind: v }))} /></td>
                        <td>
                          <select className="select select-sm" value={a.status} aria-label="Alteration status"
                            onChange={(e) => save(() => api.alterations.update({ id: a.id, status: e.target.value }))}>
                            {ALTERATION_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select>
                        </td>
                        <td><Cell value={a.received_on} type="date" onSave={(v) => save(() => api.alterations.update({ id: a.id, receivedOn: v }))} /></td>
                        <td><Cell value={a.due_on} type="date" onSave={(v) => save(() => api.alterations.update({ id: a.id, dueOn: v }))} /></td>
                        <td><Cell value={a.confirmed_on} type="date" onSave={(v) => save(() => api.alterations.update({ id: a.id, confirmedOn: v }))} /></td>
                        <td className="num"><Cell value={a.cost ? String(a.cost) : ''} shown={a.cost ? formatMoney(a.cost) : ''} type="number"
                          onSave={(v) => save(() => api.alterations.update({ id: a.id, cost: Number(v) || 0 }))} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}

            {tab === 'extras' && (
              shownExtras.length === 0 ? <p className="small faint" style={{ padding: 16, margin: 0 }}>No extras on the books.</p> : (
                <table className="table db-table">
                  <thead><tr><th>Client</th><th>Extra type</th><th>Colour</th><th className="num">Quantity</th><th>Status</th></tr></thead>
                  <tbody>
                    {shownExtras.slice(0, limit).map((e) => (
                      <tr key={e.id}>
                        <td><button className="link" onClick={() => onOpenProject(e.project_id)}>{`${e.name} ${e.surname}`.trim()}</button></td>
                        <td><Cell value={e.extra_type} onSave={(v) => save(() => api.extras.update({ id: e.id, extraType: v }))} /></td>
                        <td><Cell value={e.colour} onSave={(v) => save(() => api.extras.update({ id: e.id, colour: v }))} /></td>
                        <td className="num"><Cell value={String(e.quantity ?? '')} type="number" onSave={(v) => save(() => api.extras.update({ id: e.id, quantity: Number(v) || 0 }))} /></td>
                        <td>
                          <select className="select select-sm" value={e.status} aria-label="Extra status"
                            onChange={(ev) => save(() => api.extras.update({ id: e.id, status: ev.target.value }))}>
                            {EXTRA_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
          </div>
        )}

        {data && (() => {
          const total = { current: shownOrders.length, completed: shownOrders.length, progress: count.progress, alterations: shownAlterations.length, extras: shownExtras.length }[tab];
          return total > limit ? (
            <div className="inline" style={{ marginTop: 12 }}>
              <span className="tiny faint">Showing {limit} of {total}</span>
              <button className="btn btn-sm" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, total - limit)} more</button>
            </div>
          ) : null;
        })()}
      </div>
    </>
  );
}

/** "Trousers Waist -2 cm (100 -> 98)" for each change an alteration carries, in the unit on screen. */
function describeChanges(a, unit) {
  return (a.changes ?? []).map((c) => {
    const amount = `${c.change > 0 ? '+' : '-'}${toDisplay(Math.abs(c.change), unit)} ${unitShort(unit)}`;
    const moved = c.before !== null && c.after !== null ? ` (${toDisplay(c.before, unit)} → ${toDisplay(c.after, unit)})` : '';
    return `${MEASUREMENTS[a.garment]?.label ?? a.garment} ${c.label || c.fieldId} ${amount}${moved}`;
  }).join('; ');
}

function describeAlteration(a, unit) {
  return [describeChanges(a, unit), a.description].filter(Boolean).join(' - ');
}

/**
 * One cell: text until clicked, then a box. Enter or leaving the box saves,
 * Escape puts it back. Only a real change is saved, so tabbing through the
 * sheet writes nothing.
 */
function Cell({ value, shown, derived, onSave, type = 'text', multiline, mono, strong }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const current = value ?? '';
  const display = shown !== undefined ? shown : current;

  if (!editing) {
    return (
      <button
        type="button"
        className={`db-cell ${derived && display ? 'derived' : ''} ${mono ? 'mono' : ''} ${strong ? 'strong' : ''}`}
        onClick={() => { setDraft(current); setEditing(true); }}
        title={derived && display ? 'Worked out from the order - click to write your own' : 'Click to change'}
      >
        {display ? (type === 'date' ? prettyDate(display) : display) : <span className="faint">-</span>}
      </button>
    );
  }

  const commit = () => {
    setEditing(false);
    if (draft !== current) onSave(draft);
  };
  const keys = (e) => {
    if (e.key === 'Escape') { setEditing(false); }
    if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
  };
  return multiline ? (
    <textarea className="textarea db-edit" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={keys} />
  ) : (
    <input className={`input db-edit ${mono ? 'mono' : ''}`} autoFocus type={type} value={draft}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={keys} />
  );
}

function Check({ checked, onChange, label }) {
  return <input type="checkbox" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />;
}
