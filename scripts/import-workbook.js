/**
 * Import GD's Excel workbook into the database.
 *
 * The five sheets were kept by hand over about two years, so the file is not
 * regular: the same order appears on more than one sheet, columns drift, and
 * the money column records sometimes what is owed and sometimes what has been
 * paid. This reads it the way a person would - by looking at what a value
 * actually is - rather than trusting the header row, which for most of the
 * COMPLETED sheet is wrong.
 *
 * Nothing is guessed. Where a value cannot be read with confidence it is kept
 * verbatim in a note so GD can settle it, and the row still imports.
 *
 *   node scripts/import-workbook.js <csv-dir> [--commit]
 *
 * Without --commit it reports what it would do and writes nothing.
 */
const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ csv */

/** RFC4180 reader: quoted fields carry newlines, and these sheets use them. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* ignore */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* -------------------------------------------------------------- readers */

/**
 * GD writes the same cloth two ways - "PWB" early in the book and "PREMIUM
 * WOOL BLEND" later - which splits one fabric into two rows in any count of
 * what sells. These are abbreviations of each other, not different cloths, so
 * they are expanded. Anything not on this list is left exactly as written.
 */
const FABRIC_WORDS = {
  PWB: 'Premium wool blend',
  'PREMIUM WOOL BLEND': 'Premium wool blend',
  'PREMIUM ITW': 'Premium Italian wool',
  ITW: 'Italian wool',
  'ITALIAN WOOL': 'Italian wool',
  SFW: 'Super fine wool',
  'SUPER FINE WOOL': 'Super fine wool',
  SWB: 'Standard wool blend',
  'STANDARD WOOL BLEND': 'Standard wool blend',
  'LUX WOOL': 'Luxury wool',
  BELUCCI: 'Belucci',
  JACQUARD: 'Jacquard',
  'SUPPLIED MATERIAL': 'Supplied material',
};

/** A cell may list several ("ITW, PWB"), so each part is expanded on its own. */
function readFabric(raw) {
  const text = clean(raw);
  if (!text) return '';
  return text
    .split(/\s*,\s*/)
    .map((part) => FABRIC_WORDS[part.toUpperCase()] ?? part)
    .join(', ');
}

const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const RX = {
  url: /https?:\/\/\S+|\S+\.docx/i,
  email: /[\w.+-]+@[\w-]+\.[\w.]+/,
  phone: /(?:\+?\d[\d\s()-]{7,})/,
  qty: /\b(\d)\s?-\s?PIECE\b/i,
  date: /(\d{1,2})\/(\d{1,2})\/(\d{2,5})/,
  appt: /MEASUREMENTS?\s*:/i,
};

/**
 * A date as GD writes it. Day/month/year, and the sheet contains typos that
 * would otherwise import as real dates ("06/06/20265", "03/05/3035"), so a
 * year outside the business's actual life is rejected rather than corrected.
 */
function readDate(raw) {
  const m = RX.date.exec(raw ?? '');
  if (!m) return '';
  const [, d, mo, y] = m;
  const year = Number(y);
  if (year < 2015 || year > 2035) return '';
  const day = Number(d), month = Number(mo);
  if (day < 1 || day > 31 || month < 1 || month > 12) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The money column. It holds one of three different things depending on the
 * row, so the words around the number decide which - and when they decide
 * nothing, the number is left out and the text kept.
 */
function readMoney(raw) {
  const text = (raw ?? '').trim();
  if (!text) return { paid: 0, balance: 0, note: '', certain: true };
  const upper = text.toUpperCase();
  const out = { paid: 0, balance: 0, note: '', certain: true };

  if (/FULLY\s*PAID|^PAID$/.test(upper) && !/\d/.test(upper)) {
    return { paid: 0, balance: 0, note: text, certain: true, settled: true };
  }
  if (/REFUND/.test(upper)) return { paid: 0, balance: 0, note: text, certain: false };

  // Read each line on its own. GD writes "R3445 PAID" and "R1855 BAL." on
  // separate lines of one cell, so a keyword search across the whole cell
  // would file both under whichever word it met first.
  const segments = text.split(/[\n;]+/).map((t) => t.trim()).filter(Boolean);
  let bareSeen = false;
  for (const seg of segments) {
    const up = seg.toUpperCase();
    const amounts = [...seg.matchAll(/R?\s?(\d[\d\s,]*(?:\.\d{1,2})?)/g)]
      .map((m) => Number(m[1].replace(/[\s,]/g, '')))
      .filter((v) => Number.isFinite(v) && v >= 20 && v <= 200000);
    if (!amounts.length) continue;
    if (/PAID|SETTLED/.test(up)) out.paid += amounts[0];
    else if (/BAL|DUE|OUTSTANDING/.test(up)) out.balance += amounts[0];
    else if (!bareSeen) { out.balance += amounts[0]; bareSeen = true; }
    else out.certain = false;                       // a second unlabelled figure
    if (amounts.length > 1) out.certain = false;
  }
  if (!segments.length) out.certain = false;
  if (/\+|TBC|CHECK|WILL |ADD |REFUND/i.test(text)) out.certain = false;
  if (!out.certain || text.length > 12) out.note = text;
  return out;
}

/** "081 765 5912\n\ntheo@gmail.com" -> both halves. */
function readContact(raw) {
  const text = raw ?? '';
  return {
    email: (RX.email.exec(text) || [''])[0],
    contact: clean((RX.phone.exec(text.replace(RX.email, '')) || [''])[0]),
  };
}

/**
 * "MEASUREMENTS: 18/01/2025  FIRST FITTING: 25/01/2025  FINAL FITTING: ..."
 * These are the dates the app already models, so they are worth digging out.
 */
function readAppointments(raw) {
  const text = (raw ?? '').toUpperCase();
  const at = (label) => {
    const i = text.indexOf(label);
    if (i < 0) return '';
    return readDate(text.slice(i + label.length, i + label.length + 24));
  };
  return {
    consultation: at('MEASUREMENTS:'),
    firstFitting: at('FIRST FITTING:'),
    finalFitting: at('FINAL FITTING:'),
  };
}

/** "OLIVIA KLEINSCHMIDT (SHANE)" -> Olivia / Kleinschmidt, keeping "(SHANE)". */
function readName(raw) {
  const aside = [...(raw ?? '').matchAll(/\(([^)]*)\)/g)].map((m) => clean(m[1])).join('; ');
  const title = clean((raw ?? '').replace(/\([^)]*\)/g, ''))
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bMr\b/, 'Mr');
  const parts = title.split(' ').filter(Boolean);
  return { name: parts[0] ?? '', surname: parts.slice(1).join(' '), aside };
}

/**
 * Which layout is this row in?
 *
 * The COMPLETED header says lining/quantity/design, but 433 of its 588 rows
 * are actually laid out design/lining/quantity, the same as CURRENT ORDERS.
 * The piece-count settles it: whichever column holds "3-PIECE" is quantity.
 */
function readGarment(r) {
  const cell = (i) => clean(r[i] ?? '');
  if (RX.qty.test(r[5] ?? '')) return { design: cell(6), lining: cell(4), qtyCell: r[5], shirt: cell(7) };
  if (RX.qty.test(r[6] ?? '')) return { design: cell(4), lining: cell(5), qtyCell: r[6], shirt: cell(7) };
  // No piece-count at all: fall back to which cell reads like a design.
  const looksDesign = /LAPEL|B2S|WAISTCOAT|TUXEDO|PIC REF|PANTS|SHIRT|BREAST/i;
  return looksDesign.test(r[4] ?? '')
    ? { design: cell(4), lining: cell(5), qtyCell: '', shirt: cell(7) }
    : { design: cell(6), lining: cell(4), qtyCell: '', shirt: cell(7) };
}

const pieces = (cell) => { const m = RX.qty.exec(cell ?? ''); return m ? Number(m[1]) : 0; };

/** Locate a column by what it contains, since its index moves between rows. */
const findCell = (row, rx, from = 0) => {
  for (let i = from; i < row.length; i++) if (rx.test(row[i] ?? '')) return row[i];
  return '';
};

/* --------------------------------------------------------------- import */

function readSheet(dir, sheet) {
  const file = path.join(dir, `GD_Suits_Orders.xlsx - ${sheet}.csv`);
  return parseCsv(fs.readFileSync(file, 'utf8'));
}

function buildOrders(dir) {
  const orders = [];
  const skipped = [];

  for (const [sheet, headerRows] of [['COMPLETED', 1], ['CURRENT ORDERS', 2]]) {
    let lastNamed = '';
    for (const r of readSheet(dir, sheet).slice(headerRows)) {
      let rawName = clean(r[0]);
      const hasBody = r.slice(1, 10).some((c) => clean(c));
      if (!rawName && !hasBody) continue;
      if (/^(F|Z|1|CLIENT)$/i.test(rawName)) continue;

      // A row with a suit but no name is another garment on the order above -
      // a wedding party, where GD wrote the client once and the groomsmen under
      // it. Dropping them would lose real suits.
      let continuation = false;
      if (!rawName) {
        if (!lastNamed) { skipped.push({ sheet, why: 'no client name and none above', row: clean(r[2] || r[3]) }); continue; }
        rawName = lastNamed;
        continuation = true;
      } else lastNamed = rawName;

      const garment = readGarment(r);
      // A continuation row carries no dates of its own - it is the same order
      // as the row above, measured and fitted on the same day - so it takes
      // that row's, rather than being left undated.
      const appt = (() => {
        const own = readAppointments(findCell(r, RX.appt, 8));
        if (!continuation) return own;
        const parent = orders[orders.length - 1];
        return {
          consultation: own.consultation || parent?.consultation || '',
          firstFitting: own.firstFitting || parent?.firstFitting || '',
          finalFitting: own.finalFitting || parent?.finalFitting || '',
        };
      })();
      const { email, contact } = readContact(findCell(r, /@|\d{3}[\s-]\d{3}/, 9));
      const money = readMoney(r[8]);
      const eventDate = readDate(r[1]);

      // Trailing free text ("OUT OF COUNTRY 3-9 SEPTEMBER", "RETURNS 29/11").
      const tail = r.slice(12).map(clean).filter((c) => c && !RX.appt.test(c) && !RX.date.test(c)).join(' · ');

      orders.push({
        sheet,
        continuation,
        ...readName(rawName),
        rawName,
        contact,
        email,
        eventDate: eventDate || (continuation ? orders[orders.length - 1]?.eventDate ?? '' : ''),
        eventRaw: clean(r[1]),
        fabric: readFabric(r[2]),
        code: clean(r[3]),
        design: garment.design,
        lining: garment.lining,
        shirt: garment.shirt,
        quantity: pieces(garment.qtyCell) ? 1 : 1,
        pieces: pieces(garment.qtyCell),
        formUrl: (RX.url.exec(findCell(r, RX.url)) || [''])[0],
        firstAppointment: readDate(r.slice(11).find((c) => readDate(c)) || ''),
        appointmentNotes: clean(findCell(r, RX.appt, 8)),
        ...appt,
        money,
        comments: tail,
      });
    }
  }
  return { orders, skipped };
}

module.exports = { parseCsv, readFabric, readDate, readMoney, readContact, readAppointments, readName, readGarment, pieces, buildOrders };

/* ---------------------------------------------------------------- write */

const TODAY = new Date().toISOString().slice(0, 10);

/**
 * Which stage an imported order sits at.
 *
 * The sheet a row lives on is the main signal, but "COMPLETED" records the
 * order being written up rather than the suit being handed over, so a row
 * whose event has not happened yet is not marked delivered on its say-so.
 * SUIT PROGRESS, where GD ticks the live stage by hand, overrides both.
 */
function statusFor(order, progress) {
  const ticked = progress.get(order.rawName.toUpperCase());
  if (ticked) return ticked;
  if (order.sheet === 'COMPLETED') {
    return order.eventDate && order.eventDate < TODAY ? 'delivered' : 'in_production';
  }
  return 'in_production';
}

/** The hand-ticked stage columns on SUIT PROGRESS. */
function readProgress(dir) {
  const map = new Map();
  const rows = readSheet(dir, 'SUIT PROGRESS').slice(1);
  const stages = [null, null, 'in_production', 'first_fitting', 'alterations', 'final_fitting'];
  for (const r of rows) {
    const who = clean(r[0]).toUpperCase();
    if (!who) continue;
    for (let i = 2; i < stages.length; i++) if (clean(r[i])) map.set(who, stages[i]);
  }
  return map;
}

function readAlterations(dir) {
  return readSheet(dir, 'ALTERATIONS').slice(1)
    .filter((r) => r.some((c) => clean(c)))
    .map((r) => ({
      client: clean(r[0]), description: clean(r[1]), kind: clean(r[2]),
      status: /COLLECT/i.test(r[3] || '') ? 'collected' : /PROGRESS/i.test(r[3] || '') ? 'in_progress' : 'received',
      receivedOn: readDate(r[4]), dueOn: readDate(r[5]), confirmedOn: readDate(r[7]),
      cost: Number((clean(r[8]).match(/[\d.]+/) || [0])[0]) || 0,
    }));
}

function readExtras(dir) {
  return readSheet(dir, 'EXTRAS').slice(1)
    .filter((r) => clean(r[0]) || clean(r[1]))
    .map((r) => ({
      client: clean(r[0]), extraType: clean(r[1]), colour: clean(r[2]),
      quantity: Number(clean(r[3])) || 1,
      status: /DELIVER/i.test(r[4] || '') ? 'delivered' : 'ordered',
    }));
}

/**
 * Write the workbook into the database, in one transaction.
 *
 * Re-running is safe: every imported order carries its source sheet and the
 * row it came from, and rows already present are left alone rather than
 * duplicated - GD may well import again after tidying the spreadsheet.
 */
function importInto(db, dir, { onProgress } = {}) {
  const { orders } = buildOrders(dir);
  const progress = readProgress(dir);
  const stats = { clients: 0, orders: 0, skippedExisting: 0, payments: 0, alterations: 0, extras: 0, flagged: [], unattached: [] };

  const clientIds = new Map();
  const existing = new Set(
    db.listProjects().map((p) => `${(p.name + ' ' + p.surname).trim().toUpperCase()}|${p.event_date}|${p.fabric_name}`)
  );

  const run = () => db.tx(() => {
    for (const o of orders) {
      // One client file per person. The sheet writes the same client more than
      // one way ("STORM PETERSEN" and "STORM PETERSEN (SACS)"); the aside is a
      // note about the order, not a different customer.
      const key = `${o.name} ${o.surname}`.trim().toUpperCase();
      if (!clientIds.has(key)) {
        const notes = [o.aside && `Also: ${o.aside}`].filter(Boolean).join('\n');
        const id = db.upsertClient({
          name: o.name, surname: o.surname, contact: o.contact, email: o.email, notes,
        });
        clientIds.set(key, id);
        stats.clients++;
      }
      const clientId = clientIds.get(key);

      // Keyed on the name as stored, not as written: the sheet's asides
      // ("OLIVIA KLEINSCHMIDT (SHANE)") are stripped on the way in, so keying
      // on the raw text would never match on a second import and would
      // duplicate every client who has one.
      const dedupe = `${`${o.name} ${o.surname}`.trim().toUpperCase()}|${o.eventDate}|${o.fabric}`;
      if (existing.has(dedupe)) { stats.skippedExisting++; continue; }
      existing.add(dedupe);

      const title = [o.fabric, o.code].filter(Boolean).join(' · ') || 'Imported order';
      const projectId = db.createProject({
        clientId, title, eventType: '', eventOther: '', eventDate: o.eventDate, deliveryDate: '',
      });

      const comments = [
        o.continuation ? 'Additional suit on this order (the workbook row carried no name of its own).' : '',
        o.eventRaw && !o.eventDate ? `Event date as written: "${o.eventRaw}"` : '',
        o.money.note ? `Balance column read: "${o.money.note}"` : '',
        o.comments,
      ].filter(Boolean).join('\n');

      db.updateProject(projectId, {
        status: statusFor(o, progress),
        quantity: 1,
        fabric_name: o.fabric,
        fabric_code: o.code,
        lining: o.lining,
        design: o.design,
        shirt: o.shirt,
        form_url: o.formUrl,
        imported_balance: o.money.balance,
        balance_note: o.money.note,
        import_source: o.sheet,
        consultation_date: o.consultation,
        first_fitting_date: o.firstFitting,
        final_fitting_date: o.finalFitting,
        first_appointment: o.firstAppointment,
        appointment_notes: o.appointmentNotes,
        comments,
        measurement_form_received: o.formUrl ? 1 : 0,
      });

      if (o.money.paid > 0) {
        db.addPayment({
          project_id: projectId, kind: 'deposit', amount: o.money.paid,
          paid_on: '', method: '', reference: 'Imported from workbook',
          note: o.money.note || '',
        });
        stats.payments++;
      }
      if (!o.money.certain && (o.money.note || o.money.balance)) {
        stats.flagged.push({ client: o.rawName, text: o.money.note || String(o.money.balance) });
      }
      // Date the order by the last thing that actually happened to it. A
      // fitting booked for next year has not happened, so it does not count;
      // an order with nothing dateable is left undated rather than being
      // stamped with the import, which would float it to the top of any list
      // sorted by recent activity.
      const today = new Date().toISOString().slice(0, 10);
      const past = [o.finalFitting, o.firstFitting, o.consultation, o.firstAppointment, o.eventDate]
        .filter((dt) => dt && dt <= today)
        .sort();
      const started = o.consultation || o.firstAppointment || o.eventDate || '';
      db.stampImport(projectId, {
        createdAt: started ? `${started} 00:00:00` : '',
        updatedAt: past.length ? `${past[past.length - 1]} 00:00:00` : '',
      });

      stats.orders++;
      onProgress?.(stats.orders, orders.length);
    }

    // The two remaining sheets, matched to a client by name.
    const findClient = (who) => clientIds.get(clean(who).toUpperCase());
    const firstProjectOf = (clientId) =>
      db.listProjects().find((p) => p.client_id === clientId)?.id;

    for (const a of readAlterations(dir)) {
      const cid = findClient(a.client);
      const pid = cid && firstProjectOf(cid);
      // The alterations sheet has rows with no client on them at all; there is
      // nothing to attach those to, so they are reported rather than dropped.
      if (!pid) { stats.unattached.push({ sheet: 'ALTERATIONS', row: a }); continue; }
      db.addAlteration({
        project_id: pid, garment: '', description: a.description, kind: a.kind,
        status: a.status, received_on: a.receivedOn, due_on: a.dueOn,
        confirmed_on: a.confirmedOn, cost: a.cost, note: 'Imported from workbook',
      });
      stats.alterations++;
    }
    for (const x of readExtras(dir)) {
      const cid = findClient(x.client);
      const pid = cid && firstProjectOf(cid);
      if (!pid) { stats.unattached.push({ sheet: 'EXTRAS', row: x }); continue; }
      db.addOrderExtra({
        project_id: pid, extra_type: x.extraType, colour: x.colour,
        quantity: x.quantity, status: x.status, unit_price: 0, note: 'Imported from workbook',
      });
      stats.extras++;
    }
  });

  run();
  stats.numbered = db.assignOrderRefs();
  return stats;
}

module.exports.statusFor = statusFor;
module.exports.readProgress = readProgress;
module.exports.readAlterations = readAlterations;
module.exports.readExtras = readExtras;
module.exports.importInto = importInto;

/* ------------------------------------------------------------------ cli */

if (require.main === module) {
  const dir = process.argv[2] || path.join(process.env.HOME, 'Downloads');
  const commit = process.argv.includes('--commit');
  const target = process.argv.includes('--userdata')
    ? process.argv[process.argv.indexOf('--userdata') + 1]
    : null;

  if (!commit) {
    const { orders } = buildOrders(dir);
    const progress = readProgress(dir);
    const by = {};
    for (const o of orders) { const s = statusFor(o, progress); by[s] = (by[s] || 0) + 1; }
    console.log(`dry run - ${orders.length} orders would import`);
    console.log('  by stage:', by);
    console.log('  alterations:', readAlterations(dir).length, ' extras:', readExtras(dir).length);
    console.log('\npass --commit --userdata <path> to write.');
    process.exit(0);
  }
  if (!target) { console.error('--commit needs --userdata <path>'); process.exit(1); }

  const db = require('../electron/db.js');
  db.open(target);
  const t0 = Date.now();
  const stats = importInto(db, dir);
  console.log(`imported in ${Date.now() - t0}ms`);
  console.log(stats);
}
