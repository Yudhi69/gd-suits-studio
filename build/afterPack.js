'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { checkFloor, FLOOR } = require('./macosFloor');
const { SIGNER } = require('../electron/installer');

const ENTITLEMENTS = path.join(__dirname, 'entitlements.mac.plist');

/**
 * Signs the macOS bundle after packing.
 *
 * A release is signed with the project's own certificate - the one
 * installer.js names as SIGNER - from the keychain build/mac-keychain.sh made
 * for it, given here as GD_MAC_SIGN_KEYCHAIN. Every release then carries the
 * same signer, which is what lets an installed copy tell its next update from
 * anything else, and lets macOS remember what it was allowed (the camera)
 * from one version to the next. A build without that keychain - one made on a
 * laptop - is signed ad hoc: it runs, but no installed copy takes it as an
 * update. A build on CI without it stops, rather than publish one.
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
 *     innermost first, so every layer carries the same signer.
 *
 * The certificate is not an Apple Developer ID, so macOS still warns the first
 * time the app is opened. Once a Developer ID exists, set `mac.identity` in
 * package.json and electron-builder signs instead - this hook stands down.
 */

function sign(target, { identity, keychain }, entitlements) {
  const args = ['--force', '--sign', identity, '--timestamp=none'];
  if (keychain) args.push('--keychain', keychain);
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

/**
 * Build-time flags compiled into the Electron binary.
 *
 * `RunAsNode` is the one that matters: left on, the shipped app can be driven
 * as a plain Node process, which sidesteps every renderer control in
 * security.js. The rest close the neighbouring doors - NODE_OPTIONS injection,
 * --inspect attaching a debugger to the process holding the API key, and
 * loading an `app/` folder in place of the archive.
 *
 * These have to be flipped before signing: writing the fuse wire modifies the
 * binary and invalidates any signature already on it.
 */
async function applyFuses(context) {
  // Loaded here, not at the top: it is an ES module, and the Node inside
  // Electron - which the signing suite runs on - cannot require() one.
  const { flipFuses, FuseVersion, FuseV1Options } = await import('@electron/fuses');
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const target =
    context.electronPlatformName === 'darwin'
      ? path.join(context.appOutDir, appName)
      : path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);

  await flipFuses(target, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: false, // the signing step below does it properly
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
  console.log('  • fuses flipped (RunAsNode off, asar integrity enforced)');
}

/**
 * Refuses to package a Mac build that would not open on the oldest macOS we
 * promise. GD's Intel MacBook runs Catalina, 10.15; the build he was first
 * sent asked for 11.0 and would not start. See macosFloor.js.
 */
function enforceMacosFloor(context) {
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const result = checkFloor(appPath, FLOOR);
  if (result.problems.length) {
    const list = result.problems.map((p) => `    needs ${p.needs}: ${p.file}`).join('\n');
    throw new Error(`This build would not run on macOS ${FLOOR}:\n${list}`);
  }
  console.log(`  • runs on macOS ${FLOOR} and later (${result.binaries} compiled files checked)`);
}

/**
 * Signs `appPath` and everything in it, innermost first, as `identity` (a
 * certificate's SHA-1, found in `keychain`) or ad hoc ('-'). Throws unless the
 * result verifies - and, for a certificate, unless macOS now names the bundle
 * by that certificate. Returns how many nested items were signed.
 */
function signMacApp(appPath, { identity = '-', keychain = null, entitlements = ENTITLEMENTS } = {}) {
  const how = { identity, keychain };
  const frameworks = path.join(appPath, 'Contents', 'Frameworks');

  // Innermost first: loose binaries, then each framework, then the helper
  // apps, and only then the outer bundle.
  const targets = [
    ...collect(frameworks, (f) => f.endsWith('.dylib')),
    ...collect(path.join(appPath, 'Contents', 'Resources'), (f) => f.endsWith('.node')),
    path.join(frameworks, 'Electron Framework.framework', 'Versions', 'A', 'Helpers', 'chrome_crashpad_handler'),
  ].filter((t) => fs.existsSync(t));

  for (const target of targets) sign(target, how);

  // Frameworks are signed at the versioned directory, not the symlink.
  for (const entry of fs.existsSync(frameworks) ? fs.readdirSync(frameworks) : []) {
    if (!entry.endsWith('.framework')) continue;
    const versionA = path.join(frameworks, entry, 'Versions', 'A');
    sign(fs.existsSync(versionA) ? versionA : path.join(frameworks, entry), how);
  }

  // Helper apps carry the same entitlements as the parent.
  for (const entry of fs.existsSync(frameworks) ? fs.readdirSync(frameworks) : []) {
    if (entry.endsWith('.app')) sign(path.join(frameworks, entry), how, entitlements);
  }

  sign(appPath, how, entitlements);

  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  if (identity !== '-') {
    const named = execFileSync('codesign', ['-d', '-r-', appPath], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    if (!named.toLowerCase().includes(`certificate leaf = h"${identity.toLowerCase()}"`)) {
      throw new Error(`${appPath} was signed, but macOS does not name it by certificate ${identity}:\n${named}`);
    }
  }
  return targets.length;
}

exports.signMacApp = signMacApp;

exports.default = async function afterPack(context) {
  const keychain = process.env.GD_MAC_SIGN_KEYCHAIN || null;
  if (context.electronPlatformName === 'darwin' && !keychain && process.env.CI && !context.packager.config?.mac?.identity) {
    throw new Error('A Mac build on CI has to be signed with the project certificate, and GD_MAC_SIGN_KEYCHAIN is not set.');
  }
  await applyFuses(context);
  if (context.electronPlatformName !== 'darwin') return;
  enforceMacosFloor(context);
  if (context.packager.config?.mac?.identity) return; // a real identity is configured

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  // The release's certificate is the one installed copies insist on, and
  // nothing else: a keychain holding any other cannot sign this.
  const identity = keychain ? SIGNER : '-';
  const nested = signMacApp(appPath, { identity, keychain });
  console.log(keychain
    ? `  • signed ${appName} with the GD Suits Studio certificate (${nested + 1} nested items)`
    : `  • ad-hoc signed ${appName} (${nested + 1} nested items) - no signing keychain, so no installed copy takes this as an update`);
};
