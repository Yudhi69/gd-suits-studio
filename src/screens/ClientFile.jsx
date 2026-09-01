import React, { useEffect, useState } from 'react';
import { api, projectMedia } from '../lib/api.js';
import { buildBreakdown, formatMoney } from '../lib/pricing.js';
import { EVENT_TYPES, statusLabel, statusPill } from '../lib/catalog.js';
import { formatMeasure, unitLabel } from '../lib/units.js';
import { Empty, Spinner } from '../components/ui.jsx';
import ReferenceLibrary from '../components/ReferenceLibrary.jsx';

/**
 * Everything the shop knows about one person: their orders, their reference
 * images and the body record that carries between suits. This is the screen
 * the brief's "clients revisit their profile" depends on.
 */
export default function ClientFile({ clientId, onBack, onOpenProject, steps, overrides, unit = 'cm' }) {
  const [client, setClient] = useState(null);
  const [projects, setProjects] = useState([]);
  const [references, setReferences] = useState([]);
  const [history, setHistory] = useState(null);
  const [measurements, setMeasurements] = useState([]);
  const [tab, setTab] = useState('orders');

  async function load() {
    setClient(await api.clients.get({ id: clientId }));
    setProjects(await api.projects.list({ clientId }));
    setReferences(await api.references.list({ clientId }));
    setHistory(await api.references.history({ clientId }));
    setMeasurements(await api.clientMeasurements.list({ clientId }));
  }

  useEffect(() => { load(); }, [clientId]);

  if (!client) return <div className="content center" style={{ paddingTop: 80 }}><Spinner /></div>;

  return (
    <>
      <div className="topbar">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>&larr; Orders</button>
        <div>
          <h2>{client.name} {client.surname}</h2>
          <div className="tiny faint">{client.contact} {client.email && `· ${client.email}`}</div>
        </div>
        <div className="spacer" />
        <span className="pill pill-quiet">{projects.length} order{projects.length === 1 ? '' : 's'}</span>
      </div>

      <div className="content">
        <div className="stepper" style={{ marginBottom: 20 }}>
          {[
            ['orders', `Orders (${projects.length})`],
            ['references', `Style references (${references.length})`],
            ['body', `Body record (${measurements.filter((m) => m.value !== null).length})`],
          ].map(([key, label]) => (
            <button key={key} className={`step-tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>

        {tab === 'orders' && (
          projects.length === 0 ? <Empty title="No orders yet" /> : (
            <div className="card">
              <table className="table">
                <thead>
                  <tr><th>Order</th><th>Event</th><th>Date</th><th>Status</th><th style={{ textAlign: 'right' }}>Value</th></tr>
                </thead>
                <tbody>
                  {projects.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => onOpenProject(p.id)}>
                      <td style={{ fontWeight: 600 }}>{p.title}</td>
                      <td className="muted">{EVENT_TYPES.find((e) => e.key === p.event_type)?.label ?? '-'}</td>
                      <td className="muted mono">{p.event_date || '-'}</td>
                      <td><span className={`pill ${statusPill(p.status)}`}>{statusLabel(p.status)}</span></td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {formatMoney(buildBreakdown(JSON.parse(p.spec_json || '{}'), overrides, steps).total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {tab === 'references' && (
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>
              These belong to {client.name}, not to any one order. Anything here can be fed into a future render,
              and the "used" count shows what they keep coming back to.
            </p>
            <ReferenceLibrary
              clientId={clientId}
              references={references}
              onChanged={load}
            />
            {history?.pastSpecs?.length > 1 && (
              <div className="card">
                <div className="card-head"><h3>What they have chosen before</h3></div>
                <div className="card-pad">
                  {history.pastSpecs.map((p) => (
                    <div key={p.id} className="price-line">
                      <span className="small">{p.title}</span>
                      <span className="small muted">
                        {[p.spec.suitType === 'three_piece' ? '3-piece' : '2-piece', p.spec.lapel && `${p.spec.lapel} lapel`, p.spec.jacketFit && `${p.spec.jacketFit} fit`]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'body' && (
          <div className="card">
            <div className="card-head">
              <h3>Body record</h3>
              <div className="spacer" />
              <span className="tiny faint">In {unitLabel(unit)} · carried into every new order automatically</span>
            </div>
            <div className="card-pad">
              {measurements.filter((m) => m.value !== null).length === 0 ? (
                <Empty title="No measurements recorded yet">Take them on an order and they land here.</Empty>
              ) : (
                ['jacket', 'waistcoat', 'pants'].map((garment) => {
                  const rows = measurements.filter((m) => m.garment === garment && m.value !== null);
                  if (!rows.length) return null;
                  return (
                    <div key={garment}>
                      <div className="price-group-title" style={{ textTransform: 'capitalize' }}>{garment}</div>
                      {rows.map((m) => (
                        <div className="price-line" key={m.id}>
                          <span className="muted">{m.field_id}</span>
                          <span className="mono">{formatMeasure(m.value, unit)} <span className="faint tiny">{m.updated_at?.slice(0, 10)}</span></span>
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
