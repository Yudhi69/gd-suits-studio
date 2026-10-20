'use strict';

/**
 * Where GD's data may go, and the details of getting it there.
 *
 * Everything this app does works on his own machine. These are the three
 * things that would change that - sending mail as him, writing his orders to
 * a spreadsheet, and keeping photographs in a Drive folder - so they are off
 * until he turns them on, and they are off one at a time rather than behind a
 * single switch that means more than it says.
 *
 * `consent` is the gate above all three. It is not a formality: a tailor's
 * database is four hundred people's names, telephone numbers, addresses and
 * measurements, plus photographs of them. Sending that to a third party is
 * his decision to make knowingly, and the app should be able to prove it was
 * made - so nothing reaches Google unless this is on, and turning it off
 * stops everything at once without losing what was configured.
 */

const SERVICES = ['gmail', 'sheets', 'drive'];

/** How a message actually leaves. */
const SEND_METHODS = [
  {
    key: 'draft',
    label: 'Open a draft in my mail program',
    describes: 'Nothing is sent by the app. It writes the message and you press send.',
  },
  {
    key: 'gmail',
    label: 'Send through Gmail',
    describes: 'The app sends it directly. Needs an app password from your Google account.',
  },
];
const SEND_METHOD_KEYS = SEND_METHODS.map((m) => m.key);

/**
 * The secrets these need. Kept beside the settings they belong to so a new
 * service cannot be wired up without its key being declared somewhere the
 * main process checks.
 */
const SECRET_NAMES = ['gmailAppPassword', 'googleClientId', 'googleClientSecret', 'googleRefreshToken'];

/**
 * The secrets only the main process writes. The account token comes from
 * Google when GD links the account, never from a page: a page that could set
 * it could point the spreadsheet copy at an account that is not GD's.
 */
const MAIN_ONLY_SECRETS = ['googleRefreshToken'];

/**
 * The Google application details. Changing either one is a different
 * application, so the account linked through the old one is unlinked.
 */
const GOOGLE_CLIENT_SECRETS = ['googleClientId', 'googleClientSecret'];

const DEFAULTS = {
  consent: false,
  gmail: {
    method: 'draft',
    address: '',
  },
  sheets: {
    enabled: false,
    /** The spreadsheet the app made. Only the main process sets it, and keeps it apart (main.js connections). */
    spreadsheetId: '',
    /** 'manual' - he presses a button. 'onSave' - every change goes up. */
    when: 'manual',
  },
  drive: {
    enabled: false,
    photosFolderId: '',
    exportsFolderId: '',
  },
};

/** A Google id out of a URL, because nobody copies the id, they copy the URL. */
function idFrom(value, kind) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const patterns = {
    spreadsheet: /\/spreadsheets\/d\/([A-Za-z0-9_-]{10,})/,
    folder: /\/folders\/([A-Za-z0-9_-]{10,})/,
  };
  const found = patterns[kind]?.exec(text);
  if (found) return found[1];
  // Already an id, or something that is not one - either way it is checked
  // against the same shape rather than trusted because it was short.
  return /^[A-Za-z0-9_-]{10,200}$/.test(text) ? text : '';
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * A stored configuration, whatever arrived.
 *
 * Nothing is trusted: an address that is not an address, a spreadsheet or
 * folder id that is really a whole URL.
 * Each is corrected or dropped rather than stored, because these values are
 * used to decide where a client's details are about to be written.
 */
function withDefaults(stored) {
  const raw = stored && typeof stored === 'object' ? stored : {};
  const gmail = raw.gmail ?? {};
  const sheets = raw.sheets ?? {};
  const drive = raw.drive ?? {};
  const address = String(gmail.address ?? '').trim().slice(0, 200);

  return {
    consent: !!raw.consent,
    gmail: {
      method: SEND_METHOD_KEYS.includes(gmail.method) ? gmail.method : 'draft',
      address: EMAIL.test(address) ? address : '',
    },
    sheets: {
      enabled: !!sheets.enabled,
      spreadsheetId: idFrom(sheets.spreadsheetId, 'spreadsheet'),
      when: sheets.when === 'onSave' ? 'onSave' : 'manual',
    },
    drive: {
      enabled: !!drive.enabled,
      photosFolderId: idFrom(drive.photosFolderId, 'folder'),
      exportsFolderId: idFrom(drive.exportsFolderId, 'folder'),
    },
  };
}

/**
 * Whether a service may actually run, and if not, precisely what is missing.
 *
 * One place answers this, because "is Sheets on?" is asked by the settings
 * page, by whatever writes a row, and by the tests - and three answers that
 * drift apart is how data goes somewhere nobody agreed to.
 */
function statusOf(service, config, hasSecret) {
  const c = withDefaults(config);
  if (!SERVICES.includes(service)) return { ready: false, why: 'No such service.' };

  if (!c.consent) {
    return { ready: false, why: 'Sending anything off this machine is switched off.' };
  }

  if (service === 'gmail') {
    if (c.gmail.method !== 'gmail') {
      return { ready: false, why: 'Mail opens as a draft, so nothing is sent by the app.' };
    }
    if (!c.gmail.address) return { ready: false, why: 'No Gmail address set.' };
    if (!hasSecret('gmailAppPassword')) return { ready: false, why: 'No app password saved yet.' };
    return { ready: true, why: `Sending as ${c.gmail.address}.` };
  }

  // Sheets and Drive both go through the same Google account.
  const google = hasSecret('googleClientId') && hasSecret('googleClientSecret');
  const linked = hasSecret('googleRefreshToken');

  // The spreadsheet is asked about last: the app makes it, which needs the
  // account linked first, so "no spreadsheet yet" is the one gap the app can
  // close itself (`needs` says so).
  if (service === 'sheets') {
    if (!c.sheets.enabled) return { ready: false, why: 'Switched off.' };
    if (!google) return { ready: false, why: 'No Google application details saved yet.' };
    if (!linked) return { ready: false, why: 'Google account not linked yet.' };
    if (!c.sheets.spreadsheetId) return { ready: false, why: 'No spreadsheet made yet.', needs: 'spreadsheet' };
    return { ready: true, why: 'Copying the database to the spreadsheet the app made.' };
  }

  if (!c.drive.enabled) return { ready: false, why: 'Switched off.' };
  if (!c.drive.photosFolderId && !c.drive.exportsFolderId) {
    return { ready: false, why: 'No folder chosen.' };
  }
  if (!google) return { ready: false, why: 'No Google application details saved yet.' };
  if (!linked) return { ready: false, why: 'Google account not linked yet.' };
  return { ready: true, why: 'Storing in the folders chosen.' };
}

module.exports = {
  SERVICES, SEND_METHODS, SEND_METHOD_KEYS, SECRET_NAMES, MAIN_ONLY_SECRETS, GOOGLE_CLIENT_SECRETS, DEFAULTS,
  withDefaults, statusOf, idFrom,
};
