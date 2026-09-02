import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { eventTypesWith, statusLabel, statusPill } from '../lib/catalog.js';
import { formatMoney } from '../lib/pricing.js';
import { quotedTotal } from '../lib/quote.js';
import { ConfirmButton, Empty, Modal, useToast } from '../components/ui.jsx';

export default function Dashboard({ onOpenProject, onOpenClient, steps, overrides, customOptions = [] }) {
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const toast = useToast();

  async function load() {
    setClients(await api.clients.list());
    setProjects(await api.projects.list());
  }

  useEffect(() => { load(); }, []);

  const q = query.trim().toLowerCase();
  const shown = q
    ? projects.filter((p) => `${p.name} ${p.surname} ${p.title} ${p.event_type}`.toLowerCase().includes(q))
    : projects;

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
                  <th>Client</th>
                  <th>Order</th>
                  <th>Event</th>
                  <th>Event date</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Value</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const spec = JSON.parse(p.spec_json || '{}');
                  return (
                    <tr key={p.id} className="clickable" onClick={() => onOpenProject(p.id)}>
                      <td style={{ fontWeight: 600 }}>{p.name} {p.surname}</td>
                      <td>{p.title}</td>
                      <td className="muted">{eventTypesWith(customOptions).find((e) => e.key === p.event_type)?.label ?? '-'}</td>
                      <td className="muted mono">{p.event_date || '-'}</td>
                      <td><span className={`pill ${statusPill(p.status)}`}>{statusLabel(p.status)}</span></td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatMoney(quotedTotal(p, spec, overrides, steps))}</td>
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
