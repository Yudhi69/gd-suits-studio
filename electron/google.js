'use strict';

/**
 * GD's Google account, linked the way Google asks a desktop app to link one.
 *
 * The browser opens Google's own consent page; GD signs in there, never in
 * this app, and Google sends the browser back to a listener this app opens for that
 * moment on 127.0.0.1 alone. What comes back is a one-time code, which is
 * worth nothing without the matching secret (PKCE) that never left this
 * process, and which is only accepted with the random `state` this attempt
 * made, so a page or program that guesses the port cannot finish it.
 *
 * The permission asked for is `drive.file`: the files this app makes, and no
 * other. The spreadsheet is one the app creates, so that is all it needs, and
 * a token that leaked could not read anything else in that Drive.
 *
 * Only the refresh token is kept (in the keychain, by the caller). The access
 * token it buys lasts an hour and stays in memory.
 */

const http = require('node:http');
const crypto = require('node:crypto');

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const HOSTS = ['oauth2.googleapis.com', 'sheets.googleapis.com'];

const LINK_TIMEOUT_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** An error GD can read, carrying a code the caller can act on. */
function failure(message, code = 'google') {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** Compares two strings without telling a caller how much of it was right. */
function same(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * What a token endpoint said, or a plain error. Google's error bodies are
 * reduced to their short code: a description could carry anything, and a
 * token must never end up in a message shown on screen or written to a log.
 */
async function tokenCall(form) {
  let res;
  try {
    res = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw failure('Google could not be reached. Check the internet connection and try again.', 'unreachable');
  }
  let body = {};
  try { body = await res.json(); } catch { /* an empty or broken body is handled below */ }
  if (res.ok) return body;
  const code = /^[a-z_]{1,40}$/.test(body?.error ?? '') ? body.error : `http_${res.status}`;
  if (code === 'invalid_grant') {
    throw failure('Google no longer accepts this link. Link the Google account again.', 'unlinked');
  }
  if (code === 'invalid_client' || code === 'unauthorized_client') {
    throw failure('Google did not recognise the client id and secret. Check both, then link again.', 'client');
  }
  throw failure(`Google refused the request (${code}).`);
}

/** The page shown in the browser when Google sends it back. Fixed text only. */
function reply(res, status, message) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'",
  });
  res.end(`<!doctype html><meta charset="utf-8"><title>GD Suits</title>`
    + `<p style="font:16px system-ui;margin:3em auto;max-width:32em">${message}</p>`);
}

/**
 * Links an account: resolves with `{ refreshToken, accessToken, expiresAt }`.
 *
 * `open` hands the consent page to the browser and says whether it could.
 * The listener answers one finished attempt and closes; anything else that
 * reaches it - another path, the wrong state - is turned away and the wait
 * goes on, so nothing on this machine can end it early by knocking.
 */
function link({ clientId, clientSecret, open, timeoutMs = LINK_TIMEOUT_MS }) {
  if (!clientId || !clientSecret) {
    return Promise.reject(failure('Save the Google client id and secret first.', 'client'));
  }
  return new Promise((resolve, reject) => {
    const state = b64url(crypto.randomBytes(24));
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    let redirectUri = '';
    let settled = false;
    let answered = false;

    const server = http.createServer((req, res) => {
      let url;
      try { url = new URL(req.url, redirectUri); } catch { return reply(res, 400, 'Not this.'); }
      if (answered || req.method !== 'GET' || url.pathname !== '/' || !same(url.searchParams.get('state'), state)) {
        return reply(res, 400, 'This page is not part of linking GD Suits.');
      }
      answered = true;
      const refused = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (refused || !code) {
        reply(res, 200, 'Linking was cancelled. You can close this tab and go back to GD Suits.');
        return finish(failure(refused === 'access_denied'
          ? 'Google was not given permission, so nothing was linked.'
          : 'Google did not finish linking the account.', 'cancelled'));
      }
      reply(res, 200, 'GD Suits is linked to your Google account. You can close this tab.');
      exchange(code).then((value) => finish(null, value), (err) => finish(err));
    });

    function finish(err, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      server.closeAllConnections?.();
      if (err) reject(err); else resolve(value);
    }

    async function exchange(code) {
      const body = await tokenCall({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      });
      if (!String(body.scope ?? '').split(/\s+/).includes(SCOPE)) {
        // Not kept, so not left valid at Google either.
        if (body.refresh_token) void revoke(String(body.refresh_token));
        throw failure('Google did not allow access to the files this app makes. Link again and leave that box ticked.', 'scope');
      }
      if (!body.refresh_token || !body.access_token) {
        throw failure('Google did not hand back a lasting link. Link the Google account again.');
      }
      return {
        refreshToken: String(body.refresh_token),
        accessToken: String(body.access_token),
        expiresAt: Date.now() + Math.max(60, Number(body.expires_in) || 3600) * 1000,
      };
    }

    const timer = setTimeout(
      () => finish(failure('Linking timed out. Press Link again when you are ready.', 'timeout')),
      timeoutMs
    );
    server.on('error', () => finish(failure('This computer would not let the app listen for Google’s answer.')));
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${server.address().port}`;
      const url = new URL(AUTH);
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        access_type: 'offline',
        prompt: 'consent',
      }).toString();
      if (!open(url.toString())) finish(failure('The browser could not be opened.'));
    });
  });
}

/** A fresh access token from the kept refresh token. */
async function refresh({ clientId, clientSecret, refreshToken }) {
  const body = await tokenCall({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (!body.access_token) throw failure('Google did not hand back access. Link the Google account again.', 'unlinked');
  return {
    accessToken: String(body.access_token),
    expiresAt: Date.now() + Math.max(60, Number(body.expires_in) || 3600) * 1000,
  };
}

/** Tells Google to forget the link. Best effort: unlinking here happens anyway. */
async function revoke(token) {
  try {
    await fetch(REVOKE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * One call to the Sheets API, as `path` under /v4/spreadsheets.
 *
 * `token(fresh)` hands over an access token. One that Google turns down with
 * a 401 has run out early (or was revoked), so a fresh one is asked for and
 * the call made once more - never more than once, so a token that is really
 * refused cannot keep the app knocking.
 */
async function sheets(token, method, path, body) {
  for (let attempt = 0; ; attempt++) {
    const access = await token(attempt > 0);
    let res;
    try {
      res = await fetch(`${SHEETS}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${access}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw failure('Google could not be reached. Check the internet connection and try again.', 'unreachable');
    }
    if (res.status === 401 && attempt === 0) continue;
    let data = {};
    try { data = await res.json(); } catch { /* an empty body is handled below */ }
    if (res.ok) return data;
    if (res.status === 404) {
      throw failure('The spreadsheet is no longer in this Google account. Make a new one.', 'missing');
    }
    if (res.status === 401 || res.status === 403) {
      throw failure('Google would not let the app write to the spreadsheet. Link the Google account again.', 'forbidden');
    }
    if (res.status === 429 || res.status >= 500) {
      throw failure('Google Sheets is busy. The copy will be written with the next change.', 'busy');
    }
    throw failure(`Google Sheets refused the write (${res.status}).`);
  }
}

module.exports = { link, refresh, revoke, sheets, failure, SCOPE, HOSTS, AUTH, TOKEN, REVOKE, SHEETS };
