'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

let mediaRoot = null;

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/gif': '.gif',
};

function init(userDataPath) {
  mediaRoot = path.join(userDataPath, 'media');
  fs.mkdirSync(mediaRoot, { recursive: true });
  return mediaRoot;
}

/**
 * Media is filed under a scope folder rather than a bare id. Scopes are always
 * non-numeric (`project-12`, `client-3`) because the gdmedia:// URL carries the
 * scope as a path segment and a bare number would be read as an IP address.
 */
const scopeForProject = (projectId) => `project-${projectId}`;
const scopeForClient = (clientId) => `client-${clientId}`;

function scopeDir(scope) {
  if (!/^[a-z]+-\d+$/.test(String(scope))) throw new Error(`Invalid media scope: ${scope}`);
  const dir = path.join(mediaRoot, String(scope));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Resolves a stored file, refusing anything that escapes the project folder.
 * Filenames reach here from the renderer and from the database, so this is the
 * one place that guarantees a read stays inside the media root.
 */
function resolveSafe(scope, filename) {
  const dir = scopeDir(scope);
  const full = path.resolve(dir, filename);
  const rel = path.relative(dir, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Refused to access a path outside the project media folder');
  }
  return full;
}

/** Persists raw image bytes and returns the generated filename. */
function saveImage(scope, buffer, mime, prefix = 'img') {
  const ext = EXT_BY_MIME[mime] ?? '.bin';
  const filename = `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}${ext}`;
  fs.writeFileSync(resolveSafe(scope, filename), buffer);
  return filename;
}

/** Accepts a `data:` URL from the renderer (canvas, camera or file picker). */
function saveDataUrl(scope, dataUrl, prefix = 'img') {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl ?? '');
  if (!match) throw new Error('Not a data URL');
  const [, mime, isB64, payload] = match;
  const buffer = isB64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
  return { filename: saveImage(scope, buffer, mime, prefix), mime };
}

function readImage(scope, filename) {
  return fs.readFileSync(resolveSafe(scope, filename));
}

function readAsBase64(scope, filename) {
  return readImage(scope, filename).toString('base64');
}

function mimeForFile(filename) {
  const ext = path.extname(filename).toLowerCase();
  const found = Object.entries(EXT_BY_MIME).find(([, e]) => e === ext);
  return found ? found[0] : 'application/octet-stream';
}

function deleteImage(scope, filename) {
  try {
    fs.unlinkSync(resolveSafe(scope, filename));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function deleteScopeMedia(scope) {
  fs.rmSync(path.join(mediaRoot, String(scope)), { recursive: true, force: true });
}

module.exports = {
  init,
  scopeDir,
  scopeForProject,
  scopeForClient,
  resolveSafe,
  saveImage,
  saveDataUrl,
  readImage,
  readAsBase64,
  mimeForFile,
  deleteImage,
  deleteScopeMedia,
  get root() {
    return mediaRoot;
  },
};
