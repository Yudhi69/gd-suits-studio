/**
 * The quote email, with the client's renders attached.
 *
 * Three ways out, and the checks are mostly about which one is taken: through
 * Gmail only when GD has connected it and let data leave the machine; as a
 * draft file with the pictures in it otherwise; and as the plain draft it
 * always was when there is nothing to attach. Nothing here touches the network
 * or opens a window - the transport and the file opener are both recorded.
 */
const { app, BrowserWindow, nativeImage, shell } = require('electron');
const fs = require('fs');
require('./fresh.js').freshUserData(app);

// Opening a draft hands a file or a mailto: to the operating system. Recorded
// instead, so a test run leaves nothing open on anybody's desktop.
const opened = [];
shell.openPath = async (file) => { opened.push({ kind: 'file', file: String(file) }); return ''; };
shell.openExternal = async (url) => { opened.push({ kind: 'url', url: String(url) }); return true; };

// Gmail is never actually reached. The transport the app asks for is recorded,
// and handed back as one that builds the message into memory instead.
const nodemailer = require('nodemailer');
const transports = [];
const sentMessages = [];
const realCreate = nodemailer.createTransport;
nodemailer.createTransport = (options) => {
  transports.push(options);
  const t = realCreate({ streamTransport: true, buffer: true, newline: 'unix' });
  const send = t.sendMail.bind(t);
  // The message as it would have gone over the wire, kept to be read back.
  t.sendMail = async (message) => { const info = await send(message); sentMessages.push(info.message); return info; };
  return t;
};

require('../electron/main.js');
const db = require('../electron/db.js');
const storage = require('../electron/storage.js');
const delivery = require('../electron/mailDelivery.js');

let pass = 0, fail = 0;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const isJpeg = (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** A solid picture, so each render is a real image the badge can go on. */
function picture([b, g, r]) {
  const w = 320, h = 400, px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = b; px[i + 1] = g; px[i + 2] = r; px[i + 3] = 255; }
  return nativeImage.createFromBitmap(px, { width: w, height: h }).toPNG();
}

/** The parts of a built message: headers, and each attachment's name and bytes. */
function parse(raw) {
  const text = raw.toString('utf8');
  const head = text.slice(0, text.indexOf('\n\n'));
  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(head)?.[1];
  const parts = boundary ? text.split(`--${boundary}`).slice(1, -1) : [];
  const attachments = parts
    .filter((p) => /Content-Disposition:\s*attachment/i.test(p))
    .map((p) => {
      const name = /filename\*?=(?:UTF-8'')?"?([^"\n;]+)"?/i.exec(p)?.[1] ?? '';
      const body = p.slice(p.search(/\r?\n\r?\n/)).replace(/\s+/g, '');
      return { name: decodeURIComponent(name), bytes: Buffer.from(body, 'base64') };
    });
  const header = (name) => new RegExp(`^${name}:\\s*(.+)$`, 'im').exec(head)?.[1]?.trim() ?? null;
  return { header, attachments, text };
}

app.whenReady().then(async () => {
  await wait(2400);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c);
  const call = (ch, arg) => js(`window.gd.${ch}(${JSON.stringify(arg ?? {})}).then(r => JSON.stringify(r.ok ? { data: r.data } : { error: r.error.message }))`).then(JSON.parse);

  // ---- a wedding: the groom and his best man, each with two render sets ----
  const groom = db.upsertClient({ name: 'Sipho', surname: 'Ndlovu', contact: '', email: 'sipho@example.com' });
  const projectId = db.createProject({ clientId: groom, title: 'Wedding' });
  const bestMan = db.upsertClient({ name: 'James', surname: 'Botha', contact: '', email: '' });
  db.addMember({ projectId, clientId: bestMan, role: 'Best man' });
  const groomSuit = db.primarySuitId(projectId);
  const bestSuit = db.addSuit({ projectId, clientId: bestMan });
  const scope = storage.scopeForProject(projectId);
  const views = ['front', 'side', 'back', 'three_quarter'];
  let shade = 20;
  const renderSet = (suitId, batchId) => {
    for (const view of views) {
      const file = storage.saveImage(scope, picture([shade, shade + 40, shade + 80]), 'image/png', 'render');
      shade += 9;
      db.addRender({ projectId, suitId, batchId, view, filename: file, prompt: '', instruction: '' });
    }
  };
  renderSet(groomSuit, 'groom-older');
  await wait(1100); // created_at is to the second; the newer set must be newer
  renderSet(groomSuit, 'groom-newer');
  renderSet(bestSuit, 'best-older');
  await wait(1100);
  renderSet(bestSuit, 'best-newer');
  await wait(1100);
  // A refinement of the groom's side view, in the set it refines.
  const refinedFile = storage.saveImage(scope, picture([200, 30, 30]), 'image/png', 'render');
  db.addRender({ projectId, suitId: groomSuit, batchId: 'groom-newer', view: 'side', filename: refinedFile, prompt: '', instruction: 'wider lapels' });

  log('=== which renders go ===');
  const project = db.getProject(projectId);
  const sets = delivery.latestRenderSets(project);
  check(sets.length === 2, 'one set for each man on the order', String(sets.length));
  check(sets.every((s) => s.pictures.every((p) => p.batch_id.endsWith('newer'))),
    'and each is his newest set, not an older attempt',
    JSON.stringify(sets.map((s) => s.pictures.map((p) => p.batch_id))));
  const groomSet = sets.find((s) => s.suit.id === groomSuit);
  check(groomSet.pictures.map((p) => p.view).join() === views.join(),
    'front, side, back and three-quarter, in that order', groomSet.pictures.map((p) => p.view).join());
  check(groomSet.pictures.find((p) => p.view === 'side').filename === refinedFile,
    'a refined view sends the refinement, not the picture it replaced');

  log('\n=== what they look like when they arrive ===');
  const built = delivery.buildAttachments(project, {
    readImage: storage.readImage, stamp: require('../electron/brand.js').stamp, scope,
  });
  check(built.attachments.length === 8, 'eight pictures: four views of two suits', String(built.attachments.length));
  check(built.attachments.every((a) => isJpeg(a.content)), 'every one a JPEG');
  const rawFront = storage.readImage(scope, groomSet.pictures[0].filename);
  const sentFront = built.attachments.find((a) => a.filename.includes('Sipho Ndlovu - Front'));
  check(sentFront && !sentFront.content.equals(rawFront),
    'carrying the GD Suits badge - not the clean file from disk');
  check(built.attachments.some((a) => /^GD-\d{4}-\d{4} - James Botha - Three-quarter\.jpg$/.test(a.filename)),
    'named by order, person and view', built.attachments.map((a) => a.filename).join(' | '));

  // The cap, with a stamp that makes everything enormous.
  const huge = delivery.buildAttachments(project, {
    readImage: storage.readImage, stamp: () => Buffer.alloc(7 * 1024 * 1024), scope,
  });
  check(huge.total <= delivery.MAX_ATTACH_BYTES && huge.omitted > 0,
    'too many megabytes for Gmail, and the extra pictures are left off rather than bounced',
    JSON.stringify({ kept: huge.attachments.length, omitted: huge.omitted }));

  log('\n=== {renders} is the switch ===');
  let preview = (await call('quote.preview', { projectId })).data;
  check(preview.attachments.length === 8, 'the default wording attaches them', String(preview.attachments.length));
  check(/I have attached pictures of each suit on the order - the front, side, back and three-quarter views\./.test(preview.body),
    'and says so, naming the views it actually carries', preview.body.slice(-200));

  await call('settings.set', { key: 'quoteEmailTemplate', value: 'Hi {client_first}, here is the quote.' });
  preview = (await call('quote.preview', { projectId })).data;
  check(preview.attachments.length === 0 && preview.via === 'mailto',
    'take the placeholder out and nothing is attached - the plain draft, as before', JSON.stringify(preview.via));
  const before = opened.length;
  await call('quote.email', { projectId });
  check(opened.length === before + 1 && opened[opened.length - 1].url.startsWith('mailto:'),
    'which still opens exactly as it always did', opened[opened.length - 1]?.url?.slice(0, 40));
  await call('settings.set', { key: 'quoteEmailTemplate', value: 'Hi {client_first},\n\n{quote_block}\n\n{renders}\n\n{gd_name}' });

  log('\n=== without Gmail: a draft with the pictures inside ===');
  const r1 = (await call('quote.email', { projectId })).data;
  check(r1?.via === 'draft-file', 'Gmail not connected, so it becomes a draft file', JSON.stringify(r1));
  const draftOpened = opened[opened.length - 1];
  check(draftOpened?.kind === 'file' && draftOpened.file.endsWith('.eml'),
    'opened in his own mail program', draftOpened?.file);
  const draft = parse(fs.readFileSync(draftOpened.file));
  check(draft.header('X-Unsent') === '1', 'marked as a message to finish and send, not one received');
  check(draft.header('To') === 'sipho@example.com', 'addressed to the client', draft.header('To'));
  check(draft.attachments.length === 8 && draft.attachments.every((a) => isJpeg(a.bytes)),
    'with all eight pictures inside it, intact', String(draft.attachments.length));
  check(transports.length === 0, 'and Gmail was never so much as asked for');
  check((fs.statSync(draftOpened.file).mode & 0o077) === 0, 'the draft is readable by this user only');

  log('\n=== Gmail set up, but not allowed ===');
  await call('connections.set', { gmail: { method: 'gmail', address: 'gareth@gdsuits.co.za' } });
  await call('secrets.set', { name: 'gmailAppPassword', value: 'abcd efgh ijkl mnop' });
  preview = (await call('quote.preview', { projectId })).data;
  check(preview.via === 'draft-file', 'with the gate shut it is still a draft', preview.via);
  await call('quote.email', { projectId });
  check(transports.length === 0, 'and nothing went anywhere near Gmail');
  let hosts = (await call('app.security')).data.networkHosts;
  check(!hosts.includes('smtp.gmail.com'), 'nor does Gmail appear among the places data goes');

  log('\n=== Gmail allowed ===');
  await call('connections.set', { consent: true });
  preview = (await call('quote.preview', { projectId })).data;
  check(preview.via === 'gmail' && preview.from === 'gareth@gdsuits.co.za',
    'now it would send, and says from whom', JSON.stringify({ via: preview.via, from: preview.from }));
  hosts = (await call('app.security')).data.networkHosts;
  check(hosts.includes('smtp.gmail.com'), 'and Gmail is listed among the places data goes', JSON.stringify(hosts));

  const r2 = (await call('quote.email', { projectId })).data;
  check(r2?.sent === true && r2.via === 'gmail', 'sent through Gmail', JSON.stringify(r2));
  const t = transports[transports.length - 1];
  check(t?.host === 'smtp.gmail.com' && t.port === 465 && t.secure === true,
    'over TLS to Gmail and nowhere else', JSON.stringify({ host: t?.host, port: t?.port, secure: t?.secure }));
  check(t?.auth?.user === 'gareth@gdsuits.co.za' && t.auth.pass === 'abcd efgh ijkl mnop',
    'signed in as him, with the app password from the keychain');
  // Read from the message as built for the wire, not from what the app says
  // it attached.
  const wire = parse(sentMessages[sentMessages.length - 1]);
  check(wire.header('From')?.includes('gareth@gdsuits.co.za') && wire.header('To') === 'sipho@example.com',
    'from him, to the client', JSON.stringify({ from: wire.header('From'), to: wire.header('To') }));
  check(wire.attachments.length === 8 && wire.attachments.every((a) => isJpeg(a.bytes)),
    'and the message that went out really carries all eight pictures', String(wire.attachments.length));

  log('\n=== a standing email stays a draft ===');
  const rule = (await call('mail.saveRule', {
    name: 'Fitting reminder', anchor: 'event_date', offsetDays: -7, audience: 'all',
    subject: 'Your fitting', body: 'Hi {client_first}, your suit so far.\n\n{renders}',
  })).data;
  const sentBefore = transports.length;
  const r3 = (await call('mail.send', { ruleId: rule.id, projectId })).data;
  check(r3?.via === 'draft-file' && r3.attached === 8,
    'it carries the renders as a draft, even with Gmail allowed', JSON.stringify(r3));
  check(transports.length === sentBefore, 'and is never sent by the app itself');

  log('\n=== what a hostile page gets ===');
  const bad = await call('quote.email', { projectId: '../../etc' });
  check(!!bad.error, 'an order id that is not an id is refused');
  const sneaky = await call('quote.email', { projectId, to: 'attacker@example.com', attachments: ['/etc/passwd'] });
  check(sneaky.data?.to === 'sipho@example.com',
    'an address passed in is ignored - it goes to the client on the order', JSON.stringify(sneaky.data?.to));

  log('\n=== no renders at all ===');
  const solo = db.upsertClient({ name: 'Solo', surname: 'Client', contact: '', email: 'solo@example.com' });
  const soloProject = db.createProject({ clientId: solo, title: 'No renders yet' });
  await call('connections.set', { consent: false });
  preview = (await call('quote.preview', { projectId: soloProject })).data;
  check(preview.attachments.length === 0 && preview.via === 'mailto', 'nothing to attach, the plain draft');
  check(!/I have attached/.test(preview.body), 'and the wording does not claim pictures that are not there');

  log(`\n${fail === 0 ? 'ALL ATTACHMENT CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
