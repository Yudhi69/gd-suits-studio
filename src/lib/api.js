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
  /**
   * `channel` is which call failed.
   *
   * Without it an error from any of thirty groups reads only as "Something
   * went wrong" - which is how the bug below sat unnoticed: a rejection at
   * startup that nothing in it could place.
   */
  constructor({ message, code, retryable }, channel) {
    super(message || `Something went wrong (${channel ?? 'unknown call'})`);
    this.name = 'AppError';
    this.code = code ?? null;
    this.retryable = !!retryable;
    this.channel = channel ?? null;
  }
}

/**
 * Bridge entries that are not calls and must not be wrapped as one.
 *
 * `onProgress` subscribes and hands back the function that unsubscribes. Put
 * through the wrapper it was treated as an answer of `{ ok, data }`, found
 * neither, and threw - so the update progress bar never received a single
 * event and sat empty for the whole download.
 */
const SUBSCRIPTIONS = new Set(['updates:onProgress']);

function wrap(group, action) {
  const channel = `${group}:${action}`;
  return async (payload) => {
    const res = await bridge[group][action](payload);
    if (!res?.ok) throw new AppError(res?.error ?? {}, channel);
    return res.data;
  };
}

const GROUPS = [
  'clients', 'projects', 'photos', 'references', 'clientMeasurements',
  'notes', 'measurements', 'fittings', 'settings', 'secrets',
  'ai', 'renders', 'project', 'app', 'updates', 'catalog',
  'payments', 'alterations', 'extras', 'analytics', 'media', 'members', 'suits', 'quote', 'forms', 'business',
];

export const api = {};
for (const group of GROUPS) {
  if (!bridge[group]) continue;
  api[group] = {};
  for (const action of Object.keys(bridge[group])) {
    api[group][action] = SUBSCRIPTIONS.has(`${group}:${action}`)
      ? bridge[group][action]
      : wrap(group, action);
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
