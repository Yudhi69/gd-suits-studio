const { app, BrowserWindow, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
require('./fresh.js').freshUserData(app);

// Showing the download in Finder is right for the tailor and wrong for a
// test - every run left another window open on the desktop. Recorded instead,
// so the button can be pressed and the path it reveals checked.
const revealed = [];
shell.showItemInFolder = (target) => { revealed.push(target); };

// Downloads land in the Downloads folder. Here that is a folder of our own,
// so a test run cannot put anything in the real one.
const DOWNLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-updates-'));
app.setPath('downloads', DOWNLOADS);

// The version the app actually reports. Pinned as a literal until releases
// started being cut automatically, at which point every release broke the
// suite - the test's idea of "newer" has to be newer than whatever is built.
const INSTALLED = require('../package.json').version;
const NEWER = (() => {
  const parts = INSTALLED.split('.').map((n) => parseInt(n, 10) || 0);
  parts[parts.length - 1] += 1;
  return parts.join('.');
})();

// A file that stands in for an installer, and what it really hashes to.
const INSTALLER = Buffer.alloc(64 * 1024, 7);
const INSTALLER_SHA = crypto.createHash('sha256').update(INSTALLER).digest('hex');

// Stub the release feed so the whole flow can be exercised without publishing.
const realFetch = global.fetch;
let mode = 'newer';
let assetHost = 'github.com';
let served = null;      // what the download host actually hands back
let redirectTo = null;  // where the download is sent instead
global.fetch = async (url, opts) => {
  const u = String(url);
  if (/^https:\/\/(github\.com|objects\.githubusercontent\.com|elsewhere\.example)\//.test(u)) {
    const body = served ?? INSTALLER;
    const res = new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/octet-stream', 'content-length': String(body.length) },
    });
    // `res.url` is read-only, and it is what the redirect check looks at.
    Object.defineProperty(res, 'url', { value: redirectTo ?? u });
    return res;
  }
  if (!u.includes('api.github.com')) return realFetch(url, opts);
  if (mode === 'passthrough') return realFetch(url, opts);
  const version = mode === 'newer' ? NEWER : INSTALLED;
  return new Response(JSON.stringify({
    tag_name: `v${version}`,
    name: `GD Suits Studio ${version}`,
    body: 'Adds a turnable 3D preview.\nFixes the lapel width rounding.',
    html_url: 'https://github.com/Yudhi69/gd-suits-studio/releases/tag/v' + version,
    published_at: '2026-09-15T10:00:00Z',
    draft: false, prerelease: false,
    assets: [
      { name: assetName('arm64.dmg', version), size: INSTALLER.length, digest: `sha256:${INSTALLER_SHA}`,
        browser_download_url: `https://${assetHost}/gd-${version}-arm64.dmg` },
      { name: assetName('.dmg', version), size: INSTALLER.length, digest: `sha256:${INSTALLER_SHA}`,
        browser_download_url: `https://${assetHost}/gd-${version}.dmg` },
      { name: `GD Suits Studio Setup ${version}.exe`, size: INSTALLER.length, digest: `sha256:${INSTALLER_SHA}`,
        browser_download_url: `https://${assetHost}/gd-${version}.exe` },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const assetName = (suffix, version) =>
  suffix === '.dmg' ? `GD Suits Studio-${version}.dmg` : `GD Suits Studio-${version}-${suffix}`;

require('../electron/main.js');
const updater = require('../electron/updater.js');
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 2400));
  const win = BrowserWindow.getAllWindows()[0];
  const run = (js) => win.webContents.executeJavaScript(js);

  log('=== a newer version is published ===');
  let r = JSON.parse(await run(`gd.updates.check().then(JSON.stringify)`));
  check(r.ok, 'check succeeds', JSON.stringify(r.error));
  check(r.data?.updateAvailable === true, 'update reported as available');
  check(r.data?.version === NEWER, 'version parsed from the tag', r.data?.version);
  check(r.data?.current === INSTALLED, 'current version read from the bundle', r.data?.current);
  check(/arm64\.dmg$/.test(r.data?.downloadName ?? ''), 'the arm64 build is chosen for this machine', r.data?.downloadName);
  check((r.data?.notes ?? '').includes('3D preview'), 'release notes carried through');

  log('\n=== already on the latest ===');
  mode = 'same';
  r = JSON.parse(await run(`gd.updates.check().then(JSON.stringify)`));
  check(r.data?.updateAvailable === false, 'no update offered when versions match');

  log('\n=== the name a release file may be saved under ===');
  check(updater.safeAssetName('GD Suits Studio-0.9.0-arm64.dmg') === 'GD Suits Studio-0.9.0-arm64.dmg',
    'an ordinary installer name is kept as it is');
  check(updater.safeAssetName('../../../../etc/cron.d/evil.dmg') === 'evil.dmg',
    'a name that climbs out of the folder is reduced to its last part',
    String(updater.safeAssetName('../../../../etc/cron.d/evil.dmg')));
  check(updater.safeAssetName('install.command') === null, 'a .command is not an installer this app will save');
  check(updater.safeAssetName('notes.txt') === null && updater.safeAssetName('') === null,
    'nor anything else that is not an installer');

  log('\n=== where a download may come from ===');
  const feed = 'https://api.github.com/repos/Yudhi69/gd-suits-studio/releases/latest';
  check(updater.allowedDownload(feed, 'https://github.com/Yudhi69/x/releases/download/v1/a.dmg'),
    'github serves the file for a github feed');
  check(updater.allowedDownload(feed, 'https://objects.githubusercontent.com/x/a.dmg'),
    'and so does the host github redirects to');
  check(!updater.allowedDownload(feed, 'https://elsewhere.example/a.dmg'),
    'a file from somewhere else entirely is refused');
  check(!updater.allowedDownload(feed, 'http://github.com/a.dmg'), 'plain http is refused');
  check(updater.allowedDownload('https://gdsuits.co.za/feed.json', 'https://gdsuits.co.za/app.dmg'),
    "his own server may serve its own downloads");
  check(!updater.allowedDownload('https://gdsuits.co.za/feed.json', 'https://github.com/a.dmg'),
    'but it may not send the download to github');

  log('\n=== downloading the update ===');
  mode = 'newer';
  assetHost = 'github.com';
  served = null; redirectTo = null;
  await run(`gd.settings.set({ key: 'updateFeed', value: ${JSON.stringify(feed)} })`);
  await run(`gd.updates.check()`);
  // The window is told how far it has got; that is the only thing sent back.
  await run(`window.__progress = []; window.gd.updates.onProgress(p => window.__progress.push(p)); true;`);
  r = JSON.parse(await run(`gd.updates.fetch().then(JSON.stringify)`));
  check(r.ok, 'the download succeeds', JSON.stringify(r.error));
  check(r.data?.verified === 'digest', 'and is checked against the fingerprint the release states', r.data?.verified);
  const saved = r.data ? path.join(DOWNLOADS, r.data.name) : '';
  check(saved && fs.existsSync(saved) && fs.readFileSync(saved).equals(INSTALLER),
    'the file on disk is the file the release published', r.data?.name);
  check(fs.existsSync(saved) && (fs.statSync(saved).mode & 0o111) === 0,
    'and it is not executable - this app never runs what it downloads');
  check(fs.readdirSync(DOWNLOADS).every((f) => !f.endsWith('.part')),
    'nothing half-downloaded is left behind', fs.readdirSync(DOWNLOADS).join(', '));
  const reported = JSON.parse(await run(`JSON.stringify(window.__progress)`));
  check(reported.length > 0 && reported[reported.length - 1].bytes === INSTALLER.length,
    'the window was told how far it had got', JSON.stringify(reported.slice(-1)));

  log('\n=== a second download does not overwrite the first ===');
  await run(`gd.updates.check()`);
  r = JSON.parse(await run(`gd.updates.fetch().then(JSON.stringify)`));
  check(r.ok && r.data.name !== path.basename(saved) && fs.existsSync(path.join(DOWNLOADS, r.data.name)),
    'it is given a name of its own', r.data?.name);

  log('\n=== a download that is not what the release says it is ===');
  served = Buffer.alloc(INSTALLER.length, 9); // right length, wrong bytes
  await run(`gd.updates.check()`);
  const beforeTampered = fs.readdirSync(DOWNLOADS).length;
  r = JSON.parse(await run(`gd.updates.fetch().then(JSON.stringify)`));
  check(!r.ok && r.error?.code === 'digest_mismatch', 'an altered file is refused', JSON.stringify(r.error));
  check(fs.readdirSync(DOWNLOADS).length === beforeTampered, 'and nothing of it is kept');

  served = Buffer.alloc(32, 1); // truncated
  await run(`gd.updates.check()`);
  r = JSON.parse(await run(`gd.updates.fetch().then(JSON.stringify)`));
  check(!r.ok && (r.error?.code === 'size_mismatch' || r.error?.code === 'incomplete'),
    'a file that does not arrive whole is refused', JSON.stringify(r.error));

  log('\n=== a feed that points the download somewhere else ===');
  served = null;
  assetHost = 'elsewhere.example';
  await run(`gd.updates.check()`);
  r = JSON.parse(await run(`gd.updates.fetch().then(JSON.stringify)`));
  check(!r.ok, 'a release that hosts its file off github is not downloaded', JSON.stringify(r.data));
  check(!fs.readdirSync(DOWNLOADS).some((f) => f.includes('elsewhere')), 'and nothing of it reached the disk');

  assetHost = 'github.com';
  redirectTo = 'https://elsewhere.example/gd.dmg';
  await run(`gd.updates.check()`);
  r = JSON.parse(await run(`gd.updates.fetch().then(JSON.stringify)`));
  check(!r.ok && r.error?.code === 'bad_host',
    'nor is one that starts at github and ends up elsewhere', JSON.stringify(r.error));
  redirectTo = null;

  log('\n=== what a hostile page gets ===');
  // The renderer never names the file. It asks for "the update", and the
  // address is the one this process fetched and checked itself.
  const surface = JSON.parse(await run(`JSON.stringify(Object.keys(window.gd.updates))`));
  check(!surface.includes('fetchFrom') && surface.includes('fetch'),
    'there is no channel that takes an address to download', JSON.stringify(surface));
  // elsewhere.example is a host this test's stub really does serve, so a
  // version that honoured the address would put a file on the disk, and this
  // would say so. Naming a host that does not answer would let the check pass
  // for the wrong reason.
  const beforeHostile = fs.readdirSync(DOWNLOADS);
  r = JSON.parse(await run(`gd.updates.fetch({ url: 'https://elsewhere.example/x.dmg', name: 'x.dmg' }).then(JSON.stringify)`));
  const added = fs.readdirSync(DOWNLOADS).filter((f) => !beforeHostile.includes(f));
  check(r.ok && added.length === 1 && added[0].startsWith(`GD Suits Studio-${NEWER}`),
    'an address and a name passed anyway are both ignored - what arrives is the release',
    JSON.stringify({ added, error: r.error }));

  log('\n=== the buttons a tailor actually presses ===');
  mode = 'newer'; assetHost = 'github.com'; served = null; redirectTo = null;
  const ui = await run(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const find = (t) => [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(t));
    [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Settings')).click(); await wait(700);
    [...document.querySelectorAll('.step-tab')].find(b => b.textContent.includes('Updates')).click(); await wait(400);
    find('Check for updates').click(); await wait(1200);
    const offered = !!find(${JSON.stringify('Download ' + NEWER)});
    find(${JSON.stringify('Download ' + NEWER)}).click(); await wait(1800);
    const show = find('Show in Finder') ?? find('Show in folder');
    show?.click(); await wait(500);
    return JSON.stringify({
      offered,
      reveal: !!show,
      stillOffering: !!find(${JSON.stringify('Download ' + NEWER)}),
      says: document.querySelector('.banner-ok, .banner.ok')?.textContent ?? document.body.textContent.includes('Downloads folder'),
    });
  })()`).then(JSON.parse);
  check(ui.offered, 'after checking, the Updates page offers the new version');
  check(ui.reveal && !ui.stillOffering, 'pressing it downloads, and then offers to show the file', JSON.stringify(ui));
  check(String(ui.says).includes('Downloads') || ui.says === true,
    'and says where it went', String(ui.says).slice(0, 120));
  check(revealed.length > 0 && revealed[revealed.length - 1].startsWith(DOWNLOADS),
    'and pressing that button shows the file it just saved', JSON.stringify(revealed.slice(-1)));

  log('\n=== the download is never executed by the app ===');
  r = JSON.parse(await run(`gd.updates.download({ url: 'file:///etc/passwd' }).then(JSON.stringify)`));
  check(!r.ok, 'a file:// download address is refused', JSON.stringify(r.data));
  r = JSON.parse(await run(`gd.updates.download({ url: 'javascript:alert(1)' }).then(JSON.stringify)`));
  check(!r.ok, 'a javascript: download address is refused');

  log('\n=== insecure feed ===');
  await run(`gd.settings.set({ key: 'updateFeed', value: 'http://example.com/feed.json' })`);
  r = JSON.parse(await run(`gd.updates.check().then(JSON.stringify)`));
  check(!r.ok && /https/i.test(r.error?.message ?? ''), 'a plain http feed is refused', r.error?.message);

  log('\n=== the real feed, against the private repo ===');
  mode = 'passthrough';
  await run(`gd.settings.set({ key: 'updateFeed', value: 'https://api.github.com/repos/Yudhi69/gd-suits-studio/releases/latest' })`);
  r = JSON.parse(await run(`gd.updates.check().then(JSON.stringify)`));
  log('  ->', r.ok ? 'succeeded: ' + r.data.version : r.error.code + ': ' + r.error.message);
  check(!r.ok || r.data, 'the real endpoint answers without crashing');

  fs.rmSync(DOWNLOADS, { recursive: true, force: true });
  log(`\n${fail === 0 ? 'ALL UPDATE CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
