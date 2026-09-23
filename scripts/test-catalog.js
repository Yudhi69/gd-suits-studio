const { app, BrowserWindow } = require('electron');
require('./fresh.js').freshUserData(app);
require('../electron/main.js');

const log = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 2400));
  const win = BrowserWindow.getAllWindows()[0];

  // Add a category and two items of both kinds, then open an order.
  const setup = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
    const gd = window.gd, un = async p => { const r = await p; if(!r.ok) throw new Error(r.error.message); return r.data; };
    const cat = await un(gd.catalog.addCategory({ title: 'Accessories', blurb: 'Sold alongside the suit' }));
    await un(gd.catalog.addItem({ category: 'extras', label: 'Pocket square', kind: 'toggle', price: 180,
      prompt: 'a folded silk pocket square in the breast pocket' }));
    await un(gd.catalog.addItem({ category: cat.key, label: 'Shoes', kind: 'choice',
      options: [{ key:'oxford', label:'Oxford', price:1400 }, { key:'loafer', label:'Loafer', price:1250 }] }));
    const clientId = await un(gd.clients.save({ name: 'Cat', surname: 'Test' }));
    const projectId = await un(gd.projects.create({ clientId, title: 'Catalog test' }));
    await un(gd.projects.update({ id: projectId, patch: { spec: { suitType: 'two_piece' } } }));
    return JSON.stringify({ catKey: cat.key, projectId });
  })()`));

  win.webContents.reload();
  await new Promise((r) => setTimeout(r, 1900));

  const result = JSON.parse(await win.webContents.executeJavaScript(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    document.querySelector('tbody tr').click();
    await wait(1000);

    const stepTitles = [...document.querySelectorAll('.step-tab')].map(t => t.textContent.trim());
    const priceOf = () => document.querySelector('.price-total').textContent.trim();
    const startPrice = priceOf();

    // Extras should now carry the shop's own toggle.
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Extras')).click();
    await wait(700);
    const labels = [...document.querySelectorAll('.toggle-row')].map(r => r.textContent);
    const squareRow = [...document.querySelectorAll('.toggle-row')].find(r => r.textContent.includes('Pocket square'));
    const hasSquare = !!squareRow;
    if (squareRow) { squareRow.querySelector('.switch').click(); await wait(900); }
    const afterSquare = priceOf();

    // The new category should be a step of its own, with the choice item in it.
    const accTab = [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Accessories'));
    let hasOxford = false, afterShoes = afterSquare;
    if (accTab) {
      accTab.click();
      await wait(700);
      const oxford = [...document.querySelectorAll('.option')].find(o => o.textContent.includes('Oxford'));
      hasOxford = !!oxford;
      if (oxford) { oxford.click(); await wait(900); }
      afterShoes = priceOf();
    }

    // ...and reach the spec sheet.
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Summary')).click();
    await wait(800);
    const sheet = document.querySelector('.content').textContent;

    return JSON.stringify({
      stepTitles, startPrice, hasSquare, afterSquare, hasAccessoriesStep: !!accTab, hasOxford, afterShoes,
      sheetHasSquare: sheet.includes('Pocket square'), sheetHasShoes: sheet.includes('Oxford'),
    });
  })()`));

  log('=== the custom catalog reaches the builder ===');
  check(result.hasSquare, 'a custom yes/no item appears in its built-in category');
  check(result.hasAccessoriesStep, 'a custom category appears as its own step', result.stepTitles.join(' | '));
  check(result.hasOxford, 'a custom pick-one item renders its options');

  log('\n=== it prices correctly ===');
  log('   base', result.startPrice, '-> +square', result.afterSquare, '-> +oxford', result.afterShoes);
  check(result.startPrice === 'R4,500', 'starts at the 2-piece base', result.startPrice);
  check(result.afterSquare === 'R4,680', 'the R180 add-on is charged', result.afterSquare);
  check(result.afterShoes === 'R6,080', 'the R1,400 option is charged', result.afterShoes);

  log('\n=== and reaches the client-facing sheet ===');
  check(result.sheetHasSquare, 'the custom item is on the spec sheet');
  check(result.sheetHasShoes, 'the chosen option is on the spec sheet');

  log(`\n${fail === 0 ? 'ALL CATALOG CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
