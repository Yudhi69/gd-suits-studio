import React, { useEffect, useState } from 'react';
import { api } from './lib/api.js';
import { useTheme, THEMES } from './lib/useTheme.js';
import { useCatalog } from './lib/useCatalog.js';
import brandLogo from './assets/logo-light.png';
import { ToastProvider, useToast } from './components/ui.jsx';
import Dashboard from './screens/Dashboard.jsx';
import Analytics from './screens/Analytics.jsx';
import Database from './screens/Database.jsx';
import ProjectView from './screens/ProjectView.jsx';
import ClientFile from './screens/ClientFile.jsx';
import Settings from './screens/Settings.jsx';
import UpdatePrompt from './components/UpdatePrompt.jsx';
import { settledMessage } from './lib/updates.js';

/**
 * Says once, as the window opens, whether the update handed over before the
 * last quit went in - so "Updated to version 0.1.27" is the first thing seen
 * after pressing Update, and a swap that failed is not mistaken for none.
 */
function UpdateSettled() {
  const toast = useToast();
  useEffect(() => {
    // Inside the promise, so a copy without this call cannot take the window
    // down with it - the notice is the one thing here that may be missed.
    Promise.resolve().then(() => api.updates.settled())
      .then((settled) => {
        const message = settledMessage(settled);
        if (message) toast(message.text, message.kind);
      })
      .catch(() => {});
  }, [toast]);
  return null;
}

export default function App() {
  const [route, setRoute] = useState({ name: 'dashboard' });
  const [overrides, setOverrides] = useState({});
  const [keyState, setKeyState] = useState(null);
  const [unit, setUnit] = useState('cm');
  const [business, setBusiness] = useState(null);
  const theme = useTheme();
  const catalog = useCatalog();
  const [updateReady, setUpdateReady] = useState(null);
  // A newer version found as the app opened, the first time it was found:
  // shown as a prompt rather than only as the flag in the corner.
  const [launchUpdate, setLaunchUpdate] = useState(null);
  const [platform, setPlatform] = useState(null);

  useEffect(() => {
    (async () => {
      setOverrides((await api.settings.get({ key: 'priceOverrides', fallback: {} })) ?? {});
      // GD's order form asks clients for inches, so that is the default.
      setUnit((await api.settings.get({ key: 'measureUnit', fallback: 'in' })) ?? 'in');
      setBusiness(await api.business.get());
      // Readiness follows whichever provider is configured for renders, not
      // whichever one happens to be first.
      try {
        const { providers, config } = await api.ai.providers();
        const active = providers.find((p) => p.id === config.image.provider);
        setKeyState({ ...(active?.key ?? { present: false }), providerLabel: active?.label ?? '' });
      } catch {
        setKeyState({ present: false });
      }

      // An installed copy looks for a newer version as it opens, unless the
      // tailor has turned that off; main decides whether to look and whether
      // this is the first time it has found this version, and so whether to
      // say so with a prompt or only with the flag in the corner. Nothing
      // about him is sent - it is a plain GET for the latest published
      // version number. With no signal the check simply fails.
      const info = await api.app.info().catch(() => null);
      setPlatform(info?.platform ?? null);
      api.updates
        .launchCheck()
        .then((result) => {
          if (!result.updateAvailable) return;
          setUpdateReady(result);
          if (result.prompt) setLaunchUpdate(result);
        })
        .catch(() => {});
    })();
  }, []);

  const nav = [
    { key: 'dashboard', label: 'Orders' },
    // The workbook, as one editable sheet over the same orders.
    { key: 'database', label: 'Database' },
    { key: 'analytics', label: 'Business' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <ToastProvider>
      <UpdateSettled />
      {launchUpdate && (
        <UpdatePrompt
          update={launchUpdate}
          platform={platform}
          onClose={() => setLaunchUpdate(null)}
        />
      )}
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <img className="brand-logo" src={brandLogo} alt="GD Suits - A style tailored for you" />
          </div>

          <nav className="nav">
            {nav.map((item) => (
              <button
                key={item.key}
                className={`nav-item ${route.name === item.key ? 'active' : ''}`}
                onClick={() => setRoute({ name: item.key })}
              >
                <span className="dot" />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="sidebar-foot">
            <div className="theme-switch" role="group" aria-label="Appearance">
              {THEMES.map((t) => (
                <button
                  key={t.key}
                  className={theme.preference === t.key ? 'active' : ''}
                  aria-pressed={theme.preference === t.key}
                  onClick={() => theme.choose(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {updateReady && (
              <button className="update-flag" onClick={() => setRoute({ name: 'settings', tab: 'updates', at: Date.now() })}>
                Version {updateReady.version}{' '}
                {updateReady.ready ? 'ready to install'
                  : updateReady.downloaded ? 'downloaded - ready to install' : 'available'}
              </button>
            )}
            <div>
              {keyState?.present
                ? `AI rendering ready${keyState.providerLabel ? ` · ${keyState.providerLabel}` : ''}`
                : 'Offline mode - no API key'}
            </div>
            <div style={{ opacity: .6 }}>Local data, on this machine</div>
          </div>
        </aside>

        <main className="main">
          {route.name === 'dashboard' && (
            <Dashboard
              steps={catalog.steps}
              overrides={overrides}
              customOptions={catalog.options}
              onOpenProject={(id) => setRoute({ name: 'project', id })}
              onOpenClient={(id) => setRoute({ name: 'client', id })}
            />
          )}

          {route.name === 'project' && (
            <ProjectView
              projectId={route.id}
              steps={catalog.steps}
              overrides={overrides}
              business={business}
              unit={unit}
              onUnitChange={async (u) => { setUnit(u); await api.settings.set({ key: 'measureUnit', value: u }); }}
              customOptions={catalog.options}
              onCatalogChanged={catalog.reload}
              hasKey={!!keyState?.present}
              onBack={() => setRoute({ name: 'dashboard' })}
            />
          )}

          {route.name === 'client' && (
            <ClientFile
              clientId={route.id}
              steps={catalog.steps}
              overrides={overrides}
              unit={unit}
              onBack={() => setRoute({ name: 'dashboard' })}
              onOpenProject={(id) => setRoute({ name: 'project', id })}
            />
          )}

          {route.name === 'database' && (
            <Database
              steps={catalog.steps}
              overrides={overrides}
              unit={unit}
              onOpenProject={(id) => setRoute({ name: 'project', id })}
            />
          )}

          {route.name === 'analytics' && (
            <Analytics onOpenProject={(id) => setRoute({ name: 'project', id })} />
          )}

          {route.name === 'settings' && (
            <Settings
              key={route.at ?? 'settings'}
              initialTab={route.tab}
              onUpdateChanged={setUpdateReady}
              catalog={catalog}
              overrides={overrides}
              onOverridesChanged={setOverrides}
              keyState={keyState}
              onKeyChanged={setKeyState}
            />
          )}
        </main>
      </div>
    </ToastProvider>
  );
}
