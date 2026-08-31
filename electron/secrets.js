'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { safeStorage } = require('electron');

/**
 * The Gemini API key is the one real secret this app holds. It is encrypted
 * with the OS keychain (Keychain on macOS, DPAPI on Windows) so it is not
 * sitting in plain text next to the client database, and it never travels to
 * the renderer - only a masked hint does.
 */

let secretsPath = null;

function init(userDataPath) {
  secretsPath = path.join(userDataPath, 'secrets.json');
}

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
  } catch {
    return {};
  }
}

function writeAll(obj) {
  fs.writeFileSync(secretsPath, JSON.stringify(obj), { mode: 0o600 });
}

function set(name, value) {
  const store = readAll();

  if (!value) {
    delete store[name];
    writeAll(store);
    return;
  }

  if (safeStorage.isEncryptionAvailable()) {
    store[name] = { enc: safeStorage.encryptString(value).toString('base64') };
  } else {
    // No OS keychain (a bare Linux session, say). Store it, but mark it so the
    // UI can warn the tailor that it is not encrypted at rest.
    store[name] = { plain: value };
  }
  writeAll(store);
}

function get(name) {
  const entry = readAll()[name];
  if (!entry) return null;
  if (entry.plain) return entry.plain;
  try {
    return safeStorage.decryptString(Buffer.from(entry.enc, 'base64'));
  } catch {
    return null;
  }
}

/** What the UI is allowed to know: whether a key exists and its last 4 chars. */
function describe(name) {
  const value = get(name);
  if (!value) return { present: false, hint: '', encrypted: false };
  return {
    present: true,
    hint: `${'•'.repeat(8)}${value.slice(-4)}`,
    encrypted: safeStorage.isEncryptionAvailable(),
  };
}

module.exports = { init, set, get, describe };
