/**
 * A shop's price list, checked in the running app - the made-up shop's, from
 * scripts/fixtures/example-shop.js, put in the fresh database before the app
 * opens it.
 *
 * Each block is one part of the list: the quality grid in Settings, the
 * totals it gives an order (the suit type has no price of its own: with no
 * quality chosen, or one not priced, the suit has none and no quote goes),
 * luxury wool priced by the cloth (a range, said as
 * "from" until the shop puts in the cloth's figure), a custom request priced
 * once the cloth is found, every extra at its figure, the lining prints, and
 * the two qualities the list does not price.
 *
 * Nothing leaves the machine: the clipboard is a list, links are caught
 * before they open, and any request at all is answered by a stub.
 */
const { app, BrowserWindow, shell, clipboard } = require('electron');
const shop = require('./fixtures/example-shop.js');
const dir = require('./fresh.js').freshUserData(app);
shop.seedExampleShop(dir);

const opened = [];
shell.openExternal = async (url) => { opened.push(String(url)); return true; };
shell.openPath = async (file) => { opened.push(String(file)); return ''; };
const copied = [];
clipboard.writeText = (text) => { copied.push(String(text)); };
global.fetch = async () => new Response(JSON.stringify({ error: { message: 'no network in this suite' } }), { status: 500 });

require('../electron/main.js');
const db = require('../electron/db.js');

let pass = 0, fail = 0;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (n) => `R${n.toLocaleString('en-US')}`;
// A figure as a pattern, for the checks that read it inside a longer text.
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const re = (strings, ...figures) => new RegExp(strings.raw.reduce((p, s, i) => p + esc(figures[i - 1]) + s));

// The shop's list, as the fixture gives it to the database. The suite reads
// the app against these figures, so a figure the app reads or shows wrong
// anywhere - Settings, a tile, a total, a quote - is caught.
const { GRID, ITEMS, OPTIONS, EXAMPLE_BUSINESS, suitFigure, suitTop } = shop;
const SUITS = { two_piece: '2-Piece', three_piece: '3-Piece', blazer_only: 'Single Blazer', pants_only: 'Single Pants', waistcoat_only: 'Single Waistcoat' };
// The qualities on the list, by the names the app gives them.
const QUALITIES = {
  standard_wool: 'Standard Wool Blend', premium_wool: 'Premium Wool Blend', super_fine: 'Super Fine Wool',
  italian: 'Italian Wool', luxury: 'Luxury Wool', material_supplied: 'Material Supplied',
};
const LIST = Object.fromEntries(Object.keys(GRID).map((quality) => [QUALITIES[quality] ?? quality,
  Object.fromEntries(Object.keys(SUITS).map((suit) => [suit, suitFigure(suit, quality)]))]));
const LUXURY_TOP = Object.fromEntries(Object.keys(SUITS).map((suit) => [suit, suitTop(suit, 'luxury')]));
const fig = suitFigure;
const DEPOSIT = EXAMPLE_BUSINESS.depositFraction;

// The options each check orders, at the list's figure.
const DOUBLE = OPTIONS['breast:double'];        // on the jacket
const WC_DOUBLE = OPTIONS['wcBreast:double'];   // on the waistcoat
const TIE = OPTIONS['neckwearType:tie'];        // with its pocket square
const BOW = OPTIONS['neckwearType:bow'];
const SATIN = OPTIONS['tuxedoFinish:satin'];
const VINYL = OPTIONS['liningMode:vinyl'];
const DIGITAL = OPTIONS['liningMode:pattern'];  // in the blazer
const BOTH = OPTIONS['customLiningScope:jacket_waistcoat'];

// Figures the suite types in itself, as the shop would. Made up, like the
// fixture's, and none of them on its list.
const SENT = 2390;    // a suit with no quality, priced by hand on the informal quote
const AGREED = 2340;  // an order fixed before the qualities were priced
const CLOTH = 4870;   // the luxury cloth's own figure, inside the 2-piece range

app.whenReady().then(async () => {
  await wait(2400);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c);

  const HELPERS = `
    window.T = {
      wait: (ms) => new Promise(r => setTimeout(r, ms)),
      byText: (sel, text) => [...document.querySelectorAll(sel)].find(e => e.textContent.trim().startsWith(text)),
      field: (name, root = document) => [...root.querySelectorAll('.field')].find(f => f.querySelector('label')?.textContent.trim() === name),
      tiles: (name) => [...(T.field(name)?.querySelectorAll('.option:not(.option-add)') ?? [])].map(o => ({
        label: o.querySelector('.option-label')?.textContent.trim() ?? '',
        desc: o.querySelector('.option-desc')?.textContent.trim() ?? '',
        price: o.querySelector('.option-price')?.textContent.trim() ?? '',
      })),
      // A switch's own words: its description, then its price.
      toggle: (id) => [...(document.getElementById('toggle-' + id)?.closest('.toggle-row')?.querySelectorAll('.tiny.faint') ?? [])]
        .map(d => d.textContent.trim()),
      type: (input, value) => {
        const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      },
      leave: (input) => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
      total: () => document.querySelector('.price-total')?.textContent.trim() ?? '',
      // The informal quote's figures, by line, as the shop sees them to change.
      figures: () => Object.fromEntries([...document.querySelectorAll('.modal .informal-amount')]
        .filter(i => i.getAttribute('aria-label') !== 'Its amount - negative for a discount')
        .map(i => [i.getAttribute('aria-label'), Number(i.value)])),
      modal: () => ({
        message: document.querySelector('.modal .informal-message')?.textContent ?? '',
        text: document.querySelector('.modal')?.innerText ?? '',
        grid: document.querySelector('.modal .compare-grid')?.innerText ?? '',
      }),
    };
    true;`;
  const reload = async () => { win.webContents.reload(); await wait(2200); await js(HELPERS); };
  const openOrder = async (name, step) => {
    await reload();
    await js(`(async () => {
      T.byText('.nav-item', 'Orders').click(); await T.wait(700);
      T.byText('.step-tab', 'Current')?.click(); await T.wait(300);
      [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes(${JSON.stringify(name)})).click(); await T.wait(1100);
      ${step ? `[...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes(${JSON.stringify(step)})).click(); await T.wait(900);` : ''}
      return true;
    })()`);
  };
  const read = (code) => js(`(async () => JSON.stringify(await (async () => { ${code} })()))()`).then(JSON.parse);
  const content = () => js(`document.querySelector('.content').innerText`);
  const openInformal = () => read(`
    (T.byText('button', 'Send informal quote') || T.byText('button', 'Send again')).click(); await T.wait(1450);
    return { ...T.modal(), figures: T.figures() };`);

  // A section that cannot finish - a page or a box that is not there - is a
  // failure, and the next one still runs, so no change hides behind another.
  let ui, summary;
  const section = async (title, body, after) => {
    log(`\n=== ${title} ===`);
    try { await body(); } catch (e) { fail++; log('  ✗ FAIL: the section stopped:', String(e.message).split('\n')[0]); }
    finally { if (after) await after(); }
  };

  /* ----------------------------------------------------------------- orders */
  const client = db.upsertClient({ name: 'Thabo', surname: 'Mokoena', contact: '082 555 1234', email: 'thabo@example.com' });
  const order = db.createProject({ clientId: client, title: 'Matric dance' });
  const suit = db.primarySuitId(order);
  const setSpec = (spec) => db.updateSuit(suit, { spec });
  const specNow = () => db.getProject(order).suits[0].spec;
  setSpec({ suitType: 'two_piece' });

  await section('the price list in Settings is the shop\'s list', async () => {
    await reload();
    ui = await read(`
      T.byText('.nav-item', 'Settings').click(); await T.wait(900);
      T.byText('.step-tab', 'Price list').click(); await T.wait(700);
      const box = (q, s) => document.querySelector('input[aria-label="' + q + ', ' + s + '"]');
      const cell = (q, s) => {
        const b = box(q, s);
        return b ? { placeholder: b.placeholder, note: b.closest('td')?.querySelector('.tiny.faint')?.textContent.trim() ?? '' } : null;
      };
      const out = {};
      for (const q of ${JSON.stringify([...Object.keys(LIST), 'Premium Italian Wool', 'Linen', 'Custom Request'])}) {
        out[q] = {};
        for (const s of ${JSON.stringify(Object.values(SUITS))}) out[q][s] = cell(q, s);
      }
      return out;`);
    const wrong = [];
    for (const [quality, row] of Object.entries(LIST)) {
      for (const [key, amount] of Object.entries(row)) {
        const c = ui[quality]?.[SUITS[key]];
        if (c?.placeholder !== String(amount)) wrong.push(`${quality} ${SUITS[key]}: ${c?.placeholder} not ${amount}`);
      }
    }
    check(wrong.length === 0, 'every quality and suit type the shop priced starts at its figure', wrong.join('; '));
    const tops = Object.entries(LUXURY_TOP).map(([key, top]) => ui['Luxury Wool']?.[SUITS[key]]?.note === `to ${rand(top)}`);
    check(tops.every(Boolean), 'luxury wool shows the top of its range under each box',
      JSON.stringify(Object.values(ui['Luxury Wool'] ?? {}).map((c) => c?.note)));
    check(Object.values(ui['Standard Wool Blend'] ?? {}).every((c) => c && c.note === ''), 'and a quality with one price shows no range');
    check(['Premium Italian Wool', 'Linen'].every((q) => Object.values(ui[q] ?? {}).every((c) => c?.placeholder === 'to price')),
      'Premium Italian Wool and Linen, not on the list, are still to price', JSON.stringify([ui['Premium Italian Wool'], ui.Linen]));
    check(Object.values(ui['Custom Request'] ?? {}).every((c) => c === null), 'a custom request has no row: it is priced as the cloth found');
  });

  await section('the quality sets the price of each suit type', async () => {
    const cases = [
      ['blazer_only', 'standard_wool'], ['pants_only', 'standard_wool'], ['waistcoat_only', 'premium_wool'],
      ['two_piece', 'super_fine'], ['three_piece', 'italian'], ['pants_only', 'italian'],
      ['blazer_only', 'material_supplied'], ['three_piece', 'material_supplied'],
    ].map(([suitType, material]) => [suitType, material, fig(suitType, material)]);
    for (const [suitType, material, amount] of cases) {
      setSpec({ suitType, material });
      await openOrder('Thabo', 'Base Garment');
      const total = await js('T.total()');
      check(total === rand(amount), `${SUITS[suitType]} in ${material.replace(/_/g, ' ')}: ${rand(amount)}`, total);
    }
    setSpec({ suitType: 'two_piece' });
    await openOrder('Thabo', 'Base Garment');
    ui = await read(`return { tiles: T.tiles('Material Quality'), total: T.total() };`);
    const tile = (label) => ui.tiles.find((t) => t.label === label) ?? {};
    const supplied = rand(fig('two_piece', 'material_supplied'));
    check(tile('Material Supplied').price === `2-Piece ${supplied}` && tile('Material Supplied').desc === 'The client\'s own cloth',
      `Material Supplied is a quality, at ${supplied} for a 2-piece`, JSON.stringify(tile('Material Supplied')));
    check(tile('Super Fine Wool').price === `2-Piece ${rand(fig('two_piece', 'super_fine'))}`
      && tile('Italian Wool').price === `2-Piece ${rand(fig('two_piece', 'italian'))}`,
      'Super Fine and Italian now carry their figures', JSON.stringify(ui.tiles.map((t) => t.price)));
    check(tile('Premium Italian Wool').price === 'Price to confirm' && tile('Linen').price === 'Price to confirm',
      'the two the list leaves out still say the price is to confirm', JSON.stringify(ui.tiles.map((t) => t.price)));
  });

  // Choosing the suit type does not set the price - the material does. With
  // no quality there is no price, and no quote goes.
  const client3 = db.upsertClient({ name: 'Sipho', surname: 'Ndlovu', contact: '082 555 6789', email: 'sipho@example.com' });
  const order3 = db.createProject({ clientId: client3, title: 'Graduation' });
  const setSpec3 = (spec) => db.updateSuit(db.primarySuitId(order3), { spec });
  const client4 = db.upsertClient({ name: 'Zanele', surname: 'Mthembu', contact: '082 555 9876', email: 'zanele@example.com' });
  const order4 = db.createProject({ clientId: client4, title: 'Year-end function' });
  const setSpec4 = (spec) => db.updateSuit(db.primarySuitId(order4), { spec });
  const priceNote = `document.querySelector('.price-unpriced')?.textContent.trim() ?? ''`;
  // Whether each way of sending is off: the email (labelled by how it goes), WhatsApp, the copy.
  const sendButtons = `({ email: document.querySelector('.modal .btn-gold')?.disabled ?? null,
    whatsapp: T.byText('.modal button', 'Send by WhatsApp')?.disabled ?? null, copy: T.byText('.modal button', 'Copy message')?.disabled ?? null })`;
  // The status as the Database list moves it, which fixes the quote there.
  const statusFromList = (name, status) => read(`
    T.byText('.nav-item', 'Database').click(); await T.wait(1100);
    const select = [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes(${JSON.stringify(name)}))
      ?.querySelector('select[aria-label="Status"]');
    if (!select) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(status)});
    select.dispatchEvent(new Event('change', { bubbles: true })); await T.wait(1500);
    return true;`);

  await section('the suit type has no price of its own: the material quality sets it', async () => {
    setSpec3({ suitType: 'two_piece', breast: 'double' });
    await openOrder('Sipho', 'Base Garment');
    ui = await read(`return { suits: T.tiles('Suit Type'), total: T.total(), note: ${priceNote} };`);
    check(ui.suits.length >= 5 && ui.suits.every((t) => t.price === ''), 'with no quality chosen, no suit type shows a figure', JSON.stringify(ui.suits));
    check(ui.total === rand(DOUBLE), 'the running total is only what goes with the suit - the double breasted jacket', ui.total);
    check(ui.note === 'The suit has no price until its quality is chosen', 'and it says the suit has no price yet', JSON.stringify(ui.note));

    await openOrder('Sipho', 'Summary');
    ui = await read(`
      const b = T.byText('button', 'Email the formal quote');
      return { text: document.querySelector('.content').innerText, disabled: !!b?.disabled, title: b?.title ?? '' };`);
    check(/2-Piece suit: no material quality is chosen, and the quality sets the suit's price/.test(ui.text.replace(/\s+/g, ' ')),
      'the summary says the quality sets the suit\'s price', ui.text.slice(0, 800));
    check(/2-Piece suit\s+No price yet/.test(ui.text) && !/2-Piece suit\s+R0/.test(ui.text), 'the suit is "no price yet", not R0', ui.text.slice(0, 800));
    check(ui.disabled && ui.title === 'The suit has no price yet', 'and the formal quote cannot be emailed', JSON.stringify({ disabled: ui.disabled, title: ui.title }));

    ui = await read(`
      (T.byText('button', 'Send informal quote') || T.byText('button', 'Send again')).click(); await T.wait(1450);
      const box = document.querySelector('.modal input[aria-label="2-Piece suit"]');
      const before = { value: box?.value ?? null, placeholder: box?.placeholder ?? '', buttons: ${sendButtons}, text: T.modal().text };
      if (box) { T.type(box, '${SENT}'); await T.wait(500); }
      return { before, after: { buttons: ${sendButtons}, message: T.modal().message, text: T.modal().text } };`);
    check(ui.before.value === '' && ui.before.placeholder === 'Its price', 'the informal quote starts the suit blank, for the shop\'s figure', JSON.stringify(ui.before));
    check(Object.values(ui.before.buttons).every((d) => d === true), 'and nothing can be sent while the suit has no figure', JSON.stringify(ui.before.buttons));
    check(/no material quality is chosen, and the quality sets the suit's price/.test(ui.before.text.replace(/\s+/g, ' ')), 'it says why', ui.before.text.slice(0, 600));
    check(Object.values(ui.after.buttons).every((d) => d === false), 'with the shop\'s figure in, it can go', JSON.stringify(ui.after.buttons));
    check(re`2-Piece suit: ${rand(SENT)}`.test(ui.after.message) && re`Total: ${rand(SENT + DOUBLE)}`.test(ui.after.message),
      'at the figure put in', ui.after.message);
    check(!/no material quality is chosen/.test(ui.after.text), 'and the warning goes');
    await js(`(async () => { T.byText('.modal button', 'Copy message').click(); await T.wait(1500); return true; })()`);
    check(db.getProject(order3).informalQuote?.total === SENT + DOUBLE, 'it is recorded at the figure put in', JSON.stringify(db.getProject(order3).informalQuote?.total));

    await openOrder('Sipho', 'Summary');
    ui = await read(`
      const b = T.byText('button', 'Email the formal quote');
      return { text: document.querySelector('.content').innerText, disabled: !!b?.disabled };`);
    check(re`2-Piece suit\s+${rand(SENT)}`.test(ui.text) && !/no material quality is chosen/.test(ui.text) && !ui.disabled,
      'the figure sent prices the suit, so the formal quote can go', ui.text.slice(0, 800));
    check(await statusFromList('Sipho', 'quoted'), 'the Database list has the order');
    const fixed = db.getProject(order3);
    check(fixed.status === 'quoted' && fixed.quote?.total === SENT + DOUBLE, 'and moved out of draft, it is fixed at the figure sent', `${fixed.status} ${fixed.quote?.total}`);

    // Choosing the quality prices it from the list.
    setSpec3({ suitType: 'two_piece', breast: 'double', material: 'standard_wool' });
    db.setInformalQuote(order3, null);
    db.setQuote(order3, null);
    await openOrder('Sipho', 'Base Garment');
    ui = await read(`return { suits: T.tiles('Suit Type'), total: T.total(), note: ${priceNote} };`);
    const tile = (label) => ui.suits.find((t) => t.label === label)?.price;
    check(tile('2-Piece') === rand(fig('two_piece', 'standard_wool')) && tile('3-Piece') === rand(fig('three_piece', 'standard_wool'))
      && tile('Single Pants') === rand(fig('pants_only', 'standard_wool')),
      'with a quality chosen, each suit type shows its price in it', JSON.stringify(ui.suits));
    check(ui.total === rand(fig('two_piece', 'standard_wool') + DOUBLE) && ui.note === '', 'and the suit is priced by it', JSON.stringify(ui));
  });

  await section('a quality not priced yet leaves the suit unpriced, and nothing fixes or completes at R0', async () => {
    setSpec4({ suitType: 'three_piece', material: 'premium_italian' });
    await openOrder('Zanele', 'Base Garment');
    ui = await read(`return { suits: T.tiles('Suit Type'), total: T.total(), note: ${priceNote} };`);
    check(ui.suits.every((t) => t.price === 'Price to confirm'), 'in Premium Italian Wool every suit type is "price to confirm"', JSON.stringify(ui.suits));
    check(ui.total === 'R0' && ui.note !== '', 'with no figure in the total', JSON.stringify(ui));
    await openOrder('Zanele', 'Summary');
    summary = await content();
    check(/3-Piece suit - Premium Italian Wool: this quality has no price for this suit type yet/.test(summary.replace(/\s+/g, ' ')),
      'the summary says the quality has no price yet', summary.slice(0, 800));

    check(await statusFromList('Zanele', 'quoted'), 'the Database list has the order');
    let row = db.getProject(order4);
    check(row.status === 'quoted' && !row.quote, 'moved out of draft from the list, it is not fixed at R0', `${row.status} ${JSON.stringify(row.quote)}`);
    await openOrder('Zanele', 'Summary');
    row = db.getProject(order4);
    check(!row.quote, 'nor when the order is opened', JSON.stringify(row.quote));

    ui = await read(`
      const button = () => [...document.querySelectorAll('.topbar button')].find(b => /^Completed$|^Mark completed\\?$/.test(b.textContent.trim()));
      button()?.click(); await T.wait(200); button()?.click(); await T.wait(1200);
      return { toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent) };`);
    row = db.getProject(order4);
    check(row.status === 'quoted' && !row.quote, 'it cannot be completed with no price for the suit', `${row.status} ${JSON.stringify(row.quote)}`);
    check(ui.toasts.some((t) => /The suit has no price yet in its quality - set it in Settings > Price list/.test(t)),
      'and says why: its quality has no price on the list', JSON.stringify(ui.toasts));

    // With no quality chosen at all, the way to price it is to choose one.
    setSpec4({ suitType: 'three_piece' });
    await openOrder('Zanele', 'Summary');
    ui = await read(`
      const button = () => [...document.querySelectorAll('.topbar button')].find(b => /^Completed$|^Mark completed\\?$/.test(b.textContent.trim()));
      button()?.click(); await T.wait(200); button()?.click(); await T.wait(1200);
      return { toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent) };`);
    row = db.getProject(order4);
    check(row.status === 'quoted' && !row.quote, 'with no quality chosen it cannot be completed either', `${row.status} ${JSON.stringify(row.quote)}`);
    check(ui.toasts.some((t) => /The suit has no price yet - choose its material quality/.test(t)),
      'and it says to choose one', JSON.stringify(ui.toasts));

    setSpec4({ suitType: 'three_piece', material: 'standard_wool' });
    await openOrder('Zanele', 'Summary');
    row = db.getProject(order4);
    check(row.quote?.total === fig('three_piece', 'standard_wool'), 'once the quality has a price, opening the order fixes it at that', JSON.stringify(row.quote?.total));
  });

  await section('an order fixed before the qualities keeps its price', async () => {
    const client5 = db.upsertClient({ name: 'Kabelo', surname: 'Sithole', contact: '082 555 2468', email: 'kabelo@example.com' });
    const order5 = db.createProject({ clientId: client5, title: 'Wedding' });
    db.updateSuit(db.primarySuitId(order5), { spec: { suitType: 'two_piece' } });
    db.setQuote(order5, {
      lines: [{ group: 'Base', label: '2-Piece suit', amount: AGREED, key: 'suitType:two_piece' }],
      total: AGREED, currency: 'ZAR', status: 'quoted', at: '2026-10-01T09:00:00.000Z',
    });
    db.updateProject(order5, { status: 'quoted' });
    await openOrder('Kabelo', 'Summary');
    ui = await read(`return { text: document.querySelector('.content').innerText, total: T.total(), note: ${priceNote} };`);
    check(ui.total === rand(AGREED) && ui.note === '', 'the price bar shows what was agreed', JSON.stringify({ total: ui.total, note: ui.note }));
    check(re`2-Piece suit\s+${rand(AGREED)}`.test(ui.text) && !/no material quality is chosen/.test(ui.text), 'and so does the summary', ui.text.slice(0, 800));
    check(!/The price list has changed since this was agreed/.test(ui.text) && !/Re-quote at today's prices/.test(ui.text),
      'with no offer to re-quote it at no price for the suit', ui.text.slice(0, 800));
  });

  await section('in Settings, a suit type is priced only in the grid', async () => {
    await reload();
    ui = await read(`
      T.byText('.nav-item', 'Settings').click(); await T.wait(900);
      T.byText('.step-tab', 'Price list').click(); await T.wait(700);
      [...document.querySelectorAll('.collapsible-head')].find(h => h.textContent.includes('Base Garment'))?.click(); await T.wait(500);
      return [...document.querySelectorAll('.measure-row')].filter(r => r.textContent.trim().startsWith('Suit Type - '))
        .map(r => ({ text: r.innerText, inputs: r.querySelectorAll('input').length }));`);
    check(ui.length >= 5 && ui.every((r) => r.inputs === 0 && /Priced by its quality, in the grid above/.test(r.text)),
      'each suit type says it is priced by its quality, with no price of its own to set', JSON.stringify(ui));
  });

  await section('luxury wool is priced by the cloth: a range, charged from the bottom', async () => {
    const bottom = rand(fig('two_piece', 'luxury'));
    const top = rand(suitTop('two_piece', 'luxury'));
    setSpec({ suitType: 'two_piece' });
    await openOrder('Thabo', 'Base Garment');
    ui = await read(`return { tiles: T.tiles('Material Quality') };`);
    const lux = ui.tiles.find((t) => t.label === 'Luxury Wool') ?? {};
    check(lux.price === `2-Piece ${bottom} - ${top}` && lux.desc === 'Priced by the cloth', 'its tile shows the whole range', JSON.stringify(lux));

    setSpec({ suitType: 'two_piece', material: 'luxury' });
    await openOrder('Thabo', 'Base Garment');
    ui = await read(`return { suits: T.tiles('Suit Type'), total: T.total() };`);
    check(ui.total === bottom, 'the order is charged the bottom of it', ui.total);
    const three = ui.suits.find((t) => t.label === '3-Piece')?.price ?? '';
    const pants = ui.suits.find((t) => t.label === 'Single Pants')?.price ?? '';
    check(re`${rand(fig('three_piece', 'luxury'))} - ${rand(suitTop('three_piece', 'luxury'))}`.test(three)
      && re`${rand(fig('pants_only', 'luxury'))} - ${rand(suitTop('pants_only', 'luxury'))}`.test(pants),
      'and each suit type shows its range in luxury', JSON.stringify(ui.suits));

    await openOrder('Thabo', 'Summary');
    summary = await content();
    check(re`2-Piece suit - Luxury Wool, ${bottom} to ${top}: priced by the cloth, and charged at the lowest`.test(summary),
      'the summary says it is charged at the lowest until the shop puts in the cloth\'s figure', summary.slice(0, 600));
    check(!/no price for this suit type yet/.test(summary), 'and does not call it unpriced');

    ui = await openInformal();
    check(ui.figures['2-Piece suit - Luxury Wool'] === fig('two_piece', 'luxury'), 'the informal quote starts at the bottom of the range', JSON.stringify(ui.figures));
    check(re`2-Piece suit - Luxury Wool: from ${bottom}`.test(ui.message) && re`Total: from ${bottom}`.test(ui.message)
      && re`Deposit to start \(${DEPOSIT * 100}%\): from ${rand(fig('two_piece', 'luxury') * DEPOSIT)}`.test(ui.message),
      'and the message says "from", in the line, the total and the deposit', ui.message);
    check(/priced by the cloth, so the message says "from" until you put the\s+cloth's own figure below/.test(ui.text), 'with a note saying why');
    // The 3-piece in luxury is a range; the 2-piece in Italian wool is one price.
    const other = rand(fig('two_piece', 'italian'));
    check(re`from ${rand(fig('three_piece', 'luxury'))}`.test(ui.grid) && ui.grid.includes(other) && !ui.grid.includes(`from ${other}`),
      'a luxury option to compare says "from" as well, the others do not', ui.grid);

    // Sent at the bottom of the range, it is still only "from".
    const before = copied.length;
    await js(`(async () => { T.byText('.modal button', 'Copy message').click(); await T.wait(1500); return true; })()`);
    check(copied.length === before + 1 && re`Total: from ${bottom}`.test(copied.at(-1) ?? ''), 'copied as shown', copied.at(-1)?.slice(0, 200));
    check(db.getProject(order).informalQuote?.total === fig('two_piece', 'luxury'), 'and recorded', JSON.stringify(db.getProject(order).informalQuote?.total));
    await openOrder('Thabo', 'Summary');
    summary = await content();
    check(re`Luxury Wool, ${bottom} to ${top}: priced by the cloth`.test(summary),
      'sent at the lowest figure, the summary still asks for the cloth\'s price', summary.slice(0, 600));

    // The shop finds the cloth and puts its figure in.
    ui = await openInformal();
    check(re`Total: from ${bottom}`.test(ui.message), 'sent again, it starts from what was sent, still "from"', ui.message);
    ui = await read(`
      T.type(document.querySelector('.modal input[aria-label="2-Piece suit - Luxury Wool"]'), '${CLOTH}'); await T.wait(400);
      return T.modal();`);
    check(re`2-Piece suit - Luxury Wool: ${rand(CLOTH)}`.test(ui.message) && re`Total: ${rand(CLOTH)}`.test(ui.message) && !/from R/.test(ui.message),
      'the shop\'s figure for the cloth is a price, with no "from" anywhere', ui.message);
    check(!/priced by the cloth, so the message says/.test(ui.text), 'and the note goes');
    await js(`(async () => { T.byText('.modal button', 'Copy message').click(); await T.wait(1500); return true; })()`);
    check(db.getProject(order).informalQuote?.total === CLOTH, 'it is recorded at the cloth\'s figure', JSON.stringify(db.getProject(order).informalQuote?.total));
    await openOrder('Thabo', 'Summary');
    summary = await content();
    check(!/priced by the cloth, and charged at the lowest/.test(summary) && summary.includes(rand(CLOTH)),
      'and the summary is at the cloth\'s figure, with nothing left to ask', summary.slice(0, 600));
  });

  // A fresh order, so the quotes sent above do not stand in for the list.
  const client2 = db.upsertClient({ name: 'Lerato', surname: 'Khumalo', contact: '082 555 4321', email: 'lerato@example.com' });
  const order2 = db.createProject({ clientId: client2, title: 'Wedding' });
  const suit2 = db.primarySuitId(order2);
  const setSpec2 = (spec) => db.updateSuit(suit2, { spec });
  const spec2 = () => db.getProject(order2).suits[0].spec;

  await section('a custom request is quoted once the cloth is found', async () => {
    setSpec2({ suitType: 'two_piece' });
    await openOrder('Lerato', 'Base Garment');
    ui = await read(`return { tiles: T.tiles('Material Quality') };`);
    const tile = ui.tiles.find((t) => t.label === 'Custom Request') ?? {};
    check(tile.desc === 'Quoted once the material is found' && tile.price === 'Price to confirm', 'its tile says so, with no figure', JSON.stringify(tile));
    setSpec2({ suitType: 'two_piece', material: 'custom_request' });
    await openOrder('Lerato', 'Summary');
    summary = await content();
    check(/2-Piece suit - Custom Request: a custom request is priced\s+as the quality of the cloth that is found/.test(summary),
      'the summary says to choose the quality once the cloth is found', summary.slice(0, 600));
    check(!/no price for this suit type yet/.test(summary), 'not that the quality needs a price in Settings');
    ui = await openInformal();
    check(!/Custom Request 2-Piece/.test(ui.grid) && /Standard Wool Blend/.test(ui.grid), 'it is not one of the options to compare', ui.grid);
    check(/a custom request is priced as the quality of the cloth\s+found/i.test(ui.text), 'and the informal quote says the same', ui.text.slice(0, 500));
    ui = await read(`return { buttons: ${sendButtons}, value: document.querySelector('.modal input[aria-label="2-Piece suit - Custom Request"]')?.value ?? null };`);
    check(ui.value === '' && Object.values(ui.buttons).every((d) => d === true), 'until the cloth is found it has no figure, and no quote goes', JSON.stringify(ui));
  });

  await section('every extra on the list, at the shop\'s figure', async () => {
    setSpec2({ suitType: 'two_piece' });
    await openOrder('Lerato', 'Base Garment');
    ui = await read(`return Object.fromEntries(['shirt', 'coat', 'express', 'lapelPin', 'lapelChain', 'tiePin', 'cufflinks', 'cufflinkSet']
      .map(id => [id, T.toggle(id)]));`);
    const words = (id) => (ui[id] ?? []).join(' | ');
    const item = (id) => rand(ITEMS[id]);
    check(words('shirt') === `Tailored, Egyptian cotton | From ${item('shirt')}`, `a tailored Egyptian cotton shirt, from ${item('shirt')}`, words('shirt'));
    check(words('coat') === `Priced by the material | From ${item('coat')}`, `a custom coat, from ${item('coat')}`, words('coat'));
    check(words('express') === `Made in a week or less | +${item('express')}`, `express, a week or less, ${item('express')}`, words('express'));
    check(words('lapelPin') === `+${item('lapelPin')}` && words('lapelChain') === `+${item('lapelChain')}`,
      `a lapel pin ${item('lapelPin')}, a lapel chain ${item('lapelChain')}`, `${words('lapelPin')} ${words('lapelChain')}`);
    check(words('tiePin') === `A bar | From ${item('tiePin')}` && words('cufflinks') === `A pair | From ${item('cufflinks')}`,
      `a tie pin from ${item('tiePin')} a bar, cuff links from ${item('cufflinks')} a pair`, `${words('tiePin')} ${words('cufflinks')}`);
    check(words('cufflinkSet') === `Matching, in a box | +${item('cufflinkSet')}`, `the matching set, boxed, ${item('cufflinkSet')}`, words('cufflinkSet'));
    const coatBefore = await js(`!!T.field('Coat details')`);
    check(!coatBefore, 'the coat asks nothing until it is chosen');

    setSpec2({
      suitType: 'two_piece', material: 'standard_wool', shirt: true, coat: true, neckwear: true, neckwearType: 'bow', pocketSquare: 'different',
      lapelPin: true, lapelChain: true, tiePin: true, cufflinks: true, cufflinkSet: true, express: true,
      tuxedoFinish: 'satin', breast: 'double', liningMode: 'vinyl',
    });
    await openOrder('Lerato', 'Base Garment');
    ui = await read(`
      const box = T.field('Coat details')?.querySelector('textarea');
      if (box) { T.type(box, 'Charcoal, knee length, horn buttons'); await T.wait(100); T.leave(box); await T.wait(1200); }
      return { box: !!box, placeholder: box?.placeholder ?? '' };`);
    check(ui.box && /Colour, length, button style, finishing/.test(ui.placeholder), 'chosen, the coat asks for its colour, length, buttons and finish', JSON.stringify(ui));
    check(spec2().coatDetails === 'Charcoal, knee length, horn buttons', 'and what is typed is kept', JSON.stringify(spec2().coatDetails));
    await openOrder('Lerato', 'Summary');
    summary = await content();
    check(/Coat details\s+Charcoal, knee length, horn buttons/.test(summary), 'and is on the summary, for the workshop', summary.slice(0, 800));

    await openOrder('Lerato', 'Summary');
    ui = await openInformal();
    const want = {
      '2-Piece suit - Standard Wool Blend': fig('two_piece', 'standard_wool'),
      Shirt: ITEMS.shirt,
      'Custom Coat': ITEMS.coat,
      'Tie or bow tie: Bow Tie': BOW,
      'Lapel Chain': ITEMS.lapelChain,
      'Lapel Pin': ITEMS.lapelPin,
      'Tie Pin': ITEMS.tiePin,
      'Cuff Links': ITEMS.cufflinks,
      'Cuff Links & Tie Pin Set': ITEMS.cufflinkSet,
      Express: ITEMS.express,
      'Tuxedo Finish: Yes': SATIN,
      'Button Configuration: Double Breasted': DOUBLE,
      'Lining: Vinyl Print': VINYL,
    };
    const off = Object.entries(want).filter(([label, amount]) => ui.figures[label] !== amount).map(([label, amount]) => `${label}: ${ui.figures[label]} not ${amount}`);
    check(off.length === 0, 'each is charged at its figure', off.join('; ') + ' ' + JSON.stringify(ui.figures));
    const extra = Object.keys(ui.figures).filter((label) => !(label in want));
    check(extra.length === 0, `and nothing else - the pocket square is in the bow tie's ${rand(BOW)}`, extra.join(', '));
    const sum = Object.values(want).reduce((a, b) => a + b, 0);
    check(re`Total: ${rand(sum)}`.test(ui.message), `the total is ${rand(sum)}`, ui.message.match(/Total:[^\n]*/)?.[0]);

    // Double breasted is priced apart on a jacket and on a waistcoat, so a
    // 3-piece with both pays each.
    setSpec2({ suitType: 'three_piece', material: 'standard_wool', breast: 'double', wcBreast: 'double' });
    await openOrder('Lerato', 'Waistcoat');
    ui = await read(`return { tiles: T.tiles('Button Style'), total: T.total() };`);
    const wcDouble = ui.tiles.find((t) => t.label === 'Double Breasted') ?? {};
    check(wcDouble.price === `+${rand(WC_DOUBLE)}`, `a double breasted waistcoat is ${rand(WC_DOUBLE)}`, JSON.stringify(ui.tiles));
    check(ui.total === rand(fig('three_piece', 'standard_wool') + DOUBLE + WC_DOUBLE),
      `so a double breasted 3-piece is ${rand(DOUBLE)} on the jacket and ${rand(WC_DOUBLE)} on the waistcoat`, ui.total);

    setSpec2({ suitType: 'two_piece', material: 'standard_wool', neckwear: true, neckwearType: 'tie', pocketSquare: 'same' });
    await openOrder('Lerato', 'Base Garment');
    check(await js('T.total()') === rand(fig('two_piece', 'standard_wool') + TIE), `a tie and a pocket square to match, ${rand(TIE)} together`, await js('T.total()'));
  });

  await section('the lining prints', async () => {
    setSpec2({ suitType: 'three_piece', material: 'standard_wool', liningMode: 'colour' });
    await openOrder('Lerato', 'Lining');
    ui = await read(`return { tiles: T.tiles('Lining'), text: !!T.field('Lining text') };`);
    const tile = (label) => ui.tiles.find((t) => t.label === label) ?? {};
    check(tile('Standard').price === '' && tile('Vinyl Print').price === `+${rand(VINYL)}` && tile('Digital Print').price === `+${rand(DIGITAL)}`,
      `standard, a vinyl print ${rand(VINYL)}, a digital print ${rand(DIGITAL)}`, JSON.stringify(ui.tiles));
    check(/inside the blazer on both sides/.test(tile('Vinyl Print').desc), 'the vinyl print is custom text inside the blazer', tile('Vinyl Print').desc);
    check(!ui.text, 'a standard lining asks for no text');

    setSpec2({ suitType: 'three_piece', material: 'standard_wool', liningMode: 'vinyl' });
    await openOrder('Lerato', 'Lining');
    ui = await read(`
      const box = T.field('Lining text')?.querySelector('input');
      if (box) { T.type(box, 'T & L, 14.11.2026'); await T.wait(100); T.leave(box); await T.wait(1200); }
      return { box: !!box, max: box?.maxLength ?? null, total: T.total() };`);
    check(ui.box && ui.max === 200, 'a vinyl print asks for its text, a few words at most', JSON.stringify(ui));
    check(spec2().liningText === 'T & L, 14.11.2026', 'which is kept', JSON.stringify(spec2().liningText));
    const threePiece = fig('three_piece', 'standard_wool');
    check(ui.total === rand(threePiece + VINYL), `a standard wool 3-piece with a vinyl print is ${rand(threePiece + VINYL)}`, ui.total);
    await openOrder('Lerato', 'Summary');
    summary = await content();
    check(/Lining text\s+T & L, 14\.11\.2026/.test(summary), 'and the summary carries the words to print', summary.slice(summary.indexOf('Lining'), summary.indexOf('Lining') + 200));

    setSpec2({ suitType: 'three_piece', material: 'standard_wool', liningMode: 'pattern', customLiningScope: 'jacket' });
    await openOrder('Lerato', 'Lining');
    ui = await read(`return { scope: T.tiles('Custom lining goes in'), total: T.total() };`);
    check(ui.total === rand(threePiece + DIGITAL), `a digital print in the blazer, 2M, is ${rand(DIGITAL)}`, ui.total);
    const scope = (label) => ui.scope.find((t) => t.label === label) ?? {};
    check(scope('Jacket only').desc === '2M' && scope('Jacket and waistcoat').desc === '3M' && scope('Jacket and waistcoat').price === `+${rand(BOTH)}`,
      'the choice says how much print each takes', JSON.stringify(ui.scope));

    setSpec2({ suitType: 'three_piece', material: 'standard_wool', liningMode: 'pattern', customLiningScope: 'jacket_waistcoat' });
    await openOrder('Lerato', 'Lining');
    check(await js('T.total()') === rand(threePiece + DIGITAL + BOTH), `in the blazer and the waistcoat, 3M, it is ${rand(DIGITAL + BOTH)}`, await js('T.total()'));
  });

  check(opened.length === 0, 'and nothing was opened outside the app', JSON.stringify(opened));

  log(`\n${fail === 0 ? 'ALL PRICE LIST CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
