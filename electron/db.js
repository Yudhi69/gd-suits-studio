'use strict';

const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');

let db = null;

/**
 * Schema is applied idempotently on every launch. `user_version` tracks
 * migrations so an existing tailor's database is upgraded in place rather than
 * rebuilt - client files must survive an app update.
 */
const MIGRATIONS = [
  // v1 - initial schema
  (d) => {
    d.exec(`
      CREATE TABLE IF NOT EXISTS clients (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT NOT NULL,
        surname      TEXT NOT NULL DEFAULT '',
        contact      TEXT NOT NULL DEFAULT '',
        email        TEXT NOT NULL DEFAULT '',
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS projects (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id     INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        title         TEXT NOT NULL DEFAULT 'New suit',
        event_type    TEXT NOT NULL DEFAULT '',
        event_other   TEXT NOT NULL DEFAULT '',
        event_date    TEXT NOT NULL DEFAULT '',
        delivery_date TEXT NOT NULL DEFAULT '',
        status        TEXT NOT NULL DEFAULT 'draft',
        spec_json     TEXT NOT NULL DEFAULT '{}',
        analysis_json TEXT NOT NULL DEFAULT '{}',
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);

      CREATE TABLE IF NOT EXISTS photos (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        fitting_id INTEGER REFERENCES fittings(id) ON DELETE CASCADE,
        slot       TEXT NOT NULL,
        garment    TEXT NOT NULL DEFAULT '',
        filename   TEXT NOT NULL,
        mime       TEXT NOT NULL DEFAULT 'image/jpeg',
        meta_json  TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_photos_project ON photos(project_id);

      CREATE TABLE IF NOT EXISTS notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        step       TEXT NOT NULL DEFAULT 'general',
        body       TEXT NOT NULL,
        author     TEXT NOT NULL DEFAULT 'tailor',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id, step);

      CREATE TABLE IF NOT EXISTS measurements (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        garment    TEXT NOT NULL,
        field_id   TEXT NOT NULL,
        value      REAL,
        unit       TEXT NOT NULL DEFAULT 'cm',
        source     TEXT NOT NULL DEFAULT 'measured',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(project_id, garment, field_id)
      );

      CREATE TABLE IF NOT EXISTS renders (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_id   INTEGER REFERENCES renders(id) ON DELETE SET NULL,
        view        TEXT NOT NULL DEFAULT 'front',
        provider    TEXT NOT NULL DEFAULT 'gemini',
        model       TEXT NOT NULL DEFAULT '',
        prompt      TEXT NOT NULL DEFAULT '',
        instruction TEXT NOT NULL DEFAULT '',
        filename    TEXT NOT NULL,
        approved    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_renders_project ON renders(project_id);

      CREATE TABLE IF NOT EXISTS fittings (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        session_no  INTEGER NOT NULL DEFAULT 1,
        tailor_notes TEXT NOT NULL DEFAULT '',
        client_notes TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_fittings_project ON fittings(project_id);

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  },

  // v2 - split client-level identity from order-level detail, and add the
  // reusable style-reference library that follows a client across orders.
  (d) => {
    d.exec(`
      ALTER TABLE clients ADD COLUMN profile_json TEXT NOT NULL DEFAULT '{}';

      CREATE TABLE IF NOT EXISTS client_references (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        filename   TEXT NOT NULL,
        mime       TEXT NOT NULL DEFAULT 'image/jpeg',
        kind       TEXT NOT NULL DEFAULT 'style',
        title      TEXT NOT NULL DEFAULT '',
        notes      TEXT NOT NULL DEFAULT '',
        tags       TEXT NOT NULL DEFAULT '',
        favourite  INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_refs_client ON client_references(client_id);

      -- Which references actually fed a given render, so the style history is
      -- evidence-backed rather than guessed at later.
      CREATE TABLE IF NOT EXISTS render_refs (
        render_id    INTEGER NOT NULL REFERENCES renders(id) ON DELETE CASCADE,
        reference_id INTEGER NOT NULL REFERENCES client_references(id) ON DELETE CASCADE,
        PRIMARY KEY (render_id, reference_id)
      );

      -- The client's body as last measured. A new order seeds from here so a
      -- returning client is adjusted, not re-measured from scratch.
      CREATE TABLE IF NOT EXISTS client_measurements (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        garment    TEXT NOT NULL,
        field_id   TEXT NOT NULL,
        value      REAL,
        unit       TEXT NOT NULL DEFAULT 'cm',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(client_id, garment, field_id)
      );
    `);
  },

  // v3 - the tailor's own catalog. Shops offer things the built-in list does
  // not, so categories and priced items can be added at runtime and flow
  // through the builder, the quote, the spec sheet and the render prompt
  // exactly as the built-in ones do.
  (d) => {
    d.exec(`
      CREATE TABLE IF NOT EXISTS catalog_categories (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        key        TEXT NOT NULL UNIQUE,
        title      TEXT NOT NULL,
        blurb      TEXT NOT NULL DEFAULT '',
        sort       INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS catalog_items (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        field_id     TEXT NOT NULL UNIQUE,
        category     TEXT NOT NULL,
        label        TEXT NOT NULL,
        kind         TEXT NOT NULL DEFAULT 'toggle',
        price        REAL NOT NULL DEFAULT 0,
        options_json TEXT NOT NULL DEFAULT '[]',
        description  TEXT NOT NULL DEFAULT '',
        prompt       TEXT NOT NULL DEFAULT '',
        sort         INTEGER NOT NULL DEFAULT 0,
        active       INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_items_category ON catalog_items(category);
    `);
  },

  // v4 - a fitting is either the first or the final one, and the order status
  // says which stage it is at. Existing rows are mapped rather than reset:
  // the earliest session on an order becomes the first fitting.
  (d) => {
    d.exec(`
      ALTER TABLE fittings ADD COLUMN kind TEXT NOT NULL DEFAULT 'first';
      UPDATE fittings SET kind = 'first' WHERE session_no = 1;
      UPDATE fittings SET kind = 'final' WHERE session_no > 1;
      UPDATE projects SET status = 'first_fitting' WHERE status = 'fitting';
    `);
  },

  // v5 - options the shop adds to a selector that already exists. Distinct
  // from catalog_items, which add a whole new field: these extend the choices
  // on a built-in one (another lapel shape, another event type).
  (d) => {
    d.exec(`
      CREATE TABLE IF NOT EXISTS catalog_options (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        field_id    TEXT NOT NULL,
        option_key  TEXT NOT NULL,
        label       TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        price       REAL NOT NULL DEFAULT 0,
        prompt      TEXT NOT NULL DEFAULT '',
        sort        INTEGER NOT NULL DEFAULT 0,
        active      INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(field_id, option_key)
      );
      CREATE INDEX IF NOT EXISTS idx_options_field ON catalog_options(field_id);
    `);
  },

  // v6 - a guardian for under-age clients, and the dates the process actually
  // runs to. Matric ball clients are usually minors, so the person who signs
  // and pays is not the person being measured.
  (d) => {
    d.exec(`
      ALTER TABLE clients ADD COLUMN is_minor INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE clients ADD COLUMN secondary_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE clients ADD COLUMN secondary_relationship TEXT NOT NULL DEFAULT '';
      ALTER TABLE clients ADD COLUMN secondary_contact TEXT NOT NULL DEFAULT '';
      ALTER TABLE clients ADD COLUMN secondary_email TEXT NOT NULL DEFAULT '';

      ALTER TABLE projects ADD COLUMN consultation_date TEXT NOT NULL DEFAULT '';
      ALTER TABLE projects ADD COLUMN measurement_date TEXT NOT NULL DEFAULT '';
      ALTER TABLE projects ADD COLUMN first_fitting_date TEXT NOT NULL DEFAULT '';
      ALTER TABLE projects ADD COLUMN final_fitting_date TEXT NOT NULL DEFAULT '';
    `);
  },
];

function open(userDataPath) {
  const dir = path.join(userDataPath, 'data');
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(path.join(dir, 'gdsuits.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    MIGRATIONS[v](db);
    db.pragma(`user_version = ${v + 1}`);
  }
  return db;
}

const get = () => {
  if (!db) throw new Error('Database not open');
  return db;
};

const nowStamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/* ---------------------------------------------------------------- clients */

function getClient(id) {
  const row = get().prepare('SELECT * FROM clients WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, profile: JSON.parse(row.profile_json || '{}') };
}

function listClients() {
  return get()
    .prepare(
      `SELECT c.*,
              (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) AS project_count,
              (SELECT MAX(p.updated_at) FROM projects p WHERE p.client_id = c.id) AS last_activity
         FROM clients c
        ORDER BY COALESCE(last_activity, c.updated_at) DESC`
    )
    .all();
}

function upsertClient(client) {
  const d = get();
  if (client.id) {
    const sets = [
      'name=@name', 'surname=@surname', 'contact=@contact', 'email=@email',
      'is_minor=@is_minor', 'secondary_name=@secondary_name',
      'secondary_relationship=@secondary_relationship',
      'secondary_contact=@secondary_contact', 'secondary_email=@secondary_email',
    ];
    const params = {
      id: client.id,
      name: client.name ?? '',
      surname: client.surname ?? '',
      contact: client.contact ?? '',
      email: client.email ?? '',
      is_minor: client.isMinor ? 1 : 0,
      secondary_name: client.secondaryName ?? '',
      secondary_relationship: client.secondaryRelationship ?? '',
      secondary_contact: client.secondaryContact ?? '',
      secondary_email: client.secondaryEmail ?? '',
      updated_at: nowStamp(),
    };
    if (client.profile !== undefined) {
      sets.push('profile_json=@profile_json');
      params.profile_json = JSON.stringify(client.profile);
    }
    d.prepare(`UPDATE clients SET ${sets.join(', ')}, updated_at=@updated_at WHERE id=@id`).run(params);
    return client.id;
  }
  const info = d
    .prepare(
      `INSERT INTO clients
         (name, surname, contact, email, is_minor,
          secondary_name, secondary_relationship, secondary_contact, secondary_email)
       VALUES
         (@name, @surname, @contact, @email, @is_minor,
          @secondary_name, @secondary_relationship, @secondary_contact, @secondary_email)`
    )
    .run({
      name: client.name ?? '',
      surname: client.surname ?? '',
      contact: client.contact ?? '',
      email: client.email ?? '',
      is_minor: client.isMinor ? 1 : 0,
      secondary_name: client.secondaryName ?? '',
      secondary_relationship: client.secondaryRelationship ?? '',
      secondary_contact: client.secondaryContact ?? '',
      secondary_email: client.secondaryEmail ?? '',
    });
  return info.lastInsertRowid;
}

function deleteClient(id) {
  get().prepare('DELETE FROM clients WHERE id = ?').run(id);
}

/* --------------------------------------------------------------- projects */

function listProjects(clientId) {
  const d = get();
  const sql = `SELECT p.*, c.name, c.surname
                 FROM projects p JOIN clients c ON c.id = p.client_id
                ${clientId ? 'WHERE p.client_id = ?' : ''}
                ORDER BY p.updated_at DESC`;
  return clientId ? d.prepare(sql).all(clientId) : d.prepare(sql).all();
}

function getProject(id) {
  const d = get();
  const project = d
    .prepare(`SELECT p.*, c.name, c.surname, c.contact, c.email, c.is_minor,
                     c.secondary_name, c.secondary_relationship,
                     c.secondary_contact, c.secondary_email
                FROM projects p JOIN clients c ON c.id = p.client_id
               WHERE p.id = ?`)
    .get(id);
  if (!project) return null;

  return {
    ...project,
    spec: JSON.parse(project.spec_json || '{}'),
    analysis: JSON.parse(project.analysis_json || '{}'),
    photos: d.prepare('SELECT * FROM photos WHERE project_id = ? ORDER BY created_at').all(id)
      .map((p) => ({ ...p, meta: JSON.parse(p.meta_json || '{}') })),
    notes: d.prepare('SELECT * FROM notes WHERE project_id = ? ORDER BY created_at DESC').all(id),
    measurements: d.prepare('SELECT * FROM measurements WHERE project_id = ?').all(id),
    renders: d.prepare('SELECT * FROM renders WHERE project_id = ? ORDER BY created_at DESC').all(id),
    fittings: d.prepare('SELECT * FROM fittings WHERE project_id = ? ORDER BY session_no').all(id),
  };
}

function createProject({ clientId, title, eventType, eventOther, eventDate, deliveryDate }) {
  const info = get()
    .prepare(
      `INSERT INTO projects (client_id, title, event_type, event_other, event_date, delivery_date)
       VALUES (@clientId, @title, @eventType, @eventOther, @eventDate, @deliveryDate)`
    )
    .run({
      clientId,
      title: title || 'New suit',
      eventType: eventType ?? '',
      eventOther: eventOther ?? '',
      eventDate: eventDate ?? '',
      deliveryDate: deliveryDate ?? '',
    });
  return info.lastInsertRowid;
}

function updateProject(id, patch) {
  const allowed = [
    'title', 'event_type', 'event_other', 'event_date', 'delivery_date', 'status',
    'consultation_date', 'measurement_date', 'first_fitting_date', 'final_fitting_date',
  ];
  const d = get();
  const sets = [];
  const params = { id, updated_at: nowStamp() };

  for (const [k, v] of Object.entries(patch)) {
    if (allowed.includes(k)) {
      sets.push(`${k} = @${k}`);
      params[k] = v;
    }
  }
  if (patch.spec !== undefined) {
    sets.push('spec_json = @spec_json');
    params.spec_json = JSON.stringify(patch.spec);
  }
  if (patch.analysis !== undefined) {
    sets.push('analysis_json = @analysis_json');
    params.analysis_json = JSON.stringify(patch.analysis);
  }
  if (!sets.length) return;

  d.prepare(`UPDATE projects SET ${sets.join(', ')}, updated_at = @updated_at WHERE id = @id`).run(params);
}

function deleteProject(id) {
  get().prepare('DELETE FROM projects WHERE id = ?').run(id);
}

/* ----------------------------------------------------------------- photos */

function addPhoto({ projectId, slot, filename, mime, garment, fittingId, meta }) {
  const d = get();
  // Capture slots hold one current photo each; re-shooting replaces the old row.
  if (!fittingId && ['front', 'side', 'back', 'face', 'fabric', 'lining'].includes(slot)) {
    d.prepare('DELETE FROM photos WHERE project_id = ? AND slot = ? AND fitting_id IS NULL').run(projectId, slot);
  }
  const info = d
    .prepare(
      `INSERT INTO photos (project_id, fitting_id, slot, garment, filename, mime, meta_json)
       VALUES (@projectId, @fittingId, @slot, @garment, @filename, @mime, @meta)`
    )
    .run({
      projectId,
      fittingId: fittingId ?? null,
      slot,
      garment: garment ?? '',
      filename,
      mime: mime ?? 'image/jpeg',
      meta: JSON.stringify(meta ?? {}),
    });
  return info.lastInsertRowid;
}

function getPhoto(id) {
  return get().prepare('SELECT * FROM photos WHERE id = ?').get(id);
}

function deletePhoto(id) {
  const row = getPhoto(id);
  get().prepare('DELETE FROM photos WHERE id = ?').run(id);
  return row;
}

function updatePhotoMeta(id, meta) {
  get().prepare('UPDATE photos SET meta_json = ? WHERE id = ?').run(JSON.stringify(meta ?? {}), id);
}

/* ------------------------------------------------------------------ notes */

function addNote({ projectId, step, body, author }) {
  const info = get()
    .prepare('INSERT INTO notes (project_id, step, body, author) VALUES (?, ?, ?, ?)')
    .run(projectId, step ?? 'general', body, author ?? 'tailor');
  return info.lastInsertRowid;
}

function deleteNote(id) {
  get().prepare('DELETE FROM notes WHERE id = ?').run(id);
}

/* ----------------------------------------------------------- measurements */

function saveMeasurement({ projectId, garment, fieldId, value, unit, source }) {
  get()
    .prepare(
      `INSERT INTO measurements (project_id, garment, field_id, value, unit, source, updated_at)
       VALUES (@projectId, @garment, @fieldId, @value, @unit, @source, @updated_at)
       ON CONFLICT(project_id, garment, field_id)
       DO UPDATE SET value = @value, unit = @unit, source = @source, updated_at = @updated_at`
    )
    .run({
      projectId,
      garment,
      fieldId,
      value: value === '' || value === null || value === undefined ? null : Number(value),
      unit: unit ?? 'cm',
      source: source ?? 'measured',
      updated_at: nowStamp(),
    });
}

/* ---------------------------------------------------------------- renders */

function addRender({ projectId, parentId, view, provider, model, prompt, instruction, filename }) {
  const info = get()
    .prepare(
      `INSERT INTO renders (project_id, parent_id, view, provider, model, prompt, instruction, filename)
       VALUES (@projectId, @parentId, @view, @provider, @model, @prompt, @instruction, @filename)`
    )
    .run({
      projectId,
      parentId: parentId ?? null,
      view: view ?? 'front',
      provider: provider ?? 'gemini',
      model: model ?? '',
      prompt: prompt ?? '',
      instruction: instruction ?? '',
      filename,
    });
  return info.lastInsertRowid;
}

function getRender(id) {
  return get().prepare('SELECT * FROM renders WHERE id = ?').get(id);
}

function setRenderApproved(id, approved) {
  get().prepare('UPDATE renders SET approved = ? WHERE id = ?').run(approved ? 1 : 0, id);
}

function deleteRender(id) {
  const row = getRender(id);
  get().prepare('DELETE FROM renders WHERE id = ?').run(id);
  return row;
}

/* --------------------------------------------------------------- fittings */

function addFitting({ projectId, tailorNotes, clientNotes, kind }) {
  const d = get();
  const next =
    (d.prepare('SELECT MAX(session_no) AS n FROM fittings WHERE project_id = ?').get(projectId)?.n ?? 0) + 1;
  const info = d
    .prepare(
      'INSERT INTO fittings (project_id, session_no, tailor_notes, client_notes, kind) VALUES (?, ?, ?, ?, ?)'
    )
    .run(projectId, next, tailorNotes ?? '', clientNotes ?? '', kind ?? (next === 1 ? 'first' : 'final'));
  return info.lastInsertRowid;
}

function updateFitting(id, { tailorNotes, clientNotes, kind }) {
  const d = get();
  const current = d.prepare('SELECT * FROM fittings WHERE id = ?').get(id);
  if (!current) return;
  d.prepare('UPDATE fittings SET tailor_notes = ?, client_notes = ?, kind = ? WHERE id = ?').run(
    tailorNotes ?? current.tailor_notes,
    clientNotes ?? current.client_notes,
    kind ?? current.kind,
    id
  );
}

function deleteFitting(id) {
  get().prepare('DELETE FROM fittings WHERE id = ?').run(id);
}

/* --------------------------------------------------------------- settings */

function getSetting(key, fallback = null) {
  const row = get().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}

function setSetting(key, value) {
  get()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}


/* ------------------------------------------------- client style references */

/**
 * A client's reference images outlive any single order: they are the record of
 * what this person is drawn to, and they are re-attachable to a future render
 * or read back as style history.
 */
function addReference({ clientId, projectId, filename, mime, kind, title, notes, tags }) {
  const info = get()
    .prepare(
      `INSERT INTO client_references (client_id, project_id, filename, mime, kind, title, notes, tags)
       VALUES (@clientId, @projectId, @filename, @mime, @kind, @title, @notes, @tags)`
    )
    .run({
      clientId,
      projectId: projectId ?? null,
      filename,
      mime: mime ?? 'image/jpeg',
      kind: kind ?? 'style',
      title: title ?? '',
      notes: notes ?? '',
      tags: tags ?? '',
    });
  return info.lastInsertRowid;
}

function listReferences(clientId) {
  return get()
    .prepare(
      `SELECT r.*,
              (SELECT COUNT(*) FROM render_refs rr WHERE rr.reference_id = r.id) AS times_used
         FROM client_references r
        WHERE r.client_id = ?
        ORDER BY r.favourite DESC, r.created_at DESC`
    )
    .all(clientId);
}

function getReference(id) {
  return get().prepare('SELECT * FROM client_references WHERE id = ?').get(id);
}

function updateReference(id, { title, notes, tags, kind, favourite }) {
  const d = get();
  const current = getReference(id);
  if (!current) return;
  d.prepare(
    `UPDATE client_references SET title=@title, notes=@notes, tags=@tags, kind=@kind, favourite=@favourite WHERE id=@id`
  ).run({
    id,
    title: title ?? current.title,
    notes: notes ?? current.notes,
    tags: tags ?? current.tags,
    kind: kind ?? current.kind,
    favourite: favourite === undefined ? current.favourite : favourite ? 1 : 0,
  });
}

function deleteReference(id) {
  const row = getReference(id);
  get().prepare('DELETE FROM client_references WHERE id = ?').run(id);
  return row;
}

function linkRenderRefs(renderId, referenceIds = []) {
  const d = get();
  const stmt = d.prepare('INSERT OR IGNORE INTO render_refs (render_id, reference_id) VALUES (?, ?)');
  const tx = d.transaction((ids) => ids.forEach((rid) => stmt.run(renderId, rid)));
  tx(referenceIds);
}

/**
 * Style history for a client: which references they keep coming back to, and
 * the spec choices they have actually approved across past orders.
 */
function styleHistory(clientId) {
  const d = get();
  const references = d
    .prepare(
      `SELECT r.id, r.filename, r.kind, r.title, r.tags, r.favourite,
              COUNT(rr.render_id) AS times_used
         FROM client_references r
         LEFT JOIN render_refs rr ON rr.reference_id = r.id
        WHERE r.client_id = ?
        GROUP BY r.id
        ORDER BY times_used DESC, r.favourite DESC`
    )
    .all(clientId);

  const pastSpecs = d
    .prepare(
      `SELECT p.id, p.title, p.event_type, p.event_date, p.status, p.spec_json, p.updated_at,
              (SELECT COUNT(*) FROM renders x WHERE x.project_id = p.id AND x.approved = 1) AS approved_renders
         FROM projects p
        WHERE p.client_id = ?
        ORDER BY p.updated_at DESC`
    )
    .all(clientId)
    .map((row) => ({ ...row, spec: JSON.parse(row.spec_json || '{}') }));

  return { references, pastSpecs };
}

/* --------------------------------------------------- client measurements */

function saveClientMeasurement({ clientId, garment, fieldId, value, unit }) {
  get()
    .prepare(
      `INSERT INTO client_measurements (client_id, garment, field_id, value, unit, updated_at)
       VALUES (@clientId, @garment, @fieldId, @value, @unit, @updated_at)
       ON CONFLICT(client_id, garment, field_id)
       DO UPDATE SET value = @value, unit = @unit, updated_at = @updated_at`
    )
    .run({
      clientId,
      garment,
      fieldId,
      value: value === '' || value === null || value === undefined ? null : Number(value),
      unit: unit ?? 'cm',
      updated_at: nowStamp(),
    });
}

function listClientMeasurements(clientId) {
  return get().prepare('SELECT * FROM client_measurements WHERE client_id = ?').all(clientId);
}

/** Copies the client's last known body measurements onto a new order. */
function seedMeasurementsFromClient(projectId, clientId) {
  const rows = listClientMeasurements(clientId);
  for (const row of rows) {
    saveMeasurement({
      projectId,
      garment: row.garment,
      fieldId: row.field_id,
      value: row.value,
      unit: row.unit,
      source: 'carried-over',
    });
  }
  return rows.length;
}


/* ------------------------------------------------- the tailor's own catalog */

function listCustomCategories() {
  return get().prepare('SELECT * FROM catalog_categories ORDER BY sort, id').all();
}

function addCustomCategory({ title, blurb }) {
  const d = get();
  const next = (d.prepare('SELECT MAX(sort) AS n FROM catalog_categories').get()?.n ?? 0) + 1;
  // The key becomes a step key and a spec namespace, so it is generated rather
  // than derived from the title - a renamed category must not orphan the
  // selections already saved against it.
  const key = `custom-${Date.now().toString(36)}`;
  const info = d
    .prepare('INSERT INTO catalog_categories (key, title, blurb, sort) VALUES (?, ?, ?, ?)')
    .run(key, title, blurb ?? '', next);
  return { id: info.lastInsertRowid, key };
}

function updateCustomCategory(id, { title, blurb, sort }) {
  const d = get();
  const current = d.prepare('SELECT * FROM catalog_categories WHERE id = ?').get(id);
  if (!current) return;
  d.prepare('UPDATE catalog_categories SET title = ?, blurb = ?, sort = ? WHERE id = ?').run(
    title ?? current.title,
    blurb ?? current.blurb,
    sort ?? current.sort,
    id
  );
}

/**
 * Deleting a category takes its items with it. Existing orders keep whatever
 * was already saved in their spec JSON - a delivered suit should not silently
 * change because the price list was tidied up later.
 */
function deleteCustomCategory(id) {
  const d = get();
  const row = d.prepare('SELECT key FROM catalog_categories WHERE id = ?').get(id);
  if (!row) return;
  d.prepare('DELETE FROM catalog_items WHERE category = ?').run(row.key);
  d.prepare('DELETE FROM catalog_categories WHERE id = ?').run(id);
}

function listCustomItems() {
  return get()
    .prepare('SELECT * FROM catalog_items ORDER BY category, sort, id')
    .all()
    .map((row) => ({ ...row, options: JSON.parse(row.options_json || '[]') }));
}

function addCustomItem({ category, label, kind, price, options, description, prompt }) {
  const d = get();
  const next =
    (d.prepare('SELECT MAX(sort) AS n FROM catalog_items WHERE category = ?').get(category)?.n ?? 0) + 1;
  const fieldId = `custom_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const info = d
    .prepare(
      `INSERT INTO catalog_items (field_id, category, label, kind, price, options_json, description, prompt, sort)
       VALUES (@fieldId, @category, @label, @kind, @price, @options, @description, @prompt, @sort)`
    )
    .run({
      fieldId,
      category,
      label,
      kind: kind ?? 'toggle',
      price: Number(price) || 0,
      options: JSON.stringify(options ?? []),
      description: description ?? '',
      prompt: prompt ?? '',
      sort: next,
    });
  return { id: info.lastInsertRowid, fieldId };
}

function updateCustomItem(id, patch) {
  const d = get();
  const current = d.prepare('SELECT * FROM catalog_items WHERE id = ?').get(id);
  if (!current) return;
  d.prepare(
    `UPDATE catalog_items
        SET label = @label, kind = @kind, price = @price, options_json = @options,
            description = @description, prompt = @prompt, active = @active, category = @category
      WHERE id = @id`
  ).run({
    id,
    label: patch.label ?? current.label,
    kind: patch.kind ?? current.kind,
    price: patch.price === undefined ? current.price : Number(patch.price) || 0,
    options: patch.options === undefined ? current.options_json : JSON.stringify(patch.options),
    description: patch.description ?? current.description,
    prompt: patch.prompt ?? current.prompt,
    active: patch.active === undefined ? current.active : patch.active ? 1 : 0,
    category: patch.category ?? current.category,
  });
}

function deleteCustomItem(id) {
  get().prepare('DELETE FROM catalog_items WHERE id = ?').run(id);
}


function listCustomOptions() {
  return get().prepare('SELECT * FROM catalog_options ORDER BY field_id, sort, id').all();
}

function addCustomOption({ fieldId, label, description, price, prompt }) {
  const d = get();
  const next =
    (d.prepare('SELECT MAX(sort) AS n FROM catalog_options WHERE field_id = ?').get(fieldId)?.n ?? 0) + 1;
  // The key is generated, never derived from the label: renaming an option
  // must not orphan the orders already saved against it.
  const optionKey = `opt_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const info = d
    .prepare(
      `INSERT INTO catalog_options (field_id, option_key, label, description, price, prompt, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(fieldId, optionKey, label, description ?? '', Number(price) || 0, prompt ?? '', next);
  return { id: info.lastInsertRowid, optionKey };
}

function updateCustomOption(id, patch) {
  const d = get();
  const current = d.prepare('SELECT * FROM catalog_options WHERE id = ?').get(id);
  if (!current) return;
  d.prepare(
    'UPDATE catalog_options SET label = ?, description = ?, price = ?, prompt = ?, active = ? WHERE id = ?'
  ).run(
    patch.label ?? current.label,
    patch.description ?? current.description,
    patch.price === undefined ? current.price : Number(patch.price) || 0,
    patch.prompt ?? current.prompt,
    patch.active === undefined ? current.active : patch.active ? 1 : 0,
    id
  );
}

function deleteCustomOption(id) {
  get().prepare('DELETE FROM catalog_options WHERE id = ?').run(id);
}

module.exports = {
  open,
  listClients, getClient, upsertClient, deleteClient,
  addReference, listReferences, getReference, updateReference, deleteReference,
  linkRenderRefs, styleHistory,
  saveClientMeasurement, listClientMeasurements, seedMeasurementsFromClient,
  listProjects, getProject, createProject, updateProject, deleteProject,
  addPhoto, getPhoto, deletePhoto, updatePhotoMeta,
  addNote, deleteNote,
  saveMeasurement,
  addRender, getRender, setRenderApproved, deleteRender,
  addFitting, updateFitting, deleteFitting,
  listCustomCategories, addCustomCategory, updateCustomCategory, deleteCustomCategory,
  listCustomItems, addCustomItem, updateCustomItem, deleteCustomItem,
  listCustomOptions, addCustomOption, updateCustomOption, deleteCustomOption,
  getSetting, setSetting,
};
