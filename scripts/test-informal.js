/**
 * The informal quote: the shop's figures, emailed with the renders.
 *
 * The shop sees every line before it goes and can change any figure or add a
 * line of its own - a discount. What it sends is what the email says, what is
 * recorded, what reopening starts from, and what the formal quote is fixed at -
 * as long as the order is still the order those figures were worked out for.
 *
 * The shop is the made-up one in fixtures/example-shop.js: every figure the
 * app works out here comes from its price list, and every figure typed in is
 * invented.
 *
 * Nothing leaves the machine: Gmail's transport builds the message into
 * memory, the mail program and WhatsApp are recorded instead of opened, and
 * the clipboard is a list.
 */
const { app, BrowserWindow, nativeImage, shell, clipboard } = require('electron');
const fs = require('fs');
const { seedExampleShop, suitFigure, OPTIONS } = require('./fixtures/example-shop.js');
const dir = require('./fresh.js').freshUserData(app);
seedExampleShop(dir);

const opened = [];
shell.openPath = async (file) => { opened.push({ kind: 'file', file: String(file) }); return ''; };
shell.openExternal = async (url) => { opened.push({ kind: 'url', url: String(url) }); return true; };
const copied = [];
const stub = (text) => { copied.push(String(text)); };
clipboard.writeText = stub;

const nodemailer = require('nodemailer');
const transports = [];
const sentMessages = [];
const realCreate = nodemailer.createTransport;
nodemailer.createTransport = (options) => {
  transports.push(options);
  const t = realCreate({ streamTransport: true, buffer: true, newline: 'unix' });
  const send = t.sendMail.bind(t);
  t.sendMail = async (message) => { const info = await send(message); sentMessages.push(info.message); return info; };
  return t;
};

require('../electron/main.js');
const db = require('../electron/db.js');
const storage = require('../electron/storage.js');

let pass = 0, fail = 0;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const isJpeg = (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

function picture([b, g, r]) {
  const w = 320, h = 400, px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = b; px[i + 1] = g; px[i + 2] = r; px[i + 3] = 255; }
  return nativeImage.createFromBitmap(px, { width: w, height: h }).toPNG();
}

/** Quoted-printable, as nodemailer writes a text part with a "·" in it. */
const unQP = (s) => Buffer.from(
  s.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1'
).toString('utf8');

/** A built message: its headers, its text, and each attachment. */
function parse(raw) {
  const text = raw.toString('utf8').replace(/\r\n/g, '\n');
  const head = text.slice(0, text.indexOf('\n\n'));
  const header = (name) => new RegExp(`^${name}:\\s*(.+)$`, 'im').exec(head)?.[1]?.trim() ?? null;
  const boundary = /boundary="?([^";\n]+)"?/i.exec(head)?.[1];
  const parts = boundary
    ? text.split(`--${boundary}`).slice(1, -1).map((p) => p.replace(/^\n/, ''))
    : [text];
  const decode = (part) => {
    const split = part.indexOf('\n\n');
    const headers = part.slice(0, split);
    const body = part.slice(split + 2).replace(/\n$/, '');
    const cte = /Content-Transfer-Encoding:\s*(\S+)/i.exec(headers)?.[1]?.toLowerCase() ?? '7bit';
    if (cte === 'quoted-printable') return unQP(body);
    if (cte === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    return body;
  };
  const textPart = parts.find((p) => /Content-Type:\s*text\/plain/i.test(p.slice(0, p.indexOf('\n\n'))));
  const attachments = parts
    .filter((p) => /Content-Disposition:\s*attachment/i.test(p))
    .map((p) => ({
      name: /filename\*?=(?:UTF-8'')?"?([^"\n;]+)"?/i.exec(p)?.[1] ?? '',
      bytes: Buffer.from(p.slice(p.indexOf('\n\n')).replace(/\s+/g, ''), 'base64'),
    }));
  return { header, body: textPart ? decode(textPart) : '', attachments };
}

app.whenReady().then(async () => {
  await wait(2400);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c);
  const call = (ch, arg) => js(`window.gd.${ch}(${JSON.stringify(arg ?? {})}).then(r => JSON.stringify(r.ok ? { data: r.data } : { error: r.error.message }))`).then(JSON.parse);

  const HELPERS = `
    window.T = {
      wait: (ms) => new Promise(r => setTimeout(r, ms)),
      byText: (sel, text) => [...document.querySelectorAll(sel)].find(e => e.textContent.trim().startsWith(text)),
      type: (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      },
      modal: () => {
        const m = document.querySelector('.modal');
        return JSON.stringify({
          text: m?.innerText ?? '',
          message: m?.querySelector('.informal-message')?.textContent ?? '',
          amounts: [...(m?.querySelectorAll('.informal-amount') ?? [])].map(i => i.value),
          thumbs: m?.querySelectorAll('.informal-renders img').length ?? 0,
          box: !!m?.querySelector('input.informal-attach'),
          buttons: [...(m?.querySelectorAll('button') ?? [])].map(b => b.textContent.trim()),
        });
      },
    };
    true;`;
  const reload = async () => { win.webContents.reload(); await wait(2200); await js(HELPERS); };
  const openOrder = async (name, step) => {
    await reload();
    await js(`(async () => {
      T.byText('.nav-item', 'Orders').click(); await T.wait(700);
      [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes(${JSON.stringify(name)})).click(); await T.wait(1100);
      ${step ? `[...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes(${JSON.stringify(step)})).click(); await T.wait(900);` : ''}
      return true;
    })()`);
  };
  const openModal = async (name) => {
    await openOrder(name, 'Summary');
    return JSON.parse(await js(`(async () => {
      (T.byText('button', 'Send informal quote') || T.byText('button', 'Send again')).click(); await T.wait(1200);
      return T.modal();
    })()`));
  };
  const modalNow = () => js('T.modal()').then(JSON.parse);
  const press = (label, ms = 1500) => js(`(async () => { T.byText('.modal button', ${JSON.stringify(label)}).click(); await T.wait(${ms}); return true; })()`);
  const lastFile = () => [...opened].reverse().find((o) => o.kind === 'file');
  const lastUrl = () => [...opened].reverse().find((o) => o.kind === 'url')?.url ?? '';

  check(clipboard.writeText === stub, 'the clipboard is a list for this run, not the real one');

  /* -------------------------------------------- one suit, rendered four ways */
  const client = db.upsertClient({ name: 'Sipho', surname: 'Ndlovu', contact: '082 111 2222', email: 'sipho@example.com' });
  const order = db.createProject({ clientId: client, title: 'Wedding', eventType: 'wedding', eventDate: '2026-11-14' });
  const suit = db.primarySuitId(order);
  db.updateSuit(suit, { spec: { suitType: 'three_piece', material: 'standard_wool', lapel: 'peak' }, fabric_name: 'Navy twill' });
  const scope = storage.scopeForProject(order);
  let shade = 30;
  for (const view of ['front', 'side', 'back', 'three_quarter']) {
    const file = storage.saveImage(scope, picture([shade, shade + 40, shade + 80]), 'image/png', 'render');
    shade += 20;
    db.addRender({ projectId: order, suitId: suit, batchId: 'set-1', view, filename: file, prompt: '', instruction: '' });
  }
  // The example shop's standard wool 3-piece and its peak lapel: R2,600 + R115.
  const SUIT = suitFigure('three_piece', 'standard_wool');
  const LIST = SUIT + OPTIONS['lapel:peak'];
  // The shop's own figure for the suit, and its discount - both made up, and
  // chosen so the revised total (R2,790) is not the list's (R2,715).
  const MINE = 2810, DISCOUNT = -135;
  const ref = db.getProject(order).order_ref;

  log('=== the shop sees every figure first ===');
  let m = await openModal('Sipho');
  check(m.amounts.length >= 2 && m.amounts[0] === String(SUIT), 'each price-list line is a figure the shop can change', JSON.stringify(m.amounts));
  check(/From the price list/.test(m.text), 'and it says where they came from');
  check(/Total: R2,715/.test(m.message), 'the message starts at the price list total', m.message.slice(0, 300));
  check(m.thumbs === 4 && m.box, 'the four renders are shown, ticked to go', JSON.stringify({ thumbs: m.thumbs, box: m.box }));
  check(/I have attached pictures of your suit - the front, side, back and three-quarter views\./.test(m.message),
    'and the email says which pictures are attached');
  check(!/https?:\/\//.test(m.message), 'there is no link to a page anywhere in it');
  check(m.buttons.includes('Open the email to send'), 'without Gmail it opens in the shop\'s mail program', m.buttons.join(' | '));

  log('\n=== the shop changes a figure and adds a discount ===');
  m = JSON.parse(await js(`(async () => {
    T.type(document.querySelectorAll('.modal .informal-amount')[0], '${MINE}'); await T.wait(200);
    T.byText('.modal button', '+ Add a line').click(); await T.wait(200);
    T.type(document.querySelector('.modal input[aria-label="What this line is"]'), 'Loyalty discount'); await T.wait(100);
    T.type(document.querySelector('.modal input[aria-label="Its amount - negative for a discount"]'), '${DISCOUNT}'); await T.wait(300);
    return T.modal();
  })()`));
  const REVISED = MINE + OPTIONS['lapel:peak'] + DISCOUNT;
  check(/Total: R2,790/.test(m.message), 'the total in the message follows the change', m.message);
  check(/Loyalty discount: -R135/.test(m.message), 'the discount is a line, written -R135', m.message);
  check(/Deposit to start \(50%\): R1,395/.test(m.message), 'and the deposit follows the new total');
  check(/price list R2,715/.test(m.text), 'with the price list figure beside it, so the shop can see what it changed');
  const shown = m.message;

  log('\n=== it is emailed with the renders ===');
  const before = opened.length;
  await press('Open the email to send', 2500);
  const draftFile = lastFile();
  check(opened.length === before + 1 && draftFile?.file.endsWith('.eml'), 'a draft opens in the shop\'s mail program', JSON.stringify(opened.slice(before)));
  const draft = draftFile ? parse(fs.readFileSync(draftFile.file)) : null;
  check(draft?.header('To') === 'sipho@example.com', 'addressed to the client on file', draft?.header('To'));
  check(draft?.header('X-Unsent') === '1', 'as a message to finish and send');
  check(draft?.header('Subject') === `Your informal quote from GD Suits - ${ref}`, 'with a subject that says what it is', draft?.header('Subject'));
  check(draft?.body === shown, 'saying exactly what the shop was shown', JSON.stringify(draft?.body).slice(0, 300));
  check(draft?.attachments.length === 4 && draft.attachments.every((a) => isJpeg(a.bytes)),
    'with the four renders inside it, as JPEGs', String(draft?.attachments.length));
  const raw = storage.readImage(scope, db.getProject(order).renders.find((r) => r.view === 'front').filename);
  check(draft?.attachments.every((a) => !a.bytes.equals(raw)), 'badged - not the clean files from disk');
  check(transports.length === 0, 'and Gmail was never asked for');

  let iq = db.getProject(order).informalQuote;
  check(iq?.via === 'email' && iq.to === 'sipho@example.com' && iq.pictures === 4 && iq.total === REVISED,
    'recorded: by email, to whom, with four pictures, for the shop\'s figure', JSON.stringify({ ...iq, lines: undefined, basis: undefined }));
  check(iq?.lines.some((l) => l.key === 'suitType:three_piece@standard_wool' && l.amount === MINE)
    && iq.lines.some((l) => l.key === 'added/0' && l.label === 'Loyalty discount' && l.amount === DISCOUNT),
    'with every line as the shop left it', JSON.stringify(iq?.lines));
  check(iq?.basis.length === m.amounts.length - 1 && iq.basis.some(([k, a]) => k === 'suitType:three_piece@standard_wool' && a === SUIT),
    'and the price list it was worked out from', JSON.stringify(iq?.basis));

  log('\n=== sending again starts from what the shop sent ===');
  m = await openModal('Sipho');
  check(m.amounts[0] === String(MINE) && m.amounts.includes(String(DISCOUNT)), 'the shop\'s figures, not the price list\'s', JSON.stringify(m.amounts));
  check(/As you last sent them/.test(m.text) && /Total: R2,790/.test(m.message), 'and it says so', m.message.slice(0, 120));

  log('\n=== through Gmail, when the shop has allowed it ===');
  // The shop's Gmail is not the address in its business details (the
  // fixture's), so the From check below can only pass on the Gmail one.
  await call('connections.set', { gmail: { method: 'gmail', address: 'quinn@example.com' } });
  await call('secrets.set', { name: 'gmailAppPassword', value: 'abcd efgh ijkl mnop' });
  await call('connections.set', { consent: true });
  m = await openModal('Sipho');
  check(m.buttons.includes('Send to sipho@example.com') && /through Gmail as quinn@example\.com/.test(m.text),
    'the button says it will send, and from whom', m.buttons.join(' | '));
  const gmailShown = m.message;
  await press('Send to sipho@example.com', 2500);
  const wire = sentMessages.length ? parse(sentMessages[sentMessages.length - 1]) : null;
  check(transports.length === 1 && transports[0].host === 'smtp.gmail.com', 'it went to Gmail', JSON.stringify(transports.map((t) => t.host)));
  check(wire?.header('To') === 'sipho@example.com' && wire.header('From')?.includes('quinn@example.com'),
    'from the shop, to the client', JSON.stringify({ to: wire?.header('To'), from: wire?.header('From') }));
  check(wire?.attachments.length === 4 && wire.attachments.every((a) => isJpeg(a.bytes)),
    'and the message on the wire carries the four renders', String(wire?.attachments.length));
  check(wire?.body === gmailShown, 'saying exactly what was shown');

  log('\n=== untick the renders and none go ===');
  m = await openModal('Sipho');
  m = JSON.parse(await js(`(async () => { document.querySelector('.modal input.informal-attach').click(); await T.wait(300); return T.modal(); })()`));
  check(m.thumbs === 0 && !/I have attached/.test(m.message), 'the pictures and the sentence about them go', m.message.slice(-260));
  await press('Send to sipho@example.com', 2500);
  const bare = parse(sentMessages[sentMessages.length - 1]);
  check(sentMessages.length === 2 && bare.attachments.length === 0, 'Gmail sends it without a single picture', String(bare.attachments.length));
  check(db.getProject(order).informalQuote.pictures === 0, 'and the record says none went');

  await call('connections.set', { consent: false });
  m = await openModal('Sipho');
  await js(`(async () => { document.querySelector('.modal input.informal-attach').click(); await T.wait(300); return true; })()`);
  const beforeMailto = opened.length;
  await press('Open the email to send', 1500);
  check(opened.length === beforeMailto + 1 && opened[opened.length - 1].kind === 'url' && lastUrl().startsWith('mailto:'),
    'without Gmail and with nothing attached it is the plain draft it always was', JSON.stringify(opened.slice(beforeMailto)));

  log('\n=== the order changes, and the shop\'s figures no longer describe it ===');
  db.updateSuit(suit, { spec: { suitType: 'three_piece', material: 'standard_wool', lapel: 'notch' } });
  await openOrder('Sipho', 'Summary');
  const card = await js(`[...document.querySelectorAll('.card')].find(c => c.querySelector('h3')?.textContent === 'Informal quote')?.innerText ?? ''`);
  check(/The order has changed since/.test(card), 'the card says the order has moved on', card);
  m = await openModal('Sipho');
  check(m.amounts[0] === String(SUIT) && !m.amounts.includes(String(DISCOUNT)) && /From the price list/.test(m.text),
    'and the next quote starts from the price list again', JSON.stringify(m.amounts));
  await openOrder('Sipho', 'Summary');
  let summary = await js(`document.querySelector('.content').innerText`);
  check(/This total follows the price list until the formal quote is sent/.test(summary), 'as does the formal quote');

  db.updateSuit(suit, { spec: { suitType: 'three_piece', material: 'standard_wool', lapel: 'peak' } });
  await openOrder('Sipho', 'Summary');
  const back = await js(`[...document.querySelectorAll('.card')].find(c => c.querySelector('h3')?.textContent === 'Informal quote')?.innerText ?? ''`);
  check(!/The order has changed since/.test(back), 'put it back as it was, and the shop\'s figures stand again', back);

  log('\n=== the client confirms, and the figures stay ===');
  await js(`(async () => { T.byText('button', 'Client confirmed').click(); await T.wait(1000); return true; })()`);
  iq = db.getProject(order).informalQuote;
  check(iq?.status === 'confirmed' && iq.total === REVISED && iq.lines.length === 3 && iq.basis.length === 2,
    'marking the answer keeps the shop\'s figures and what they were worked out from', JSON.stringify({ ...iq, lines: iq?.lines?.length, basis: iq?.basis?.length }));

  log('\n=== the formal quote is fixed at the shop\'s figures ===');
  await openOrder('Sipho', 'Summary');
  summary = await js(`document.querySelector('.content').innerText`);
  check(/These are the figures in the informal quote you sent on/.test(summary) && /R2,790/.test(summary),
    'the summary shows the figures the client was quoted', summary.slice(summary.indexOf('Quote'), summary.indexOf('Quote') + 300));
  const fix = await js(`(async () => {
    T.byText('button', 'Email the formal quote').click(); await T.wait(600);
    return document.querySelector('.modal')?.innerText ?? '';
  })()`);
  check(/fixes the price at R2,790 - the figures in the informal quote you sent on/.test(fix), 'and says what it will fix the price at', fix);
  const beforeFix = opened.length;
  await press('Fix the price and send', 3600);
  const fixed = db.getProject(order);
  check(fixed.status === 'quoted' && fixed.quote?.total === REVISED && fixed.quote.listTotal === LIST,
    'fixed at R2,790, with the price list\'s R2,715 kept beside it', JSON.stringify({ ...fixed.quote, lines: undefined }));
  check(fixed.quote?.lines.some((l) => l.label === 'Loyalty discount' && l.amount === DISCOUNT), 'the shop\'s discount is a line on it');
  const formal = opened.slice(beforeFix).find((o) => o.kind === 'file');
  const formalMail = formal ? parse(fs.readFileSync(formal.file)) : null;
  check(/Total: R2,790/.test(formalMail?.body ?? '') && /Loyalty discount {2}-R135/.test(formalMail?.body ?? ''),
    'the formal quote email says R2,790 and lists the discount as -R135', (formalMail?.body ?? '').slice(0, 400));

  log('\n=== and the drift banner only speaks of the price list ===');
  await openOrder('Sipho', 'Summary');
  summary = await js(`document.querySelector('.content').innerText`);
  check(!/The price list has changed since this was agreed/.test(summary), 'the shop\'s own discount is not reported as the price list moving');
  // The suit's list figure moves to R3,150: with the peak lapel, R3,265 -
  // R475 more than the R2,790 the client was quoted.
  await call('settings.set', { key: 'priceOverrides', value: { 'suitType:three_piece@standard_wool': 3150 } });
  await openOrder('Sipho', 'Summary');
  summary = await js(`document.querySelector('.content').innerText`);
  check(/today it would be R3,265 \(\+R475\)/.test(summary) && /The client was quoted R2,790/.test(summary),
    'a real price-list change is, with what re-quoting would change', summary.slice(summary.indexOf('The price list'), summary.indexOf('The price list') + 200));
  await call('settings.set', { key: 'priceOverrides', value: {} });

  /* --------------------------------------- no renders; status moved elsewhere */
  log('\n=== an order with no renders yet ===');
  const lerato = db.upsertClient({ name: 'Lerato', surname: 'Khumalo', contact: '083 222 3333', email: 'lerato@example.com' });
  const order2 = db.createProject({ clientId: lerato, title: 'Matric dance' });
  db.updateSuit(db.primarySuitId(order2), { spec: { suitType: 'two_piece', material: 'standard_wool' } });
  m = await openModal('Lerato');
  check(!m.box && m.thumbs === 0 && /No renders yet/.test(m.text), 'nothing to attach, and it says how to get some');
  check(!/I have attached/.test(m.message), 'and the message does not claim pictures');
  // The shop's own figure for a 2-piece the list has at R2,050 - made up.
  const MINE2 = 1900;
  m = JSON.parse(await js(`(async () => { T.type(document.querySelectorAll('.modal .informal-amount')[0], '${MINE2}'); await T.wait(300); return T.modal(); })()`));
  const beforeWa = opened.length;
  await press('Send by WhatsApp', 1500);
  const wa = opened.slice(beforeWa).find((o) => o.kind === 'url' && o.url.startsWith('https://wa.me/'))?.url ?? '';
  const waText = wa ? decodeURIComponent(wa.split('?text=')[1]) : '';
  check(wa.startsWith('https://wa.me/27832223333?text=') && waText === m.message && /Total: R1,900/.test(waText),
    'WhatsApp carries the shop\'s figure, word for word', waText.slice(0, 200));
  await press('Copy message', 800);
  check(copied.length === 1 && copied[0] === m.message, 'and so does the copied message');

  log('\n=== the status moves on, and the price is frozen at the shop\'s figure ===');
  db.updateProject(order2, { status: 'deposit_paid' });
  await openOrder('Lerato', 'Order');
  await wait(800);
  const frozen = db.getProject(order2).quote;
  check(frozen?.total === MINE2 && frozen.listTotal === suitFigure('two_piece', 'standard_wool'),
    'fixed at R1,900, not the price list\'s R2,050', JSON.stringify({ ...frozen, lines: undefined }));

  /* --------------------------------------------------- what a hostile page gets */
  log('\n=== what a hostile page gets ===');
  const line = (amount, extra = {}) => ({ group: '', label: 'Suit', amount, key: 'suitType:two_piece', ...extra });
  const good = { projectId: order2, via: 'whatsapp', text: 'hello', basis: [['suitType:two_piece', 2050]] };
  const lied = await call('informal.send', { ...good, lines: [line(152)], total: 1 });
  check(lied.data?.total === 152 && db.getProject(order2).informalQuote.total === 152,
    'a total passed in is ignored - it is the sum of the lines', JSON.stringify(lied));
  const refused = [
    ['no lines', { lines: [] }],
    ['lines that are not a list', { lines: 'R1' }],
    ['too many lines', { lines: Array.from({ length: 401 }, () => line(1)) }],
    ['an amount that is not a number', { lines: [line('a lot')] }],
    ['an amount out of all proportion', { lines: [line(1e9)] }],
    ['a line with no description', { lines: [line(10, { label: '   ' })] }],
    ['no price list behind the figures', { lines: [line(10)], basis: undefined }],
    ['a basis that is not pairs', { lines: [line(10)], basis: [['only-a-key']] }],
    ['an essay of a message', { lines: [line(10)], text: 'x'.repeat(32001) }],
  ];
  for (const [what, patch] of refused) {
    const r = await call('informal.send', { ...good, ...patch });
    check(!!r.error, `refused: ${what}`, JSON.stringify(r).slice(0, 120));
  }
  check(db.getProject(order2).informalQuote.total === 152, 'and none of them was recorded');
  const badCopy = await call('informal.copy', { projectId: order2, text: 'x', lines: [line('x')], basis: [] });
  check(!!badCopy.error && copied.length === 1, 'copying checks the figures the same way, before touching the clipboard');

  const beforeSneak = opened.length;
  const sneaky = await call('informal.send', {
    projectId: order, via: 'email', text: 'hello', subject: 's', pictures: 'yes please',
    lines: [line(10)], basis: [], to: 'attacker@example.com', email: 'attacker@example.com', attachments: ['/etc/passwd'],
  });
  check(sneaky.data?.to === 'sipho@example.com' && sneaky.data.attached === 0,
    'an address and attachments passed in are ignored, and only `true` attaches the order\'s renders', JSON.stringify(sneaky));
  check(opened.slice(beforeSneak).every((o) => o.kind === 'url' ? o.url.startsWith('mailto:sipho') : !/attacker/.test(fs.readFileSync(o.file, 'utf8'))),
    'nothing went to the address passed in');
  const otherOrder = await call('informal.preview', { projectId: 999999 });
  check(!!otherOrder.error, 'an order that does not exist is not previewed');

  log('\n=== there is no quote page any more ===');
  db.setSetting('business', { quotePageUrl: 'https://quotes.example.com/q/', businessName: 'GD Suits' });
  const shop = (await call('business.get')).data;
  check(shop && !('quotePageUrl' in shop) && shop.businessName === 'GD Suits', 'an address saved before is not read back', JSON.stringify(shop));
  check(!fs.existsSync(require('path').join(__dirname, '..', 'quote-page')), 'and the page itself is gone from the repository');

  log(`\n${fail === 0 ? 'ALL INFORMAL QUOTE CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
