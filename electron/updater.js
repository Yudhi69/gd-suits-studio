'use strict';

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
    publishedAt: payload.publishedAt ?? '',
    prerelease: false,
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
    // macOS refuses to swap out a bundle that is not properly signed, so the
    // download is handed to the browser rather than applied in place.
    canSelfInstall: false,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = { check, compareVersions, pickAsset, currentVersion, UpdateError };
