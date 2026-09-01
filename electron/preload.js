'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The renderer gets exactly these channels and nothing else - no node, no fs,
 * no API key. Every call resolves to the handler's value or throws a plain
 * Error carrying the message the main process prepared for the tailor.
 */
const CHANNELS = [
  'clients:list', 'clients:get', 'clients:save', 'clients:delete',
  'projects:list', 'projects:get', 'projects:create', 'projects:update', 'projects:delete',
  'photos:add', 'photos:delete', 'photos:meta',
  'references:add', 'references:list', 'references:update', 'references:delete', 'references:history',
  'clientMeasurements:save', 'clientMeasurements:list', 'measurements:seedFromClient',
  'notes:add', 'notes:delete',
  'measurements:save',
  'fittings:add', 'fittings:update', 'fittings:delete',
  'settings:get', 'settings:set',
  'secrets:describe', 'secrets:set',
  'ai:test', 'ai:models', 'ai:render', 'ai:analyse',
  'renders:approve', 'renders:delete',
  'project:export',
  'app:info', 'app:openDataFolder', 'app:security',
];

/**
 * Results cross the bridge as plain `{ ok, data, error }` objects rather than
 * as thrown Errors. contextBridge only carries an Error's standard fields, so
 * a rejected call would arrive stripped of its `code` and `retryable` flags -
 * exactly the parts the UI needs to tell "no API key" from "you are offline".
 * `src/lib/api.js` rebuilds the real Error on the renderer side.
 */
function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
}

const api = {};
for (const channel of CHANNELS) {
  const [group, action] = channel.split(':');
  api[group] ??= {};
  api[group][action] = (payload) => invoke(channel, payload);
}

/** Media URL helpers, so the UI never hand-builds a gdmedia:// string. */
api.mediaUrl = (scope, filename) => (filename ? `gdmedia://${scope}/${encodeURIComponent(filename)}` : null);
api.projectMedia = (projectId, filename) => api.mediaUrl(projectId, filename);
api.clientMedia = (clientId, filename) => api.mediaUrl(`client-${clientId}`, filename);

contextBridge.exposeInMainWorld('gd', api);
