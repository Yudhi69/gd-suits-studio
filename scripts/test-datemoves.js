/**
 * When a date on an order moves.
 *
 * The shop's answers: the old date in the imported appointment notes
 * should not be left standing - overwrite it, or record the change - and a
 * reminder already sent for a fitting should be offered again once the
 * fitting moves. Both are checked through the same gate the pages use, and
 * then on the two screens the shop actually works from. Nothing is sent: a draft
 * is handed to a stub instead of the mail program.
 */
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');
const dir = require('./fresh.js').freshUserData(app);

const drafts = [];
shell.openExternal = async (url) => { drafts.push(String(url)); return true; };

require('../electron/main.js');
const db = require('../electron/db.js');

let pass = 0, fail = 0;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Days counted in UTC, as the reminders count them.
const day = (offset) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const IMPORTED = 'MEASUREMENTS: 18/01/2025  FIRST FITTING: 25/01/2025  FINAL FITTING: 08/02/2025 (collect)';

app.whenReady().then(async () => {
  await wait(2400);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c);
  const call = (ch, arg) => js(`window.gd.${ch}(${JSON.stringify(arg ?? {})}).then(r => JSON.stringify(r.ok ? { data: r.data } : { error: r.error.message }))`).then(JSON.parse);
  const move = (id, patch) => call('projects.update', { id, patch });
  // A second connection, only to read what was recorded and to age a note.
  const raw = new Database(path.join(dir, 'data', 'gdsuits.db'));
  const appNotes = (id) => db.getProject(id).notes.filter((n) => n.author === 'app').map((n) => n.body).sort();

  // An order as the workbook import leaves it: the dates read out of the
  // notes, and the notes kept as written.
  const imported = (name, email = '') => {
    const id = db.createProject({ clientId: db.upsertClient({ name, surname: 'Test', contact: '', email }), title: 'Wedding' });
    db.updateProject(id, {
      consultation_date: '2025-01-18', first_fitting_date: '2025-01-25', final_fitting_date: '2025-02-08',
      appointment_notes: IMPORTED,
    });
    return id;
  };

  log('=== the imported notes follow the date ===');
  const naledi = imported('Naledi');
  const bystander = imported('Bystander');
  const bystanderBefore = db.getProject(bystander);

  let r = await move(naledi, { first_fitting_date: '2025-02-01' });
  let p = db.getProject(naledi);
  check(!r.error && p.first_fitting_date === '2025-02-01', 'a fitting moved through the page gate is moved', JSON.stringify(r.error));
  check(p.appointment_notes === 'MEASUREMENTS: 18/01/2025  FIRST FITTING: 01/02/2025  FINAL FITTING: 08/02/2025 (collect)',
    '  the date after FIRST FITTING: in the imported notes is the new one, and nothing else in them changes', p.appointment_notes);
  check(JSON.stringify(appNotes(naledi)) === JSON.stringify(['First fitting moved from 25 Jan 2025 to 1 Feb 2025.']),
    '  and the move is written to the order\'s notes, so the old date is not lost', JSON.stringify(appNotes(naledi)));
  const note = p.notes.find((n) => n.author === 'app');
  check(note?.step === 'client', '  on the Client page, beside the Schedule card it was moved on', note?.step);

  await move(naledi, { first_fitting_date: '2025-02-02' });
  p = db.getProject(naledi);
  check(JSON.stringify(appNotes(naledi)) === JSON.stringify(['First fitting moved from 25 Jan 2025 to 2 Feb 2025.']),
    'corrected again a minute later, it is still one move, from where it started', JSON.stringify(appNotes(naledi)));
  check(p.appointment_notes.includes('FIRST FITTING: 02/02/2025'), '  and the notes say the corrected day', p.appointment_notes);

  await move(naledi, { first_fitting_date: '2025-01-25' });
  p = db.getProject(naledi);
  check(appNotes(naledi).length === 0, 'moved straight back, there was no move, and the note goes', JSON.stringify(appNotes(naledi)));
  check(p.appointment_notes === IMPORTED, '  and the notes read exactly as imported', p.appointment_notes);

  await move(naledi, { first_fitting_date: '2025-02-01' });
  raw.prepare(`UPDATE notes SET created_at = datetime('now', '-11 minutes') WHERE author = 'app' AND project_id = ?`).run(naledi);
  await move(naledi, { first_fitting_date: '2025-02-03' });
  check(JSON.stringify(appNotes(naledi)) === JSON.stringify([
    'First fitting moved from 1 Feb 2025 to 3 Feb 2025.',
    'First fitting moved from 25 Jan 2025 to 1 Feb 2025.',
  ]), 'moved again later on, it is a second move with its own note', JSON.stringify(appNotes(naledi)));

  await move(naledi, { consultation_date: '2025-01-19' });
  p = db.getProject(naledi);
  check(p.appointment_notes.startsWith('MEASUREMENTS: 19/01/2025  FIRST FITTING: 03/02/2025'),
    'the first consultation rewrites MEASUREMENTS:, the label the import read it from', p.appointment_notes);
  check(appNotes(naledi).includes('First consultation moved from 18 Jan 2025 to 19 Jan 2025.'), '  and is recorded by its own name');

  await move(naledi, { final_fitting_date: '' });
  p = db.getProject(naledi);
  check(p.appointment_notes.endsWith('FINAL FITTING: (collect)'), 'a date taken off is taken out of the notes too', p.appointment_notes);
  check(appNotes(naledi).includes('Final fitting & delivery taken off (it was 8 Feb 2025).'), '  and the note says what it was',
    JSON.stringify(appNotes(naledi)));
  await move(naledi, { final_fitting_date: '2025-02-15' });
  p = db.getProject(naledi);
  check(p.appointment_notes.endsWith('FINAL FITTING: 15/02/2025 (collect)'), 'booked again, it is written back after its label', p.appointment_notes);
  check(appNotes(naledi).includes('Final fitting & delivery moved from 8 Feb 2025 to 15 Feb 2025.')
    && !appNotes(naledi).some((b) => b.includes('taken off')), '  and the two halves read as one move', JSON.stringify(appNotes(naledi)));

  await move(naledi, { measurement_date: '2025-01-20' });
  check(db.getProject(naledi).appointment_notes.startsWith('MEASUREMENTS: 19/01/2025'),
    'a date set for the first time is not a move, and a date with no label in the notes leaves them alone',
    db.getProject(naledi).appointment_notes);
  check(!appNotes(naledi).some((b) => b.startsWith('Measurement date')), '  nor is it written down as one');
  await move(naledi, { measurement_date: '2025-01-22' });
  check(appNotes(naledi).includes('Measurement date moved from 20 Jan 2025 to 22 Jan 2025.'),
    'but every date on the order is recorded when it moves', JSON.stringify(appNotes(naledi)));

  const bystanderNow = db.getProject(bystander);
  check(bystanderNow.appointment_notes === IMPORTED && bystanderNow.notes.length === 0
    && bystanderNow.updated_at === bystanderBefore.updated_at && bystanderNow.first_fitting_date === '2025-01-25',
  'nobody else\'s order is touched', JSON.stringify({ notes: bystanderNow.notes.length, at: bystanderNow.updated_at }));

  log('\n=== what is deliberately left alone ===');
  const own = imported('Own words');
  await move(own, { first_fitting_date: '2025-02-01', appointment_notes: 'Rebooked by phone.' });
  check(db.getProject(own).appointment_notes === 'Rebooked by phone.',
    'an edit that writes the notes itself keeps its own words', db.getProject(own).appointment_notes);
  check(appNotes(own).length === 1, '  though the move is still recorded', JSON.stringify(appNotes(own)));

  const reimport = imported('Reimported');
  db.updateProject(reimport, { first_fitting_date: '2025-03-01' });
  check(db.getProject(reimport).appointment_notes === IMPORTED && appNotes(reimport).length === 0,
    'the workbook import writes the order directly and records no move', JSON.stringify(appNotes(reimport)));

  const plain = imported('Plain');
  await move(plain, { comments: 'Navy', status: 'in_production' });
  check(db.getProject(plain).appointment_notes === IMPORTED && appNotes(plain).length === 0,
    'an edit that moves no date writes no note', JSON.stringify(appNotes(plain)));

  // The rewrite on its own, for notes the import could have read either way:
  // a label with nothing after it but the next label and that label's date.
  const { rewriteNotes } = require('../electron/dateMoves.js');
  const unbooked = 'MEASUREMENTS: FIRST FITTING: 25/01/2025';
  const booked = rewriteNotes(unbooked, 'consultation_date', '2025-01-19');
  check(booked === 'MEASUREMENTS: 19/01/2025 FIRST FITTING: 25/01/2025',
    'a label with no date of its own never takes the next label\'s date', booked);
  const cleared = rewriteNotes(unbooked, 'consultation_date', '');
  check(cleared === unbooked, '  and taking its date off leaves the next label\'s date alone', cleared);
  check(rewriteNotes('Prefers Saturday mornings.', 'first_fitting_date', '2025-02-01') === 'Prefers Saturday mornings.',
    'notes with no label are left exactly as written');

  log('\n=== what a hostile page gets ===');
  const forged = imported('Forged');
  const fake = await call('notes.add', { projectId: forged, step: 'client', author: 'app',
    body: 'First fitting moved from 1 Jan 2020 to 2 Jan 2020.' });
  check(!fake.error, 'a page can write a note that looks like the app\'s (as it always could)', JSON.stringify(fake.error));
  await move(forged, { first_fitting_date: '2025-02-01' });
  const forgedNotes = appNotes(forged);
  check(forgedNotes.includes('First fitting moved from 1 Jan 2020 to 2 Jan 2020.')
    && forgedNotes.includes('First fitting moved from 25 Jan 2025 to 1 Feb 2025.'),
  '  but it is never taken for a move: the real one gets its own note, built from the stored date', JSON.stringify(forgedNotes));
  const notADate = await move(forged, { first_fitting_date: '<img src=x onerror=alert(1)>' });
  check(!notADate.error && db.getProject(forged).appointment_notes.includes('FIRST FITTING: 01/02/2025'),
    'a value that is not a date is never written into the notes', db.getProject(forged).appointment_notes);
  const unknown = await move(forged, { appointment_notes_json: 'x' });
  check(!!unknown.error, 'and the gate still refuses a field it does not know', JSON.stringify(unknown));

  log('\n=== a reminder follows its fitting ===');
  const lerato = imported('Lerato', 'lerato@example.com');
  const marlowe = imported('Marlowe', 'marlowe@example.com');
  for (const id of [lerato, marlowe]) db.updateProject(id, { first_fitting_date: '2026-11-21', event_date: '2027-01-30' });
  const fitting = (await call('mail.saveRule', { name: 'A week before the first fitting', anchor: 'first_fitting_date',
    offsetDays: -7, audience: 'all', subject: 'Your fitting', body: 'See you on {fitting_date}.' })).data.id;
  const event = (await call('mail.saveRule', { name: 'A week before the event', anchor: 'event_date',
    offsetDays: -7, audience: 'all', subject: 'Your event', body: 'Nearly there.' })).data.id;
  const due = async (on) => (await call('mail.due', { on })).data.due;
  const has = (list, ruleId, projectId) => list.find((d) => d.ruleId === ruleId && d.projectId === projectId);
  const sentFor = (ruleId, projectId) => raw.prepare('SELECT anchor_date d FROM mail_sent WHERE rule_id = ? AND project_id = ?').get(ruleId, projectId)?.d;

  let list = await due('2026-11-14');
  check(has(list, fitting, lerato) && has(list, fitting, marlowe) && !has(list, fitting, lerato).sentBefore,
    'a week before the fitting, it is due for both, and has not been sent before', JSON.stringify(list));
  for (const id of [lerato, marlowe]) await call('mail.send', { ruleId: fitting, projectId: id });
  await call('mail.send', { ruleId: event, projectId: lerato });
  check(sentFor(fitting, lerato) === '2026-11-21' && sentFor(event, lerato) === '2027-01-30',
    'a sent reminder records the date it was sent for', JSON.stringify([sentFor(fitting, lerato), sentFor(event, lerato)]));
  list = await due('2026-11-14');
  check(!has(list, fitting, lerato) && !has(list, fitting, marlowe), '  and stops being due', JSON.stringify(list));

  await move(lerato, { first_fitting_date: '2026-11-28' });
  list = await due('2026-11-21');
  const again = has(list, fitting, lerato);
  check(again && again.dueOn === '2026-11-21' && again.sentBefore?.for === '2026-11-21',
    'moving the fitting offers it again, counted from the new date, and says it went before', JSON.stringify(again));
  check(!has(await due('2026-11-14'), fitting, lerato), '  not before the new date makes it due');
  check(!has(list, fitting, marlowe), '  and the order whose fitting did not move is not offered again');
  check(!has(await due('2027-01-23'), event, lerato), '  nor is the event reminder, whose date did not move');

  await move(lerato, { first_fitting_date: '2026-11-21' });
  check(!has(await due('2026-11-21'), fitting, lerato), 'moved back to the day it was sent for, it is not due again');

  await move(lerato, { first_fitting_date: '2026-11-28' });
  const before = drafts.length;
  await call('mail.send', { ruleId: fitting, projectId: lerato });
  check(drafts.length === before + 1 && decodeURIComponent(drafts[drafts.length - 1]).includes('2026-11-28'),
    'sent again, the draft is about the new date', decodeURIComponent(drafts[drafts.length - 1] ?? '').slice(0, 120));
  check(sentFor(fitting, lerato) === '2026-11-28' && !has(await due('2026-11-21'), fitting, lerato),
    '  it records that date, and is not offered a third time', sentFor(fitting, lerato));

  await move(lerato, { first_fitting_date: '' });
  check(!has(await due('2027-12-31'), fitting, lerato), 'with the fitting taken off, nothing is due for it');

  const idle = drafts.length;
  await due('2026-11-21');
  check(drafts.length === idle, 'and working out what is due still sends nothing at all');

  log('\n=== on the screens the shop uses ===');
  const zanele = imported('Zanele', 'zanele@example.com');
  db.updateProject(zanele, { first_fitting_date: day(7) });
  const soon = (await call('mail.saveRule', { name: 'Fitting reminder', anchor: 'first_fitting_date',
    offsetDays: -7, audience: 'only', clientIds: [db.getProject(zanele).client_id], subject: 's', body: 'b' })).data.id;
  await call('mail.send', { ruleId: soon, projectId: zanele });

  win.webContents.reload(); await wait(2400);
  const ui = JSON.parse(await js(`(async () => { try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const byText = (sel, t) => [...document.querySelectorAll(sel)].find(e => e.textContent.trim().startsWith(t));
    // Each step names what it could not find, rather than failing on a null.
    const tab = (t) => [...document.querySelectorAll('.step-tab')].find(e => e.textContent.includes(t));
    const go = async (el, what, ms) => { if (!el) throw new Error('not on screen: ' + what); el.click(); await wait(ms); };
    await go(byText('.nav-item', 'Orders'), 'Orders', 700);
    await go([...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes('Zanele')), "the order for Zanele", 1100);
    await go(tab('Client'), 'the Client tab', 900);
    const card = [...document.querySelectorAll('.card')].find(c => c.querySelector('h3')?.textContent === 'Schedule');
    const box = [...card.querySelectorAll('.field')].find(f => f.querySelector('label')?.textContent === 'First fitting')?.querySelector('input');
    if (!box) return JSON.stringify({ box: false });
    box.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, ${JSON.stringify(day(5))});
    box.dispatchEvent(new Event('input', { bubbles: true })); await wait(150);
    box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    box.blur(); await wait(1200);
    const notes = [...document.querySelectorAll('.note')].map(n => n.textContent);
    await go(tab('Order'), 'the Order tab', 900);
    const field = [...document.querySelectorAll('.field')].find(f => f.querySelector('label')?.textContent === 'Appointment notes');
    const text = field?.querySelector('textarea')?.value ?? null;

    await go(byText('.nav-item', 'Settings'), 'Settings', 900);
    await go(tab('Emails'), 'the Emails tab', 1000);
    const dueRows = [...document.querySelectorAll('.mail-rule .mail-rule-main')].map(e => e.textContent);
    return JSON.stringify({ box: true, notes, text, dueRows });
  } catch (e) { return JSON.stringify({ error: e.message }); } })()`));
  if (ui.error) check(false, 'the screens can be reached', ui.error);
  const [dd, mm, yyyy] = [day(5).slice(8, 10), day(5).slice(5, 7), day(5).slice(0, 4)];
  check(ui.box && db.getProject(zanele).first_fitting_date === day(5), 'the fitting moved on the order\'s Schedule card is saved',
    JSON.stringify({ box: ui.box, stored: db.getProject(zanele).first_fitting_date }));
  check((ui.notes ?? []).some((t) => t.includes('First fitting moved from') && t.includes(yyyy)),
    '  its Notes panel shows the move straight away', JSON.stringify(ui.notes));
  check(ui.text === IMPORTED.replace('25/01/2025', `${dd}/${mm}/${yyyy}`),
    '  and the Order page\'s appointment notes give the new date', JSON.stringify(ui.text));
  const row = (ui.dueRows ?? []).find((t) => t.includes('Zanele') && t.includes('Fitting reminder'));
  check(row && row.includes(`Sent before, for ${day(7)}`) && row.includes('due again'),
    'the Emails page offers the reminder again and says why', JSON.stringify(ui.dueRows));

  raw.close();
  log(`\n${fail === 0 ? 'ALL DATE MOVE CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
