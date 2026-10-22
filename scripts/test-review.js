/**
 * GD's review of 20 October 2026, checked in the running app.
 *
 * Each block is one line of GD's list: the material quality on the base page
 * and the price it sets, the quality prices in Settings, the informal quote
 * on the summary with the choices and other options in it, an edit button on
 * every preset, the extras page showing what was chosen earlier, the
 * drawings, "Measurements taken", the Completed button and the completed
 * list, and a suit in two or three cloths.
 *
 * Nothing leaves the machine: WhatsApp links are caught before they open,
 * the clipboard is a list, and any request at all is answered by a stub - the
 * render prompt is read off the screen, never sent.
 */
const { app, BrowserWindow, shell, clipboard } = require('electron');
require('./fresh.js').freshUserData(app);

const opened = [];
shell.openExternal = async (url) => { opened.push(String(url)); return true; };
const copied = [];
clipboard.writeText = (text) => { copied.push(String(text)); };
const requests = [];
global.fetch = async (url) => {
  requests.push(String(url));
  return new Response(JSON.stringify({ error: { message: 'no network in this suite' } }), { status: 500 });
};

require('../electron/main.js');
const db = require('../electron/db.js');
const informal = require('../electron/informal.js');

let pass = 0, fail = 0;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  await wait(2400);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c);
  const call = (ch, arg) => js(`window.gd.${ch}(${JSON.stringify(arg)}).then(r => JSON.stringify(r.ok ? { data: r.data } : { error: r.error.message }))`).then(JSON.parse);

  const HELPERS = `
    window.T = {
      wait: (ms) => new Promise(r => setTimeout(r, ms)),
      byText: (sel, text) => [...document.querySelectorAll(sel)].find(e => e.textContent.trim().startsWith(text)),
      field: (name, root = document) => [...root.querySelectorAll('.field')].find(f => f.querySelector('label')?.textContent.trim() === name),
      tiles: (name) => [...(T.field(name)?.querySelectorAll('.option:not(.option-add)') ?? [])].map(o => ({
        label: o.querySelector('.option-label')?.textContent.trim() ?? '',
        desc: o.querySelector('.option-desc')?.textContent.trim() ?? '',
        price: o.querySelector('.option-price')?.textContent.trim() ?? '',
        svg: o.querySelector('svg.sketch')?.outerHTML ?? null,
      })),
      type: (input, value) => {
        const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      },
      leave: (input) => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
      total: () => document.querySelector('.price-total')?.textContent.trim() ?? '',
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
  const step = (name) => js(`(async () => {
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes(${JSON.stringify(name)})).click(); await T.wait(900); return true;
  })()`);
  const read = (code) => js(`(async () => JSON.stringify(await (async () => { ${code} })()))()`).then(JSON.parse);

  // One section per line of GD's list. A section that cannot finish - on code
  // without the feature, a page or a box that is not there - is a failure, and
  // the next one still runs, so no change is hidden behind another.
  let ui, summary;
  const section = async (title, body, after) => {
    log(`\n=== ${title} ===`);
    try { await body(); } catch (e) { fail++; log('  ✗ FAIL: the section stopped:', String(e.message).split('\n')[0]); }
    finally { if (after) await after(); }
  };

  /* ----------------------------------------------------------------- orders */
  const ayanda = db.upsertClient({ name: 'Ayanda', surname: 'Zulu', contact: '082 555 6666', email: 'ayanda@example.com' });
  const order = db.createProject({ clientId: ayanda, title: 'Year-end function' });
  const suit = db.primarySuitId(order);
  const setSpec = (spec) => db.updateSuit(suit, { spec });
  setSpec({ suitType: 'two_piece' });
  const specNow = () => db.getProject(order).suits[0].spec;
  const bongani = db.upsertClient({ name: 'Bongani', surname: 'Sithole', contact: '', email: '' });
  const paidOrder = db.createProject({ clientId: bongani, title: 'Graduation' });
  db.updateSuit(db.primarySuitId(paidOrder), { spec: { suitType: 'two_piece' } });
  db.addPayment({ project_id: paidOrder, kind: 'deposit', amount: 4500, paid_on: '', method: '', reference: '', note: '' });
  const kagiso = db.upsertClient({ name: 'Kagiso', surname: 'Molefe', contact: '', email: '' });
  const toneOrder = db.createProject({ clientId: kagiso, title: 'Wedding guest' });
  const toneSuit = db.primarySuitId(toneOrder);
  db.updateSuit(toneSuit, { spec: { suitType: 'three_piece' }, fabric_name: 'Navy', fabric_code: 'NV-1', supplier: 'Mill A' });

  await section('the pages, in GD\'s order', async () => {
    await openOrder('Ayanda');
    const tabs = await read(`return [...document.querySelectorAll('.step-tab')].map(t => t.textContent.replace(/^[\\d✓]+/, '').trim());`);
    check(tabs.indexOf('Lining & Stitching') === tabs.indexOf('Jacket') + 1, 'lining and stitching straight after the jacket', tabs.join(' > '));
    check(tabs.indexOf('Measurements') < tabs.indexOf('Photos & Cloth') && tabs.indexOf('Measurements') > tabs.indexOf('Extras'),
      'measurements once the suit is designed, before the camera comes out', tabs.join(' > '));
    check(tabs.indexOf('Photos & Cloth') < tabs.indexOf('Preview'), 'and both before the preview is rendered');
  });

  await section('the material quality, on the base page, sets the price', async () => {
    await openOrder('Ayanda', 'Base Garment');
    ui = await read(`return { tiles: T.tiles('Material Quality'), total: T.total() };`);
    check(JSON.stringify(ui.tiles.map((t) => t.label)) === JSON.stringify([
      'Standard Wool Blend', 'Premium Wool Blend', 'Super Fine Wool', 'Italian Wool', 'Premium Italian Wool', 'Luxury Wool', 'Linen',
    ]), 'the seven qualities GD listed, in order', JSON.stringify(ui.tiles.map((t) => t.label)));
    const tile = (label) => ui.tiles.find((t) => t.label === label) ?? {};
    check(tile('Standard Wool Blend').price === '2-Piece R3,950' && tile('Premium Wool Blend').price === '2-Piece R4,950',
      'each priced as the 2-piece on the order would be', JSON.stringify(ui.tiles.map((t) => t.price)));
    check(tile('Super Fine Wool').price === 'Price to confirm' && tile('Linen').price === 'Price to confirm',
      'the ones GD has not priced yet say so, not a figure', JSON.stringify(ui.tiles.map((t) => t.price)));
    check(ui.total === 'R4,500', 'with no quality chosen the suit costs what it always did', ui.total);

    ui = await read(`
      [...T.field('Material Quality').querySelectorAll('.option')].find(o => o.textContent.includes('Standard Wool Blend')).click();
      await T.wait(1400);
      return { total: T.total(), suitTiles: T.tiles('Suit Type') };`);
    check(specNow().material === 'standard_wool', 'choosing a quality is stored on the suit', JSON.stringify(specNow()));
    check(ui.total === 'R3,950', 'and a standard wool 2-piece is R3,950', ui.total);
    const threeTile = ui.suitTiles.find((t) => t.label === '3-Piece');
    check(!!threeTile && /R4,950/.test(threeTile.price), 'the suit types are shown at their price in that quality', JSON.stringify(ui.suitTiles.map((t) => [t.label, t.price])));

    setSpec({ suitType: 'three_piece', material: 'premium_wool' });
    await openOrder('Ayanda', 'Base Garment');
    check(await js('T.total()') === 'R5,950', 'a premium wool 3-piece is R5,950', await js('T.total()'));
    setSpec({ suitType: 'three_piece', material: 'standard_wool' });
    await openOrder('Ayanda', 'Base Garment');
    check(await js('T.total()') === 'R4,950', 'a standard wool 3-piece is R4,950', await js('T.total()'));

    setSpec({ suitType: 'two_piece', material: 'super_fine' });
    await openOrder('Ayanda', 'Base Garment');
    check(await js('T.total()') === 'R4,500', 'a quality not yet priced is charged at the suit type\'s price', await js('T.total()'));
    await step('Summary');
    summary = await js(`document.querySelector('.content').innerText`);
    check(/2-Piece suit - Super Fine Wool/.test(summary) && /no price for this suit type yet/.test(summary),
      'and the summary says the price is still to set, before a formal quote goes', summary.slice(0, 400));
  });

  await section('GD prices the rest in Settings', async () => {
    await reload();
    ui = await read(`
      T.byText('.nav-item', 'Settings').click(); await T.wait(900);
      T.byText('.step-tab', 'Price list').click(); await T.wait(700);
      const box = document.querySelector('input[aria-label="Super Fine Wool, 2-Piece"]');
      const shipped = document.querySelector('input[aria-label="Standard Wool Blend, 2-Piece"]')?.placeholder;
      if (box) { T.type(box, '6200'); await T.wait(100); T.leave(box); await T.wait(1200); }
      return { box: !!box, shipped, placeholder: box?.placeholder };`);
    check(ui.box && ui.placeholder === 'to price', 'every quality and suit type has a box, the unpriced ones marked', JSON.stringify(ui));
    check(ui.shipped === '3950', 'GD\'s own figures are there to start from', String(ui.shipped));
    check(db.getSetting('priceOverrides')?.['suitType:two_piece@super_fine'] === 6200, 'a figure typed is stored for that pair',
      JSON.stringify(db.getSetting('priceOverrides')));
    await openOrder('Ayanda', 'Base Garment');
    check(await js('T.total()') === 'R6,200', 'and the order is priced at it', await js('T.total()'));
    await step('Summary');
    summary = await js(`document.querySelector('.content').innerText`);
    check(!/no price for this suit type yet/.test(summary), 'with no warning left');

    // The window cannot price a garment at nonsense: a figure that is not a
    // number is ignored, and the suit is charged as if it were not set.
    const junk = await call('settings.set', { key: 'priceOverrides', value: { 'suitType:two_piece@super_fine': 'free' } });
    await openOrder('Ayanda', 'Base Garment');
    check(await js('T.total()') === 'R4,500', 'a price that is not a number is not used', JSON.stringify(junk) + ' ' + await js('T.total()'));
  }, async () => {
    await call('settings.set', { key: 'priceOverrides', value: {} });
  });

  await section('the informal quote is on the summary, with the whole summary in it', async () => {
    setSpec({ suitType: 'two_piece', material: 'standard_wool', lapel: 'peak', liningCode: 'LN 1116' });
    // R3,950 + R250 for the peak lapel.
    await openOrder('Ayanda', 'Order');
    const onOrder = await js(`!![...document.querySelectorAll('.card-head h3')].find(h => h.textContent === 'Informal quote')`);
    check(!onOrder, 'it is no longer on the order page');
    await step('Summary');
    ui = await read(`
      const card = !![...document.querySelectorAll('.card-head h3')].find(h => h.textContent === 'Informal quote');
      T.byText('button', 'Send informal quote').click(); await T.wait(1400);
      const m = document.querySelector('.modal');
      return {
        card,
        message: m?.querySelector('.informal-message')?.textContent ?? '',
        premium: !!m?.querySelector('input[aria-label="Premium Wool Blend 2-Piece"]'),
        threePiece: !!m?.querySelector('input[aria-label="Standard Wool Blend 3-Piece"]'),
        unpriced: !!m?.querySelector('input[aria-label="Super Fine Wool 2-Piece"]'),
        grid: m?.querySelector('.compare-grid')?.innerText ?? '',
      };`);
    check(ui.card, 'it is on the summary page, beside the formal quote');
    check(/Total: R4,200/.test(ui.message), 'the figures are as before', ui.message.slice(0, 300));
    check(/Your choices/.test(ui.message) && /Base Garment - [^\n]*Standard Wool Blend/.test(ui.message) && /Jacket - [^\n]*Peak/.test(ui.message),
      'and it lists what was chosen, page by page', ui.message);
    check(!/LN 1116/.test(ui.message), 'without the shop\'s own cloth and lining codes');
    check(ui.premium && ui.threePiece, 'the order can be priced in another quality or suit type beside it', ui.grid);
    check(!ui.unpriced && /No price yet/.test(ui.grid), 'but not in one with no price yet', ui.grid);

    ui = await read(`
      document.querySelector('.modal input[aria-label="Premium Wool Blend 2-Piece"]').click(); await T.wait(200);
      document.querySelector('.modal input[aria-label="Standard Wool Blend 3-Piece"]').click(); await T.wait(300);
      return { message: document.querySelector('.modal .informal-message').textContent };`);
    check(/Other options, everything else as above/.test(ui.message), 'ticked, they go in the message under the total', ui.message);
    check(/Premium Wool Blend 2-Piece: R5,200/.test(ui.message) && /Standard Wool Blend 3-Piece: R5,200/.test(ui.message),
      'each at its whole price, the lapel and all', ui.message);
    check(/Total: R4,200/.test(ui.message), 'and the quote itself is unchanged by them');
    const quoted = ui.message;

    const beforeWa = opened.length;
    await js(`(async () => { T.byText('.modal button', 'Send by WhatsApp').click(); await T.wait(1500); return true; })()`);
    const wa = opened.slice(beforeWa).find((u) => u.startsWith('https://wa.me/')) ?? '';
    check(wa.startsWith('https://wa.me/27825556666?text=') && decodeURIComponent(wa.split('?text=')[1] ?? '') === quoted,
      'WhatsApp carries all of it, word for word', wa.slice(0, 80));
    check(db.getProject(order).informalQuote?.total === 4200, 'and the quote recorded is the order\'s, not an option\'s',
      String(db.getProject(order).informalQuote?.total));

  });

  await section('a message too long for a WhatsApp link goes by the clipboard', async () => {
    const line = [{ label: 'Suit', amount: 100, key: 'x' }];
    const long = `Your choices\n${'Jacket - Lapel: Peak · '.repeat(450)}Total: R4,200`;
    const beforeLong = opened.length;
    const sent = await call('informal.send', { projectId: order, via: 'whatsapp', text: long, lines: line, basis: [] });
    check(sent.data?.copied === true && copied.at(-1) === long, 'the whole message is put on the clipboard', JSON.stringify(sent).slice(0, 160));
    check(opened.slice(beforeLong).length === 1 && opened.at(-1) === 'https://wa.me/27825556666',
      'and WhatsApp opens on the client\'s chat, empty, to paste it into', JSON.stringify(opened.slice(beforeLong)));
    const short = await call('informal.send', { projectId: order, via: 'whatsapp', text: 'hello', lines: line, basis: [] });
    check(!short.data?.copied && opened.at(-1) === 'https://wa.me/27825556666?text=hello', 'a short one is still written into the link',
      JSON.stringify(short) + ' ' + opened.at(-1));
    check(informal.whatsappUrl('27825556666', '') === 'https://wa.me/27825556666', 'no text means no empty ?text= on the link');
    const tooLong = await call('informal.send', { projectId: order, via: 'whatsapp', text: 'x'.repeat(32001), lines: line, basis: [] });
    check(!!tooLong.error, 'there is still a limit', JSON.stringify(tooLong).slice(0, 120));
  });

  await section('every preset can be edited where it is chosen', async () => {
    setSpec({ suitType: 'two_piece', material: 'standard_wool', lapel: 'peak' });
    await openOrder('Ayanda', 'Jacket');
    ui = await read(`
      const notch = [...T.field('Lapel').querySelectorAll('.option')].find(o => o.querySelector('.option-label')?.textContent.trim() === 'Notch');
      const edit = notch?.querySelector('.option-edit');
      edit?.click(); await T.wait(500);
      const title = document.querySelector('.modal')?.innerText.split(String.fromCharCode(10))[0] ?? '';
      if (document.querySelector('#builtin-name')) {
        T.type(document.querySelector('#builtin-name'), 'Notch lapel');
        T.type(document.querySelector('#builtin-note'), 'The classic');
        T.type(document.querySelector('#builtin-price'), '120');
        await T.wait(100);
        T.byText('.modal button', 'Save').click(); await T.wait(1500);
      }
      return { edit: !!edit, aria: edit?.getAttribute('aria-label'), title, tiles: T.tiles('Lapel') };`);
    check(ui.edit && ui.aria === 'Edit Notch', 'a built-in option has an edit button', JSON.stringify(ui).slice(0, 200));
    check(/Edit "Notch"/.test(ui.title), 'which opens its words and price', ui.title);
    check(specNow().lapel === 'peak', 'pressing edit does not choose the option', specNow().lapel);
    check(JSON.stringify(db.getSetting('labelOverrides')?.['lapel:notch']) === JSON.stringify({ label: 'Notch lapel', desc: 'The classic' }),
      'the new words are stored, under the key Settings uses', JSON.stringify(db.getSetting('labelOverrides')));
    check(db.getSetting('priceOverrides')?.['lapel:notch'] === 120, 'and the new price', JSON.stringify(db.getSetting('priceOverrides')));
    const renamed = ui.tiles.find((t) => t.label === 'Notch lapel');
    check(!!renamed && renamed.desc === 'The classic' && renamed.price === '+R120', 'the tile shows them straight away', JSON.stringify(ui.tiles));

    ui = await read(`
      const notch = [...T.field('Lapel').querySelectorAll('.option')].find(o => o.querySelector('.option-label')?.textContent.trim() === 'Notch lapel');
      notch.querySelector('.option-edit').click(); await T.wait(500);
      T.type(document.querySelector('#builtin-price'), '-5'); await T.wait(100);
      T.byText('.modal button', 'Save').click(); await T.wait(1000);
      const stillOpen = !!document.querySelector('.modal #builtin-price');
      T.byText('.modal button', 'Use the built-in wording')?.click(); await T.wait(1500);
      return { stillOpen, tiles: T.tiles('Lapel') };`);
    check(ui.stillOpen && db.getSetting('priceOverrides')?.['lapel:notch'] === 120, 'a negative price is refused, and nothing is changed',
      JSON.stringify(db.getSetting('priceOverrides')));
    check(!db.getSetting('labelOverrides')?.['lapel:notch'] && ui.tiles.some((t) => t.label === 'Notch'), 'the built-in words can be put back',
      JSON.stringify(db.getSetting('labelOverrides')));

    // A switch: its name, its note and its price.
    await step('Base Garment');
    ui = await read(`
      const edit = document.querySelector('[aria-label="Edit Shirt"]');
      edit?.click(); await T.wait(500);
      if (document.querySelector('#builtin-name')) {
        T.type(document.querySelector('#builtin-name'), 'Dress shirt');
        T.type(document.querySelector('#builtin-note'), 'Made to measure');
        T.type(document.querySelector('#builtin-price'), '900');
        await T.wait(100);
        T.byText('.modal button', 'Save').click(); await T.wait(1500);
      }
      const row = [...document.querySelectorAll('.toggle-row')].find(r => r.querySelector('label[for="toggle-shirt"]'));
      return { edit: !!edit, row: row?.innerText ?? '' };`);
    check(ui.edit, 'a switch has one too');
    check(JSON.stringify(db.getSetting('labelOverrides')?.shirt) === JSON.stringify({ label: 'Dress shirt', desc: 'Made to measure' })
      && db.getSetting('priceOverrides')?.shirt === 900, 'its words and price are stored',
      JSON.stringify([db.getSetting('labelOverrides')?.shirt, db.getSetting('priceOverrides')?.shirt]));
    check(/Dress shirt/.test(ui.row) && /Made to measure/.test(ui.row) && /R900/.test(ui.row), 'and shown on the switch', ui.row);
    check(!specNow().shirt, 'editing it does not switch it on');
    const overlong = await call('settings.set', { key: 'labelOverrides', value: { shirt: { label: 'x'.repeat(121) } } });
    check(!!overlong.error, 'a name longer than a label can be is refused by the app, not just the box', JSON.stringify(overlong).slice(0, 120));
  }, async () => {
    await call('settings.set', { key: 'labelOverrides', value: {} });
    await call('settings.set', { key: 'priceOverrides', value: {} });
  });

  await section('the extras page shows what was chosen earlier', async () => {
    setSpec({ suitType: 'two_piece', material: 'standard_wool', shirt: true, shirtColour: 'Ice blue', neckwear: true, neckwearType: 'tie', pocketSquare: 'same' });
    await openOrder('Ayanda', 'Extras');
    const totalBefore = await js('T.total()');
    ui = await read(`
      const boxes = [...document.querySelectorAll('.recalled')];
      const colour = boxes.map(b => T.field('Shirt colour', b)).find(Boolean);
      const code = T.field('Shirt Material Code');
      return {
        boxes: boxes.map(b => b.innerText),
        colour: colour?.querySelector('input')?.value ?? null,
        above: !!(colour && code && (colour.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING)),
        tieType: boxes.some(b => !!T.field('Tie or bow tie', b)),
        photo: !!T.field('Pocket square photo'),
      };`);
    check(ui.colour === 'Ice blue' && ui.above, 'the shirt colour typed on the base page is filled in above the shirt code', JSON.stringify(ui));
    check(ui.tieType, 'and the tie chosen there sits with the tie photo', JSON.stringify(ui.boxes));
    check(!ui.photo, 'a pocket square in the tie\'s cloth asks for no picture of its own');
    await js(`(async () => {
      const box = [...document.querySelectorAll('.recalled')].map(b => T.field('Shirt colour', b)).find(Boolean).querySelector('input');
      T.type(box, 'Pale pink'); await T.wait(200);
      [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Base Garment')).click(); await T.wait(1500);
      return true;
    })()`);
    check(specNow().shirtColour === 'Pale pink', 'changed here, it is changed on the base page - the same answer', specNow().shirtColour);
    ui = await read(`return { base: T.field('Shirt colour')?.querySelector('input')?.value, total: T.total() };`);
    check(ui.base === 'Pale pink' && ui.total === totalBefore, 'shown there too, and charged once', JSON.stringify({ ...ui, totalBefore }));
  });

  await section('the drawings', async () => {
    const widths = async (lapel) => {
      setSpec({ suitType: 'two_piece', lapel, lapelWidth: 'standard' });
      await openOrder('Ayanda', 'Jacket');
      return read(`return T.tiles('Lapel Width').filter(t => t.label !== 'Custom').map(t => t.svg);`);
    };
    const notchWidths = await widths('notch');
    const peakWidths = await widths('peak');
    check(notchWidths.length === 4 && notchWidths.every(Boolean) && peakWidths.every(Boolean), 'every lapel width is drawn', String(notchWidths.length));
    check(notchWidths.every((svg, i) => svg !== peakWidths[i]), 'in the lapel chosen - a peak\'s widths are drawn as peaks');
    ui = await read(`
      const slanted = T.field('Pockets').querySelectorAll('.option');
      const tile = [...slanted].find(o => o.querySelector('.option-label')?.textContent.trim() === 'Slanted');
      const d = tile?.querySelector('svg.sketch .sketch-lapel')?.getAttribute('d') ?? '';
      const third = [...document.querySelectorAll('.toggle-row')].find(r => r.textContent.includes('Third Pocket'));
      return { d, third: !!third?.querySelector('svg.sketch') };`);
    const pts = [...ui.d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    // The left of the drawing is the wearer's right side; the front edge of the
    // pocket is the end nearer the buttons, in the middle.
    const [side, front] = pts.length >= 2 ? [pts[0], pts[1]].sort((a, b) => a[0] - b[0]) : [[0, 0], [0, 0]];
    check(pts.length >= 2 && front[1] < side[1], 'the slanted pocket rises toward the front, as a hacking pocket does', ui.d);
    check(ui.third, 'the third pocket has a picture');
    setSpec({ suitType: 'two_piece', shirt: true });
    await openOrder('Ayanda', 'Extras');
    const collars = await read(`return T.tiles('Collar Type').filter(t => t.label !== 'Custom');`);
    check(collars.length === 6 && collars.every((c) => c.svg), 'every collar is drawn', JSON.stringify(collars.map((c) => [c.label, !!c.svg])));
    check(new Set(collars.map((c) => c.svg)).size === collars.length, 'and no two collars the same');
  });

  await section('"Measurements taken"', async () => {
    await openOrder('Ayanda', 'Client');
    const clickWords = (words) => js(`(async () => {
      [...document.querySelectorAll('.toggle-row span')].find(s => s.textContent.trim() === ${JSON.stringify(words)}).click();
      await T.wait(1000); return true;
    })()`);
    await clickWords('Measurements taken');
    check(!!db.getProject(order).measurements_done, 'pressing the words ticks it', String(db.getProject(order).measurements_done));
    await clickWords('Measurements taken');
    check(!db.getProject(order).measurements_done, 'and pressing them again unticks it');
    await clickWords('Measurement form completed');
    check(!!db.getProject(order).measurement_form_received, 'the form completed works the same way');
  });

  await section('the Completed button and the completed list', async () => {
    setSpec({ suitType: 'two_piece', material: 'standard_wool' });

    await openOrder('Ayanda', 'Summary');
    ui = await read(`
      const button = () => [...document.querySelectorAll('.topbar button')].find(b => /^Completed$|^Mark completed\\?$/.test(b.textContent.trim()));
      const had = !!button();
      button()?.click(); await T.wait(200);
      const armed = button()?.textContent.trim();
      button()?.click(); await T.wait(1500);
      return { had, armed, after: !!button(), pill: document.querySelector('.topbar .pill')?.textContent ?? '' };`);
    check(ui.had && ui.armed === 'Mark completed?', 'an open order has a Completed button, which asks once', JSON.stringify(ui));
    let done = db.getProject(order);
    check(done.status === 'completed_due', 'nothing paid yet: completed, final deposit due', done.status);
    check(done.quote?.total === 3950, 'and the price is fixed as it goes, not left to move with the price list', JSON.stringify(done.quote?.total));
    check(!ui.after && /Completed \(final deposit due\)/.test(ui.pill), 'the button goes once it is done', JSON.stringify(ui));

    await reload();
    ui = await read(`
      T.byText('.nav-item', 'Orders').click(); await T.wait(900);
      const names = () => [...document.querySelectorAll('tbody tr')].map(r => r.textContent);
      const current = names();
      const row = [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes('Bongani'));
      const button = () => [...row.querySelectorAll('button')].find(b => /^Completed$|^Mark completed\\?$/.test(b.textContent.trim()));
      const had = !!button();
      button()?.click(); await T.wait(200); button()?.click(); await T.wait(1800);
      const afterCurrent = names();
      T.byText('.step-tab', 'Completed')?.click(); await T.wait(600);
      const completed = names();
      const tabs = [...document.querySelectorAll('.step-tab')].map(t => t.textContent.trim());
      const buttons = [...document.querySelectorAll('tbody tr button')].map(b => b.textContent.trim());
      return { current, had, afterCurrent, completed, tabs, buttons };`);
    check(ui.had, 'an order on the list has the button too', JSON.stringify(ui.current));
    done = db.getProject(paidOrder);
    check(done.status === 'completed_paid' && done.quote?.total === 4500, 'paid in full: completed, paid', `${done.status} ${done.quote?.total}`);
    check(!ui.current.some((r) => /Ayanda/.test(r)) && ui.afterCurrent.every((r) => !/Bongani/.test(r)) && ui.afterCurrent.some((r) => /Kagiso/.test(r)),
      'completed orders leave the current list; the rest stay', JSON.stringify(ui.afterCurrent));
    check(ui.completed.some((r) => /Ayanda/.test(r)) && ui.completed.some((r) => /Bongani/.test(r)) && !ui.completed.some((r) => /Kagiso/.test(r)),
      'and are on the completed list', JSON.stringify(ui.completed));
    check(ui.tabs.includes('Current 1') && ui.tabs.includes('Completed 2'), 'each list says how many it has', JSON.stringify(ui.tabs));
    check(!ui.buttons.includes('Completed'), 'with no Completed button on an order already completed', JSON.stringify(ui.buttons));
  });

  await section('a suit in two or three cloths', async () => {
    await openOrder('Kagiso', 'Order');
    ui = await read(`
      const sw = document.getElementById('tones-${toneSuit}');
      const words = document.querySelector('label[for="tones-${toneSuit}"]')?.textContent.trim();
      sw?.click(); await T.wait(1800);
      return { sw: !!sw, words, labels: [...document.querySelectorAll('.order-suit .field > label')].map(l => l.textContent.trim()) };`);
    check(ui.sw && ui.words === 'Two- or three-tone - each piece in its own cloth', 'a 3-piece can be two- or three-tone', JSON.stringify(ui));
    let tone = db.getProject(toneOrder).suits[0];
    check(tone.spec.multiTone === true
      && ['jacket', 'waistcoat', 'pants'].every((p) => JSON.stringify(tone.spec.cloths?.[p]) === JSON.stringify({ colour: 'Navy', code: 'NV-1', supplier: 'Mill A' })),
      'each piece starts in the cloth already on the suit', JSON.stringify(tone.spec.cloths));
    check(['Jacket', 'Waistcoat', 'Pants'].every((p) => ['colour', 'material code', 'supplier'].every((k) => ui.labels.includes(`${p} ${k}`))),
      'with a colour, a code and a supplier for each piece', ui.labels.join(' | '));
    check(tone.spec.suitType === 'three_piece', 'and the rest of the suit untouched', JSON.stringify(tone.spec));

    // Two boxes typed and the page left: both are kept.
    await js(`(async () => {
      T.type(T.field('Pants colour').querySelector('input'), 'Grey');
      T.type(T.field('Pants material code').querySelector('input'), 'GR-2');
      await T.wait(200);
      [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Client')).click(); await T.wait(2500);
      return true;
    })()`);
    tone = db.getProject(toneOrder).suits[0];
    check(tone.spec.cloths?.pants?.colour === 'Grey' && tone.spec.cloths?.pants?.code === 'GR-2',
      'two boxes left typed are both kept', JSON.stringify(tone.spec.cloths?.pants));
    check(tone.fabric_name === 'Jacket Navy · Waistcoat Navy · Pants Grey' && tone.fabric_code === 'Jacket NV-1 · Waistcoat NV-1 · Pants GR-2'
      && tone.supplier === 'Mill A', 'the order list, the sheet and the emails show every cloth, a shared one once',
      JSON.stringify([tone.fabric_name, tone.fabric_code, tone.supplier]));

    await step('Preview');
    const prompt = await read(`
      T.byText('button', 'See the prompt').click(); await T.wait(600);
      const text = document.querySelector('.modal textarea')?.value ?? '';
      T.byText('.modal button', 'Close')?.click(); await T.wait(200);
      return text;`);
    check(/three-tone outfit/.test(prompt) && /the jacket in Navy, the waistcoat in Navy and the trousers in Grey/.test(prompt),
      'the render is told which piece is in which cloth', prompt.slice(prompt.indexOf('The cloth'), prompt.indexOf('The cloth') + 300));

    await step('Order');
    await js(`(async () => { document.getElementById('tones-${toneSuit}').click(); await T.wait(1800); return true; })()`);
    tone = db.getProject(toneOrder).suits[0];
    check(!tone.spec.multiTone && tone.fabric_name === 'Navy' && tone.fabric_code === 'NV-1',
      'back to one cloth, it is the jacket\'s', JSON.stringify([tone.spec.multiTone, tone.fabric_name, tone.fabric_code]));
    db.updateSuit(toneSuit, { spec: { ...tone.spec, suitType: 'two_piece' } });
    await openOrder('Kagiso', 'Order');
    const twoWords = await js(`document.querySelector('label[for="tones-${toneSuit}"]')?.textContent.trim() ?? ''`);
    check(twoWords === 'Two-tone - each piece in its own cloth', 'a 2-piece can be two-tone', twoWords);
    db.updateSuit(toneSuit, { spec: { suitType: 'blazer_only' } });
    await openOrder('Kagiso', 'Order');
    check(!(await js(`!!document.getElementById('tones-${toneSuit}')`)), 'a single jacket cannot be in two cloths');
  });

  check(!requests.some((u) => /generateContent|images|predict/.test(u)), 'and nothing was rendered: no AI request was made',
    JSON.stringify(requests.slice(0, 5)));

  log(`\n${fail === 0 ? 'ALL REVIEW CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
