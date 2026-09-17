import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { eventTypesWith, statusLabel, statusPill, PROJECT_STATUSES } from '../lib/catalog.js';
import { formatMoney } from '../lib/pricing.js';
import { quotedTotal } from '../lib/quote.js';
import { ConfirmButton, Empty, Modal, useToast } from '../components/ui.jsx';

export default function Dashboard({ onOpenProject, onOpenClient, steps, overrides, customOptions = [] }) {
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  // Most recently worked on first - the order you had open yesterday is the
  // one you want this morning.
  const [sort, setSort] = useState({ key: 'updated', dir: 'desc' });
  const toast = useToast();

  async function load() {
    setClients(await api.clients.list());
    setProjects(await api.projects.list());
  }

  useEffect(() => { load(); }, []);

  const q = query.trim().toLowerCase();
  const found = q
    ? projects.filter((p) =>
        `${p.name} ${p.surname} ${p.title} ${p.event_type} ${p.order_ref}`.toLowerCase().includes(q))
    : projects;

  /**
   * What each column sorts on. Status sorts by where it sits in the pipeline
   * rather than by its name, because "Alterations" before "Delivered" is
   * alphabetical nonsense - the useful order is how far along the work is.
   */
  const sortKeys = {
    ref: (p) => p.order_ref || '',
    client: (p) => `${p.surname} ${p.name}`.trim().toLowerCase(),
    order: (p) => (p.title || '').toLowerCase(),
    event: (p) => (eventTypesWith(customOptions).find((e) => e.key === p.event_type)?.label ?? '').toLowerCase(),
    date: (p) => p.event_date || '',
    status: (p) => PROJECT_STATUSES.findIndex((s) => s.key === p.status),
    value: (p) => quotedTotal(p, JSON.parse(p.spec_json || '{}'), overrides, steps),
    updated: (p) => p.updated_at || '',
  };

  const shown = [...found].sort((a, b) => {
    const read = sortKeys[sort.key] ?? sortKeys.updated;
    const [x, y] = [read(a), read(b)];
    // A missing date or value sorts last whichever way the column is facing,
    // so turning the arrow around never fills the top of the list with blanks.
    const blank = (v) => v === '' || v === null || v === undefined || v === -1;
    if (blank(x) !== blank(y)) return blank(x) ? 1 : -1;
    const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  const toggle = (key) =>
    setSort((s) => ({
      key,
      // A new column starts in the order that reads most naturally for it:
      // biggest first for money and newest first for dates, A-Z for names.
      dir: s.key === key ? (s.dir === 'asc' ? 'desc' : 'asc')
        : ['value', 'date', 'updated'].includes(key) ? 'desc' : 'asc',
    }));

  return (
    <>
      <div className="topbar">
        <h1>Orders</h1>
        <div className="spacer" />
        <input
          className="input"
          style={{ maxWidth: 260 }}
          placeholder="Search client or order..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn btn-gold" onClick={() => setCreating(true)}>New consultation</button>
      </div>

      <div className="content">
        <div className="grid grid-3" style={{ marginBottom: 22 }}>
          <StatCard label="Clients" value={clients.length} />
          <StatCard label="Orders in progress" value={projects.filter((p) => p.status !== 'delivered').length} />
          <StatCard
            label="Quoted value"
            value={formatMoney(projects.reduce((sum, p) => sum + quotedTotal(p, JSON.parse(p.spec_json || '{}'), overrides, steps), 0))}
          />
        </div>

        {shown.length === 0 ? (
          <Empty
            title={projects.length ? 'Nothing matches that search' : 'No consultations yet'}
            action={!projects.length && <button className="btn btn-gold" onClick={() => setCreating(true)}>Start the first one</button>}
          >
            {!projects.length && 'Start a consultation to capture the client, their photos and the suit they want.'}
          </Empty>
        ) : (
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label="Ref" col="ref" sort={sort} onSort={toggle} />
                  <SortHeader label="Client" col="client" sort={sort} onSort={toggle} />
                  <SortHeader label="Order" col="order" sort={sort} onSort={toggle} />
                  <SortHeader label="Event" col="event" sort={sort} onSort={toggle} />
                  <SortHeader label="Event date" col="date" sort={sort} onSort={toggle} />
                  <SortHeader label="Status" col="status" sort={sort} onSort={toggle} />
                  <SortHeader label="Value" col="value" sort={sort} onSort={toggle} align="right" />
                  <SortHeader label="Updated" col="updated" sort={sort} onSort={toggle} />
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const spec = JSON.parse(p.spec_json || '{}');
                  return (
                    <tr key={p.id} className="clickable" onClick={() => onOpenProject(p.id)}>
                      <td className="mono tiny faint order-ref">{p.order_ref || '-'}</td>
                      <td style={{ fontWeight: 600 }}>{p.name} {p.surname}</td>
                      <td>{p.title}</td>
                      <td className="muted">{eventTypesWith(customOptions).find((e) => e.key === p.event_type)?.label ?? '-'}</td>
                      <td className="muted mono">{p.event_date || '-'}</td>
                      <td><span className={`pill ${statusPill(p.status)}`}>{statusLabel(p.status)}</span></td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatMoney(quotedTotal(p, spec, overrides, steps))}</td>
                      <td className="muted mono tiny">{(p.updated_at || '').slice(0, 10) || '-'}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                        <button className="btn btn-sm btn-ghost" onClick={() => onOpenClient(p.client_id)}>Client file</button>
                        <ConfirmButton
                          className="btn btn-sm btn-ghost btn-danger"
                          confirmLabel="Delete order?"
                          onConfirm={async () => {
                            await api.projects.delete({ id: p.id });
                            toast('Order deleted');
                            load();
                          }}
                        >
                          Delete
                        </ConfirmButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <NewConsultation
          clients={clients}
          customOptions={customOptions}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); onOpenProject(id); }}
        />
      )}
    </>
  );
}

/**
 * A column heading that sorts. The arrow shows only on the column in force,
 * so the header row stays quiet rather than sprouting six of them.
 */
function SortHeader({ label, col, sort, onSort, align }) {
  const active = sort.key === col;
  return (
    <th style={{ textAlign: align || 'left' }}>
      <button
        type="button"
        className={`th-sort ${active ? 'is-active' : ''}`}
        onClick={() => onSort(col)}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        title={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <span className="th-arrow" aria-hidden="true">{active ? (sort.dir === 'asc' ? '↑' : '↓') : ''}</span>
      </button>
    </th>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="card card-pad">
      <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontFamily: 'var(--serif)', fontSize: 28, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function NewConsultation({ clients, onClose, onCreated, customOptions = [] }) {
  const [mode, setMode] = useState(clients.length ? 'existing' : 'new');
  const [clientId, setClientId] = useState(clients[0]?.id ?? null);
  const [form, setForm] = useState({ name: '', surname: '', contact: '', email: '' });
  const [order, setOrder] = useState({ title: '', eventType: 'wedding', eventDate: '', deliveryDate: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function create() {
    setBusy(true);
    try {
      let id = clientId;
      if (mode === 'new') {
        if (!form.name.trim()) throw new Error('A first name is needed to open a client file.');
        id = await api.clients.save(form);
      }
      if (!id) throw new Error('Choose a client first.');

      const projectId = await api.projects.create({
        clientId: id,
        title: order.title.trim() || `${eventTypesWith(customOptions).find((e) => e.key === order.eventType)?.label ?? 'New'} suit`,
        eventType: order.eventType,
        eventDate: order.eventDate,
        deliveryDate: order.deliveryDate,
      });

      // A returning client keeps their measurements - seed the new order.
      const carried = await api.measurements.seedFromClient({ projectId, clientId: id });
      if (carried) toast(`${carried} measurement${carried === 1 ? '' : 's'} carried over from this client's file`, 'ok');

      onCreated(projectId);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New consultation"
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" onClick={create} disabled={busy}>{busy ? 'Creating...' : 'Start consultation'}</button>
        </>
      }
    >
      {clients.length > 0 && (
        <div className="stepper" style={{ marginBottom: 18 }}>
          <button className={`step-tab ${mode === 'existing' ? 'active' : ''}`} onClick={() => setMode('existing')}>Returning client</button>
          <button className={`step-tab ${mode === 'new' ? 'active' : ''}`} onClick={() => setMode('new')}>New client</button>
        </div>
      )}

      {mode === 'existing' ? (
        <div className="field">
          <label>Client</label>
          <select className="select" value={clientId ?? ''} onChange={(e) => setClientId(Number(e.target.value))}>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.surname} - {c.project_count} order{c.project_count === 1 ? '' : 's'}
              </option>
            ))}
          </select>
          <div className="hint">Their references and measurements carry over automatically.</div>
        </div>
      ) : (
        <>
          <div className="row">
            <div className="field">
              <label>Name</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            </div>
            <div className="field">
              <label>Surname</label>
              <input className="input" value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Contact number</label>
              <input className="input" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
            </div>
            <div className="field">
              <label>Email</label>
              <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
        </>
      )}

      <hr className="divider" />

      <div className="field">
        <label>Order name</label>
        <input
          className="input"
          placeholder="e.g. Wedding suit - navy three piece"
          value={order.title}
          onChange={(e) => setOrder({ ...order, title: e.target.value })}
        />
      </div>
      <div className="field">
        <label>Event type</label>
        <select className="select" value={order.eventType} onChange={(e) => setOrder({ ...order, eventType: e.target.value })}>
          {eventTypesWith(customOptions).map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
        </select>
      </div>
      <div className="row">
        <div className="field">
          <label>Event date</label>
          <input className="input" type="date" value={order.eventDate} onChange={(e) => setOrder({ ...order, eventDate: e.target.value })} />
        </div>
        <div className="field">
          <label>Preferred delivery date</label>
          <input className="input" type="date" value={order.deliveryDate} onChange={(e) => setOrder({ ...order, deliveryDate: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}
