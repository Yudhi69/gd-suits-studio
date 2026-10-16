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
let slowly = false;     // deliver it in chunks, the way a real one arrives
global.fetch = async (url, opts) => {
  const u = String(url);
  if (/^https:\/\/(github\.com|objects\.githubusercontent\.com|elsewhere\.example)\//.test(u)) {
    const body = served ?? INSTALLER;
    // Delivered in chunks over time when asked, because an instant download
    // reports progress once and the bar's whole life collapses into a single
    // render - which is not how a hundred megabytes arrives.
    const payload = slowly
      ? new ReadableStream({
          async start(controller) {
            const size = Math.ceil(body.length / 4);
            for (let i = 0; i < body.length; i += size) {
              controller.enqueue(new Uint8Array(body.subarray(i, i + size)));
              await new Promise((r) => setTimeout(r, 220));
            }
            controller.close();
          },
        })
      : body;
    const res = new Response(payload, {
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

// Empties the stand-in Downloads folder - the tailor deleting what was saved.
const clearDownloads = () => {
  for (const f of fs.readdirSync(DOWNLOADS)) fs.rmSync(path.join(DOWNLOADS, f), { force: true });
};

// What the page scripts below share: waiting, finding a button by its words,
// and whether any button offers a download.
const PAGE_HELPERS = `
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const find = (t) => [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(t));
  const offering = () => [...document.querySelectorAll('button')].some(b => /^Download\\b/.test(b.textContent.trim()));
`;

// Opens Settings at its Updates tab, from wherever the window is.
const OPEN_UPDATES = `
  [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Orders')).click(); await wait(400);
  [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Settings')).click(); await wait(700);
  [...document.querySelectorAll('.step-tab')].find(b => b.textContent.includes('Updates')).click(); await wait(400);
`;

const assetName = (suffix, version) =>
  suffix === '.dmg' ? `GD Suits Studio-${version}.dmg` : `GD Suits Studio-${version}-${suffix}`;

require('../electron/main.js');
const updater = require('../electron/updater.js');
// The same module main has open, so a record written here is the one it reads.
const db = require('../electron/db.js');
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

  log('\n=== the same release is never downloaded twice ===');
  // The copy that is running stays the old version until the new one is
  // installed, so the release goes on being "available". Every check used to
  // offer it again and every press saved another copy: three of 0.1.20 sat in
  // the Downloads folder of the machine this was found on.
  const first = path.basename(saved);
  r = JSON.parse(await run(`gd.updates.check().then(JSON.stringify)`));
  check(r.data?.updateAvailable === true && r.data?.downloaded?.name === first && r.data.downloaded.already === true,
    'a check after downloading says the file is already there', JSON.stringify(r.data?.downloaded));
  const beforeAgain = fs.readdirSync(DOWNLOADS).length;
  r = JSON.parse(await run(`gd.updates.fetch().then(JSON.stringify)`));
  check(r.ok && r.data?.name === first && r.data?.already === true,
    'asking for it again hands back that file', JSON.stringify(r.data ?? r.error));
  check(fs.readdirSync(DOWNLOADS).length === beforeAgain,
    'and no second copy is saved', fs.readdirSync(DOWNLOADS).join(', '));

  fs.rmSync(saved);
  r = JSON.parse(await run(`gd.updates.check().then(JSON.stringify)`));
  check(r.ok && r.data?.updateAvailable === true && !r.data?.downloaded,
    'once that file is deleted, the release is offered again', JSON.stringify(r.data?.downloaded));
  r = JSON.parse(await run(`gd.updates.fetch().then(JSON.stringify)`));
  check(r.ok && r.data?.name === first && !r.data?.already && fs.existsSync(saved),
    'and downloading it again works', JSON.stringify(r.data ?? r.error));

  log('\n=== a file of the same name that is not the release ===');
  fs.writeFileSync(saved, 'not the installer');
  r = JSON.parse(await run(`gd.updates.check().then(JSON.stringify)`));
  check(r.ok && !r.data?.downloaded, 'a file changed since it was saved is not passed off as the download',
    JSON.stringify(r.data?.downloaded));
  r = JSON.parse(await run(`gd.updates.fetch().then(JSON.stringify)`));
  check(r.ok && r.data.name !== first && fs.existsSync(path.join(DOWNLOADS, r.data.name)),
    'the release is saved under a name of its own', r.data?.name);
  check(fs.readFileSync(saved, 'utf8') === 'not the installer', 'and the other file is not overwritten');

  log('\n=== a record of a download that is not to be believed ===');
  const asset = JSON.parse(await run(`gd.updates.check().then(JSON.stringify)`)).data?.downloadName ?? '';
  const planted = (over) => ({ version: NEWER, asset, bytes: INSTALLER.length, sha256: INSTALLER_SHA, verified: 'digest', ...over });
  const outside = path.join(os.tmpdir(), `gd-updates-outside-${process.pid}.dmg`);
  fs.writeFileSync(outside, INSTALLER);
  db.setSetting('updateDownload', planted({ path: outside }));
  r = JSON.parse(await run(`gd.updates.check().then(JSON.stringify)`));
  check(r.ok && !r.data?.downloaded, 'a file outside the Downloads folder is never claimed', JSON.stringify(r.data?.downloaded));
  fs.rmSync(outside, { force: true });
  const inside = path.join(DOWNLOADS, asset);
  fs.writeFileSync(inside, INSTALLER);
  db.setSetting('updateDownload', planted({ path: inside, sha256: 'f'.repeat(64) }));
  r = JSON.parse(await run(`gd.updates.check().then(JSON.stringify)`));
  check(r.ok && !r.data?.downloaded, 'nor one whose fingerprint is not the release\'s', JSON.stringify(r.data?.downloaded));
  db.setSetting('updateDownload', planted({ path: inside, version: INSTALLED }));
  r = JSON.parse(await run(`gd.updates.check().then(JSON.stringify)`));
  check(r.ok && !r.data?.downloaded, 'nor a download of a different version', JSON.stringify(r.data?.downloaded));
  db.setSetting('updateDownload', planted({ path: inside }));
  r = JSON.parse(await run(`gd.updates.check().then(JSON.stringify)`));
  check(r.ok && r.data?.downloaded?.name === asset, 'the same record, true in every part, is believed',
    JSON.stringify(r.data?.downloaded));
  // Only main writes it. A page that could would point "Show in Finder" at
  // anything, or hide a real update behind a file that is not there.
  r = JSON.parse(await run(`gd.settings.get({ key: 'updateDownload' }).then(JSON.stringify)`));
  check(!r.ok, 'the page cannot read where the download is kept', JSON.stringify(r.data));
  r = JSON.parse(await run(`gd.settings.set({ key: 'updateDownload', value: { path: '/etc/hosts' } }).then(JSON.stringify)`));
  check(!r.ok && db.getSetting('updateDownload').path === inside, 'nor write one of its own', JSON.stringify(r.error));
  clearDownloads();

  log('\n=== a download that is not what the release says it is ===');
  served = Buffer.alloc(INSTALLER.length, 9); // right length, wrong bytes
  clearDownloads();
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
  clearDownloads();
  const beforeHostile = fs.readdirSync(DOWNLOADS);
  r = JSON.parse(await run(`gd.updates.fetch({ url: 'https://elsewhere.example/x.dmg', name: 'x.dmg' }).then(JSON.stringify)`));
  const added = fs.readdirSync(DOWNLOADS).filter((f) => !beforeHostile.includes(f));
  check(r.ok && added.length === 1 && added[0].startsWith(`GD Suits Studio-${NEWER}`),
    'an address and a name passed anyway are both ignored - what arrives is the release',
    JSON.stringify({ added, error: r.error }));

  log('\n=== the buttons a tailor actually presses ===');
  mode = 'newer'; assetHost = 'github.com'; served = null; redirectTo = null; slowly = true;
  clearDownloads();
  await run(`window.__errors = []; window.addEventListener('unhandledrejection', e => window.__errors.push(String(e.reason && e.reason.message || e.reason))); true;`);
  const ui = await run(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const find = (t) => [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(t));
    [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Settings')).click(); await wait(700);
    [...document.querySelectorAll('.step-tab')].find(b => b.textContent.includes('Updates')).click(); await wait(400);
    find('Check for updates').click(); await wait(1200);
    const offered = !!find(${JSON.stringify('Download ' + NEWER)});
    // Watched from before the click: the bar can come and go inside the
    // download, and looking afterwards would miss it either way.
    let sawBar = false;
    const watcher = new MutationObserver(() => {
      if (document.querySelector('.progress-track')) sawBar = true;
    });
    watcher.observe(document.body, { childList: true, subtree: true });
    find(${JSON.stringify('Download ' + NEWER)}).click(); await wait(2600);
    watcher.disconnect();
    // Any error thrown by the page, including one thrown on mount.
    const pageErrors = window.__errors ?? [];
    const show = find('Show in Finder') ?? find('Show in folder');
    show?.click(); await wait(500);
    return JSON.stringify({
      offered,
      reveal: !!show,
      stillOffering: !!find(${JSON.stringify('Download ' + NEWER)}),
      sawBar, pageErrors,
      says: document.querySelector('.banner-ok, .banner.ok')?.textContent ?? document.body.textContent.includes('Downloads folder'),
    });
  })()`).then(JSON.parse);
  check(ui.offered, 'after checking, the Updates page offers the new version');
  // Driven through the page's own wrapper, not the bridge underneath it: the
  // subscription was broken for weeks because the test reached past the layer
  // that was broken.
  check(ui.sawBar, 'the progress bar appears while the download runs', JSON.stringify(ui.sawBar));
  check((ui.pageErrors ?? []).length === 0,
    'and the page throws nothing while doing it', JSON.stringify(ui.pageErrors));
  check(ui.reveal && !ui.stillOffering, 'pressing it downloads, and then offers to show the file', JSON.stringify(ui));
  check(String(ui.says).includes('Downloads') || ui.says === true,
    'and says where it went', String(ui.says).slice(0, 120));
  check(revealed.length > 0 && revealed[revealed.length - 1].startsWith(DOWNLOADS),
    'and pressing that button shows the file it just saved', JSON.stringify(revealed.slice(-1)));

  log('\n=== checking again once it is downloaded ===');
  const again = await run(`(async () => {
    ${PAGE_HELPERS}
    const look = () => ({
      offering: offering(),
      shows: !!(find('Show in Finder') ?? find('Show in folder')),
      says: document.body.textContent.includes('Already in your Downloads folder'),
    });
    find('Check for updates').click(); await wait(1200);
    const checked = look();
    // Leaving Settings and coming back starts the page from nothing, which is
    // what a relaunch does to it.
    ${OPEN_UPDATES}
    find('Check for updates').click(); await wait(1200);
    return JSON.stringify({ checked, returned: look() });
  })()`).then(JSON.parse);
  check(!again.checked.offering && again.checked.shows && again.checked.says,
    'checking again shows the file already saved and offers no second download', JSON.stringify(again.checked));
  check(!again.returned.offering && again.returned.shows,
    'and so does a fresh visit to the page', JSON.stringify(again.returned));
  check(fs.readdirSync(DOWNLOADS).length === 1, 'one copy in the folder, however often it is checked',
    fs.readdirSync(DOWNLOADS).join(', '));

  // The flag in the sidebar comes from the check made on launch.
  await run(`gd.settings.set({ key: 'autoCheckUpdates', value: true })`);
  win.webContents.reload();
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  await new Promise((r) => setTimeout(r, 1500));
  const flag = await run(`document.querySelector('.update-flag')?.textContent ?? ''`);
  check(flag.includes(NEWER) && /downloaded/i.test(flag) && !/available/i.test(flag),
    'on launch, the sidebar says it is downloaded rather than available', flag);
  await run(`gd.settings.set({ key: 'autoCheckUpdates', value: false })`);

  log('\n=== on the latest version, nothing is offered ===');
  mode = 'same';
  const latest = await run(`(async () => {
    ${PAGE_HELPERS}
    ${OPEN_UPDATES}
    find('Check for updates').click(); await wait(1200);
    return JSON.stringify({
      upToDate: document.body.textContent.includes('Up to date'),
      offering: offering(),
      page: !!find('Open the release page'),
      shows: !!(find('Show in Finder') ?? find('Show in folder')),
    });
  })()`).then(JSON.parse);
  check(latest.upToDate && !latest.offering && !latest.page && !latest.shows,
    'Updates says it is up to date and offers nothing to download', JSON.stringify(latest));
  const beforeLatest = fs.readdirSync(DOWNLOADS).length;
  r = JSON.parse(await run(`gd.updates.fetch().then(JSON.stringify)`));
  check(!r.ok && fs.readdirSync(DOWNLOADS).length === beforeLatest,
    'and a download asked for anyway is refused', JSON.stringify(r.error));
  mode = 'newer';

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
