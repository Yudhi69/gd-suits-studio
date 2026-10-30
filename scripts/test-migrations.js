const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));
const db = require('../electron/db.js');

/**
 * Migration chain test.
 *
 * A tailor's database is upgraded in place on every launch, so the risk is not
 * a fresh install - it is an install that has been in use since v1. This builds
 * a database at each historical version, seeds it, then opens it with the
 * current code and checks the data survived and the transformations landed.
 */

const log = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };

const LATEST = db.SCHEMA_VERSION;

/** A database frozen at `version`, with only the migrations up to it applied. */
function makeDbAt(version, dir) {
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  const raw = new Database(path.join(dir, 'data', 'gdsuits.db'));
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  for (let i = 0; i < version; i++) db.MIGRATIONS[i](raw);
  raw.pragma(`user_version = ${version}`);
  return raw;
}

/** Data every version can hold - the v1 tables. */
function seedV1(raw) {
  raw.prepare("INSERT INTO clients (name, surname, contact, email) VALUES ('Sipho','Ndlovu','082','s@e.com')").run();
  raw.prepare(`INSERT INTO projects (client_id, title, event_type, event_date, status, spec_json)
               VALUES (1,'Wedding suit','wedding','2026-11-14','fitting','{"suitType":"three_piece","lapel":"peak"}')`).run();
  raw.prepare("INSERT INTO photos (project_id, slot, filename) VALUES (1,'front','front-a1-b2.jpg')").run();
  raw.prepare("INSERT INTO notes (project_id, step, body) VALUES (1,'jacket','Bolder peak lapel.')").run();
  raw.prepare("INSERT INTO measurements (project_id, garment, field_id, value) VALUES (1,'jacket','chest',104)").run();
  raw.prepare("INSERT INTO renders (project_id, view, filename) VALUES (1,'front','render-a1-b2.png')").run();
  raw.prepare("INSERT INTO fittings (project_id, session_no, tailor_notes) VALUES (1,1,'Sleeve long')").run();
  raw.prepare("INSERT INTO fittings (project_id, session_no, tailor_notes) VALUES (1,2,'Better')").run();
  raw.prepare("INSERT INTO settings (key, value) VALUES ('imageModel','\"gemini-2.5-flash-image\"')").run();
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-migrate-'));

log(`Current schema version: ${LATEST}\n`);

// ---- every historical version must upgrade cleanly ----
log('=== upgrading from each historical version ===');
for (let from = 1; from <= LATEST; from++) {
  const dir = path.join(root, `v${from}`);
  const raw = makeDbAt(from, dir);
  seedV1(raw);
  raw.close();

  let reached, counts, err = null;
  try {
    db.open(dir);
    const probe = new Database(path.join(dir, 'data', 'gdsuits.db'));
    reached = probe.pragma('user_version', { simple: true });
    counts = {
      clients: probe.prepare('SELECT COUNT(*) n FROM clients').get().n,
      projects: probe.prepare('SELECT COUNT(*) n FROM projects').get().n,
      photos: probe.prepare('SELECT COUNT(*) n FROM photos').get().n,
      notes: probe.prepare('SELECT COUNT(*) n FROM notes').get().n,
      measurements: probe.prepare('SELECT COUNT(*) n FROM measurements').get().n,
      renders: probe.prepare('SELECT COUNT(*) n FROM renders').get().n,
      fittings: probe.prepare('SELECT COUNT(*) n FROM fittings').get().n,
    };
    probe.close();
  } catch (e) { err = e.message; }

  const intact = counts && counts.clients === 1 && counts.projects === 1 && counts.photos === 1 &&
                 counts.notes === 1 && counts.measurements === 1 && counts.renders === 1 && counts.fittings === 2;
  check(!err && reached === LATEST && intact,
        `v${from} -> v${LATEST}, all rows intact`,
        err ?? `reached v${reached}, counts ${JSON.stringify(counts)}`);
}

// ---- the transformations each migration promised ----
log('\n=== the transformations actually landed ===');
const dir = path.join(root, 'v1');
db.open(dir);
const project = db.getProject(1);
const client = db.getClient(1);

check(project.status === 'ready_first_fitting',
  "v4's 'fitting' survives every rename since, arriving as 'ready_first_fitting'", project.status);
check(project.fittings[0].kind === 'first', 'v4 gave the earliest session kind "first"', project.fittings[0].kind);
check(project.fittings[1].kind === 'final', 'and the later one "final"', project.fittings[1].kind);
check(client.profile && typeof client.profile === 'object', 'v2 added the client profile blob');
check(client.is_minor === 0, 'v6 added is_minor, defaulted off', String(client.is_minor));
check(client.secondary_name === '', 'v6 added the guardian fields, defaulted empty');
check(project.consultation_date === '', 'v6 added the process dates, defaulted empty');
check(project.quote === null, 'v7 added the quote, empty on an unquoted order');
check(JSON.stringify(project.spec) === '{"suitType":"three_piece","lapel":"peak"}', 'the spec survived untouched', JSON.stringify(project.spec));
check(db.getSetting('imageModel') === 'gemini-2.5-flash-image', 'settings survived', String(db.getSetting('imageModel')));

// ---- the v2+ tables exist and work after an upgrade from v1 ----
log('\n=== features added after v1 work on an upgraded database ===');
let worked = true, why = '';
try {
  const ref = db.addReference({ clientId: 1, filename: 'ref-a1-b2.jpg', kind: 'style', title: 'Peak' });
  db.saveClientMeasurement({ clientId: 1, garment: 'jacket', fieldId: 'chest', value: 104 });
  const cat = db.addCustomCategory({ title: 'Accessories' });
  db.addCustomItem({ category: cat.key, label: 'Pocket square', kind: 'toggle', price: 165 });
  db.addCustomOption({ fieldId: 'lapel', label: 'House Peak', price: 480 });
  db.setQuote(1, { lines: [{ group: 'Base', label: '3-Piece suit', amount: 5800, key: 'k' }], total: 5800, currency: 'R', at: new Date().toISOString(), status: 'approved' });
  worked = db.listReferences(1).length === 1 && db.listCustomItems().length === 1 &&
           db.listCustomOptions().length === 1 && db.getProject(1).quote?.total === 5800;
} catch (e) { worked = false; why = e.message; }
check(worked, 'references, client measurements, custom catalog and quotes all work', why);

// ---- v19: the first appointment is asked once ----
log('\n=== v19 moves the order page\'s first appointment into the schedule ===');
{
  const vdir = path.join(root, 'v19-appointment');
  const raw = makeDbAt(18, vdir);
  seedV1(raw);
  raw.prepare("INSERT INTO projects (client_id, title, first_appointment, consultation_date) VALUES (1,'Only the order page', '2026-02-03', '')").run();
  raw.prepare("INSERT INTO projects (client_id, title, first_appointment, consultation_date) VALUES (1,'Both set', '2026-02-03', '2026-01-20')").run();
  raw.close();
  db.open(vdir);
  const probe = new Database(path.join(vdir, 'data', 'gdsuits.db'));
  const read = (title) => probe.prepare('SELECT consultation_date d FROM projects WHERE title = ?').get(title).d;
  check(read('Only the order page') === '2026-02-03', 'a date only the order page held lands in the schedule', read('Only the order page'));
  check(read('Both set') === '2026-01-20', 'a date the schedule already had is not overwritten', read('Both set'));
  const cols = probe.prepare('PRAGMA table_info(alterations)').all().map((c) => c.name);
  check(['suit_id', 'changes_json'].every((c) => cols.includes(c)),
    'alterations can name the measurements they change', cols.join(','));
  check(probe.prepare('PRAGMA table_info(projects)').all().some((c) => c.name === 'informal_quote_json'),
    'and an order can record its informal quote');
  probe.close();
  db.open(dir);
}

// ---- v20: a reminder knows the date it was sent for ----
log('\n=== v20 records the date each sent reminder was for ===');
{
  const vdir = path.join(root, 'v20-reminders');
  const raw = makeDbAt(19, vdir);
  seedV1(raw);
  raw.prepare("UPDATE projects SET first_fitting_date = '2026-11-21' WHERE id = 1").run();
  raw.prepare("INSERT INTO projects (client_id, title, event_date) VALUES (1, 'No fitting yet', '2027-03-06')").run();
  raw.prepare("INSERT INTO mail_rules (id, name, anchor, offset_days) VALUES (1, 'Fitting', 'first_fitting_date', -7)").run();
  raw.prepare("INSERT INTO mail_rules (id, name, anchor, offset_days) VALUES (2, 'Event', 'event_date', -7)").run();
  for (const [rule, project] of [[1, 1], [2, 1], [1, 2]]) {
    raw.prepare('INSERT INTO mail_sent (rule_id, project_id) VALUES (?, ?)').run(rule, project);
  }
  raw.close();
  db.open(vdir);
  const probe = new Database(path.join(vdir, 'data', 'gdsuits.db'));
  const sentFor = (rule, project) => probe.prepare('SELECT anchor_date d FROM mail_sent WHERE rule_id = ? AND project_id = ?').get(rule, project)?.d;
  check(sentFor(1, 1) === '2026-11-21' && sentFor(2, 1) === '2026-11-14',
    'a reminder sent before is taken as sent for the date its rule counts from now',
    JSON.stringify([sentFor(1, 1), sentFor(2, 1)]));
  check(sentFor(1, 2) === '', 'and one whose order has no such date records none', JSON.stringify(sentFor(1, 2)));
  check(probe.prepare('SELECT COUNT(*) n FROM mail_sent').get().n === 3, 'no record is lost');
  check(probe.prepare('PRAGMA table_info(notes)').all().some((c) => c.name === 'meta_json')
    && probe.prepare("SELECT meta_json m FROM notes WHERE body = 'Bolder peak lapel.'").get()?.m === '',
  'notes can carry what the app wrote them for, and a tailor\'s note carries nothing');
  probe.close();
  db.open(dir);
}

// ---- re-opening is a no-op ----
log('\n=== re-opening an up-to-date database changes nothing ===');
const before = fs.statSync(path.join(dir, 'data', 'gdsuits.db')).size;
db.open(dir);
const probe = new Database(path.join(dir, 'data', 'gdsuits.db'));
check(probe.pragma('user_version', { simple: true }) === LATEST, 'still at the current version');
check(db.getProject(1).quote?.total === 5800, 'and the data is untouched');
probe.close();

fs.rmSync(root, { recursive: true, force: true });
log(`\n${fail === 0 ? 'ALL MIGRATION CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
