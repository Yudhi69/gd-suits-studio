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

check(project.status === 'first_fitting', "v4 mapped status 'fitting' to 'first_fitting'", project.status);
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
  db.addCustomItem({ category: cat.key, label: 'Pocket square', kind: 'toggle', price: 180 });
  db.addCustomOption({ fieldId: 'lapel', label: 'House Peak', price: 500 });
  db.setQuote(1, { lines: [{ group: 'Base', label: '3-Piece suit', amount: 5800, key: 'k' }], total: 5800, currency: 'R', at: new Date().toISOString(), status: 'approved' });
  worked = db.listReferences(1).length === 1 && db.listCustomItems().length === 1 &&
           db.listCustomOptions().length === 1 && db.getProject(1).quote?.total === 5800;
} catch (e) { worked = false; why = e.message; }
check(worked, 'references, client measurements, custom catalog and quotes all work', why);

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
