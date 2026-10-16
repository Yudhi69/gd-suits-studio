/**
 * Launches of an installed copy that is not the newest.
 *
 * A package sent out a few versions ago should bring its owner up to date the
 * first time he opens it with a connection - and not before. After that it
 * goes on looking each time it opens, unless he turns that off, and puts each
 * new version in front of him once rather than on every launch. Never in a
 * development build or a test run, which would otherwise go out to GitHub on
 * every launch.
 *
 * Runs as an installed copy would, via GD_TEST_FIRST_RUN in its npm script.
 * The feed, the download and the file manager are all stubbed: nothing here
 * touches the network or opens a window.
 */
const { app, BrowserWindow, shell } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
require('./fresh.js').freshUserData(app);

const DOWNLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-first-run-'));
app.setPath('downloads', DOWNLOADS);

const revealed = [];
shell.showItemInFolder = (target) => { revealed.push(String(target)); };

const INSTALLED = require('../package.json').version;
const bump = (v, by) => { const p = v.split('.').map(Number); p[p.length - 1] += by; return p.join('.'); };
const NEWER = bump(INSTALLED, 1);
const NEWEST = bump(INSTALLED, 2);
const INSTALLER = Buffer.alloc(48 * 1024, 5);

// 'offline' - the feed cannot be reached. 'newer' / 'newest' / 'same' - it answers.
let mode = 'offline';
let feedCalls = 0;
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('api.github.com')) {
    feedCalls++;
    if (mode === 'offline') throw new TypeError('fetch failed');
    const version = { newer: NEWER, newest: NEWEST }[mode] ?? INSTALLED;
    return new Response(JSON.stringify({
      tag_name: `v${version}`, body: 'Status pills on one line.', draft: false,
      html_url: `https://github.com/Yudhi69/gd-suits-studio/releases/tag/v${version}`,
      assets: ['arm64.dmg', '.dmg', 'exe'].map((k) => ({
        name: k === 'exe' ? `GD Suits Studio Setup ${version}.exe` : k === 'arm64.dmg' ? `GD Suits Studio-${version}-arm64.dmg` : `GD Suits Studio-${version}.dmg`,
        size: INSTALLER.length,
        browser_download_url: `https://github.com/Yudhi69/gd-suits-studio/releases/download/v${version}/${k}`,
      })),
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (u.startsWith('https://github.com/')) {
    const res = new Response(INSTALLER, {
      status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': String(INSTALLER.length) },
    });
    Object.defineProperty(res, 'url', { value: u });
    return res;
  }
  throw new Error(`unexpected request in a test: ${u}`);
};

require('../electron/main.js');
const db = require('../electron/db.js');

let pass = 0, fail = 0;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  await wait(2400);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c);
  const relaunch = async () => { win.webContents.reload(); await wait(2600); };
  const flag = () => js(`document.querySelector('.update-flag')?.textContent ?? ''`);
  // Reads the "Check automatically on launch" switch the way he would find it,
  // pressing it first if asked.
  const autoSwitch = ({ click = false } = {}) => js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const pick = (sel, t) => [...document.querySelectorAll(sel)].find(b => b.textContent.includes(t));
    pick('.nav-item', 'Orders').click(); await wait(300);
    pick('.nav-item', 'Settings').click(); await wait(700);
    pick('.step-tab', 'Updates').click(); await wait(400);
    pick('.collapsible-head', 'Where updates come from').click(); await wait(300);
    const sw = () => pick('.toggle-row', 'Check automatically on launch')?.querySelector('[role=switch]');
    if (${click}) { sw()?.click(); await wait(400); }
    return sw()?.getAttribute('aria-checked') ?? 'missing';
  })()`);
  const prompt = () => js(`(() => {
    const m = [...document.querySelectorAll('.modal-backdrop')]
      .find(el => el.textContent.includes('A newer version is available'));
    return JSON.stringify(m ? { shown: true, text: m.textContent.replace(/\\s+/g, ' ').trim() } : { shown: false });
  })()`).then(JSON.parse);

  log('=== first launch with no signal ===');
  // The window opened before the stubs mattered; launch again as a first run.
  db.setSetting('updatesLastChecked', null);
  mode = 'offline';
  feedCalls = 0;
  await relaunch();
  let p = await prompt();
  check(feedCalls >= 1, 'it tries to find out', String(feedCalls));
  check(!p.shown, 'finds nothing, and says nothing');
  check(!db.getSetting('updatesLastChecked', null), 'and does not count that as its first check');

  log('\n=== first launch with a connection, a version behind ===');
  mode = 'newer';
  await relaunch();
  p = await prompt();
  check(p.shown, 'it says a newer version is available, straight away');
  check(p.text?.includes(`This copy is version ${INSTALLED}`) && p.text.includes(`The current version is ${NEWER}`),
    'naming the version he has and the one that is current', p.text?.slice(0, 140));
  check(!!db.getSetting('updatesLastChecked', null), 'and that was its first check');

  log('\n=== fetching it ===');
  const got = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const find = t => [...document.querySelectorAll('.modal-backdrop button')].find(b => b.textContent.trim().startsWith(t));
    find(${JSON.stringify('Download ' + NEWER)})?.click();
    await wait(1500);
    const show = find('Show in Finder') ?? find('Show in folder');
    const saved = [...document.querySelectorAll('.modal-backdrop')].map(m => m.textContent).join(' ');
    show?.click();
    await wait(400);
    return JSON.stringify({ show: !!show, savedTo: /Saved to your Downloads folder/.test(saved),
      explains: /drag the app into Applications|follow the installer/.test(saved) });
  })()`));
  const files = fs.readdirSync(DOWNLOADS);
  check(files.length === 1 && fs.readFileSync(path.join(DOWNLOADS, files[0])).equals(INSTALLER),
    'one press downloads the current version into Downloads', files.join(', '));
  check(got.savedTo && got.explains, 'and it says where it went, and what the last step is', JSON.stringify(got));
  check(got.show && revealed.some((r) => r.startsWith(DOWNLOADS)),
    'and shows him the file', JSON.stringify(revealed));
  check((fs.statSync(path.join(DOWNLOADS, files[0])).mode & 0o111) === 0,
    'which the app has not made runnable - installing it is his step');

  log('\n=== the next launch ===');
  feedCalls = 0;
  await relaunch();
  p = await prompt();
  check(feedCalls >= 1, 'it looks again - checking as it opens is on unless he turns it off', String(feedCalls));
  check(!p.shown, 'but does not put the same version in front of him a second time');
  check((await flag()).includes(NEWER), 'the flag in the corner still says it is there', await flag());
  check(await autoSwitch() === 'true', 'and Settings shows the check as on, though he never turned it on');

  log('\n=== a version he has not been shown ===');
  mode = 'newest';
  await relaunch();
  p = await prompt();
  check(p.shown && p.text.includes(`The current version is ${NEWEST}`), 'is put in front of him', p.text?.slice(0, 140));
  await relaunch();
  p = await prompt();
  check(!p.shown, '  once');

  log('\n=== turned off in Settings ===');
  check(await autoSwitch({ click: true }) === 'false', 'the switch turns it off');
  check(db.getSetting('autoCheckUpdates', null) === false, '  and that is saved');
  feedCalls = 0;
  await relaunch();
  p = await prompt();
  check(feedCalls === 0 && !p.shown, 'after which it does not look as it opens', String(feedCalls));
  check(await autoSwitch() === 'false', '  and Settings still shows it off');
  db.setSetting('autoCheckUpdates', null);

  log('\n=== first launch of a copy that is already current ===');
  db.setSetting('updatesLastChecked', null);
  mode = 'same';
  await relaunch();
  p = await prompt();
  check(!p.shown, 'nothing to say');
  check(!!db.getSetting('updatesLastChecked', null), 'and it has had its first check');

  log('\n=== a development build, or a test run ===');
  delete process.env.GD_TEST_FIRST_RUN;
  db.setSetting('updatesLastChecked', null);
  db.setSetting('updatePrompted', null);
  mode = 'newer';
  feedCalls = 0;
  await relaunch();
  p = await prompt();
  check(feedCalls === 0, 'never goes out to GitHub on launch', String(feedCalls));
  check(!p.shown, 'and never puts a prompt over what it is doing');
  db.setSetting('autoCheckUpdates', true);
  await relaunch();
  p = await prompt();
  check(feedCalls >= 1 && !p.shown, 'turned on by hand, it looks - and still never prompts', String(feedCalls));

  log('\n=== what a page cannot do ===');
  const r = await js(`gd.settings.set({ key: 'updatePrompted', value: null }).then(JSON.stringify)`).then(JSON.parse);
  check(!r.ok, 'it cannot make a version it has been shown come back as a prompt', JSON.stringify(r));

  fs.rmSync(DOWNLOADS, { recursive: true, force: true });
  log(`\n${fail === 0 ? 'ALL FIRST-RUN CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
