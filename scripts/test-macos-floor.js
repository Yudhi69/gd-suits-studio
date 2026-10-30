/**
 * The check that keeps every Mac build runnable on macOS 10.15 Catalina.
 *
 * GD's Intel MacBook runs Catalina, and the build he was first sent would not
 * open on it. That came in silently with an Electron upgrade, and would again
 * with the next, so build/macosFloor.js refuses to package a build that asks
 * for more than 10.15. This proves it refuses what it should and passes what
 * it should, using small hand-built Mach-O files - so it needs no Catalina
 * machine and no real app to run.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkFloor, compare, minimums, FLOOR } = require('../build/macosFloor.js');

let pass = 0, fail = 0;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };

const CPU = { x86_64: 0x01000007, arm64: 0x0100000c };
const packVersion = (v) => { const [a, b = 0, c = 0] = v.split('.').map(Number); return (a << 16) | (b << 8) | c; };

/** A thin 64-bit Mach-O carrying one version command. */
function thin(cpu, min, { legacy = false } = {}) {
  const cmd = legacy
    ? (() => { const b = Buffer.alloc(16); b.writeUInt32LE(0x24, 0); b.writeUInt32LE(16, 4); b.writeUInt32LE(packVersion(min), 8); b.writeUInt32LE(packVersion(min), 12); return b; })()
    : (() => { const b = Buffer.alloc(24); b.writeUInt32LE(0x32, 0); b.writeUInt32LE(24, 4); b.writeUInt32LE(1, 8); b.writeUInt32LE(packVersion(min), 12); b.writeUInt32LE(packVersion(min), 16); b.writeUInt32LE(0, 20); return b; })();
  const head = Buffer.alloc(32);
  head.writeUInt32LE(0xfeedfacf, 0); head.writeUInt32LE(CPU[cpu], 4); head.writeUInt32LE(3, 8);
  head.writeUInt32LE(2, 12); head.writeUInt32LE(1, 16); head.writeUInt32LE(cmd.length, 20);
  return Buffer.concat([head, cmd]);
}

/** A universal binary: a big-endian slice table, each slice its own Mach-O. */
function fat(slices) {
  const table = Buffer.alloc(8 + slices.length * 20);
  table.writeUInt32BE(0xcafebabe, 0); table.writeUInt32BE(slices.length, 4);
  const parts = [];
  let offset = 4096;
  slices.forEach(([cpu, min], i) => {
    const body = thin(cpu, min);
    const at = 8 + i * 20;
    table.writeUInt32BE(CPU[cpu], at); table.writeUInt32BE(3, at + 4);
    table.writeUInt32BE(offset, at + 8); table.writeUInt32BE(body.length, at + 12); table.writeUInt32BE(12, at + 16);
    parts.push({ offset, body });
    offset += 4096;
  });
  const out = Buffer.alloc(offset);
  table.copy(out, 0);
  for (const p of parts) p.body.copy(out, p.offset);
  return out;
}

const plist = (min) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>LSMinimumSystemVersion</key><string>${min}</string></dict></plist>`;

/** A pretend app bundle shaped like the real one, files as given. */
function bundle(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-floor-'));
  const app = path.join(root, 'GD Suits Studio.app');
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(app, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return { app, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const GOOD = {
  'Contents/Info.plist': plist('10.15'),
  'Contents/MacOS/GD Suits Studio': fat([['x86_64', '10.15'], ['arm64', '11.0']]),
  'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework': thin('x86_64', '10.15'),
  // Named the way every Electron helper is - otool reads "name(member)" as an
  // archive member and could not open these at all.
  'Contents/Frameworks/GD Suits Studio Helper (GPU).app/Contents/MacOS/GD Suits Studio Helper (GPU)': thin('x86_64', '10.15'),
  // An older toolchain records the version in a different load command.
  'Contents/Frameworks/Squirrel.framework/Versions/A/Squirrel': thin('x86_64', '10.13', { legacy: true }),
  'Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node': thin('x86_64', '10.7', { legacy: true }),
  'Contents/Resources/app.asar': 'not a binary',
};

function run(label, overrides) {
  const b = bundle({ ...GOOD, ...overrides });
  try { return checkFloor(b.app, FLOOR); } finally { b.done(); }
}

log('=== comparing versions ===');
check(compare('10.15', '11.0') < 0, '10.15 is older than 11.0');
check(compare('10.9', '10.15') < 0, '10.9 is older than 10.15 - compared as numbers, not as text');
check(compare('11', '11.0') === 0, '11 and 11.0 are the same version');

log('\n=== reading a binary ===');
{
  const b = bundle({ 'x': fat([['x86_64', '10.15'], ['arm64', '11.0']]), 'y': thin('x86_64', '10.13', { legacy: true }) });
  const both = minimums(path.join(b.app, 'x'));
  check(both.length === 2 && both.some((s) => s.cpu === 'x86_64' && s.min === '10.15') && both.some((s) => s.cpu === 'arm64' && s.min === '11.0'),
    'both slices of a universal binary, each with its own architecture', JSON.stringify(both));
  const legacy = minimums(path.join(b.app, 'y'));
  check(legacy.length === 1 && legacy[0].min === '10.13', 'and the older way of recording it', JSON.stringify(legacy));
  b.done();
}

log('\n=== a build that runs on Catalina passes ===');
let r = run('good', {});
check(r.problems.length === 0, 'nothing in it asks for more than 10.15', JSON.stringify(r.problems));
check(r.binaries === 5 && r.unread === 0, 'every compiled file was found and read - including the one named "(GPU)"',
  JSON.stringify({ binaries: r.binaries, unread: r.unread }));

log('\n=== and each way of failing it is caught ===');
r = run('plist', { 'Contents/Info.plist': plist('11.0') });
check(r.problems.length === 1 && r.problems[0].file === 'Contents/Info.plist',
  'the bundle declaring macOS 11 - the very message GD saw', JSON.stringify(r.problems));

r = run('helper', { 'Contents/Frameworks/GD Suits Studio Helper (GPU).app/Contents/MacOS/GD Suits Studio Helper (GPU)': thin('x86_64', '11.0') });
check(r.problems.length === 1 && /Helper \(GPU\).*\[x86_64\]/.test(r.problems[0].file),
  'a helper built for macOS 11', JSON.stringify(r.problems));

r = run('driver', { 'Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node': thin('x86_64', '12.0') });
check(r.problems.length === 1 && /better_sqlite3\.node/.test(r.problems[0].file),
  'a database driver compiled for a newer macOS - the app would open and then fail to read its data',
  JSON.stringify(r.problems));

r = run('fat-intel', { 'Contents/MacOS/GD Suits Studio': fat([['x86_64', '11.0'], ['arm64', '11.0']]) });
check(r.problems.length === 1 && /\[x86_64\]/.test(r.problems[0].file),
  'the Intel half of a universal binary asking for 11', JSON.stringify(r.problems));

log('\n=== but not what is not a problem ===');
r = run('arm', { 'Contents/MacOS/GD Suits Studio': fat([['x86_64', '10.15'], ['arm64', '11.0']]) });
check(r.problems.length === 0, 'an Apple-silicon slice needing 11 - no such Mac runs anything older', JSON.stringify(r.problems));

log('\n=== nothing in the app that should not be ===');
r = run('python', { 'Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/node_gyp_bins/python3': fat([['x86_64', '10.9'], ['arm64', '11.0']]) });
check(r.problems.some((p) => /node_gyp_bins\/python3/.test(p.file) && /should not be/.test(p.needs)),
  'a program in the unpacked folder is refused, even one built for an old macOS', JSON.stringify(r.problems));

log('\n=== the real engine this app is built on ===');
const real = path.join(path.dirname(require.resolve('electron/package.json')), 'dist', 'Electron.app', 'Contents', 'Info.plist');
if (fs.existsSync(real)) {
  const declared = require('child_process').execFileSync('plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', real], { encoding: 'utf8' }).trim();
  check(compare(declared, FLOOR) <= 0, `the installed Electron declares macOS ${declared}`, declared);
} else {
  log('  - no Electron binary installed here; skipped');
}

log(`\n${fail === 0 ? 'ALL MACOS FLOOR CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
