/**
 * GD's October notes, checked in the running app.
 *
 * Each block is one line of GD's feedback: the informal quote and the page it
 * links to, an order of more than one suit priced and summarised as a whole,
 * the people-and-suits line in its place, alterations that follow the
 * measurement list, the AI sanity check, the database sheet, and renaming an
 * option. Nothing leaves the machine: the one AI call is answered by a stub,
 * WhatsApp and mail links are caught before they open, and the save dialog
 * writes into a temporary folder.
 */
const { app, BrowserWindow, dialog, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
require('./fresh.js').freshUserData(app);

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-feedback-'));
const opened = [];
shell.openExternal = async (url) => { opened.push(String(url)); return true; };
dialog.showSaveDialog = async (_w, opts) => ({ canceled: false, filePath: path.join(OUT, path.basename(opts.defaultPath)) });

// The AI read. The saved model is one Google has retired; the key's own list
// has current ones. Every request is kept so the prompt can be read back.
const aiCalls = [];
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  aiCalls.push({ url: u, body: opts.body ? JSON.parse(opts.body) : null });
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (u.includes('/models?')) {
    const m = (name, description = '') => ({ name: `models/${name}`, description, supportedGenerationMethods: ['generateContent'] });
    return json(200, { models: [
      m('gemini-3.6-flash-image', 'image generation'), m('gemini-3.6-pro'), m('gemini-3.6-flash'),
      m('gemini-3.7-flash-preview'), m('gemini-flash-latest'), m('text-embedding-005'),
    ] });
  }
  if (u.includes('gemini-2.5-flash:generateContent')) {
    return json(404, { error: { message: 'models/gemini-2.5-flash is no longer available to new users. Please use models/gemini-flash-latest instead.' } });
  }
  if (u.includes('gemini-flash-latest:generateContent')) {
    return json(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({
      flags: [{ field: 'Trousers - Waist', issue: 'Narrow against a 104 chest', suggestion: 'Re-take it at the navel.' }],
      notes: ['Otherwise coherent.'],
    }) }] }, finishReason: 'STOP' }] });
  }
  return json(500, { error: { message: `unexpected call ${u}` } });
};

require('../electron/main.js');
const db = require('../electron/db.js');
const secrets = require('../electron/secrets.js');
const registry = require('../electron/ai/registry.js');
const informal = require('../electron/informal.js');
const csv = require('../electron/csv.js');

let pass = 0, fail = 0;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  await wait(2400);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c);
  const call = (ch, arg) => js(`window.gd.${ch}(${JSON.stringify(arg)}).then(r => JSON.stringify(r.ok ? { data: r.data } : { error: r.error.message }))`).then(JSON.parse);

  // In-page helpers, put on the window once per load.
  const HELPERS = `
    window.T = {
      wait: (ms) => new Promise(r => setTimeout(r, ms)),
      byText: (sel, text) => [...document.querySelectorAll(sel)].find(e => e.textContent.trim().startsWith(text)),
      field: (name) => [...document.querySelectorAll('.field')].find(f => f.querySelector('label')?.textContent.trim() === name),
      type: (input, value) => {
        const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
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
  const step = (name) => js(`(async () => {
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes(${JSON.stringify(name)})).click(); await T.wait(900); return true;
  })()`);

  /* ------------------------------------------------------- a wedding party */
  const groom = db.upsertClient({ name: 'Sipho', surname: 'Ndlovu', contact: '082 111 2222', email: 'sipho@example.com' });
  const order = db.createProject({ clientId: groom, title: 'Wedding', eventType: 'wedding', eventDate: '2026-11-14' });
  const groomSuit = db.primarySuitId(order);
  db.updateSuit(groomSuit, { spec: { suitType: 'three_piece', lapel: 'peak' }, fabric_name: 'Navy twill', label: 'Groom' });
  const bestMan = db.upsertClient({ name: 'Thabo', surname: 'Mokoena', contact: '', email: '' });
  db.addMember({ projectId: order, clientId: bestMan, role: 'Best man' });
  const bestSuit = db.addSuit({ projectId: order, clientId: bestMan, label: 'Best man' });
  db.updateSuit(bestSuit, { spec: { suitType: 'two_piece' }, fabric_name: 'Charcoal' });
  db.saveMeasurement({ projectId: order, suitId: groomSuit, garment: 'pants', fieldId: 'pantWaist', value: 100 });
  db.saveMeasurement({ projectId: order, suitId: groomSuit, garment: 'jacket', fieldId: 'chest', value: 104 });
  db.saveMeasurement({ projectId: order, suitId: bestSuit, garment: 'pants', fieldId: 'pantWaist', value: 80 });
  // 3-piece R5,800 + peak R250 for the groom; 2-piece R4,500 for the best man.
  const WHOLE = 5800 + 250 + 4500;

  log('=== an order of two suits is priced as two ===');
  await reload();
  const dashValue = await js(`(async () => {
    T.byText('.nav-item', 'Orders').click(); await T.wait(700);
    const row = [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes('Sipho'));
    return [...row.querySelectorAll('td')].map(td => td.textContent.trim()).find(t => /^R[\\d,]+$/.test(t));
  })()`);
  check(dashValue === 'R10,550', 'the order list values the whole party, not the first suit', dashValue);
  check(db.getProject(order).quantity === 2, 'and the order counts two suits', String(db.getProject(order).quantity));

  await openOrder('Sipho', 'Base Garment');
  const bar = await js(`document.querySelector('.price-bar').innerText`);
  check(/R10,550/.test(bar), 'the running total is the whole order', bar.replace(/\s+/g, ' ').slice(0, 80));
  check(/This suit R6,050/.test(bar), 'with the suit on screen beside it', bar.replace(/\s+/g, ' ').slice(0, 80));

  log('\n=== the order page ===');
  await step('Order');
  const orderPage = JSON.parse(await js(`(async () => {
    const labels = [...document.querySelectorAll('.field > label')].map(l => l.textContent.trim());
    // A party of two is folded; open the groom.
    [...document.querySelectorAll('.party-head')].find(h => h.textContent.includes('Sipho')).click(); await T.wait(500);
    const party = document.querySelector('.party-body');
    const rect = (el) => el ? el.getBoundingClientRect() : null;
    const role = [...(party?.querySelectorAll('.party-label') ?? [])].find(l => l.textContent === 'Role');
    const suit = [...(party?.querySelectorAll('.party-label') ?? [])].find(l => l.textContent === 'Suit');
    const roleInput = role?.parentElement.querySelector('.input');
    const suitInput = suit?.parentElement.querySelector('.input');
    return JSON.stringify({
      labels,
      fabricBoxes: labels.filter(l => l === 'Fabric colour').length,
      role: rect(role), suit: rect(suit), roleInput: rect(roleInput), suitInput: rect(suitInput),
      informal: !![...document.querySelectorAll('.card-head h3')].find(h => h.textContent === 'Informal quote'),
    });
  })()`));
  check(!orderPage.labels.includes('First appointment'), 'the first appointment is not asked again here', orderPage.labels.join(' | '));
  check(!orderPage.labels.includes('Number of suits'), 'nor a number of suits that could disagree with the suits');
  check(orderPage.fabricBoxes === 2, 'each suit has its own cloth details', String(orderPage.fabricBoxes));
  check(orderPage.informal, 'and the informal quote sits on the order page');
  const near = (a, b) => Math.abs(a - b) < 2;
  check(orderPage.role && orderPage.suit && near(orderPage.suit.left, orderPage.role.left),
    'the "Suit" line starts under "Role", in the label column', JSON.stringify([orderPage.role?.left, orderPage.suit?.left]));
  check(orderPage.suit && orderPage.suit.top > orderPage.role.top + 10 && near(orderPage.suit.top + orderPage.suit.height / 2, orderPage.suitInput.top + orderPage.suitInput.height / 2),
    'on its own line, level with its own box', JSON.stringify([orderPage.role?.top, orderPage.suit?.top, orderPage.suitInput?.top]));

  // A second suit for the groom, and its own cloth.
  await js(`(async () => { T.byText('button', '+ Add another suit').click(); await T.wait(1200); return true; })()`);
  let suits = db.listSuits(order);
  check(suits.length === 3 && db.getProject(order).quantity === 3, 'adding a suit adds a set of cloth details and counts it',
    `${suits.length} suits, quantity ${db.getProject(order).quantity}`);
  await js(`(async () => {
    const boxes = [...document.querySelectorAll('.order-suit')];
    const input = [...boxes[2].querySelectorAll('.field')].find(f => f.querySelector('label').textContent === 'Fabric colour').querySelector('input');
    T.type(input, 'Ivory linen');
    const code = [...boxes[0].querySelectorAll('.field')].find(f => f.querySelector('label').textContent === 'Material code').querySelector('input');
    T.type(code, 'NV-77');
    await T.wait(200);
    // Leave the page with both still typed: blur needs the window in front,
    // which a test run cannot promise, and leaving is the case that matters.
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Client')).click();
    await T.wait(1500);
    return true;
  })()`);
  suits = db.listSuits(order);
  check(suits[2].fabric_name === 'Ivory linen' && suits[0].fabric_name === 'Navy twill', 'the third suit\'s cloth is its own',
    suits.map((s) => s.fabric_name).join(' | '));
  check(db.getProject(order).fabric_code === 'NV-77', 'and the first suit\'s cloth is still the order\'s, for the list and the sheet',
    db.getProject(order).fabric_code);
  db.removeSuit(suits[2].id);
  check(db.getProject(order).quantity === 2, 'removing a suit counts it off again');

  log('\n=== the client page ===');
  await step('Client');
  const clientText = await js(`document.body.innerText`);
  check(/Where the suit must be delivered, if not collected\. Please note, this comes with a service charge\./.test(clientText),
    'the postal address carries GD\'s instruction');

  log('\n=== the informal quote ===');
  db.setSetting('business', { whatsappCountryCode: '27' });
  await openOrder('Sipho', 'Order');
  const modal = JSON.parse(await js(`(async () => {
    T.byText('button', 'Send informal quote').click(); await T.wait(1200);
    const m = document.querySelector('.modal');
    return JSON.stringify({ text: m?.innerText ?? '', message: m?.querySelector('.informal-message')?.textContent ?? '' });
  })()`));
  check(/\+27821112222/.test(modal.text), 'it goes to the client\'s WhatsApp, written the way wa.me needs it', modal.text.slice(0, 160));
  check(!/https?:\/\//.test(modal.message), 'with no link in it - the whole quote is in the message', modal.message.slice(0, 200));
  check(/Total: R10,550/.test(modal.message), 'and the whole order\'s total', modal.message);
  const before = opened.length;
  await js(`(async () => { T.byText('.modal button', 'Send by WhatsApp').click(); await T.wait(1200); return true; })()`);
  const wa = opened.slice(before).find((u) => u.startsWith('https://wa.me/'));
  check(!!wa && wa.startsWith('https://wa.me/27821112222?text='), 'WhatsApp opens on that number with the message written', String(wa).slice(0, 60));
  const sentText = wa ? decodeURIComponent(wa.split('?text=')[1]) : '';
  // This order has no renders, so the email's words and WhatsApp's are the same.
  check(sentText === modal.message, 'exactly the message that was shown');
  const record = db.getProject(order).informalQuote;
  check(record?.status === 'sent' && record?.via === 'whatsapp' && record?.total === WHOLE
    && record?.lines?.length > 0 && record?.basis?.length === record?.lines?.length,
    'it is recorded on the order: when, how, for how much, and the figures', JSON.stringify(record).slice(0, 200));

  // The answer, and the step to the formal quote.
  await openOrder('Sipho', 'Order');
  await js(`(async () => { T.byText('button', 'Client confirmed').click(); await T.wait(1000); return true; })()`);
  check(db.getProject(order).informalQuote?.status === 'confirmed', 'GD marks it confirmed');
  const toSummary = await js(`(async () => { T.byText('button', 'Make the formal quote').click(); await T.wait(1000);
    return document.querySelector('.step-tab.active')?.textContent ?? ''; })()`);
  check(/Summary/.test(toSummary), 'and goes straight on to the formal quote', toSummary);

  // Who it goes to is decided from the order, not the window.
  const minor = db.upsertClient({ name: 'Lwazi', surname: 'Dube', contact: '071 000 0000', isMinor: true,
    secondaryName: 'Zanele Dube', secondaryContact: '+27 83 444 5555', secondaryEmail: 'zanele@example.com' });
  const matric = db.createProject({ clientId: minor, title: 'Matric' });
  const toParent = await call('informal.preview', { projectId: matric });
  check(toParent.data?.guardian && toParent.data?.whatsapp === '27834445555' && toParent.data?.email === 'zanele@example.com',
    'an under-18 client\'s quote goes to the parent or provider', JSON.stringify(toParent));
  const smuggled = await call('informal.send', { projectId: matric, via: 'whatsapp', text: 'hello', to: '+15550000000', phone: '+15550000000',
    lines: [{ label: 'Suit', amount: 100, key: 'x' }], basis: [] });
  check(smuggled.data?.to === '+27834445555' && !opened.some((u) => u.includes('15550000000')),
    'a number passed from the window is ignored', JSON.stringify(smuggled));
  check(informal.whatsappNumber('082 111 2222') === '27821112222' && informal.whatsappNumber('0044 7700 900123') === '447700900123'
    && informal.whatsappNumber('12') === '', 'numbers are read the way they are written in South Africa and abroad');

  log('\n=== the summary ===');
  await openOrder('Sipho', 'Summary');
  const summary = await js(`document.querySelector('.content').innerText`);
  check(/Sipho Ndlovu - Groom/.test(summary) && /Thabo Mokoena - Best man/.test(summary), 'both suits are on the summary');
  const groomCard = await js(`[...document.querySelectorAll('.card')].find(c => c.querySelector('h3')?.textContent.includes('Groom'))?.innerText ?? ''`);
  const bestCard = await js(`[...document.querySelectorAll('.card')].find(c => c.querySelector('h3')?.textContent.includes('Best man'))?.innerText ?? ''`);
  check(/3-Piece/.test(groomCard) && /2-Piece/.test(bestCard), 'each with its own specification');
  check(/Waist[\s\S]*(100|39\.37)/.test(groomCard) && /Waist[\s\S]*(80|31\.5)/.test(bestCard) && !/(80 cm|31\.5 in)/.test(groomCard),
    'and its own measurements, not the other man\'s', `${groomCard.slice(-80)} || ${bestCard.slice(-80)}`);
  check(/Wedding · 14 Nov 2026/.test(summary), 'the occasion reads as words', summary.slice(0, 200));
  const orderCard = await js(`[...document.querySelectorAll('.card')].find(c => c.querySelector('h3')?.textContent === 'The order')?.innerText ?? ''`);
  check(!/^0$/m.test(orderCard), 'and nothing stray - a client who is not a minor leaves no "0" behind', JSON.stringify(orderCard.slice(0, 160)));
  check(/Total\s*R10,550/.test(summary), 'and the quote is the whole order');
  // The formal quote fixes the price before it goes.
  const mailBefore = opened.length;
  await js(`(async () => { T.byText('button', 'Email the formal quote').click(); await T.wait(700); return true; })()`);
  const fixModal = await js(`document.querySelector('.modal')?.innerText ?? ''`);
  check(/fixes the price at R10,550/.test(fixModal), 'sending the formal quote on a draft says it fixes the price first', fixModal.slice(0, 120));
  await js(`(async () => { T.byText('.modal button', 'Fix the price and send').click(); await T.wait(1800); return true; })()`);
  const fixed = db.getProject(order);
  check(fixed.status === 'quoted' && fixed.quote?.total === WHOLE, 'the order is Quoted at the whole order\'s figure',
    `${fixed.status} ${fixed.quote?.total}`);
  const mail = opened.slice(mailBefore).find((u) => u.startsWith('mailto:'));
  check(!!mail && /R10%2C550|R10,550/.test(mail), 'and the email carries that figure - it went without one before', String(mail).slice(0, 90));
  const body = mail ? decodeURIComponent(mail.split('body=')[1] ?? '') : '';
  check(/Sipho Ndlovu - Groom:\n\s+3-Piece suit/.test(body) && /Thabo Mokoena - Best man:\n\s+2-Piece suit/.test(body),
    'with each suit\'s lines under whose suit it is', body.slice(body.indexOf('Quote:'), body.indexOf('Quote:') + 160));

  log('\n=== the AI sanity check ===');
  secrets.set('gemini', 'TEST-KEY-FEEDBACK');
  db.setSetting('aiConfig', { customBaseUrl: '', image: { provider: 'gemini', model: 'gemini-3.6-flash-image' },
    vision: { provider: 'gemini', model: 'gemini-2.5-flash' } });
  check(registry.pickReadModel({ vision: [{ name: 'gemini-3.6-pro' }, { name: 'gemini-3.6-flash' }, { name: 'gemini-flash-latest' }, { name: 'gemini-3.7-flash-preview' }] }) === 'gemini-flash-latest',
    'a replacement read model is a current, stable, quick one');
  await openOrder('Sipho', 'Measurements');
  const aiFrom = aiCalls.length;
  const checkUi = await js(`(async () => {
    T.byText('button', 'AI sanity check').click();
    for (let i = 0; i < 40 && !document.body.innerText.includes('Narrow against'); i++) await T.wait(250);
    return document.body.innerText;
  })()`);
  const reads = aiCalls.slice(aiFrom).filter((c) => c.url.includes(':generateContent'));
  check(/Narrow against a 104 chest/.test(checkUi), 'the check comes back with its findings', checkUi.slice(-200));
  check(reads.length === 2 && reads[0].url.includes('gemini-2.5-flash:') && reads[1].url.includes('gemini-flash-latest:'),
    'a retired read model is swapped for a current one, and the check tried again', reads.map((r) => r.url.split('/models/')[1]).join(' then '));
  check(db.getSetting('aiConfig').vision.model === 'gemini-flash-latest', 'and the swap is kept for next time', JSON.stringify(db.getSetting('aiConfig').vision));
  const asked = reads[1]?.body?.contents?.[0]?.parts?.[0]?.text ?? '';
  check(/Trousers - Waist: 100 cm/.test(asked) && /Jacket - Chest \/ bust: 104 cm/.test(asked), 'it is asked about this suit, by the names on screen', asked.slice(0, 260));
  check(!/80 cm/.test(asked), 'and not about the best man\'s waist', asked);
  const again = aiCalls.length;
  await js(`(async () => { T.byText('button', 'AI sanity check').click(); await T.wait(1500); return true; })()`);
  check(aiCalls.slice(again).filter((c) => c.url.includes(':generateContent')).length === 1, 'the next check goes straight through');

  log('\n=== alterations follow the measurement list ===');
  const add = (arg) => call('alterations.add', { projectId: order, ...arg });
  const waist = () => db.getProject(order).measurements.find((m) => m.suit_id === groomSuit && m.field_id === 'pantWaist')?.value;
  let res = await add({ suitId: groomSuit, garment: 'pants', changes: [{ fieldId: 'pantWaist', label: 'Waist', change: -2 }], status: 'received' });
  const logged = db.getProject(order).alterations.find((a) => a.id === res.data);
  check(waist() === 98, 'taking the waist in 2cm changes the measurement to 98', String(waist()));
  check(logged?.changes?.[0]?.before === 100 && logged?.changes?.[0]?.after === 98, 'and the alteration keeps 100 -> 98', JSON.stringify(logged?.changes));
  check(db.listClientMeasurements(groom).find((m) => m.field_id === 'pantWaist')?.value === 98, 'the groom\'s body record follows');
  await call('alterations.update', { id: res.data, status: 'cancelled' });
  check(waist() === 100, 'cancelling puts it back', String(waist()));
  await call('alterations.update', { id: res.data, status: 'in_progress' });
  check(waist() === 98, 'un-cancelling applies it again', String(waist()));
  db.saveMeasurement({ projectId: order, suitId: groomSuit, garment: 'pants', fieldId: 'pantWaist', value: 97 });
  await call('alterations.delete', { id: res.data });
  check(waist() === 97, 'a figure changed since is not overwritten when the alteration goes', String(waist()));
  const other = db.createProject({ clientId: bestMan, title: 'Other order' });
  res = await call('alterations.add', { projectId: other, suitId: groomSuit, garment: 'pants', changes: [{ fieldId: 'pantWaist', change: -5 }] });
  check(/not on this order/.test(res.error ?? '') && waist() === 97, 'an alteration cannot reach a suit on another order', JSON.stringify(res));
  res = await add({ garment: 'shirt', changes: [{ fieldId: 'chest', change: 1 }] });
  check(/Only a jacket/.test(res.error ?? ''), 'a shirt has no measurements to change', JSON.stringify(res));

  await openOrder('Sipho', 'Fitting');
  const altUi = await js(`(async () => {
    T.byText('.alteration-form button', 'Trousers').click(); await T.wait(400);
    return [...document.querySelectorAll('.alteration-row')].map(r => r.firstElementChild.textContent).join(' | ');
  })()`);
  check(/^Length \(outside leg\) \| Waist \| Hip loop[^|]*\| Thigh loop \| Knee loop \| Bottom \| Crotch$/.test(altUi),
    'the form lays out the trouser measurements in the measurement list\'s order', altUi);

  log('\n=== the database sheet ===');
  db.updateProject(order, { comments: '' });
  const formula = db.upsertClient({ name: '=HYPERLINK("http://x")', surname: 'Test', contact: '', email: '' });
  db.createProject({ clientId: formula, title: 'Formula' });
  await reload();
  await js(`(async () => { T.byText('.nav-item', 'Database').click(); await T.wait(1200); return true; })()`);
  const sheet = JSON.parse(await js(`JSON.stringify({
    head: [...document.querySelectorAll('.db-table thead th')].map(t => t.textContent.trim()),
    row: [...[...document.querySelectorAll('.db-table tbody tr')].find(r => r.textContent.includes('Sipho')).querySelectorAll('td')].map(t => t.textContent.trim()),
  })`));
  check(['Client', 'Event date', 'Fabric', 'Code / colour', 'Design', 'Lining', 'Qty', 'Shirt', 'Balance due', 'Form', 'Printed', 'Quoted',
    'Contact', 'Appointment notes', 'First appointment', 'Comments'].every((h) => sheet.head.includes(h)),
  'the columns are the workbook\'s', sheet.head.join(' | '));
  check(sheet.row.some((c) => /3-Piece · Peak lapel/.test(c)), 'the design is read off the order\'s own specification', sheet.row.join(' | '));
  check(sheet.row.includes('R10,550'), 'and the quoted figure is the whole order');
  await js(`(async () => {
    const row = [...document.querySelectorAll('.db-table tbody tr')].find(r => r.textContent.includes('Sipho'));
    const cells = [...row.querySelectorAll('td')];
    const comments = cells[17].querySelector('.db-cell');
    comments.click(); await T.wait(200);
    const box = cells[17].querySelector('textarea');
    T.type(box, 'Collect on Friday');
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
    await T.wait(1200);
    return true;
  })()`);
  check(db.getProject(order).comments === 'Collect on Friday', 'a cell changed on the sheet changes the order', JSON.stringify(db.getProject(order).comments));
  await js(`(async () => { T.byText('button', 'Export to Excel').click(); await T.wait(1200); return true; })()`);
  const file = fs.readdirSync(OUT).find((f) => f.endsWith('.csv'));
  const text = file ? fs.readFileSync(path.join(OUT, file), 'utf8') : '';
  check(text.startsWith('﻿REF,CLIENT,EVENT DATE,FABRIC,CODE / COLOUR,DESIGN,LINING,QUANTITY,SHIRT,BALANCE DUE'),
    'the export opens in Excel with the workbook\'s headings', text.slice(0, 90));
  check(/Collect on Friday/.test(text) && /10550/.test(text), 'and the order as it now stands');
  check(text.includes(`"'=HYPERLINK(""http://x"") Test"`) && !/\n=HYPERLINK/.test(text),
    'a name that looks like a formula stays text in Excel', (text.match(/.*HYPERLINK.*/) || [''])[0]);
  check(csv.cell('-42') === '-42' && csv.cell('@SUM(A1)') === "'@SUM(A1)", 'numbers stay numbers; formulas do not');

  // Suit progress: an X moves the order, and moving it out of draft fixes the price.
  const draft = db.createProject({ clientId: bestMan, title: 'Progress' });
  db.updateSuit(db.primarySuitId(draft), { spec: { suitType: 'blazer_only' } });
  await reload();
  await js(`(async () => {
    T.byText('.nav-item', 'Database').click(); await T.wait(1000);
    T.byText('.step-tab', 'Suit progress').click(); await T.wait(600);
    // The newest of Thabo's orders - the sheet lists the most recently touched first.
    const row = [...document.querySelectorAll('.db-table tbody tr')].find(r => r.textContent.includes('Thabo'));
    row.querySelector('[aria-label$="First fitting"]').click(); await T.wait(1500);
    return true;
  })()`);
  const moved = db.getProject(draft);
  check(moved.status === 'ready_first_fitting' && moved.quote?.total === 3200, 'an X on the progress sheet moves the order and fixes its price',
    `${moved.status} ${moved.quote?.total}`);

  log('\n=== GD\'s own words for an option ===');
  const refused = await call('settings.set', { key: 'labelOverrides', value: { 'not a key!': { label: 'x' } } });
  check(/does not exist/.test(refused.error ?? ''), 'wording for something that is not an option is refused', JSON.stringify(refused));
  db.updateSuit(groomSuit, { spec: { suitType: 'three_piece', lapel: 'peak', jacketFit: 'medium' } });
  await reload();
  await js(`(async () => {
    T.byText('.nav-item', 'Settings').click(); await T.wait(900);
    T.byText('.step-tab', 'Price list').click(); await T.wait(600);
    [...document.querySelectorAll('.collapsible-head')].find(b => b.querySelector('.collapsible-title')?.textContent.trim() === 'Jacket')?.click(); await T.wait(500);
    const row = [...document.querySelectorAll('.measure-row')].find(r => r.textContent.startsWith('Fit - Medium'));
    [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'Rename').click(); await T.wait(300);
    T.type(row.querySelector('input[aria-label="Option name"]'), 'Regular');
    [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click(); await T.wait(1200);
    return true;
  })()`);
  check(db.getSetting('labelOverrides')?.['jacketFit:medium']?.label === 'Regular', 'renaming on the price list is stored', JSON.stringify(db.getSetting('labelOverrides')));
  await openOrder('Sipho', 'Jacket');
  const fit = await js(`[...document.querySelectorAll('.option.selected .option-label')].map(l => l.textContent.trim()).join(' | ')`);
  check(/Regular/.test(fit) && db.getProject(order).suits[0].spec.jacketFit === 'medium', 'the order shows the new word, and still holds the same choice', fit);

  fs.rmSync(OUT, { recursive: true, force: true });
  log(`\n${fail === 0 ? 'ALL FEEDBACK CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
