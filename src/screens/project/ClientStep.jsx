import React from 'react';
import { api } from '../../lib/api.js';
import { eventTypesWith, PROJECT_STATUSES, PROCESS_DATES } from '../../lib/catalog.js';
import { AddOptionTile } from '../../components/AddOption.jsx';
import { DebouncedInput, Switch, useToast } from '../../components/ui.jsx';
import NotesPanel from '../../components/NotesPanel.jsx';

/** Age today from a date of birth, or "-" when there is not one yet. */
function ageFrom(dob) {
  if (!dob) return '-';
  const born = new Date(dob);
  if (Number.isNaN(born.getTime())) return '-';
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const beforeBirthday =
    now.getMonth() < born.getMonth() ||
    (now.getMonth() === born.getMonth() && now.getDate() < born.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? String(age) : '-';
}

export default function ClientStep({ ctx, customOptions = [], onCatalogChanged }) {
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
        dob: project.dob,
        postalAddress: project.postal_address,
        isMinor: !!project.is_minor,
        secondaryName: project.secondary_name,
        secondaryRelationship: project.secondary_relationship,
        secondaryContact: project.secondary_contact,
        secondaryEmail: project.secondary_email,
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
                <label>Date of birth</label>
                <DebouncedInput className="input" type="date" value={project.dob} onCommit={(v) => saveClient({ dob: v })} />
              </div>
              <div className="field">
                <label>Age</label>
                {/* Worked out, never typed: an age keyed in today is wrong by
                    next birthday, and it decides whether a parent signs. */}
                <input className="input" value={ageFrom(project.dob)} readOnly tabIndex={-1} />
                <div className="hint">
                  {ageFrom(project.dob) === '-'
                    ? 'From the date of birth.'
                    : Number(ageFrom(project.dob)) < 18
                      ? 'Under 18 - a parent or provider signs and pays.'
                      : 'From the date of birth.'}
                </div>
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
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Postal address</label>
              <DebouncedInput
                as="textarea"
                className="textarea"
                value={project.postal_address}
                placeholder="Where the finished suit is sent, if it is not collected"
                onCommit={(v) => saveClient({ postalAddress: v })}
              />
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h3>Parent or provider</h3>
            <div className="spacer" />
            <div className="inline">
              <span className="tiny faint">Client is under 18</span>
              <Switch
                checked={!!project.is_minor}
                onChange={(val) => saveClient({ isMinor: val })}
              />
            </div>
          </div>
          <div className="card-pad">
            {!project.is_minor ? (
              <p className="small muted" style={{ margin: 0 }}>
                Switch this on for a matric ball or any client under 18 - the person who signs off and pays is
                usually not the person being measured, and both need to be on the file.
              </p>
            ) : (
              <>
                <div className="row">
                  <div className="field">
                    <label>Name</label>
                    <DebouncedInput
                      className="input"
                      value={project.secondary_name}
                      placeholder="Parent or guardian"
                      onCommit={(val) => saveClient({ secondaryName: val })}
                    />
                  </div>
                  <div className="field">
                    <label>Relationship</label>
                    <DebouncedInput
                      className="input"
                      value={project.secondary_relationship}
                      placeholder="Mother, father, guardian..."
                      onCommit={(val) => saveClient({ secondaryRelationship: val })}
                    />
                  </div>
                </div>
                <div className="row">
                  <div className="field">
                    <label>Contact number</label>
                    <DebouncedInput
                      className="input"
                      value={project.secondary_contact}
                      onCommit={(val) => saveClient({ secondaryContact: val })}
                    />
                  </div>
                  <div className="field">
                    <label>Email</label>
                    <DebouncedInput
                      className="input"
                      type="email"
                      value={project.secondary_email}
                      onCommit={(val) => saveClient({ secondaryEmail: val })}
                    />
                  </div>
                </div>
                <p className="tiny faint" style={{ margin: 0 }}>
                  Approvals and the quote should go to this person.
                </p>
              </>
            )}
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head"><h3>The occasion</h3></div>
          <div className="card-pad">
            <div className="field">
              <label>Order code</label>
              <DebouncedInput className="input" value={project.title} onCommit={(v) => updateProject({ title: v })} />
            </div>

            <div className="field">
              <label>Event type</label>
              <div className="options">
                {eventTypesWith(customOptions).map((e) => (
                  <button
                    key={e.key}
                    className={`option ${project.event_type === e.key ? 'selected' : ''}`}
                    onClick={() => updateProject({ event_type: e.key })}
                  >
                    <div className="option-label">{e.label}</div>
                  </button>
                ))}
                {onCatalogChanged && (
                  <AddOptionTile fieldId="eventType" fieldLabel="Event type" onAdded={onCatalogChanged} />
                )}
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
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h3>Schedule</h3>
            <div className="spacer" />
            <span className="tiny faint">The dates the order actually runs to</span>
          </div>
          <div className="card-pad">
            <div className="grid grid-2">
              {PROCESS_DATES.map(({ key, label }) => (
                <div className="field" key={key} style={{ marginBottom: 0 }}>
                  <label>{label}</label>
                  <DebouncedInput
                    className="input"
                    type="date"
                    value={project[key]}
                    onCommit={(val) => updateProject({ [key]: val })}
                  />
                </div>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 12 }}>{scheduleWarning(project)}</div>

            {/* These sit with the dates because that is when they are ticked. */}
            <div className="row" style={{ marginTop: 14 }}>
              <div className="toggle-row">
                <span className="small">Measurements taken</span>
                <Switch
                  checked={!!project.measurements_done}
                  onChange={(val) => updateProject({ measurements_done: val })}
                />
              </div>
              <div className="toggle-row">
                <span className="small">Measurement form completed</span>
                <Switch
                  checked={!!project.measurement_form_received}
                  onChange={(val) => updateProject({ measurement_form_received: val })}
                />
              </div>
            </div>

            <div className="field">
              <label>Status</label>
              <select className="select" value={project.status} onChange={(e) => updateProject({ status: e.target.value })}>
                {PROJECT_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <div className="hint">
                "Ready for first fitting" is the suit waiting on the rail; the fitting itself is where the
                corrections get marked up. A completed order stays on the books until the balance is in.
              </div>
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

/**
 * Reads the schedule as a sequence rather than four independent fields - a
 * final fitting booked after the event is the kind of mistake that is obvious
 * once stated and invisible in a form.
 */
function scheduleWarning(project) {
  const steps = [
    ['consultation_date', 'first consultation'],
    ['measurement_date', 'measurements'],
    ['first_fitting_date', 'first fitting'],
    ['final_fitting_date', 'final fitting'],
  ]
    .map(([key, label]) => ({ label, date: project[key] ? new Date(project[key]) : null }))
    .filter((s) => s.date && !Number.isNaN(s.date.valueOf()));

  for (let i = 1; i < steps.length; i++) {
    if (steps[i].date < steps[i - 1].date) {
      return `The ${steps[i].label} is booked before the ${steps[i - 1].label}.`;
    }
  }

  const event = project.event_date ? new Date(project.event_date) : null;
  const last = steps[steps.length - 1];
  if (event && last && !Number.isNaN(event.valueOf()) && last.date > event) {
    return `The ${last.label} is after the event date.`;
  }
  if (!steps.length) return 'Fill these in as the order moves, so the dashboard shows where it stands.';
  return `${steps.length} of 4 dates set.`;
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
