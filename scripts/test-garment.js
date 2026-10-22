/**
 * The garment pages, rebuilt to GD's lists.
 *
 * The interesting checks are the ones about shape rather than wording: that a
 * single blazer hides the trousers, that a double-breasted waistcoat counts
 * its buttons differently from a single, and that a field holding several
 * answers prices, describes and prints all of them.
 */
const { app, BrowserWindow } = require('electron');
require('./fresh.js').freshUserData(app);
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

  const clientId = db.upsertClient({ name: 'Garment', surname: 'Test', contact: '', email: '' });
  const projectId = db.createProject({ clientId, title: 'Garment test' });
  const setSpec = (spec) => db.updateProject(projectId, { spec });

  const read = async (tabs) => JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const out = {};
    out.tabs = [...document.querySelectorAll('.step-tab')].map(t => t.textContent.replace(/^[\\d✓]+/, '').trim());
    for (const name of ${JSON.stringify(tabs)}) {
      const tab = [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes(name));
      if (!tab) { out[name] = null; continue; }
      tab.click(); await wait(600);
      out[name] = {
        // Toggles and measurement rows do not use a <label>, so collecting
        // only those would have reported missing fields that are on screen.
        labels: [...document.querySelectorAll('.field > label, .toggle-row, .measure-row')]
          .map(l => l.textContent.trim().split(String.fromCharCode(10))[0]),
        options: [...document.querySelectorAll('.option')].map(o => o.textContent.trim()),
      };
    }
    return JSON.stringify(out);
  })()`));

  const open = async () => {
    win.webContents.reload(); await wait(2100);
    await js(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes('Garment Test')).click();
      await wait(1000);
    })()`);
  };

  log('=== the base decides which pages exist ===');
  setSpec({ suitType: 'three_piece' });
  await open();
  let ui = await read([]);
  check(ui.tabs.includes('Waistcoat') && ui.tabs.includes('Pants'), 'a 3-piece shows waistcoat and pants', ui.tabs.join(' > '));
  check(ui.tabs.indexOf('Waistcoat') < ui.tabs.indexOf('Pants'), 'waistcoat before pants, as GD lists them');
  // GD's review of 20 October: the lining is chosen once the jacket is.
  check(ui.tabs.indexOf('Lining & Stitching') === ui.tabs.indexOf('Jacket') + 1, 'lining comes straight after the jacket', ui.tabs.join(' > '));

  setSpec({ suitType: 'blazer_only' });
  await open();
  ui = await read([]);
  check(!ui.tabs.includes('Pants') && !ui.tabs.includes('Waistcoat'), 'a single blazer hides both', ui.tabs.join(' > '));
  check(ui.tabs.includes('Jacket'), 'and keeps the jacket');

  setSpec({ suitType: 'pants_only' });
  await open();
  ui = await read([]);
  check(!ui.tabs.includes('Jacket'), 'single trousers hide the jacket', ui.tabs.join(' > '));

  log('\n=== the jacket, in the order GD lists ===');
  setSpec({ suitType: 'two_piece', tuxedoFinish: 'satin', breast: 'single' });
  await open();
  ui = await read(['Jacket']);
  const j = ui.Jacket.labels.join(' | ');
  check(/Extra Wide/.test(ui.Jacket.options.join(' | ')), 'lapel widths include extra wide');
  check(/4 inch/.test(ui.Jacket.options.join(' | ')), 'and carry their inches');
  check(ui.Jacket.labels.includes('Tuxedo Finish Colour'), 'saying yes to a tuxedo finish asks for the colour', j);
  check(ui.Jacket.labels.some((l) => l.includes('Third Pocket')), 'a third pocket is offered', j);
  check(j.indexOf('Button Finish') < j.indexOf('Pockets'), 'the button finish sits with the buttons, above the pockets', j);
  check(/Other Colour/.test(ui.Jacket.options.join(' | ')), 'and its last option is "other colour"');

  log('\n=== the lapel drawings ===');
  setSpec({ suitType: 'two_piece' });
  await open();
  const drawn = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Jacket')).click();
    await wait(700);
    const fieldNamed = (name) => [...document.querySelectorAll('.field')]
      .find(f => f.querySelector('label')?.textContent.trim() === name);
    const tiles = (name) => [...(fieldNamed(name)?.querySelectorAll('.option') ?? [])]
      .map(t => ({
        label: t.querySelector('.option-label')?.textContent.trim(),
        svg: t.querySelector('svg.sketch')?.outerHTML ?? null,
      }));
    const lapel = tiles('Lapel'), width = tiles('Lapel Width'), fit = tiles('Fit');
    // Click the drawing itself, not the tile around it: an SVG inside a
    // button is exactly the thing that swallows the click.
    const notch = [...document.querySelectorAll('.option')]
      .find(t => t.querySelector('.option-label')?.textContent.trim() === 'Notch');
    const inside = notch?.querySelector('svg.sketch') ?? null;
    inside?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(700);
    return JSON.stringify({
      lapel, width, insideTheTile: !!inside,
      fitHasNone: fit.every(t => t.svg === null),
      chosen: [...document.querySelectorAll('.option.selected .option-label')].map(e => e.textContent.trim()),
    });
  })()`));
  check(drawn.lapel.length >= 3 && drawn.lapel.slice(0, 3).every((t) => t.svg),
    'notch, peak and shawl are each drawn', JSON.stringify(drawn.lapel.map((t) => [t.label, !!t.svg])));
  check(drawn.width.filter((t) => t.svg).length === 4,
    'and each of the four widths', JSON.stringify(drawn.width.map((t) => [t.label, !!t.svg])));
  check(drawn.width.find((t) => t.label === 'Custom')?.svg === null,
    'while "custom" - which has no shape to draw - has none');
  check(drawn.fitHasNone, 'and a field with nothing to draw carries no empty frame');
  check(drawn.insideTheTile && drawn.chosen.includes('Notch'),
    'clicking the drawing itself chooses the lapel', JSON.stringify(drawn));

  // The three shapes have to differ, or they are decoration. Comparing the
  // markup catches the mistake of wiring the same drawing to all three.
  const shapes = drawn.lapel.slice(0, 3).map((t) => t.svg);
  check(new Set(shapes).size === 3, 'the three lapels are three different drawings');
  check(new Set(drawn.width.filter((t) => t.svg).map((t) => t.svg)).size === 4, 'and the four widths, four');
  check(shapes.every((svg) => !/#[0-9a-f]{3,6}|rgb\(/i.test(svg)),
    'no drawing names a colour of its own, so all of them follow the theme');
  check(/notch/i.test(db.getProject(projectId).spec.lapel ?? ''), 'and the choice reached the order', 
    JSON.stringify(db.getProject(projectId).spec.lapel));

  log('\n=== choose-several tiles are one size ===');
  // Measured, not eyeballed. These sat in a container with no style behind
  // it, so each tile took the width of its own words and "Other" - the only
  // one with a second line - stood a row taller than everything else.
  setSpec({ suitType: 'two_piece' });
  await open();
  const sizes = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const out = {};
    for (const [tabName, fieldName] of [['Pants', 'Waistband Extras']]) {
      [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes(tabName))?.click();
      await wait(700);
      const field = [...document.querySelectorAll('.field')]
        .find(f => f.querySelector('label')?.textContent.trim() === fieldName);
      out[fieldName] = [...(field?.querySelectorAll('.option') ?? [])].map(t => {
        const r = t.getBoundingClientRect();
        return { label: t.querySelector('.option-label')?.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) };
      });
    }
    return JSON.stringify(out);
  })()`));
  for (const [name, tiles] of Object.entries(sizes)) {
    const shapes = new Set(tiles.map((t) => `${t.w}x${t.h}`));
    check(tiles.length >= 2 && shapes.size === 1,
      `every tile in ${name} is the same size`,
      JSON.stringify(tiles.map((t) => `${t.label} ${t.w}x${t.h}`)));
  }

  log('\n=== a waistcoat counts its buttons by how it fastens ===');
  setSpec({ suitType: 'three_piece', wcBreast: 'single' });
  await open();
  ui = await read(['Waistcoat']);
  check(['4 Buttons', '5 Buttons', '6 Buttons'].every((o) => ui.Waistcoat.options.some((t) => t.includes(o))),
    'single breasted offers 4, 5 and 6', ui.Waistcoat.options.join(' | '));
  setSpec({ suitType: 'three_piece', wcBreast: 'double' });
  await open();
  ui = await read(['Waistcoat']);
  const wcOpts = ui.Waistcoat.options.join(' | ');
  check(/6 Buttons/.test(wcOpts) && /8 Buttons/.test(wcOpts) && !/4 Buttons/.test(wcOpts),
    'double breasted offers 6 and 8, and not 4', wcOpts);

  log('\n=== the trousers ===');
  setSpec({ suitType: 'two_piece' });
  await open();
  ui = await read(['Pants']);
  const p = ui.Pants.labels.join(' | ');
  check(p.indexOf('Waistband Join') < p.indexOf('Waistband Extras'), 'the join comes before the extras', p);
  check(['Belt Loops', 'Side Adjusters', 'Elastic Band'].every((o) => ui.Pants.options.some((t) => t.includes(o))),
    'the extras are all there', ui.Pants.options.join(' | '));
  check(['Slim Fit (Tapered)', 'Boot Leg', 'Wide Leg'].every((o) => ui.Pants.options.some((t) => t.includes(o))),
    'and the bottom fits GD listed');

  log('\n=== several answers at once ===');
  // A multi-select has to price, describe and print every chosen extra.
  setSpec({ suitType: 'two_piece', waistbandExtras: ['side_adjusters', 'elastic_band'] });
  await open();
  const chosen = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Pants')).click(); await wait(700);
    return JSON.stringify([...document.querySelectorAll('.option.selected')].map(o => o.textContent.trim()));
  })()`));
  check(chosen.filter((c) => /Side Adjusters|Elastic Band/.test(c)).length === 2,
    'both chosen extras show as chosen', JSON.stringify(chosen));

  const sheet = db.getProject(projectId);
  check(JSON.stringify(sheet.spec.waistbandExtras) === '["side_adjusters","elastic_band"]',
    'and both are stored', JSON.stringify(sheet.spec.waistbandExtras));

  log('\n=== the base garment, as GD lists it ===');
  setSpec({ suitType: 'two_piece', shirt: true, neckwear: true, neckwearType: 'tie' });
  await open();
  ui = await read(['Base Garment']);
  const baseTiles = ui['Base Garment'].options;
  const order = ['3-Piece', '2-Piece', 'Single Blazer', 'Single Pants', 'Single Waistcoat'];
  check(order.every((o, i) => baseTiles[i]?.startsWith(o)), 'the garments in GD\'s order: 3PC, 2PC, blazer, pants, waistcoat',
    ui['Base Garment'].options.slice(0, 5).join(' | '));
  const baseLabels = ui['Base Garment'].labels.join(' | ');
  for (const item of ['Shirt', 'Tie / Bow Tie', 'Lapel Chain', 'Lapel Pin', 'Tie Pin', 'Cuff Links']) {
    check(ui['Base Garment'].labels.some((l) => l.startsWith(item)), `${item} is chosen on the base garment page`, baseLabels);
  }
  check(/Shirt colour/.test(baseLabels) && /Tie \/ bow tie colour/.test(baseLabels),
    'with the shirt and tie colours typed beside them', baseLabels);
  const typedColours = JSON.parse(await js(`JSON.stringify({
    inputs: ['Shirt colour', 'Tie / bow tie colour'].map(n => [...document.querySelectorAll('.field')]
      .find(f => f.querySelector('label')?.textContent.trim() === n)?.querySelector('input')?.type ?? null),
    wheel: !!document.querySelector('.colour-trigger, .wheel-canvas'),
  })`));
  check(typedColours.inputs.every((t) => t === 'text') && !typedColours.wheel, 'as words, with no colour wheel',
    JSON.stringify(typedColours));

  log('\n=== lining and jacket ===');
  setSpec({ suitType: 'two_piece', tuxedoFinish: 'satin' });
  await open();
  ui = await read(['Lining', 'Jacket']);
  check(ui.Lining.options.some((o) => o.startsWith('Standard')) && ui.Lining.options.some((o) => o.startsWith('Custom')),
    'lining is Standard or Custom', ui.Lining.options.join(' | '));
  check(!/Choose Colour|Upload Pattern/.test(ui.Lining.options.join(' | ')), 'and nothing else');
  const fits = JSON.parse(await js(`JSON.stringify([...([...document.querySelectorAll('.field')]
    .find(f => f.querySelector('label')?.textContent.trim() === 'Fit')?.querySelectorAll('.option .option-label') ?? [])]
    .map(l => l.textContent.trim()))`));
  check(['Slim', 'Medium', 'Comfortable', 'Loose', 'Oversized'].every((f) => fits.some((o) => o.startsWith(f))),
    'jacket fits are slim, medium, comfortable, loose and oversized', fits.join(' | '));
  check(!fits.some((o) => o.startsWith('Other')), 'with no "other" on a new order');
  const tux = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.field')]
    .find(f => f.querySelector('label')?.textContent.trim() === 'Tuxedo Finish Colour')?.querySelector('input')?.type ?? null)`));
  check(tux === 'text', 'the tuxedo finish colour is typed, not picked', String(tux));

  // An order that chose a fit GD has since taken off the list still shows it.
  setSpec({ suitType: 'two_piece', jacketFit: 'other', jacketFitOther: 'Boxy' });
  await open();
  ui = await read(['Jacket']);
  check(ui.Jacket.options.some((o) => o.startsWith('Other') && /No longer offered/.test(o)),
    'an old order keeps its retired choice, marked as no longer offered', ui.Jacket.options.filter((o) => /Other/.test(o)).join(' | '));

  log('\n=== the pockets are drawn ===');
  const pocketArt = JSON.parse(await js(`(async () => {
    const field = [...document.querySelectorAll('.field')].find(f => f.querySelector('label')?.textContent.trim() === 'Pockets');
    return JSON.stringify([...(field?.querySelectorAll('.option') ?? [])].map(t => ({
      label: t.querySelector('.option-label')?.textContent.trim(),
      svg: t.querySelector('svg.sketch')?.outerHTML ?? null,
    })));
  })()`));
  const drawnPockets = pocketArt.filter((t) => ['Flap', 'Patch', 'Slanted'].includes(t.label));
  check(drawnPockets.length === 3 && drawnPockets.every((t) => t.svg), 'flap, patch and slanted each have a drawing',
    JSON.stringify(pocketArt.map((t) => [t.label, !!t.svg])));
  check(new Set(drawnPockets.map((t) => t.svg)).size === 3, 'and the three are different drawings');

  log('\n=== extras ===');
  setSpec({ suitType: 'two_piece', shirt: true, neckwear: true, pocketSquare: 'different', lapelPin: true });
  await open();
  ui = await read(['Extras']);
  const e = ui.Extras.labels.join(' | ');
  const eo = ui.Extras.options.join(' | ');
  check(/Shirt Material Code/.test(e), 'the shirt keeps its material code', e);
  // GD's review of 20 October: the extras page shows what was chosen on the
  // base page - the same answer, shown again, not a second question.
  const shirtColour = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.field > label')]
    .filter(l => l.textContent.trim() === 'Shirt colour').map(l => !!l.closest('.recalled')))`));
  check(shirtColour.length === 1 && shirtColour[0], 'its colour is the one typed on the base page, shown as chosen earlier', JSON.stringify(shirtColour));
  check(['Standard', 'Cutaway', 'Pointed', 'Button Down', 'Wing Tip', 'Chinese', 'Custom'].every((o) => eo.includes(o)),
    'the collars GD listed', eo);
  check(/Single Hybrid/.test(eo) && /Button and cuff/.test(eo) && /Double Cuff \(French\)/.test(eo), 'the two cuffs GD listed');
  check(!/Single Cuff/.test(eo), 'and not the old single cuff');
  check(['White', 'Black', 'Metallic', 'Material Covered'].every((o) => eo.includes(o)), 'shirt buttons: white, black, metallic, material covered');
  check(!/Metallic Gold|Metallic Silver|Matching the shirt/.test(eo), 'and none of the old ones');
  check(/Plain/.test(eo) && /Pleated/.test(eo), 'the chest is plain or pleated');
  check(/Tie photo/.test(e), 'a tie picture can be uploaded', e);
  check(/Pocket Square Colour/.test(e) && /Pocket square photo/.test(e), 'the pocket square colour is typed, with a picture', e);
  check(!/Shoes|Socks/.test(e) && !ui.Extras.labels.some((l) => /^(Shoes|Socks)/.test(l)), 'shoes and socks are gone', e);
  const extrasInputs = JSON.parse(await js(`JSON.stringify({
    pocket: [...document.querySelectorAll('.field')].find(f => f.querySelector('label')?.textContent.trim() === 'Pocket Square Colour')?.querySelector('input')?.type ?? null,
    wheel: !!document.querySelector('.colour-trigger, .wheel-canvas'),
  })`));
  check(extrasInputs.pocket === 'text' && !extrasInputs.wheel, 'no colour wheel on the extras page', JSON.stringify(extrasInputs));

  // Collar "custom" asks to be explained.
  setSpec({ suitType: 'two_piece', shirt: true, shirtCollar: 'custom' });
  await open();
  ui = await read(['Extras']);
  check(ui.Extras.labels.includes('Describe the collar'), 'a custom collar is explained', ui.Extras.labels.join(' | '));

  log('\n=== the flow ===');
  check(!ui.tabs.some((t) => /Detail/.test(t)), 'the detail customisation page is gone', ui.tabs.join(' > '));
  check(ui.tabs.includes('Photos & Cloth') && !ui.tabs.includes('Capture') && !ui.tabs.includes('Cloth'),
    'capture and cloth are one page', ui.tabs.join(' > '));

  log('\n=== measurements ===');
  setSpec({ suitType: 'two_piece' });
  await open();
  ui = await read(['Measurements']);
  const m = ui.Measurements.labels;
  check(!m.some((l) => /Sleeve opening/i.test(l)), 'the sleeve opening is gone', m.join(' | '));
  const bicep = JSON.parse(await js(`(async () => {
    const row = [...document.querySelectorAll('.measure-row')].find(r => r.textContent.includes('Bicep'));
    return JSON.stringify({
      inputs: row?.querySelectorAll('input').length ?? 0,
      sides: [...(row?.querySelectorAll('.measure-side') ?? [])].map(s => s.textContent),
      top: [...(row?.querySelectorAll('input') ?? [])].map(i => Math.round(i.getBoundingClientRect().top)),
    });
  })()`));
  check(bicep.inputs === 2 && bicep.sides.join() === 'Left,Right', 'the bicep takes two figures, left and right', JSON.stringify(bicep));
  check(bicep.top.length === 2 && bicep.top[0] === bicep.top[1], 'next to each other, on one line', JSON.stringify(bicep.top));
  const trouserText = await js(`(async () => [...document.querySelectorAll('.measure-row')].map(r => r.textContent).join(' || '))()`);
  check(/From the waistband to the ground/.test(trouserText), 'trouser length is waistband to ground');
  check(/Thigh loop\s*Around the thigh\./.test(trouserText), 'the thigh loop is around the thigh');
  check(m.findIndex((l) => /^Knee loop/.test(l)) === m.findIndex((l) => /^Thigh loop/.test(l)) + 1, 'and the knee loop comes straight after it', m.join(' | '));
  check(!m.some((l) => /Inseam/i.test(l)), 'the inseam is still gone');
  check(m.some((l) => /^Bottom/.test(l)), 'and the ankle loop is still called the bottom');

  // A measurement saved to the right bicep is kept apart from the left.
  const suitId = db.primarySuitId(projectId);
  db.saveMeasurement({ projectId, suitId, garment: 'jacket', fieldId: 'bicep', value: 36 });
  db.saveMeasurement({ projectId, suitId, garment: 'jacket', fieldId: 'bicepRight', value: 37 });
  const both = db.getProject(projectId).measurements.filter((x) => /^bicep/.test(x.field_id)).map((x) => `${x.field_id}=${x.value}`).sort();
  check(both.join() === 'bicep=36,bicepRight=37', 'and each arm is stored on its own', both.join());

  log(`\n${fail === 0 ? 'ALL GARMENT CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
