import React, { useEffect, useState } from 'react';
import { api } from './lib/api.js';
import { useTheme, THEMES } from './lib/useTheme.js';
import { useCatalog } from './lib/useCatalog.js';
import brandLogo from './assets/logo-light.png';
import { ToastProvider } from './components/ui.jsx';
import Dashboard from './screens/Dashboard.jsx';
import Analytics from './screens/Analytics.jsx';
import ProjectView from './screens/ProjectView.jsx';
import ClientFile from './screens/ClientFile.jsx';
import Settings from './screens/Settings.jsx';
import FirstRunUpdate from './components/FirstRunUpdate.jsx';

export default function App() {
  const [route, setRoute] = useState({ name: 'dashboard' });
  const [overrides, setOverrides] = useState({});
  const [keyState, setKeyState] = useState(null);
  const [unit, setUnit] = useState('cm');
  const [business, setBusiness] = useState(null);
  const theme = useTheme();
  const catalog = useCatalog();
  const [updateReady, setUpdateReady] = useState(null);
  // The newer version found on this install's first launch, shown as a prompt
  // rather than only as the flag in the corner.
  const [firstRunUpdate, setFirstRunUpdate] = useState(null);
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

      // An installed copy looks once on its first launch, so a package sent
      // out a few versions ago brings itself up to date; after that, only if
      // the tailor asked. Nothing about him is sent either way - it is a plain
      // GET for the latest published version number. With no signal the
      // check simply fails, and the first launch that has one tries again.
      const info = await api.app.info().catch(() => null);
      setPlatform(info?.platform ?? null);
      const firstRun = !!info?.firstRunCheck;
      if (firstRun || (await api.settings.get({ key: 'autoCheckUpdates', fallback: false }))) {
        api.updates
          .check()
          .then((result) => {
            if (!result.updateAvailable) return;
            setUpdateReady(result);
            if (firstRun) setFirstRunUpdate(result);
          })
          .catch(() => {});
      }
    })();
  }, []);

  const nav = [
    { key: 'dashboard', label: 'Orders' },
    { key: 'analytics', label: 'Business' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <ToastProvider>
      {firstRunUpdate && (
        <FirstRunUpdate update={firstRunUpdate} platform={platform} onClose={() => setFirstRunUpdate(null)} />
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
              <button className="update-flag" onClick={() => setRoute({ name: 'settings' })}>
                Version {updateReady.version} available
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

          {route.name === 'analytics' && (
            <Analytics onOpenProject={(id) => setRoute({ name: 'project', id })} />
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
