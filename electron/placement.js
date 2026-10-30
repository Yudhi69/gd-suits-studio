'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { BUNDLE_NAME, bundleVersion } = require('./installer');

/**
 * Making sure the copy that opens is the newest one on this machine.
 *
 * An update in place replaces the copy that was running. A copy opened from
 * anywhere else - straight out of the downloaded disk image, from Downloads,
 * from a build folder Spotlight found - leaves the one in Applications as it
 * was, and the Dock goes on opening that older one. So, as an installed copy
 * starts:
 *
 *   - A copy older than the newest one opened on this account does not run.
 *     It hands over to a newer copy if one is still where it was, and
 *     otherwise says so and quits. An older version would be opening orders a
 *     newer one has already changed.
 *   - A Mac copy outside Applications hands over to the copy in Applications
 *     when that one is at least as new, and otherwise offers to move itself
 *     there in place of the older one.
 *
 * Copies released before this check existed cannot be stopped by it - they
 * do not have it. Moving the new copy into Applications replaces them.
 *
 * decide() is the whole of the judgement and touches nothing. place() carries
 * it out through the functions it is given, so the suite can drive every
 * branch without opening a dialog, an app or the Applications folder.
 */

const RECORD = 'newest-version.json';

/**
 * What this launch should do.
 *
 *   current       this copy's version
 *   bundle        this copy's .app (Mac), or null
 *   newest        { version, bundle, found } - the newest copy opened here,
 *                 where it was, and the version there now (null if gone)
 *   installed     { bundle, exists, version } - what is in Applications under
 *                 this app's name; version is null if it is not this app
 *   inApplications whether this copy is in an Applications folder
 *
 * Returns { action: 'run' | 'open' | 'move' | 'older', ... }.
 */
function decide({ platform, current, bundle, newest, installed, inApplications, compare }) {
  const mac = platform === 'darwin';
  // Newer copies this one could hand over to, newest first. Never itself.
  const newer = [
    newest?.bundle && newest.found ? { bundle: newest.bundle, version: newest.found } : null,
    installed?.version ? { bundle: installed.bundle, version: installed.version } : null,
  ]
    .filter((c) => c && c.bundle !== bundle && compare(c.version, current) > 0)
    .sort((a, b) => compare(b.version, a.version));

  if (newest && compare(current, newest.version) < 0) {
    if (mac && newer.length) return { action: 'open', ...newer[0] };
    return { action: 'older', newest: newest.version };
  }
  if (!mac || inApplications || !bundle) return { action: 'run' };
  if (installed?.version && compare(installed.version, current) >= 0) {
    return { action: 'open', bundle: installed.bundle, version: installed.version };
  }
  // Something else under this app's name is not this app's to replace, and a
  // copy renamed by hand would land beside the old one rather than over it.
  if (installed?.exists && !installed.version) return { action: 'run' };
  if (path.basename(bundle) !== BUNDLE_NAME) return { action: 'run' };
  return { action: 'move', replaces: installed?.version ?? null };
}

/** This copy's .app, from the path of its executable - or null if it is not in one. */
function ownBundle(exePath) {
  try {
    // .../GD Suits Studio.app/Contents/MacOS/GD Suits Studio
    const bundle = fs.realpathSync(path.resolve(exePath, '..', '..', '..'));
    return bundle.endsWith('.app') ? bundle : null;
  } catch {
    return null;
  }
}

/** The newest version opened here, as recorded - or null if there is no usable record. */
function readNewest(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!/^\d+(\.\d+){1,3}$/.test(String(value?.version ?? ''))) return null;
    const bundle = typeof value.bundle === 'string' && path.isAbsolute(value.bundle) && value.bundle.endsWith('.app')
      ? value.bundle : null;
    return { version: value.version, bundle };
  } catch {
    return null;
  }
}

function writeNewest(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temp, file);
}

/** Opens `bundle` once this process has gone, so macOS does not just bring this one forward. */
function openWhenGone(bundle) {
  const child = childProcess.spawn(
    '/bin/sh',
    ['-c', 'while /bin/kill -0 "$1" 2>/dev/null; do /bin/sleep 0.2; done; exec /usr/bin/open "$2"', 'gd-suits-open',
      String(process.pid), bundle],
    { detached: true, stdio: 'ignore' }
  );
  child.unref();
}

/**
 * Carries out decide() for this launch. Resolves to what became of it:
 * 'run' - go on starting; 'moved' - Electron is reopening it from
 * Applications and quitting this one; 'open' or 'older' - quit now.
 *
 *   dataDir        where the record of the newest version is kept
 *   applications   the Applications folder this app is installed into
 *   homeApplications the account's own Applications folder, also accepted
 *   ask(options)   shows a message box, resolving to { response }
 *   open(bundle)   opens that copy once this process has gone
 *   move(onConflict) moves this copy into Applications; true if it did
 *   openPage()     opens the releases page in the browser
 */
async function place({
  platform, current, bundle, compare, dataDir, applications, homeApplications,
  ask, open, move, openPage, log = () => {}, readVersion = bundleVersion,
}) {
  const file = path.join(dataDir, RECORD);
  const recorded = readNewest(file);
  const older = !!recorded && compare(current, recorded.version) < 0;
  // Bundles are only read when they might matter: in the usual launch - the
  // copy in Applications, already the newest - neither of these reads a thing.
  const newest = recorded && {
    ...recorded,
    found: older && recorded.bundle && recorded.bundle !== bundle && fs.existsSync(recorded.bundle)
      ? readVersion(recorded.bundle) : null,
  };
  const target = path.join(applications, BUNDLE_NAME);
  const inApplications = !!bundle && [applications, homeApplications].includes(path.dirname(bundle));
  const installed = platform === 'darwin' && target !== bundle && fs.existsSync(target)
    ? { bundle: target, exists: true, version: readVersion(target) }
    : null;

  const decision = decide({ platform, current, bundle, newest, installed, inApplications, compare });
  log(`placement: ${decision.action}${decision.bundle ? ` ${decision.bundle}` : ''} (this copy ${current})`);

  if (decision.action === 'open') {
    open(decision.bundle);
    return 'open';
  }

  if (decision.action === 'older') {
    const { response } = await ask({
      type: 'warning',
      buttons: ['Quit', 'Get the latest version'],
      defaultId: 0,
      cancelId: 0,
      message: `This is an older copy of GD Suits Studio (version ${current}).`,
      detail: `Version ${decision.newest} has already been used on this computer, and an older version could lose ` +
        'what it saved. Open the newest copy instead - or get the latest version, and use that from now on.',
    });
    if (response === 1) openPage();
    return 'older';
  }

  if (decision.action === 'move') {
    if (await movePrompt({ ask, move, log, current, replaces: decision.replaces }) === 'moved') return 'moved';
  }

  // This copy runs. If it is the newest yet, it is now the one to hand over to.
  if (!older) {
    try {
      writeNewest(file, { version: current, bundle: bundle ?? null });
    } catch (err) {
      log(`could not record the newest version: ${err?.message ?? err}`);
    }
  }
  return 'run';
}

async function movePrompt({ ask, move, log, current, replaces }) {
  const { response } = await ask({
    type: 'question',
    buttons: ['Move to Applications', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    message: 'Move GD Suits Studio to your Applications folder?',
    detail: replaces
      ? `Applications has an older copy (version ${replaces}). Moving this one there replaces it, so the app you ` +
        `open from the Dock is version ${current} - and updates install themselves from then on.`
      : 'Run from here, updates cannot install themselves, and the app you open from the Dock may not be this one.',
  });
  if (response !== 0) return 'kept';

  for (;;) {
    let running = false;
    let moved;
    try {
      // 'exists': the older copy is replaced - it goes to the Bin, not away.
      // 'existsAndRunning': Electron would open the old copy and quit this
      // one, which is the opposite of the point, so it is refused and asked.
      moved = move((conflict) => {
        if (conflict === 'existsAndRunning') {
          running = true;
          return false;
        }
        return true;
      });
    } catch (err) {
      log(`could not move to Applications: ${err?.message ?? err}`);
      await ask({
        type: 'warning',
        buttons: ['OK'],
        message: 'GD Suits Studio could not be moved to Applications.',
        detail: 'Drag it into the Applications folder yourself, replacing the copy there, and open it from there.',
      });
      return 'kept';
    }
    if (moved) return 'moved';
    if (!running) return 'kept'; // the password prompt was cancelled
    const again = await ask({
      type: 'info',
      buttons: ['Move to Applications', 'Not now'],
      defaultId: 0,
      cancelId: 1,
      message: 'The older copy is still open.',
      detail: 'Quit it first - click its window, then choose GD Suits Studio > Quit - and then move this one.',
    });
    if (again.response !== 0) return 'kept';
  }
}

module.exports = { RECORD, decide, place, readNewest, ownBundle, openWhenGone };
