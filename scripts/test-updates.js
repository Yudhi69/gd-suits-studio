const { app, BrowserWindow } = require('electron');
const path = require('path');
app.setPath('userData', path.resolve(process.env.DATA_DIR));

// Stub the release feed so the whole flow can be exercised without publishing.
const realFetch = global.fetch;
let mode = 'newer';
global.fetch = async (url, opts) => {
  const u = String(url);
  if (!u.includes('api.github.com')) return realFetch(url, opts);
  if (mode === 'passthrough') return realFetch(url, opts);
  const version = mode === 'newer' ? '0.9.0' : '0.1.0';
  return new Response(JSON.stringify({
    tag_name: `v${version}`,
    name: `GD Suits Studio ${version}`,
    body: 'Adds a turnable 3D preview.\nFixes the lapel width rounding.',
    html_url: 'https://github.com/Yudhi69/gd-suits-studio/releases/tag/v' + version,
    published_at: '2026-09-15T10:00:00Z',
    draft: false, prerelease: false,
    assets: [
      { name: `GD Suits Studio-${version}-arm64.dmg`, browser_download_url: `https://example.com/gd-${version}-arm64.dmg` },
      { name: `GD Suits Studio-${version}.dmg`, browser_download_url: `https://example.com/gd-${version}.dmg` },
      { name: `GD Suits Studio Setup ${version}.exe`, browser_download_url: `https://example.com/gd-${version}.exe` },
    ],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

require('../electron/main.js');
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
  check(r.data?.version === '0.9.0', 'version parsed from the tag', r.data?.version);
  check(r.data?.current === '0.1.0', 'current version read from the bundle', r.data?.current);
  check(/arm64\.dmg$/.test(r.data?.downloadName ?? ''), 'the arm64 build is chosen for this machine', r.data?.downloadName);
  check((r.data?.notes ?? '').includes('3D preview'), 'release notes carried through');

  log('\n=== already on the latest ===');
  mode = 'same';
  r = JSON.parse(await run(`gd.updates.check().then(JSON.stringify)`));
  check(r.data?.updateAvailable === false, 'no update offered when versions match');

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

  log(`\n${fail === 0 ? 'ALL UPDATE CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
