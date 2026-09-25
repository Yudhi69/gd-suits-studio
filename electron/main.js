'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { app, BrowserWindow, protocol, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');

const db = require('./db');
const storage = require('./storage');
const secrets = require('./secrets');
const gemini = require('./ai/gemini');
const aiProviders = require('./ai/registry');
const security = require('./security');
const media = require('./mediaUrl');
const brand = require('./brand');
const mail = require('./mailTemplate');
const rules = require('./mailRules');
const integrations = require('./integrations');
const business = require('./business');

/** The shop's details as they are set today, never as they were compiled. */
const shop = () => business.withDefaults(db.getSetting('business', null));
const updater = require('./updater');
const v = require('./validate');

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

/** Defined once in ./mediaUrl so the preload cannot drift from it again. */
const mediaUrl = media.mediaUrl;

/**
 * The window paints its background before the renderer has loaded, so it is
 * set from the saved preference. Without this a tailor on the light theme gets
 * a black flash on every launch.
 */
function startupBackground() {
  const preference = db.getSetting('theme', 'system');
  const dark = preference === 'dark' || (preference === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? '#121110' : '#f4f2ee';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: startupBackground(),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      // The bundled preload: sandboxed preloads cannot require relative
      // files, so it is built with its imports inlined (npm run build:preload).
      preload: path.join(__dirname, 'preload.build.js'),
      // The renderer is treated as untrusted: no Node, isolated context, and
      // run inside the OS sandbox. The preload only needs `electron`, which
      // sandboxed preloads still get, so nothing here depends on Node access.
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      webviewTag: false,
      spellcheck: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  security.hardenWindow(mainWindow, isDev);
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

  security.hardenSession(isDev);

  db.open(userData);
  logLine('database opened');
  storage.init(userData);
  secrets.init(userData);

  // Client photographs, measurements and contact details are personal data.
  // Keep the whole store owner-only rather than relying on the default umask.
  for (const dir of [path.join(userData, 'data'), path.join(userData, 'media')]) {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      /* best effort - Windows ACLs do not map onto POSIX modes */
    }
  }
  logLine('storage and secrets ready');

  protocol.handle('gdmedia', async (request) => {
    try {
      // gdmedia://media/<scope>/<filename>[?branded=1]
      const url = new URL(request.url);
      const { scope, filename } = media.parseMediaPath(url.pathname);
      const buffer = storage.readImage(scope, filename);

      // The badge is added for renders only, decided against the database.
      // Asking for it on a client's photograph is ignored rather than obeyed.
      if (url.searchParams.get('branded') === '1' && isRenderMedia(scope, filename)) {
        const format = brand.formatFor(filename);
        try {
          return new Response(brand.stampCached(`${scope}/${filename}`, buffer, format), {
            headers: { 'content-type': brand.mimeFor(format), 'cache-control': 'no-store' },
          });
        } catch {
          // A preview that shows the render unbadged beats one that shows
          // nothing. Downloads do not get this leniency.
        }
      }
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
handle('clients:get', ({ id }) => db.getClient(v.id(id)));
handle('clients:save', (c) => db.upsertClient({
  id: v.optionalId(c.id),
  name: v.str(c.name, 'name', 120),
  surname: v.str(c.surname, 'surname', 120),
  contact: v.str(c.contact, 'contact number', 60),
  email: v.str(c.email, 'email', 200),
  dob: v.str(c.dob, 'date of birth', 40),
  postalAddress: v.str(c.postalAddress, 'postal address', 500),
  isMinor: !!c.isMinor,
  secondaryName: v.str(c.secondaryName, 'name', 200),
  secondaryRelationship: v.str(c.secondaryRelationship, 'relationship', 60),
  secondaryContact: v.str(c.secondaryContact, 'contact number', 60),
  secondaryEmail: v.str(c.secondaryEmail, 'email', 200),
  profile: v.jsonBlob(c.profile, 'profile', 64 * 1024),
}));
handle('clients:delete', ({ id }) => {
  const clientId = v.id(id);
  // Media is filed per project and per client, so both have to go for a
  // deletion to actually be a deletion.
  for (const project of db.listProjects(clientId)) {
    storage.deleteScopeMedia(storage.scopeForProject(project.id));
  }
  storage.deleteScopeMedia(storage.scopeForClient(clientId));
  db.deleteClient(clientId);
});

handle('projects:list', ({ clientId } = {}) => db.listProjects(v.optionalId(clientId, 'clientId')));
handle('projects:get', ({ id }) => db.getProject(v.id(id)));
handle('projects:create', (p) => db.createProject({
  clientId: v.id(p.clientId, 'clientId'),
  title: v.str(p.title, 'title', 160),
  eventType: v.str(p.eventType, 'eventType', 40),
  eventOther: v.str(p.eventOther, 'eventOther', 200),
  eventDate: v.str(p.eventDate, 'eventDate', 40),
  deliveryDate: v.str(p.deliveryDate, 'deliveryDate', 40),
}));
handle('projects:update', ({ id, patch = {} }) => {
  const clean = {};
  if (patch.title !== undefined) clean.title = v.str(patch.title, 'title', 160);
  if (patch.event_type !== undefined) clean.event_type = v.str(patch.event_type, 'event type', 40);
  if (patch.event_other !== undefined) clean.event_other = v.str(patch.event_other, 'event detail', 200);
  if (patch.event_date !== undefined) clean.event_date = v.str(patch.event_date, 'event date', 40);
  if (patch.delivery_date !== undefined) clean.delivery_date = v.str(patch.delivery_date, 'delivery date', 40);
  for (const key of ['consultation_date', 'measurement_date', 'first_fitting_date', 'final_fitting_date']) {
    if (patch[key] !== undefined) clean[key] = v.str(patch[key], key.replace(/_/g, ' '), 40);
  }
  if (patch.status !== undefined) clean.status = v.oneOf(patch.status, v.PROJECT_STATUSES, 'status');
  if (patch.quantity !== undefined) clean.quantity = v.num(patch.quantity, 'quantity', { min: 1, max: 999 }) ?? 1;
  for (const key of ['fabric_name', 'fabric_code', 'supplier']) {
    if (patch[key] !== undefined) clean[key] = v.str(patch[key], key.replace(/_/g, ' '), 160);
  }
  if (patch.first_appointment !== undefined) clean.first_appointment = v.str(patch.first_appointment, 'appointment', 40);
  if (patch.appointment_notes !== undefined) clean.appointment_notes = v.str(patch.appointment_notes, 'notes', 4000);
  if (patch.comments !== undefined) clean.comments = v.str(patch.comments, 'comments', 8000);
  for (const key of ['lining', 'design', 'shirt', 'balance_note']) {
    if (patch[key] !== undefined) clean[key] = v.str(patch[key], key, 2000);
  }
  // A URL from the workbook is stored and shown, never fetched by the app.
  if (patch.form_url !== undefined) clean.form_url = v.str(patch.form_url, 'form link', 500);
  if (patch.imported_balance !== undefined) {
    clean.imported_balance = v.num(patch.imported_balance, 'balance', { min: 0, max: 1e7 }) ?? 0;
  }
  if (patch.measurement_form_received !== undefined) clean.measurement_form_received = patch.measurement_form_received ? 1 : 0;
  if (patch.form_printed !== undefined) clean.form_printed = patch.form_printed ? 1 : 0;
  if (patch.spec !== undefined) clean.spec = v.jsonBlob(patch.spec, 'spec');
  if (patch.analysis !== undefined) clean.analysis = v.jsonBlob(patch.analysis, 'analysis');
  return db.updateProject(v.id(id), clean);
});
/**
 * Stores the agreed quote. The figures are computed in the renderer, which is
 * where the catalog and the price list live; this bounds and records them.
 */
handle('projects:setQuote', ({ id, quote }) => {
  const projectId = v.id(id);
  if (quote === null) return db.setQuote(projectId, null);

  if (!Array.isArray(quote?.lines)) throw new v.ValidationError('A quote needs a list of lines');
  if (quote.lines.length > 400) throw new v.ValidationError('That is too many quote lines');

  return db.setQuote(projectId, {
    lines: quote.lines.map((line) => ({
      group: v.str(line.group, 'group', 80),
      label: v.str(line.label, 'label', 200),
      amount: v.num(line.amount, 'amount', { min: -1e7, max: 1e7 }) ?? 0,
      key: v.str(line.key, 'key', 120),
    })),
    total: v.num(quote.total, 'total', { min: -1e9, max: 1e9 }) ?? 0,
    currency: v.str(quote.currency, 'currency', 8),
    at: new Date().toISOString(),
    status: v.oneOf(quote.status ?? 'approved', v.PROJECT_STATUSES, 'status'),
  });
});

handle('projects:delete', ({ id }) => {
  const projectId = v.id(id);
  db.deleteProject(projectId);
  storage.deleteScopeMedia(storage.scopeForProject(projectId));
});

/* photos */
handle('photos:add', ({ projectId, clientId, suitId, slot, dataUrl, garment, fittingId, meta }) => {
  const pid = v.id(projectId, 'projectId');
  const scope = storage.scopeForProject(pid);
  const saved = storage.saveDataUrl(scope, v.dataUrl(dataUrl), v.oneOf(slot, v.PHOTO_SLOTS, 'slot'));
  // A caller that does not name an owner gets the order's first suit and the
  // person it is for, which on an order of one is the only answer there is.
  const fallback = db.defaultPhotoOwner(pid);
  const id = db.addPhoto({
    projectId: pid,
    clientId: v.optionalId(clientId, 'clientId') ?? fallback.clientId,
    suitId: v.optionalId(suitId, 'suitId') ?? fallback.suitId,
    slot: v.oneOf(slot, v.PHOTO_SLOTS, 'slot'),
    filename: saved.filename,
    mime: saved.mime,
    garment: v.oneOf(garment, v.GARMENTS, 'garment'),
    fittingId: v.optionalId(fittingId, 'fittingId'),
    meta: v.jsonBlob(meta, 'meta', 8 * 1024) ?? {},
  });
  return { id, filename: saved.filename, mime: saved.mime, scope, url: mediaUrl(scope, saved.filename) };
});
handle('photos:delete', ({ id }) => {
  const row = db.deletePhoto(v.id(id));
  if (row) storage.deleteImage(storage.scopeForProject(row.project_id), row.filename);
});
handle('photos:meta', ({ id, meta }) => db.updatePhotoMeta(v.id(id), v.jsonBlob(meta, 'meta', 8 * 1024) ?? {}));

/* client style-reference library - lives on the client, not the order */
handle('references:add', ({ clientId, projectId, dataUrl, kind, title, notes, tags }) => {
  const cid = v.id(clientId, 'clientId');
  const scope = storage.scopeForClient(cid);
  const saved = storage.saveDataUrl(scope, v.dataUrl(dataUrl), 'ref');
  const id = db.addReference({
    clientId: cid,
    projectId: v.optionalId(projectId, 'projectId'),
    filename: saved.filename,
    mime: saved.mime,
    kind: v.oneOf(kind, v.REFERENCE_KINDS, 'kind') || 'style',
    title: v.str(title, 'title', 160),
    notes: v.str(notes, 'notes', 4000),
    tags: v.str(tags, 'tags', 400),
  });
  return { id, filename: saved.filename, mime: saved.mime, scope, url: mediaUrl(scope, saved.filename) };
});
handle('references:list', ({ clientId }) => {
  const cid = v.id(clientId, 'clientId');
  const scope = storage.scopeForClient(cid);
  return db.listReferences(cid).map((r) => ({ ...r, scope, url: mediaUrl(scope, r.filename) }));
});
handle('references:update', ({ id, title, notes, tags, kind, favourite }) => db.updateReference(v.id(id), {
  title: title === undefined ? undefined : v.str(title, 'title', 160),
  notes: notes === undefined ? undefined : v.str(notes, 'notes', 4000),
  tags: tags === undefined ? undefined : v.str(tags, 'tags', 400),
  kind: kind === undefined ? undefined : v.oneOf(kind, v.REFERENCE_KINDS, 'kind'),
  favourite,
}));
handle('references:delete', ({ id }) => {
  const row = db.deleteReference(v.id(id));
  if (row) storage.deleteImage(storage.scopeForClient(row.client_id), row.filename);
});
handle('references:history', ({ clientId }) => db.styleHistory(v.id(clientId, 'clientId')));

/* client-level body measurements, carried between orders */
handle('clientMeasurements:save', (m) => db.saveClientMeasurement({
  clientId: v.id(m.clientId, 'clientId'),
  garment: v.oneOf(m.garment, v.GARMENTS, 'garment'),
  fieldId: v.str(m.fieldId, 'fieldId', 60),
  value: v.num(m.value, 'measurement', { min: 0, max: 500 }),
  unit: v.oneOf(m.unit ?? 'cm', ['cm', 'in'], 'unit'),
}));
handle('clientMeasurements:list', ({ clientId }) => db.listClientMeasurements(v.id(clientId, 'clientId')));
handle('measurements:seedFromClient', ({ projectId, clientId }) =>
  db.seedMeasurementsFromClient(v.id(projectId, 'projectId'), v.id(clientId, 'clientId')));

/* the people on an order, and the suits they are having */

/**
 * Adds a person to an order. They become a client in their own right, so a
 * groomsman measured today has a body record and a photograph of his own, and
 * when he comes back next year on his own account they are already there.
 */
handle('members:add', (r) => {
  const projectId = v.id(r.projectId, 'projectId');
  const clientId = r.clientId
    ? v.id(r.clientId, 'clientId')
    : db.upsertClient({
        name: v.str(r.name, 'name', 120),
        surname: v.str(r.surname, 'surname', 120),
        contact: v.str(r.contact, 'contact number', 60),
        email: v.str(r.email, 'email', 200),
      });
  const memberId = db.addMember({ projectId, clientId, role: v.str(r.role, 'role', 60) });
  // A person on an order is there to be measured for something, so they
  // arrive with a suit rather than an empty row to be filled in later.
  if (r.withSuit !== false) db.addSuit({ projectId, clientId, label: v.str(r.label, 'label', 80) });
  return { memberId, clientId };
});
handle('members:list', ({ projectId }) => db.listMembers(v.id(projectId, 'projectId')));
handle('members:update', ({ id, role, position }) => db.updateMember(v.id(id), {
  role: role === undefined ? undefined : v.str(role, 'role', 60),
  position: position === undefined ? undefined : v.num(position, 'position', { min: 0, max: 999 }),
}));
handle('members:remove', ({ id }) => db.removeMember(v.id(id)));

handle('suits:list', ({ projectId }) => db.listSuits(v.id(projectId, 'projectId')));
handle('suits:add', (r) => db.addSuit({
  projectId: v.id(r.projectId, 'projectId'),
  clientId: v.id(r.clientId, 'clientId'),
  label: v.str(r.label, 'label', 80),
}));
handle('suits:update', ({ id, patch = {} }) => {
  const clean = {};
  for (const key of ['label', 'fabric_name', 'fabric_code', 'supplier']) {
    if (patch[key] !== undefined) clean[key] = v.str(patch[key], key.replace(/_/g, ' '), 160);
  }
  if (patch.quantity !== undefined) clean.quantity = v.num(patch.quantity, 'quantity', { min: 1, max: 999 }) ?? 1;
  if (patch.position !== undefined) clean.position = v.num(patch.position, 'position', { min: 0, max: 999 }) ?? 0;
  if (patch.spec !== undefined) clean.spec = v.jsonBlob(patch.spec, 'spec', 256 * 1024);
  return db.updateSuit(v.id(id), clean);
});
handle('suits:remove', ({ id }) => db.removeSuit(v.id(id)));

/* money, alterations and extras - the workbook's other sheets */
handle('payments:add', (r) => db.addPayment({
  project_id: v.id(r.projectId, 'projectId'),
  kind: v.oneOf(r.kind ?? 'deposit', v.PAYMENT_KINDS, 'payment kind'),
  amount: v.num(r.amount, 'amount', { min: 0, max: 1e7 }) ?? 0,
  paid_on: v.str(r.paidOn, 'date', 40),
  method: v.str(r.method, 'method', 60),
  reference: v.str(r.reference, 'reference', 120),
  note: v.str(r.note, 'note', 500),
}));
handle('payments:update', ({ id, ...r }) => db.updatePayment(v.id(id), {
  kind: r.kind === undefined ? undefined : v.oneOf(r.kind, v.PAYMENT_KINDS, 'payment kind'),
  amount: r.amount === undefined ? undefined : v.num(r.amount, 'amount', { min: 0, max: 1e7 }) ?? 0,
  paid_on: r.paidOn === undefined ? undefined : v.str(r.paidOn, 'date', 40),
  method: r.method === undefined ? undefined : v.str(r.method, 'method', 60),
  reference: r.reference === undefined ? undefined : v.str(r.reference, 'reference', 120),
  note: r.note === undefined ? undefined : v.str(r.note, 'note', 500),
}));
handle('payments:delete', ({ id }) => db.deletePayment(v.id(id)));

handle('alterations:add', (r) => db.addAlteration({
  project_id: v.id(r.projectId, 'projectId'),
  garment: v.oneOf(r.garment ?? '', v.GARMENTS, 'garment'),
  description: v.str(r.description, 'description', 500),
  kind: v.str(r.kind, 'alteration type', 80),
  status: v.oneOf(r.status ?? 'received', v.ALTERATION_STATUSES, 'status'),
  received_on: v.str(r.receivedOn, 'date', 40),
  due_on: v.str(r.dueOn, 'date', 40),
  confirmed_on: v.str(r.confirmedOn, 'date', 40),
  cost: v.num(r.cost, 'cost', { min: 0, max: 1e7 }) ?? 0,
  note: v.str(r.note, 'note', 1000),
}));
handle('alterations:update', ({ id, ...r }) => db.updateAlteration(v.id(id), {
  garment: r.garment === undefined ? undefined : v.oneOf(r.garment, v.GARMENTS, 'garment'),
  description: r.description === undefined ? undefined : v.str(r.description, 'description', 500),
  kind: r.kind === undefined ? undefined : v.str(r.kind, 'alteration type', 80),
  status: r.status === undefined ? undefined : v.oneOf(r.status, v.ALTERATION_STATUSES, 'status'),
  received_on: r.receivedOn === undefined ? undefined : v.str(r.receivedOn, 'date', 40),
  due_on: r.dueOn === undefined ? undefined : v.str(r.dueOn, 'date', 40),
  confirmed_on: r.confirmedOn === undefined ? undefined : v.str(r.confirmedOn, 'date', 40),
  cost: r.cost === undefined ? undefined : v.num(r.cost, 'cost', { min: 0, max: 1e7 }) ?? 0,
  note: r.note === undefined ? undefined : v.str(r.note, 'note', 1000),
}));
handle('alterations:delete', ({ id }) => db.deleteAlteration(v.id(id)));

handle('extras:add', (r) => db.addOrderExtra({
  project_id: v.id(r.projectId, 'projectId'),
  extra_type: v.str(r.extraType, 'type', 120),
  colour: v.str(r.colour, 'colour', 80),
  quantity: v.num(r.quantity, 'quantity', { min: 0, max: 999 }) ?? 1,
  status: v.oneOf(r.status ?? 'ordered', v.EXTRA_STATUSES, 'status'),
  unit_price: v.num(r.unitPrice, 'price', { min: 0, max: 1e7 }) ?? 0,
  note: v.str(r.note, 'note', 500),
}));
handle('extras:update', ({ id, ...r }) => db.updateOrderExtra(v.id(id), {
  extra_type: r.extraType === undefined ? undefined : v.str(r.extraType, 'type', 120),
  colour: r.colour === undefined ? undefined : v.str(r.colour, 'colour', 80),
  quantity: r.quantity === undefined ? undefined : v.num(r.quantity, 'quantity', { min: 0, max: 999 }) ?? 1,
  status: r.status === undefined ? undefined : v.oneOf(r.status, v.EXTRA_STATUSES, 'status'),
  unit_price: r.unitPrice === undefined ? undefined : v.num(r.unitPrice, 'price', { min: 0, max: 1e7 }) ?? 0,
  note: r.note === undefined ? undefined : v.str(r.note, 'note', 500),
}));
handle('extras:delete', ({ id }) => db.deleteOrderExtra(v.id(id)));

handle('analytics:get', ({ from, to } = {}) => db.analytics({
  from: from ? v.str(from, 'from', 40) : undefined,
  to: to ? v.str(to, 'to', 40) : undefined,
}));

/* notes, measurements, fittings */
handle('notes:add', (n) => db.addNote({
  projectId: v.id(n.projectId, 'projectId'),
  step: v.str(n.step, 'step', 40),
  body: v.str(n.body, 'note', 20000),
  author: v.str(n.author, 'author', 60),
}));
handle('notes:delete', ({ id }) => db.deleteNote(v.id(id)));
handle('measurements:save', (m) => db.saveMeasurement({
  projectId: v.id(m.projectId, 'projectId'),
  suitId: v.optionalId(m.suitId, 'suitId'),
  garment: v.oneOf(m.garment, v.GARMENTS, 'garment'),
  fieldId: v.str(m.fieldId, 'fieldId', 60),
  value: v.num(m.value, 'measurement', { min: 0, max: 500 }),
  unit: v.oneOf(m.unit ?? 'cm', ['cm', 'in'], 'unit'),
  source: v.str(m.source, 'source', 40),
}));
handle('fittings:add', (f) => db.addFitting({
  projectId: v.id(f.projectId, 'projectId'),
  tailorNotes: v.str(f.tailorNotes, 'notes', 20000),
  clientNotes: v.str(f.clientNotes, 'notes', 20000),
  kind: f.kind === undefined ? undefined : v.oneOf(f.kind, v.FITTING_KINDS, 'fitting kind'),
}));
handle('fittings:update', ({ id, tailorNotes, clientNotes, kind }) => db.updateFitting(v.id(id), {
  tailorNotes: tailorNotes === undefined ? undefined : v.str(tailorNotes, 'notes', 20000),
  clientNotes: clientNotes === undefined ? undefined : v.str(clientNotes, 'notes', 20000),
  kind: kind === undefined ? undefined : v.oneOf(kind, v.FITTING_KINDS, 'fitting kind'),
}));
handle('fittings:delete', ({ id }) => db.deleteFitting(v.id(id)));

/**
 * Which provider and model handles each job.
 *
 * Falls back to the older single-provider settings so an existing install
 * keeps working without the tailor reconfiguring anything.
 */
function getAiConfig() {
  const stored = db.getSetting('aiConfig', null);
  const customBaseUrl = stored?.customBaseUrl ?? '';
  return {
    customBaseUrl,
    image: {
      provider: stored?.image?.provider ?? 'gemini',
      model: stored?.image?.model ?? db.getSetting('imageModel', gemini.DEFAULTS.imageModel),
    },
    vision: {
      provider: stored?.vision?.provider ?? 'gemini',
      model: stored?.vision?.model ?? db.getSetting('visionModel', gemini.DEFAULTS.visionModel),
    },
  };
}

/* the tailor's own catalog */
const ITEM_KINDS = ['toggle', 'choice'];

function cleanOptions(options) {
  if (!Array.isArray(options)) return [];
  if (options.length > 40) throw new v.ValidationError('That is too many options (limit 40)');
  return options.map((o, i) => ({
    key: v.str(o.key, 'option key', 60) || `opt${i}`,
    label: v.str(o.label, 'option label', 120),
    desc: v.str(o.desc, 'option note', 200),
    price: v.num(o.price, 'option price', { min: 0, max: 1e7 }) ?? 0,
  }));
}

handle('catalog:list', () => ({
  categories: db.listCustomCategories(),
  items: db.listCustomItems(),
  options: db.listCustomOptions(),
}));

handle('catalog:addOption', ({ fieldId, label, description, price, prompt }) =>
  db.addCustomOption({
    fieldId: v.str(fieldId, 'field', 80),
    label: v.str(label, 'option name', 120),
    description: v.str(description, 'note', 200),
    price: v.num(price, 'price', { min: 0, max: 1e7 }) ?? 0,
    prompt: v.str(prompt, 'render wording', 300),
  })
);
handle('catalog:updateOption', ({ id, ...patch }) =>
  db.updateCustomOption(v.id(id), {
    label: patch.label === undefined ? undefined : v.str(patch.label, 'option name', 120),
    description: patch.description === undefined ? undefined : v.str(patch.description, 'note', 200),
    price: patch.price === undefined ? undefined : v.num(patch.price, 'price', { min: 0, max: 1e7 }) ?? 0,
    prompt: patch.prompt === undefined ? undefined : v.str(patch.prompt, 'render wording', 300),
    active: patch.active,
  })
);
handle('catalog:deleteOption', ({ id }) => db.deleteCustomOption(v.id(id)));
handle('catalog:addCategory', ({ title, blurb }) =>
  db.addCustomCategory({ title: v.str(title, 'category name', 80), blurb: v.str(blurb, 'description', 300) })
);
handle('catalog:updateCategory', ({ id, title, blurb, sort }) =>
  db.updateCustomCategory(v.id(id), {
    title: title === undefined ? undefined : v.str(title, 'category name', 80),
    blurb: blurb === undefined ? undefined : v.str(blurb, 'description', 300),
    sort: sort === undefined ? undefined : v.num(sort, 'order', { min: 0, max: 9999 }),
  })
);
handle('catalog:deleteCategory', ({ id }) => db.deleteCustomCategory(v.id(id)));

handle('catalog:addItem', ({ category, label, kind, price, options, description, prompt }) =>
  db.addCustomItem({
    category: v.str(category, 'category', 80),
    label: v.str(label, 'item name', 120),
    kind: v.oneOf(kind ?? 'toggle', ITEM_KINDS, 'kind'),
    price: v.num(price, 'price', { min: 0, max: 1e7 }) ?? 0,
    options: cleanOptions(options),
    description: v.str(description, 'note', 300),
    prompt: v.str(prompt, 'render wording', 300),
  })
);
handle('catalog:updateItem', ({ id, ...patch }) =>
  db.updateCustomItem(v.id(id), {
    label: patch.label === undefined ? undefined : v.str(patch.label, 'item name', 120),
    kind: patch.kind === undefined ? undefined : v.oneOf(patch.kind, ITEM_KINDS, 'kind'),
    price: patch.price === undefined ? undefined : v.num(patch.price, 'price', { min: 0, max: 1e7 }) ?? 0,
    options: patch.options === undefined ? undefined : cleanOptions(patch.options),
    description: patch.description === undefined ? undefined : v.str(patch.description, 'note', 300),
    prompt: patch.prompt === undefined ? undefined : v.str(patch.prompt, 'render wording', 300),
    category: patch.category === undefined ? undefined : v.str(patch.category, 'category', 80),
    active: patch.active,
  })
);
handle('catalog:deleteItem', ({ id }) => db.deleteCustomItem(v.id(id)));

/* settings + secrets */
const SETTING_KEYS = ['priceOverrides', 'imageModel', 'visionModel', 'theme', 'updateFeed', 'autoCheckUpdates', 'measureUnit', 'aiConfig',
  'quoteEmailTemplate', 'quoteEmailSubject', 'business', 'integrations'];
handle('settings:get', ({ key, fallback }) => db.getSetting(v.oneOf(key, SETTING_KEYS, 'setting'), fallback ?? null));
handle('settings:set', ({ key, value }) => {
  const name = v.oneOf(key, SETTING_KEYS, 'setting');
  if (name === 'imageModel' || name === 'visionModel') return db.setSetting(name, v.modelName(value));
  if (name === 'theme') return db.setSetting(name, v.oneOf(value, ['system', 'light', 'dark'], 'theme'));
  if (name === 'updateFeed') return db.setSetting(name, v.str(value, 'update address', 500).trim());
  if (name === 'autoCheckUpdates') return db.setSetting(name, !!value);
  if (name === 'measureUnit') return db.setSetting(name, v.oneOf(value, ['cm', 'in'], 'unit'));
  if (name === 'aiConfig') return db.setSetting(name, v.jsonBlob(value, 'ai config', 8 * 1024));
  // The mail wording is text, not a structure - jsonBlob would refuse it.
  if (name === 'quoteEmailTemplate') return db.setSetting(name, v.str(value, 'message', 8 * 1024));
  if (name === 'quoteEmailSubject') return db.setSetting(name, v.str(value, 'subject', 300));
  if (name === 'business') return db.setSetting(name, business.withDefaults(v.jsonBlob(value, 'business details', 16 * 1024)));
  return db.setSetting(name, v.jsonBlob(value, 'value', 128 * 1024));
});
const SECRET_NAMES = [...aiProviders.SECRET_NAMES, 'updateToken', ...integrations.SECRET_NAMES];
handle('secrets:describe', ({ name }) => secrets.describe(v.oneOf(name, SECRET_NAMES, 'secret')));
handle('secrets:set', ({ name, value }) => {
  const secret = v.oneOf(name, SECRET_NAMES, 'secret');
  secrets.set(secret, v.str(value, 'key', 400).trim());
  return secrets.describe(secret);
});

/* AI */
handle('ai:providers', () => {
  const config = getAiConfig();
  return {
    providers: aiProviders.describe(config.customBaseUrl).map((p) => ({
      ...p,
      key: secrets.describe(p.id),
    })),
    config,
  };
});

handle('ai:test', ({ provider = 'gemini' } = {}) => {
  const config = getAiConfig();
  return aiProviders.get(v.oneOf(provider, aiProviders.PROVIDER_IDS, 'provider'), config.customBaseUrl)
    .testKey(secrets.get(provider));
});

handle('ai:models', ({ provider = 'gemini' } = {}) => {
  const config = getAiConfig();
  return aiProviders.get(v.oneOf(provider, aiProviders.PROVIDER_IDS, 'provider'), config.customBaseUrl)
    .listModels(secrets.get(provider));
});

handle('ai:setConfig', ({ image, vision, customBaseUrl }) => {
  const clean = {
    customBaseUrl: v.str(customBaseUrl, 'address', 400).trim(),
    image: {
      provider: v.oneOf(image?.provider ?? 'gemini', aiProviders.PROVIDER_IDS, 'image provider'),
      model: v.modelName(image?.model ?? ''),
    },
    vision: {
      provider: v.oneOf(vision?.provider ?? 'gemini', aiProviders.PROVIDER_IDS, 'vision provider'),
      model: v.modelName(vision?.model ?? ''),
    },
  };
  // https everywhere except loopback: a local model server (ComfyUI, LM Studio,
  // Automatic1111) only ever listens on plain http, and refusing that would
  // block the one genuinely free way to render.
  if (clean.customBaseUrl) {
    let parsed;
    try {
      parsed = new URL(clean.customBaseUrl);
    } catch {
      throw new Error('That custom AI endpoint is not a valid URL.');
    }
    const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
      throw new Error('A custom AI endpoint must use https, unless it is running on this machine (localhost).');
    }
  }
  db.setSetting('aiConfig', clean);
  return clean;
});

/**
 * Reference images are read here in main so file bytes never round-trip
 * through the renderer just to be sent back out again. Every filename and
 * scope is validated first, so a compromised renderer cannot use this to read
 * arbitrary files off the disk.
 */
function loadRefImages(refs, defaultScope) {
  if (!Array.isArray(refs)) v.str(refs, 'refs');
  if (refs.length > 8) throw new v.ValidationError('Too many reference images (limit 8)');
  return refs.map((ref) => {
    const scope = ref.scope ? v.scope(ref.scope) : defaultScope;
    const filename = v.filename(ref.filename);
    return { mime: storage.mimeForFile(filename), base64: storage.readAsBase64(scope, filename) };
  });
}

handle('ai:render', async ({ projectId, suitId, batchId, prompt, view, refs = [], referenceIds = [], parentId, instruction, model }) => {
  const pid = v.id(projectId, 'projectId');
  const scope = storage.scopeForProject(pid);
  const config = getAiConfig();
  const adapter = aiProviders.get(config.image.provider, config.customBaseUrl);
  const imageModel = model ? v.modelName(model) : config.image.model;

  const images = loadRefImages(refs, scope);
  const result = await adapter.generateImage({
    apiKey: secrets.get(config.image.provider),
    model: imageModel,
    prompt: v.str(prompt, 'prompt', 20000),
    images,
  });
  const filename = storage.saveImage(scope, Buffer.from(result.base64, 'base64'), result.mime, 'render');

  const id = db.addRender({
    projectId: pid,
    suitId: v.optionalId(suitId, 'suitId'),
    // The four views of one press carry the same batch, so the preview can
    // show them as one render rather than four that happened to be close
    // together.
    batchId: v.batchId(batchId),
    parentId: v.optionalId(parentId, 'parentId'),
    view: v.str(view, 'view', 40),
    provider: config.image.provider,
    model: result.model ?? imageModel,
    prompt,
    instruction: v.str(instruction, 'instruction', 4000),
    filename,
  });

  // Record which style references fed this render, so the client's taste
  // history is evidence from real orders rather than a guess.
  const ids = referenceIds.slice(0, 8).map((r) => v.id(r, 'referenceId'));
  if (ids.length) db.linkRenderRefs(id, ids);

  return { id, filename, scope, url: mediaUrl(scope, filename), notes: result.notes, model: result.model };
});

handle('ai:analyse', async ({ projectId, prompt, refs = [], schema, model }) => {
  const pid = v.id(projectId, 'projectId');
  const config = getAiConfig();
  const adapter = aiProviders.get(config.vision.provider, config.customBaseUrl);
  const images = loadRefImages(refs, storage.scopeForProject(pid));
  return adapter.analyse({
    apiKey: secrets.get(config.vision.provider),
    model: model ? v.modelName(model) : config.vision.model,
    prompt: v.str(prompt, 'prompt', 20000),
    images,
    schema: v.jsonBlob(schema, 'schema', 32 * 1024),
  });
});


handle('renders:approve', ({ id, approved }) => db.setRenderApproved(v.id(id), !!approved));
handle('renders:delete', ({ id }) => {
  const row = db.deleteRender(v.id(id));
  if (row) storage.deleteImage(storage.scopeForProject(row.project_id), row.filename);
});

/**
 * Whether a stored file is a render - the only thing that gets the "Generated
 * by GD Suits" badge. Answered from the renders table, so nothing the
 * interface sends can put that claim on a client's photograph.
 */
function isRenderMedia(scope, filename) {
  const m = /^project-(\d+)$/.exec(String(scope));
  return !!m && db.isRenderFile(Number(m[1]), filename);
}

/** A default file name the tailor can accept or change - never a path. */
const cleanFileName = (name) =>
  String(name ?? '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80);

/**
 * Saves a copy of any stored image wherever the tailor chooses, as often as
 * they like - nothing is moved or consumed, so a download can always be done
 * again.
 *
 * The interface names the image by the gdmedia:// address it is already
 * showing, never by a path. Where the bytes come from is resolved and confined
 * to the media folder here; where they go is chosen by the tailor in the save
 * dialog. So a hostile page gains nothing it could not already see, and cannot
 * write anywhere the tailor did not pick.
 *
 * Renders always leave with the badge. A stamping failure is an error rather
 * than a quiet fallback to the unbadged original.
 */
handle('media:download', async ({ url, name } = {}) => {
  url = v.str(url, 'image', 2048);
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Image not found.'); }
  if (parsed.protocol !== `${media.SCHEME}:` || parsed.host !== media.HOST) throw new Error('Image not found.');

  const { scope, filename } = media.parseMediaPath(parsed.pathname);
  let bytes;
  try { bytes = storage.readImage(scope, filename); } catch { throw new Error('Image not found.'); }

  const render = isRenderMedia(scope, filename);
  if (render) bytes = brand.stamp(bytes, brand.formatFor(filename));

  const ext = path.extname(filename).toLowerCase() || '.png';
  const base = cleanFileName(name) || (render ? 'gd-suits-render' : 'gd-suits-image');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: render ? 'Save render' : 'Save image',
    defaultPath: path.join(app.getPath('downloads'), base + ext),
    buttonLabel: 'Save',
    filters: [{ name: 'Image', extensions: [ext.slice(1)] }],
  });
  if (canceled || !filePath) return { saved: false };

  fs.writeFileSync(filePath, bytes);
  return { saved: true, name: path.basename(filePath), branded: render };
});

/**
 * Opens a quote summary as a draft in GD's own mail program.
 *
 * The figures come from the order rather than from anything the interface
 * sends, so what the client reads is what was agreed and frozen. The draft is
 * a summary, not the order form: the form is the document that gets signed,
 * and it is exported and attached deliberately.
 */
/**
 * Saves a document the interface has composed as one self-contained file.
 *
 * Pictures are pulled in here rather than linked, so what lands on the desktop
 * is a single file that survives being emailed. The interface names them by
 * the gdmedia:// address it is already showing; the bytes are read from the
 * media folder under the same confinement as everything else, and an address
 * that resolves to nothing is dropped rather than left as a broken picture.
 */
handle('forms:save', async ({ projectId, html, name }) => {
  projectId = v.id(projectId, 'projectId');
  html = v.str(html, 'form', 8 * 1024 * 1024);
  const project = db.getProject(projectId);
  if (!project) throw new Error('Order not found');

  const inlined = html.replace(/gdmedia:\/\/media\/([^\/"']+)\/([^"'?]+)/g, (whole, scope, file) => {
    try {
      const filename = decodeURIComponent(file);
      return `data:${storage.mimeForFile(filename)};base64,${storage.readAsBase64(scope, filename)}`;
    } catch {
      return '';   // a picture that is no longer there leaves no broken frame
    }
  });

  const safeName = cleanFileName(name) || 'measurement-form';
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save form',
    defaultPath: path.join(app.getPath('documents'), `${safeName}.html`),
    buttonLabel: 'Save',
    filters: [{ name: 'Web page', extensions: ['html'] }],
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, inlined, 'utf8');
  return { saved: true, name: path.basename(filePath) };
});

handle('business:get', () => shop());

handle('quote:template', () => ({
  template: db.getSetting('quoteEmailTemplate', mail.DEFAULT_TEMPLATE),
  subject: db.getSetting('quoteEmailSubject', mail.DEFAULT_SUBJECT),
  variables: mail.VARIABLES,
  defaults: { template: mail.DEFAULT_TEMPLATE, subject: mail.DEFAULT_SUBJECT },
}));

handle('quote:email', ({ projectId }) => {
  const project = db.getProject(v.id(projectId, 'projectId'));
  if (!project) throw new Error('Order not found');
  if (!project.email) throw new Error('This client has no email address on their file yet.');

  const values = mail.buildValues(project, shop());

  const template = db.getSetting('quoteEmailTemplate', mail.DEFAULT_TEMPLATE);
  const subjectTemplate = db.getSetting('quoteEmailSubject', mail.DEFAULT_SUBJECT);
  const body = mail.fill(template, values);
  const subject = mail.fill(subjectTemplate, values);

  const opened = security.openMailSafely({ to: project.email, subject, body });
  if (!opened) throw new Error('Could not open a mail draft - check the client has a valid email address.');
  return { opened: true, to: project.email };
});

/* connections - where data may go, and nowhere by default */

const connections = () => integrations.withDefaults(db.getSetting('integrations', null));
const hasSecret = (name) => !!secrets.describe(name)?.present;

/**
 * The configuration, with each service's own answer to whether it can run.
 *
 * The keys themselves never cross the bridge - only whether one is saved -
 * which is the same rule the API keys already follow.
 */
function connectionState() {
  const config = connections();
  return {
    config,
    methods: integrations.SEND_METHODS,
    secrets: Object.fromEntries(integrations.SECRET_NAMES.map((n) => [n, secrets.describe(n)])),
    status: Object.fromEntries(
      integrations.SERVICES.map((s) => [s, integrations.statusOf(s, config, hasSecret)])
    ),
  };
}

handle('connections:get', () => connectionState());

handle('connections:set', (patch) => {
  const next = integrations.withDefaults({ ...connections(), ...(patch ?? {}) });
  db.setSetting('integrations', next);
  return connectionState();
});

/**
 * What one service would do if asked right now.
 *
 * It reports rather than connects. Nothing here opens a socket: until GD has
 * supplied credentials there is nothing to connect to, and a button that
 * pretends to test and always says "fine" is worse than one that tells him
 * exactly which detail is still missing.
 */
handle('connections:test', ({ service }) => {
  const name = v.oneOf(service, integrations.SERVICES, 'service');
  return { service: name, ...integrations.statusOf(name, connections(), hasSecret) };
});

/* standing emails - written once, offered when they fall due, sent by hand */

handle('mail:rules', () => ({
  rules: db.listMailRules(),
  anchors: rules.ANCHORS,
  audiences: rules.AUDIENCES,
  variables: mail.VARIABLES,
  defaults: { subject: rules.DEFAULT_SUBJECT, body: rules.DEFAULT_BODY },
}));

handle('mail:saveRule', (rule) => {
  const clean = rules.normalise({
    name: rule.name, subject: rule.subject, body: rule.body,
    anchor: rule.anchor, offsetDays: rule.offsetDays,
    audience: rule.audience, enabled: rule.enabled,
  });
  const clientIds = (Array.isArray(rule.clientIds) ? rule.clientIds : [])
    .slice(0, 500)
    .map((id) => v.id(id, 'clientId'));
  return { id: db.saveMailRule({ id: v.optionalId(rule.id, 'id'), ...clean, clientIds }) };
});

handle('mail:deleteRule', ({ id }) => {
  db.deleteMailRule(v.id(id, 'id'));
  return { deleted: true };
});

/**
 * The reminders that have come due.
 *
 * Everything is worked out here rather than in the window: the window is not
 * trusted with which orders exist, and a date comparison is not something to
 * do twice in two places and hope they agree.
 */
handle('mail:due', ({ on } = {}) => {
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(on ?? '')) ? String(on) : new Date().toISOString().slice(0, 10);
  const out = [];
  for (const rule of db.listMailRules()) {
    if (!rule.enabled) continue;
    const spec = { ...rule, offsetDays: rule.offset_days };
    for (const project of db.mailCandidates(rule.id)) {
      if (!rules.covers(spec, project.client_id, rule.clientIds)) continue;
      const due = rules.dueOn(spec, project);
      // Due today or overdue. A reminder whose day has passed is still worth
      // offering - it was missed, and the client has not had it.
      if (!due || due > today) continue;
      out.push({
        ruleId: rule.id,
        ruleName: rule.name,
        projectId: project.id,
        orderRef: project.order_ref,
        client: `${project.name ?? ''} ${project.surname ?? ''}`.trim(),
        email: project.email,
        dueOn: due,
        overdue: due < today,
      });
    }
  }
  return { on: today, due: out.sort((a, b) => a.dueOn.localeCompare(b.dueOn)) };
});

/**
 * Opens the draft for one due reminder and records that it went.
 *
 * Recorded *after* the draft opens, so a failure to open leaves it due
 * rather than marking it sent and losing it. It is still only a record that
 * GD was handed the draft - this app never sends anything itself.
 */
handle('mail:send', ({ ruleId, projectId }) => {
  const id = v.id(ruleId, 'ruleId');
  const pid = v.id(projectId, 'projectId');
  const rule = db.listMailRules().find((r) => r.id === id);
  if (!rule) throw new Error('That email no longer exists.');
  const project = db.getProject(pid);
  if (!project) throw new Error('Order not found');
  if (!project.email) throw new Error('This client has no email address on their file yet.');

  const values = mail.buildValues(project, shop());
  const opened = security.openMailSafely({
    to: project.email,
    subject: mail.fill(rule.subject, values),
    body: mail.fill(rule.body, values),
  });
  if (!opened) throw new Error('Could not open a mail draft - check the client has a valid email address.');
  db.markMailSent(id, pid);
  return { opened: true, to: project.email };
});

/**
 * What one rule would say for a real order, so GD can read it back before it
 * goes to anybody.
 */
handle('mail:preview', ({ rule, projectId }) => {
  const clean = rules.normalise(rule ?? {});
  const project = projectId ? db.getProject(v.id(projectId, 'projectId')) : null;
  const values = project
    ? mail.buildValues(project, shop())
    : mail.buildValues({ name: 'Sipho', surname: 'Ndlovu', order_ref: 'GD-2026-0042', event_date: '2026-11-14', suits: [] }, shop());
  return {
    subject: mail.fill(clean.subject, values),
    body: mail.fill(clean.body, values),
    when: rules.describe(clean),
  };
});

/* export - the "client file" the brief asks the system to keep */
handle('project:export', async ({ projectId, html }) => {
  projectId = v.id(projectId, 'projectId');
  html = v.str(html, 'spec sheet', 4 * 1024 * 1024);
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
  for (const row of project.photos) {
    try {
      fs.copyFileSync(storage.resolveSafe(projectScope, row.filename), path.join(imagesDir, row.filename));
    } catch {
      /* a missing file must not abort the whole export */
    }
  }
  // Renders leave the app badged, like every other way out. Same filename,
  // same format, because the exported order form links to them by name.
  for (const row of project.renders) {
    try {
      const stamped = brand.stamp(storage.readImage(projectScope, row.filename), brand.formatFor(row.filename));
      fs.writeFileSync(path.join(imagesDir, row.filename), stamped);
    } catch {
      /* a missing or unreadable render must not abort the whole export */
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
  version: updater.currentVersion(),
  userData: app.getPath('userData'),
  platform: process.platform,
  online: true,
}));

handle('app:openDataFolder', () => shell.openPath(app.getPath('userData')));

/* updates - checked on demand, never applied silently */
const DEFAULT_FEED = 'https://api.github.com/repos/Yudhi69/gd-suits-studio/releases/latest';

/**
 * What the last check found, and what the last download left on disk.
 *
 * The renderer never says what to download. It asks for "the update", and the
 * address comes from the release this process fetched and checked itself, so
 * a hostile page - the one that got in through a client's name, or through
 * something the model said - has nothing to point the downloader at. Same for
 * revealing the file: the path is the one we wrote, not one that was asked
 * for.
 */
let lastRelease = null;
let downloading = null;
let lastDownload = null;

handle('updates:check', async () => {
  const feedUrl = db.getSetting('updateFeed', DEFAULT_FEED) || DEFAULT_FEED;
  const result = await updater.check({ feedUrl, token: secrets.get('updateToken') });
  lastRelease = { ...result, feedUrl };
  return result;
});

/**
 * Fetches the release file into the Downloads folder.
 *
 * A download, not an install: it is saved without an executable bit and shown
 * in the file manager. Nothing this app downloads is ever executed by this
 * app - opening it is the tailor's decision, made in the operating system's
 * own dialogs, where an unsigned app is named as one.
 */
handle('updates:fetch', async () => {
  if (!lastRelease) throw new Error('Check for updates first.');
  if (!lastRelease.updateAvailable) throw new Error('There is no newer version to download.');
  if (!lastRelease.canDownload) throw new Error('This release has no file this app will download. Open the release page instead.');
  if (downloading) throw new Error('That download is already running.');

  downloading = new AbortController();
  try {
    const saved = await updater.download({
      feedUrl: lastRelease.feedUrl,
      url: lastRelease.downloadUrl,
      name: lastRelease.downloadName,
      size: lastRelease.downloadSize,
      digest: lastRelease.downloadDigest,
      token: secrets.get('updateToken'),
      dir: app.getPath('downloads'),
      signal: downloading.signal,
      onProgress: (p) => {
        if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('updates:progress', p);
      },
    });
    lastDownload = saved.path;
    return { ...saved, version: lastRelease.version };
  } finally {
    downloading = null;
  }
});

handle('updates:cancel', () => {
  downloading?.abort();
  return { stopped: !!downloading };
});

handle('updates:reveal', () => {
  if (!lastDownload || !fs.existsSync(lastDownload)) throw new Error('That download is no longer on this machine.');
  shell.showItemInFolder(lastDownload);
  return { shown: true };
});

/**
 * Hands a release page to the browser. Still here beside the download: a
 * release with no file for this machine, or a tailor who would rather see the
 * page, both need it.
 */
handle('updates:download', ({ url }) => {
  const opened = security.openExternalSafely(v.str(url, 'download address', 800));
  if (!opened) throw new Error('That download address was refused - it must be an https link.');
  return { opened: true };
});

handle('updates:defaultFeed', () => DEFAULT_FEED);

/**
 * What the app can tell the user about how their data is held. Surfaced in
 * Settings so the position is visible rather than buried in a README.
 */
handle('app:security', () => ({
  userData: app.getPath('userData'),
  keyEncrypted: secrets.describe('gemini').encrypted,
  sandboxed: true,
  networkHosts: [
    ...security.ALLOWED_HOSTS,
    ...(() => {
      const config = getAiConfig();
      const hosts = [];
      if (config.image.provider === 'openai' || config.vision.provider === 'openai') hosts.push('api.openai.com');
      if (config.image.provider === 'anthropic' || config.vision.provider === 'anthropic') hosts.push('api.anthropic.com');
      if (config.customBaseUrl) { try { hosts.push(new URL(config.customBaseUrl).host); } catch { /* ignore */ } }
      return hosts;
    })(),
    (() => {
      try { return new URL(db.getSetting('updateFeed', DEFAULT_FEED) || DEFAULT_FEED).host; }
      catch { return null; }
    })(),
  ].filter(Boolean),
}));
