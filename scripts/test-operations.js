const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
app.setPath('userData', path.resolve(process.env.DATA_DIR));
require('../electron/main.js');

const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };

app.whenReady().then(async () => {
  await wait(2400);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c);

  // A shop mid-season: orders at every stage, money part-paid, work outstanding.
  await js(`(async () => {
    const un = async p => { const r = await p; if(!r.ok) throw new Error(r.error.message); return r.data; };
    const gd = window.gd;
    // Dates are relative to the day the suite runs. Fixed dates made this
    // pass in September and fail in October: an order seeded as "coming up"
    // quietly became overdue, and the failure said nothing about why.
    const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const shop = [
      ['Sipho','Ndlovu','wedding',day(80),'completed_paid',   2, 'Midnight birdseye','B-2241', 11600, 11600],
      ['Thabo','Mokoena','matric', day(20),'in_production',1,'Charcoal twill',   'C-1180',  5800,  1000],
      ['Lerato','Dlamini','business',day(40),'ready_first_fitting',1,'Navy hopsack',   'N-0455',  6900,  3450],
      ['Kagiso','Sithole','wedding',day(-50),'alterations', 3, 'Ivory linen',     'I-7782', 17400, 17400],
      ['Naledi','Khumalo','graduation',day(120),'quoted',   1, 'Slate flannel',   'S-3390',  6200,     0],
      ['Bongani','Zulu',  'wedding',day(60),'ready_final_fit',1,'Midnight birdseye','B-2241', 5800,  2900],
    ];
    for (const [name, surname, ev, date, status, qty, fabric, code, quoted, paid] of shop) {
      const clientId = await un(gd.clients.save({ name, surname, contact: '082', email: '' }));
      const projectId = await un(gd.projects.create({ clientId, title: name + ' suit', eventType: ev, eventDate: date }));
      await un(gd.projects.update({ id: projectId, patch: {
        status, quantity: qty, fabric_name: fabric, fabric_code: code,
        spec: { suitType: 'two_piece' },
        consultation_date: day(-100), final_fitting_date: day(-60),
      } }));
      await un(gd.projects.setQuote({ id: projectId, quote: {
        lines: [{ group:'Base', label:'Suit', amount: quoted, key:'k' }], total: quoted, currency:'R', status,
      } }));
      if (paid) await un(gd.payments.add({ projectId, kind: paid >= quoted ? 'balance' : 'deposit', amount: paid, paidOn: day(-40), method: 'EFT' }));
    }
    // Work outstanding
    await un(gd.alterations.add({ projectId: 4, garment:'jacket', description:'Take in the waist 2cm', kind:'Waist', dueOn: day(-10), cost: 350 }));
    await un(gd.alterations.add({ projectId: 4, garment:'pants', description:'Shorten 1.5cm', kind:'Hem', dueOn: day(30), cost: 200, status:'in_progress' }));
    await un(gd.extras.add({ projectId: 2, extraType:'Shirt', colour:'White', quantity: 1, unitPrice: 850 }));
    await un(gd.extras.add({ projectId: 3, extraType:'Bow tie', colour:'Burgundy', quantity: 1, unitPrice: 300, status:'delivered' }));
  })()`);

  const a = JSON.parse(await js(`window.gd.analytics.get().then(r => JSON.stringify(r.data))`));

  log('=== the five sheets, unified ===');
  check(a.totals.orders === 6, 'every order counted', String(a.totals.orders));
  check(a.totals.openOrders === 5, 'open orders separated from completed', String(a.totals.openOrders));
  check(a.totals.suitsInProgress === 7, 'suits in progress counts quantity, not orders', String(a.totals.suitsInProgress));
  check(a.totals.quoted === 53700, 'quoted value totals the frozen quotes', String(a.totals.quoted));
  check(a.totals.paid === 36350, 'payments total', String(a.totals.paid));
  check(a.totals.outstanding === 17350, 'balance due is quoted minus paid', String(a.totals.outstanding));
  check(a.totals.deliveredValue === 11600, 'completed value counts only completed orders', String(a.totals.deliveredValue));

  log('\n=== the things that need doing ===');
  const shortfall = a.depositShortfall;
  check(shortfall.length === 1 && shortfall[0].name === 'Thabo',
    'cutting started under the 50% deposit is flagged', JSON.stringify(shortfall.map(o => o.name)));
  check(Math.round(shortfall[0].shortfall) === 1900, 'and by how much', String(shortfall[0].shortfall));
  check(a.overdue.length === 1 && a.overdue[0].name === 'Kagiso', 'orders past their event date', JSON.stringify(a.overdue.map(o => o.name)));
  check(a.alterations.overdue === 1, 'overdue alterations counted', String(a.alterations.overdue));
  check(a.alterations.revenue === 550, 'alteration income totalled', String(a.alterations.revenue));

  log('\n=== shape worth seeing ===');
  check(a.byStage.in_production?.orders === 1 && a.byStage.completed_paid?.orders === 1, 'pipeline split by stage');
  check(a.topFabrics[0].value === 'Midnight birdseye' && a.topFabrics[0].orders === 2, 'most-used cloth', JSON.stringify(a.topFabrics[0]));
  check(a.leadTime.samples > 0, 'lead time measured from completed orders', String(a.leadTime.averageDays));
  check(a.extras.length === 2, 'extras tracked with their own status');

  // and it renders
  win.webContents.reload();
  await wait(1900);
  const shot = await js(`(async () => {
    [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Business')).click();
    await new Promise(r => setTimeout(r, 1400));
    return JSON.stringify({
      tiles: document.querySelectorAll('.stat-value').length,
      bars: document.querySelectorAll('.bar-fill').length,
      months: document.querySelectorAll('.month-fill').length,
      attention: !!document.body.innerText.match(/Needs attention/),
    });
  })()`);
  const ui = JSON.parse(shot);
  log('\n=== the dashboard renders ===');
  check(ui.tiles === 4, 'four headline figures', String(ui.tiles));
  check(ui.bars > 0, 'pipeline bars drawn', String(ui.bars));
  check(ui.attention, 'the attention panel appears when there is something wrong');

  // ---- sorting the orders list ----
  log('\n=== the orders list sorts on every column ===');
  const sorted = JSON.parse(await js(`(async () => {
    [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Orders')).click();
    await new Promise(r => setTimeout(r, 900));
    const head = (label) => [...document.querySelectorAll('.th-sort')].find(b => b.textContent.trim().startsWith(label));
    const col = (i) => [...document.querySelectorAll('tbody tr')].map(r => r.children[i].textContent.trim());
    const out = { headers: [...document.querySelectorAll('.th-sort')].map(b => b.textContent.replace(/[↑↓]/g,'').trim()) };
    out.defaultRefs = col(0).slice(0, 3);
    head('Client').click(); await new Promise(r => setTimeout(r, 400));
    out.clientAsc = col(1).slice(0, 3);
    out.arrowAfterFirstClick = head('Client').textContent.includes('↑');
    head('Client').click(); await new Promise(r => setTimeout(r, 400));
    out.clientDesc = col(1).slice(0, 3);
    out.arrowAfterSecondClick = head('Client').textContent.includes('↓');
    head('Value').click(); await new Promise(r => setTimeout(r, 400));
    out.valueFirst = col(6).slice(0, 2);
    head('Status').click(); await new Promise(r => setTimeout(r, 400));
    out.statusFirst = col(5).slice(0, 3);
    out.onlyOneArrow = document.querySelectorAll('.th-sort.is-active').length;
    return JSON.stringify(out);
  })()`));

  check(sorted.headers.length === 8, 'every column heading is a sort control', sorted.headers.join('|'));
  check(sorted.defaultRefs.every(r => /^GD-\d{4}-\d{4}$/.test(r)), 'each order shows its own reference', sorted.defaultRefs.join(' '));
  check(sorted.arrowAfterFirstClick, 'clicking a column sorts it ascending');
  check(sorted.arrowAfterSecondClick, 'clicking again reverses it');
  check(JSON.stringify(sorted.clientAsc) !== JSON.stringify(sorted.clientDesc), 'the two directions differ', JSON.stringify(sorted.clientAsc));
  check(sorted.clientAsc.join() === [...sorted.clientAsc].sort().join(), 'ascending really is A-Z', sorted.clientAsc.join(' '));
  check(sorted.onlyOneArrow === 1, 'only the column in force shows an arrow', String(sorted.onlyOneArrow));
  check(sorted.statusFirst[0] === 'Enquiry' || sorted.statusFirst[0] === 'Quoted' || sorted.statusFirst[0] === 'Deposit paid',
    'status sorts down the pipeline, not alphabetically', sorted.statusFirst.join(' '));

  if (process.env.SHOT_DIR) {
    fs.writeFileSync(path.join(process.env.SHOT_DIR, 'business.png'), (await win.webContents.capturePage()).toPNG());
    log('  (screenshot written)');
  }

  log(`\n${fail === 0 ? 'ALL OPERATIONS CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
