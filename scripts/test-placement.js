/**
 * Opening the app never opens an older copy of it.
 *
 * An update in place replaces the copy that was running, so a copy opened
 * from the disk image, from Downloads or from a build folder Spotlight found
 * left the one in Applications behind - and the Dock went on opening that.
 * electron/placement.js decides, as an installed copy starts, whether it
 * should run, hand over to a newer copy, offer to move itself into
 * Applications, or say it is out of date and quit.
 *
 * Fake app bundles in a temp folder stand in for the copies, read through the
 * same Info.plist reader the app uses; the dialogs, the opening of another
 * copy and the move into Applications are recorded rather than done. Nothing
 * here opens a window or touches the real Applications folder.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const placement = require('../electron/placement.js');
const { compareVersions: compare } = require('../electron/updater.js');
const { APP_ID, BUNDLE_NAME } = require('../electron/installer.js');

let pass = 0, fail = 0;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };

const WORK = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gd-placement-')));
const APPS = path.join(WORK, 'Applications');
const HOME_APPS = path.join(WORK, 'home', 'Applications');

/** A bundle with just enough in it to be read: its Info.plist. */
function fakeApp(dir, { version, id = APP_ID, name = BUNDLE_NAME }) {
  const bundle = path.join(dir, name);
  fs.mkdirSync(path.join(bundle, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(bundle, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${id}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
</dict></plist>`);
  return bundle;
}

/** A fresh machine: an Applications folder, a data folder, and recorders for everything place() does. */
function machine({ answers = [], moves = [] } = {}) {
  const root = fs.mkdtempSync(path.join(WORK, 'm-'));
  const m = {
    root,
    apps: path.join(root, 'Applications'),
    data: path.join(root, 'data'),
    asked: [], opened: [], pages: 0, moveCalls: [], reads: 0,
  };
  fs.mkdirSync(m.apps);
  fs.mkdirSync(m.data);
  m.place = (current, bundle, extra = {}) => placement.place({
    platform: 'darwin', current, bundle, compare, dataDir: m.data, applications: m.apps,
    homeApplications: HOME_APPS,
    ask: async (o) => { m.asked.push(o); return { response: answers.shift() ?? 0 }; },
    open: (b) => m.opened.push(b),
    move: (onConflict) => {
      const next = moves.shift() ?? { moved: true };
      if (next.throws) throw new Error(next.throws);
      const allowed = next.conflict ? onConflict(next.conflict) : true;
      m.moveCalls.push({ conflict: next.conflict ?? null, allowed });
      return allowed && next.moved !== false;
    },
    openPage: () => { m.pages++; },
    readVersion: (b) => { m.reads++; return require('../electron/installer.js').bundleVersion(b); },
    ...extra,
  });
  m.record = () => placement.readNewest(path.join(m.data, placement.RECORD));
  return m;
}

const decide = (o) => placement.decide({ platform: 'darwin', compare, inApplications: false, ...o });

(async () => {
  log('=== deciding (no side effects) ===');
  const own = '/Applications/GD Suits Studio.app';
  check(decide({ current: '0.1.30', bundle: own, inApplications: true }).action === 'run',
    'the copy in Applications, nothing recorded: it runs');
  check(decide({ current: '0.1.30', bundle: own, inApplications: true, newest: { version: '0.1.30', bundle: own } }).action === 'run',
    'the copy in Applications, the newest opened: it runs');

  let d = decide({ current: '0.1.25', bundle: own, inApplications: true,
    newest: { version: '0.1.30', bundle: '/Users/x/Downloads/GD Suits Studio.app', found: '0.1.30' } });
  check(d.action === 'open' && d.bundle === '/Users/x/Downloads/GD Suits Studio.app',
    'an older copy hands over to the newer one, wherever it is', JSON.stringify(d));
  d = decide({ current: '0.1.25', bundle: '/x/GD Suits Studio.app',
    newest: { version: '0.1.30', bundle: '/gone/GD Suits Studio.app', found: null },
    installed: { bundle: own, exists: true, version: '0.1.28' } });
  check(d.action === 'open' && d.bundle === own, '  or to the copy in Applications, when the newest has gone and that one is newer',
    JSON.stringify(d));
  d = decide({ current: '0.1.25', bundle: own, inApplications: true,
    newest: { version: '0.1.30', bundle: '/Volumes/GD Suits Studio/GD Suits Studio.app', found: null } });
  check(d.action === 'older' && d.newest === '0.1.30', '  and with no newer copy left to open, it says so instead of running',
    JSON.stringify(d));
  d = decide({ current: '0.1.30', bundle: own, inApplications: true,
    newest: { version: '0.1.31', bundle: own, found: '0.1.31' } });
  check(d.action === 'older', '  never handing over to itself, whatever is recorded for it', JSON.stringify(d));
  d = placement.decide({ platform: 'win32', current: '0.1.25', bundle: null, compare, newest: { version: '0.1.30', bundle: null } });
  check(d.action === 'older', 'on Windows an older copy says so too', JSON.stringify(d));
  check(placement.decide({ platform: 'win32', current: '0.1.30', bundle: null, compare, newest: { version: '0.1.30' } }).action === 'run',
    '  and the current one runs');

  const dl = '/Users/x/Downloads/GD Suits Studio.app';
  d = decide({ current: '0.1.30', bundle: dl, installed: { bundle: own, exists: true, version: '0.1.30' } });
  check(d.action === 'open' && d.bundle === own, 'outside Applications, with the same version in Applications: opens that one',
    JSON.stringify(d));
  d = decide({ current: '0.1.30', bundle: dl, installed: { bundle: own, exists: true, version: '0.1.31' } });
  check(d.action === 'open' && d.bundle === own, '  and with a newer one there: opens that one', JSON.stringify(d));
  d = decide({ current: '0.1.30', bundle: dl, installed: { bundle: own, exists: true, version: '0.1.17' } });
  check(d.action === 'move' && d.replaces === '0.1.17', '  with an older one there: offers to move in, in its place', JSON.stringify(d));
  d = decide({ current: '0.1.30', bundle: dl });
  check(d.action === 'move' && d.replaces === null, '  with nothing there: offers to move in', JSON.stringify(d));
  d = decide({ current: '0.1.30', bundle: dl, installed: { bundle: own, exists: true, version: null } });
  check(d.action === 'run', '  with some other app there under this name: leaves it alone', JSON.stringify(d));
  d = decide({ current: '0.1.30', bundle: '/Users/x/Downloads/GD Suits Studio 2.app' });
  check(d.action === 'run', '  renamed by hand: does not offer, since it would land beside the old copy', JSON.stringify(d));

  log('\n=== the first launch of an installed copy ===');
  let m = machine();
  const inApps = fakeApp(m.apps, { version: '0.1.30' });
  check(await m.place('0.1.30', inApps) === 'run', 'it runs');
  check(m.asked.length === 0 && m.opened.length === 0, '  asking nothing, opening nothing');
  check(JSON.stringify(m.record()) === JSON.stringify({ version: '0.1.30', bundle: inApps }),
    '  and records itself as the newest copy, and where it is', JSON.stringify(m.record()));
  check((fs.statSync(path.join(m.data, placement.RECORD)).mode & 0o077) === 0, '  in a file only this account can read');
  m.reads = 0;
  await m.place('0.1.30', inApps);
  check(m.reads === 0, 'every launch after that, from Applications, reads no other copy at all', String(m.reads));

  log('\n=== an older copy is opened ===');
  m = machine();
  const old = fakeApp(m.apps, { version: '0.1.17' });
  const newer = fakeApp(path.join(m.root, 'Downloads'), { version: '0.1.30' });
  await m.place('0.1.30', newer, { ask: async () => ({ response: 1 }) }); // the newer copy ran, from Downloads
  m.opened.length = 0;
  check(await m.place('0.1.17', old) === 'open', 'the old copy in Applications does not run');
  check(m.opened.length === 1 && m.opened[0] === newer, '  it opens the newer copy instead', JSON.stringify(m.opened));
  check(m.record().version === '0.1.30', '  and the newest stays the newest', JSON.stringify(m.record()));

  m = machine({ answers: [1] });
  const gone = fakeApp(path.join(m.root, 'Volumes'), { version: '0.1.30' });
  await m.place('0.1.30', gone, { ask: async () => ({ response: 1 }) });
  fs.rmSync(path.dirname(gone), { recursive: true });
  const stale = fakeApp(m.apps, { version: '0.1.20' });
  check(await m.place('0.1.20', stale) === 'older', 'with the newer copy gone, it does not run either');
  check(m.asked.length === 1 && /older copy/.test(m.asked[0].message) && m.asked[0].message.includes('0.1.20')
    && m.asked[0].detail.includes('0.1.30'), '  it says which version this is and which has been used', JSON.stringify(m.asked[0]));
  check(m.asked[0].buttons[m.asked[0].defaultId] === 'Quit' && m.asked[0].cancelId === m.asked[0].defaultId,
    '  Quit is the default, and closing the box quits too', JSON.stringify(m.asked[0].buttons));
  check(m.pages === 1, '  and "Get the latest version" opens the releases page');
  m.pages = 0;
  m.asked.length = 0;
  await m.place('0.1.20', stale, { ask: async () => ({ response: 0 }) });
  check(m.pages === 0, '  while Quit just quits');
  check(m.record().version === '0.1.30', '  either way, the record still holds the newest', JSON.stringify(m.record()));

  m = machine();
  fs.writeFileSync(path.join(m.data, placement.RECORD), JSON.stringify({ version: '0.1.30', bundle: '../GD Suits Studio.app' }));
  check(placement.readNewest(path.join(m.data, placement.RECORD)).bundle === null,
    'a recorded place that is not a full path to an app is never opened');
  fs.writeFileSync(path.join(m.data, placement.RECORD), '{ not json');
  check(await m.place('0.1.30', fakeApp(m.apps, { version: '0.1.30' })) === 'run' && m.record()?.version === '0.1.30',
    'an unreadable record is treated as none, and rewritten');

  log('\n=== opened from outside Applications ===');
  m = machine();
  const current = fakeApp(m.apps, { version: '0.1.30' });
  const dmgCopy = fakeApp(path.join(m.root, 'Volumes', 'GD Suits Studio'), { version: '0.1.30' });
  check(await m.place('0.1.30', dmgCopy) === 'open' && m.opened[0] === current,
    'the same version, already in Applications: that copy is opened instead');
  check(m.asked.length === 0, '  without asking');

  m = machine({ answers: [0] });
  const older = fakeApp(m.apps, { version: '0.1.17' });
  const fresh = fakeApp(path.join(m.root, 'Volumes', 'GD Suits Studio'), { version: '0.1.30' });
  const placed = await m.place('0.1.30', fresh);
  check(m.asked.length === 1 && /Move GD Suits Studio to your Applications folder/.test(m.asked[0].message),
    'with an older copy in Applications, it offers to move there', m.asked[0]?.message);
  check(m.asked[0]?.detail.includes('0.1.17') && m.asked[0].detail.includes('0.1.30')
    && m.asked[0].buttons[m.asked[0].defaultId] === 'Move to Applications', '  naming both versions, with Move as the default');
  check(placed === 'moved' && m.moveCalls.length === 1, '  and moves', JSON.stringify(m.moveCalls));
  check(fs.existsSync(older), '  leaving the replacing of the old copy to the move itself');

  m = machine({ answers: [0], moves: [{ conflict: 'exists' }] });
  fakeApp(m.apps, { version: '0.1.17' });
  await m.place('0.1.30', fakeApp(path.join(m.root, 'Downloads'), { version: '0.1.30' }));
  check(m.moveCalls[0]?.allowed === true, 'an older copy in the way is replaced', JSON.stringify(m.moveCalls));

  m = machine({ answers: [0, 0], moves: [{ conflict: 'existsAndRunning' }, { conflict: 'exists' }] });
  fakeApp(m.apps, { version: '0.1.17' });
  const r = await m.place('0.1.30', fakeApp(path.join(m.root, 'Downloads'), { version: '0.1.30' }));
  check(m.moveCalls[0]?.allowed === false, 'an older copy that is still open is not given control - Electron would open it and quit this one',
    JSON.stringify(m.moveCalls));
  check(/still open/.test(m.asked[1]?.message ?? '') && /Quit/.test(m.asked[1]?.detail ?? ''),
    '  he is asked to quit it first', JSON.stringify(m.asked[1]));
  check(r === 'moved' && m.moveCalls.length === 2, '  and then it moves', JSON.stringify(m.moveCalls));

  m = machine({ answers: [1] });
  fakeApp(m.apps, { version: '0.1.17' });
  const kept = fakeApp(path.join(m.root, 'Downloads'), { version: '0.1.30' });
  check(await m.place('0.1.30', kept) === 'run' && m.moveCalls.length === 0, '"Not now" runs it where it is, moving nothing');
  check(m.record()?.bundle === kept, '  as the newest copy, so the old one hands over to it', JSON.stringify(m.record()));

  m = machine({ answers: [0, 0], moves: [{ throws: 'copy failed' }] });
  check(await m.place('0.1.30', fakeApp(path.join(m.root, 'Downloads'), { version: '0.1.30' })) === 'run',
    'a move that fails leaves it running where it is');
  check(/could not be moved/.test(m.asked[1]?.message ?? ''), '  and says so', JSON.stringify(m.asked[1]));

  m = machine({ answers: [0], moves: [{ moved: false }] });
  check(await m.place('0.1.30', fakeApp(path.join(m.root, 'Downloads'), { version: '0.1.30' })) === 'run'
    && m.asked.length === 1, 'a password prompt cancelled leaves it running, without asking again');

  m = machine();
  fakeApp(m.apps, { version: '0.1.17', id: 'com.example.other' });
  check(await m.place('0.1.30', fakeApp(path.join(m.root, 'Downloads'), { version: '0.1.30' })) === 'run'
    && m.asked.length === 0, 'another app under this name in Applications is never offered for replacing');

  m = machine();
  const homeCopy = fakeApp(HOME_APPS, { version: '0.1.30' });
  check(await m.place('0.1.30', homeCopy) === 'run' && m.asked.length === 0, 'a copy in the account\'s own Applications folder is in place');

  log('\n=== how this copy finds itself ===');
  // Run by Electron's own binary, which sits inside Electron.app exactly as
  // the app's sits inside GD Suits Studio.app.
  const found = placement.ownBundle(process.execPath);
  check(found && path.basename(found) === 'Electron.app' && fs.existsSync(path.join(found, 'Contents', 'Info.plist')),
    'from its executable, the app bundle around it', found);
  check(placement.ownBundle('/usr/bin/true') === null, 'and from one that is in no bundle, nothing');

  fs.rmSync(WORK, { recursive: true, force: true });
  log(`\n${fail === 0 ? 'ALL PLACEMENT CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  log('HARNESS FAIL', e.stack);
  fs.rmSync(WORK, { recursive: true, force: true });
  process.exit(1);
});
