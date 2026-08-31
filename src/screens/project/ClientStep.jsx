import React from 'react';
import { api } from '../../lib/api.js';
import { EVENT_TYPES } from '../../lib/catalog.js';
import { DebouncedInput, useToast } from '../../components/ui.jsx';
import NotesPanel from '../../components/NotesPanel.jsx';

export default function ClientStep({ ctx }) {
  const { project, updateProject, reload, addNote, deleteNote } = ctx;
  const toast = useToast();

  async function saveClient(patch) {
    try {
      await api.clients.save({
        id: project.client_id,
        name: project.name,
        surname: project.surname,
        contact: project.contact,
        email: project.email,
        ...patch,
      });
      await reload();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div style={{ flex: 2, minWidth: 420 }}>
        <div className="card">
          <div className="card-head"><h3>Client</h3></div>
          <div className="card-pad">
            <div className="row">
              <div className="field">
                <label>Name</label>
                <DebouncedInput className="input" value={project.name} onCommit={(v) => saveClient({ name: v })} />
              </div>
              <div className="field">
                <label>Surname</label>
                <DebouncedInput className="input" value={project.surname} onCommit={(v) => saveClient({ surname: v })} />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>Contact number</label>
                <DebouncedInput className="input" value={project.contact} onCommit={(v) => saveClient({ contact: v })} />
              </div>
              <div className="field">
                <label>Email</label>
                <DebouncedInput className="input" type="email" value={project.email} onCommit={(v) => saveClient({ email: v })} />
              </div>
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head"><h3>The occasion</h3></div>
          <div className="card-pad">
            <div className="field">
              <label>Order name</label>
              <DebouncedInput className="input" value={project.title} onCommit={(v) => updateProject({ title: v })} />
            </div>

            <div className="field">
              <label>Event type</label>
              <div className="options">
                {EVENT_TYPES.map((e) => (
                  <button
                    key={e.key}
                    className={`option ${project.event_type === e.key ? 'selected' : ''}`}
                    onClick={() => updateProject({ event_type: e.key })}
                  >
                    <div className="option-label">{e.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {project.event_type === 'other' && (
              <div className="field">
                <label>Describe the occasion</label>
                <DebouncedInput className="input" value={project.event_other} onCommit={(v) => updateProject({ event_other: v })} />
              </div>
            )}

            <div className="row">
              <div className="field">
                <label>Event date</label>
                <DebouncedInput className="input" type="date" value={project.event_date} onCommit={(v) => updateProject({ event_date: v })} />
              </div>
              <div className="field">
                <label>Preferred delivery date</label>
                <DebouncedInput className="input" type="date" value={project.delivery_date} onCommit={(v) => updateProject({ delivery_date: v })} />
                <div className="hint">{deliveryWarning(project)}</div>
              </div>
            </div>

            <div className="field">
              <label>Status</label>
              <select className="select" value={project.status} onChange={(e) => updateProject({ status: e.target.value })}>
                <option value="draft">Draft</option>
                <option value="approved">Approved by client</option>
                <option value="fitting">In fitting</option>
                <option value="delivered">Delivered</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 300 }}>
        <NotesPanel
          step="client"
          notes={project.notes}
          onAdd={(body) => addNote('client', body)}
          onDelete={deleteNote}
        />
      </div>
    </div>
  );
}

/** Flags a delivery date that leaves no room before the event. */
function deliveryWarning(project) {
  if (!project.event_date || !project.delivery_date) return 'Leave a week between delivery and the event for final alterations.';
  const event = new Date(project.event_date);
  const delivery = new Date(project.delivery_date);
  const days = Math.round((event - delivery) / 86400000);
  if (Number.isNaN(days)) return '';
  if (days < 0) return 'Delivery is after the event date.';
  if (days < 7) return `Only ${days} day${days === 1 ? '' : 's'} between delivery and the event - tight for alterations.`;
  return `${days} days of slack before the event.`;
}
