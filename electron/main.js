'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, protocol, ipcMain, dialog, shell, Menu } = require('electron');

const db = require('./db');
const storage = require('./storage');
const secrets = require('./secrets');
const gemini = require('./ai/gemini');

const isDev = process.env.NODE_ENV === 'development';
const DEV_URL = 'http://localhost:5173';

/**
 * Stored media is served over a custom scheme rather than file:// so the
 * renderer can stay sandboxed with web security on.
 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'gdmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let mainWindow = null;

/** Single place that builds a media URL, matching the protocol handler above. */
const mediaUrl = (scope, filename) => `gdmedia://media/${scope}/${encodeURIComponent(filename)}`;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: '#12100e',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Anything that tries to open a new window goes to the real browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function buildMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open data folder',
          click: () => shell.openPath(app.getPath('userData')),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * A packaged macOS app has nowhere to print to - stdout goes nowhere and a
 * modal error box cannot be read by anything but a human. Startup problems are
 * therefore written to a log file as well, so a failure on a tailor's machine
 * can be diagnosed by asking them for one file.
 */
const LOG_PATH = path.join(os.tmpdir(), 'gd-suits-studio-startup.log');

function logLine(message) {
  try {
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()}  ${message}\n`);
  } catch {
    /* logging must never be the thing that breaks startup */
  }
}

/**
 * Anything that fails here leaves the app running with no window and no
 * message - a dead icon in the dock. Startup is wrapped so a failure is
 * reported to the user instead of vanishing into an unhandled rejection.
 */
function startup() {
  const userData = app.getPath('userData');
  logLine(`startup begin - userData=${userData} packaged=${app.isPackaged}`);
  db.open(userData);
  logLine('database opened');
  storage.init(userData);
  secrets.init(userData);
  logLine('storage and secrets ready');

  protocol.handle('gdmedia', async (request) => {
    try {
      // gdmedia://media/<scope>/<filename>
      const url = new URL(request.url);
      const [scope, ...rest] = url.pathname.replace(/^\//, '').split('/');
      const filename = decodeURIComponent(rest.join('/'));
      const buffer = storage.readImage(scope, filename);
      return new Response(buffer, {
        headers: { 'content-type': storage.mimeForFile(filename), 'cache-control': 'no-store' },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  buildMenu();
  createWindow();
  logLine('window created - startup complete');
}

app.whenReady().then(() => {
  try {
    startup();
  } catch (err) {
    logLine(`STARTUP FAILED: ${err?.stack ?? err}`);

    // A modal dialog is right for a tailor staring at a dead app, but it would
    // hang a headless test run forever - so in development the failure goes to
    // stderr and the process exits instead.
    if (app.isPackaged) {
      dialog.showErrorBox(
        'GD Suits Studio could not start',
        `${err?.message ?? err}\n\nA log was written to:\n${LOG_PATH}`
      );
    } else {
      console.error('\nSTARTUP FAILED\n', err?.stack ?? err, '\n');
    }
    app.exit(1);
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ------------------------------------------------------------------- IPC */

/** Wraps a handler so a thrown error reaches the UI as a message, not a crash. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return { ok: true, data: await fn(payload ?? {}) };
    } catch (err) {
      return {
        ok: false,
        error: { message: err?.message ?? String(err), code: err?.code ?? null, retryable: !!err?.retryable },
      };
    }
  });
}

/* clients + projects */
handle('clients:list', () => db.listClients());
handle('clients:save', (c) => db.upsertClient(c));
handle('clients:delete', ({ id }) => db.deleteClient(id));

handle('projects:list', ({ clientId } = {}) => db.listProjects(clientId));
handle('projects:get', ({ id }) => db.getProject(id));
handle('projects:create', (p) => db.createProject(p));
handle('projects:update', ({ id, patch }) => db.updateProject(id, patch));
handle('projects:delete', ({ id }) => {
  db.deleteProject(id);
  storage.deleteScopeMedia(storage.scopeForProject(id));
});

/* photos */
handle('photos:add', ({ projectId, slot, dataUrl, garment, fittingId, meta }) => {
  const scope = storage.scopeForProject(projectId);
  const { filename, mime } = storage.saveDataUrl(scope, dataUrl, slot);
  const id = db.addPhoto({ projectId, slot, filename, mime, garment, fittingId, meta });
  return { id, filename, mime, scope, url: mediaUrl(scope, filename) };
});
handle('photos:delete', ({ id }) => {
  const row = db.deletePhoto(id);
  if (row) storage.deleteImage(storage.scopeForProject(row.project_id), row.filename);
});
handle('photos:meta', ({ id, meta }) => db.updatePhotoMeta(id, meta));

/* client style-reference library - lives on the client, not the order */
handle('references:add', ({ clientId, projectId, dataUrl, kind, title, notes, tags }) => {
  const scope = storage.scopeForClient(clientId);
  const { filename, mime } = storage.saveDataUrl(scope, dataUrl, 'ref');
  const id = db.addReference({ clientId, projectId, filename, mime, kind, title, notes, tags });
  return { id, filename, mime, scope, url: mediaUrl(scope, filename) };
});
handle('references:list', ({ clientId }) => {
  const scope = storage.scopeForClient(clientId);
  return db.listReferences(clientId).map((r) => ({ ...r, scope, url: mediaUrl(scope, r.filename) }));
});
handle('references:update', ({ id, ...patch }) => db.updateReference(id, patch));
handle('references:delete', ({ id }) => {
  const row = db.deleteReference(id);
  if (row) storage.deleteImage(storage.scopeForClient(row.client_id), row.filename);
});
handle('references:history', ({ clientId }) => db.styleHistory(clientId));

/* client-level body measurements, carried between orders */
handle('clients:get', ({ id }) => db.getClient(id));
handle('clientMeasurements:save', (m) => db.saveClientMeasurement(m));
handle('clientMeasurements:list', ({ clientId }) => db.listClientMeasurements(clientId));
handle('measurements:seedFromClient', ({ projectId, clientId }) => db.seedMeasurementsFromClient(projectId, clientId));

/* notes, measurements, fittings */
handle('notes:add', (n) => db.addNote(n));
handle('notes:delete', ({ id }) => db.deleteNote(id));
handle('measurements:save', (m) => db.saveMeasurement(m));
handle('fittings:add', (f) => db.addFitting(f));
handle('fittings:update', ({ id, ...rest }) => db.updateFitting(id, rest));
handle('fittings:delete', ({ id }) => db.deleteFitting(id));

/* settings + secrets */
handle('settings:get', ({ key, fallback }) => db.getSetting(key, fallback ?? null));
handle('settings:set', ({ key, value }) => db.setSetting(key, value));
handle('secrets:describe', ({ name }) => secrets.describe(name));
handle('secrets:set', ({ name, value }) => {
  secrets.set(name, value);
  return secrets.describe(name);
});

/* AI */
handle('ai:test', () => gemini.testKey(secrets.get('gemini')));
handle('ai:models', () => gemini.listModels(secrets.get('gemini')));

handle('ai:render', async ({ projectId, prompt, view, refs = [], referenceIds = [], parentId, instruction, model }) => {
  const apiKey = secrets.get('gemini');
  const imageModel = model || db.getSetting('imageModel', gemini.DEFAULTS.imageModel);

  // Reference images are read here in main so file bytes never round-trip
  // through the renderer just to be sent back out again. `scope` is the media
  // folder: a project id for capture photos, `client-<id>` for the style library.
  const images = refs.map((ref) => ({
    mime: ref.mime ?? storage.mimeForFile(ref.filename),
    base64: storage.readAsBase64(ref.scope ?? storage.scopeForProject(projectId), ref.filename),
  }));

  const scope = storage.scopeForProject(projectId);
  const result = await gemini.generateImage({ apiKey, model: imageModel, prompt, images });
  const filename = storage.saveImage(scope, Buffer.from(result.base64, 'base64'), result.mime, 'render');

  const id = db.addRender({
    projectId,
    parentId,
    view,
    provider: 'gemini',
    model: result.model,
    prompt,
    instruction: instruction ?? '',
    filename,
  });

  // Record which style references fed this render, so the client's taste
  // history is evidence from real orders rather than a guess.
  if (referenceIds.length) db.linkRenderRefs(id, referenceIds);

  return { id, filename, scope, url: mediaUrl(scope, filename), notes: result.notes, model: result.model };
});

handle('ai:analyse', async ({ projectId, prompt, refs = [], schema, model }) => {
  const apiKey = secrets.get('gemini');
  const visionModel = model || db.getSetting('visionModel', gemini.DEFAULTS.visionModel);
  const images = refs.map((ref) => ({
    mime: ref.mime ?? storage.mimeForFile(ref.filename),
    base64: storage.readAsBase64(ref.scope ?? storage.scopeForProject(projectId), ref.filename),
  }));
  return gemini.analyse({ apiKey, model: visionModel, prompt, images, schema });
});

handle('renders:approve', ({ id, approved }) => db.setRenderApproved(id, approved));
handle('renders:delete', ({ id }) => {
  const row = db.deleteRender(id);
  if (row) storage.deleteImage(storage.scopeForProject(row.project_id), row.filename);
});

/* export - the "client file" the brief asks the system to keep */
handle('project:export', async ({ projectId, html }) => {
  const project = db.getProject(projectId);
  if (!project) throw new Error('Project not found');

  const safeName = `${project.name} ${project.surname}`.trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-') || 'client';
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export client file',
    defaultPath: path.join(app.getPath('documents'), `${safeName}-${projectId}`),
    buttonLabel: 'Export',
    properties: ['createDirectory'],
  });
  if (canceled || !filePath) return { exported: false };

  fs.mkdirSync(filePath, { recursive: true });
  const imagesDir = path.join(filePath, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });

  const projectScope = storage.scopeForProject(projectId);
  const refRows = db.listReferences(project.client_id);
  for (const row of [...project.photos, ...project.renders]) {
    try {
      fs.copyFileSync(storage.resolveSafe(projectScope, row.filename), path.join(imagesDir, row.filename));
    } catch {
      /* a missing file must not abort the whole export */
    }
  }

  // The client's style references belong in the file too - they are part of
  // the record of what this person asked for.
  const clientScope = storage.scopeForClient(project.client_id);
  for (const row of refRows) {
    try {
      fs.copyFileSync(storage.resolveSafe(clientScope, row.filename), path.join(imagesDir, row.filename));
    } catch {
      /* ignore a missing reference file */
    }
  }

  // The letterhead for the spec sheet travels with the export, so the folder
  // the client is sent is self-contained.
  try {
    fs.copyFileSync(
      path.join(__dirname, 'assets', 'gd-suits-logo.png'),
      path.join(imagesDir, 'gd-suits-logo.png')
    );
  } catch {
    /* the sheet still reads fine without the letterhead */
  }

  fs.writeFileSync(
    path.join(filePath, 'client-file.json'),
    JSON.stringify({ ...project, references: refRows }, null, 2)
  );
  if (html) fs.writeFileSync(path.join(filePath, 'spec-sheet.html'), html);

  shell.showItemInFolder(filePath);
  return { exported: true, path: filePath };
});

handle('app:info', () => ({
  version: app.getVersion(),
  userData: app.getPath('userData'),
  platform: process.platform,
  online: true,
}));

handle('app:openDataFolder', () => shell.openPath(app.getPath('userData')));
