/**
 * Where the shop's data may go.
 *
 * The checks that matter are the ones about refusal: that nothing is ready
 * until the shop has said so, that turning the gate off stops every service at
 * once without losing what it configured, and that a key never comes back
 * across the bridge - only whether one is saved.
 */
const { app, BrowserWindow } = require('electron');
require('./fresh.js').freshUserData(app);

// Ready means ready to write, and Sheets writes a few seconds after a change.
// Nothing here may reach the internet, so every request is caught and counted.
const sent = [];
global.fetch = async (url) => { sent.push(String(url)); throw new Error('no network in this test'); };

require('../electron/main.js');
const integrations = require('../electron/integrations.js');
const secrets = require('../electron/secrets.js');
const db = require('../electron/db.js');

let pass = 0, fail = 0;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  await wait(2400);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c);
  const call = (ch, arg) => js(`window.gd.${ch}(${JSON.stringify(arg ?? {})}).then(r => JSON.stringify(r.ok ? { data: r.data } : { error: r.error.message }))`).then(JSON.parse);

  log('=== nothing leaves until the shop says so ===');
  let state = (await call('connections.get')).data;
  check(state.config.consent === false, 'the gate starts shut');
  check(integrations.SERVICES.every((s) => state.status[s].ready === false),
    'and every service reports itself not connected',
    JSON.stringify(Object.fromEntries(integrations.SERVICES.map((s) => [s, state.status[s].ready]))));
  check(state.config.gmail.method === 'draft', 'mail starts as a draft, which sends nothing');

  // Everything configured, gate still shut: still refuses. The account token
  // and the spreadsheet come from linking and from the app making one, never
  // from a page, so they are put in place here the way the app itself would.
  await call('connections.set', {
    gmail: { method: 'gmail', address: 'studio@example.com' },
    sheets: { enabled: true },
    drive: { enabled: true, photosFolderId: 'B'.repeat(30) },
  });
  await call('secrets.set', { name: 'gmailAppPassword', value: 'abcd efgh ijkl mnop' });
  await call('secrets.set', { name: 'googleClientId', value: 'x.apps.googleusercontent.com' });
  await call('secrets.set', { name: 'googleClientSecret', value: 'a-secret' });
  secrets.set('googleRefreshToken', 'a-token');
  db.setSetting('sheetsSpreadsheet', 'A'.repeat(30));

  state = (await call('connections.get')).data;
  check(integrations.SERVICES.every((s) => state.status[s].ready === false),
    'fully configured but not consented, every service still refuses',
    JSON.stringify(Object.fromEntries(integrations.SERVICES.map((s) => [s, state.status[s].why]))));
  check(integrations.SERVICES.every((s) => /switched off/i.test(state.status[s].why)),
    'and each says it is the gate, not the settings', JSON.stringify(state.status.sheets.why));

  log('\n=== and stops again the moment it is withdrawn ===');
  state = (await call('connections.set', { consent: true })).data;
  check(integrations.SERVICES.every((s) => state.status[s].ready === true),
    'consented, all three are ready',
    JSON.stringify(Object.fromEntries(integrations.SERVICES.map((s) => [s, state.status[s].why]))));

  state = (await call('connections.set', { consent: false })).data;
  check(integrations.SERVICES.every((s) => state.status[s].ready === false), 'withdrawn, all three stop');
  check(state.config.sheets.spreadsheetId.length === 30 && state.config.gmail.address === 'studio@example.com',
    'and nothing the shop configured was thrown away');

  log('\n=== a key is never handed back ===');
  const raw = await js(`window.gd.connections.get().then(r => JSON.stringify(r))`);
  check(!raw.includes('abcd efgh'), 'the app password does not cross the bridge');
  check(!raw.includes('a-secret') && !raw.includes('a-token'),
    'nor the client secret, nor the account token');
  check(state.secrets.gmailAppPassword.present === true, 'only that one is saved');

  log('\n=== what a hostile page gets ===');
  const bad = await call('connections.test', { service: '../../etc/passwd' });
  check(!!bad.error, 'a service that does not exist is refused', JSON.stringify(bad.data));

  await call('connections.set', {
    gmail: { method: 'carrier pigeon', address: 'not-an-address' },
    sheets: { enabled: true, spreadsheetId: '../../../etc', when: 'always' },
    drive: { enabled: true, photosFolderId: 'javascript:alert(1)' },
  });
  state = (await call('connections.get')).data;
  check(state.config.gmail.method === 'draft', 'an unknown way of sending falls back to the draft');
  check(state.config.gmail.address === '', 'an address that is not an address is dropped');
  check(state.config.sheets.spreadsheetId === 'A'.repeat(30),
    'a spreadsheet id from a page is ignored, and the one the app made is kept', state.config.sheets.spreadsheetId);
  check(state.config.sheets.when === 'manual', 'and an unknown moment to write falls back');
  check(state.config.drive.photosFolderId === '', 'a folder id that is a javascript: url is dropped');

  log('\n=== pasting the link, because nobody copies the id ===');
  await call('connections.set', {
    sheets: { enabled: true, spreadsheetId: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit#gid=0' },
    drive: { enabled: true, photosFolderId: 'https://drive.google.com/drive/folders/1ZyXwVuTsRqPoNmLkJiHgFeDcBa98765' },
  });
  state = (await call('connections.get')).data;
  check(state.config.drive.photosFolderId === '1ZyXwVuTsRqPoNmLkJiHgFeDcBa98765',
    'the id is taken out of a folder link', state.config.drive.photosFolderId);
  check(state.config.sheets.spreadsheetId === 'A'.repeat(30),
    'while a pasted spreadsheet link is not taken: the app writes only to the one it made', state.config.sheets.spreadsheetId);

  log('\n=== the page the shop actually uses ===');
  win.webContents.reload(); await wait(2400);
  const ui = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Settings')).click(); await wait(900);
    const tab = [...document.querySelectorAll('.step-tab')].find(t => t.textContent.trim() === 'Connections');
    if (!tab) return JSON.stringify({ tab: false });
    tab.click(); await wait(700);
    const headings = [...document.querySelectorAll('.card-head h3')].map(h => h.textContent.trim());
    // The Google details sit behind a disclosure, and the app password only
    // appears once sending through Gmail is chosen.
    const summary = [...document.querySelectorAll('.collapsible-head, summary, .collapsible button, button')]
      .find(e => e.textContent.includes('Google account details'));
    summary?.click(); await wait(400);
    const secretFields = [...document.querySelectorAll('input[type="password"]')].length;
    const reveals = document.querySelectorAll('.secret-reveal').length;
    return JSON.stringify({ tab: true, headings, secretFields, reveals,
      dimmed: document.querySelectorAll('.card-dim').length });
  })()`));
  check(ui.tab, 'Settings has a page for connections');
  check(['Gmail', 'Google Sheets', 'Google Drive'].every((h) => (ui.headings ?? []).includes(h)),
    'with all three on it', JSON.stringify(ui.headings));
  check(ui.secretFields >= 1 && ui.reveals >= 1,
    'and every key on it is hidden behind a reveal', JSON.stringify({ f: ui.secretFields, r: ui.reveals }));
  check(ui.dimmed >= 3, 'the three are dimmed while the gate is shut', String(ui.dimmed));
  check(sent.length === 0, 'and nothing in all of this reached the internet', JSON.stringify(sent));

  log(`\n${fail === 0 ? 'ALL CONNECTION CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
