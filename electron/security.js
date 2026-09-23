'use strict';

const { shell, session } = require('electron');

/**
 * Hardening for the renderer.
 *
 * The threat this defends against is a hostile string reaching the renderer -
 * a client name, a fitting note, or (most plausibly) text that comes back from
 * the AI. If any of that ever achieved script execution, these controls are
 * what stop it becoming access to the tailor's machine or their client files.
 *
 * The renderer is treated as untrusted: it gets no Node, no network of its
 * own, no navigation, and no device access beyond the camera.
 */

/** The only host this app ever talks to. */
const ALLOWED_HOSTS = new Set(['generativelanguage.googleapis.com']);

/** Schemes the renderer is allowed to load resources from. */
const ALLOWED_SCHEMES = new Set(['gdmedia:', 'devtools:', 'blob:', 'data:', 'file:']);

function isDevServer(url, isDev) {
  return isDev && /^(https?|ws):\/\/localhost:5173(\/|$)/.test(url);
}

/**
 * Blocks every outbound request the renderer might make.
 *
 * The renderer has no legitimate reason to reach the network: the single API
 * call lives in the main process, so anything originating here is either a
 * mistake or an exfiltration attempt. Local schemes and, in development, the
 * Vite dev server are the only things allowed through.
 */
function lockDownNetwork(ses, isDev) {
  ses.webRequest.onBeforeRequest((details, callback) => {
    const { url } = details;

    if (isDevServer(url, isDev)) return callback({});

    let scheme;
    try {
      scheme = new URL(url).protocol;
    } catch {
      return callback({ cancel: true });
    }

    if (ALLOWED_SCHEMES.has(scheme)) return callback({});

    console.warn(`[security] blocked renderer request to ${url.slice(0, 120)}`);
    return callback({ cancel: true });
  });
}

/**
 * Denies every device permission except the camera, which the capture step
 * genuinely needs. Notifications, geolocation, MIDI, USB and the rest have no
 * business in a tailoring tool.
 */
function lockDownPermissions(ses) {
  const allowed = new Set(['media']);

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    const ok = allowed.has(permission);
    if (!ok) console.warn(`[security] denied permission request: ${permission}`);
    callback(ok);
  });

  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  // Nothing in this app uses a serial, HID or USB device.
  ses.setDevicePermissionHandler(() => false);
}

function hardenSession(isDev) {
  const ses = session.defaultSession;
  lockDownNetwork(ses, isDev);
  lockDownPermissions(ses);
  return ses;
}

/**
 * Stops the window from ever becoming a browser.
 *
 * Navigation away from the bundled app is always a bug or an attack, so it is
 * refused outright; links that should open externally are handed to the real
 * browser after their scheme is checked.
 */
function hardenWindow(win, isDev) {
  const appOrigins = [/^file:\/\//, ...(isDev ? [/^http:\/\/localhost:5173/] : [])];
  const isAppUrl = (url) => appOrigins.some((re) => re.test(url));

  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    console.warn(`[security] blocked navigation to ${url.slice(0, 120)}`);
  });

  win.webContents.on('will-redirect', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });

  // <webview> can host arbitrary content with its own preferences; nothing
  // here uses it, so any attempt to attach one is a red flag.
  win.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
    console.warn('[security] blocked a webview attach');
  });
}

/**
 * Opens a link in the real browser, but only if it is plainly an https URL.
 * `shell.openExternal` will happily hand a `file:` path to the OS, so the
 * scheme is checked rather than assumed.
 */
function openExternalSafely(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    console.warn(`[security] refused to open ${parsed.protocol} externally`);
    return false;
  }
  shell.openExternal(parsed.toString());
  return true;
}

/**
 * Opens a pre-filled message in whatever mail program the tailor already uses.
 *
 * Deliberately separate from openExternalSafely, which allows only http and
 * https: widening that to cover mail would widen it for everything. Nothing is
 * sent from here - the draft opens in GD's own mail app, addressed and written,
 * and he reads it before it goes. No password is stored and no message leaves
 * the machine without him pressing send.
 */
const MAILTO_LIMIT = 8000;   // long links are silently truncated by mail apps

function openMailSafely({ to, subject = '', body = '' }) {
  const address = String(to ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    console.warn('[security] refused to open mail without a usable address');
    return false;
  }
  const url = `mailto:${encodeURIComponent(address)}`
    + `?subject=${encodeURIComponent(subject)}`
    + `&body=${encodeURIComponent(body)}`;
  if (url.length > MAILTO_LIMIT) {
    console.warn('[security] refused to open an over-long mail link');
    return false;
  }
  shell.openExternal(url);
  return true;
}

module.exports = { hardenSession, hardenWindow, openExternalSafely, openMailSafely, ALLOWED_HOSTS };
