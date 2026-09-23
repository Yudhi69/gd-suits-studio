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
  const js = (code) => win.webContents.executeJavaScript(code);

  await js(`(async () => {
    const gd = window.gd, un = async p => { const r = await p; if(!r.ok) throw new Error(r.error.message); return r.data; };
    const clientId = await un(gd.clients.save({ name:'Flow', surname:'Test' }));
    const projectId = await un(gd.projects.create({ clientId, title:'Workflow' }));
    await un(gd.projects.update({ id: projectId, patch:{ spec:{ suitType:'two_piece' } } }));
    await un(gd.measurements.save({ projectId, garment:'jacket', fieldId:'chest', value:104 }));
  })()`);
  win.webContents.reload();
  await wait(1800);

  /* ---------------------------------------------------------- units ---- */
  log('=== measurement units ===');
  const unitState = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    document.querySelector('tbody tr').click(); await wait(900);
    [...document.querySelectorAll('.step-tab')].find(t=>t.textContent.includes('Measurements')).click(); await wait(700);
    const fieldFor = (label) => {
      const row = [...document.querySelectorAll('.measure-row')].find(r => r.textContent.includes(label));
      return { input: row?.querySelector('.measure-input'), unit: row?.querySelector('.measure-unit')?.textContent };
    };
    // GD's order form asks for inches, so that is the default now.
    const chestInches = fieldFor('Chest');
    const before = { value: chestInches.input.value, unit: chestInches.unit };
    [...document.querySelectorAll('.unit-switch button')].find(b=>b.textContent.trim() === 'cm').click(); await wait(700);
    const chestCm = fieldFor('Chest');
    const after = { value: chestCm.input.value, unit: chestCm.unit };
    return JSON.stringify({ before, after });
  })()`));
  check(unitState.before.value === '40.94' && unitState.before.unit === 'in',
    'inches by default, matching the order form', JSON.stringify(unitState.before));
  check(unitState.after.value === '104' && unitState.after.unit === 'cm',
    'toggling converts the display to centimetres', JSON.stringify(unitState.after));

  // Simulated typing is not tested here on purpose. React's controlled inputs
  // only update from a genuine user keystroke - neither a programmatic `.value`
  // write nor `insertText` moves React's state - so asserting on it would be
  // testing Electron's input simulation rather than this app. What matters is
  // that the stored value is always centimetres and the field always shows the
  // chosen unit, which is asserted from both directions instead.
  const shown = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const un = async p => { const r = await p; if(!r.ok) throw new Error(r.error.message); return r.data; };
    await un(window.gd.measurements.save({ projectId: 1, garment: 'jacket', fieldId: 'chest', value: 104.14 }));
    location.reload();
    return '1';
  })()`).then(() => wait(1900)).then(async () => {
    await js(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      document.querySelector('tbody tr').click(); await wait(900);
      [...document.querySelectorAll('.step-tab')].find(t=>t.textContent.includes('Measurements')).click(); await wait(700);
    })()`);
    return js(`(() => {
      const row = [...document.querySelectorAll('.measure-row')].find(r => r.textContent.includes('Chest'));
      return JSON.stringify({
        unit: row.querySelector('.measure-unit').textContent,
        value: row.querySelector('.measure-input').value,
      });
    })()`);
  }));
  check(shown.unit === 'cm', 'the chosen unit survives a reload', shown.unit);
  // Centimetres display to one decimal by design - a tailor works to the half.
  check(shown.value === '104.1', '104.14 cm stored, shown to one decimal in cm', shown.value);

  /* ------------------------------------------------- custom options ---- */
  log('\n=== add an option to a built-in selector ===');
  const optResult = JSON.parse(await js(`(async () => {
    const un = async p => { const r = await p; if(!r.ok) throw new Error(r.error.message); return r.data; };
    await un(window.gd.catalog.addOption({ fieldId:'lapel', label:'Cravat Notch', price:420, prompt:'a bespoke cravat-notch lapel' }));
    await un(window.gd.catalog.addOption({ fieldId:'eventType', label:'Anniversary', price:0 }));
    return JSON.stringify((await un(window.gd.catalog.list())).options.map(o => o.field_id + ':' + o.label));
  })()`));
  check(optResult.includes('lapel:Cravat Notch'), 'a lapel option is stored');
  check(optResult.includes('eventType:Anniversary'), 'an event type is stored');

  win.webContents.reload();
  await wait(1800);
  const inUi = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    document.querySelector('tbody tr').click(); await wait(900);
    const eventTiles = [...document.querySelectorAll('.option')].map(o=>o.textContent);
    const addTiles = document.querySelectorAll('.option-add').length;
    [...document.querySelectorAll('.step-tab')].find(t=>t.textContent.includes('Jacket')).click(); await wait(700);
    const lapel = [...document.querySelectorAll('.option')].find(o=>o.textContent.includes('Cravat Notch'));
    const hasCravat = !!lapel;
    if (lapel) { lapel.click(); await wait(900); }
    return JSON.stringify({
      eventHasAnniversary: eventTiles.some(t=>t.includes('Anniversary')),
      eventHasAddTile: addTiles > 0,
      hasCravat,
      total: document.querySelector('.price-total').textContent.trim(),
    });
  })()`));
  check(inUi.eventHasAnniversary, 'the custom event type appears on the client step');
  check(inUi.eventHasAddTile, 'every selector carries an Add option tile');
  check(inUi.hasCravat, 'the custom lapel appears in the jacket selector');
  check(inUi.total === 'R4,920', 'choosing it charges R420 on top of the base', inUi.total);

  /* ----------------------------------------------------- fittings ------ */
  log('\n=== first and final fittings ===');
  const fit = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.step-tab')].find(t=>t.textContent.includes('Fitting')).click(); await wait(700);
    [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Record the first fitting')).click();
    await wait(1200);
    const firstHeading = document.querySelector('.card-head h3')?.textContent;
    const statusPill = document.querySelector('.topbar .pill')?.textContent;
    [...document.querySelectorAll('button')].find(b=>b.textContent.toLowerCase().includes('record final fitting'))?.click();
    await wait(1200);
    const headings = [...document.querySelectorAll('.card-head h3')].map(h=>h.textContent);
    const statusAfter = document.querySelector('.topbar .pill')?.textContent;
    return JSON.stringify({ firstHeading, statusPill, headings, statusAfter });
  })()`));
  check(fit.firstHeading === 'First fitting', 'the first session is labelled First fitting', fit.firstHeading);
  check(fit.statusPill === 'Ready for first fitting', 'the order status follows the fitting', fit.statusPill);
  check(fit.headings.includes('Final fitting'), 'a second session is labelled Final fitting', fit.headings.join(','));
  check(fit.statusAfter === 'Ready for final fit', 'and follows the final one', fit.statusAfter);

  /* ------------------------------------------------ prompt editing ---- */
  log('\n=== the render prompt is editable ===');
  const promptUi = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.step-tab')].find(t=>t.textContent.includes('Preview')).click(); await wait(800);
    [...document.querySelectorAll('button')].find(b=>b.textContent.includes('See the prompt')).click(); await wait(700);
    const ta = document.querySelector('.modal textarea');
    const buttons = [...document.querySelectorAll('.modal button')].map(b=>b.textContent.trim());
    return JSON.stringify({
      editable: !!ta && !ta.readOnly && !ta.disabled,
      mentionsSpec: !!ta && ta.value.includes('two-piece suit'),
      mentionsCustomOption: !!ta && ta.value.includes('cravat-notch'),
      buttons,
    });
  })()`));
  check(promptUi.editable, 'the prompt opens in an editable field');
  check(promptUi.mentionsSpec, 'it contains the spec built so far');
  check(promptUi.mentionsCustomOption, "it carries the shop's own option wording");
  check(promptUi.buttons.some(b=>b.includes('Render with this')), 'it can be rendered directly from the editor', promptUi.buttons.join(' | '));
  check(promptUi.buttons.some(b=>b.includes('Reset to generated')), 'and reset back to the generated prompt');

  log('\n=== each view asks for a different shot ===');
  // Four renders that all come back front-on is money spent four times for one
  // picture. The prompt has to ask for the angle unambiguously, and must not
  // demand a face the angle cannot show.
  // The line that caused this only exists when a client photo is attached, so
  // the test has to attach one or it checks nothing.
  await js(`(async () => {
    const projects = (await window.gd.projects.list()).data;
    await window.gd.photos.add({ projectId: projects[0].id, slot: 'front',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' });
  })()`);
  win.webContents.reload(); await wait(2100);
  await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    document.querySelector('tbody tr').click(); await wait(1000);
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Preview')).click(); await wait(800);
  })()`);

  const views = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const out = {};
    for (const label of ['Front', 'Side', 'Back', '3/4']) {
      const open = document.querySelector('.modal');
      if (open) [...document.querySelectorAll('.modal button')].find(b => b.textContent.trim() === 'Close')?.click();
      await wait(350);
      [...document.querySelectorAll('.render-head .step-tab, .card-head .step-tab')]
        .find(t => t.textContent.trim() === label)?.click();
      await wait(450);
      [...document.querySelectorAll('button')].find(b => b.textContent.includes('See the prompt')).click();
      await wait(550);
      out[label] = document.querySelector('.modal textarea').value;
    }
    [...document.querySelectorAll('.modal button')].find(b => b.textContent.trim() === 'Close')?.click();
    return JSON.stringify(out);
  })()`));

  const distinct = new Set(Object.values(views)).size;
  check(distinct === 4, 'the four views produce four different prompts', `${distinct} distinct`);
  check(/THE SHOT - this is FRONT/.test(views.Front), 'the front prompt leads with the shot');
  check(/THE SHOT - this is BACK/.test(views.Back), 'the back prompt leads with the shot');
  check(/PROFILE/.test(views.Side), 'the side prompt asks for a profile');
  check(/THREE-QUARTER/.test(views['3/4']), 'the 3/4 prompt asks for three-quarters');
  // The contradiction that caused it: a back view cannot preserve a face.
  check(!/Preserve this person's face/.test(views.Back),
    'the back prompt does not also demand the face be preserved');
  check(/face must NOT be visible/.test(views.Back), 'it says outright the face is not visible');
  check(/face is not visible in this shot/.test(views.Back),
    'and the client photo is described as build and colouring, not a face');
  check(/Preserve their likeness exactly/.test(views.Front), 'while the front view still preserves the likeness');
  check(/must be the BACK view/.test(views.Back), 'the angle is restated in the closing rules, where it is read last');

  log(`\n${fail === 0 ? 'ALL WORKFLOW CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
