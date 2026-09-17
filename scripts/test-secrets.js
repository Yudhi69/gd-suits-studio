/**
 * The secret store.
 *
 * The case that matters: a key saved while the OS keychain was unavailable is
 * written in plain text, and because only set() ever encrypts, it stays that
 * way for the life of the install. Reading it must put that right.
 */
const { app, safeStorage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };

app.whenReady().then(() => {
  const secrets = require('../electron/secrets.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-secrets-'));
  const file = path.join(dir, 'secrets.json');
  secrets.init(dir);
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));

  log('=== a key written in the clear is encrypted when next read ===');
  fs.writeFileSync(file, JSON.stringify({ gemini: { plain: 'AIza-test-key-1234' } }));
  check(!!read().gemini.plain, 'starts in plain text (as a stranded key would)');

  const got = secrets.get('gemini');
  check(got === 'AIza-test-key-1234', 'the value still comes back intact', String(got));
  if (safeStorage.isEncryptionAvailable()) {
    check(!read().gemini.plain, 'the plain copy is gone from disk');
    check(!!read().gemini.enc, 'and an encrypted one is in its place');
    check(secrets.get('gemini') === 'AIza-test-key-1234', 'it still reads back after the upgrade');
  } else {
    log('  - no OS keychain here, so the upgrade cannot be checked');
  }

  log('\n=== the rest of the contract is unchanged ===');
  secrets.set('openai', 'sk-abc-9999');
  check(secrets.get('openai') === 'sk-abc-9999', 'a key round-trips through set/get');
  check(safeStorage.isEncryptionAvailable() ? !!read().openai.enc : !!read().openai.plain,
    'set() encrypts when it can');
  check(secrets.get('nothing') === null, 'an absent key is null, not a throw');
  const d = secrets.describe('openai');
  check(d.present && d.hint.endsWith('9999') && !d.hint.includes('sk-'),
    'describe() reveals only the last four', JSON.stringify(d));
  secrets.set('openai', '');
  check(secrets.get('openai') === null, 'setting empty removes it');
  check(!('openai' in read()), 'and it leaves no trace on disk');

  // A file that is corrupt or unreadable must not take the app down with it.
  fs.writeFileSync(file, 'not json at all');
  check(secrets.get('gemini') === null, 'a corrupt store reads as no key, not a crash');

  fs.rmSync(dir, { recursive: true, force: true });
  log(`\n${fail === 0 ? 'ALL SECRET CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
