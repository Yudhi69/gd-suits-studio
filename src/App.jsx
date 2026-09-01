import React, { useEffect, useState } from 'react';
import { api } from './lib/api.js';
import { useTheme, THEMES } from './lib/useTheme.js';
import { useCatalog } from './lib/useCatalog.js';
import brandLogo from './assets/logo-light.png';
import { ToastProvider } from './components/ui.jsx';
import Dashboard from './screens/Dashboard.jsx';
import ProjectView from './screens/ProjectView.jsx';
import ClientFile from './screens/ClientFile.jsx';
import Settings from './screens/Settings.jsx';

export default function App() {
  const [route, setRoute] = useState({ name: 'dashboard' });
  const [overrides, setOverrides] = useState({});
  const [keyState, setKeyState] = useState(null);
  const [unit, setUnit] = useState('cm');
  const theme = useTheme();
  const catalog = useCatalog();
  const [updateReady, setUpdateReady] = useState(null);

  useEffect(() => {
    (async () => {
      setOverrides((await api.settings.get({ key: 'priceOverrides', fallback: {} })) ?? {});
      setUnit((await api.settings.get({ key: 'measureUnit', fallback: 'cm' })) ?? 'cm');
      setKeyState(await api.secrets.describe({ name: 'gemini' }));

      // Only if the tailor asked for it. Nothing about them is sent - it is a
      // plain GET for the latest published version number.
      if (await api.settings.get({ key: 'autoCheckUpdates', fallback: false })) {
        api.updates
          .check()
          .then((result) => result.updateAvailable && setUpdateReady(result))
          .catch(() => {});
      }
    })();
  }, []);

  const nav = [
    { key: 'dashboard', label: 'Orders' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <ToastProvider>
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
              <button className="update-flag" onClick={() => setRoute({ name: 'settings' })}>
                Version {updateReady.version} available
              </button>
            )}
            <div>{keyState?.present ? 'AI rendering ready' : 'Offline mode - no API key'}</div>
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

          {route.name === 'settings' && (
            <Settings
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
