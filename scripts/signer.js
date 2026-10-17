'use strict';

/**
 * A throwaway code-signing certificate, for the suites that sign app bundles
 * the way a release is signed.
 *
 * Made fresh for each run and put in a keychain of its own by
 * build/mac-keychain.sh - the script the release build uses - so every run of
 * these suites goes down the release's signing path too. Never the project's
 * real certificate, never the login keychain, and the keychain search list is
 * left as it was found.
 */

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEYCHAIN_SCRIPT = path.join(__dirname, '..', 'build', 'mac-keychain.sh');

const run = (file, args, env = {}) =>
  childProcess.execFileSync(file, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }).toString();

/** A certificate called `name`, kept under `dir`. Call remove() when done. */
function throwawaySigner(dir, name) {
  const base = path.join(dir, name.replace(/[^\w]+/g, '-'));
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const file = (f) => path.join(base, f);
  fs.writeFileSync(file('cert.cnf'), [
    '[req]', 'distinguished_name=dn', 'x509_extensions=ext', 'prompt=no',
    '[dn]', `CN=${name}`,
    '[ext]', 'basicConstraints=critical,CA:false', 'keyUsage=critical,digitalSignature',
    'extendedKeyUsage=critical,codeSigning', '',
  ].join('\n'));
  run('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '7',
    '-config', file('cert.cnf'), '-keyout', file('key.pem'), '-out', file('cert.pem')]);
  const P12_PASSWORD = crypto.randomBytes(18).toString('hex');
  run('/usr/bin/openssl', ['pkcs12', '-export', '-inkey', file('key.pem'), '-in', file('cert.pem'), '-name', name,
    '-passout', 'env:P12_PASSWORD', '-out', file('cert.p12')], { P12_PASSWORD });

  const keychain = file('signing.keychain-db');
  const identity = run(KEYCHAIN_SCRIPT, [file('cert.p12'), keychain], { P12_PASSWORD }).trim().toLowerCase();
  const sha1 = new crypto.X509Certificate(fs.readFileSync(file('cert.pem'))).fingerprint.replace(/:/g, '').toLowerCase();
  if (identity !== sha1) throw new Error(`the keychain holds ${identity || 'nothing'}, not the certificate ${sha1}`);

  return {
    name,
    sha1,
    keychain,
    /** codesign arguments that sign as this certificate. */
    args: ['--sign', sha1, '--keychain', keychain],
    remove() {
      try { run('/usr/bin/security', ['delete-keychain', keychain]); } catch { /* already gone */ }
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

module.exports = { throwawaySigner };
