/**
 * Moving an order's dates from the Database screen.
 *
 * Fittings are the dates that move most, and GD should not have to open the
 * database itself to move one. The workbook's Current orders and Suit
 * progress tabs carry the measurement, fitting and review dates as cells;
 * changing one changes the order, which its own Schedule card and the export
 * then show. Nothing leaves the machine: the save dialog writes into a
 * temporary folder.
 */
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
require('./fresh.js').freshUserData(app);

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-dates-'));
dialog.showSaveDialog = async (_w, opts) => ({ canceled: false, filePath: path.join(OUT, path.basename(opts.defaultPath)) });

require('../electron/main.js');
const db = require('../electron/db.js');

let pass = 0, fail = 0;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  await wait(2400);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c);

  // In-page helpers. A cell is found by its row's client and its column's
  // heading, so a column added to the sheet does not move what is tested.
  const HELPERS = `
    window.T = {
      wait: (ms) => new Promise(r => setTimeout(r, ms)),
      byText: (sel, text) => [...document.querySelectorAll(sel)].find(e => e.textContent.trim().startsWith(text)),
      heads: () => [...document.querySelectorAll('.db-table thead th')].map(t => t.textContent.trim()),
      cell: (client, heading) => {
        const i = T.heads().indexOf(heading);
        const row = [...document.querySelectorAll('.db-table tbody tr')].find(r => r.textContent.includes(client));
        return i < 0 || !row ? null : row.querySelectorAll('td')[i];
      },
      shows: (client, heading) => T.cell(client, heading)?.textContent.trim() ?? null,
      // Click the cell, type, then press the key: Enter saves, Escape does not.
      set: async (client, heading, value, key = 'Enter') => {
        const td = T.cell(client, heading);
        const button = td?.querySelector('.db-cell');
        if (!button) return false;
        button.click(); await T.wait(200);
        const box = td.querySelector('input');
        if (!box) return false;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, value);
        box.dispatchEvent(new Event('input', { bubbles: true }));
        await T.wait(150);
        box.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        await T.wait(1200);
        return true;
      },
      sheet: async (tab) => {
        T.byText('.nav-item', 'Database').click(); await T.wait(1200);
        if (tab) { T.byText('.step-tab', tab).click(); await T.wait(600); }
        return true;
      },
    };
    true;`;
  const reload = async () => { win.webContents.reload(); await wait(2200); await js(HELPERS); };
  const page = (code) => js(`(async () => { ${code} })()`);

  const sipho = db.createProject({
    clientId: db.upsertClient({ name: 'Sipho', surname: 'Ndlovu', contact: '082 111 2222', email: '' }),
    title: 'Wedding', eventType: 'wedding', eventDate: '2027-01-30',
  });
  db.updateProject(sipho, {
    consultation_date: '2026-10-01', measurement_date: '2026-10-08',
    first_fitting_date: '2026-11-14', final_fitting_date: '2027-01-16', review_date: '2027-02-13', comments: 'Navy',
  });
  const thabo = db.createProject({
    clientId: db.upsertClient({ name: 'Thabo', surname: 'Mokoena', contact: '', email: '' }),
    title: 'Matric ball', eventType: 'matric', eventDate: '2027-02-20',
  });
  db.updateProject(thabo, { first_fitting_date: '2026-12-05', final_fitting_date: '2026-12-19' });
  const thaboBefore = db.getProject(thabo);
  const siphoBefore = db.getProject(sipho);

  log('=== Current orders ===');
  await reload();
  const sheet = JSON.parse(await page(`
    await T.sheet();
    return JSON.stringify({
      heads: T.heads(),
      shown: ['Measurement date', 'First fitting', 'Final fitting & delivery', 'Review date'].map(h => T.shows('Sipho', h)),
    });
  `));
  const at = (h) => sheet.heads.indexOf(h);
  check(sheet.heads.includes('Comments') && at('Measurement date') === at('First appointment') + 1
    && at('First fitting') === at('First appointment') + 2 && at('Final fitting & delivery') === at('First appointment') + 3
    && at('Review date') === at('First appointment') + 4,
  'the sheet has the measurement, fitting and review dates, after the first appointment, named as the order\'s Schedule names them',
  sheet.heads.join(' | '));
  check(JSON.stringify(sheet.shown) === JSON.stringify(['8 Oct 2026', '14 Nov 2026', '16 Jan 2027', '13 Feb 2027']),
    'and shows the dates the order holds', JSON.stringify(sheet.shown));

  const moved = await page(`return T.set('Sipho', 'First fitting', '2026-11-21');`);
  const afterMove = db.getProject(sipho);
  check(moved && afterMove.first_fitting_date === '2026-11-21', 'a fitting moved on the sheet is moved on the order',
    JSON.stringify({ moved, stored: afterMove.first_fitting_date }));
  check(await page(`return T.shows('Sipho', 'First fitting');`) === '21 Nov 2026', '  and the sheet reads it back');
  check(afterMove.final_fitting_date === '2027-01-16' && afterMove.measurement_date === '2026-10-08'
    && afterMove.consultation_date === '2026-10-01' && afterMove.review_date === '2027-02-13'
    && afterMove.comments === 'Navy' && afterMove.status === siphoBefore.status,
  '  and nothing else on the order changes', JSON.stringify(afterMove));
  const thaboNow = db.getProject(thabo);
  check(thaboNow.first_fitting_date === '2026-12-05' && thaboNow.final_fitting_date === '2026-12-19'
    && thaboNow.updated_at === thaboBefore.updated_at, '  nor does anyone else\'s order', JSON.stringify(thaboNow));

  await page(`return T.set('Sipho', 'Measurement date', '');`);
  check(db.getProject(sipho).measurement_date === '', 'a date can be cleared', JSON.stringify(db.getProject(sipho).measurement_date));
  check(await page(`return T.shows('Sipho', 'Measurement date');`) === '-', '  and the cell then reads as empty');

  await page(`return T.set('Sipho', 'Final fitting & delivery', '2027-01-23', 'Escape');`);
  check(db.getProject(sipho).final_fitting_date === '2027-01-16', 'Escape leaves the date as it was',
    db.getProject(sipho).final_fitting_date);

  // The review date goes through the same gate as the others; until the gate
  // listed it, it was dropped on the way to the database.
  await page(`return T.set('Sipho', 'Review date', '2027-02-20');`);
  check(db.getProject(sipho).review_date === '2027-02-20', 'the review date moves from the sheet too',
    JSON.stringify(db.getProject(sipho).review_date));
  check(await page(`return T.shows('Sipho', 'Review date');`) === '20 Feb 2027', '  and the sheet reads it back');

  log('\n=== the order shows the date that was moved ===');
  await reload();
  const schedule = JSON.parse(await page(`
    T.byText('.nav-item', 'Orders').click(); await T.wait(700);
    [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes('Sipho')).click(); await T.wait(1100);
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Client')).click(); await T.wait(900);
    const card = [...document.querySelectorAll('.card')].find(c => c.querySelector('h3')?.textContent === 'Schedule');
    const value = (name) => [...(card?.querySelectorAll('.field') ?? [])].find(f => f.querySelector('label')?.textContent === name)?.querySelector('input')?.value ?? null;
    return JSON.stringify({ first: value('First fitting'), measured: value('Measurement date'), last: value('Final fitting & delivery'), review: value('Review date') });
  `));
  check(schedule.first === '2026-11-21' && schedule.measured === '' && schedule.last === '2027-01-16'
    && schedule.review === '2027-02-20',
    'the order\'s Schedule card has the dates as the sheet left them', JSON.stringify(schedule));

  log('\n=== Suit progress ===');
  await reload();
  const progress = JSON.parse(await page(`
    await T.sheet('Suit progress');
    const heads = T.heads();
    const shown = ['First fitting date', 'Final fitting date'].map(h => T.shows('Thabo', h));
    const ok = await T.set('Thabo', 'Final fitting date', '2026-12-12');
    return JSON.stringify({ heads, shown, ok, after: T.shows('Thabo', 'Final fitting date') });
  `));
  check(progress.heads.includes('First fitting date') && progress.heads.includes('Final fitting date')
    && progress.heads.includes('In production'), 'the progress tab carries the two fitting dates beside its stages',
  progress.heads.join(' | '));
  check(JSON.stringify(progress.shown) === JSON.stringify(['5 Dec 2026', '19 Dec 2026']), '  showing what the order holds',
    JSON.stringify(progress.shown));
  const thaboMoved = db.getProject(thabo);
  check(progress.ok && thaboMoved.final_fitting_date === '2026-12-12' && progress.after === '12 Dec 2026',
    'a final fitting moved there is moved on the order', JSON.stringify({ ok: progress.ok, stored: thaboMoved.final_fitting_date, shown: progress.after }));
  check(thaboMoved.status === thaboBefore.status && thaboMoved.first_fitting_date === '2026-12-05',
    '  without moving the order to another stage', `${thaboMoved.status} ${thaboMoved.first_fitting_date}`);

  log('\n=== the export ===');
  // The export cleans the file name it is given, so read whichever CSV this
  // export wrote rather than guess at the name.
  const exported = async (tab) => {
    for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f));
    await reload();
    await page(`await T.sheet(${JSON.stringify(tab)}); T.byText('button', 'Export to Excel').click(); await T.wait(1200); return true;`);
    const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.csv'));
    return files.length === 1 ? fs.readFileSync(path.join(OUT, files[0]), 'utf8').replace(/^﻿/, '').split(/\r?\n/) : [];
  };
  const current = await exported('Current orders');
  check(/,FIRST APPOINTMENT,MEASUREMENT DATE,FIRST FITTING,FINAL FITTING & DELIVERY,REVIEW DATE,COMMENTS,/.test(current[0] ?? ''),
    'the Current orders export has the dates under their own headings', current[0]);
  const siphoLine = current.find((l) => l.includes('Sipho')) ?? '';
  check(/,2026-10-01,,2026-11-21,2027-01-16,2027-02-20,Navy,/.test(siphoLine), '  as the order now stands', siphoLine);
  const progressRows = await exported('Suit progress');
  check(/,FIRST FITTING DATE,FINAL FITTING DATE$/.test(progressRows[0] ?? ''), 'and so does the Suit progress export',
    progressRows[0]);
  check(/,2026-12-05,2026-12-12$/.test(progressRows.find((l) => l.includes('Thabo')) ?? ''), '  with the moved date',
    progressRows.find((l) => l.includes('Thabo')));

  fs.rmSync(OUT, { recursive: true, force: true });
  log(`\n${fail === 0 ? 'ALL DATE CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
