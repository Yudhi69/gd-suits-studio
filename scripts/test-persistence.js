/**
 * Everything entered stays entered.
 *
 * The complaint was that things the tailor had chosen were not there later - the
 * lining colour above all. The cases worth testing are the ones where the
 * screen looks right and the record is empty, because those are the ones
 * nobody notices until a suit is cut wrong.
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

  const clientId = db.upsertClient({ name: 'Persist', surname: 'Test' });
  const projectId = db.createProject({ clientId, title: 'Persistence' });
  const open = async (tab) => {
    win.webContents.reload(); await wait(2200);
    await js(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes('Persist')).click(); await wait(1100);
      [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes(${JSON.stringify(tab)})).click(); await wait(900);
    })()`);
  };

  log('=== a colour on screen is a colour that was chosen ===');
  // The lining swatch once read navy while the spec held nothing at all, so
  // the render prompt never mentioned lining. The shop then asked for the colour
  // wheel to go - a lining is matched from stock, and the wheel promised a
  // shade nobody could guarantee - so the colour is typed in words. An empty
  // box is an empty spec, and the render is told nothing it was not told.
  const promptNow = () => js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Preview')).click(); await wait(1000);
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('See the prompt'));
    if (!btn) return 'no prompt button';
    btn.click(); await wait(700);
    const text = document.querySelector('.modal textarea')?.value ?? '';
    [...document.querySelectorAll('.modal button')].find(b => b.textContent.trim() === 'Close')?.click();
    return text;
  })()`);
  const liningBox = () => js(`JSON.stringify({
    value: [...document.querySelectorAll('.field')]
      .find(f => f.querySelector('label')?.textContent.trim() === 'Lining colour')?.querySelector('input')?.value ?? null,
    wheel: !!document.querySelector('.colour-trigger, .wheel-canvas'),
    choices: [...document.querySelectorAll('.option .option-label')].map(o => o.textContent.trim()),
  })`).then(JSON.parse);

  db.updateProject(projectId, { spec: { suitType: 'two_piece', liningMode: 'colour' } });
  await open('Lining');
  const blank = await liningBox();
  check(blank.value === '', 'a lining with no colour typed shows an empty box, not a made-up colour', JSON.stringify(blank));
  check(!blank.wheel, 'and there is no colour wheel on the page');
  check(['Standard', 'Vinyl Print', 'Digital Print'].every((c) => blank.choices.includes(c)), 'the lining is Standard, a vinyl print or a digital print', blank.choices.join(' | '));
  let described = await promptNow();
  check(/THE SHOT/.test(described) && !/Lining colour is/i.test(described),
    'and the render says nothing about a lining colour nobody chose', described.slice(0, 40));

  db.updateProject(projectId, { spec: { suitType: 'two_piece', liningMode: 'colour', liningColour: 'Burgundy paisley' } });
  await open('Lining');
  check((await liningBox()).value === 'Burgundy paisley', 'a typed colour is what the box shows');
  described = await promptNow();
  check(/Lining colour is Burgundy paisley/.test(described), 'and what the render is told', (described.match(/Lining colour[^;]*/) || ['none'])[0]);

  // An order taken while the wheel was in use still carries a code.
  db.updateProject(projectId, { spec: { suitType: 'two_piece', liningMode: 'colour', liningColour: '#3f2d4a' } });
  await open('Lining');
  const legacy = await js(`document.body.innerText`);
  check(/old colour wheel/i.test(legacy), 'an order from the colour-wheel days says so beside the box');
  described = await promptNow();
  check(/Lining colour is [a-z ]+ \(#3f2d4a\)/.test(described), 'and its colour still reaches the render, in words',
    (described.match(/Lining colour[^;]*/) || ['none'])[0]);

  log('\n=== typing then walking away ===');
  // Blur is the usual way out of a field. Switching steps is not, and used to
  // take the input off the page with the typing still in it.
  await open('Order');
  const typed = await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const field = [...document.querySelectorAll('.field')].find(f => f.querySelector('label')?.textContent.trim() === 'Fabric colour');
    const input = field.querySelector('input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Bottle green');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(200);
    // Leave by changing step, without ever blurring the input.
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Jacket')).click();
    await wait(1200);
    return 'left';
  })()`);
  check(typed === 'left', 'the step changed while the field still held typing');
  await wait(400);
  check(db.getProject(projectId).fabric_name === 'Bottle green',
    'what was typed is on the order anyway', JSON.stringify(db.getProject(projectId).fabric_name));

  log('\n=== every kind of field comes back ===');
  db.updateProject(projectId, { spec: {
    suitType: 'three_piece',
    lapel: 'peak',                       // choice
    thirdPocket: true,                   // toggle
    liningMode: 'colour',
    liningColour: '#3f2d4a',             // colour
    liningCode: 'LN 7350',               // text
    lapelWidth: 'custom', lapelWidthCustom: 3.25,   // number
    waistbandExtras: ['side_adjusters', 'elastic_band'],  // multi
    shirt: true,
    shirtFinishes: 'Gold thread on the inside pocket.',  // longtext
  } });
  win.webContents.reload(); await wait(2200);
  const back = db.getProject(projectId).spec;
  for (const [label, ok] of [
    ['a choice', back.lapel === 'peak'],
    ['a toggle', back.thirdPocket === true],
    ['a colour', back.liningColour === '#3f2d4a'],
    ['a short line', back.liningCode === 'LN 7350'],
    ['a number', back.lapelWidthCustom === 3.25],
    ['several answers at once', JSON.stringify(back.waistbandExtras) === '["side_adjusters","elastic_band"]'],
    ['a paragraph', /Gold thread/.test(back.shirtFinishes ?? '')],
  ]) check(ok, `${label} survives a reload`, JSON.stringify(back).slice(0, 70));

  log('\n=== the dates reach the far end ===');
  const dates = { consultation_date: '2026-03-02', measurement_date: '2026-03-09',
                  first_fitting_date: '2026-04-06', final_fitting_date: '2026-04-20', review_date: '2026-05-04' };
  db.updateProject(projectId, dates);
  win.webContents.reload(); await wait(2200);
  const stored = db.getProject(projectId);
  for (const [key, value] of Object.entries(dates)) {
    check(stored[key] === value, `${key.replace(/_/g, ' ')} is kept`, `${stored[key]}`);
  }
  const onSummary = await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes('Persist')).click(); await wait(1100);
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Summary')).click(); await wait(1000);
    return document.body.innerText;
  })()`);
  check(/20 Apr 2026/.test(onSummary), 'and the final fitting shows on the summary', '');

  log(`\n${fail === 0 ? 'ALL PERSISTENCE CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
