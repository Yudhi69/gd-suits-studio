const { app, BrowserWindow } = require('electron');
require('./fresh.js').freshUserData(app);
require('../electron/main.js');

const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };

app.whenReady().then(async () => {
  await wait(2400);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c);
  const openOrder = async () => {
    await js(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      if (!document.querySelector('tbody tr')) { [...document.querySelectorAll('.nav-item')].find(b=>b.textContent.includes('Orders')).click(); await wait(600); }
      document.querySelector('tbody tr').click(); await wait(1100);
    })()`);
  };
  const priceBar = () => js(`document.querySelector('.price-total')?.textContent.trim()`);
  const dashTotal = () => js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.nav-item')].find(b=>b.textContent.includes('Orders')).click();
    await wait(800);
    // Find the Value column by its heading rather than by counting from the
    // end - the table gains columns, and a positional selector reads whatever
    // moved into that slot without failing.
    const heads = [...document.querySelectorAll('thead th')].map(th => th.textContent.replace(/[↑↓]/g,'').trim());
    const i = heads.indexOf('Value');
    return document.querySelector('tbody tr').children[i].textContent.trim();
  })()`);

  // A three-piece with a custom option the shop added.
  await js(`(async () => {
    const un = async p => { const r = await p; if(!r.ok) throw new Error(r.error.message); return r.data; };
    await un(window.gd.catalog.addOption({ fieldId: 'lapel', label: 'House Peak', price: 500 }));
    const clientId = await un(window.gd.clients.save({ name:'Quote', surname:'Test' }));
    const projectId = await un(window.gd.projects.create({ clientId, title:'Quote test' }));
    const opts = (await un(window.gd.catalog.list())).options;
    await un(window.gd.projects.update({ id: projectId, patch: { spec: {
      suitType: 'three_piece', lapel: opts[0].option_key,
    } } }));
  })()`);
  win.webContents.reload(); await wait(1900);

  log('=== while the order is a draft, the price list still moves it ===');
  await openOrder();
  const draftTotal = await priceBar();
  check(draftTotal === 'R6,300', 'draft prices at R5,800 base + R500 house peak', draftTotal);

  await js(`window.gd.settings.set({ key: 'priceOverrides', value: { 'suitType:three_piece': 6300 } })`);
  win.webContents.reload(); await wait(1700); await openOrder();
  const draftAfter = await priceBar();
  check(draftAfter === 'R6,800', 'a draft follows a price change', draftAfter);

  log('\n=== approving it freezes the figure ===');
  await js(`window.gd.projects.update({ id: 1, patch: { status: 'approved' } })`);
  win.webContents.reload(); await wait(1900); await openOrder();
  const approvedTotal = await priceBar();
  const storedQuote = JSON.parse(await js(`window.gd.projects.get({ id: 1 }).then(r => JSON.stringify(r.data.quote))`));
  check(approvedTotal === 'R6,800', 'the agreed total is R6,800', approvedTotal);
  check(!!storedQuote, 'a quote is stored on the order');
  check(storedQuote?.total === 6800, 'with the agreed total', String(storedQuote?.total));
  check(storedQuote?.lines?.length >= 2, 'and its lines', String(storedQuote?.lines?.length));

  log('\n=== now change the price list underneath it ===');
  await js(`window.gd.settings.set({ key: 'priceOverrides', value: { 'suitType:three_piece': 9900 } })`);
  win.webContents.reload(); await wait(1900); await openOrder();
  const afterPriceChange = await priceBar();
  check(afterPriceChange === 'R6,800', 'the agreed quote does NOT move', afterPriceChange);
  const drift = await js(`document.querySelector('.price-bar .pill-warn')?.textContent.trim() ?? 'none'`);
  check(/price list moved/.test(drift), 'but the drift is surfaced', drift);
  const onDash = await dashTotal();
  check(onDash === 'R6,800', 'the dashboard shows the agreed figure too', onDash);

  log('\n=== and deleting an option the client chose ===');
  await js(`(async () => {
    const un = async p => { const r = await p; if(!r.ok) throw new Error(r.error.message); return r.data; };
    const opts = (await un(window.gd.catalog.list())).options;
    await un(window.gd.catalog.deleteOption({ id: opts[0].id }));
  })()`);
  win.webContents.reload(); await wait(1900); await openOrder();
  const afterDelete = await priceBar();
  check(afterDelete === 'R6,800', 'the agreed quote still does NOT move', afterDelete);

  log('\n=== re-quoting is deliberate ===');
  const requoted = await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.step-tab')].find(t=>t.textContent.includes('Summary')).click();
    await wait(900);
    const btn = [...document.querySelectorAll('button')].find(b=>b.textContent.includes("Re-quote at today"));
    if (!btn) return 'no re-quote button';
    btn.click(); await wait(300); btn.click();
    await wait(1500);
    return document.querySelector('.price-total')?.textContent.trim();
  })()`);
  check(requoted !== 'R6,800' && /^R/.test(requoted), 'an explicit re-quote does move it', requoted);

  log(`\n${fail === 0 ? 'ALL QUOTE CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
