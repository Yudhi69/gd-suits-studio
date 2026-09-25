'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');

/**
 * Update checking.
 *
 * This deliberately checks and notifies rather than installing by itself.
 * Squirrel, the machinery behind Electron's auto-update, validates the code
 * signature of the replacement bundle, and these builds are ad-hoc signed
 * because there is no Apple Developer ID yet - a silent self-update would
 * simply fail on macOS. Handing the download to the browser instead means the
 * tailor sees what they are installing, which is the right default for an app
 * that cannot yet prove its own provenance.
 *
 * The app will, on request, fetch the file - that is a download, not an
 * install. It is written to disk with no executable bit and shown in the
 * file manager; opening it is the tailor's decision, taken in the operating
 * system's own dialogs, where an unsigned app is named as such. Nothing this
 * app downloads is ever run by this app.
 *
 * Once a Developer ID exists, `electron-updater` can be dropped in behind the
 * same button; the feed shape below is already what it expects.
 */

const GITHUB_API = /^https:\/\/api\.github\.com\/repos\/[\w.-]+\/[\w.-]+\/releases/;

class UpdateError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'UpdateError';
    this.code = code;
  }
}

/**
 * The installed version.
 *
 * `app.getVersion()` reports *Electron's* version when the app runs
 * unpackaged, which would make every comparison meaningless in development and
 * silently wrong if it ever leaked into a build. The app's own package.json is
 * the authority; it sits at the root of the asar in a packaged build and at
 * the project root otherwise, so one path covers both.
 */
function currentVersion() {
  try {
    const { version } = require('../package.json');
    if (version) return version;
  } catch {
    /* fall through to Electron's answer */
  }
  return app.getVersion();
}

/** Compares dotted versions numerically. Returns >0 when a is newer than b. */
function compareVersions(a, b) {
  const clean = (v) => String(v ?? '').trim().replace(/^v/i, '').split('-')[0];
  const pa = clean(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = clean(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/** Picks the download that matches the machine doing the asking. */
function pickAsset(assets = []) {
  const names = assets.map((a) => ({ ...a, lower: String(a.name ?? '').toLowerCase() }));
  if (process.platform === 'darwin') {
    const dmgs = names.filter((a) => a.lower.endsWith('.dmg'));
    const arm = dmgs.find((a) => a.lower.includes('arm64'));
    const intel = dmgs.find((a) => !a.lower.includes('arm64'));
    return (process.arch === 'arm64' ? arm ?? intel : intel ?? arm) ?? null;
  }
  if (process.platform === 'win32') {
    return names.find((a) => a.lower.endsWith('.exe')) ?? null;
  }
  return names.find((a) => a.lower.endsWith('.appimage') || a.lower.endsWith('.deb')) ?? null;
}

async function fetchFeed(feedUrl, token) {
  let parsed;
  try {
    parsed = new URL(feedUrl);
  } catch {
    throw new UpdateError('The update address is not a valid URL.', 'bad_feed');
  }
  // Refuse plain http: an update feed is exactly the thing not to take over an
  // unauthenticated channel.
  if (parsed.protocol !== 'https:') {
    throw new UpdateError('Updates can only be checked over https.', 'insecure_feed');
  }

  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'GD-Suits-Studio' };
  if (token) headers.authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let res;
  try {
    res = await fetch(parsed.toString(), { headers, signal: controller.signal, redirect: 'follow' });
  } catch (err) {
    throw new UpdateError(
      err.name === 'AbortError'
        ? 'The update check timed out.'
        : 'Could not reach the update server. Check the internet connection.',
      'offline'
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) {
    throw new UpdateError(
      'No releases found at that address. If the repository is private, add an access token below.',
      'not_found'
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new UpdateError('The update server refused the request - the access token may be missing or expired.', 'forbidden');
  }
  if (!res.ok) throw new UpdateError(`The update server returned HTTP ${res.status}.`, 'http');

  try {
    return await res.json();
  } catch {
    throw new UpdateError('The update feed was not readable.', 'parse');
  }
}

/**
 * Normalises either shape of feed into one answer:
 *   - a GitHub releases endpoint, or
 *   - a plain JSON file: { version, notes, url, assets: [{ name, url }] }
 */
function normalise(feedUrl, payload) {
  const isGithub = GITHUB_API.test(feedUrl);

  if (isGithub) {
    const release = Array.isArray(payload) ? payload.find((r) => !r.draft) : payload;
    if (!release) throw new UpdateError('No published release was found.', 'not_found');
    const asset = pickAsset(release.assets ?? []);
    return {
      version: String(release.tag_name ?? release.name ?? '').replace(/^v/i, ''),
      notes: release.body ?? '',
      pageUrl: release.html_url ?? '',
      downloadUrl: asset?.browser_download_url ?? release.html_url ?? '',
      downloadName: asset?.name ?? '',
      downloadSize: Number(asset?.size) || 0,
      downloadDigest: String(asset?.digest ?? ''),
      publishedAt: release.published_at ?? '',
      prerelease: !!release.prerelease,
    };
  }

  const asset = pickAsset(payload.assets ?? []);
  return {
    version: String(payload.version ?? '').replace(/^v/i, ''),
    notes: payload.notes ?? '',
    pageUrl: payload.url ?? '',
    downloadUrl: asset?.url ?? payload.url ?? '',
    downloadName: asset?.name ?? '',
    downloadSize: Number(asset?.size) || 0,
    downloadDigest: String(asset?.digest ?? ''),
    publishedAt: payload.publishedAt ?? '',
    prerelease: false,
  };
}

/**
 * Whether a download address may be fetched, given the feed that named it.
 *
 * The feed is a setting, so a wrong or hostile one could name a file anywhere.
 * The rule is that a download comes from where its feed comes from: the same
 * host, or - because GitHub serves the JSON from one host and the file from
 * another - GitHub's own release hosts when the feed is GitHub's API. Always
 * https, so the file cannot be swapped in transit.
 */
function allowedDownload(feedUrl, downloadUrl) {
  let feed, file;
  try {
    feed = new URL(feedUrl);
    file = new URL(downloadUrl);
  } catch {
    return false;
  }
  if (file.protocol !== 'https:' || feed.protocol !== 'https:') return false;
  if (file.host === feed.host) return true;
  const github = feed.host === 'api.github.com' || feed.host === 'github.com';
  return github && (file.host === 'github.com' || file.host.endsWith('.githubusercontent.com'));
}

/**
 * The name the file may be saved under.
 *
 * Taken apart and rebuilt rather than trusted: only the last path segment,
 * only characters that name a file, and only the handful of extensions an
 * installer actually has. A feed cannot use this to write `.command` into
 * anyone's Downloads folder, nor to write outside it at all.
 */
const INSTALLER_EXTENSIONS = ['.dmg', '.exe', '.zip', '.appimage', '.deb'];
function safeAssetName(name, fallback = 'GD-Suits-Studio-update') {
  const base = String(name ?? '').split(/[\\/]/).pop().trim();
  const ext = INSTALLER_EXTENSIONS.find((e) => base.toLowerCase().endsWith(e));
  if (!ext) return null;
  const stem = base.slice(0, -ext.length).replace(/[^\w .()+-]/g, '-').replace(/^[-.\s]+/, '').slice(0, 100);
  return `${stem || fallback}${ext}`;
}

/** Room for an installer, and no room for anything pretending to be one. */
const MAX_DOWNLOAD_BYTES = 600 * 1024 * 1024;

/**
 * Fetches a release file to `dir` and returns where it landed.
 *
 * It is written to a `.part` file and only given its real name once it is
 * whole, so a download cut halfway through cannot be mistaken for an
 * installer. The bytes are hashed as they arrive: when the feed states a
 * digest the file must match it, and when it states a size the file must be
 * exactly that long. Mode 0o644 - readable, writable, and not executable.
 */
async function download({ feedUrl, url, name, size = 0, digest = '', token, dir, onProgress, signal }) {
  if (!allowedDownload(feedUrl, url)) {
    throw new UpdateError('That download does not come from the same place as the update feed.', 'bad_host');
  }
  const filename = safeAssetName(name || new URL(url).pathname);
  if (!filename) throw new UpdateError('That release file is not an installer this app will save.', 'bad_asset');
  if (size > MAX_DOWNLOAD_BYTES) throw new UpdateError('That download is too large to be an installer.', 'too_large');

  const headers = { accept: 'application/octet-stream', 'user-agent': 'GD-Suits-Studio' };
  if (token) headers.authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url, { headers, signal, redirect: 'follow' });
  } catch (err) {
    if (err?.name === 'AbortError') throw new UpdateError('The download was stopped.', 'cancelled');
    throw new UpdateError('Could not reach the download. Check the internet connection.', 'offline');
  }
  // Redirects are followed, so where it ended up is checked as well as where
  // it was asked to go.
  if (!allowedDownload(feedUrl, res.url || url)) {
    throw new UpdateError('That download was redirected somewhere it should not be.', 'bad_host');
  }
  if (res.status === 401 || res.status === 403) {
    throw new UpdateError('The download was refused - the access token may be missing or expired.', 'forbidden');
  }
  if (!res.ok || !res.body) throw new UpdateError(`The download returned HTTP ${res.status}.`, 'http');

  const stated = Number(res.headers.get('content-length')) || size;
  if (stated > MAX_DOWNLOAD_BYTES) throw new UpdateError('That download is too large to be an installer.', 'too_large');

  fs.mkdirSync(dir, { recursive: true });
  const part = path.join(dir, `${filename}.part`);
  const handle = fs.openSync(part, 'w', 0o644);
  const hash = crypto.createHash('sha256');
  let written = 0, lastReport = 0;
  try {
    for await (const chunk of res.body) {
      written += chunk.length;
      if (written > MAX_DOWNLOAD_BYTES) throw new UpdateError('That download is too large to be an installer.', 'too_large');
      hash.update(chunk);
      fs.writeSync(handle, chunk);
      const now = Date.now();
      // The first chunk reports at once and the rest five times a second.
      // Throttling the first one too meant a download that finished inside
      // 200ms never reported at all, and the bar never appeared - which is
      // exactly what the test file does.
      if (onProgress && (lastReport === 0 || now - lastReport > 200)) {
        lastReport = now;
        onProgress({ bytes: written, total: stated, name: filename });
      }
    }
  } catch (err) {
    fs.closeSync(handle);
    fs.rmSync(part, { force: true });
    if (err instanceof UpdateError) throw err;
    if (err?.name === 'AbortError') throw new UpdateError('The download was stopped.', 'cancelled');
    throw new UpdateError('The download did not finish.', 'incomplete');
  }
  fs.closeSync(handle);

  const sha256 = hash.digest('hex');
  const expected = /^sha256:([0-9a-f]{64})$/i.exec(digest)?.[1]?.toLowerCase();
  const fail = (message, code) => { fs.rmSync(part, { force: true }); throw new UpdateError(message, code); };
  if (size && written !== size) fail('The download did not arrive whole - it is not the size the release says it is.', 'size_mismatch');
  if (!size && stated && written !== stated) fail('The download did not arrive whole.', 'incomplete');
  if (expected && sha256 !== expected) fail('The download does not match the release - it has been altered.', 'digest_mismatch');

  // A second copy is given a name of its own rather than overwriting the first.
  let final = path.join(dir, filename);
  for (let n = 2; fs.existsSync(final); n++) {
    const ext = path.extname(filename);
    final = path.join(dir, `${path.basename(filename, ext)} (${n})${ext}`);
  }
  fs.renameSync(part, final);
  fs.chmodSync(final, 0o644);
  if (onProgress) onProgress({ bytes: written, total: written, name: path.basename(final) });

  return {
    path: final,
    name: path.basename(final),
    bytes: written,
    sha256,
    verified: expected ? 'digest' : size ? 'size' : 'none',
  };
}

async function check({ feedUrl, token }) {
  const current = currentVersion();
  if (!feedUrl) throw new UpdateError('No update address is configured.', 'no_feed');

  const release = normalise(feedUrl, await fetchFeed(feedUrl, token));
  if (!release.version) throw new UpdateError('The feed did not name a version.', 'no_version');

  return {
    current,
    ...release,
    updateAvailable: compareVersions(release.version, current) > 0,
    // The file can be fetched, but never applied: macOS refuses to swap out a
    // bundle that is not properly signed, and this app does not run what it
    // downloads. Installing stays a decision the tailor makes in Finder.
    canDownload: !!release.downloadUrl && allowedDownload(feedUrl, release.downloadUrl),
    canSelfInstall: false,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  check, download, compareVersions, pickAsset, currentVersion,
  allowedDownload, safeAssetName, UpdateError,
};
