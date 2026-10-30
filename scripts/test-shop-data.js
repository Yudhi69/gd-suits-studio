/**
 * The shop's details and price list are its own, kept only in its database.
 *
 * The app ships no figures, terms or contact details. A copy that has been in
 * use carries them in its database - an earlier version saved them there -
 * and an update brings new code, never new data. A fresh copy starts with
 * none and the shop types its own in Settings.
 *
 * This checks both halves:
 *   - what ships: no figure on any built-in option, no contact or terms in the
 *     defaults, and nothing in the app that writes a price list itself;
 *   - what a shop has: its stored list prices every order, its own changes sit
 *     on top, its details and terms go on the order form, and with none stored
 *     nothing is priced or printed in their place.
 *
 * The suite starts from what a copy in use leaves behind - details saved
 * before some fields existed, one price changed in Settings - with no price
 * list, then gives it the example shop's list (scripts/fixtures). Every name,
 * number and figure is made up. Nothing leaves the machine: any request at
 * all is answered by a stub.
 */
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const dir = require('./fresh.js').freshUserData(app);
global.fetch = async () => new Response(JSON.stringify({ error: { message: 'no network in this suite' } }), { status: 500 });
const shop = require('./fixtures/example-shop.js');

// Saved by a copy before the terms and the deposit were settings.
const OLDER = { businessName: 'Test Tailors', name: 'Test Owner', role: 'Owner', phone: '021 000 0000', email: 'owner@example.com' };
// One price the shop changed in Settings.
const CHANGED = { 'lapel:peak': 345 };
const db = require('../electron/db.js');
{
  const before = db.open(dir);
  const put = before.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  put.run('business', JSON.stringify(OLDER));
  put.run('priceOverrides', JSON.stringify(CHANGED));
  before.close();
}

require('../electron/main.js');
const business = require('../electron/business.js');

let pass = 0, fail = 0;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const digits = (s) => String(s ?? '').replace(/\D/g, '');

/** The renderer's own catalogue and pricing, as plain modules, for the checks no window can show. */
function pricingModules() {
  const root = path.join(__dirname, '..');
  const out = require('esbuild').buildSync({
    stdin: {
      contents: "export * from './src/lib/catalog.js'; export * from './src/lib/pricing.js'; export * from './src/lib/priceList.js';",
      resolveDir: root,
    },
    bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'error',
  });
  const m = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(m, m.exports, require);
  return m.exports;
}

/**
 * Every figure on the built-in fields and options, under the key the price
 * list keeps it under - walked independently of withPriceList. A price of 0
 * charges nothing, the same as none, so it is not a figure; any other number
 * is.
 */
function figuresOf(steps) {
  const prices = {}, upTo = {};
  for (const step of steps) {
    for (const f of step.fields) {
      if (f.custom) continue;
      if (typeof f.price === 'number' && f.price !== 0) prices[f.id] = f.price;
      for (const o of f.options ?? []) {
        if (o.custom) continue;
        if (typeof o.price === 'number' && o.price !== 0) prices[`${f.id}:${o.key}`] = o.price;
        for (const [s, n] of Object.entries(o.prices ?? {})) prices[`suitType:${s}@${o.key}`] = n;
        for (const [s, n] of Object.entries(o.upTo ?? {})) upTo[`suitType:${s}@${o.key}`] = n;
      }
    }
  }
  return { prices, upTo };
}

/** The spec of the one order the window opens: a suit, a shirt and a peak lapel. */
const SPEC = { suitType: 'two_piece', material: 'premium_wool', shirt: true, lapel: 'peak' };

app.whenReady().then(async () => {
  // What the order form would save, kept here instead of asking for a folder.
  const exported = [];
  ipcMain.removeHandler('project:export');
  ipcMain.handle('project:export', async (_e, p) => {
    exported.push(String(p?.html ?? ''));
    return { ok: true, data: { exported: false } };
  });

  await wait(3200);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c);
  const read = (code) => js(`(async () => JSON.stringify(await (async () => { ${code} })()))()`).then(JSON.parse);
  const reload = async () => {
    const loaded = new Promise((r) => win.webContents.once('did-finish-load', r));
    win.webContents.reload();
    await loaded;
    await wait(1800);
  };
  const section = async (title, body) => {
    log(`\n=== ${title} ===`);
    try { await body(); } catch (e) { fail++; log('  ✗ FAIL: the section stopped:', String(e.stack ?? e).split('\n').slice(0, 2).join(' ')); }
  };

  // The same walk through the window each time: Settings > Price list, then
  // the order's Base Garment page, then its Summary, where the order form is
  // exported.
  const UI = `
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const byText = (sel, text) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim().startsWith(text));
    byText('.nav-item', 'Settings').click(); await wait(900);
    byText('.step-tab', 'Price list').click(); await wait(700);
    const box = (q, s) => document.querySelector('input[aria-label="' + q + ', ' + s + '"]');
    const premium = box('Premium Wool Blend', '2-Piece')?.placeholder ?? null;
    const luxury = box('Luxury Wool', '2-Piece')?.closest('td')?.querySelector('.tiny.faint')?.textContent.trim() ?? null;
    byText('.nav-item', 'Orders').click(); await wait(700);
    byText('.step-tab', 'Current')?.click(); await wait(300);
    [...document.querySelectorAll('tbody tr')].find((r) => r.textContent.includes('Lindiwe')).click(); await wait(1100);
    [...document.querySelectorAll('.step-tab')].find((t) => t.textContent.includes('Base Garment')).click(); await wait(900);
    const shirtBox = document.querySelector('label[for="toggle-shirt"]')?.parentElement;
    const shirt = shirtBox ? [...shirtBox.querySelectorAll('.tiny.faint')].map((e) => e.textContent.trim()) : null;
    // The shirt's own editor: the shop can price it there, list or no list.
    document.querySelector('[aria-label="Edit Shirt"]')?.click(); await wait(500);
    const priceBox = document.querySelector('#builtin-price');
    const shirtEditor = priceBox ? { placeholder: priceBox.placeholder, hint: priceBox.parentElement.querySelector('.hint')?.textContent.trim() ?? '' } : null;
    byText('.modal button', 'Cancel')?.click(); await wait(400);
    const total = document.querySelector('.price-total')?.textContent.trim() ?? null;
    const unpriced = document.querySelector('.price-unpriced')?.textContent.trim() ?? null;
    [...document.querySelectorAll('.step-tab')].find((t) => t.textContent.includes('Summary')).click(); await wait(900);
    byText('button', 'Export client file').click(); await wait(900);
    return { premium, luxury, shirt, shirtEditor, total, unpriced };`;

  let lib;
  await section('the catalogue and pricing load as plain modules', async () => {
    lib = pricingModules();
    check(typeof lib.withPriceList === 'function' && typeof lib.buildBreakdown === 'function' && Array.isArray(lib.STEPS),
      'the pricing functions are there to check', Object.keys(lib ?? {}).filter((k) => /price/i.test(k)).join(','));
  });

  await section('the app ships no figures, contact details or terms', async () => {
    const shipped = figuresOf(lib.STEPS);
    check(Object.keys(shipped.prices).length === 0 && Object.keys(shipped.upTo).length === 0,
      'no built-in field or option carries a figure', Object.keys(shipped.prices).slice(0, 6).join(', '));
    const priced = lib.allFieldsOf(lib.STEPS).filter((f) => f.priced);
    check(priced.length >= 9 && priced.every((f) => f.price === undefined),
      'the items sold on their own are marked as priced, with no figure', `${priced.length} marked`);
    const d = business.DEFAULT_BUSINESS;
    check(d.name === '' && d.role === '' && d.phone === '' && d.email === '', 'the default details name no one and give no number or address');
    check(Array.isArray(d.terms) && d.terms.length === 0, 'and the default terms are none');
    check(same(business.toKeep(null), business.withDefaults(null)) && business.toKeep(null).terms.length === 0,
      'so what a fresh copy saves at its first start is blank');
  });

  await section('details a copy saved before some fields existed are filled out, as they were', async () => {
    const stored = db.getSetting('business', null);
    check(stored?.name === OLDER.name && stored?.phone === OLDER.phone && stored?.email === OLDER.email && stored?.businessName === OLDER.businessName,
      'what the shop saved is kept as it was', JSON.stringify(stored && { name: stored.name, phone: stored.phone }));
    check(Object.keys(business.DEFAULT_BUSINESS).every((k) => stored && k in stored),
      'every field is now stored', Object.keys(business.DEFAULT_BUSINESS).filter((k) => !(k in (stored ?? {}))).join(','));
    check(same(stored, business.withDefaults(OLDER)), 'filled out with the defaults and nothing else');
    check(same(stored?.terms, []), 'which give it no terms the shop did not write');
    const shown = await read(`return await window.gd.business.get();`);
    check(shown?.ok && same(shown.data, stored), 'what the app shows is what is stored');
    check(business.toKeep(stored) === null, 'and once stored, the next start saves nothing');
  });

  await section('with no price list, nothing is priced at a figure nobody set', async () => {
    const fields = lib.allFieldsOf(lib.STEPS);
    const b = lib.buildBreakdown(SPEC, {}, lib.STEPS);
    const suit = b.lines.find((l) => l.key === 'suitType:two_piece@premium_wool');
    check(suit && suit.unpriced && !suit.noQuality && lib.needsPrice(suit), 'the suit has no price yet in its quality', JSON.stringify(suit));
    const shirt = b.lines.find((l) => l.key === 'shirt');
    check(shirt && shirt.amount === 0 && shirt.unpriced && shirt.item && lib.needsPrice(shirt),
      'an item sold on its own says it has no price yet, rather than charging nothing', JSON.stringify(shirt));
    check(!b.lines.some((l) => l.key === 'lapel:peak'), 'an option with no figure is free: no line');
    check(b.total === 0, 'so the order totals nothing', String(b.total));
    const own = lib.buildBreakdown(SPEC, CHANGED, lib.STEPS).lines.find((l) => l.key === 'lapel:peak');
    check(own?.amount === CHANGED['lapel:peak'], 'a price the shop set in Settings is charged all the same', JSON.stringify(own));
    const ownShirt = lib.buildBreakdown(SPEC, { shirt: 640 }, lib.STEPS).lines.find((l) => l.key === 'shirt');
    check(ownShirt?.amount === 640 && !ownShirt.unpriced, 'and so is a figure set for an item', JSON.stringify(ownShirt));

    const grid = lib.priceGrid(lib.STEPS, {});
    check(grid.rows.length > 5 && grid.rows.every((r) => r.cells.every((c) => c.shipped === null && c.upTo === null)),
      'the quality grid in Settings has no figure in any cell');
    const entry = lib.priceCatalogEntries(lib.STEPS).find((e) => e.key === 'shirt');
    check(entry && entry.defaultAmount === null, 'and the price list line for an item has none either', JSON.stringify(entry));
    const shirtField = fields.find((f) => f.id === 'shirt');
    check(lib.fieldFigure(shirtField, {}) === null && lib.fieldFigure(shirtField, { shirt: 640 }) === 640,
      'an item\'s tile shows "no price yet" until a figure is set, then that figure');
  });

  await section('the page can read the price list, never write it', async () => {
    const got = await read(`return await window.gd.settings.get({ key: 'priceList', fallback: null });`);
    check(got?.ok && got.data === null, 'with none stored, it reads as none', JSON.stringify(got));
    const set = await read(`return await window.gd.settings.set({ key: 'priceList', value: { prices: { shirt: 1 } } });`);
    check(set?.ok === false && db.getSetting('priceList', null) === null, 'a list sent from the page is refused, and nothing is stored', JSON.stringify(set));
    const other = await read(`return await window.gd.settings.set({ key: 'priceOverrides', value: ${JSON.stringify(CHANGED)} });`);
    check(other?.ok === true && same(db.getSetting('priceOverrides', null), CHANGED), 'while the shop\'s own changes save as before', JSON.stringify(other));
  });

  const client = db.upsertClient({ name: 'Lindiwe', surname: 'Listed', contact: '082 555 0000', email: 'lindiwe@example.com' });
  const order = db.createProject({ clientId: client, title: 'From the list' });
  db.updateSuit(db.primarySuitId(order), { spec: SPEC });

  await section('a copy with no price list shows no figure, and prints only the details it has', async () => {
    await reload();
    const ui = await read(UI);
    check(ui.premium === 'to price', 'the quality grid asks for a figure', JSON.stringify(ui.premium));
    check(ui.luxury === null, 'and shows no range', JSON.stringify(ui.luxury));
    check(Array.isArray(ui.shirt) && ui.shirt.includes('No price yet'), 'the shirt tile says it has no price yet', JSON.stringify(ui.shirt));
    check(ui.shirtEditor?.placeholder === 'Its price' && /no price yet/.test(ui.shirtEditor.hint),
      'and its editor has a price box, saying it has no price yet', JSON.stringify(ui.shirtEditor));
    check(digits(ui.total) === String(CHANGED['lapel:peak']), 'the total is only the price the shop set', JSON.stringify(ui.total));
    check(ui.unpriced === 'The suit has no price yet in this quality', 'and says the suit has no price yet', JSON.stringify(ui.unpriced));
    const form = exported.at(-1) ?? '';
    check(form.includes('<h1>Order Form</h1>'), 'the order form was exported', `${exported.length} exported`);
    check(!form.includes('Terms and conditions'), 'with no terms stored, the form has no terms heading');
    check(form.includes(OLDER.name) && form.includes(OLDER.phone) && form.includes(OLDER.email), 'and the details the shop saved are on it');
    check(db.getSetting('priceList', null) === null, 'the window wrote no price list of its own');
  });

  await section('a fresh copy prints no one\'s details', async () => {
    db.setSetting('business', business.toKeep(null));
    await reload();
    exported.length = 0;
    await read(UI);
    const form = exported.at(-1) ?? '';
    check(form.includes('<h1>Order Form</h1>'), 'the order form was exported', `${exported.length} exported`);
    check(!form.includes('Terms and conditions') && !form.includes('Contact us'), 'no terms and no contact heading');
    check(!form.includes(OLDER.email) && !form.includes(OLDER.phone), 'and no details left over from before');
  });

  const list = shop.examplePriceList();
  await section('a stored price list prices every order, with the shop\'s changes on top', async () => {
    db.setSetting('priceList', list);
    db.setSetting('business', shop.EXAMPLE_BUSINESS);
    await reload();
    exported.length = 0;
    const ui = await read(UI);
    const bottom = shop.suitFigure('two_piece', 'premium_wool');
    check(ui.premium === String(bottom), 'the quality grid shows the stored figure', JSON.stringify(ui.premium));
    check(digits(ui.luxury) === String(shop.suitTop('two_piece', 'luxury')), 'and the stored top of a range', JSON.stringify(ui.luxury));
    check(Array.isArray(ui.shirt) && ui.shirt.some((t) => digits(t) === String(shop.ITEMS.shirt)), 'the shirt tile shows its stored figure', JSON.stringify(ui.shirt));
    check(ui.shirtEditor?.placeholder === String(shop.ITEMS.shirt) && ui.shirtEditor.hint.includes(String(shop.ITEMS.shirt)),
      'and its editor offers that figure', JSON.stringify(ui.shirtEditor));
    const want = bottom + shop.ITEMS.shirt + CHANGED['lapel:peak'];
    const counted = lib.buildBreakdown(SPEC, CHANGED, lib.withPriceList(lib.STEPS, list)).total;
    check(counted === want && digits(ui.total) === String(want),
      'the order is charged the stored suit and shirt, and the peak lapel at the shop\'s own figure', `${ui.total}, want ${want}, counted ${counted}`);
    check(ui.unpriced === null, 'with nothing left unpriced', JSON.stringify(ui.unpriced));
    const form = exported.at(-1) ?? '';
    check(form.includes('Terms and conditions') && shop.EXAMPLE_BUSINESS.terms.every((t) => form.includes(t)),
      'the shop\'s terms are on the order form');
    check(form.includes(shop.EXAMPLE_BUSINESS.name) && form.includes(shop.EXAMPLE_BUSINESS.phone) && form.includes(shop.EXAMPLE_BUSINESS.email),
      'and its contact details');
    check(same(canon(db.getSetting('priceList', null)), canon(list)), 'the stored list is untouched by the window');
  });

  await section('every figure on the list lands on the option it names', async () => {
    const priced = figuresOf(lib.withPriceList(lib.STEPS, list));
    const missing = Object.keys(list.prices).filter((k) => priced.prices[k] !== list.prices[k]);
    check(missing.length === 0, `all ${Object.keys(list.prices).length} prices reach the catalogue`, missing.slice(0, 6).join(', '));
    check(same(canon(priced), canon(list)), 'and nothing else is priced', JSON.stringify(Object.keys(priced.prices).filter((k) => !(k in list.prices)).slice(0, 6)));
    check(same(figuresOf(lib.withPriceList(lib.STEPS, null)), { prices: {}, upTo: {} }) && lib.withPriceList(lib.STEPS, null) === lib.STEPS,
      'with no list, nothing is priced');

    const restored = lib.withPriceList(lib.STEPS, list);
    const fields = lib.allFieldsOf(restored);
    const twoPiece = fields.find((f) => f.id === 'suitType').options.find((o) => o.key === 'two_piece');
    const quality = (key) => fields.find((f) => f.priceGrid).options.find((o) => o.key === key);
    const range = lib.suitPrice(twoPiece, quality('luxury'), {});
    check(range.amount === shop.suitFigure('two_piece', 'luxury') && range.upTo === shop.suitTop('two_piece', 'luxury'),
      'a quality priced by the cloth is a range', JSON.stringify(range));
    const own = lib.suitPrice(twoPiece, quality('luxury'), { [range.key]: range.amount + 1234 });
    check(own.amount === range.amount + 1234 && !own.upTo, 'until the shop sets its own figure, which is then the price', JSON.stringify(own));
    const linen = lib.suitPrice(twoPiece, quality('linen'), {});
    check(linen.unpriced && !linen.noQuality, 'a quality the list leaves out has no price yet', JSON.stringify(linen));
    const peak = lib.buildBreakdown({ suitType: 'two_piece', lapel: 'peak' }, CHANGED, restored).lines.find((l) => l.key === 'lapel:peak');
    check(peak?.amount === CHANGED['lapel:peak'] && CHANGED['lapel:peak'] !== shop.OPTIONS['lapel:peak'],
      'a price the shop changed wins over the list', JSON.stringify(peak));
  });

  await section('the shop\'s own items and options keep their own figures', async () => {
    const item = { id: 7, field_id: 'custom_monogram', category: 'extras', label: 'Monogram', kind: 'toggle', price: 95, active: 1 };
    const option = { id: 8, field_id: 'lapel', option_key: 'c_wide_peak', label: 'Wide peak', price: 590, active: 1 };
    const mine = lib.buildSteps([], [item], [option], {});
    const after = lib.allFieldsOf(lib.withPriceList(mine, { prices: { custom_monogram: 1, 'lapel:c_wide_peak': 1 } }));
    check(after.find((f) => f.id === 'custom_monogram')?.price === 95
      && after.find((f) => f.id === 'lapel')?.options.find((o) => o.key === 'c_wide_peak')?.price === 590,
    'a list never reprices what the shop added with a figure of its own');
    const b = lib.buildBreakdown({ suitType: 'two_piece', custom_monogram: true, lapel: 'c_wide_peak' }, {}, mine);
    check(b.lines.find((l) => l.key === 'custom_monogram')?.amount === 95 && b.lines.find((l) => l.key === 'lapel:c_wide_peak')?.amount === 590,
      'and with no list at all, they are charged at those figures', JSON.stringify(b.lines.map((l) => [l.key, l.amount])));
  });

  await section('nothing is shown until the price list is read', async () => {
    // Hold the price list back, as a slow disk would. Every other setting reads as usual.
    ipcMain.removeHandler('settings:get');
    ipcMain.handle('settings:get', async (_e, p) => {
      if (p?.key === 'priceList') await wait(3000);
      return { ok: true, data: db.getSetting(p?.key, p?.fallback ?? null) };
    });
    const loaded = new Promise((r) => win.webContents.once('did-finish-load', r));
    win.webContents.reload();
    await loaded;
    const during = await read(`
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 30 && !document.querySelector('.main'); i++) await wait(50);
      await wait(800);
      const main = document.querySelector('.main');
      return { main: !!main, spinner: !!main?.querySelector('.spinner'), children: main?.children.length ?? 0, total: !!document.querySelector('.price-total') };`);
    check(during.main && during.spinner && during.children === 1, 'while it is read, the page shows only a spinner', JSON.stringify(during));
    await wait(3200);
    const after = await read(`
      const main = document.querySelector('.main');
      return { spinner: !!main?.querySelector(':scope > .content.center > .spinner'), children: main?.children.length ?? 0 };`);
    check(!after.spinner && after.children > 0, 'and once it is in, the page is shown', JSON.stringify(after));
  });

  log(`\n${fail === 0 ? 'ALL SHOP DATA CHECKS PASSED' : 'FAILED'} - ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
});
