import React, { useEffect, useState } from 'react';
import { api, messageFor } from '../lib/api.js';
import { priceCatalogEntries, formatMoney } from '../lib/pricing.js';
import { CURRENCY } from '../lib/catalog.js';
import { Banner, Collapsible, DebouncedInput, SecretInput, Spinner, useToast } from '../components/ui.jsx';

export default function Settings({ overrides, onOverridesChanged, keyState, onKeyChanged }) {
  const [keyInput, setKeyInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [models, setModels] = useState(null);
  const [imageModel, setImageModel] = useState('');
  const [visionModel, setVisionModel] = useState('');
  const [info, setInfo] = useState(null);
  const [posture, setPosture] = useState(null);
  const [tab, setTab] = useState('ai');
  const toast = useToast();

  useEffect(() => {
    (async () => {
      setImageModel(await api.settings.get({ key: 'imageModel', fallback: 'gemini-2.5-flash-image' }));
      setVisionModel(await api.settings.get({ key: 'visionModel', fallback: 'gemini-2.5-flash' }));
      setInfo(await api.app.info());
      setPosture(await api.app.security().catch(() => null));
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

  const entries = priceCatalogEntries();
  const grouped = entries.reduce((acc, e) => { (acc[e.step] ??= []).push(e); return acc; }, {});

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
              </p>
              {Object.entries(grouped).map(([step, rows]) => {
                const changed = rows.filter((r) => typeof overrides[r.key] === 'number').length;
                return (
                  <Collapsible
                    key={step}
                    title={step}
                    summary={
                      changed
                        ? `${rows.length} items · ${changed} changed`
                        : `${rows.length} items`
                    }
                  >
                    {rows.map((entry) => (
                      <div className="measure-row" key={entry.key}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{entry.label}</div>
                          <div className="tiny faint">
                            {entry.isBase ? 'Base garment price' : 'Added when selected'} · default {formatMoney(entry.defaultAmount)}
                          </div>
                        </div>
                        <DebouncedInput
                          type="number"
                          className="input measure-input"
                          placeholder={String(entry.defaultAmount)}
                          value={overrides[entry.key] ?? ''}
                          onCommit={async (v) => {
                            const next = { ...overrides };
                            if (v === '') delete next[entry.key];
                            else next[entry.key] = Number(v);
                            await api.settings.set({ key: 'priceOverrides', value: next });
                            onOverridesChanged(next);
                          }}
                        />
                      </div>
                    ))}
                  </Collapsible>
                );
              })}
            </div>
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
    </>
  );
}
