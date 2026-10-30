'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

// Electron's own fs opens an app.asar as though it were a folder of the files
// packed inside it. So removing a real app bundle with it calls rmdir on what
// is a file, fails with ENOTDIR, and leaves the bundle where it was - after
// which every update stops at the same clean-up, for good. original-fs is
// Node's fs without that; outside Electron there is nothing to undo.
const plainFs = (() => {
  try { return require('original-fs'); } catch { return fs; }
})();

/** Removes `dir` and everything in it - app bundles included. */
function removeTree(dir) {
  plainFs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Installing an update in place.
 *
 * The tailor presses Install, and the next time the app starts it is the new
 * version - no file to find, no window to drag, nothing to replace by hand.
 *
 * Electron's own updater cannot do this here. Squirrel only accepts a
 * replacement that meets the running copy's own signature requirement, and
 * every copy released before October 2026 was ad-hoc signed - a requirement
 * naming that one build and nothing else. So the swap is done the way an
 * installer would do it, and everything that lets this app run what it
 * downloaded is a gate that has to be passed first:
 *
 *   - Only a release from this app's own GitHub repository, read from the
 *     official feed, with a file hosted under that repository's releases. A
 *     custom update address can still download, but never installs: the
 *     address is a setting, and a setting is not a reason to run code.
 *   - Only when GitHub states the file's SHA-256, and the bytes match it.
 *   - On a Mac, only an app bundle with this app's identifier and exactly the
 *     version the release names, signed with this app's own certificate and
 *     unchanged since - checked when it is unpacked and again just before it
 *     goes in.
 *   - Only in an installed copy, somewhere this account can write.
 *
 * Anything that fails a gate falls back to the download the tailor installs
 * by hand, with the reason shown.
 */

const OFFICIAL_FEED = 'https://api.github.com/repos/Yudhi69/gd-suits-studio/releases/latest';
// A file of one of this repository's releases: .../releases/download/<tag>/<file>.
const OFFICIAL_FILE = /^https:\/\/github\.com\/Yudhi69\/gd-suits-studio\/releases\/download\/[^/?#]+\/[^/?#]+$/i;
const APP_ID = 'za.co.gdsuits.studio';
const BUNDLE_NAME = 'GD Suits Studio.app';

/**
 * The certificate every Mac release is signed with, by its SHA-1 - which is
 * how macOS names a certificate in a code requirement. It is the one in
 * build/signing-cert.pem. Made for this project rather than issued by Apple:
 * it says a release came from this project's build, not that Apple has seen it.
 *
 * An update signed with anything else does not install itself; it is offered
 * as a download instead. To change certificate, first ship a release that
 * accepts both - copies that predate it accept only this one.
 */
const SIGNER = '25294558ac2e19e7255e2e5e1c29b7b744120d62';

class InstallError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'InstallError';
    this.code = code;
  }
}

/**
 * Why this release may not be installed by the app itself, or null if it may.
 * `release` is what main's own check fetched, with the feed it came from.
 */
function officialRelease(release) {
  if (release?.feedUrl !== OFFICIAL_FEED) {
    return 'Updates from a custom update address are downloaded for you to install by hand.';
  }
  let href;
  try {
    // Compared after the URL is parsed, so "../" cannot walk out of the repository.
    href = new URL(String(release.downloadUrl ?? '')).href;
  } catch {
    href = '';
  }
  if (!OFFICIAL_FILE.test(href)) return 'This release has no file the app installs by itself.';
  if (!/^sha256:[0-9a-f]{64}$/i.test(String(release.downloadDigest ?? ''))) {
    return 'This release has no fingerprint to check its file against, so it is downloaded for you to install by hand.';
  }
  return null;
}

/**
 * Where this copy is installed, or why it cannot be replaced from inside.
 *
 * `testTarget` stands in for the bundle path in the test suites, and main
 * only passes it when the app is not packaged.
 */
function installTarget({ platform, packaged, exePath, testTarget }) {
  if (!packaged && !testTarget) {
    return { reason: 'This copy runs from source, so it is not replaced by an update.' };
  }
  if (platform === 'win32') return { target: path.dirname(exePath) };
  if (platform !== 'darwin') return { reason: 'Updates install themselves on Mac and Windows only.' };

  // .../GD Suits Studio.app/Contents/MacOS/GD Suits Studio
  let bundle = testTarget || path.resolve(exePath, '..', '..', '..');
  try {
    bundle = fs.realpathSync(bundle);
  } catch {
    return { reason: 'This copy could not find its own app bundle.' };
  }
  if (!bundle.endsWith('.app')) return { reason: 'This copy is not inside an app bundle.' };
  if (bundle.includes('/AppTranslocation/')) {
    return {
      reason: 'macOS is running this copy from a protected temporary place. Drag GD Suits Studio into ' +
        'Applications and open it from there - after that, updates install themselves.',
    };
  }
  const parent = path.dirname(bundle);
  try {
    fs.accessSync(parent, fs.constants.W_OK);
    fs.accessSync(bundle, fs.constants.W_OK);
  } catch {
    return {
      reason: bundle.startsWith('/Volumes/')
        ? 'This copy is running from the installer disk. Drag it into Applications and open it from there - ' +
          'after that, updates install themselves.'
        : `Your account cannot change the folder this copy is in (${parent}), so the update is downloaded ` +
          'for you to install by hand.',
    };
  }
  return { target: bundle };
}

/** Runs a system tool with its arguments as a list - never through a shell. */
function run(file, args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(file, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr: String(stderr ?? '') }));
      else resolve(String(stdout ?? ''));
    });
  });
}

function plistValue(app, key) {
  return childProcess
    .execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(app, 'Contents', 'Info.plist')], {
      timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'],
    })
    .toString()
    .trim();
}

/**
 * The version of this app held at `app`, or null if what is there is not this
 * app. Reads the bundle's own Info.plist and nothing else - no signature
 * check - so it is cheap enough to run on every launch.
 */
function bundleVersion(app) {
  try {
    if (plistValue(app, 'CFBundleIdentifier') !== APP_ID) return null;
    return plistValue(app, 'CFBundleShortVersionString') || null;
  } catch {
    return null;
  }
}

// Long enough for GD's Catalina MacBook, the oldest Mac the app runs on.
const VERIFY_TIMEOUT_MS = 10 * 60 * 1000;
const COPY_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Whether `app` is this app, at exactly `version`, signed with `signer` and
 * unchanged since. Synchronous, because it is also the last thing done as the
 * app quits.
 */
function verifyBundle(app, version, signer = SIGNER) {
  // Becomes part of the requirement text below, so it is a fingerprint or nothing.
  if (!/^[0-9a-f]{40}$/i.test(String(signer))) {
    throw new InstallError('There is no certificate to check the update against.', 'wrong_signer');
  }
  let id, shown;
  try {
    id = plistValue(app, 'CFBundleIdentifier');
    shown = plistValue(app, 'CFBundleShortVersionString');
  } catch {
    throw new InstallError('The update is not a readable app.', 'bad_bundle');
  }
  if (id !== APP_ID) throw new InstallError('The update is a different app.', 'wrong_app');
  if (shown !== version) throw new InstallError(`The update says it is version ${shown}, not ${version}.`, 'wrong_version');
  const requirement = `=identifier "${APP_ID}" and certificate leaf = H"${signer}"`;
  try {
    // Every file of the app is read and hashed. Seconds on a recent Mac; the
    // limit is for an older one, busy with something else as well.
    // --verbose changes what is said, not what is checked: it names the file
    // that is wrong.
    childProcess.execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose', `-R${requirement}`, app], {
      timeout: VERIFY_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024,
    });
  } catch (err) {
    if (err.code === 'ETIMEDOUT') {
      throw new InstallError('Checking the update took too long. Try again when the Mac is less busy.', 'verify_timeout');
    }
    // codesign's 3: the signature is intact, but it is not ours.
    if (err.status === 3) throw new InstallError('The update is not signed with this app\'s certificate.', 'wrong_signer');
    // What codesign said goes on the end - what is wrong, and with which file,
    // without the folders around it - so a photo of the message tells why.
    // Its --prepared / --validated progress lines are left out. It may name
    // the folder by its real path (/private/var/... for /var/...).
    let real = app;
    try { real = fs.realpathSync(app); } catch { /* named as given */ }
    const detail = `${err.stderr ?? ''}\n${err.stdout ?? ''}`.split(real).join('').split(app).join('').split('\n')
      .map((line) => line.trim().replace(/^:\s*/, ''))
      .filter((line) => line && !line.startsWith('--'))
      .join('; ').slice(0, 300);
    throw Object.assign(
      new InstallError(`The update has been changed since it was built.${detail ? ` (${detail})` : ''}`, 'bad_signature'),
      { detail }
    );
  }
}

/**
 * Opens a disk image, trying again if macOS is briefly too busy to.
 *
 * Every image that reaches this has already matched the fingerprint GitHub
 * gave for it, so a failure here is far more likely the disk-image service
 * than the file - and seen to happen: one attach in about fifteen runs of the
 * install suite failed on an image that opened at once the next time.
 */
async function attach(dmg, mount, { attempts = 3, pause = 1000 } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, dmg]);
    } catch (err) {
      if (i >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, pause * i));
    }
  }
}

/** The last thing a tool said on stderr - its error, without the warnings before it. */
function lastLine(text) {
  return String(text ?? '').trim().split('\n').pop().trim().slice(0, 300);
}

/**
 * Unpacks the app from a downloaded disk image into `dir` and checks it.
 *
 * The image is opened read-only, out of sight (no Finder window, nothing on
 * the desktop), and closed again whatever happens. Only a real folder named
 * *.app is taken out of it - the Applications shortcut beside it is a link,
 * and a link is not followed.
 */
async function stageMac({ dmg, version, dir, signer }) {
  const mount = fs.mkdtempSync(path.join(dir, 'mount-'));
  const staged = path.join(dir, 'staged', BUNDLE_NAME);
  // A copy made ready before has to go first: ditto adds to a folder, it does
  // not replace it.
  removeTree(path.dirname(staged));
  fs.mkdirSync(path.dirname(staged), { recursive: true });
  try {
    await attach(dmg, mount);
  } catch (err) {
    removeTree(mount);
    throw Object.assign(new InstallError('The update could not be opened.', 'attach_failed'), {
      detail: lastLine(err.stderr) || err.message,
    });
  }
  try {
    const apps = fs.readdirSync(mount, { withFileTypes: true }).filter((e) => e.name.endsWith('.app'));
    if (apps.length !== 1 || !apps[0].isDirectory()) {
      throw new InstallError('The update does not hold exactly one app.', 'bad_image');
    }
    await run('/usr/bin/ditto', [path.join(mount, apps[0].name), staged], COPY_TIMEOUT_MS);
  } finally {
    await run('/usr/bin/hdiutil', ['detach', mount, '-force']).catch(() => {});
    // Only ever an empty folder by now. rmdir, not rm -r, in case the detach
    // failed: then this refuses rather than reaching into the image.
    try { fs.rmdirSync(mount); } catch { /* left for the next clean-up */ }
  }
  try {
    verifyBundle(staged, version, signer);
  } catch (err) {
    // The reason it was refused is what he needs to see, not a clean-up's.
    try { removeTree(path.dirname(staged)); } catch { /* cleared with the rest next time */ }
    throw err;
  }
  return staged;
}

/**
 * The swap, run by /bin/sh after the app has quit.
 *
 * Its text never changes; the paths reach it as arguments ($1..$6), so no
 * file name can become part of a command. It waits for the app to exit, copies
 * the new bundle in beside the old under a hidden name, then exchanges them
 * with two renames in the same folder - the old copy is put back if the second
 * one fails. A logout that arrives mid-way is ignored until it is done.
 */
const MAC_HELPER = `
pid="$1"; staged="$2"; target="$3"; relaunch="$4"; log="$5"; result="$6"
trap '' HUP INT TERM
exec >>"$log" 2>&1
echo "$(date) installing over $target once process $pid has quit"
n=0
while kill -0 "$pid" 2>/dev/null; do
  n=$((n + 1))
  if [ "$n" -gt 1800 ]; then echo "failed: the app did not quit" > "$result"; exit 1; fi
  sleep 0.1
done
parent=$(dirname "$target")
next="$parent/.gd-suits-update-$$"
prev="$parent/.gd-suits-previous-$$"
finish() {
  echo "$2" > "$result"
  echo "$2"
  if [ "$relaunch" = 1 ]; then /usr/bin/open "$target"; fi
  exit "$1"
}
/bin/rm -rf "$next"
if ! /usr/bin/ditto "$staged" "$next"; then /bin/rm -rf "$next"; finish 1 "failed: could not copy the new version"; fi
if ! /bin/mv "$target" "$prev"; then /bin/rm -rf "$next"; finish 1 "failed: could not move the old version aside"; fi
if ! /bin/mv "$next" "$target"; then
  /bin/mv "$prev" "$target"
  /bin/rm -rf "$next"
  finish 1 "failed: could not put the new version in place"
fi
/bin/rm -rf "$prev" "$staged"
/usr/bin/touch "$target"
finish 0 "installed"
`;

/**
 * Hands the staged update to whatever puts it in place once this process
 * exits. Returns at once; the caller quits the app.
 *
 * On a Mac that is the helper above. On Windows it is the release's own
 * installer, run silently as an update: it finds the existing install,
 * closes the app if it is still running, replaces it, and with --force-run
 * opens the new version afterwards.
 */
function apply({ platform, staged, target, version, sha256, pid, relaunch, log, result, signer }) {
  if (platform === 'darwin') {
    verifyBundle(staged, version, signer);
    fs.rmSync(result, { force: true });
    const child = childProcess.spawn(
      '/bin/sh',
      ['-c', MAC_HELPER, 'gd-suits-update', String(pid), staged, target, relaunch ? '1' : '0', log, result],
      { detached: true, stdio: 'ignore' }
    );
    child.unref();
    return;
  }
  if (platform === 'win32') {
    // Checked again here: days may pass between the download and the quit.
    const actual = crypto.createHash('sha256').update(fs.readFileSync(staged)).digest('hex');
    if (actual !== sha256) throw new InstallError('The update has been changed since it was downloaded.', 'digest_mismatch');
    const args = ['/S', '--updated'];
    if (relaunch) args.push('--force-run');
    const child = childProcess.spawn(staged, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return;
  }
  throw new InstallError('Updates install themselves on Mac and Windows only.', 'unsupported');
}

/**
 * What became of an update that was handed over, judged on the next launch.
 *
 *   'installed' - this copy is that version (or newer).
 *   'failed'    - the helper said so, or it was handed over long enough ago
 *                 that it should have finished and this is still the old copy.
 *   'pending'   - handed over moments ago; the swap may still be running.
 *   'waiting'   - made ready but not yet handed over.
 */
const SETTLE_AFTER_MS = 10 * 60 * 1000;
function settle({ record, current, result, now = Date.now(), compare }) {
  if (!record?.version) return 'none';
  if (compare(current, record.version) >= 0) return 'installed';
  if (!record.applying) return 'waiting';
  if (/^failed/.test(result ?? '')) return 'failed';
  return now - record.applying > SETTLE_AFTER_MS ? 'failed' : 'pending';
}

module.exports = {
  OFFICIAL_FEED, APP_ID, BUNDLE_NAME, SIGNER, MAC_HELPER,
  officialRelease, installTarget, stageMac, verifyBundle, bundleVersion, apply, settle, removeTree, InstallError,
};
