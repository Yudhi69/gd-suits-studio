'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const media = require('./mediaUrl');

/**
 * The renderer gets exactly these channels and nothing else - no node, no fs,
 * no API key. Every call resolves to the handler's value or throws a plain
 * Error carrying the message the main process prepared for the tailor.
 */
const CHANNELS = [
  'clients:list', 'clients:get', 'clients:save', 'clients:delete',
  'projects:list', 'projects:get', 'projects:create', 'projects:update', 'projects:delete', 'projects:setQuote',
  'photos:add', 'photos:delete', 'photos:meta',
  'references:add', 'references:list', 'references:update', 'references:delete', 'references:history',
  'clientMeasurements:save', 'clientMeasurements:list', 'measurements:seedFromClient',
  'payments:add', 'payments:update', 'payments:delete',
  'alterations:add', 'alterations:update', 'alterations:delete',
  'extras:add', 'extras:update', 'extras:delete',
  'analytics:get',
  'media:download',
  'quote:email', 'quote:template',
  'mail:rules', 'mail:saveRule', 'mail:deleteRule', 'mail:due', 'mail:send', 'mail:preview',
  'business:get',
  'forms:save',
  'members:list', 'members:add', 'members:update', 'members:remove',
  'suits:list', 'suits:add', 'suits:update', 'suits:remove',
  'notes:add', 'notes:delete',
  'measurements:save',
  'fittings:add', 'fittings:update', 'fittings:delete',
  'catalog:list', 'catalog:addCategory', 'catalog:updateCategory', 'catalog:deleteCategory',
  'catalog:addItem', 'catalog:updateItem', 'catalog:deleteItem',
  'catalog:addOption', 'catalog:updateOption', 'catalog:deleteOption',
  'settings:get', 'settings:set',
  'secrets:describe', 'secrets:set',
  'ai:test', 'ai:models', 'ai:render', 'ai:analyse', 'ai:providers', 'ai:setConfig',
  'renders:approve', 'renders:delete',
  'project:export',
  'app:info', 'app:openDataFolder', 'app:security',
  'updates:check', 'updates:download', 'updates:defaultFeed',
  'updates:fetch', 'updates:cancel', 'updates:reveal',
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

/**
 * Download progress, the one thing that travels the other way.
 *
 * It only listens; there is no channel here for the renderer to send on. What
 * arrives was composed by the main process, so this is the app telling its own
 * window how far a download has got, not a way into it.
 */
api.updates.onProgress = (fn) => {
  const listener = (_event, data) => fn(data);
  ipcRenderer.on('updates:progress', listener);
  return () => ipcRenderer.removeListener('updates:progress', listener);
};

/** Media URL helpers, so the UI never hand-builds a gdmedia:// string. */
api.mediaUrl = media.mediaUrl;
api.projectMedia = media.projectMedia;
api.clientMedia = media.clientMedia;
api.brandedRender = media.brandedRender;

contextBridge.exposeInMainWorld('gd', api);
