/**
 * Every Mac release is signed with the project's own certificate.
 *
 * build/afterPack.js signs the packed app, innermost first, with the
 * certificate installer.js names as SIGNER - and an installed copy installs an
 * update only if it carries that same certificate. This suite signs a copy of
 * Electron's own app with afterPack's routine, using a throwaway certificate
 * in a keychain made by build/mac-keychain.sh (the release's script), then
 * checks it the way macOS and the installer will: every layer signed, the
 * bundle named by its certificate, the app still starts - helpers and all -
 * and the installer's gate takes it under that certificate and no other.
 *
 * The project's real certificate is not here and is never used: its private
 * key lives in the release job's secrets. Only its public half is checked.
 *
 * macOS only. Opens one hidden window, briefly, in a copy of Electron with a
 * data folder of its own.
 */
const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (process.platform !== 'darwin') {
  process.stdout.write('signing suite: macOS only, skipped\n');
  process.exit(0);
}

const installer = require('../electron/installer.js');
const afterPack = require('../build/afterPack.js');
const { throwawaySigner } = require('./signer.js');

let pass = 0, fail = 0;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };
const sh = (file, args) => childProcess.execFileSync(file, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
/** What codesign says about `target` - some of it on stdout, the rest on stderr. */
const describe = (target, ...args) => {
  const out = childProcess.spawnSync('/usr/bin/codesign', ['-d', ...args, target], { encoding: 'utf8' });
  return `${out.stdout}${out.stderr}`;
};
const refusal = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const WORK = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gd-signing-')));
const ELECTRON = path.join(path.dirname(require.resolve('electron')), 'dist', 'Electron.app');
const VERSION = '9.9.9';
let signer = null;

function cleanUp() {
  signer?.remove();
  fs.rmSync(WORK, { recursive: true, force: true });
}

/** A copy of Electron dressed as this app at VERSION, unsigned for the moment. */
function copyOfApp(name) {
  const bundle = path.join(WORK, name, installer.BUNDLE_NAME);
  fs.mkdirSync(path.dirname(bundle));
  sh('/usr/bin/ditto', [ELECTRON, bundle]);
  const plist = path.join(bundle, 'Contents', 'Info.plist');
  sh('/usr/bin/plutil', ['-replace', 'CFBundleIdentifier', '-string', installer.APP_ID, plist]);
  sh('/usr/bin/plutil', ['-replace', 'CFBundleShortVersionString', '-string', VERSION, plist]);
  return bundle;
}

/** Starts `bundle` on a tiny app that opens a hidden window and quits with 7. */
function launch(bundle) {
  const tiny = path.join(WORK, 'tiny');
  fs.mkdirSync(tiny, { recursive: true });
  fs.writeFileSync(path.join(tiny, 'package.json'), JSON.stringify({ name: 'gd-signing-check', main: 'main.js' }));
  fs.writeFileSync(path.join(tiny, 'main.js'), `
    const { app, BrowserWindow } = require('electron');
    app.setPath('userData', process.env.GD_SIGNING_DATA);
    app.dock?.hide();
    setTimeout(() => app.exit(8), 30000);
    app.on('render-process-gone', () => app.exit(9));
    app.whenReady().then(async () => {
      const win = new BrowserWindow({ show: false });
      await win.loadURL('data:text/html,<p>signed</p>');
      app.exit((await win.webContents.executeJavaScript('6 * 7')) === 42 ? 7 : 10);
    }).catch(() => app.exit(11));
  `);
  const env = { ...process.env, GD_SIGNING_DATA: path.join(WORK, 'data') };
  delete env.ELECTRON_RUN_AS_NODE;
  const exe = path.join(bundle, 'Contents', 'MacOS', 'Electron');
  return childProcess.spawnSync(exe, [tiny], { env, stdio: 'ignore', timeout: 60000 }).status;
}

(async () => {
  log('=== the project\'s certificate ===');
  const pem = fs.readFileSync(path.join(__dirname, '..', 'build', 'signing-cert.pem'), 'utf8');
  const cert = new crypto.X509Certificate(pem);
  check(cert.fingerprint.replace(/:/g, '').toLowerCase() === installer.SIGNER,
    'the certificate installed copies insist on is the one in build/signing-cert.pem', cert.fingerprint);
  check(!/PRIVATE KEY/.test(pem) && pem.trim().split('\n').filter((l) => l.startsWith('-----BEGIN')).length === 1,
    'that file holds the certificate alone - its key is not in the repository');
  check(cert.subject.trim() === 'CN=GD Suits Studio' && cert.ca === false, 'it names the app, and can vouch for nothing else',
    cert.subject);
  check((cert.keyUsage ?? []).includes('1.3.6.1.5.5.7.3.3'), 'it is for signing code', String(cert.keyUsage));
  check(new Date(cert.validTo) > new Date('2045-01-01'), 'and lasts until 2045 at least - a new one would orphan every copy',
    cert.validTo);

  log('\n=== signed as a release is signed ===');
  signer = throwawaySigner(WORK, 'GD Signing Suite');
  const ours = copyOfApp('ours');
  const started = Date.now();
  afterPack.signMacApp(ours, { identity: signer.sha1, keychain: signer.keychain });
  log(`    (signed in ${((Date.now() - started) / 1000).toFixed(1)}s)`);
  check(describe(ours, '-r-').includes(`designated => identifier "${installer.APP_ID}" and certificate leaf = H"${signer.sha1}"`),
    'macOS names the app by its certificate, not by this one build', describe(ours, '-r-'));
  const frameworks = path.join(ours, 'Contents', 'Frameworks');
  const nested = [
    ...fs.readdirSync(frameworks).map((f) => path.join(frameworks, f)),
    path.join(frameworks, 'Electron Framework.framework', 'Versions', 'A', 'Helpers', 'chrome_crashpad_handler'),
    path.join(frameworks, 'Electron Framework.framework', 'Versions', 'A', 'Libraries', 'libEGL.dylib'),
  ];
  const unsigned = nested.filter((n) => !describe(n, '-vv').includes(`Authority=${signer.name}`));
  check(nested.length > 5 && unsigned.length === 0, `every layer inside carries the same certificate (${nested.length} checked)`,
    unsigned.map((n) => path.relative(ours, n)).join(', '));
  check(childProcess.spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', ours]).status === 0,
    'the whole bundle verifies, deep and strict');
  const status = launch(ours);
  check(status === 7, 'it starts, opens a window and runs a page - so the helpers start too', `exit ${status}`);

  log('\n=== what the installer takes as an update ===');
  check(refusal(() => installer.verifyBundle(ours, VERSION, signer.sha1)) === null,
    'the installer accepts a bundle afterPack signed, under that certificate');
  const real = refusal(() => installer.verifyBundle(ours, VERSION));
  check(real?.code === 'wrong_signer', 'but not under the project\'s certificate, which it was not signed with', real?.code ?? 'accepted');

  const laptop = copyOfApp('laptop');
  afterPack.signMacApp(laptop, { identity: '-' });
  check(/designated => cdhash H"/.test(describe(laptop, '-r-')), 'a build with no certificate is signed ad hoc, named by its hash');
  check(launch(laptop) === 7, '  and still runs');
  const adHoc = refusal(() => installer.verifyBundle(laptop, VERSION, signer.sha1));
  check(adHoc?.code === 'wrong_signer', '  but is never taken as an update', adHoc?.code ?? 'accepted');

  fs.writeFileSync(path.join(ours, 'Contents', 'Resources', 'added.txt'), 'added after signing');
  const changed = refusal(() => installer.verifyBundle(ours, VERSION, signer.sha1));
  check(changed?.code === 'bad_signature', 'a signed bundle changed afterwards is refused', changed?.code ?? 'accepted');

  log('\n=== the release build ===');
  const context = (dir) => ({
    electronPlatformName: 'darwin',
    appOutDir: dir,
    packager: { appInfo: { productFilename: 'GD Suits Studio' }, config: { mac: { identity: null } } },
  });
  const saved = { CI: process.env.CI, GD_MAC_SIGN_KEYCHAIN: process.env.GD_MAC_SIGN_KEYCHAIN };
  process.env.CI = 'true';
  delete process.env.GD_MAC_SIGN_KEYCHAIN;
  const unsignedOnCi = await afterPack.default(context(path.join(WORK, 'nowhere'))).then(() => null, (e) => e);
  check(/GD_MAC_SIGN_KEYCHAIN/.test(unsignedOnCi?.message ?? ''), 'a build on CI with no signing keychain stops before anything is built',
    unsignedOnCi?.message ?? 'went ahead');
  // A keychain holding some other certificate: the hook asks it for the
  // project's, and there is none.
  process.env.GD_MAC_SIGN_KEYCHAIN = signer.keychain;
  const otherCert = await afterPack.default(context(path.dirname(laptop))).then(() => null, (e) => e);
  check(!!otherCert && !/GD_MAC_SIGN_KEYCHAIN/.test(otherCert.message),
    'and one whose keychain holds any certificate but the project\'s cannot sign', otherCert ? '' : 'it signed');
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }

  log('\n=== left as found ===');
  check(!sh('/usr/bin/security', ['list-keychains', '-d', 'user']).includes(WORK),
    'the suite\'s keychain was never added to the keychain search list');

  cleanUp();
  log(`\n${fail === 0 ? 'ALL SIGNING CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  log('HARNESS FAIL', e.stack);
  cleanUp();
  process.exit(1);
});
