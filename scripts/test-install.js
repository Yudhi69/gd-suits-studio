/**
 * An update that installs itself.
 *
 * Install downloads the release, checks it and makes it ready; Restart now -
 * or quitting - puts it in place of the running copy. This suite builds real
 * (tiny) app bundles and disk images, signed with a throwaway certificate the
 * way releases are signed with the real one, so the unpacking, the signature
 * check and the swap itself all run for real, against folders of the suite's
 * own. Nothing in Applications is touched.
 *
 * Two things are stubbed: the network (the release feed and its file) and the
 * final hand-over - the helper is recorded rather than started, then run here
 * against a stand-in process, because the real one waits for this process to
 * exit. Runs as an installed copy for its first-run prompt, via
 * GD_TEST_FIRST_RUN in its npm script.
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

const DOWNLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-install-dl-'));
app.setPath('downloads', DOWNLOADS);
shell.showItemInFolder = () => {};

const INSTALLED = require('../package.json').version;
const NEWER = (() => { const p = INSTALLED.split('.').map(Number); p[p.length - 1] += 1; return p.join('.'); })();
const APP_ID = require('../package.json').build.appId;
const BUNDLE = 'GD Suits Studio.app';

/* ------------------------------------------------------------ fixtures */

const WORK = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gd-install-')));
const sh = (file, args) => childProcess.execFileSync(file, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

// The certificate this suite's releases are signed with, standing in for the
// project's own - and someone else's. The app is told to trust the first the
// way main lets a test do it, only outside an installed copy.
const { throwawaySigner } = require('./signer.js');
const OURS = throwawaySigner(WORK, 'GD Install Suite');
const THEIRS = throwawaySigner(WORK, 'Somebody Else');
process.env.GD_TEST_SIGNER = OURS.sha1;

/** A two-file app bundle, signed as a release is - or as `signer` says (null: ad hoc). */
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
global.fetch = async (url) => {
  const u = String(url);
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

const beforeMain = app.listeners('will-quit');
require('../electron/main.js');
const onQuit = app.listeners('will-quit').filter((l) => !beforeMain.includes(l));
const installer = require('../electron/installer.js');
const updater = require('../electron/updater.js');
const db = require('../electron/db.js');

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
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.rmSync(DOWNLOADS, { recursive: true, force: true });
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

app.whenReady().then(async () => {
  log('=== which releases may install themselves ===');
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

  const win = await until(() => BrowserWindow.getAllWindows()[0]);
  const run = (js) => win.webContents.executeJavaScript(js);
  const call = async (js) => JSON.parse(await run(`${js}.then(JSON.stringify)`));

  log('\n=== the first launch finds a newer version ===');
  const beforeAsked = { staged: db.getSetting('updateStaged', null), dir: fs.existsSync(UPDATES),
    installs: calls.filter((c) => c.channel === 'updates:install').length };
  check(!beforeAsked.staged && !beforeAsked.dir && beforeAsked.installs === 0,
    'nothing is made ready before he is asked', JSON.stringify({ ...beforeAsked, calls }));
  const modal = await until(async () => run(`(() => {
    const m = document.querySelector('.modal-backdrop');
    if (!m) return null;
    const b = [...m.querySelectorAll('button')].map(x => x.textContent.trim());
    return JSON.stringify({ text: m.textContent, buttons: b });
  })()`).then((v) => v && JSON.parse(v)));
  check(modal?.buttons?.includes(`Install ${NEWER}`), 'it offers to install it',
    `${JSON.stringify(modal?.buttons)} calls=${JSON.stringify(calls)}`);
  check(modal && !modal.buttons.some((b) => b.startsWith('Download')), 'not to download it for him to install',
    JSON.stringify(modal?.buttons));
  const afterInstall = await run(`(async () => {
    ${PAGE}
    const m = () => document.querySelector('.modal-backdrop');
    [...m().querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Install')).click();
    for (let i = 0; i < 150 && ![...m().querySelectorAll('button')].some(b => b.textContent.trim() === 'Restart now'); i++) await wait(200);
    const out = { buttons: [...m().querySelectorAll('button')].map(b => b.textContent.trim()), text: m().textContent };
    [...m().querySelectorAll('button')].find(b => b.textContent.trim() === 'Later').click(); await wait(300);
    out.closed = !document.querySelector('.modal-backdrop');
    out.flag = document.querySelector('.update-flag')?.textContent ?? '';
    return JSON.stringify(out);
  })()`).then(JSON.parse);
  check(afterInstall.buttons.includes('Restart now'), 'Install makes it ready, and offers to restart', JSON.stringify(afterInstall.buttons));
  check(/next time you quit/.test(afterInstall.text), 'and says Later still installs it - when he quits');
  check(afterInstall.closed, 'Later closes the prompt');
  check(/ready - restart to update/.test(afterInstall.flag), 'and the corner flag says it is ready', afterInstall.flag);

  const record = db.getSetting('updateStaged', null);
  check(record?.version === NEWER && record.path.startsWith(UPDATES + path.sep), 'it is made ready inside the app\'s own data folder',
    JSON.stringify(record));
  check(versionOf(record?.path ?? '') === NEWER, 'as the app unpacked from the image');
  check(fs.readdirSync(DOWNLOADS).length === 0, 'and nothing is put in his Downloads folder', fs.readdirSync(DOWNLOADS).join(', '));
  check(!fs.readdirSync(path.join(UPDATES, NEWER)).some((f) => f.endsWith('.dmg')), 'the disk image is deleted once unpacked');
  check(versionOf(TARGET) === INSTALLED, 'the installed copy is not touched yet');

  log('\n=== Settings, once it is ready ===');
  const settings = await run(`(async () => {
    ${PAGE}
    ${OPEN_UPDATES}
    find('Check for updates').click(); await wait(1200);
    return JSON.stringify({
      restart: !!find('Restart now'), install: !!find('Install'), offering: offering(),
      text: document.querySelector('.main').textContent,
    });
  })()`).then(JSON.parse);
  check(settings.restart && !settings.install && !settings.offering, 'a check shows Restart now - not Install again, not a download',
    JSON.stringify({ ...settings, text: undefined }));
  check(/Always Allow/.test(settings.text), 'and warns that the Mac may ask for the keychain password once');
  let r = await call(`gd.updates.install()`);
  check(r.ok && r.data?.already === true, 'asking to install again hands back the one already ready', JSON.stringify(r));

  log('\n=== quitting installs it ===');
  check(onQuit.length === 1, 'main listens for the app quitting', String(onQuit.length));
  onQuit[0]({ preventDefault() {} });
  const onQuitArgs = handed.pop();
  check(onQuitArgs?.[1] === installer.MAC_HELPER && onQuitArgs[3] === String(process.pid) && onQuitArgs[5] === TARGET,
    'quitting hands it to the helper, to go in once this process has gone', JSON.stringify(onQuitArgs?.slice(3)));
  check(onQuitArgs?.[6] === '0', '  without reopening the app - he chose to quit');
  check(!!db.getSetting('updateStaged', null)?.applying, '  and notes that it was handed over');

  log('\n=== Restart now ===');
  const beforeRestart = quits;
  r = await call(`gd.updates.restart()`);
  const restartArgs = handed.pop();
  check(r.ok && restartArgs?.[6] === '1' && restartArgs[5] === TARGET, 'hands it over to go in and reopen the app',
    JSON.stringify(r.error ?? restartArgs?.slice(3)));
  await wait(100);
  check(quits === beforeRestart + 1, 'and quits');
  onQuit[0]({ preventDefault() {} });
  check(handed.length === 0, 'the quit that follows does not hand it over a second time', String(handed.length));

  // The real thing, end to end: the helper main handed over, run against a
  // stand-in for this process.
  const standIn2 = realSpawn('/bin/sleep', ['30'], { stdio: 'ignore' });
  const swapped = runHelper(restartArgs.map((a, i) => (i === 6 ? '0' : a)), { pidOverride: standIn2.pid });
  standIn2.kill();
  await swapped;
  check(versionOf(TARGET) === NEWER, 'and run, it replaces the installed copy with the new version');
  check(leftovers(INSTALL_DIR).length === 0, '  leaving nothing beside it', leftovers(INSTALL_DIR).join(', '));
  check(fs.readFileSync(path.join(UPDATES, 'install.result'), 'utf8').trim() === 'installed', '  and reports that it went in');

  log('\n=== what a page cannot do ===');
  for (const key of ['updateStaged', 'updateFailed']) {
    r = await call(`gd.settings.get({ key: '${key}' })`);
    check(!r.ok, `it cannot read ${key}`);
    r = await call(`gd.settings.set({ key: '${key}', value: { version: '${NEWER}', platform: 'darwin', path: '/bin' } })`);
    check(!r.ok, `or write it`);
  }
  // A record that points anywhere but the app's own updates folder is not
  // something to install, whoever wrote it.
  db.setSetting('updateStaged', { version: NEWER, platform: 'darwin', path: TARGET, sha256: '' });
  r = await call(`gd.updates.restart()`);
  check(!r.ok && handed.length === 0, 'an update outside the app\'s own folder is never handed over', JSON.stringify(r));
  db.setSetting('updateStaged', null);

  log('\n=== releases that fall back to the download ===');
  fs.rmSync(UPDATES, { recursive: true, force: true });
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
  fs.rmSync(TARGET, { recursive: true, force: true });
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

  log('\n=== the next launch ===');
  // Nothing is installed on the way out of a test run: app.exit skips the
  // quit handlers. The record is cleared all the same.
  db.setSetting('updateStaged', null);
  app.quit = realQuit;

  cleanUp();
  log(`\n${fail === 0 ? 'ALL INSTALL CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); cleanUp(); app.exit(1); });
