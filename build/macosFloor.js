'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The oldest macOS this app promises to run on, and the check that it does.
 *
 * GD's Intel MacBook runs macOS 10.15 Catalina. Electron 33 is built for
 * macOS 11, so the app he was sent would not open at all: "The application
 * requires macOS 11.0 or later". Nothing in this repository said 11.0 - it
 * came in with the Electron version, and would come in again with the next.
 *
 * So every Mac build checks itself. The macOS version a binary needs is
 * written into the binary, and it is not only Electron's: the SQLite driver is
 * compiled on whichever machine builds the app, and a driver compiled for a
 * newer macOS gives an app that opens on Catalina and then fails the moment it
 * reads the database. Every compiled file in the bundle is read, and the build
 * stops if any of them, or the bundle's own Info.plist, asks for more than the
 * floor.
 *
 *   node build/macosFloor.js "<path to .app>" [floor]
 */

const FLOOR = '10.15';

// Under Electron's own Node - which is how the test suite runs scripts - every
// path containing ".asar" is quietly redirected into Electron's archive reader,
// including the app.asar.unpacked folder this check most needs to read. This
// is a build tool that reads files as files, so that is switched off.
if (process.versions.electron) process.noAsar = true;

/** The first four bytes of every Mach-O file, thin or universal, either byte order. */
const MACH_O = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca']);

function isMachO(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(4);
    return fs.readSync(fd, head, 0, 4, 0) === 4 && MACH_O.has(head.toString('hex'));
  } finally {
    fs.closeSync(fd);
  }
}

function machOFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    // Framework symlinks point back into the bundle; following them would read
    // the same binary twice and, for Versions/Current, loop.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) machOFiles(full, out);
    // The code archive is never a compiled program, and native code that
    // needs reading lives beside it in app.asar.unpacked.
    else if (entry.isFile() && !entry.name.endsWith('.asar') && isMachO(full)) out.push(full);
  }
  return out;
}

/**
 * The macOS versions a binary was built for - one per architecture slice.
 *
 * Read from the Mach-O load commands directly rather than through otool,
 * which treats a path ending "name(member)" as an archive member - and every
 * Electron helper is named like "Helper (GPU)". Modern binaries record the
 * version in LC_BUILD_VERSION as minos; older ones in LC_VERSION_MIN_MACOSX.
 * Both pack it as xxxx.yy.zz in one 32-bit word.
 */
const CPU = { 0x01000007: 'x86_64', 0x0100000c: 'arm64' };
const LC_BUILD_VERSION = 0x32;
const LC_VERSION_MIN_MACOSX = 0x24;
const PLATFORM_MACOS = 1;

function read(fd, length, position) {
  const buf = Buffer.alloc(length);
  const got = fs.readSync(fd, buf, 0, length, position);
  return got === length ? buf : null;
}

const version = (word) => `${word >>> 16}.${(word >>> 8) & 0xff}${word & 0xff ? `.${word & 0xff}` : ''}`;

/** The minimum versions recorded in the thin Mach-O starting at `base`, with its architecture. */
function sliceMinimums(fd, base) {
  const magic = read(fd, 4, base)?.readUInt32LE(0);
  const header = magic === 0xfeedfacf ? 32 : magic === 0xfeedface ? 28 : null;
  if (!header) return [];
  const h = read(fd, header, base);
  const cpu = CPU[h.readUInt32LE(4)] ?? 'other';
  const ncmds = h.readUInt32LE(16);
  const sizeofcmds = h.readUInt32LE(20);
  const cmds = read(fd, sizeofcmds, base + header);
  if (!cmds) return [];
  const found = [];
  for (let i = 0, off = 0; i < ncmds && off + 8 <= cmds.length; i++) {
    const cmd = cmds.readUInt32LE(off);
    const size = cmds.readUInt32LE(off + 4);
    if (cmd === LC_BUILD_VERSION && cmds.readUInt32LE(off + 8) === PLATFORM_MACOS) found.push({ cpu, min: version(cmds.readUInt32LE(off + 12)) });
    if (cmd === LC_VERSION_MIN_MACOSX) found.push({ cpu, min: version(cmds.readUInt32LE(off + 8)) });
    if (size < 8) break;
    off += size;
  }
  return found;
}

function minimums(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = read(fd, 8, 0);
    const fat = head.readUInt32BE(0);
    if (fat === 0xcafebabe || fat === 0xcafebabf) {
      // A universal binary: a big-endian table of slices, each its own Mach-O.
      const wide = fat === 0xcafebabf;
      const count = head.readUInt32BE(4);
      const entry = wide ? 32 : 20;
      const table = read(fd, count * entry, 8);
      const found = [];
      for (let i = 0; i < count; i++) {
        const at = i * entry;
        const offset = wide ? Number(table.readBigUInt64BE(at + 8)) : table.readUInt32BE(at + 8);
        found.push(...sliceMinimums(fd, offset));
      }
      return found;
    }
    return sliceMinimums(fd, 0);
  } finally {
    fs.closeSync(fd);
  }
}

/** -1, 0 or 1, comparing dotted versions numerically: 10.15 < 11.0. */
function compare(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/**
 * The oldest macOS an Apple-silicon slice can ever be asked to run on. No such
 * Mac shipped with anything older, so an arm64 slice needing 11.0 is not a
 * problem - only an Intel slice needing more than the floor is.
 */
const ARM64_FLOOR = '11.0';

/**
 * Everything in `appPath` that would stop it running on `floor`.
 * An empty list means it can.
 *
 * Two kinds of problem. A file, or the bundle itself, asking for a newer
 * macOS than the floor. And a program in the unpacked folder that is not a
 * native module: that folder is meant to hold the SQLite driver and nothing
 * else, and a build once shipped the build machine's Python launcher there.
 */
function checkFloor(appPath, floor = FLOOR) {
  const problems = [];
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  const declared = execFileSync('plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', plist], { encoding: 'utf8' }).trim();
  if (compare(declared, floor) > 0) problems.push({ file: 'Contents/Info.plist', needs: declared });

  const binaries = machOFiles(appPath);
  const unpacked = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked') + path.sep;
  let unread = 0;
  for (const file of binaries) {
    const rel = path.relative(appPath, file);
    if (file.startsWith(unpacked) && !file.endsWith('.node')) {
      problems.push({ file: rel, needs: 'nothing - a program that should not be in the app' });
    }
    const slices = minimums(file);
    if (!slices.length) { unread++; continue; }
    for (const { cpu, min } of slices) {
      const allowed = cpu === 'arm64' && compare(ARM64_FLOOR, floor) > 0 ? ARM64_FLOOR : floor;
      if (compare(min, allowed) > 0) problems.push({ file: `${rel} [${cpu}]`, needs: min });
    }
  }
  return { declared, binaries: binaries.length, unread, problems };
}

module.exports = { FLOOR, ARM64_FLOOR, checkFloor, compare, minimums };

if (require.main === module) {
  const [appPath, floor = FLOOR] = process.argv.slice(2);
  const result = checkFloor(appPath, floor);
  console.log(`Info.plist asks for ${result.declared}; ${result.binaries} compiled files read`);
  for (const p of result.problems) console.log(`  needs ${p.needs}: ${p.file}`);
  console.log(result.problems.length ? `FAILS the ${floor} floor` : `meets the ${floor} floor`);
  process.exit(result.problems.length ? 1 : 0);
}
