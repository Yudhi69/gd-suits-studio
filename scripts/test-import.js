/**
 * The workbook importer.
 *
 * These cover the readings that are easy to get wrong and expensive to get
 * wrong quietly: which column holds the design, and whether a number in the
 * money column is owed or already paid.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const im = require('../scripts/import-workbook.js');

let pass = 0, fail = 0;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };
const eq = (got, want, label) => check(JSON.stringify(got) === JSON.stringify(want), label, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

log('=== the header lies for most of the COMPLETED sheet ===');
// Layout A, as the header claims: lining, quantity, design.
const rowA = ['THEO MAJA', '15/02/2025', 'PWB', 'TESSURO 1572', 'LN 1116', '2-PIECE', 'PEAK LAPEL 2B2S', 'WHITE'];
// Layout B, which 433 of 588 rows actually use: design, lining, quantity.
const rowB = ['WARREN G', '10/05/2025', 'ITW', 'CHARCOAL', 'NOTCH LAPEL 2B2S', 'LN 2223', '2-PIECE', 'WHITE'];
eq(im.readGarment(rowA).design, 'PEAK LAPEL 2B2S', 'layout A: design read from column 6');
eq(im.readGarment(rowA).lining, 'LN 1116', 'layout A: lining read from column 4');
eq(im.readGarment(rowB).design, 'NOTCH LAPEL 2B2S', 'layout B: design read from column 4, not the lining');
eq(im.readGarment(rowB).lining, 'LN 2223', 'layout B: lining read from column 5');
check(im.readGarment(rowB).lining !== 'NOTCH LAPEL 2B2S', 'a design is never filed as a lining');

log('\n=== the money column means three different things ===');
const m = (s) => { const r = im.readMoney(s); return [r.paid, r.balance]; };
eq(m('R2380'), [0, 2380], 'a bare figure under "balance due" is owed');
eq(m('(R5000 PAID)'), [5000, 0], '"PAID" makes it a payment, not a debt');
eq(m('R3445 PAID\n\nR1855 BAL.'), [3445, 1855], 'one cell can hold both, on separate lines');
eq(m('R14 280'), [0, 14280], 'thousands separated by a space');
check(im.readMoney('Fully paid').settled === true, '"Fully paid" settles without inventing a figure');
check(im.readMoney('R200 REFUND').certain === false, 'a refund is never counted as money owed');
check(im.readMoney('R2050\n+R990 Shirt').certain === false, 'an add-on is flagged rather than guessed');

log('\n=== dates GD typed by hand ===');
eq(im.readDate('15/02/2025'), '2025-02-15', 'day/month/year');
eq(im.readDate('06/06/20265'), '', 'a five-digit year is rejected, not coerced');
eq(im.readDate('03/05/3035'), '', 'a year the business never saw is rejected');
eq(im.readDate('TBC'), '', 'free text yields no date');

log('\n=== the same cloth written two ways ===');
eq(im.readFabric('PWB'), 'Premium wool blend', 'the abbreviation expands');
eq(im.readFabric('PREMIUM WOOL BLEND'), 'Premium wool blend', 'and matches the long form exactly');
eq(im.readFabric('ITW, PWB'), 'Italian wool, Premium wool blend', 'a list expands part by part');
eq(im.readFabric('TESSURO 1572'), 'TESSURO 1572', 'anything unrecognised is left alone');

log('\n=== reading a client off the sheet ===');
eq(im.readName('OLIVIA KLEINSCHMIDT (SHANE)').surname, 'Kleinschmidt', 'surname without the aside');
eq(im.readName('OLIVIA KLEINSCHMIDT (SHANE)').aside, 'SHANE', 'the aside is kept, not dropped');
eq(im.readContact('081 765 5912\n\ntheo@gmail.com'), { email: 'theo@gmail.com', contact: '081 765 5912' }, 'phone and email split apart');
eq(im.readAppointments('MEASUREMENTS: 18/01/2025\n\nFIRST FITTING: 25/01/2025\n\nFINAL FITTING: 08/02/2025'),
   { consultation: '2025-01-18', firstFitting: '2025-01-25', finalFitting: '2025-02-08' },
   'the three dates come out of one cell');

log('\n=== against the real workbook ===');
const dir = process.env.CSV_DIR || path.join(os.homedir(), 'Downloads');
if (!fs.existsSync(path.join(dir, 'GD_Suits_Orders.xlsx - COMPLETED.csv'))) {
  log('  - workbook not present, skipping the end-to-end checks');
} else {
  const { orders, skipped } = im.buildOrders(dir);
  check(orders.length > 700, `every row parsed (${orders.length})`);
  check(skipped.length === 0, 'no row is dropped', JSON.stringify(skipped.slice(0, 2)));
  check(orders.filter((o) => o.continuation).length > 0, 'unnamed rows attach to the client above');
  check(orders.every((o) => o.name), 'every order has a client');
  check(orders.filter((o) => o.design).length / orders.length > 0.9, 'design read on over 90% of rows');
  const noLiningAsDesign = orders.filter((o) => /^LN |^FL /.test(o.design)).length;
  check(noLiningAsDesign === 0, 'no lining code ended up in the design field', String(noLiningAsDesign));

  const dbPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-import-'));
  const db = require('../electron/db.js');
  db.open(dbPath);
  const first = im.importInto(db, dir);
  check(first.orders > 700, `imported ${first.orders} orders`);
  const balance = db.analytics().legacy;
  check(balance.open.total > 0 && balance.settledLikely.total > 0, 'legacy balances split open from delivered');
  const t = db.analytics().totals;
  check(t.quoted === 0, 'an imported order carries no invented quote', String(t.quoted));
  check(t.paid > 0, 'explicit payments were recorded', String(t.paid));

  const second = im.importInto(db, dir);
  check(second.orders === 0 && second.skippedExisting > 700,
    'importing twice adds nothing', `${second.orders} added, ${second.skippedExisting} skipped`);
  fs.rmSync(dbPath, { recursive: true, force: true });
}

log(`\n${fail === 0 ? 'ALL IMPORT CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
