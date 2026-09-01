import React, { useEffect, useState } from 'react';
import { api, messageFor } from '../lib/api.js';
import { priceCatalogEntries, formatMoney } from '../lib/pricing.js';
import { CURRENCY } from '../lib/catalog.js';
import { Banner, Collapsible, ConfirmButton, DebouncedInput, Modal, SecretInput, Spinner, Switch, useToast } from '../components/ui.jsx';

export default function Settings({ catalog, overrides, onOverridesChanged, keyState, onKeyChanged }) {
  const [keyInput, setKeyInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState(null);
  const [imageModel, setImageModel] = useState('');
  const [visionModel, setVisionModel] = useState('');
  const [info, setInfo] = useState(null);
  const [posture, setPosture] = useState(null);
  const [update, setUpdate] = useState(null);
  const [updateError, setUpdateError] = useState(null);
  const [checking, setChecking] = useState(false);
  const [feed, setFeed] = useState('');
  const [defaultFeed, setDefaultFeed] = useState('');
  const [autoCheck, setAutoCheck] = useState(false);
  const [tokenState, setTokenState] = useState(null);
  const [tokenInput, setTokenInput] = useState('');
  const [editing, setEditing] = useState(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [tab, setTab] = useState('ai');
  const toast = useToast();

  useEffect(() => {
    (async () => {
      setImageModel(await api.settings.get({ key: 'imageModel', fallback: 'gemini-2.5-flash-image' }));
      setVisionModel(await api.settings.get({ key: 'visionModel', fallback: 'gemini-2.5-flash' }));
      setInfo(await api.app.info());
      setPosture(await api.app.security().catch(() => null));
      const fallback = await api.updates.defaultFeed().catch(() => '');
      setDefaultFeed(fallback);
      setFeed((await api.settings.get({ key: 'updateFeed', fallback })) || fallback);
      setAutoCheck(!!(await api.settings.get({ key: 'autoCheckUpdates', fallback: false })));
      setTokenState(await api.secrets.describe({ name: 'updateToken' }).catch(() => null));
    })();
  }, []);

  async function saveKey() {
    try {
      const state = await api.secrets.set({ name: 'gemini', value: keyInput.trim() });
      setKeyInput('');
      onKeyChanged(state);
      toast(state.present ? 'API key saved' : 'API key removed', 'ok');
      if (state.present) loadModels();
    } catch (err) {
      toast(messageFor(err), 'err');
    }
  }

  async function loadModels() {
    setTesting(true);
    try {
      const list = await api.ai.models();
      setModels(list);
      toast(`Connected - ${list.all.length} models available`, 'ok');
    } catch (err) {
      toast(messageFor(err), 'err');
      setModels(null);
    } finally {
      setTesting(false);
    }
  }

  async function setModel(key, value, setter) {
    setter(value);
    await api.settings.set({ key, value });
    toast('Model saved', 'ok');
  }

  async function checkForUpdates() {
    setChecking(true);
    setUpdateError(null);
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
          <button className={`step-tab ${tab === 'updates' ? 'active' : ''}`} onClick={() => setTab('updates')}>
            Updates{update?.updateAvailable ? ' •' : ''}
          </button>
          <button className={`step-tab ${tab === 'about' ? 'active' : ''}`} onClick={() => setTab('about')}>About &amp; data</button>
        </div>

        {tab === 'ai' && (
          <div className="stack">
            <div className="card">
              <div className="card-head">
                <h3>Gemini API key</h3>
                <div className="spacer" />
                {keyState?.present
                  ? <span className="pill pill-ok">Key saved</span>
                  : <span className="pill pill-warn">Not set</span>}
              </div>
              <div className="card-pad">
                <p className="small muted" style={{ marginTop: 0 }}>
                  The app works fully offline without this - capture, spec, measurements, notes, pricing and export.
                  A key is only needed to render previews and run the AI reads.
                </p>

                {keyState?.present && (
                  <p className="small">
                    Current key: <span className="mono">{keyState.hint}</span>
                    {keyState.encrypted
                      ? <span className="pill pill-ok" style={{ marginLeft: 8 }}>Encrypted by the OS keychain</span>
                      : <span className="pill pill-warn" style={{ marginLeft: 8 }}>Stored unencrypted - no OS keychain available</span>}
                  </p>
                )}

                <div className="field">
                  <label>{keyState?.present ? 'Replace key' : 'Paste key'}</label>
                  <div className="inline">
                    <SecretInput
                      placeholder="AIza..."
                      value={keyInput}
                      onChange={setKeyInput}
                      onEnter={() => keyInput.trim() && saveKey()}
                    />
                    <button className="btn btn-primary" onClick={saveKey} disabled={!keyInput.trim()}>Save</button>
                    {keyState?.present && (
                      <button
                        className="btn btn-danger"
                        onClick={async () => {
                          const state = await api.secrets.set({ name: 'gemini', value: '' });
                          onKeyChanged(state);
                          toast('API key removed');
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="hint">
                    Get one free at aistudio.google.com. It is stored on this machine only and never leaves it
                    except in calls to Google.
                  </div>
                </div>

                <button className="btn" onClick={loadModels} disabled={!keyState?.present || testing}>
                  {testing ? <><Spinner /> Testing...</> : 'Test connection & list models'}
                </button>
              </div>
            </div>

            <div className="card">
              <div className="card-head"><h3>Models</h3></div>
              <div className="card-pad">
                <div className="row">
                  <div className="field">
                    <label>Image model (renders)</label>
                    {models?.image?.length ? (
                      <select className="select" value={imageModel} onChange={(e) => setModel('imageModel', e.target.value, setImageModel)}>
                        {models.image.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                      </select>
                    ) : (
                      <DebouncedInput className="input mono" value={imageModel} onCommit={(v) => setModel('imageModel', v, setImageModel)} />
                    )}
                    <div className="hint">Must be an image-generation model. Test the connection to load the live list.</div>
                  </div>
                  <div className="field">
                    <label>Vision model (body read, sanity checks)</label>
                    {models?.vision?.length ? (
                      <select className="select" value={visionModel} onChange={(e) => setModel('visionModel', e.target.value, setVisionModel)}>
                        {models.vision.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                      </select>
                    ) : (
                      <DebouncedInput className="input mono" value={visionModel} onCommit={(v) => setModel('visionModel', v, setVisionModel)} />
                    )}
                  </div>
                </div>
                {models && (
                  <Banner kind="info">
                    {models.image.length} image model{models.image.length === 1 ? '' : 's'} and {models.vision.length} vision
                    model{models.vision.length === 1 ? '' : 's'} available on this key.
                  </Banner>
                )}
              </div>
            </div>
          </div>
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

                    <div className="inline" style={{ marginTop: 14 }}>
                      <button
                        className="btn btn-gold"
                        onClick={async () => {
                          try {
                            await api.updates.download({ url: update.downloadUrl });
                          } catch (err) {
                            toast(messageFor(err), 'err');
                          }
                        }}
                      >
                        Download {update.version}
                      </button>
                      {update.pageUrl && update.pageUrl !== update.downloadUrl && (
                        <button className="btn" onClick={() => api.updates.download({ url: update.pageUrl })}>
                          Open the release page
                        </button>
                      )}
                    </div>

                    <Banner kind="info">
                      <div>
                        The download opens in your browser. Quit GD Suits Studio, install it the same way you
                        installed this copy, and reopen - your client files are untouched by an update.
                        <div className="small" style={{ marginTop: 6, opacity: .85 }}>
                          It does not update itself in place because these builds are ad-hoc signed. macOS refuses
                          to swap out a bundle it cannot verify, so a silent update would fail. Once the app is
                          signed with an Apple Developer ID, one-click updates can be switched on.
                        </div>
                      </div>
                    </Banner>
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
