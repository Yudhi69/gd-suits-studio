import React, { useEffect, useRef, useState } from 'react';
import { api, messageFor } from '../lib/api.js';
import { priceCatalogEntries, formatMoney } from '../lib/pricing.js';
import { CURRENCY } from '../lib/catalog.js';
import { Banner, Collapsible, ConfirmButton, DebouncedInput, Modal, SecretInput, Spinner, Switch, useToast } from '../components/ui.jsx';

/** Bytes as megabytes, which is the only unit an installer is ever read in. */
const megabytes = (bytes) => (Number(bytes || 0) / (1024 * 1024)).toFixed(1);

/**
 * The shop's own details.
 *
 * Whose name goes on the order form, what number a client rings, what the
 * terms say, and how much has to be in before cutting starts. All of it was
 * written into the code, which meant a new telephone number needed a new
 * build.
 */
function BusinessDetails() {
  const [shop, setShop] = useState(null);
  const toast = useToast();

  useEffect(() => { api.business.get().then(setShop).catch(() => {}); }, []);
  if (!shop) return null;

  const save = async (patch) => {
    const next = { ...shop, ...patch };
    setShop(next);
    await api.settings.set({ key: 'business', value: next });
  };

  const field = (key, label, hint) => (
    <div className="field">
      <label>{label}</label>
      <DebouncedInput className="input" value={shop[key] ?? ''} onCommit={(v) => save({ [key]: v })} />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <h3>Your details</h3>
        <div className="spacer" />
        <span className="tiny faint">Printed on the order form and signed off on every quote</span>
      </div>
      <div className="card-pad">
        <div className="grid grid-2">
          {field('businessName', 'Business name')}
          {field('name', 'Your name')}
          {field('role', 'Title')}
          {field('phone', 'Telephone')}
        </div>
        {field('email', 'Email', 'Where clients reply when you send them a quote.')}

        <div className="field" style={{ maxWidth: 220 }}>
          <label>Deposit before cutting</label>
          <div className="inline">
            <DebouncedInput
              className="input measure-input"
              type="number"
              min="0"
              max="100"
              value={Math.round((shop.depositFraction ?? 0.5) * 100)}
              onCommit={(v) => {
                const pct = Number(v);
                if (!Number.isFinite(pct) || pct < 0 || pct > 100) { toast('A deposit is between 0 and 100 percent.', 'err'); return; }
                save({ depositFraction: pct / 100 });
              }}
            />
            <span className="muted">%</span>
          </div>
          <div className="hint">The Business page flags any order cut before this much is paid.</div>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label>Terms and conditions</label>
          <DebouncedInput
            as="textarea"
            className="textarea"
            style={{ minHeight: 170 }}
            value={(shop.terms ?? []).join('\n')}
            onCommit={(v) => save({ terms: v.split('\n').map((t) => t.trim()).filter(Boolean) })}
          />
          <div className="hint">One clause per line. These print on the order form the client signs.</div>
        </div>
      </div>
    </div>
  );
}

/**
 * The wording of the quote email.
 *
 * It is GD's letter, not the app's, so he writes it once here and every quote
 * goes out in his voice. The placeholders are filled from the order when the
 * draft opens; one the app does not recognise is left exactly as typed, so a
 * mis-spelling turns up in the draft instead of disappearing.
 */
function QuoteEmail() {
  const [state, setState] = useState(null);
  const toast = useToast();

  useEffect(() => { api.quote.template().then(setState).catch(() => {}); }, []);
  if (!state) return null;

  const save = async (patch) => {
    const next = { ...state, ...patch };
    setState(next);
    await api.settings.set({ key: 'quoteEmailTemplate', value: next.template });
    await api.settings.set({ key: 'quoteEmailSubject', value: next.subject });
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <h3>Quote email</h3>
        <div className="spacer" />
        <button
          className="btn btn-sm btn-ghost"
          onClick={async () => { await save({ ...state.defaults }); toast('Wording put back to the original', 'ok'); }}
        >
          Reset wording
        </button>
      </div>
      <div className="card-pad">
        <div className="field">
          <label>Subject</label>
          <DebouncedInput className="input" value={state.subject} onCommit={(v) => save({ subject: v })} />
        </div>
        <div className="field">
          <label>Message</label>
          <DebouncedInput
            as="textarea"
            className="textarea"
            style={{ minHeight: 230, fontFamily: 'var(--mono)', fontSize: 12.5 }}
            value={state.template}
            onCommit={(v) => save({ template: v })}
          />
        </div>
        <div className="hint" style={{ marginBottom: 8 }}>
          Anything in braces is filled in from the order when the draft opens.
        </div>
        <div className="grid grid-2">
          {state.variables.map((v) => (
            <div key={v.key} className="price-line" style={{ padding: '4px 0' }}>
              <code className="mono tiny">{`{${v.key}}`}</code>
              <span className="tiny faint">{v.describes}</span>
            </div>
          ))}
        </div>
        <p className="tiny faint" style={{ margin: '10px 0 0' }}>
          Nothing is sent from here. The draft opens in your own mail program and you read it before it goes.
        </p>
      </div>
    </div>
  );
}


/**
 * Standing emails: wording GD writes once, offered when it falls due.
 *
 * The app does not send them. There is no mail server here and no password
 * for his mailbox - a draft opens in his own mail client, written and
 * addressed, and he presses send. A tool that quietly emails clients on a
 * timer is one bad template away from sending four hundred people the wrong
 * thing, and he would hear about it from a client rather than from the app.
 */
function StandingEmails() {
  const [meta, setMeta] = useState(null);
  const [clients, setClients] = useState([]);
  const [due, setDue] = useState([]);
  const [editing, setEditing] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const toast = useToast();

  // Both halves are caught: a page that throws on mount leaves a spinner
  // that never resolves, and nothing on screen says why.
  const load = React.useCallback(async () => {
    try {
      setMeta(await api.mail.rules());
      setDue((await api.mail.due()).due);
    } catch (err) {
      setMeta((m) => m ?? { rules: [], anchors: [], audiences: [], variables: [], defaults: {} });
      setLoadError(messageFor(err));
    }
  }, []);

  useEffect(() => {
    load();
    api.clients.list().then(setClients).catch(() => setClients([]));
  }, [load]);

  async function save(rule) {
    try {
      await api.mail.saveRule(rule);
      setEditing(null);
      await load();
      toast(rule.id ? 'Email saved' : 'Email added', 'ok');
    } catch (err) { toast(messageFor(err), 'err'); }
  }

  if (!meta) return <div className="card"><div className="card-pad"><Spinner /></div></div>;

  return (
    <div className="stack">
      {loadError && <Banner kind="warn">{loadError}</Banner>}

      <div className="card">
        <div className="card-head">
          <h3>Standing emails</h3>
          <div className="spacer" />
          <button className="btn btn-gold btn-sm" onClick={() => setEditing({})}>New email</button>
        </div>
        <div className="card-pad">
          {meta.rules.length === 0 && (
            <p className="muted" style={{ margin: 0 }}>
              Nothing standing yet. A reminder a week before the final fitting, say, or a note the day
              after delivery.
            </p>
          )}

          {meta.rules.map((r) => (
            <div key={r.id} className="mail-rule">
              <div className="mail-rule-main">
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                <div className="tiny faint">
                  {describeRule(r, meta.anchors)}
                  {r.audience === 'only' && ` - ${r.clientIds.length} client${r.clientIds.length === 1 ? '' : 's'} only`}
                  {r.audience === 'except' && ` - everyone except ${r.clientIds.length}`}
                </div>
              </div>
              <Switch checked={r.enabled} onChange={(on) => save({ ...r, offsetDays: r.offset_days, enabled: on })} />
              <button className="btn btn-sm" onClick={() => setEditing({ ...r, offsetDays: r.offset_days })}>Edit</button>
              <ConfirmButton
                className="btn btn-sm btn-ghost btn-danger"
                confirmLabel="Delete this email?"
                onConfirm={async () => { await api.mail.deleteRule({ id: r.id }); await load(); toast('Email deleted', 'ok'); }}
              >
                Delete
              </ConfirmButton>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Due now</h3>
          <div className="spacer" />
          <span className="tiny faint">{due.length === 0 ? 'Nothing waiting' : `${due.length} waiting`}</span>
        </div>
        <div className="card-pad">
          {due.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              Nothing has come due. This is checked each time the page opens - the app never sends
              anything on its own.
            </p>
          ) : (
            due.map((d) => (
              <div key={`${d.ruleId}-${d.projectId}`} className="mail-rule">
                <div className="mail-rule-main">
                  <div style={{ fontWeight: 600 }}>{d.client} <span className="mono small faint">{d.orderRef}</span></div>
                  <div className="tiny faint">
                    {d.ruleName} - due {d.dueOn}{d.overdue ? ' (overdue)' : ''}
                  </div>
                </div>
                <button
                  className="btn btn-sm btn-gold"
                  onClick={async () => {
                    try {
                      await api.mail.send({ ruleId: d.ruleId, projectId: d.projectId });
                      await load();
                      toast(`Draft opened for ${d.client}`, 'ok');
                    } catch (err) { toast(messageFor(err), 'err'); }
                  }}
                >
                  Open the draft
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {editing && (
        <EmailEditor
          rule={editing}
          meta={meta}
          clients={clients}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

/** "A week before the final fitting", read back from a stored rule. */
function describeRule(r, anchors) {
  const days = r.offsetDays ?? r.offset_days ?? 0;
  const anchor = anchors.find((a) => a.key === r.anchor)?.label.toLowerCase() ?? r.anchor;
  if (days === 0) return `On the day of ${anchor}`;
  const n = Math.abs(days);
  const unit = n % 7 === 0 ? `${n / 7} week${n === 7 ? '' : 's'}` : `${n} day${n === 1 ? '' : 's'}`;
  return `${unit} ${days < 0 ? 'before' : 'after'} ${anchor}`;
}

function EmailEditor({ rule, meta, clients, onClose, onSave }) {
  const [form, setForm] = useState({
    id: rule.id,
    name: rule.name ?? '',
    subject: rule.subject ?? meta.defaults.subject,
    body: rule.body ?? meta.defaults.body,
    anchor: rule.anchor ?? 'event_date',
    offsetDays: rule.offsetDays ?? -7,
    audience: rule.audience ?? 'all',
    enabled: rule.enabled ?? true,
    clientIds: rule.clientIds ?? [],
  });
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState(null);
  const bodyRef = useRef(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  /**
   * Drops a placeholder in where the cursor is, rather than at the end.
   * GD is writing a sentence; the name belongs in the middle of it.
   */
  function insert(key) {
    const el = bodyRef.current;
    const token = `{${key}}`;
    if (!el) { set({ body: `${form.body}${token}` }); return; }
    const start = el.selectionStart ?? form.body.length;
    const end = el.selectionEnd ?? start;
    const next = form.body.slice(0, start) + token + form.body.slice(end);
    set({ body: next });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const picked = new Set(form.clientIds);
  const shown = clients
    .filter((c) => `${c.name} ${c.surname}`.toLowerCase().includes(search.trim().toLowerCase()))
    .slice(0, 60);

  return (
    <Modal title={form.id ? 'Edit email' : 'New email'} onClose={onClose} wide>
      <div className="stack">
        <div className="field">
          <label>What it is for</label>
          <input
            className="input"
            placeholder="Final fitting reminder"
            value={form.name}
            autoFocus
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>

        <div className="field">
          <label>When it goes</label>
          <div className="inline">
            <input
              className="input"
              type="number"
              min="0"
              max="365"
              style={{ width: 90 }}
              value={Math.abs(form.offsetDays)}
              onChange={(e) => {
                const n = Math.max(0, Math.min(365, Number(e.target.value) || 0));
                set({ offsetDays: form.offsetDays < 0 ? -n : n });
              }}
            />
            <span className="tiny faint">days</span>
            <select
              className="select"
              value={form.offsetDays < 0 ? 'before' : 'after'}
              onChange={(e) => set({ offsetDays: (e.target.value === 'before' ? -1 : 1) * Math.abs(form.offsetDays) })}
            >
              <option value="before">before</option>
              <option value="after">after</option>
            </select>
            <select className="select" value={form.anchor} onChange={(e) => set({ anchor: e.target.value })}>
              {meta.anchors.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </div>
          <div className="tiny faint" style={{ marginTop: 6 }}>
            {describeRule(form, meta.anchors)}. Orders with no {(meta.anchors.find((a) => a.key === form.anchor)?.label ?? '').toLowerCase()} set are skipped.
          </div>
        </div>

        <div className="field">
          <label>Who it goes to</label>
          <select className="select" value={form.audience} onChange={(e) => set({ audience: e.target.value })}>
            {meta.audiences.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>

          {form.audience !== 'all' && (
            <div className="mail-clients">
              <input
                className="input input-sm"
                placeholder="Search clients..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className="mail-client-list">
                {shown.map((c) => (
                  <label key={c.id} className="mail-client">
                    <input
                      type="checkbox"
                      checked={picked.has(c.id)}
                      onChange={(e) => {
                        const next = new Set(picked);
                        e.target.checked ? next.add(c.id) : next.delete(c.id);
                        set({ clientIds: [...next] });
                      }}
                    />
                    <span>{c.name} {c.surname}</span>
                    {!c.email && <span className="tiny faint">no email</span>}
                  </label>
                ))}
                {shown.length === 0 && <div className="tiny faint">Nobody by that name.</div>}
              </div>
              <div className="tiny faint">
                {form.clientIds.length} picked
                {form.audience === 'only' && form.clientIds.length === 0 && ' - so this goes to nobody'}
              </div>
            </div>
          )}
        </div>

        <div className="field">
          <label>Subject</label>
          <input className="input" value={form.subject} onChange={(e) => set({ subject: e.target.value })} />
        </div>

        <div className="field">
          <label>Message</label>
          <div className="inline" style={{ marginBottom: 6 }}>
            <select
              className="select btn-sm"
              value=""
              onChange={(e) => { if (e.target.value) insert(e.target.value); }}
            >
              <option value="">Insert a detail...</option>
              {meta.variables.map((v) => (
                <option key={v.key} value={v.key}>{`{${v.key}}`} - {v.describes}</option>
              ))}
            </select>
            <span className="tiny faint">Dropped in where the cursor is.</span>
          </div>
          <textarea
            ref={bodyRef}
            className="input mono"
            rows={12}
            value={form.body}
            onChange={(e) => set({ body: e.target.value })}
          />
        </div>

        {preview && (
          <Banner kind="info">
            <div>
              <div style={{ fontWeight: 600 }}>{preview.subject}</div>
              <div style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{preview.body}</div>
            </div>
          </Banner>
        )}

        <div className="inline">
          <button className="btn btn-gold" onClick={() => onSave(form)} disabled={!form.name.trim()}>
            {form.id ? 'Save' : 'Add this email'}
          </button>
          <button
            className="btn"
            onClick={async () => setPreview(await api.mail.preview({ rule: form }))}
          >
            See it filled in
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}


/**
 * Where GD's data may go.
 *
 * Everything else in this app works on his own machine. These three things
 * would change that, so they are off until he turns them on, one at a time,
 * behind a gate that says plainly what it is letting out.
 */
function Connections() {
  const [state, setState] = useState(null);
  const [inputs, setInputs] = useState({});
  const [tests, setTests] = useState({});
  const toast = useToast();

  const load = React.useCallback(async () => {
    try { setState(await api.connections.get()); }
    catch (err) { toast(messageFor(err), 'err'); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  async function patch(next, message) {
    try {
      setState(await api.connections.set(next));
      if (message) toast(message, 'ok');
    } catch (err) { toast(messageFor(err), 'err'); }
  }

  async function saveSecret(name) {
    const value = (inputs[name] ?? '').trim();
    if (!value) return;
    try {
      await api.secrets.set({ name, value });
      setInputs((i) => ({ ...i, [name]: '' }));
      await load();
      toast('Saved to the keychain', 'ok');
    } catch (err) { toast(messageFor(err), 'err'); }
  }

  async function test(service) {
    try {
      const result = await api.connections.test({ service });
      setTests((t) => ({ ...t, [service]: result }));
    } catch (err) { toast(messageFor(err), 'err'); }
  }

  if (!state) return <div className="card"><div className="card-pad"><Spinner /></div></div>;
  const { config, methods, secrets: keys, status } = state;
  const locked = !config.consent;

  const Status = ({ service }) => {
    const s = tests[service] ?? status[service];
    return (
      <span className={`pill ${s.ready ? 'pill-ok' : 'pill-quiet'}`} title={s.why}>
        {s.ready ? 'Ready' : 'Not connected'}
      </span>
    );
  };

  const Secret = ({ name, label, hint }) => (
    <div className="field">
      <label>{label}</label>
      <div className="inline">
        <SecretInput
          value={inputs[name] ?? ''}
          placeholder={keys[name]?.present ? 'Saved - type to replace' : hint}
          onChange={(val) => setInputs((i) => ({ ...i, [name]: val }))}
        />
        <button className="btn" onClick={() => saveSecret(name)} disabled={!(inputs[name] ?? '').trim()}>
          Save
        </button>
        {keys[name]?.present && <span className="pill pill-ok">Saved</span>}
      </div>
    </div>
  );

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head"><h3>Letting data off this machine</h3></div>
        <div className="card-pad">
          <div className="toggle-row">
            <div>
              <div style={{ fontWeight: 600 }}>Allow this app to send your data to Google</div>
              <div className="tiny faint" style={{ maxWidth: 620 }}>
                Everything below stays switched off until this is on. What would leave: your clients&apos;
                names, telephone numbers, email addresses, measurements and photographs - to a Google
                account you choose. Turning this off again stops all of it at once and keeps the settings.
              </div>
            </div>
            <Switch checked={config.consent} onChange={(on) => patch({ consent: on },
              on ? 'Allowed - each service still has its own switch' : 'Switched off everywhere')} />
          </div>
        </div>
      </div>

      <div className={`card ${locked ? 'card-dim' : ''}`}>
        <div className="card-head">
          <h3>Gmail</h3>
          <div className="spacer" />
          <Status service="gmail" />
        </div>
        <div className="card-pad">
          <div className="field">
            <label>How mail leaves</label>
            {methods.map((m) => (
              <label key={m.key} className="radio-row">
                <input
                  type="radio"
                  name="sendMethod"
                  checked={config.gmail.method === m.key}
                  disabled={locked && m.key !== 'draft'}
                  onChange={() => patch({ gmail: { ...config.gmail, method: m.key } })}
                />
                <span>
                  <span style={{ fontWeight: 600 }}>{m.label}</span>
                  <span className="tiny faint" style={{ display: 'block' }}>{m.describes}</span>
                </span>
              </label>
            ))}
          </div>

          {config.gmail.method === 'gmail' && (
            <>
              <div className="field">
                <label>The Gmail address to send from</label>
                <DebouncedInput
                  className="input"
                  placeholder="gareth@gdsuits.co.za"
                  value={config.gmail.address}
                  onCommit={(val) => patch({ gmail: { ...config.gmail, address: val } }, 'Address saved')}
                />
              </div>
              <Secret
                name="gmailAppPassword"
                label="App password"
                hint="Sixteen letters from your Google account"
              />
              <Banner kind="info">
                <div>
                  This is not your Google password. In your Google account, under Security, switch on
                  two-step verification and then create an <strong>app password</strong> - a sixteen-letter
                  code made for one program. It can be revoked without changing anything else.
                </div>
              </Banner>
            </>
          )}
          <button className="btn btn-sm" onClick={() => test('gmail')}>Check</button>
          {tests.gmail && <span className="tiny faint" style={{ marginLeft: 8 }}>{tests.gmail.why}</span>}
        </div>
      </div>

      <div className={`card ${locked ? 'card-dim' : ''}`}>
        <div className="card-head">
          <h3>Google Sheets</h3>
          <div className="spacer" />
          <Status service="sheets" />
        </div>
        <div className="card-pad">
          <div className="toggle-row">
            <div>
              <div style={{ fontWeight: 600 }}>Write orders to a spreadsheet</div>
              <div className="tiny faint">One row per order, kept up to date.</div>
            </div>
            <Switch
              checked={config.sheets.enabled}
              onChange={(on) => patch({ sheets: { ...config.sheets, enabled: on } })}
            />
          </div>
          <div className="field">
            <label>Spreadsheet</label>
            <DebouncedInput
              className="input mono"
              placeholder="Paste the spreadsheet link, or its id"
              value={config.sheets.spreadsheetId}
              onCommit={(val) => patch({ sheets: { ...config.sheets, spreadsheetId: val } }, 'Spreadsheet saved')}
            />
            <div className="tiny faint">The whole link is fine - the id is taken out of it.</div>
          </div>
          <div className="field">
            <label>Which tab</label>
            <DebouncedInput
              className="input"
              placeholder="Orders"
              value={config.sheets.tab}
              onCommit={(val) => patch({ sheets: { ...config.sheets, tab: val } })}
            />
          </div>
          <div className="field">
            <label>When to write</label>
            <select
              className="select"
              value={config.sheets.when}
              onChange={(e) => patch({ sheets: { ...config.sheets, when: e.target.value } })}
            >
              <option value="manual">When I press the button</option>
              <option value="onSave">Every time an order changes</option>
            </select>
          </div>
          <button className="btn btn-sm" onClick={() => test('sheets')}>Check</button>
          {tests.sheets && <span className="tiny faint" style={{ marginLeft: 8 }}>{tests.sheets.why}</span>}
        </div>
      </div>

      <div className={`card ${locked ? 'card-dim' : ''}`}>
        <div className="card-head">
          <h3>Google Drive</h3>
          <div className="spacer" />
          <Status service="drive" />
        </div>
        <div className="card-pad">
          <div className="toggle-row">
            <div>
              <div style={{ fontWeight: 600 }}>Keep photographs and client files in Drive</div>
              <div className="tiny faint">A copy goes up; the originals stay on this machine.</div>
            </div>
            <Switch
              checked={config.drive.enabled}
              onChange={(on) => patch({ drive: { ...config.drive, enabled: on } })}
            />
          </div>
          <div className="field">
            <label>Folder for photographs</label>
            <DebouncedInput
              className="input mono"
              placeholder="Paste the folder link, or its id"
              value={config.drive.photosFolderId}
              onCommit={(val) => patch({ drive: { ...config.drive, photosFolderId: val } }, 'Folder saved')}
            />
          </div>
          <div className="field">
            <label>Folder for client files</label>
            <DebouncedInput
              className="input mono"
              placeholder="Paste the folder link, or its id"
              value={config.drive.exportsFolderId}
              onCommit={(val) => patch({ drive: { ...config.drive, exportsFolderId: val } })}
            />
          </div>
          <button className="btn btn-sm" onClick={() => test('drive')}>Check</button>
          {tests.drive && <span className="tiny faint" style={{ marginLeft: 8 }}>{tests.drive.why}</span>}
        </div>
      </div>

      <Collapsible title="Google account details" summary="Needed for Sheets and Drive">
        <div style={{ marginTop: 12 }}>
          <Banner kind="info">
            <div>
              Sheets and Drive need an application of your own in the Google Cloud console - a client id
              and secret. They identify this app to Google; they are not a password and they do not give
              anyone access to your account on their own.
              <div className="small" style={{ marginTop: 6, opacity: .85 }}>
                Both are kept in the machine&apos;s keychain, like the AI keys, and never leave it except
                to Google.
              </div>
            </div>
          </Banner>
          <Secret name="googleClientId" label="Client id" hint="Ends in .apps.googleusercontent.com" />
          <Secret name="googleClientSecret" label="Client secret" hint="From the same Google Cloud page" />
          <div className="tiny faint">
            {keys.googleRefreshToken?.present
              ? 'A Google account is linked.'
              : 'No Google account linked yet. Once the two details above are saved, linking is the last step.'}
          </div>
        </div>
      </Collapsible>
    </div>
  );
}

export default function Settings({ catalog, overrides, onOverridesChanged, keyState, onKeyChanged }) {
  const [providers, setProviders] = useState([]);
  const [config, setConfig] = useState({
    image: { provider: 'gemini', model: '' },
    vision: { provider: 'gemini', model: '' },
    customBaseUrl: '',
  });
  const [modelsByProvider, setModelsByProvider] = useState({});
  const [info, setInfo] = useState(null);
  const [posture, setPosture] = useState(null);
  const [update, setUpdate] = useState(null);
  const [updateError, setUpdateError] = useState(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [downloaded, setDownloaded] = useState(null);
  const [feed, setFeed] = useState('');
  const [defaultFeed, setDefaultFeed] = useState('');
  const [autoCheck, setAutoCheck] = useState(false);
  const [tokenState, setTokenState] = useState(null);
  const [tokenInput, setTokenInput] = useState('');
  const [editing, setEditing] = useState(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [tab, setTab] = useState('ai');
  const toast = useToast();

  const modelsFor = (id) => modelsByProvider[id] ?? null;

  // The main process reports how far the update download has got. It is the
  // only thing that travels that way, and it is only ever listened to.
  useEffect(() => api.updates.onProgress(setProgress), []);

  useEffect(() => {
    (async () => {
      setInfo(await api.app.info());
      setPosture(await api.app.security().catch(() => null));
      const fallback = await api.updates.defaultFeed().catch(() => '');
      setDefaultFeed(fallback);
      setFeed((await api.settings.get({ key: 'updateFeed', fallback })) || fallback);
      setAutoCheck(!!(await api.settings.get({ key: 'autoCheckUpdates', fallback: false })));
      setTokenState(await api.secrets.describe({ name: 'updateToken' }).catch(() => null));
    })();
  }, []);

  const reloadProviders = React.useCallback(async () => {
    const result = await api.ai.providers();
    setProviders(result.providers);
    setConfig(result.config);
    onKeyChanged?.(result.providers.find((p) => p.id === result.config.image.provider)?.key ?? null);
    return result;
  }, [onKeyChanged]);

  useEffect(() => { reloadProviders().catch(() => {}); }, [reloadProviders]);

  /**
   * Model lists are fetched per provider as soon as that provider has a key,
   * rather than waiting for a button the tailor has no reason to press. It is
   * the free-text fallback that lets an unusable model get saved.
   */
  const loadModels = React.useCallback(async (providerId, announce = false) => {
    try {
      const list = await api.ai.models({ provider: providerId });
      setModelsByProvider((cur) => ({ ...cur, [providerId]: list }));
      if (announce) toast(`${list.all.length} models on that key`, 'ok');
      return list;
    } catch (err) {
      setModelsByProvider((cur) => ({ ...cur, [providerId]: null }));
      if (announce) toast(messageFor(err), 'err');
      return null;
    }
  }, [toast]);

  useEffect(() => {
    for (const provider of providers) {
      if (provider.key?.present && modelsByProvider[provider.id] === undefined) loadModels(provider.id);
    }
  }, [providers, modelsByProvider, loadModels]);

  async function saveAiConfig(patch) {
    const next = {
      ...config,
      ...patch,
      image: { ...config.image, ...(patch.image ?? {}) },
      vision: { ...config.vision, ...(patch.vision ?? {}) },
    };
    try {
      setConfig(await api.ai.setConfig(next));
    } catch (err) {
      toast(messageFor(err), 'err');
    }
  }

  /**
   * A saved model that the provider cannot actually use is repaired rather
   * than left to fail on every render. For the image slot "usable" means it
   * can return an image - a text model lists fine, accepts the request, then
   * answers 404.
   */
  useEffect(() => {
    const list = modelsByProvider[config.image.provider];
    if (!list || !list.image.length) return;
    const capable = list.image.some((m) => m.name === config.image.model);
    if (capable) return;
    const replacement = list.image[0].name;
    const existed = list.all.some((m) => m.name === config.image.model);
    saveAiConfig({ image: { model: replacement } });
    toast(
      config.image.model
        ? `${config.image.model} ${existed ? 'cannot produce images' : 'is not on this key'} - switched to ${replacement}`
        : `Image model set to ${replacement}`,
      'info'
    );
  }, [modelsByProvider, config.image.provider]); // eslint-disable-line react-hooks/exhaustive-deps

  async function checkForUpdates() {
    setChecking(true);
    setUpdateError(null);
    // A new check is a new release; whatever was downloaded before is not it.
    setDownloaded(null);
    setProgress(null);
    try {
      const result = await api.updates.check();
      setUpdate(result);
      toast(result.updateAvailable ? `Version ${result.version} is available` : 'You are on the latest version', 'ok');
    } catch (err) {
      setUpdateError(messageFor(err));
      setUpdate(null);
    } finally {
      setChecking(false);
    }
  }

  const entries = priceCatalogEntries(catalog.steps);
  const grouped = entries.reduce((acc, e) => { (acc[e.step] ??= []).push(e); return acc; }, {});
  const customItemsById = new Map(catalog.items.map((i) => [i.id, i]));

  async function saveOverride(key, val) {
    const next = { ...overrides };
    if (val === '') delete next[key];
    else next[key] = Number(val);
    await api.settings.set({ key: 'priceOverrides', value: next });
    onOverridesChanged(next);
  }

  return (
    <>
      <div className="topbar">
        <h1>Settings</h1>
        <div className="spacer" />
        <button className="btn btn-sm" onClick={() => api.app.openDataFolder()}>Open data folder</button>
      </div>

      <div className="content">
        <div className="stepper" style={{ marginBottom: 20 }}>
          <button className={`step-tab ${tab === 'ai' ? 'active' : ''}`} onClick={() => setTab('ai')}>AI rendering</button>
          <button className={`step-tab ${tab === 'prices' ? 'active' : ''}`} onClick={() => setTab('prices')}>Price list</button>
          <button className={`step-tab ${tab === 'business' ? 'active' : ''}`} onClick={() => setTab('business')}>Your business</button>
          <button className={`step-tab ${tab === 'emails' ? 'active' : ''}`} onClick={() => setTab('emails')}>Emails</button>
          <button className={`step-tab ${tab === 'connections' ? 'active' : ''}`} onClick={() => setTab('connections')}>Connections</button>
          <button className={`step-tab ${tab === 'updates' ? 'active' : ''}`} onClick={() => setTab('updates')}>
            Updates{update?.updateAvailable ? ' •' : ''}
          </button>
          <button className={`step-tab ${tab === 'about' ? 'active' : ''}`} onClick={() => setTab('about')}>About &amp; data</button>
        </div>

        {tab === 'ai' && (
          <div className="stack">
            <div className="card">
              <div className="card-head">
                <h3>Where each job runs</h3>
                <div className="spacer" />
                <span className="tiny faint">Renders and reads can use different providers</span>
              </div>
              <div className="card-pad">
                <p className="small muted" style={{ marginTop: 0 }}>
                  The app works fully offline without any of this - capture, spec, measurements, notes, pricing
                  and export. A provider is only needed to render previews and run the AI reads.
                </p>

                <div className="row">
                  <JobPicker
                    title="Image renders"
                    job="image"
                    config={config}
                    providers={providers}
                    models={modelsFor(config.image.provider)}
                    onChange={saveAiConfig}
                  />
                  <JobPicker
                    title="Photo &amp; measurement reads"
                    job="vision"
                    config={config}
                    providers={providers}
                    models={modelsFor(config.vision.provider)}
                    onChange={saveAiConfig}
                  />
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Providers &amp; keys</h3>
                <div className="spacer" />
                <span className="tiny faint">
                  {providers.filter((p) => p.key?.present).length} of {providers.length} configured
                </span>
              </div>
              <div className="card-pad">
                <p className="small muted" style={{ marginTop: 0 }}>
                  Each key is encrypted with the OS keychain and stays on this machine - it never leaves except in
                  calls to that provider.
                </p>

                {providers.map((provider) => (
                  <Collapsible
                    key={provider.id}
                    title={provider.label}
                    defaultOpen={!providers.some((p) => p.key?.present) && provider.id === 'gemini'}
                    summary={[
                      provider.key?.present ? 'key saved' : 'no key',
                      provider.supportsImage ? 'renders' : 'reads only',
                      modelsFor(provider.id) ? `${modelsFor(provider.id).all.length} models` : null,
                    ].filter(Boolean).join(' · ')}
                  >
                    <ProviderCard
                      provider={provider}
                      models={modelsFor(provider.id)}
                      config={config}
                      onKeyChanged={reloadProviders}
                      onBaseUrlChanged={(url) => saveAiConfig({ customBaseUrl: url })}
                      onLoadModels={() => loadModels(provider.id, true)}
                    />
                  </Collapsible>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'business' && <BusinessDetails />}

        {tab === 'connections' && <Connections />}

        {tab === 'emails' && (
          <>
            <StandingEmails />
            <QuoteEmail />
          </>
        )}

        {tab === 'prices' && (
          <div className="card">

            <div className="card-head">
              <h3>Price list</h3>
              <div className="spacer" />
              <span className="tiny faint">All amounts in {CURRENCY} - blank resets to the default</span>
            </div>
            <div className="card-pad">
              <p className="small muted" style={{ marginTop: 0 }}>
                Every quote in the app is built from these numbers. Change one and every order recalculates.
                Anything you add here appears in the consultation flow, on the quote and on the spec sheet
                alongside the built-in options.
              </p>

              {catalog.steps.map((step) => {
                const rows = grouped[step.key] ?? [];
                const changed = rows.filter((r) => typeof overrides[r.key] === 'number').length;
                const mine = rows.filter((r) => r.custom).length;
                return (
                  <Collapsible
                    key={step.key}
                    title={step.title}
                    summary={[
                      `${rows.length} item${rows.length === 1 ? '' : 's'}`,
                      mine ? `${mine} yours` : null,
                      changed ? `${changed} changed` : null,
                    ].filter(Boolean).join(' · ')}
                  >
                    {rows.length === 0 && (
                      <p className="small faint" style={{ marginTop: 10 }}>Nothing in this category yet.</p>
                    )}

                    {rows.map((entry) => (
                      <div className="measure-row" key={entry.key}>
                        <div>
                          <div style={{ fontWeight: 600 }}>
                            {entry.label}
                            {entry.custom && <span className="pill pill-quiet" style={{ marginLeft: 8 }}>yours</span>}
                          </div>
                          <div className="tiny faint">
                            {entry.isBase ? 'Base garment price' : 'Added when selected'} · default {formatMoney(entry.defaultAmount)}
                          </div>
                        </div>
                        <div className="inline" style={{ justifyContent: 'flex-end', gap: 6 }}>
                          {entry.custom && (
                            <button
                              className="btn btn-sm btn-ghost"
                              onClick={() => setEditing({ mode: 'edit', item: customItemsById.get(entry.itemId) })}
                            >
                              Edit
                            </button>
                          )}
                          <DebouncedInput
                            type="number"
                            className="input measure-input"
                            style={{ width: 118 }}
                            placeholder={String(entry.defaultAmount)}
                            value={overrides[entry.key] ?? ''}
                            onCommit={(val) => saveOverride(entry.key, val)}
                          />
                        </div>
                      </div>
                    ))}

                    <div className="inline" style={{ marginTop: 12 }}>
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => setEditing({ mode: 'add', category: step.key, categoryTitle: step.title })}
                      >
                        + Add item to {step.title}
                      </button>
                      <div style={{ flex: 1 }} />
                      {step.custom && (
                        <ConfirmButton
                          className="btn btn-sm btn-ghost btn-danger"
                          confirmLabel="Delete this category and its items?"
                          onConfirm={async () => {
                            await api.catalog.deleteCategory({ id: step.categoryId });
                            await catalog.reload();
                            toast('Category removed');
                          }}
                        >
                          Delete category
                        </ConfirmButton>
                      )}
                    </div>
                  </Collapsible>
                );
              })}

              <div className="inline" style={{ marginTop: 16 }}>
                <button className="btn btn-gold" onClick={() => setAddingCategory(true)}>+ Add a category</button>
                <span className="tiny faint">A new group in the consultation flow, for things the built-in list does not cover.</span>
              </div>
            </div>
          </div>
        )}

        {tab === 'updates' && (
          <div className="stack">
            <div className="card">
              <div className="card-head">
                <h3>Version</h3>
                <div className="spacer" />
                <span className="pill pill-quiet">Installed: {info?.version ?? '...'}</span>
              </div>
              <div className="card-pad">
                <div className="inline">
                  <button className="btn btn-gold" onClick={checkForUpdates} disabled={checking}>
                    {checking ? <><Spinner /> Checking...</> : 'Check for updates'}
                  </button>
                  {update && !update.updateAvailable && (
                    <span className="pill pill-ok">Up to date</span>
                  )}
                  {update?.updateAvailable && (
                    <span className="pill">Version {update.version} available</span>
                  )}
                </div>

                {updateError && <Banner kind="warn"><div style={{ marginTop: 10 }}>{updateError}</div></Banner>}

                {update?.updateAvailable && (
                  <div style={{ marginTop: 16 }}>
                    <div className="price-line">
                      <span className="muted">New version</span>
                      <span style={{ fontWeight: 600 }}>{update.version}</span>
                    </div>
                    {update.publishedAt && (
                      <div className="price-line">
                        <span className="muted">Published</span>
                        <span className="mono small">{update.publishedAt.slice(0, 10)}</span>
                      </div>
                    )}
                    {update.downloadName && (
                      <div className="price-line">
                        <span className="muted">For this machine</span>
                        <span className="mono small">{update.downloadName}</span>
                      </div>
                    )}

                    {update.notes && (
                      <>
                        <div className="price-group-title">What changed</div>
                        {/* Release notes come from a remote server, so they are
                            shown as plain text - never parsed as markup. */}
                        <div className="note" style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflowY: 'auto' }}>
                          {update.notes}
                        </div>
                      </>
                    )}

                    {progress && !downloaded && (
                      <div style={{ marginTop: 14 }}>
                        <div className="progress-track">
                          <div
                            className="progress-fill"
                            style={{ width: `${progress.total ? Math.min(100, (progress.bytes / progress.total) * 100) : 0}%` }}
                          />
                        </div>
                        <div className="small muted" style={{ marginTop: 6 }}>
                          {megabytes(progress.bytes)} of {progress.total ? megabytes(progress.total) : '?'} MB
                        </div>
                      </div>
                    )}

                    <div className="inline" style={{ marginTop: 14 }}>
                      {!downloaded && (
                        <button
                          className="btn btn-gold"
                          disabled={downloading || !update.canDownload}
                          onClick={async () => {
                            setDownloading(true);
                            setProgress(null);
                            try {
                              setDownloaded(await api.updates.fetch());
                              toast('Update downloaded', 'ok');
                            } catch (err) {
                              setProgress(null);
                              toast(messageFor(err), 'err');
                            } finally {
                              setDownloading(false);
                            }
                          }}
                        >
                          {downloading ? <><Spinner /> Downloading...</> : `Download ${update.version}`}
                        </button>
                      )}
                      {downloading && (
                        <button className="btn" onClick={() => api.updates.cancel()}>Stop</button>
                      )}
                      {downloaded && (
                        <button className="btn btn-gold" onClick={async () => {
                          try { await api.updates.reveal(); } catch (err) { toast(messageFor(err), 'err'); }
                        }}>
                          {info?.platform === 'darwin' ? 'Show in Finder' : 'Show in folder'}
                        </button>
                      )}
                      {update.pageUrl && update.pageUrl !== update.downloadUrl && (
                        <button className="btn" onClick={() => api.updates.download({ url: update.pageUrl })}>
                          Open the release page
                        </button>
                      )}
                    </div>

                    {downloaded && (
                      <Banner kind="ok">
                        <div>
                          Saved to your Downloads folder as <span className="mono">{downloaded.name}</span>
                          {downloaded.verified === 'digest' && ' - checked against the release fingerprint.'}
                          {downloaded.verified === 'size' && ' - the whole file arrived.'}
                          <div className="small" style={{ marginTop: 6, opacity: .85 }}>
                            Quit GD Suits Studio, open that file and install it the same way you installed this
                            copy, then reopen. Your client files are untouched by an update.
                          </div>
                        </div>
                      </Banner>
                    )}

                    {!downloaded && (
                      <Banner kind="info">
                        <div>
                          The file is saved to your Downloads folder. GD Suits Studio never opens or runs it -
                          quit the app, install it yourself the same way you installed this copy, and reopen.
                          Your client files are untouched by an update.
                          <div className="small" style={{ marginTop: 6, opacity: .85 }}>
                            It does not update itself in place because these builds are ad-hoc signed. macOS refuses
                            to swap out a bundle it cannot verify, so a silent update would fail. Once the app is
                            signed with an Apple Developer ID, one-click updates can be switched on.
                          </div>
                        </div>
                      </Banner>
                    )}
                  </div>
                )}
              </div>
            </div>

            <Collapsible title="Where updates come from" summary="Advanced">
              <div className="field" style={{ marginTop: 12 }}>
                <label>Update address</label>
                <DebouncedInput
                  className="input mono"
                  value={feed}
                  onCommit={async (val) => {
                    const next = val.trim() || defaultFeed;
                    setFeed(next);
                    await api.settings.set({ key: 'updateFeed', value: next });
                    toast('Update address saved', 'ok');
                  }}
                />
                <div className="hint">
                  A GitHub releases endpoint, or a JSON file of the shape
                  <span className="mono"> {'{ version, notes, url, assets }'}</span>. Must be https.
                </div>
              </div>

              <div className="field">
                <label>Access token {tokenState?.present && <span className="mono faint">({tokenState.hint})</span>}</label>
                <div className="inline">
                  <SecretInput
                    placeholder="Only needed while the repository is private"
                    value={tokenInput}
                    onChange={setTokenInput}
                    onEnter={async () => {
                      const state = await api.secrets.set({ name: 'updateToken', value: tokenInput.trim() });
                      setTokenState(state);
                      setTokenInput('');
                      toast(state.present ? 'Token saved' : 'Token removed', 'ok');
                    }}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={async () => {
                      const state = await api.secrets.set({ name: 'updateToken', value: tokenInput.trim() });
                      setTokenState(state);
                      setTokenInput('');
                      toast(state.present ? 'Token saved' : 'Token removed', 'ok');
                    }}
                  >
                    Save
                  </button>
                </div>
                <div className="hint">
                  Stored with the same keychain encryption as the API key. A token should not be shipped to other
                  people's machines - publish releases publicly instead before handing the app out.
                </div>
              </div>

              <div className="toggle-row" style={{ marginBottom: 4 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Check automatically on launch</div>
                  <div className="tiny faint">One request to the address above when the app opens. Nothing is sent about you.</div>
                </div>
                <Switch
                  checked={autoCheck}
                  onChange={async (val) => {
                    setAutoCheck(val);
                    await api.settings.set({ key: 'autoCheckUpdates', value: val });
                  }}
                />
              </div>
            </Collapsible>
          </div>
        )}

        {tab === 'about' && (
          <div className="card">
            <div className="card-head"><h3>About</h3></div>
            <div className="card-pad">
              <div className="price-line"><span className="muted">Version</span><span className="mono">{info?.version}</span></div>
              <div className="price-line"><span className="muted">Platform</span><span className="mono">{info?.platform}</span></div>
              <div className="price-line"><span className="muted">Data folder</span><span className="mono tiny">{info?.userData}</span></div>
              <hr className="divider" />
              <p className="small muted">
                Every client, photo, measurement and render is stored in that folder on this machine. Nothing is
                uploaded anywhere except the images you explicitly send to Google when you press Render.
                Back the folder up and the whole shop's history travels with it.
              </p>
              <button className="btn" onClick={() => api.app.openDataFolder()}>Open data folder</button>

              <hr className="divider" />
              <h3 style={{ fontSize: 15, marginBottom: 8 }}>Security</h3>
              <div className="price-line">
                <span className="muted">API key storage</span>
                <span className={`pill ${posture?.keyEncrypted ? 'pill-ok' : 'pill-warn'}`}>
                  {posture?.keyEncrypted ? 'Encrypted by the OS keychain' : 'Not encrypted - no OS keychain'}
                </span>
              </div>
              <div className="price-line">
                <span className="muted">Interface isolation</span>
                <span className="pill pill-ok">Sandboxed, no system access</span>
              </div>
              <div className="price-line">
                <span className="muted">Outbound connections</span>
                <span className="small mono">{(posture?.networkHosts ?? []).join(', ') || 'none'}</span>
              </div>
              <Banner kind="warn">
                <div>
                  <strong>Client photographs and contact details are personal information.</strong>
                  <div className="small" style={{ marginTop: 4 }}>
                    They are held unencrypted in the data folder, so the machine's own disk encryption is what
                    protects them if it is lost or stolen - turn on FileVault on a Mac, or BitLocker on Windows.
                    Pressing Render sends the client's photo and the fabric image to Google; get the client's
                    agreement before you do, and delete their file when you no longer need it.
                  </div>
                </div>
              </Banner>
            </div>
          </div>
        )}
      </div>

      {editing && (
        <ItemEditor
          editing={editing}
          categories={catalog.steps}
          onClose={() => setEditing(null)}
          onSaved={async (message) => { setEditing(null); await catalog.reload(); toast(message, 'ok'); }}
        />
      )}

      {addingCategory && (
        <CategoryEditor
          onClose={() => setAddingCategory(false)}
          onSaved={async () => { setAddingCategory(false); await catalog.reload(); toast('Category added', 'ok'); }}
        />
      )}
    </>
  );
}

/**
 * Which provider and model does one job. Providers that cannot do the job are
 * not offered - Claude reads photographs but cannot draw a suit, so it is
 * absent from the image list rather than present and failing.
 */
function JobPicker({ title, job, config, providers, models, onChange }) {
  const usable = providers.filter((p) => (job === 'image' ? p.supportsImage : p.supportsVision));
  const chosen = config[job];
  const provider = providers.find((p) => p.id === chosen.provider);
  const noKey = provider && !provider.key?.present;

  return (
    <div>
      <div className="price-group-title">{title}</div>

      <div className="field">
        <label>Provider</label>
        <select
          className="select"
          value={chosen.provider}
          onChange={(e) => {
            const next = providers.find((p) => p.id === e.target.value);
            onChange({
              [job]: {
                provider: e.target.value,
                // Reset to that provider's default; the old model name almost
                // never means anything to a different provider.
                model: (job === 'image' ? next?.defaultImageModel : next?.defaultVisionModel) ?? '',
              },
            });
          }}
        >
          {usable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}{p.key?.present ? '' : ' - no key yet'}
            </option>
          ))}
        </select>
      </div>

      <ModelPicker
        label="Model"
        hint={job === 'image' ? 'Only models that can return an image will produce a render.' : 'Reads the client photographs and the measurements.'}
        value={chosen.model}
        models={models}
        preferred={job}
        requireCapable={job === 'image'}
        onChange={(model) => onChange({ [job]: { model } })}
      />

      {noKey && (
        <Banner kind="warn">
          {provider.label} has no API key yet - add one below before this can run.
        </Banner>
      )}
      {job === 'image' && models && models.image.length === 0 && (
        <Banner kind="warn">
          This key has no image-generation models on it, so renders will not work.
        </Banner>
      )}
    </div>
  );
}

/** One provider's key, endpoint and connection state. */
function ProviderCard({ provider, models, config, onKeyChanged, onBaseUrlChanged, onLoadModels }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function save(value) {
    setBusy(true);
    try {
      await api.secrets.set({ name: provider.id, value: value.trim() });
      setInput('');
      await onKeyChanged();
      toast(value.trim() ? `${provider.label} key saved` : `${provider.label} key removed`, 'ok');
    } catch (err) {
      toast(messageFor(err), 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ paddingTop: 10 }}>
      <div className="inline" style={{ marginBottom: 10 }}>
        {provider.key?.present
          ? <span className="pill pill-ok">Key saved {provider.key.hint}</span>
          : <span className="pill pill-warn">No key</span>}
        {provider.key?.present && !provider.key.encrypted && (
          <span className="pill pill-warn">Not encrypted - no OS keychain</span>
        )}
        {!provider.supportsImage && <span className="pill pill-quiet">Reads only - cannot render</span>}
        {models && <span className="pill pill-quiet">{models.all.length} models</span>}
      </div>

      {provider.needsBaseUrl && (
        <div className="field">
          <label>Endpoint address</label>
          <DebouncedInput
            className="input mono"
            placeholder="https://openrouter.ai/api/v1"
            value={config.customBaseUrl}
            onCommit={onBaseUrlChanged}
          />
          <div className="hint">
            Anything that speaks the OpenAI format - OpenRouter, Together, an Azure deployment, a local server
            behind https. Must be https.
          </div>
        </div>
      )}

      <div className="field">
        <label>{provider.key?.present ? 'Replace key' : 'API key'}</label>
        <div className="inline">
          <SecretInput
            placeholder={provider.keyHint}
            value={input}
            onChange={setInput}
            onEnter={() => input.trim() && save(input)}
          />
          <button className="btn btn-primary" onClick={() => save(input)} disabled={busy || !input.trim()}>Save</button>
          {provider.key?.present && (
            <button className="btn btn-danger" onClick={() => save('')} disabled={busy}>Remove</button>
          )}
        </div>
        {provider.docsUrl && (
          <div className="hint">Keys are issued at {provider.docsUrl.replace(/^https?:\/\//, '')}</div>
        )}
      </div>

      <button className="btn btn-sm" onClick={onLoadModels} disabled={!provider.key?.present}>
        Test the key &amp; load its models
      </button>
    </div>
  );
}

/**
 * A model chooser that only ever offers models the key actually has.
 *
 * Free text is what let an unavailable model get saved, so it is only offered
 * when the list genuinely cannot be fetched - offline, or a key that cannot
 * list models. The likely models for the job are grouped first, but the whole
 * list stays reachable: Google renames these families often, and a picker that
 * hides the model you need is worse than one that ranks them badly.
 */
function ModelPicker({ label, hint, value, models, preferred, onChange, requireCapable }) {
  if (!models) {
    return (
      <div className="field">
        <label>{label}</label>
        <DebouncedInput className="input mono" value={value} onCommit={onChange} />
        <div className="hint">{hint} Typed by hand because the list could not be loaded.</div>
      </div>
    );
  }

  const capable = models[preferred] ?? [];
  const groups = [
    { title: preferred === 'image' ? 'Image models' : 'Reading models', items: capable },
    {
      // Kept selectable because the naming of these families changes often and
      // a picker that hides a working model is worse than one that warns - but
      // labelled, because picking one here is what caused the 404.
      title: requireCapable ? 'Other models - will not return an image' : 'Other models on this key',
      items: models.all.filter((m) => !capable.includes(m)),
    },
  ].filter((g) => g.items.length);

  // For the image slot, "known" means it can actually do the job.
  const known = requireCapable
    ? capable.some((m) => m.name === value)
    : models.all.some((m) => m.name === value);
  const existsButWrong = requireCapable && !known && models.all.some((m) => m.name === value);

  return (
    <div className="field">
      <label>{label}</label>
      <select className={`select ${known ? '' : 'input-invalid'}`} value={known ? value : ''} onChange={(e) => onChange(e.target.value)}>
        {!known && (
          <option value="">
            {value
              ? `${value} - ${existsButWrong ? 'cannot produce images' : 'not on this key'}`
              : 'Choose a model'}
          </option>
        )}
        {groups.map((g) => (
          <optgroup key={g.title} label={g.title}>
            {g.items.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}{m.displayName && m.displayName !== m.name ? ` - ${m.displayName}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <div className="hint">
        {known
          ? hint
          : existsButWrong
            ? 'That is a text model - it cannot return an image. Pick one from the Image models group.'
            : 'The saved model is not available on this key. Pick one from the list.'}
      </div>
    </div>
  );
}

/**
 * Add or edit one of the shop's own items.
 *
 * A "yes / no" item is a single add-on with one price. A "pick one" item is a
 * set of alternatives priced separately - the same shape the built-in options
 * use, so it renders and prices identically once saved.
 */
function ItemEditor({ editing, categories, onClose, onSaved }) {
  const existing = editing.item;
  const [form, setForm] = useState(() => ({
    label: existing?.label ?? '',
    kind: existing?.kind ?? 'toggle',
    price: existing?.price ?? '',
    description: existing?.description ?? '',
    prompt: existing?.prompt ?? '',
    category: existing?.category ?? editing.category,
    options: existing?.options?.length ? existing.options : [{ key: 'opt1', label: '', price: '' }],
  }));
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const setOption = (index, patch) =>
    set({ options: form.options.map((o, i) => (i === index ? { ...o, ...patch } : o)) });

  async function save() {
    if (!form.label.trim()) { toast('Give the item a name.', 'err'); return; }
    setBusy(true);
    try {
      const payload = {
        label: form.label.trim(),
        kind: form.kind,
        price: form.kind === 'toggle' ? Number(form.price) || 0 : 0,
        description: form.description.trim(),
        prompt: form.prompt.trim(),
        category: form.category,
        options:
          form.kind === 'choice'
            ? form.options
                .filter((o) => o.label.trim())
                .map((o, i) => ({ key: o.key || `opt${i + 1}`, label: o.label.trim(), price: Number(o.price) || 0 }))
            : [],
      };
      if (form.kind === 'choice' && payload.options.length < 2) {
        throw new Error('A "pick one" item needs at least two options.');
      }

      if (existing) await api.catalog.updateItem({ id: existing.id, ...payload });
      else await api.catalog.addItem(payload);
      onSaved(existing ? 'Item updated' : 'Item added');
    } catch (err) {
      toast(messageFor(err), 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={existing ? `Edit ${existing.label}` : `Add an item to ${editing.categoryTitle}`}
      onClose={onClose}
      wide
      footer={
        <>
          {existing && (
            <ConfirmButton
              className="btn btn-danger"
              confirmLabel="Delete for good?"
              onConfirm={async () => {
                await api.catalog.deleteItem({ id: existing.id });
                onSaved('Item removed');
              }}
            >
              Delete
            </ConfirmButton>
          )}
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save item'}</button>
        </>
      }
    >
      <div className="field">
        <label>What is it called?</label>
        <input className="input" autoFocus value={form.label} placeholder="Pocket square"
          onChange={(e) => set({ label: e.target.value })} />
      </div>

      <div className="field">
        <label>How is it chosen?</label>
        <div className="options">
          <button className={`option ${form.kind === 'toggle' ? 'selected' : ''}`} onClick={() => set({ kind: 'toggle' })}>
            <div className="option-label">Yes / No</div>
            <div className="option-desc">One add-on with one price</div>
          </button>
          <button className={`option ${form.kind === 'choice' ? 'selected' : ''}`} onClick={() => set({ kind: 'choice' })}>
            <div className="option-label">Pick one</div>
            <div className="option-desc">Alternatives, priced separately</div>
          </button>
        </div>
      </div>

      {form.kind === 'toggle' ? (
        <div className="field">
          <label>Price ({CURRENCY})</label>
          <input type="number" className="input" style={{ maxWidth: 180 }} value={form.price}
            placeholder="0" onChange={(e) => set({ price: e.target.value })} />
        </div>
      ) : (
        <div className="field">
          <label>Options</label>
          {form.options.map((opt, i) => (
            <div className="inline" key={i} style={{ marginBottom: 6 }}>
              <input className="input" style={{ flex: 1 }} placeholder={`Option ${i + 1}`} value={opt.label}
                onChange={(e) => setOption(i, { label: e.target.value, key: opt.key || `opt${i + 1}` })} />
              <input type="number" className="input measure-input" style={{ width: 120 }} placeholder="0"
                value={opt.price} onChange={(e) => setOption(i, { price: e.target.value })} />
              {form.options.length > 1 && (
                <button className="btn btn-sm btn-ghost btn-danger"
                  onClick={() => set({ options: form.options.filter((_, x) => x !== i) })}>Remove</button>
              )}
            </div>
          ))}
          <button className="btn btn-sm" style={{ marginTop: 4 }}
            onClick={() => set({ options: [...form.options, { key: `opt${form.options.length + 1}`, label: '', price: '' }] })}>
            + Add option
          </button>
        </div>
      )}

      <div className="field">
        <label>Category</label>
        <select className="select" value={form.category} onChange={(e) => set({ category: e.target.value })}>
          {categories.map((c) => <option key={c.key} value={c.key}>{c.title}</option>)}
        </select>
      </div>

      <div className="field">
        <label>Short note <span className="faint" style={{ fontWeight: 400 }}>(optional)</span></label>
        <input className="input" value={form.description} placeholder="Shown under the name in the builder"
          onChange={(e) => set({ description: e.target.value })} />
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label>How should the AI draw it? <span className="faint" style={{ fontWeight: 400 }}>(optional)</span></label>
        <input className="input" value={form.prompt} placeholder="a folded silk pocket square in the breast pocket"
          onChange={(e) => set({ prompt: e.target.value })} />
        <div className="hint">
          Wording added to the render prompt when this item is chosen. Leave it blank to use the name.
          If the item is not something you can see on a suit, leave it blank and it stays off the render.
        </div>
      </div>
    </Modal>
  );
}

function CategoryEditor({ onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [blurb, setBlurb] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function save() {
    if (!title.trim()) { toast('Give the category a name.', 'err'); return; }
    setBusy(true);
    try {
      await api.catalog.addCategory({ title: title.trim(), blurb: blurb.trim() });
      onSaved();
    } catch (err) {
      toast(messageFor(err), 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add a category"
      onClose={onClose}
      footer={
        <>
          <div className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-gold" onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Add category'}</button>
        </>
      }
    >
      <div className="field">
        <label>Name</label>
        <input className="input" autoFocus value={title} placeholder="Accessories"
          onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Description <span className="faint" style={{ fontWeight: 400 }}>(optional)</span></label>
        <input className="input" value={blurb} placeholder="Shown under the heading in the consultation"
          onChange={(e) => setBlurb(e.target.value)} />
        <div className="hint">This becomes a new step in the consultation flow, after the built-in ones.</div>
      </div>
    </Modal>
  );
}
