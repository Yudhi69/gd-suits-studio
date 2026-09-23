/**
 * Renderer-side wrapper over the preload bridge.
 *
 * The bridge hands back `{ ok, data, error }`; this rebuilds a real Error -
 * with its `code` and `retryable` intact - inside the renderer's own world,
 * where custom properties survive. Everything in `src/` calls this, never
 * `window.gd` directly.
 */

const bridge = window.gd;

export class AppError extends Error {
  constructor({ message, code, retryable }) {
    super(message || 'Something went wrong');
    this.name = 'AppError';
    this.code = code ?? null;
    this.retryable = !!retryable;
  }
}

function wrap(group, action) {
  return async (payload) => {
    const res = await bridge[group][action](payload);
    if (!res?.ok) throw new AppError(res?.error ?? {});
    return res.data;
  };
}

const GROUPS = [
  'clients', 'projects', 'photos', 'references', 'clientMeasurements',
  'notes', 'measurements', 'fittings', 'settings', 'secrets',
  'ai', 'renders', 'project', 'app', 'updates', 'catalog',
  'payments', 'alterations', 'extras', 'analytics', 'media', 'members', 'suits', 'quote', 'forms',
];

export const api = {};
for (const group of GROUPS) {
  if (!bridge[group]) continue;
  api[group] = {};
  for (const action of Object.keys(bridge[group])) {
    api[group][action] = wrap(group, action);
  }
}

export const mediaUrl = bridge.mediaUrl;
export const projectMedia = bridge.projectMedia;
export const clientMedia = bridge.clientMedia;
export const brandedRender = bridge.brandedRender;

/** Turns any thrown error into the sentence shown in the UI. */
export function messageFor(err) {
  if (!err) return '';
  if (err.code === 'no_key') return 'No Gemini API key yet. Add one in Settings to turn on AI rendering.';
  if (err.code === 'offline') return 'No internet connection. Capture and notes still save normally - rendering needs a connection.';
  return err.message || String(err);
}
