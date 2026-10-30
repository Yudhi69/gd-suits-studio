import React, { useState } from 'react';
import { api, messageFor } from '../lib/api.js';
import { ConfirmButton, DebouncedInput, useToast } from './ui.jsx';

/**
 * The people on an order and the suits they are having.
 *
 * A wedding is one order with a groom, his groomsmen and often his father.
 * Each person added here becomes a client in their own right, so what is
 * captured for them is theirs and is waiting when they next come in.
 *
 * On an order of one - which is most orders - this is a single line and one
 * button, so nothing is in the way of the ordinary job.
 */
export default function PartyPanel({ project, reload }) {
  // Who is opened up. A wedding party of six filled the screen with inputs
  // nobody was looking at; folded, the order reads as a list of people and
  // only the one being worked on is open. An order of one - which is most
  // orders - opens straight away, because there is nothing to fold away.
  const [opened, setOpened] = useState({});
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', surname: '', role: '' });
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const members = project.members ?? [];
  const suits = project.suits ?? [];
  const suitsFor = (clientId) => suits.filter((s) => s.client_id === clientId);

  const run = async (fn, message) => {
    setBusy(true);
    try { await fn(); await reload(); if (message) toast(message, 'ok'); }
    catch (err) { toast(messageFor(err), 'err'); }
    finally { setBusy(false); }
  };

  async function addPerson() {
    if (!form.name.trim()) { toast('A first name at least.', 'err'); return; }
    await run(async () => {
      await api.members.add({ projectId: project.id, ...form });
      setForm({ name: '', surname: '', role: '' });
      setAdding(false);
    }, `${form.name} added to the order`);
  }

  /**
   * A second suit for someone already on the order. Groomsmen are usually the
   * same cloth and cut as each other, so a new suit can start as a copy of one
   * already specified - that is the whole saving on a party of six.
   */
  async function addSuit(clientId, copyFromId) {
    await run(async () => {
      const id = await api.suits.add({ projectId: project.id, clientId });
      const source = suits.find((s) => s.id === Number(copyFromId));
      if (source) {
        await api.suits.update({
          id,
          patch: { spec: source.spec, fabric_name: source.fabric_name, fabric_code: source.fabric_code, supplier: source.supplier },
        });
      }
    }, copyFromId ? 'Suit added, copied from the one chosen' : 'Suit added');
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>People &amp; suits</h3>
        <div className="spacer" />
        <span className="tiny faint">
          {members.length === 1
            ? 'One person on this order'
            : `${members.length} people, ${suits.length} suits`}
        </span>
      </div>
      <div className="card-pad">
        {members.map((m) => {
          const theirs = suitsFor(m.client_id);
          const open = opened[m.id] ?? members.length === 1;
          return (
          <div key={m.id} className={`party-person-block ${open ? 'open' : ''}`}>
            <button
              type="button"
              className="party-head"
              aria-expanded={open}
              onClick={() => setOpened((o) => ({ ...o, [m.id]: !open }))}
            >
              <span className="party-caret" aria-hidden="true">{open ? '\u25be' : '\u25b8'}</span>
              <span className="party-name">{m.name} {m.surname}</span>
              {m.role && <span className="party-role">{m.role}</span>}
              <span className="spacer" />
              <span className="tiny faint">
                {theirs.length === 1 ? '1 suit' : `${theirs.length} suits`}
              </span>
            </button>

            {open && (
              <div className="party-body">
                <div className="party-field">
                  <span className="party-label">Role</span>
                  <DebouncedInput
                    className="input input-bare"
                    placeholder="Groom, best man, father..."
                    value={m.role}
                    onCommit={(v) => run(() => api.members.update({ id: m.id, role: v }))}
                  />
                </div>

                {theirs.map((s) => (
                  <div key={s.id} className="party-field">
                    <span className="party-label">Suit</span>
                    <DebouncedInput
                      className="input input-bare"
                      placeholder={s.fabric_name || 'Navy three-piece...'}
                      value={s.label}
                      onCommit={(v) => run(() => api.suits.update({ id: s.id, patch: { label: v } }))}
                    />
                    {suits.length > 1 && (
                      <ConfirmButton
                        className="btn btn-icon btn-ghost btn-danger"
                        confirmLabel="Remove?"
                        title="Remove this suit"
                        onConfirm={() => run(() => api.suits.remove({ id: s.id }), 'Suit removed')}
                      >
                        &times;
                      </ConfirmButton>
                    )}
                  </div>
                ))}

                <div className="party-actions">
                  <select
                    className="select btn-sm"
                    value=""
                    disabled={busy}
                    onChange={(e) => addSuit(m.client_id, e.target.value === 'blank' ? null : e.target.value)}
                  >
                    <option value="" disabled>Add a suit...</option>
                    <option value="blank">New, empty</option>
                    {suits.map((s) => (
                      <option key={s.id} value={s.id}>
                        Copy of {s.name}&apos;s {s.label || s.fabric_name || 'suit'}
                      </option>
                    ))}
                  </select>

                  {members.length > 1 && (
                    <ConfirmButton
                      className="btn btn-sm btn-ghost btn-danger"
                      confirmLabel="Take off the order?"
                      onConfirm={() => run(() => api.members.remove({ id: m.id }), `${m.name} taken off the order`)}
                    >
                      Take off the order
                    </ConfirmButton>
                  )}
                </div>
              </div>
            )}
          </div>
          );
        })}

        {adding ? (
          <div className="inline" style={{ marginTop: 12, alignItems: 'flex-end' }}>
            <input className="input" placeholder="First name" value={form.name} autoFocus
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" placeholder="Surname" value={form.surname}
              onChange={(e) => setForm({ ...form, surname: e.target.value })} />
            <input className="input" placeholder="Role" value={form.role} style={{ maxWidth: 150 }}
              onChange={(e) => setForm({ ...form, role: e.target.value })} />
            <button className="btn btn-primary btn-sm" onClick={addPerson} disabled={busy}>Add</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        ) : (
          <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
            Add someone to this order
          </button>
        )}

        <p className="tiny faint" style={{ margin: '10px 0 0' }}>
          Everyone here gets their own client file, so their measurements and photographs are waiting
          the next time they come in.
        </p>
      </div>
    </div>
  );
}
