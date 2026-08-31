import React, { useEffect, useState } from 'react';
import { api } from './lib/api.js';
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

  useEffect(() => {
    (async () => {
      setOverrides((await api.settings.get({ key: 'priceOverrides', fallback: {} })) ?? {});
      setKeyState(await api.secrets.describe({ name: 'gemini' }));
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
            <div>{keyState?.present ? 'AI rendering ready' : 'Offline mode - no API key'}</div>
            <div style={{ opacity: .6 }}>Local data, on this machine</div>
          </div>
        </aside>

        <main className="main">
          {route.name === 'dashboard' && (
            <Dashboard
              onOpenProject={(id) => setRoute({ name: 'project', id })}
              onOpenClient={(id) => setRoute({ name: 'client', id })}
            />
          )}

          {route.name === 'project' && (
            <ProjectView
              projectId={route.id}
              overrides={overrides}
              hasKey={!!keyState?.present}
              onBack={() => setRoute({ name: 'dashboard' })}
            />
          )}

          {route.name === 'client' && (
            <ClientFile
              clientId={route.id}
              onBack={() => setRoute({ name: 'dashboard' })}
              onOpenProject={(id) => setRoute({ name: 'project', id })}
            />
          )}

          {route.name === 'settings' && (
            <Settings
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
