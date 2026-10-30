import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

export const THEMES = [
  { key: 'light', label: 'Light' },
  { key: 'system', label: 'System' },
  { key: 'dark', label: 'Dark' },
];

const QUERY = '(prefers-color-scheme: dark)';

/**
 * Theme preference, persisted in the local database.
 *
 * "system" follows the OS and keeps following it - the media query is watched,
 * so a tailor whose machine switches to dark at sunset sees the app follow
 * without restarting it.
 */
export function useTheme() {
  const [preference, setPreference] = useState('system');
  const [resolved, setResolved] = useState('light');

  const apply = useCallback((pref) => {
    const isDark = pref === 'dark' || (pref === 'system' && window.matchMedia(QUERY).matches);
    const theme = isDark ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    setResolved(theme);
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.settings
      .get({ key: 'theme', fallback: 'system' })
      .then((saved) => {
        if (cancelled) return;
        const pref = THEMES.some((t) => t.key === saved) ? saved : 'system';
        setPreference(pref);
        apply(pref);
      })
      .catch(() => apply('system'));
    return () => { cancelled = true; };
  }, [apply]);

  // Keep following the OS for as long as the preference says to.
  useEffect(() => {
    if (preference !== 'system') return undefined;
    const mq = window.matchMedia(QUERY);
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference, apply]);

  const choose = useCallback(
    async (pref) => {
      setPreference(pref);
      apply(pref);
      try {
        await api.settings.set({ key: 'theme', value: pref });
      } catch {
        /* the theme still applies for this session even if it cannot be saved */
      }
    },
    [apply]
  );

  return { preference, resolved, choose };
}
