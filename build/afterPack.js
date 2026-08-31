'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Ad-hoc signs the macOS bundle after packing, so the app runs on Apple
 * Silicon without an Apple Developer account.
 *
 * Two things make this fiddly and both were learned the hard way:
 *
 *  1. Apple Silicon refuses to run *any* unsigned binary. Packing renames the
 *     bundle and adds resources, invalidating the signature Electron ships
 *     with, so an unsigned build is killed at launch with no error at all.
 *
 *  2. `codesign --deep` does not fix it. macOS rejects the result with
 *     "mapping process and mapped file have different Team IDs" because the
 *     nested Electron Framework keeps its original signature while the outer
 *     bundle gets a new one. Nested code has to be signed explicitly,
 *     innermost first, so every layer carries the same (empty) team identity.
 *
 * Once a real Developer ID exists, set `mac.identity` in package.json and
 * electron-builder signs properly instead - this hook stands down.
 */

function sign(target, entitlements) {
  const args = ['--force', '--sign', '-', '--timestamp=none'];
  if (entitlements) args.push('--entitlements', entitlements);
  args.push(target);
  execFileSync('codesign', args, { stdio: ['ignore', 'ignore', 'pipe'] });
}

/** Every file under `dir` matching `test`, deepest paths first. */
function collect(dir, test, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, test, out);
    else if (test(full)) out.push(full);
  }
  return out;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (context.packager.config?.mac?.identity) return; // a real identity is configured

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  const frameworks = path.join(appPath, 'Contents', 'Frameworks');
  const entitlements = path.join(__dirname, 'entitlements.mac.plist');

  // Innermost first: loose binaries, then each framework, then the helper
  // apps, and only then the outer bundle.
  const targets = [
    ...collect(frameworks, (f) => f.endsWith('.dylib')),
    ...collect(path.join(appPath, 'Contents', 'Resources'), (f) => f.endsWith('.node')),
    path.join(frameworks, 'Electron Framework.framework', 'Versions', 'A', 'Helpers', 'chrome_crashpad_handler'),
  ].filter((t) => fs.existsSync(t));

  for (const target of targets) sign(target);

  // Frameworks are signed at the versioned directory, not the symlink.
  for (const entry of fs.existsSync(frameworks) ? fs.readdirSync(frameworks) : []) {
    if (!entry.endsWith('.framework')) continue;
    const versionA = path.join(frameworks, entry, 'Versions', 'A');
    sign(fs.existsSync(versionA) ? versionA : path.join(frameworks, entry));
  }

  // Helper apps carry the same entitlements as the parent.
  for (const entry of fs.existsSync(frameworks) ? fs.readdirSync(frameworks) : []) {
    if (entry.endsWith('.app')) sign(path.join(frameworks, entry), entitlements);
  }

  sign(appPath, entitlements);

  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  console.log(`  • ad-hoc signed ${appName} (${targets.length + 1} nested items, no Developer ID configured)`);
};
