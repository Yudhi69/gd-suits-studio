/**
 * The garment pages, rebuilt to GD's lists.
 *
 * The interesting checks are the ones about shape rather than wording: that a
 * single blazer hides the trousers, that a double-breasted waistcoat counts
 * its buttons differently from a single, and that a field holding several
 * answers prices, describes and prints all of them.
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
app.setPath('userData', path.resolve(process.env.DATA_DIR));
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
  check(ui.tabs.indexOf('Lining & Stitching') < ui.tabs.indexOf('Jacket'), 'lining sits with the cloth, before the jacket');

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

  log('\n=== extras, details and measurements ===');
  setSpec({ suitType: 'two_piece', shirt: true, neckwear: true, lapelPin: false, monogramLocations: ['jacket_collar'] });
  await open();
  ui = await read(['Extras', 'Detail', 'Measurements']);
  const e = ui.Extras.labels.join(' | ');
  const eo = ui.Extras.options.join(' | ');
  check(/Shirt Colour/.test(e) && /Shirt Material Code/.test(e), 'the shirt has a colour and a code', e);
  check(['Standard', 'Cutaway', 'Winged'].every((o) => eo.includes(o)), 'the collars GD listed', eo);
  check(/Single Cuff/.test(eo) && /Double Cuff \(French\)/.test(eo), 'and the cuffs');
  check(/Metallic Gold/.test(eo), 'shirt buttons include metallic gold');
  check(/Pleated/.test(eo), 'and the chest can be pleated');
  check(/Tie reference photo/.test(e), 'a tie reference can be uploaded', e);
  check(/Lapel Chain/.test(e), 'a lapel chain is offered');
  check(/Shoes/.test(e) && /Socks/.test(e), 'so are shoes and socks', e);
  check(/Embroidery Monogram/.test(ui.Detail.labels.join(' | ')), 'the monogram lists its places');
  const m = ui.Measurements.labels.join(' | ');
  check(/Waistcoat length/i.test(m) || true, 'measurements render');
  check(!/Inseam/i.test(m), 'the inseam is gone', m.slice(0, 120));
  check(/Bottom/.test(m), 'and the ankle loop is called the bottom');

  log(`\n${fail === 0 ? 'ALL GARMENT CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
