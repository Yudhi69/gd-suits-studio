/**
 * An update that installs itself.
 *
 * One press of "Update to x.y.z" downloads the release, checks it, puts it in
 * place of the running copy and reopens the app on it - once any render or
 * email still under way has finished. This suite builds real (tiny) app
 * bundles and disk images, signed with a throwaway certificate the way
 * releases are signed with the real one, so the unpacking, the signature
 * check and the swap itself all run for real, against folders of the suite's
 * own. Nothing in Applications is touched.
 *
 * Two things are stubbed: the network (the release feed, its file and the
 * image model) and the final hand-over - the helper is recorded rather than
 * started, then run here against a stand-in process, because the real one
 * waits for this process to exit. Runs as an installed copy for its first-run
 * prompt, via GD_TEST_FIRST_RUN in its npm script.
 *
 * It runs as two launches. A process hands an update over once, so quitting
 * while an update waits for a render is a short pass of its own
 * (GD_INSTALL_PASS=quit), which opens as the launch after an update that went
 * in. The full pass opens as the launch after one that did not.
 *
 * macOS only: the swap it tests is the Mac one. On Windows the release's own
 * installer does the work, and that cannot be run from here.
 */
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (process.platform !== 'darwin') {
  process.stdout.write('install suite: macOS only, skipped\n');
  process.exit(0);
}

const dataDir = require('./fresh.js').freshUserData(app);
const UPDATES = path.join(dataDir, 'updates');
const QUIT_PASS = process.env.GD_INSTALL_PASS === 'quit';

const DOWNLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-install-dl-'));
app.setPath('downloads', DOWNLOADS);
shell.showItemInFolder = () => {};

const INSTALLED = require('../package.json').version;
const ahead = (by) => { const p = INSTALLED.split('.').map(Number); p[p.length - 1] += by; return p.join('.'); };
const NEWER = ahead(1);
const LATER = ahead(2);   // the one an earlier copy failed to put in place
const APP_ID = require('../package.json').build.appId;
const BUNDLE = 'GD Suits Studio.app';

/* ------------------------------------------------------------ fixtures */

const WORK = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gd-install-')));
const sh = (file, args) => childProcess.execFileSync(file, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
// Electron's own fs reads an app.asar as a folder and cannot remove one, so
// the suite clears its bundles with the plain fs - as the app now does.
const plainFs = require('original-fs');

/**
 * A real (tiny) app.asar, the archive every build of the app carries in
 * Contents/Resources. Without one, a fixture bundle is a shape the app never
 * meets - and a clean-up that fails on every real bundle passes on it.
 */
function asarArchive(file) {
  const body = Buffer.from('module.exports = 1;\n');
  const header = Buffer.from(JSON.stringify({ files: { 'index.js': { size: body.length, offset: '0' } } }));
  const padded = Math.ceil(header.length / 4) * 4;
  // Two Chromium pickles: one holding the header's size, then the header as a string.
  const pickle = Buffer.alloc(8 + padded);
  pickle.writeUInt32LE(4 + padded, 0);
  pickle.writeUInt32LE(header.length, 4);
  header.copy(pickle, 8);
  const size = Buffer.alloc(8);
  size.writeUInt32LE(4, 0);
  size.writeUInt32LE(pickle.length, 4);
  plainFs.writeFileSync(file, Buffer.concat([size, pickle, body]));
}

// The certificate this suite's releases are signed with, standing in for the
// project's own - and someone else's. The app is told to trust the first the
// way main lets a test do it, only outside an installed copy.
const { throwawaySigner } = require('./signer.js');
const OURS = throwawaySigner(WORK, 'GD Install Suite');
const THEIRS = throwawaySigner(WORK, 'Somebody Else');
process.env.GD_TEST_SIGNER = OURS.sha1;

/** A small app bundle with an app.asar, signed as a release is - or as `signer` says (null: ad hoc). */
function fakeApp(dir, { id = APP_ID, version, tamper = false, name = BUNDLE, signer = OURS } = {}) {
  const bundle = path.join(dir, name);
  fs.mkdirSync(path.join(bundle, 'Contents', 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(bundle, 'Contents', 'Resources'), { recursive: true });
  fs.writeFileSync(path.join(bundle, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${id}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleExecutable</key><string>GD Suits Studio</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`);
  fs.writeFileSync(path.join(bundle, 'Contents', 'MacOS', 'GD Suits Studio'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bundle, 'Contents', 'Resources', 'version.txt'), version);
  asarArchive(path.join(bundle, 'Contents', 'Resources', 'app.asar'));
  sh('/usr/bin/codesign', ['--force', '--deep', ...(signer ? signer.args : ['--sign', '-']), bundle]);
  if (tamper) fs.writeFileSync(path.join(bundle, 'Contents', 'Resources', 'version.txt'), 'changed after signing');
  return bundle;
}
const versionOf = (bundle) => {
  try { return fs.readFileSync(path.join(bundle, 'Contents', 'Resources', 'version.txt'), 'utf8'); } catch { return null; }
};

// The contents of each disk image, laid out as electron-builder lays out the
// real one: the app, and a shortcut to Applications beside it.
const IMAGES = {
  good: (d) => fakeApp(d, { version: NEWER }),
  wrongApp: (d) => fakeApp(d, { version: NEWER, id: 'com.example.other' }),
  wrongVersion: (d) => fakeApp(d, { version: INSTALLED }),
  tampered: (d) => fakeApp(d, { version: NEWER, tamper: true }),
  adHoc: (d) => fakeApp(d, { version: NEWER, signer: null }),
  theirs: (d) => fakeApp(d, { version: NEWER, signer: THEIRS }),
  linked: (d) => { fakeApp(path.join(WORK, 'elsewhere'), { version: NEWER }); fs.symlinkSync(path.join(WORK, 'elsewhere', BUNDLE), path.join(d, BUNDLE)); },
  twoApps: (d) => { fakeApp(d, { version: NEWER }); fakeApp(d, { version: NEWER, name: 'Second.app' }); },
};
const dmg = {};
const builds = [];
for (const [key, fill] of Object.entries(IMAGES)) {
  if (QUIT_PASS && key !== 'good') continue;
  const src = path.join(WORK, 'src', key);
  fs.mkdirSync(src, { recursive: true });
  fill(src);
  fs.symlinkSync('/Applications', path.join(src, 'Applications'));
  dmg[key] = path.join(WORK, `${key}.dmg`);
  builds.push(`/usr/bin/hdiutil create -quiet -fs HFS+ -format UDZO -volname "GD Suits Studio" -srcfolder "${src}" -ov "${dmg[key]}" &`);
}
// Built side by side - each takes a few seconds on its own.
sh('/bin/sh', ['-c', `${builds.join('\n')}\nwait`]);
dmg.notAnImage = path.join(WORK, 'notAnImage.dmg');
fs.writeFileSync(dmg.notAnImage, crypto.randomBytes(4096));

const GOOD = fs.readFileSync(dmg.good);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// The copy that is "installed" - an old version, somewhere of the suite's own.
const INSTALL_DIR = path.join(WORK, 'Applications');
const TARGET = fakeApp(INSTALL_DIR, { version: INSTALLED });
process.env.GD_TEST_INSTALL_TARGET = TARGET;

/* ------------------------------------------------------------- the network */

const OFFICIAL_FEED = 'https://api.github.com/repos/Yudhi69/gd-suits-studio/releases/latest';
const fileUrl = (name) =>
  `https://github.com/Yudhi69/gd-suits-studio/releases/download/v${NEWER}/${name.replace(/ /g, '.')}`;
let served = GOOD;           // the bytes the file host hands back
let digest = `sha256:${sha(GOOD)}`;
let feedCalls = 0;
// The image model, for a render still going when Update is pressed: held open
// until the suite lets it answer.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC';
let rendersAsked = 0;
let held = null;
const holdRenders = () => {
  let release;
  held = new Promise((resolve) => { release = resolve; });
  return () => { held = null; release(); };
};
global.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith('https://generativelanguage.googleapis.com/')) {
    rendersAsked++;
    await held;
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG } }] }, finishReason: 'STOP' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (u.startsWith('https://api.github.com/')) {
    feedCalls++;
    const names = [`GD Suits Studio-${NEWER}-arm64.dmg`, `GD Suits Studio-${NEWER}.dmg`, `GD Suits Studio Setup ${NEWER}.exe`];
    return new Response(JSON.stringify({
      tag_name: `v${NEWER}`, body: 'Installs itself.', draft: false, prerelease: false,
      html_url: `https://github.com/Yudhi69/gd-suits-studio/releases/tag/v${NEWER}`,
      published_at: '2026-10-16T10:00:00Z',
      assets: names.map((name) => ({
        name, size: served.length, ...(digest ? { digest } : {}), browser_download_url: fileUrl(name),
      })),
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (u.startsWith('https://github.com/')) {
    const res = new Response(served, {
      status: 200, headers: { 'content-type': 'application/octet-stream', 'content-length': String(served.length) },
    });
    Object.defineProperty(res, 'url', { value: u });
    return res;
  }
  throw new Error(`unexpected request in a test: ${u}`);
};

/* ------------------------------------------------------- the hand-over */

// Recorded rather than run: the real helper would wait for this process to
// exit. Everything else that spawns goes through untouched.
const realSpawn = childProcess.spawn;
const handed = [];
childProcess.spawn = (file, args, opts) => {
  if (file === '/bin/sh' && args?.[0] === '-c' && /gd-suits-update/.test(String(args[1]))) {
    handed.push(args);
    return { unref() {} };
  }
  return realSpawn(file, args, opts);
};
let quits = 0;
const realQuit = app.quit.bind(app);
app.quit = () => { quits++; };

// Every update call the page makes, and what it got back - printed when the
// first-launch prompt is not what it should be, so a failure there says
// whether the page was told the update was ready, or decided so itself.
const calls = [];
const realHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) => realHandle(channel, async (...args) => {
  const out = await fn(...args);
  if (channel.startsWith('updates:')) {
    const d = out?.data;
    calls.push({ channel, at: Date.now() - started, ok: out?.ok, version: d?.version, ready: d?.ready, prompt: d?.prompt,
      canInstall: d?.canInstall, staged: require('../electron/db.js').getSetting('updateStaged', null)?.version ?? null,
      error: out?.error?.code });
  }
  return out;
});
const started = Date.now();

// Opens as the launch after an update was handed over: what the copy before
// left behind, written before main opens the database. The full pass follows
// one that could not be put in place; the quit pass, one that went in.
const db = require('../electron/db.js');
const SETTLED = QUIT_PASS
  ? { version: INSTALLED, result: 'installed' }
  : { version: LATER, result: 'failed: could not move the new copy into place' };
{
  const seeded = db.open(dataDir);
  db.setSetting('updateStaged', {
    version: SETTLED.version, platform: 'darwin', path: path.join(UPDATES, SETTLED.version, 'staged', BUNDLE), sha256: '',
    applying: Date.now() - 60 * 1000,
  });
  seeded.close();
  fs.mkdirSync(UPDATES, { recursive: true });
  fs.writeFileSync(path.join(UPDATES, 'install.result'), `${SETTLED.result}\n`);
  // A swap that went in takes the app it made ready with it. One that failed
  // leaves that whole app where it was staged - and a copy left like that
  // used to stop every later update at "ENOTDIR ... app.asar".
  if (!QUIT_PASS) fakeApp(path.join(UPDATES, SETTLED.version, 'staged'), { version: SETTLED.version });
}

const beforeMain = app.listeners('will-quit');
require('../electron/main.js');
const onQuit = app.listeners('will-quit').filter((l) => !beforeMain.includes(l));
const installer = require('../electron/installer.js');
const updater = require('../electron/updater.js');
const secrets = require('../electron/secrets.js');

const log = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(150); }
  return fn();
};
// Also run when the suite stops part-way, so a failing run leaves nothing in
// the temp folder - including the folder it locks to test an unwritable one.
function cleanUp() {
  OURS.remove();
  THEIRS.remove();
  try { sh('/bin/chmod', ['-R', 'u+w', WORK]); } catch { /* already gone */ }
  plainFs.rmSync(WORK, { recursive: true, force: true });
  plainFs.rmSync(DOWNLOADS, { recursive: true, force: true });
}
const leftovers = (dir) => fs.readdirSync(dir).filter((f) => f.startsWith('.gd-suits-'));
const mountedHere = () => sh('/usr/bin/hdiutil', ['info']).includes(WORK);

/** Runs the helper exactly as recorded, but waiting on a stand-in process. */
async function runHelper(args, { pidOverride } = {}) {
  const real = [...args];
  if (pidOverride) real[3] = String(pidOverride);
  const child = realSpawn('/bin/sh', real, { stdio: 'ignore' });
  return new Promise((resolve) => child.on('exit', (code) => resolve(code)));
}

const PAGE = `
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const find = (t) => [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(t));
  const offering = () => [...document.querySelectorAll('button')].some(b => /^Download\\b/.test(b.textContent.trim()));
`;
const OPEN_UPDATES = `
  [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Orders')).click(); await wait(400);
  [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Settings')).click(); await wait(700);
  [...document.querySelectorAll('.step-tab')].find(b => b.textContent.includes('Updates')).click(); await wait(400);
`;
const UN = `const un = async (p) => { const r = await p; if (!r.ok) throw new Error(r.error.message); return r.data; };`;

function finish() {
  cleanUp();
  log(`\n${fail === 0 ? 'ALL INSTALL CHECKS PASSED' : 'FAILED'}${QUIT_PASS ? ' (quitting while it waits)' : ''} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}

app.whenReady().then(async () => {
  const win = await until(() => BrowserWindow.getAllWindows()[0]);
  const run = (js) => win.webContents.executeJavaScript(js);
  const call = async (js) => JSON.parse(await run(`${js}.then(JSON.stringify)`));
  // Looked for as soon as the window opens: a notice is gone in seconds.
  const toastSaying = (text) => until(async () => {
    const shown = await run(`[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')`).catch(() => '');
    return shown.includes(text) ? shown : null;
  }, 15000);

  /** An order with a render under way, held until the returned function lets it answer. */
  const renderUnderWay = async () => {
    secrets.set('gemini', 'TEST-KEY-1234');
    const { projectId } = await call(`(async () => {
      ${UN}
      const clientId = await un(gd.clients.save({ name: 'Update', surname: 'Test' }));
      return { projectId: await un(gd.projects.create({ clientId, title: 'Render under way' })) };
    })()`);
    const letGo = holdRenders();
    const asked = rendersAsked;
    await run(`window.__render = window.gd.ai.render({ projectId: ${projectId}, view: 'front', prompt: 'p', refs: [] }); true`);
    await until(() => rendersAsked > asked);
    const finished = async () => {
      letGo();
      const r = await run(`window.__render.then((r) => JSON.stringify({ ok: r.ok, error: r.error?.message }))`).then(JSON.parse);
      return { ...r, kept: db.getProject(projectId).renders.length };
    };
    return finished;
  };

  // Without this the checks below could pass on bundles nothing in Electron
  // mistakes for anything - which is how the ENOTDIR got through.
  check(fs.statSync(path.join(TARGET, 'Contents', 'Resources', 'app.asar')).isDirectory()
    && !plainFs.statSync(path.join(TARGET, 'Contents', 'Resources', 'app.asar')).isDirectory(),
  'harness: each bundle holds a real app.asar, which Electron\'s own fs reads as a folder');

  if (QUIT_PASS) {
    log('=== the launch after an update that went in ===');
    const shown = await toastSaying(`Updated to version ${INSTALLED}`);
    check(!!shown, 'the window says the update went in, and which version this now is', shown ?? '(no notice)');
    check(!db.getSetting('updateStaged', null) && !fs.existsSync(UPDATES) && !db.getSetting('updateFailed', null),
      '  what the update left behind is cleared, and nothing is marked as failed');

    log('\n=== quitting while it waits for a render ===');
    const modal = await until(async () => run(`(() => {
      const m = document.querySelector('.modal-backdrop');
      return m ? JSON.stringify([...m.querySelectorAll('button')].map(x => x.textContent.trim())) : null;
    })()`).then((v) => v && JSON.parse(v)));
    check(modal?.includes(`Update to ${NEWER}`), 'the first launch offers to update', JSON.stringify(modal));

    const renderDone = await renderUnderWay();
    await run(`window.__phases = []; window.gd.updates.onProgress((p) => p.phase && window.__phases.push(p.phase));
      window.__install = window.gd.updates.install(); true`);
    const phases = await until(async () => {
      const seen = JSON.parse(await run('JSON.stringify(window.__phases)'));
      return seen.includes('waiting') ? seen : null;
    }, 30000);
    const staged = db.getSetting('updateStaged', null);
    check(!!phases && staged?.version === NEWER && handed.length === 0 && quits === 0,
      'Update makes it ready, then waits for the render rather than quitting under it',
      JSON.stringify({ phases, staged: staged?.version, handed: handed.length, quits }));

    onQuit[0]({ preventDefault() {} });
    const args = handed[0];
    check(handed.length === 1 && args?.[1] === installer.MAC_HELPER && args[3] === String(process.pid)
      && args[4] === staged?.path && args[5] === TARGET,
      'quitting while it waits puts the update in as the app closes', JSON.stringify(args?.slice(3)));
    check(args?.[6] === '0', '  without reopening the app - he chose to quit');

    const rendered = await renderDone();
    check(rendered.ok && rendered.kept === 1, 'the render still finishes and is kept', JSON.stringify(rendered));
    const out = await run(`window.__install.then(JSON.stringify)`).then(JSON.parse);
    check(out.ok && out.data?.restarting && handed.length === 1 && quits === 0,
      '  and the update it was waiting on is not handed over a second time', JSON.stringify({ out, handed: handed.length, quits }));

    const standIn = realSpawn('/bin/sleep', ['30'], { stdio: 'ignore' });
    const swapped = runHelper(args, { pidOverride: standIn.pid });
    standIn.kill();
    await swapped;
    check(versionOf(TARGET) === NEWER, 'and run, it replaces the installed copy with the new version');
    return finish();
  }

  log('=== the launch after an update that could not be put in place ===');
  const notice = await toastSaying(`Version ${LATER} could not be put in place`);
  check(!!notice && notice.includes(`still version ${INSTALLED}`),
    'the window says the update did not go in, and which version this still is', notice ?? '(no notice)');
  check(db.getSetting('updateFailed', null)?.version === LATER,
    '  that version is offered as a download from then on, not tried on every quit');
  check(!db.getSetting('updateStaged', null) && !fs.existsSync(UPDATES),
    '  and what it left behind - the whole app it had made ready - is cleared',
    fs.existsSync(UPDATES) ? `still there: ${fs.readdirSync(UPDATES).join(', ')}` : '');
  const again = await call(`gd.updates.settled()`);
  check(again.ok && again.data === null, 'it is said once - asked again, there is nothing to say', JSON.stringify(again));

  log('\n=== which releases may install themselves ===');
  const release = (over = {}) => ({
    feedUrl: OFFICIAL_FEED,
    downloadUrl: fileUrl(`GD Suits Studio-${NEWER}-arm64.dmg`),
    downloadDigest: `sha256:${'a'.repeat(64)}`,
    ...over,
  });
  check(installer.officialRelease(release()) === null, 'one of this app\'s own releases, with a fingerprint');
  check(/custom/.test(installer.officialRelease(release({ feedUrl: 'https://api.github.com/repos/someone/else/releases/latest' })) ?? ''),
    'not one read from any other feed - even naming the same files');
  check(!!installer.officialRelease(release({ downloadUrl: 'https://github.com/someone/else/releases/download/v1/a.dmg' })),
    'not a file from another repository');
  check(!!installer.officialRelease(release({
    downloadUrl: 'https://github.com/Yudhi69/gd-suits-studio/releases/download/../../../../someone/else/releases/download/v1/a.dmg',
  })), 'not one that climbs out of the repository with ../');
  check(!!installer.officialRelease(release({ downloadUrl: `${fileUrl('a.dmg')}?from=elsewhere` })),
    'not one with anything added to the address');
  check(!!installer.officialRelease(release({ downloadUrl: fileUrl('a.dmg').replace('https:', 'http:') })), 'not over plain http');
  check(/fingerprint/.test(installer.officialRelease(release({ downloadDigest: '' })) ?? ''),
    'not one whose release states no fingerprint');
  check(!!installer.officialRelease(release({ downloadDigest: 'md5:abc' })), 'nor a fingerprint of the wrong kind');
  check(installer.APP_ID === APP_ID, 'the app it insists on is the one package.json builds', installer.APP_ID);
  check(installer.OFFICIAL_FEED === OFFICIAL_FEED, 'and the feed is this repository\'s');

  log('\n=== which installed copies can be replaced ===');
  const where = (over) => installer.installTarget({ platform: 'darwin', packaged: true, exePath: '/nowhere', ...over });
  check(/source/.test(installer.installTarget({ platform: 'darwin', packaged: false, exePath: process.execPath }).reason ?? ''),
    'not a copy run from source');
  check(where({ testTarget: TARGET }).target === TARGET, 'an app bundle this account can write to');
  check(where({ platform: 'win32', exePath: 'C:\\Users\\gd\\AppData\\Local\\Programs\\gd-suits-studio\\GD Suits Studio.exe' }).target
    === path.dirname('C:\\Users\\gd\\AppData\\Local\\Programs\\gd-suits-studio\\GD Suits Studio.exe'),
    'on Windows, wherever the installer put it');
  check(!!where({ platform: 'linux' }).reason, 'not on Linux');
  check(!!where({ testTarget: path.join(INSTALL_DIR) }).reason, 'not a folder that is not an app bundle');
  const translocated = fakeApp(path.join(WORK, 'AppTranslocation', 'ABC', 'd'), { version: INSTALLED });
  check(/Applications/.test(where({ testTarget: translocated }).reason ?? ''),
    'not one macOS is running from its quarantine copy - and it says to move it into Applications');
  const locked = fakeApp(path.join(WORK, 'Locked'), { version: INSTALLED });
  fs.chmodSync(path.dirname(locked), 0o555);
  check(/cannot change/.test(where({ testTarget: locked }).reason ?? ''), 'not one in a folder this account cannot change');
  fs.chmodSync(path.dirname(locked), 0o755);

  log('\n=== unpacking a downloaded disk image ===');
  const stageDir = path.join(WORK, 'stage');
  fs.mkdirSync(stageDir);
  const staged = await installer.stageMac({ signer: OURS.sha1, dmg: dmg.good, version: NEWER, dir: stageDir });
  check(versionOf(staged) === NEWER, 'the app comes out of the image', staged);
  check(!mountedHere(), 'and the image is closed again');
  const restaged = await installer.stageMac({ signer: OURS.sha1, dmg: dmg.good, version: NEWER, dir: stageDir }).catch((e) => e);
  check(restaged === staged && versionOf(restaged) === NEWER,
    'made ready a second time, the copy made the first time is replaced - not stopped at', restaged?.message ?? restaged);
  for (const [key, code] of [['wrongApp', 'wrong_app'], ['wrongVersion', 'wrong_version'], ['tampered', 'bad_signature'],
    ['adHoc', 'wrong_signer'], ['theirs', 'wrong_signer'],
    ['linked', 'bad_image'], ['twoApps', 'bad_image'], ['notAnImage', 'attach_failed']]) {
    const dir = path.join(WORK, `stage-${key}`);
    fs.mkdirSync(dir);
    const err = await installer.stageMac({ signer: OURS.sha1, dmg: dmg[key], version: NEWER, dir }).then(() => null, (e) => e);
    check(err?.code === code, `refused: ${{
      wrongApp: 'a different app', wrongVersion: 'the app at another version', tampered: 'an app changed after it was signed',
      adHoc: 'an app signed ad hoc, as every build before October 2026 was', theirs: 'an app signed with some other certificate',
      linked: 'a shortcut to an app somewhere else', twoApps: 'an image with two apps in it', notAnImage: 'a file that is not a disk image',
    }[key]}`, err?.code ?? 'accepted');
    check(!fs.existsSync(path.join(dir, 'staged', BUNDLE)), '  and nothing is left ready to install');
  }
  check(!mountedHere(), 'no image is left open after any of them');
  // Through a link, as /var is to /private/var: codesign names the changed
  // file by its real path, the app by the one it was given.
  fs.mkdirSync(path.join(WORK, 'stage-said'));
  fs.symlinkSync(path.join(WORK, 'stage-said'), path.join(WORK, 'stage-said-link'));
  const said = await installer.stageMac({ signer: OURS.sha1, dmg: dmg.tampered, version: NEWER,
    dir: path.join(WORK, 'stage-said-link') }).catch((e) => e);
  check(said?.code === 'bad_signature' && /\(.*file modified: \/Contents\/Resources\/version\.txt\)$/.test(said.message),
    'the refusal says what codesign found and in which file, without the folders around it', said?.message);

  // An older Mac, busy: the check is given ten minutes, and running out of
  // them is said as that - not as an update that has been tampered with.
  const realExecFileSync = childProcess.execFileSync;
  let allowed = null;
  childProcess.execFileSync = (file, args, opts) => {
    if (file === '/usr/bin/codesign' && args?.[0] === '--verify') {
      allowed = opts?.timeout;
      throw Object.assign(new Error('spawnSync /usr/bin/codesign ETIMEDOUT'), { code: 'ETIMEDOUT', status: null, signal: 'SIGTERM' });
    }
    return realExecFileSync(file, args, opts);
  };
  const slow = await installer.stageMac({ signer: OURS.sha1, dmg: dmg.good, version: NEWER,
    dir: fs.mkdtempSync(path.join(WORK, 'stage-slow-')) }).catch((e) => e);
  childProcess.execFileSync = realExecFileSync;
  check(allowed >= 10 * 60 * 1000, 'the signature check is allowed ten minutes, for an older Mac', String(allowed));
  check(slow?.code === 'verify_timeout' && /too long/.test(slow.message),
    '  and running out of time says so, rather than calling the update changed', `${slow?.code} ${slow?.message}`);

  const unnamed = await installer.stageMac({ dmg: dmg.good, version: NEWER,
    dir: fs.mkdtempSync(path.join(WORK, 'stage-unnamed-')) }).catch((e) => e);
  check(unnamed?.code === 'wrong_signer', 'with no certificate named, only the project\'s own is accepted - not this suite\'s',
    unnamed?.code ?? 'accepted');
  check(installer.SIGNER === '25294558ac2e19e7255e2e5e1c29b7b744120d62', '  which is the one in build/signing-cert.pem', installer.SIGNER);
  // Unchecked, this would read "(our certificate) or (any app with this
  // identifier)" - which an ad-hoc build passes.
  const injected = await installer.stageMac({ signer: `${OURS.sha1}" or identifier "${APP_ID}`, dmg: dmg.adHoc, version: NEWER,
    dir: fs.mkdtempSync(path.join(WORK, 'stage-injected-')) }).catch((e) => e);
  check(injected?.code === 'wrong_signer', 'a certificate named by anything but its fingerprint is refused, not read as a rule',
    injected?.code ?? 'accepted');

  // macOS's disk-image service is now and then too busy to open an image it
  // opens a moment later - one run in about fifteen of this suite.
  const realExecFile = childProcess.execFile;
  let busy = 0;
  childProcess.execFile = (file, args, ...rest) => {
    if (file === '/usr/bin/hdiutil' && args?.[0] === 'attach' && busy < 2) {
      busy++;
      const done = rest.pop();
      setImmediate(() => done(Object.assign(new Error('Command failed'), { code: 1 }), '',
        'hdiutil: attach failed - Resource temporarily unavailable\n'));
      return { pid: 0 };
    }
    return realExecFile(file, args, ...rest);
  };
  const busyDir = path.join(WORK, 'stage-busy');
  fs.mkdirSync(busyDir);
  const afterBusy = await installer.stageMac({ signer: OURS.sha1, dmg: dmg.good, version: NEWER, dir: busyDir }).catch((e) => e);
  childProcess.execFile = realExecFile;
  check(busy === 2 && typeof afterBusy === 'string' && versionOf(afterBusy) === NEWER,
    'an image the system was too busy to open is tried again, and opens', `${busy} ${afterBusy?.code ?? afterBusy}`);
  const unopened = await installer.stageMac({ signer: OURS.sha1, dmg: dmg.notAnImage, version: NEWER,
    dir: fs.mkdtempSync(path.join(WORK, 'stage-again-')) }).catch((e) => e);
  check(unopened?.code === 'attach_failed' && /\S/.test(unopened.detail ?? '') && !/WARNING/.test(unopened.detail),
    'one that never opens is still refused, keeping what the system said for the log', unopened?.detail);

  log('\n=== putting it in place ===');
  // A process that is "the app", so the swap can be seen to wait for it.
  const place = fs.mkdtempSync(path.join(WORK, 'place-'));
  const target = fakeApp(place, { version: INSTALLED });
  const ready = await installer.stageMac({ signer: OURS.sha1, dmg: dmg.good, version: NEWER, dir: fs.mkdtempSync(path.join(WORK, 'ready-')) });
  const standIn = realSpawn('/bin/sleep', ['30'], { stdio: 'ignore' });
  const result = path.join(place, 'result');
  installer.apply({
    platform: 'darwin', staged: ready, target, version: NEWER, pid: standIn.pid, relaunch: false,
    log: path.join(place, 'log'), result, signer: OURS.sha1,
  });
  const swap = handed.pop();
  check(swap && swap[1] === installer.MAC_HELPER, 'the swap is handed to the fixed helper script');
  check(swap?.slice(3).join('|') === [standIn.pid, ready, target, '0', path.join(place, 'log'), result].join('|'),
    'with every path as an argument of its own', JSON.stringify(swap?.slice(3)));
  const running = runHelper(swap);
  await wait(800);
  check(versionOf(target) === INSTALLED && !fs.existsSync(result), 'nothing is replaced while the app is still running');
  standIn.kill();
  const code = await running;
  check(code === 0 && fs.readFileSync(result, 'utf8').trim() === 'installed', 'once it quits, the update goes in',
    `${code} ${fs.existsSync(result) ? fs.readFileSync(result, 'utf8') : ''}`);
  check(versionOf(target) === NEWER, 'the installed copy is now the new version');
  check(sh('/bin/sh', ['-c', '/usr/bin/codesign --verify --deep --strict "$1" && echo ok', 'x', target]).trim() === 'ok',
    'and its signature is intact');
  check(leftovers(place).length === 0 && !fs.existsSync(ready), 'nothing is left behind, beside it or where it was staged',
    leftovers(place).join(', '));

  // A copy that cannot be made leaves the installed one exactly as it was.
  const keep = fakeApp(fs.mkdtempSync(path.join(WORK, 'keep-')), { version: INSTALLED });
  const keepResult = path.join(path.dirname(keep), 'result');
  await runHelper(['-c', installer.MAC_HELPER, 'gd-suits-update', '999999', path.join(WORK, 'gone', BUNDLE), keep, '0',
    path.join(path.dirname(keep), 'log'), keepResult]);
  check(/^failed/.test(fs.readFileSync(keepResult, 'utf8')) && versionOf(keep) === INSTALLED,
    'if the new copy cannot be put beside it, the installed copy is untouched');
  check(leftovers(path.dirname(keep)).length === 0, '  and no half-copy is left beside it');

  // Paths are arguments, never part of the script: a folder name full of
  // shell is just a folder name.
  const odd = fs.mkdtempSync(path.join(WORK, 'odd-'));
  const oddTarget = fakeApp(path.join(odd, 'a"; touch PWNED; echo "$(touch PWNED2)`touch PWNED3`'), { version: INSTALLED });
  const oddReady = await installer.stageMac({ signer: OURS.sha1, dmg: dmg.good, version: NEWER, dir: fs.mkdtempSync(path.join(WORK, 'oddready-')) });
  const oddResult = path.join(odd, 'result');
  await runHelper(['-c', installer.MAC_HELPER, 'gd-suits-update', '999999', oddReady, oddTarget, '0', path.join(odd, 'log'), oddResult]);
  const pwned = ['PWNED', 'PWNED2', 'PWNED3'].some((f) => fs.existsSync(path.join(odd, f)) || fs.existsSync(path.join(process.cwd(), f)));
  check(!pwned && versionOf(oddTarget) === NEWER, 'a folder name made of shell commands runs none of them', String(pwned));

  // Checked again at the last moment: a bundle changed after it was made
  // ready is not handed over at all.
  const changed = await installer.stageMac({ signer: OURS.sha1, dmg: dmg.good, version: NEWER, dir: fs.mkdtempSync(path.join(WORK, 'changed-')) });
  fs.writeFileSync(path.join(changed, 'Contents', 'Resources', 'version.txt'), 'swapped in later');
  const before = handed.length;
  const refused = (() => {
    try { installer.apply({ platform: 'darwin', staged: changed, target, version: NEWER, pid: 1, relaunch: false, log: '/dev/null', result: path.join(WORK, 'r'), signer: OURS.sha1 }); return null; }
    catch (e) { return e; }
  })();
  check(refused?.code === 'bad_signature' && handed.length === before, 'a ready update changed since is refused at the hand-over',
    refused?.code ?? 'handed over');

  log('\n=== judging, on the next launch, whether it went in ===');
  const settle = (record, current, result, ago = 0) =>
    installer.settle({ record, current, result, now: (record?.applying ?? 0) + ago, compare: updater.compareVersions });
  check(settle(null, INSTALLED) === 'none', 'nothing was made ready: nothing to say');
  check(settle({ version: NEWER }, INSTALLED) === 'waiting', 'made ready, never handed over: still waiting');
  check(settle({ version: NEWER, applying: 1 }, NEWER, 'installed') === 'installed', 'this copy is the new version: installed');
  check(settle({ version: NEWER, applying: 1 }, INSTALLED, 'failed: could not move') === 'failed', 'the helper said it failed: failed');
  check(settle({ version: NEWER, applying: 1 }, INSTALLED, null, 5000) === 'pending', 'handed over moments ago: give it time');
  check(settle({ version: NEWER, applying: 1 }, INSTALLED, null, 11 * 60 * 1000) === 'failed', 'handed over long ago, still old: failed');

  /* ------------------------------------------------------------ the app */

  log('\n=== the first launch finds a newer version ===');
  const beforeAsked = { staged: db.getSetting('updateStaged', null), dir: fs.existsSync(UPDATES),
    installs: calls.filter((c) => c.channel === 'updates:install').length };
  check(!beforeAsked.staged && !beforeAsked.dir && beforeAsked.installs === 0,
    'nothing is made ready before he is asked', JSON.stringify({ ...beforeAsked, calls }));
  // Where an earlier version left an app made ready and never put in place:
  // the state that stopped every update with "ENOTDIR ... app.asar".
  const stranded = fakeApp(path.join(UPDATES, '0.0.1', 'staged'), { version: '0.0.1' });
  const modal = await until(async () => run(`(() => {
    const m = document.querySelector('.modal-backdrop');
    if (!m) return null;
    const b = [...m.querySelectorAll('button')].map(x => x.textContent.trim());
    return JSON.stringify({ text: m.textContent, buttons: b });
  })()`).then((v) => v && JSON.parse(v)));
  check(modal?.buttons?.includes(`Update to ${NEWER}`), 'it offers to update to it',
    `${JSON.stringify(modal?.buttons)} calls=${JSON.stringify(calls)}`);
  check(modal && !modal.buttons.some((b) => /^(Download|Install)\b/.test(b)),
    'as one step - not a download for him to install, nor an Install that then wants a Restart', JSON.stringify(modal?.buttons));
  check(/nothing else to do/.test(modal?.text ?? ''), 'and says there is nothing else to do');

  log('\n=== one press, with a render still going ===');
  // A record pointing outside the app's own updates folder - which only
  // something other than this process could have written - is not what goes in.
  db.setSetting('updateStaged', { version: NEWER, platform: 'darwin', path: TARGET, sha256: '' });
  const renderDone = await renderUnderWay();
  const waiting = await run(`(async () => {
    ${PAGE}
    const m = () => document.querySelector('.modal-backdrop');
    [...m().querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Update to')).click();
    for (let i = 0; i < 150 && !/Waiting for a render/.test(m().textContent); i++) await wait(200);
    return JSON.stringify({ text: m().textContent, buttons: [...m().querySelectorAll('button')].map(b => b.textContent.trim()) });
  })()`).then(JSON.parse);
  const record = db.getSetting('updateStaged', null);
  check(/Waiting for a render or an email/.test(waiting.text),
    'one press downloads it and makes it ready, then waits for the render to finish', waiting.text.slice(0, 300));
  check(handed.length === 0 && quits === 0, '  handing nothing over and quitting nothing meanwhile', `${handed.length} ${quits}`);
  check(waiting.buttons.some((b) => b.includes('Updating')) && !waiting.buttons.some((b) => /Restart|Install/.test(b)),
    '  with no second button to press', JSON.stringify(waiting.buttons));
  check(record?.version === NEWER && record.path.startsWith(UPDATES + path.sep),
    'it is made ready inside the app\'s own data folder', JSON.stringify(record));
  check(!fs.existsSync(path.dirname(path.dirname(stranded))),
    '  having first cleared an app an earlier version made ready and never put in place', waiting.text.slice(0, 300));
  check(versionOf(record?.path ?? '') === NEWER, '  as the app unpacked from the image');
  check(fs.readdirSync(DOWNLOADS).length === 0, '  with nothing put in his Downloads folder', fs.readdirSync(DOWNLOADS).join(', '));
  check(!fs.readdirSync(path.join(UPDATES, NEWER)).some((f) => f.endsWith('.dmg')), '  and the disk image deleted once unpacked');
  check(versionOf(TARGET) === INSTALLED, 'the installed copy is not touched yet');

  const rendered = await renderDone();
  check(rendered.ok && rendered.kept === 1, 'the render finishes and is kept', JSON.stringify(rendered));
  await until(() => handed.length > 0 && quits > 0);
  const updateArgs = handed[0];
  check(handed.length === 1 && updateArgs?.[1] === installer.MAC_HELPER && updateArgs[3] === String(process.pid)
    && updateArgs[5] === TARGET,
    'then it hands the update to the helper, to go in once this process has gone', JSON.stringify(updateArgs?.slice(3)));
  check(updateArgs?.[4] === record?.path, '  the copy it made ready itself, not the one planted elsewhere', updateArgs?.[4]);
  check(updateArgs?.[6] === '1', '  and to reopen the app on the new version');
  check(quits === 1, 'and quits - there is nothing more to press', String(quits));
  check(!!db.getSetting('updateStaged', null)?.applying, '  noting that it was handed over');
  const restarting = await run(`document.querySelector('.modal-backdrop')?.textContent ?? ''`);
  check(/Restarting on the new version/.test(restarting), 'the prompt says it is restarting', restarting.slice(0, 200));

  onQuit[0]({ preventDefault() {} });
  check(handed.length === 1, 'the quit that follows does not hand it over a second time', String(handed.length));
  let r = await call(`gd.updates.install()`);
  check(r.ok && r.data?.restarting && handed.length === 1 && quits === 1,
    'nor does pressing Update again before the app has gone', JSON.stringify({ r, handed: handed.length, quits }));

  // The real thing, end to end: the helper main handed over, run against a
  // stand-in for this process.
  const standIn2 = realSpawn('/bin/sleep', ['30'], { stdio: 'ignore' });
  const swapped = runHelper(updateArgs.map((a, i) => (i === 6 ? '0' : a)), { pidOverride: standIn2.pid });
  standIn2.kill();
  await swapped;
  check(versionOf(TARGET) === NEWER, 'and run, it replaces the installed copy with the new version');
  check(leftovers(INSTALL_DIR).length === 0, '  leaving nothing beside it', leftovers(INSTALL_DIR).join(', '));
  check(fs.readFileSync(path.join(UPDATES, 'install.result'), 'utf8').trim() === 'installed', '  and reports that it went in');

  log('\n=== Settings ===');
  // Reopened, as the prompt stays busy until the window goes.
  await new Promise((resolve) => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
  await wait(1500);
  const settings = await run(`(async () => {
    ${PAGE}
    ${OPEN_UPDATES}
    find('Check for updates').click(); await wait(1200);
    return JSON.stringify({
      update: !!find('Update to ${NEWER}'), restart: !!find('Restart now'), install: !!find('Install'), offering: offering(),
      text: document.querySelector('.main').textContent,
    });
  })()`).then(JSON.parse);
  check(settings.update && !settings.restart && !settings.install && !settings.offering,
    `a check offers Update to ${NEWER} - one button, not Install and Restart now, not a download`,
    JSON.stringify({ ...settings, text: undefined }));
  check(/nothing else to do/.test(settings.text), 'and says there is nothing else to do');
  check(/Always Allow/.test(settings.text), 'and warns that the Mac may ask for the keychain password once');

  log('\n=== what a page cannot do ===');
  for (const key of ['updateStaged', 'updateFailed']) {
    r = await call(`gd.settings.get({ key: '${key}' })`);
    check(!r.ok, `it cannot read ${key}`);
    r = await call(`gd.settings.set({ key: '${key}', value: { version: '${NEWER}', platform: 'darwin', path: '/bin' } })`);
    check(!r.ok, `or write it`);
  }
  check(await run(`typeof window.gd.updates.restart`) === 'undefined',
    'there is no restart of its own to call - the one way in is Update, which names no file');
  db.setSetting('updateStaged', null);

  log('\n=== releases that fall back to the download ===');
  plainFs.rmSync(UPDATES, { recursive: true, force: true });
  const reason = async () => (await call(`gd.updates.check()`)).data;

  await call(`gd.settings.set({ key: 'updateFeed', value: 'https://api.github.com/repos/someone/else/releases/latest' })`);
  let d = await reason();
  check(d?.updateAvailable && d.canInstall === false && /custom/.test(d.installBlocked ?? ''),
    'from a custom feed - even one that names this app\'s own files - it does not install itself', JSON.stringify(d?.installBlocked));
  r = await call(`gd.updates.install()`);
  check(!r.ok && !fs.existsSync(UPDATES), '  and asking anyway is refused', JSON.stringify(r.error));
  await call(`gd.settings.set({ key: 'updateFeed', value: '${OFFICIAL_FEED}' })`);

  digest = '';
  d = await reason();
  check(d?.canInstall === false && /fingerprint/.test(d.installBlocked ?? ''), 'a release with no fingerprint is downloaded instead');
  const ui = await run(`(async () => {
    ${PAGE}
    ${OPEN_UPDATES}
    find('Check for updates').click(); await wait(1200);
    return JSON.stringify({ install: !!find('Install'), offering: offering(), why: document.querySelector('.main').textContent.includes('Why it does not install itself') });
  })()`).then(JSON.parse);
  check(!ui.install && ui.offering && ui.why, '  Settings offers the download, and says why', JSON.stringify(ui));
  digest = `sha256:${sha(GOOD)}`;

  delete process.env.GD_TEST_INSTALL_TARGET;
  d = await reason();
  check(d?.canInstall === false && /source/.test(d.installBlocked ?? ''), 'a copy that cannot be replaced is downloaded instead');
  process.env.GD_TEST_INSTALL_TARGET = TARGET;

  db.setSetting('updateFailed', { version: NEWER });
  d = await reason();
  check(d?.canInstall === false && /last time/.test(d.installBlocked ?? ''),
    'a version that failed to go in once is not tried on every quit after');
  db.setSetting('updateFailed', null);

  log('\n=== a download that is not the release ===');
  // The installed copy is old again for these.
  plainFs.rmSync(TARGET, { recursive: true, force: true });
  fakeApp(INSTALL_DIR, { version: INSTALLED });
  served = Buffer.concat([GOOD, Buffer.from('extra')]);
  d = await reason();
  r = await call(`gd.updates.install()`);
  check(!r.ok && !db.getSetting('updateStaged', null), 'bytes that do not match the fingerprint are never made ready',
    JSON.stringify(r.error));
  check(!fs.existsSync(path.join(UPDATES, NEWER)), '  and are deleted');
  served = fs.readFileSync(dmg.wrongVersion);
  digest = `sha256:${sha(served)}`;
  d = await reason();
  r = await call(`gd.updates.install()`);
  check(!r.ok && /version/.test(r.error?.message ?? '') && !db.getSetting('updateStaged', null),
    'an image holding another version is refused, even with a matching fingerprint', JSON.stringify(r.error));
  served = GOOD; digest = `sha256:${sha(GOOD)}`;

  // As an installed copy sees it: no test certificate, only the project's.
  delete process.env.GD_TEST_SIGNER;
  d = await reason();
  r = await call(`gd.updates.install()`);
  check(!r.ok && /certificate/.test(r.error?.message ?? '') && !db.getSetting('updateStaged', null),
    'a release signed with any other certificate is never made ready - the app insists on its own', JSON.stringify(r.error));
  process.env.GD_TEST_SIGNER = OURS.sha1;

  log('\n=== an Update that stops offers the download in its place ===');
  // A release that installs itself had only Update, in the prompt and in
  // Settings. When Update stopped, a red message was all there was - and the
  // same button, which stopped at the same thing. GD's copy did that on every
  // press (27 Oct 2026), with no way on from inside the app.
  delete process.env.GD_TEST_SIGNER;   // so Update stops, after the download, at the signature
  db.setSetting('updatePrompted', null);
  await new Promise((resolve) => { win.webContents.once('did-finish-load', resolve); win.webContents.reload(); });
  const stopped = await run(`(async () => {
    ${PAGE}
    const m = () => document.querySelector('.modal-backdrop');
    for (let i = 0; i < 75 && !(m() && find('Update to ${NEWER}')); i++) await wait(200);
    if (!m() || !find('Update to ${NEWER}')) return JSON.stringify({ shown: false, text: m()?.textContent ?? '' });
    const before = offering();
    find('Update to ${NEWER}').click();
    for (let i = 0; i < 150 && !offering(); i++) await wait(200);
    return JSON.stringify({ shown: true, before, update: !!find('Update to'), offering: offering(), text: m().textContent });
  })()`).then(JSON.parse);
  check(stopped.shown && !stopped.before, 'harness: the prompt opens offering Update, not a download',
    JSON.stringify({ ...stopped, text: stopped.text.slice(0, 300) }));
  check(stopped.offering && !stopped.update, 'when Update stops, the prompt offers the download in its place',
    JSON.stringify({ ...stopped, text: undefined }));
  check(/could not install itself: .*certificate/.test(stopped.text), '  and says why it stopped', stopped.text.slice(0, 400));

  const fetched = await run(`(async () => {
    ${PAGE}
    find('Download ${NEWER}')?.click();
    for (let i = 0; i < 150 && !find('Show in Finder'); i++) await wait(200);
    return JSON.stringify({ shown: !!find('Show in Finder'), text: document.querySelector('.modal-backdrop')?.textContent ?? '' });
  })()`).then(JSON.parse);
  const got = fs.readdirSync(DOWNLOADS);
  check(fetched.shown && got.length === 1 && sha(fs.readFileSync(path.join(DOWNLOADS, got[0]))) === sha(GOOD),
    '  pressed, it saves the release to Downloads - nothing the stopped Update left gets in its way',
    JSON.stringify({ shown: fetched.shown, got }));
  check(/drag the app into Applications/.test(fetched.text), '  and says what to do with it', fetched.text.slice(0, 400));
  for (const f of got) fs.rmSync(path.join(DOWNLOADS, f));

  const inSettings = await run(`(async () => {
    ${PAGE}
    (find('Done') ?? find('Later'))?.click(); await wait(300);
    ${OPEN_UPDATES}
    find('Check for updates').click(); await wait(1200);
    const before = { update: !!find('Update to ${NEWER}'), offering: offering() };
    find('Update to ${NEWER}')?.click();
    for (let i = 0; i < 150 && !offering(); i++) await wait(200);
    return JSON.stringify({ before, update: !!find('Update to'), offering: offering(), modal: !!document.querySelector('.modal-backdrop'),
      text: document.querySelector('.main').textContent });
  })()`).then(JSON.parse);
  check(inSettings.before.update && !inSettings.before.offering && !inSettings.modal,
    'harness: Settings offers Update, not a download, with the prompt closed', JSON.stringify({ ...inSettings, text: undefined }));
  check(inSettings.offering && !inSettings.update, 'when Update stops in Settings, it offers the download there too',
    JSON.stringify({ ...inSettings, text: undefined }));
  check(/could not install itself: .*certificate/.test(inSettings.text), '  and says why it stopped');
  const rechecked = await run(`(async () => {
    ${PAGE}
    find('Check for updates').click(); await wait(1200);
    return JSON.stringify({ update: !!find('Update to ${NEWER}'), offering: offering() });
  })()`).then(JSON.parse);
  check(rechecked.update && !rechecked.offering, '  until the next check, which offers Update again', JSON.stringify(rechecked));
  process.env.GD_TEST_SIGNER = OURS.sha1;

  log('\n=== the next launch ===');
  // Nothing is installed on the way out of a test run: app.exit skips the
  // quit handlers. The record is cleared all the same.
  db.setSetting('updateStaged', null);
  app.quit = realQuit;
  finish();
}).catch((e) => { log('HARNESS FAIL', e.stack); cleanUp(); app.exit(1); });
