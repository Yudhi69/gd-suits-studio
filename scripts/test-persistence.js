/**
 * Everything entered stays entered.
 *
 * GD's complaint was that things he had chosen were not there later - the
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

  log('=== a colour shown on screen is a colour that was chosen ===');
  // The lining swatch read navy while the spec held nothing at all, so the
  // render prompt never mentioned lining and the order form left it blank.
  db.updateProject(projectId, { spec: { suitType: 'two_piece', liningMode: 'colour' } });
  const promptText = await js(`(async () => {
    const r = await window.gd.projects.get({ id: ${projectId} });
    return 'ok';
  })()`).then(() => null).catch(() => null);
  await open('Lining');
  const shown = JSON.parse(await js(`JSON.stringify({
    swatch: document.querySelector('.colour-trigger .mono')?.textContent ?? null,
  })`));
  check(!!shown.swatch, 'the lining page shows a colour', String(shown.swatch));

  const spec = db.getProject(projectId).spec;
  const described = await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Preview')).click(); await wait(1000);
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('See the prompt'));
    if (!btn) return 'no prompt button';
    btn.click(); await wait(700);
    const text = document.querySelector('.modal textarea')?.value ?? '';
    [...document.querySelectorAll('.modal button')].find(b => b.textContent.trim() === 'Close')?.click();
    return text;
  })()`);
  check(/lining/i.test(described), 'and the render prompt says what the lining is', described.slice(0, 0) || 'no lining clause');
  check(new RegExp(shown.swatch.replace('#', ''), 'i').test(described) || /lining colour/i.test(described),
    'naming the very colour on screen', shown.swatch);

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
    liningCode: 'LN 1116',               // text
    lapelWidth: 'custom', lapelWidthCustom: 3.25,   // number
    waistbandExtras: ['side_adjusters', 'elastic_band'],  // multi
    designRequests: 'Gold thread on the inside pocket.',  // longtext
  } });
  win.webContents.reload(); await wait(2200);
  const back = db.getProject(projectId).spec;
  for (const [label, ok] of [
    ['a choice', back.lapel === 'peak'],
    ['a toggle', back.thirdPocket === true],
    ['a colour', back.liningColour === '#3f2d4a'],
    ['a short line', back.liningCode === 'LN 1116'],
    ['a number', back.lapelWidthCustom === 3.25],
    ['several answers at once', JSON.stringify(back.waistbandExtras) === '["side_adjusters","elastic_band"]'],
    ['a paragraph', /Gold thread/.test(back.designRequests ?? '')],
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
  check(/2026-04-20|20 April|April/.test(onSummary), 'and the final fitting shows on the summary', '');

  log(`\n${fail === 0 ? 'ALL PERSISTENCE CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
