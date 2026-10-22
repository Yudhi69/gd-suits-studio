'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { app, BrowserWindow, protocol, ipcMain, dialog, shell, Menu, nativeTheme, clipboard } = require('electron');

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
const google = require('./google');
const sheetsMirror = require('./sheetsMirror');
const delivery = require('./mailDelivery');
const business = require('./business');
const informal = require('./informal');
const csv = require('./csv');

/** The shop's details as they are set today, never as they were compiled. */
const shop = () => business.withDefaults(db.getSetting('business', null));
const updater = require('./updater');
const installer = require('./installer');
const placement = require('./placement');
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
// Set once the database is open; until then there is nothing to settle or install.
let started = false;

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
  started = true;
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
  try {
    settleUpdate();
  } catch (err) {
    logLine(`could not settle the last update: ${err?.message ?? err}`);
  }

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

  // Changes made while the app was closed, or in the seconds before it last
  // quit, reach the spreadsheet now - and nothing is sent if it already has
  // them.
  sheetsSoon();
}

/**
 * Whether this copy should start at all, decided before it opens anything -
 * see placement.js. Only an installed copy is checked.
 *
 * A failure in the check itself is logged and the app starts: this guards
 * against opening an older copy by mistake, and an app that will not open
 * at all is the worse outcome.
 */
async function placeThisCopy() {
  if (!app.isPackaged) return 'run';
  try {
    return await placement.place({
      platform: process.platform,
      current: updater.currentVersion(),
      bundle: process.platform === 'darwin' ? placement.ownBundle(app.getPath('exe')) : null,
      compare: updater.compareVersions,
      dataDir: app.getPath('userData'),
      applications: '/Applications',
      homeApplications: path.join(os.homedir(), 'Applications'),
      ask: (options) => dialog.showMessageBox(options),
      open: placement.openWhenGone,
      move: (conflictHandler) => app.moveToApplicationsFolder({ conflictHandler }),
      openPage: () => security.openExternalSafely(RELEASES_PAGE),
      log: logLine,
    });
  } catch (err) {
    logLine(`placement check failed, starting anyway: ${err?.stack ?? err}`);
    return 'run';
  }
}

app.whenReady().then(async () => {
  const placed = await placeThisCopy();
  // Moved: Electron reopens it from Applications and quits this one itself.
  if (placed === 'moved') return;
  if (placed !== 'run') {
    app.exit(0);
    return;
  }
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

/**
 * Calls that an update must not restart the app in the middle of: a render
 * the client's credits have already paid for, a read, an email half sent.
 * Updating waits for every one of these to finish before it restarts.
 */
const UNINTERRUPTIBLE = new Set(['ai:render', 'ai:analyse', 'quote:email', 'informal:send', 'mail:send']);
let working = 0;
let idleWaiters = [];
const whenIdle = () => (working === 0 ? Promise.resolve() : new Promise((resolve) => idleWaiters.push(resolve)));

/**
 * How many rows the database has written, or null when it cannot be read -
 * which the call itself then reports, rather than this.
 */
function changesSoFar() {
  try {
    return db.changeCount();
  } catch {
    return null;
  }
}

/** Asks the spreadsheet copy to look again if a call wrote something. Never throws. */
function noticeChanges(before) {
  try {
    if (before !== null && db.changeCount() !== before) sheetsSoon();
  } catch {
    /* the next call that writes asks again */
  }
}

/**
 * Wraps a handler so a thrown error reaches the UI as a message, not a crash.
 *
 * A call that wrote to the database also tells the spreadsheet copy to look
 * again. It is asked of every call rather than a list of the ones that write,
 * so a handler added later cannot be forgotten; one whose change does not
 * reach the copy (a setting, a photograph) costs a comparison and no request.
 */
function handle(channel, fn) {
  const guarded = UNINTERRUPTIBLE.has(channel);
  ipcMain.handle(channel, async (_event, payload) => {
    if (guarded) working++;
    const before = changesSoFar();
    try {
      return { ok: true, data: await fn(payload ?? {}) };
    } catch (err) {
      return {
        ok: false,
        error: { message: err?.message ?? String(err), code: err?.code ?? null, retryable: !!err?.retryable },
      };
    } finally {
      noticeChanges(before);
      if (guarded && --working === 0) {
        const waiting = idleWaiters;
        idleWaiters = [];
        for (const resolve of waiting) resolve();
      }
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
handle('clients:patch', ({ id, patch = {} }) => {
  const clean = {};
  for (const key of ['name', 'surname', 'contact']) {
    if (patch[key] !== undefined) clean[key] = v.str(patch[key], key, 160).trim();
  }
  if (patch.email !== undefined) clean.email = v.str(patch.email, 'email', 200).trim();
  return db.patchClient(v.id(id), clean);
});
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
/**
 * Every field a page may change on an order. Anything else is refused by
 * name rather than dropped: "Measurements taken" and the review date were
 * left off this gate when their columns were added, and every click and date
 * was thrown away without a word - the switch simply sprang back.
 */
const PROJECT_FIELDS = new Set([
  'title', 'event_type', 'event_other', 'event_date', 'delivery_date',
  'consultation_date', 'measurement_date', 'first_fitting_date', 'final_fitting_date', 'review_date',
  'status', 'quantity', 'fabric_name', 'fabric_code', 'supplier',
  'first_appointment', 'appointment_notes', 'comments', 'lining', 'design', 'shirt', 'balance_note',
  'form_url', 'imported_balance', 'measurements_done', 'measurement_form_received', 'form_printed',
  'spec', 'analysis',
]);

handle('projects:update', ({ id, patch = {} }) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new v.ValidationError('An update needs a set of fields');
  const unknown = Object.keys(patch).find((key) => !PROJECT_FIELDS.has(key));
  if (unknown !== undefined) throw new v.ValidationError(`An order has no field "${String(unknown).slice(0, 40)}" to change`);
  const clean = {};
  if (patch.title !== undefined) clean.title = v.str(patch.title, 'title', 160);
  if (patch.event_type !== undefined) clean.event_type = v.str(patch.event_type, 'event type', 40);
  if (patch.event_other !== undefined) clean.event_other = v.str(patch.event_other, 'event detail', 200);
  if (patch.event_date !== undefined) clean.event_date = v.str(patch.event_date, 'event date', 40);
  if (patch.delivery_date !== undefined) clean.delivery_date = v.str(patch.delivery_date, 'delivery date', 40);
  for (const key of ['consultation_date', 'measurement_date', 'first_fitting_date', 'final_fitting_date', 'review_date']) {
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
  if (patch.measurements_done !== undefined) clean.measurements_done = patch.measurements_done ? 1 : 0;
  if (patch.measurement_form_received !== undefined) clean.measurement_form_received = patch.measurement_form_received ? 1 : 0;
  if (patch.form_printed !== undefined) clean.form_printed = patch.form_printed ? 1 : 0;
  if (patch.spec !== undefined) clean.spec = v.jsonBlob(patch.spec, 'spec');
  if (patch.analysis !== undefined) clean.analysis = v.jsonBlob(patch.analysis, 'analysis');
  // A moved date also rewrites the old one in the imported notes and is
  // written to the order's notes; see db.editProject.
  return db.editProject(v.id(id), clean);
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

  // Fixed from the figures on an informal quote, the price list's own total
  // at the time comes too - see agreedQuote.
  const listTotal = v.num(quote.listTotal, 'listTotal', { min: -1e9, max: 1e9 });
  return db.setQuote(projectId, {
    lines: quote.lines.map((line) => ({
      group: v.str(line.group, 'group', 120),
      label: v.str(line.label, 'label', 200),
      amount: v.num(line.amount, 'amount', { min: -1e7, max: 1e7 }) ?? 0,
      key: v.str(line.key, 'key', 160),
    })),
    total: v.num(quote.total, 'total', { min: -1e9, max: 1e9 }) ?? 0,
    currency: v.str(quote.currency, 'currency', 8),
    at: new Date().toISOString(),
    status: v.oneOf(quote.status ?? 'approved', v.PROJECT_STATUSES, 'status'),
    ...(listTotal === null ? {} : { listTotal, informalAt: v.str(quote.informalAt, 'informalAt', 40) }),
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

/**
 * The measurement changes an alteration carries. Each names a measurement by
 * its id and says by how much, in centimetres; the figures before and after
 * are read from the database, never taken from the window.
 */
function alterationChanges(raw, garment) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new v.ValidationError('changes must be a list');
  if (raw.length > 40) throw new v.ValidationError('That is too many changes for one alteration');
  const list = raw
    .map((c) => ({
      fieldId: v.str(c?.fieldId, 'measurement', 40),
      label: v.str(c?.label, 'measurement name', 80),
      change: v.num(c?.change, 'change', { min: -100, max: 100 }) ?? 0,
    }))
    .filter((c) => c.change !== 0);
  for (const c of list) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(c.fieldId)) throw new v.ValidationError('That is not a measurement');
  }
  if (list.length && !['jacket', 'waistcoat', 'pants'].includes(garment)) {
    throw new v.ValidationError('Only a jacket, waistcoat or trousers carry measurements to change');
  }
  return list;
}

handle('alterations:add', (r) => db.addAlteration({
  project_id: v.id(r.projectId, 'projectId'),
  suit_id: v.optionalId(r.suitId, 'suitId'),
  changes: alterationChanges(r.changes, r.garment ?? ''),
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
  'quoteEmailTemplate', 'quoteEmailSubject', 'business', 'labelOverrides'];
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
  if (name === 'labelOverrides') return db.setSetting(name, v.labelOverrides(value));
  return db.setSetting(name, v.jsonBlob(value, 'value', 128 * 1024));
});
const SECRET_NAMES = [...aiProviders.SECRET_NAMES, 'updateToken', ...integrations.SECRET_NAMES];

// The Google account token is written by connections:link alone, from what
// Google hands back. A page that could set it could send the spreadsheet copy
// to an account that is not GD's.
const PAGE_SECRETS = SECRET_NAMES.filter((n) => !integrations.MAIN_ONLY_SECRETS.includes(n));

/** Whether a secret is saved. A token only Google gives is not hinted at either. */
function describeSecret(name) {
  const said = secrets.describe(name);
  return integrations.MAIN_ONLY_SECRETS.includes(name) ? { ...said, hint: '' } : said;
}

handle('secrets:describe', ({ name }) => describeSecret(v.oneOf(name, SECRET_NAMES, 'secret')));
handle('secrets:set', ({ name, value }) => {
  const secret = v.oneOf(name, PAGE_SECRETS, 'secret');
  const next = v.str(value, 'key', 400).trim();
  // Different application details are a different application: the account
  // linked through the old ones is unlinked rather than used with the new.
  if (integrations.GOOGLE_CLIENT_SECRETS.includes(secret) && next !== (secrets.get(secret) ?? '')) {
    unlinkGoogle();
  }
  secrets.set(secret, next);
  return describeSecret(secret);
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

/**
 * A read - the measurement sanity check, the body read.
 *
 * The image slot repairs itself in Settings when its model goes; the read
 * slot never did, and its starting model was one Google has since retired.
 * So every read failed with "model not available" until someone happened to
 * open Settings and pick another - which is how the sanity check came to
 * "not work". Now a read whose model is refused picks a current one from the
 * key's own list, tries once more, and keeps it, so the next read goes
 * straight through.
 */
handle('ai:analyse', async ({ projectId, prompt, refs = [], schema, model }) => {
  const pid = v.id(projectId, 'projectId');
  const config = getAiConfig();
  const adapter = aiProviders.get(config.vision.provider, config.customBaseUrl);
  const images = loadRefImages(refs, storage.scopeForProject(pid));
  const apiKey = secrets.get(config.vision.provider);
  const ask = (name) => adapter.analyse({
    apiKey,
    model: name,
    prompt: v.str(prompt, 'prompt', 20000),
    images,
    schema: v.jsonBlob(schema, 'schema', 32 * 1024),
  });

  // A saved model of '' - cleared in Settings - means the provider's own.
  const chosen = model ? v.modelName(model) : config.vision.model || adapter.defaultVisionModel || undefined;
  try {
    return await ask(chosen);
  } catch (err) {
    // A model the caller named is theirs to fix; only the saved one is swapped.
    if (model || !['no_model', 'retired_model'].includes(err?.code)) throw err;
    let replacement = null;
    try {
      replacement = aiProviders.pickReadModel(await adapter.listModels(apiKey), chosen);
    } catch { /* the list could not be had; the original error says more */ }
    if (!replacement) throw err;
    const result = await ask(replacement);
    db.setSetting('aiConfig', {
      ...(db.getSetting('aiConfig', null) ?? {}),
      image: config.image,
      vision: { provider: config.vision.provider, model: replacement },
      customBaseUrl: config.customBaseUrl,
    });
    logLine(`[ai] read model ${chosen || '(none)'} refused (${err.code}); switched to ${replacement}`);
    return { ...result, model: replacement, switchedFrom: chosen ?? '' };
  }
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

/**
 * Everything about an email that is decided before it goes: who to, what it
 * says, which pictures ride with it, and which way it will leave.
 *
 * One function, called by the preview and by the send, so what GD confirms
 * is exactly what is sent. The recipient is the client on the order and the
 * pictures are that order's own renders - nothing here takes an address or a
 * file from the window.
 */
function composeEmail(project, { template, subjectTemplate, allowGmail = true }) {
  if (!project.email) throw new Error('This client has no email address on their file yet.');
  const values = mail.buildValues(project, shop());
  // The placeholder is the switch: no {renders} in the wording, nothing attached.
  const wantsRenders = /\{renders\}/.test(template);
  const built = wantsRenders
    ? delivery.buildAttachments(project, {
        readImage: storage.readImage,
        stamp: brand.stamp,
        scope: storage.scopeForProject(project.id),
      })
    : { attachments: [], total: 0, omitted: 0 };
  const gmail = integrations.statusOf('gmail', connections(), hasSecret);
  const via = allowGmail && gmail.ready ? 'gmail' : built.attachments.length ? 'draft-file' : 'mailto';
  return {
    to: project.email,
    subject: mail.fill(subjectTemplate, values),
    body: mail.fill(template, values),
    ...built,
    gmail,
    via,
  };
}

function quoteTemplates() {
  return {
    template: db.getSetting('quoteEmailTemplate', mail.DEFAULT_TEMPLATE),
    subjectTemplate: db.getSetting('quoteEmailSubject', mail.DEFAULT_SUBJECT),
  };
}

async function sendComposed(project, composed, { allowGmail = true, draftName }) {
  const config = connections();
  return delivery.deliver({
    to: composed.to,
    from: shop().email,
    subject: composed.subject,
    body: composed.body,
    attachments: composed.attachments,
    gmail: composed.gmail,
    allowGmail,
    gmailAddress: config.gmail.address,
    gmailPassword: allowGmail && composed.gmail.ready ? secrets.get('gmailAppPassword') : null,
    draftDir: path.join(app.getPath('userData'), 'drafts'),
    draftName,
    openPath: (file) => shell.openPath(file),
    openMail: security.openMailSafely,
  });
}

/** What the quote email would be, for GD to read before anything is sent. */
handle('quote:preview', ({ projectId }) => {
  const project = db.getProject(v.id(projectId, 'projectId'));
  if (!project) throw new Error('Order not found');
  const c = composeEmail(project, quoteTemplates());
  return {
    to: c.to, subject: c.subject, body: c.body, via: c.via,
    from: c.via === 'gmail' ? connections().gmail.address : null,
    attachments: c.attachments.map((a) => ({ name: a.filename, bytes: a.content.length })),
    totalBytes: c.total,
    omitted: c.omitted,
  };
});

handle('quote:email', async ({ projectId }) => {
  const project = db.getProject(v.id(projectId, 'projectId'));
  if (!project) throw new Error('Order not found');
  const composed = composeEmail(project, quoteTemplates());
  const result = await sendComposed(project, composed, {
    draftName: `Quote ${project.order_ref || project.id}`,
  });
  return { opened: result.via !== 'gmail', sent: result.via === 'gmail', ...result };
});

/* the database - GD's workbook, as one editable view over the orders */

handle('database:sheet', () => db.sheet());

/**
 * Writes one tab of the database page to a CSV file Excel opens.
 *
 * The rows are assembled in the window, because that is where the design
 * summaries and quoted totals are worked out from the catalogue; here they
 * are bounded and written where GD chooses. Nothing is written without the
 * save dialog, and cancelling writes nothing.
 */
handle('database:export', async ({ name, rows }) => {
  if (!Array.isArray(rows) || !rows.length) throw new v.ValidationError('There is nothing to export');
  if (rows.length > 50000) throw new v.ValidationError('That is too many rows to export at once');
  const clean = rows.map((row) => {
    if (!Array.isArray(row) || row.length > 60) throw new v.ValidationError('A row of the export is not a list of cells');
    return row.map((c) => (typeof c === 'number' ? c : v.str(c === null || c === undefined ? '' : String(c), 'cell', 20000)));
  });
  const fileName = cleanFileName(name) || 'gd-suits-database';
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export to a spreadsheet',
    defaultPath: path.join(app.getPath('documents'), `${fileName}.csv`),
    buttonLabel: 'Export',
    filters: [{ name: 'Spreadsheet (CSV)', extensions: ['csv'] }],
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, csv.toCsv(clean), 'utf8');
  return { saved: true, name: path.basename(filePath), rows: clean.length - 1 };
});

/* the informal quote - the summary sent before anything is agreed */

const informalOf = (project) => project.informalQuote ?? null;

function orderFor(projectId) {
  const project = db.getProject(v.id(projectId, 'projectId'));
  if (!project) throw new Error('Order not found');
  return project;
}

/**
 * Everything GD needs to see before it goes: who it is to, which way the
 * email would leave, and which pictures would ride with it - named, not
 * read, so opening the window costs nothing.
 */
handle('informal:preview', ({ projectId }) => {
  const project = orderFor(projectId);
  const who = informal.recipientOf(project);
  const gmail = integrations.statusOf('gmail', connections(), hasSecret);
  const pictures = delivery.plannedAttachments(project);
  return {
    ...who,
    whatsapp: informal.whatsappNumber(who.phone, shop().whatsappCountryCode),
    emailVia: gmail.ready ? 'gmail' : 'draft',
    from: gmail.ready ? connections().gmail.address : null,
    pictures: pictures.map(({ filename, render }) => ({ name: filename, file: render.filename, view: render.view })),
    rendersLine: delivery.rendersLine(project),
  };
});

/** Kept on the order: when, how, to whom, and the figures it went with. */
function recordSent(project, { via, to, sent, pictures = 0 }) {
  db.setInformalQuote(project.id, informal.record(informalOf(project), {
    status: 'sent',
    via,
    sentAt: new Date().toISOString(),
    answeredAt: '',
    total: sent.total,
    to,
    lines: sent.lines,
    basis: sent.basis,
    pictures,
  }));
}

/**
 * Sends it. The words and the figures come from the window, which is where
 * the prices are; the recipient and the pictures come from the order on
 * file, so a window cannot send an order's details to a number or an address
 * that is not on it, nor attach anything but that order's own renders.
 */
handle('informal:send', async ({ projectId, via, text, subject, lines, basis, pictures }) => {
  const project = orderFor(projectId);
  const channel = v.oneOf(via, ['whatsapp', 'email'], 'how to send');
  // Long enough for a wedding party's figures and every suit's choices.
  const body = v.str(text, 'message', 32000).trim();
  if (!body) throw new v.ValidationError('There is nothing to send yet.');
  const sent = informal.figures(lines, basis);
  const who = informal.recipientOf(project);

  let result;
  if (channel === 'whatsapp') {
    // No usable number on file still works: WhatsApp opens and asks who to
    // send it to, with the message already written.
    const number = informal.whatsappNumber(who.phone, shop().whatsappCountryCode);
    // A message too long to travel in a link goes on the clipboard instead,
    // and WhatsApp opens on the chat for it to be pasted.
    const url = informal.whatsappUrl(number, body);
    const copied = url.length > informal.WHATSAPP_URL_MAX;
    if (copied) clipboard.writeText(body);
    if (!security.openExternalSafely(copied ? informal.whatsappUrl(number, '') : url)) throw new Error('Could not open WhatsApp.');
    result = { via: 'whatsapp', to: number ? `+${number}` : '', opened: true, attached: 0, copied };
  } else {
    if (!who.email) {
      throw new Error(who.guardian
        ? 'The parent or provider has no email address on file yet.'
        : 'This client has no email address on their file yet.');
    }
    // Only ever this order's own renders, badged as every render that leaves
    // the app is, and only when GD left them ticked.
    const built = pictures === true
      ? delivery.buildAttachments(project, {
          readImage: storage.readImage,
          stamp: brand.stamp,
          scope: storage.scopeForProject(project.id),
        })
      : { attachments: [], total: 0, omitted: 0 };
    const delivered = await sendComposed(project, {
      to: who.email,
      subject: v.str(subject, 'subject', 300).trim() || 'Your informal quote',
      body,
      attachments: built.attachments,
      gmail: integrations.statusOf('gmail', connections(), hasSecret),
    }, { draftName: `Informal quote ${project.order_ref || project.id}` });
    result = {
      via: 'email',
      to: who.email,
      sent: delivered.via === 'gmail',
      opened: delivered.via !== 'gmail',
      attached: built.attachments.length,
      omitted: built.omitted,
    };
  }

  recordSent(project, { via: result.via, to: result.to, sent, pictures: result.attached });
  return { ...result, total: sent.total };
});

/** Onto the clipboard, for pasting wherever GD likes - recorded as sent that way. */
handle('informal:copy', ({ projectId, text, lines, basis }) => {
  const project = orderFor(projectId);
  const sent = informal.figures(lines, basis);
  clipboard.writeText(v.str(text, 'message', 32000));
  recordSent(project, { via: 'copied', to: '', sent });
  return { copied: true, total: sent.total };
});

/** What the client said. */
handle('informal:mark', ({ projectId, status }) => {
  const project = orderFor(projectId);
  const answer = v.oneOf(status, informal.STATUSES, 'answer');
  if (!informalOf(project)) throw new Error('No informal quote has been sent for this order yet.');
  db.setInformalQuote(project.id, informal.record(informalOf(project), {
    status: answer,
    answeredAt: answer === 'sent' ? '' : new Date().toISOString(),
  }));
  return db.getProject(project.id).informalQuote;
});

/* connections - where data may go, and nowhere by default */

/**
 * The configuration as stored, with the spreadsheet the app made.
 *
 * That id is kept in a setting of its own, which only this process writes
 * (it is not one of SETTING_KEYS). An id in `integrations` was pasted by hand
 * in an earlier version: a spreadsheet the app did not make, which the
 * `drive.file` permission cannot reach, so it is not used.
 */
const connections = () => {
  const config = integrations.withDefaults(db.getSetting('integrations', null));
  const made = integrations.idFrom(db.getSetting('sheetsSpreadsheet', ''), 'spreadsheet');
  return { ...config, sheets: { ...config.sheets, spreadsheetId: made } };
};
const hasSecret = (name) => !!secrets.describe(name)?.present;

/**
 * The configuration, with each service's own answer to whether it can run.
 *
 * The keys themselves never cross the bridge - only whether one is saved -
 * which is the same rule the API keys already follow.
 */
function connectionState() {
  const config = connections();
  const written = db.getSetting('sheetsStatus', null);
  return {
    config,
    methods: integrations.SEND_METHODS,
    secrets: Object.fromEntries(integrations.SECRET_NAMES.map((n) => [n, describeSecret(n)])),
    status: Object.fromEntries(
      integrations.SERVICES.map((s) => [s, integrations.statusOf(s, config, hasSecret)])
    ),
    linking: !!linking,
    // The last write to the spreadsheet, as GD needs to read it - not the
    // fingerprint it is compared by.
    sheets: written && written.spreadsheetId === config.sheets.spreadsheetId
      ? { at: written.at, ok: !!written.ok, error: written.error ?? '', code: written.code ?? null, rows: written.rows ?? null }
      : null,
  };
}

handle('connections:get', () => connectionState());

handle('connections:set', (patch) => {
  const next = integrations.withDefaults({ ...connections(), ...(patch && typeof patch === 'object' ? patch : {}) });
  // The spreadsheet is the one the app made (see connections). Whatever a
  // page names is not stored, so the copy cannot be sent to a spreadsheet
  // someone else owns.
  db.setSetting('integrations', { ...next, sheets: { ...next.sheets, spreadsheetId: '' } });
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

/* the Google spreadsheet - a copy of the database GD can open anywhere */

const SHEET_TITLE = 'GD Suits database';

// How long after a change the copy is written, so a run of edits is one
// write. Tests shorten it; a packaged copy ignores the variable.
const SHEETS_DELAY_MS = (() => {
  const asked = app.isPackaged ? NaN : Number(process.env.GD_TEST_SHEETS_DELAY_MS);
  return Number.isFinite(asked) && asked >= 0 ? Math.min(asked, 60_000) : 8_000;
})();

let googleAccess = null;   // { accessToken, expiresAt } - an hour's access, never written down
let refreshing = null;     // the one token refresh in flight
let linking = null;        // the one link waiting on the browser
let sheetsTimer = null;
let sheetsRun = null;      // the one write in flight
let sheetsAgain = false;

const googleClient = () => ({
  clientId: secrets.get('googleClientId') ?? '',
  clientSecret: secrets.get('googleClientSecret') ?? '',
});

/**
 * Forgets the linked account here, and asks Google to as well when sending
 * is switched on (when it is off, nothing goes to Google, this included).
 */
function unlinkGoogle() {
  const token = secrets.get('googleRefreshToken');
  secrets.set('googleRefreshToken', '');
  googleAccess = null;
  if (token && connections().consent) void google.revoke(token);
}

/** An access token, refreshed when it is about to run out or Google turned it down. */
function googleToken(fresh = false) {
  if (!fresh && googleAccess && googleAccess.expiresAt - 60_000 > Date.now()) {
    return Promise.resolve(googleAccess.accessToken);
  }
  if (!refreshing) {
    const refreshToken = secrets.get('googleRefreshToken');
    refreshing = (async () => {
      if (!refreshToken) throw google.failure('Google account not linked yet.', 'unlinked');
      try {
        googleAccess = await google.refresh({ ...googleClient(), refreshToken });
        return googleAccess.accessToken;
      } catch (err) {
        // Google has let the link go (revoked, expired, password changed):
        // say so here too, unless GD has linked again in the meantime.
        if (err.code === 'unlinked' && secrets.get('googleRefreshToken') === refreshToken) unlinkGoogle();
        throw err;
      }
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

/** One Sheets API call, refused outright once sending is switched off. */
async function sheetsCall(method, path, body) {
  if (!connections().consent) {
    throw google.failure('Sending anything off this machine is switched off.', 'consent');
  }
  return google.sheets(googleToken, method, path, body);
}

const sheetsAuto = () => {
  const config = connections();
  return config.sheets.when === 'onSave' && integrations.statusOf('sheets', config, hasSecret).ready;
};

/**
 * Writes the copy a few seconds after a change. The first change starts the
 * wait and the rest join it, so a run of edits is one write, and steady
 * editing still reaches the spreadsheet every few seconds.
 */
function sheetsSoon() {
  if (sheetsTimer || !sheetsAuto()) return;
  sheetsTimer = setTimeout(() => {
    sheetsTimer = null;
    if (sheetsAuto()) writeSheets(false).catch(() => { /* recorded in sheetsStatus */ });
  }, SHEETS_DELAY_MS);
  sheetsTimer.unref?.();
}

function recordSheets(entry) {
  const stamped = { at: new Date().toISOString(), ...entry };
  db.setSetting('sheetsStatus', stamped);
  return stamped;
}

/**
 * Writes the copy if it is ready to go. Unless `force`d (GD pressing "Write
 * now"), a copy identical to the last one written is not sent again. One
 * write at a time: a change during one is written after it.
 */
function writeSheets(force) {
  if (sheetsRun) {
    sheetsAgain = true;
    return sheetsRun;
  }
  sheetsRun = (async () => {
    const config = connections();
    const status = integrations.statusOf('sheets', config, hasSecret);
    if (!status.ready) throw new Error(status.why);
    const { spreadsheetId } = config.sheets;
    const data = db.mirror();
    const fingerprint = crypto.createHash('sha256')
      .update(JSON.stringify(sheetsMirror.grids(data))).digest('hex');
    const last = db.getSetting('sheetsStatus', null);
    if (!force && last?.ok && last.spreadsheetId === spreadsheetId && last.fingerprint === fingerprint) return last;
    try {
      const rows = await sheetsMirror.push(sheetsCall, spreadsheetId, data);
      return recordSheets({ ok: true, spreadsheetId, fingerprint, rows });
    } catch (err) {
      logLine(`spreadsheet not written: ${err?.code ?? 'error'}`);
      recordSheets({ ok: false, spreadsheetId, error: err?.message ?? String(err), code: err?.code ?? null });
      throw err;
    }
  })().finally(() => {
    sheetsRun = null;
    if (sheetsAgain) {
      sheetsAgain = false;
      sheetsSoon();
    }
  });
  return sheetsRun;
}

/**
 * Links GD's Google account: the browser opens Google's own page, and the
 * token comes back to this process alone (see google.js).
 */
handle('connections:link', async () => {
  if (!connections().consent) throw new Error('Switch on sending data off this machine first.');
  if (linking) throw new Error('Already waiting for Google in the browser.');
  const client = googleClient();
  linking = google.link({ ...client, open: (url) => security.openExternalSafely(url) });
  try {
    const got = await linking;
    // Application details changed while the browser was open: this token
    // belongs to the old ones, so it is not kept.
    const now = googleClient();
    if (now.clientId !== client.clientId || now.clientSecret !== client.clientSecret) {
      void google.revoke(got.refreshToken);
      throw new Error('The Google application details changed while linking. Link again.');
    }
    secrets.set('googleRefreshToken', got.refreshToken);
    googleAccess = { accessToken: got.accessToken, expiresAt: got.expiresAt };
  } finally {
    linking = null;
  }
  return connectionState();
});

handle('connections:unlink', () => {
  unlinkGoogle();
  return connectionState();
});

/**
 * Makes the blank spreadsheet in GD's Google account and fills it. The id
 * Google gives back is the only one the copy is ever written to.
 */
handle('sheets:create', async () => {
  const config = connections();
  // Only when there is none yet, or the one there was is gone from Google -
  // what the page offers, held here too, so a page cannot fill GD's Drive
  // with spreadsheets or leave the real one behind.
  const current = config.sheets.spreadsheetId;
  const last = db.getSetting('sheetsStatus', null);
  if (current && !(last?.spreadsheetId === current && last.code === 'missing')) {
    throw new Error('The spreadsheet is already made. Open it, or press Write now.');
  }
  const status = integrations.statusOf('sheets', { ...config, sheets: { ...config.sheets, spreadsheetId: '' } }, hasSecret);
  if (status.needs !== 'spreadsheet') throw new Error(status.why);
  const made = await sheetsCall('POST', '', sheetsMirror.createBody(SHEET_TITLE));
  const spreadsheetId = integrations.idFrom(made?.spreadsheetId, 'spreadsheet');
  if (!spreadsheetId) throw new Error('Google did not say which spreadsheet it made.');
  db.setSetting('sheetsSpreadsheet', spreadsheetId);
  try {
    await writeSheets(true);
  } catch {
    // Made but not filled: the status line says why, and Write now retries.
  }
  return connectionState();
});

handle('sheets:write', async () => {
  await writeSheets(true);
  return connectionState();
});

handle('sheets:open', () => {
  const { spreadsheetId } = connections().sheets;
  if (!spreadsheetId) throw new Error('No spreadsheet made yet.');
  if (!security.openExternalSafely(sheetsMirror.urlFor(spreadsheetId))) throw new Error('The browser could not be opened.');
  return true;
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
      // Sent already, for the date the order still has. Sent for a date that
      // has since moved, it is a reminder about a different day and is due.
      const sent = project.sent_for !== null && project.sent_for !== undefined;
      if (sent && project.sent_for === rules.anchorDate(spec, project)) continue;
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
        ...(sent ? { sentBefore: { for: project.sent_for, at: project.sent_at } } : {}),
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
handle('mail:send', async ({ ruleId, projectId }) => {
  const id = v.id(ruleId, 'ruleId');
  const pid = v.id(projectId, 'projectId');
  const rule = db.listMailRules().find((r) => r.id === id);
  if (!rule) throw new Error('That email no longer exists.');
  const project = db.getProject(pid);
  if (!project) throw new Error('Order not found');
  const sentFor = rules.anchorDate(rule, project);
  // A standing email is always a draft, Gmail or not: it was built on the rule
  // that a timer decides what is due and a person sends it. It can still
  // carry the renders, the same way a quote does.
  const composed = composeEmail(project, { template: rule.body, subjectTemplate: rule.subject, allowGmail: false });
  const result = await sendComposed(project, composed, {
    allowGmail: false,
    draftName: `${rule.name} - ${project.order_ref || project.id}`,
  });
  // The date the draft was written for, read before it opened: if the date
  // moved meanwhile, the reminder for the new one is still owed.
  db.markMailSent(id, pid, sentFor);
  return { opened: true, ...result };
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

/* updates - checked on launch and on demand, installed when the tailor says so */
const DEFAULT_FEED = installer.OFFICIAL_FEED;
const RELEASES_PAGE = 'https://github.com/Yudhi69/gd-suits-studio/releases/latest';

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

async function checkForUpdates() {
  const feedUrl = db.getSetting('updateFeed', DEFAULT_FEED) || DEFAULT_FEED;
  const result = await updater.check({ feedUrl, token: secrets.get('updateToken') });
  // A newer version whose installer is already in the Downloads folder is
  // reported as downloaded, so the page shows the file rather than offering
  // it again. The copy that is running stays the old one until the tailor
  // installs the new, so "available" alone would offer it on every check.
  const saved = result.updateAvailable ? alreadySaved(result) : null;
  if (saved) lastDownload = saved.path;
  lastRelease = { ...result, feedUrl };
  // Recorded only when the check got an answer. An install opened for the
  // first time with no signal has not yet found out whether it is current,
  // so it has not had its first check - and gets one next time it opens.
  db.setSetting('updatesLastChecked', result.checkedAt);
  const blocked = result.updateAvailable ? installBlocked(lastRelease) : null;
  return {
    ...result,
    downloaded: saved ? { ...saved, already: true } : null,
    // Whether this release can put itself in place, and if not, why not -
    // the page shows the download instead, with the reason.
    canInstall: result.updateAvailable && !blocked,
    installBlocked: blocked,
    ready: result.updateAvailable && !blocked && stagedUpdate()?.version === result.version,
  };
}

handle('updates:check', () => checkForUpdates());

/**
 * The check an installed copy makes as it opens - on unless the tailor has
 * turned it off in Settings.
 *
 * The prompt comes up once for each new version, the first launch that finds
 * it; after that the flag in the corner says it is there. Which version was
 * last put in front of him is kept where only this process writes, so a page
 * cannot make the prompt come back or keep it away.
 *
 * Only in an installed copy. A development build - and every test suite,
 * which each starts from an empty folder - would otherwise go out to GitHub
 * on launch and put a prompt over whatever it was about to test; there, it
 * looks only if the setting has been turned on, and never prompts.
 * GD_TEST_FIRST_RUN lets the suites that test this run as an installed copy.
 */
handle('updates:launchCheck', async () => {
  const installed = app.isPackaged || process.env.GD_TEST_FIRST_RUN === '1';
  const setting = db.getSetting('autoCheckUpdates', null);
  // A copy that has never once heard back from the feed looks whatever the
  // setting says, as it always has, so a package sent out a few versions ago
  // brings itself up to date on its first launch with a connection.
  const firstRun = installed && !db.getSetting('updatesLastChecked', null);
  if (!(installed ? firstRun || setting !== false : setting === true)) return { checked: false };

  const result = await checkForUpdates();
  const prompt = installed && result.updateAvailable && db.getSetting('updatePrompted', null) !== result.version;
  if (prompt) db.setSetting('updatePrompted', result.version);
  return { ...result, checked: true, prompt };
});

/**
 * The installer already saved for this release, if it is still there.
 *
 * Kept in a setting that only this process writes - it is not one of
 * SETTING_KEYS, so a page can neither read the path nor plant one - and
 * believed only as far as the disk agrees with it (see savedDownload).
 */
function alreadySaved(release) {
  return updater.savedDownload(db.getSetting('updateDownload', null), release, app.getPath('downloads'));
}

/**
 * Fetches the release file into the Downloads folder.
 *
 * The fallback for a release that cannot install itself (see installBlocked):
 * saved without an executable bit and shown in the file manager. This app
 * never opens a file it saved here - installing it is the tailor's decision,
 * made in the operating system's own dialogs.
 */
handle('updates:fetch', async () => {
  if (!lastRelease) throw new Error('Check for updates first.');
  if (!lastRelease.updateAvailable) throw new Error('There is no newer version to download.');
  if (!lastRelease.canDownload) throw new Error('This release has no file this app will download. Open the release page instead.');
  if (downloading) throw new Error('That download is already running.');

  // Asked for again, the same release is the file already saved - never a
  // second copy of it beside the first.
  const existing = alreadySaved(lastRelease);
  if (existing) {
    lastDownload = existing.path;
    return { ...existing, already: true };
  }

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
    db.setSetting('updateDownload', {
      version: lastRelease.version,
      asset: lastRelease.downloadName,
      path: saved.path,
      bytes: saved.bytes,
      sha256: saved.sha256,
      verified: saved.verified,
    });
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
 * Installing in place.
 *
 * One press does all of it. `updates:install` downloads the release into the
 * app's own data folder - not Downloads, there is nothing there for the
 * tailor to do - and makes it ready: on a Mac the app is unpacked from the
 * disk image and checked; on Windows the installer is kept as downloaded.
 * Then it hands it over, quits, and the new version opens in its place.
 * It used to stop at "ready" and wait for a second press of Restart now,
 * which read as the update not having happened.
 *
 * A render or an email still under way is waited for first. If he quits
 * while it waits, the update goes in then.
 *
 * As with the download, the page only ever asks for "the update". The file,
 * where it comes from and where it goes are decided here, from the release
 * this process checked itself, and installer.js refuses anything that is not
 * one of this app's own releases.
 */
const updatesDir = () => path.join(app.getPath('userData'), 'updates');
const installLog = () => path.join(updatesDir(), 'install.log');
const installResult = () => path.join(updatesDir(), 'install.result');
let handedOver = false;

/** Where this copy is installed, or why it cannot be replaced. */
function thisInstall() {
  return installer.installTarget({
    platform: process.platform,
    packaged: app.isPackaged,
    exePath: app.getPath('exe'),
    // Lets the install suite point the swap at a folder of its own. Never
    // read in an installed copy.
    testTarget: app.isPackaged ? null : process.env.GD_TEST_INSTALL_TARGET || null,
  });
}

/**
 * The certificate an update has to be signed with. Lets the install suite use
 * one of its own; never read in an installed copy.
 */
const updateSigner = () => (app.isPackaged ? null : process.env.GD_TEST_SIGNER) || installer.SIGNER;

/** Why `release` cannot install itself here, or null when it can. */
function installBlocked(release) {
  const notOfficial = installer.officialRelease(release);
  if (notOfficial) return notOfficial;
  const { reason } = thisInstall();
  if (reason) return reason;
  const failed = db.getSetting('updateFailed', null);
  if (failed?.version === release.version) {
    return `Version ${release.version} could not be put in place automatically last time, so it is ` +
      'downloaded for you to install by hand.';
  }
  return null;
}

/**
 * The update made ready earlier, if it is still there, still newer than this
 * copy, and still where this process put it. Kept in a setting only main
 * writes - not one of SETTING_KEYS - so a page can neither read the path nor
 * plant one; and the path is checked against the folder anyway.
 */
function stagedUpdate() {
  const record = db.getSetting('updateStaged', null);
  if (!record || typeof record !== 'object' || record.platform !== process.platform) return null;
  if (updater.compareVersions(record.version, updater.currentVersion()) <= 0) return null;
  const file = String(record.path ?? '');
  const inside = path.resolve(file).startsWith(path.resolve(updatesDir()) + path.sep);
  if (!path.isAbsolute(file) || !inside || !fs.existsSync(file)) return null;
  return record;
}

/** Downloads `release`, checks it, and makes it ready to go in. */
async function makeReady(release, progress) {
  const dir = path.join(updatesDir(), release.version);
  // Whatever an earlier version left here is of no use now.
  fs.rmSync(updatesDir(), { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  downloading = new AbortController();
  try {
    const saved = await updater.download({
      feedUrl: release.feedUrl,
      url: release.downloadUrl,
      name: release.downloadName,
      size: release.downloadSize,
      digest: release.downloadDigest,
      token: secrets.get('updateToken'),
      dir,
      signal: downloading.signal,
      onProgress: progress,
    });
    // The download is checked against the release's fingerprint by
    // updater.download; installBlocked has already insisted there is one.
    let ready = saved.path;
    if (process.platform === 'darwin') {
      progress({ phase: 'preparing', bytes: saved.bytes, total: saved.bytes, name: saved.name });
      ready = await installer.stageMac({ dmg: saved.path, version: release.version, dir, signer: updateSigner() });
      fs.rmSync(saved.path, { force: true });
    }
    db.setSetting('updateStaged', {
      version: release.version,
      platform: process.platform,
      path: ready,
      sha256: saved.sha256,
    });
    return stagedUpdate();
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    logLine(`update ${release.version} not made ready: ${err?.code ?? ''} ${err?.detail ?? err?.message ?? err}`);
    throw err;
  } finally {
    downloading = null;
  }
}

let updating = false;
handle('updates:install', async () => {
  if (!lastRelease) throw new Error('Check for updates first.');
  if (!lastRelease.updateAvailable) throw new Error('There is no newer version to install.');
  const blocked = installBlocked(lastRelease);
  if (blocked) throw new Error(blocked);
  if (updating || downloading) throw new Error('The update is already under way.');

  const release = lastRelease;
  const progress = (p) => {
    if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('updates:progress', p);
  };
  updating = true;
  try {
    // Made ready earlier - by a version of the app that stopped there, or a
    // restart that could not happen - it is not downloaded a second time.
    if (stagedUpdate()?.version !== release.version) await makeReady(release, progress);
    if (working > 0) {
      progress({ phase: 'waiting' });
      await whenIdle();
    }
    // He quit while it waited, and quitting has put it in already.
    if (handedOver) return { version: release.version, restarting: true };
    const staged = stagedUpdate();
    if (staged?.version !== release.version) throw new Error('The update is no longer ready. Check for updates again.');
    progress({ phase: 'restarting' });
    handOver(staged, true);
    setImmediate(() => app.quit());
    return { version: release.version, restarting: true };
  } finally {
    updating = false;
  }
});

/**
 * Hands the ready update over and returns; the caller quits. Throws, and
 * hands nothing over, if it is no longer exactly what was checked.
 */
function handOver(staged, relaunch) {
  const { target, reason } = thisInstall();
  if (reason) throw new Error(reason);
  installer.apply({
    platform: process.platform,
    staged: staged.path,
    target,
    version: staged.version,
    sha256: staged.sha256,
    pid: process.pid,
    relaunch,
    log: installLog(),
    result: installResult(),
    signer: updateSigner(),
  });
  handedOver = true;
  db.setSetting('updateStaged', { ...staged, applying: Date.now() });
}

// An update made ready and not yet put in place goes in as the app quits - one
// that was waiting for a render to finish, or that could not restart the app.
// A failure here must not stop the app quitting.
app.on('will-quit', () => {
  if (handedOver || !started) return;
  try {
    const staged = stagedUpdate();
    if (staged) handOver(staged, false);
  } catch (err) {
    logLine(`update not installed on quit: ${err?.message ?? err}`);
  }
});

/**
 * What became of the update this copy handed over before it last quit, said
 * once, as the window opens: the new version is running, or it could not be
 * put in place and this is still the old one. Without it a failed swap looked
 * exactly like no update at all.
 */
let settled = null;
handle('updates:settled', () => {
  const out = settled;
  settled = null;
  return out;
});

/**
 * On launch: did the last update go in? Installed, its leftovers are cleared.
 * Failed, the same version is offered as a download from then on, rather
 * than the app trying - and failing - on every quit.
 */
function settleUpdate() {
  const record = db.getSetting('updateStaged', null);
  let result = null;
  try { result = fs.readFileSync(installResult(), 'utf8').trim(); } catch { /* not handed over */ }
  const outcome = installer.settle({
    record, current: updater.currentVersion(), result, compare: updater.compareVersions,
  });
  if (outcome === 'installed' || outcome === 'failed') {
    settled = { outcome, version: record.version, current: updater.currentVersion() };
    if (outcome === 'failed') {
      db.setSetting('updateFailed', { version: record.version, at: new Date().toISOString(), detail: result ?? '' });
    }
    db.setSetting('updateStaged', null);
    fs.rmSync(updatesDir(), { recursive: true, force: true });
    logLine(`update ${record.version}: ${outcome}${result ? ` (${result})` : ''}`);
  }
}

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
    // Only once it can actually be used - listing it before then would
    // overstate what leaves the machine, and leaving it off after would
    // understate it.
    integrations.statusOf('gmail', connections(), hasSecret).ready ? 'smtp.gmail.com' : null,
    ...(() => {
      const sheets = integrations.statusOf('sheets', connections(), hasSecret);
      return sheets.ready || sheets.needs === 'spreadsheet' ? google.HOSTS : [];
    })(),
  ].filter(Boolean),
}));
