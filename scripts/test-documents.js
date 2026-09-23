/**
 * The documents that leave the shop: the quote email and the measurement form.
 *
 * Nothing is sent from the app. The draft opens in GD's own mail program and
 * he reads it before it goes, so what is checked here is that the right
 * address and the agreed figures reach that draft - and that a form saved to
 * the desktop is one file that still shows its pictures after being emailed.
 */
const { app, BrowserWindow, dialog, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
require('./fresh.js').freshUserData(app);

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-docs-'));
const opened = [];
shell.openExternal = async (url) => { opened.push(url); };
let nextSave = null;
dialog.showSaveDialog = async (_w, opts) => (nextSave === 'cancel'
  ? { canceled: true }
  : { canceled: false, filePath: path.join(OUT, path.basename(opts.defaultPath)) });

require('../electron/main.js');
const db = require('../electron/db.js');
const storage = require('../electron/storage.js');

let pass = 0, fail = 0;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  await wait(2400);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c);
  const call = (ch, arg) => js(`window.gd.${ch}(${JSON.stringify(arg)}).then(r => JSON.stringify(r.ok ? { data: r.data } : { error: r.error.message }))`).then(JSON.parse);

  const clientId = db.upsertClient({ name: 'Naledi', surname: 'Khumalo', contact: '082 111 2222', email: 'naledi@example.com' });
  const projectId = db.createProject({ clientId, title: 'Graduation suit', eventDate: '2026-12-05' });
  db.updateProject(projectId, { spec: { suitType: 'two_piece', lapel: 'peak' }, fabric_name: 'Slate flannel', fabric_code: 'S-3390' });
  db.setQuote(projectId, { lines: [
    { group: 'Base', label: '2-Piece suit', amount: 4500, key: 'b' },
    { group: 'Jacket', label: 'Lapel: Peak', amount: 250, key: 'l' },
  ], total: 4750, currency: 'R' });

  log('=== the quote, as a draft in GD’s own mail ===');
  const sent = await call('quote.email', { projectId });
  check(sent.data?.opened === true, 'a draft opens', JSON.stringify(sent));
  check(opened.length === 1 && opened[0].startsWith('mailto:'), 'as a mail link, not a web page', opened[0]?.slice(0, 30));
  const draft = decodeURIComponent(opened[0]);
  check(/naledi@example\.com/.test(draft), 'addressed to the client', draft.slice(0, 60));
  check(/R4,750/.test(draft), 'carrying the agreed total', (draft.match(/R[\d,]+/g) || []).join(' '));
  check(/R2,375/.test(draft), 'and the 50% deposit that starts the work');
  check(/Slate flannel/.test(draft), 'naming the cloth');
  check(/gareth@gdsuits\.co\.za/.test(draft), "and signed off with GD's details");
  check(/order form/i.test(draft), 'saying the order form follows separately');

  log('\n=== the wording is GD\u2019s, not the app\u2019s ===');
  const tpl = await call('quote.template', {});
  check(Array.isArray(tpl.data?.variables) && tpl.data.variables.length > 5,
    'the variables are listed for him', String(tpl.data?.variables?.length));
  check(/\{client_first\}/.test(tpl.data.template), 'and the default wording uses them');

  await call('settings.set', { key: 'quoteEmailSubject', value: 'Your {cloth} suit, {client_first}' });
  await call('settings.set', { key: 'quoteEmailTemplate', value:
    'Dear {client_name},\n\nYour order {order_ref} comes to {total}, with {deposit} to start.\n{event_line}\n\n{gd_name}\n{not_a_real_one}' });
  opened.length = 0;
  await call('quote.email', { projectId });
  const custom = decodeURIComponent(opened[0]);
  check(/Dear Naledi Khumalo/.test(custom), 'his wording is what goes out', custom.slice(custom.indexOf('body=') + 5, custom.indexOf('body=') + 40));
  check(/comes to R4,750, with R2,375 to start/.test(custom), 'with the figures filled in');
  check(/subject=Your%20Slate%20flannel/.test(opened[0]) || /Your Slate flannel suit, Naledi/.test(custom),
    'and his subject line too', opened[0].slice(0, 90));
  check(/\{not_a_real_one\}/.test(custom),
    'a placeholder the app does not know is left in plain sight, not dropped');

  // Back to the original so the rest of the run reads normally.
  await call('settings.set', { key: 'quoteEmailTemplate', value: tpl.data.defaults.template });
  await call('settings.set', { key: 'quoteEmailSubject', value: tpl.data.defaults.subject });
  opened.length = 0;
  await call('quote.email', { projectId });
  check(/Thank you for coming in/.test(decodeURIComponent(opened[0])), 'and it can be put back');

  log('\n=== a client with no email ===');
  const noMail = db.upsertClient({ name: 'Walk', surname: 'In' });
  const noMailProject = db.createProject({ clientId: noMail, title: 'Walk-in' });
  const refused = await call('quote.email', { projectId: noMailProject });
  check(/email address/i.test(refused.error ?? ''), 'is refused with a reason a tailor can act on', JSON.stringify(refused));
  check(opened.length === 1, 'and no draft is opened', String(opened.length));

  log('\n=== the details of the shop belong to the shop ===');
  const shop = await call('business.get', {});
  check(shop.data?.email === 'gareth@gdsuits.co.za', 'they start as what was hardcoded', JSON.stringify(shop.data?.email));
  check(shop.data?.depositFraction === 0.5, 'including the deposit rule', String(shop.data?.depositFraction));

  await call('settings.set', { key: 'business', value: {
    ...shop.data, name: 'G. Duncan', phone: '021 000 0000', email: 'orders@gdsuits.co.za',
    depositFraction: 0.4, terms: ['Half up front.', 'No refunds on deposits.'],
  } });
  opened.length = 0;
  await call('quote.email', { projectId });
  const signed = decodeURIComponent(opened[0]);
  check(/G\. Duncan/.test(signed), 'a changed name signs the quote', signed.slice(-90));
  check(/orders@gdsuits\.co\.za/.test(signed), 'and a changed address');
  check(/Deposit to start \(40%\): R1,900/.test(signed), 'a changed deposit changes what is asked for', (signed.match(/Deposit[^\n]*/) || [''])[0]);

  // The dashboard checks orders against the same number.
  db.addPayment({ project_id: projectId, kind: 'deposit', amount: 1800, paid_on: '', method: '', reference: '', note: '' });
  db.updateProject(projectId, { status: 'in_production' });
  const short = db.analytics().depositShortfall.find((o) => o.id === projectId);
  check(!!short && Math.round(short.shortfall) === 100,
    'and the Business page flags the shortfall against it, not against 50%', JSON.stringify(short?.shortfall));

  const nonsense = await call('settings.set', { key: 'business', value: { ...shop.data, depositFraction: 7 } });
  const afterNonsense = await call('business.get', {});
  check(afterNonsense.data?.depositFraction === 0.5,
    'a deposit of 700% is a typo, and is refused rather than stored', String(afterNonsense.data?.depositFraction));

  await call('settings.set', { key: 'business', value: shop.data });

  log('\n=== keys stay masked ===');
  win.webContents.reload(); await wait(2200);
  const masked = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Settings')).click(); await wait(1500);
    const secrets = [...document.querySelectorAll('.secret-field input')];
    const reveal0 = [...document.querySelectorAll('.secret-reveal')];
    // The shop's own details live on their own page, not under the price list.
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Your business'))?.click();
    await wait(1200);
    const reveals = reveal0;
    const shopFields = [...document.querySelectorAll('.field label')].map(l => l.textContent.trim());
    return JSON.stringify({
      secretCount: secrets.length,
      allPassword: secrets.every(i => i.type === 'password'),
      reveals: reveals.length,
      hasShop: shopFields.includes('Telephone') && shopFields.includes('Deposit before cutting'),
      hasTerms: shopFields.includes('Terms and conditions'),
    });
  })()`));
  check(masked.secretCount > 0 && masked.allPassword, 'every key is hidden until asked for', JSON.stringify(masked));
  check(masked.reveals === masked.secretCount, 'each with an eye to show it', JSON.stringify(masked));
  check(masked.hasShop, 'the shop details are editable in Settings', JSON.stringify(masked));
  check(masked.hasTerms, 'terms included');

  log('\n=== the measurement form is one file ===');
  const scope = storage.scopeForProject(projectId);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const file = storage.saveImage(scope, png, 'image/png', 'front');
  const html = `<html><body><img src="gdmedia://media/${scope}/${file}"><img src="gdmedia://media/${scope}/missing.png"></body></html>`;
  nextSave = null;
  const saved = await call('forms.save', { projectId, html, name: 'Naledi Khumalo measurement form' });
  check(saved.data?.saved === true, 'it saves', JSON.stringify(saved));
  const written = fs.readFileSync(path.join(OUT, saved.data.name), 'utf8');
  check(!/gdmedia:\/\//.test(written), 'with no link back into the app left in it');
  check(/data:image\/png;base64,/.test(written), 'the picture travels inside the file');
  check(!/src="missing/.test(written), 'and a picture that is gone leaves no broken frame');

  nextSave = 'cancel';
  const before = fs.readdirSync(OUT).length;
  const cancelled = await call('forms.save', { projectId, html, name: 'x' });
  check(cancelled.data?.saved === false && fs.readdirSync(OUT).length === before, 'cancelling writes nothing');
  nextSave = null;

  log('\n=== the form is reachable from the measurements page ===');
  win.webContents.reload(); await wait(2200);
  const ui = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes('Naledi')).click(); await wait(1100);
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Measurements')).click(); await wait(900);
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Measurement form'));
    btn?.click(); await wait(1600);
    return JSON.stringify({ hadButton: !!btn });
  })()`));
  check(ui.hadButton, 'the button is there');
  const forms = fs.readdirSync(OUT).filter((f) => /measurement-form|Naledi/i.test(f));
  check(forms.length >= 1, 'and clicking it writes a form', forms.join(', '));

  fs.rmSync(OUT, { recursive: true, force: true });
  log(`\n${fail === 0 ? 'ALL DOCUMENT CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
