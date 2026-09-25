/**
 * The client file, the order code and the schedule, as GD asked for them.
 *
 * The stage names changed in this work, which is the kind of rename that
 * leaves half a dashboard counting a word nothing writes any more - so the
 * figures are checked here too, not just the form.
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

  log('=== a new order starts at the first stage ===');
  const clientId = db.upsertClient({ name: 'Zanele', surname: 'Mahlangu', contact: '082', email: 'z@example.com' });
  const projectId = db.createProject({ clientId, title: 'Matric suit' });
  check(db.getProject(projectId).status === 'first_consultation',
    'not "draft", a stage the pipeline no longer has', db.getProject(projectId).status);

  log('\n=== date of birth, age and postal address ===');
  const born = new Date(Date.now() - 17 * 365.25 * 864e5).toISOString().slice(0, 10);
  await js(`window.gd.clients.save({ id: ${clientId}, name: 'Zanele', surname: 'Mahlangu',
    contact: '082', email: 'z@example.com', dob: ${JSON.stringify(born)},
    postalAddress: '12 Loop Street\\nCape Town\\n8001' })`);
  const saved = db.getClient(clientId);
  check(saved.dob === born, 'the date of birth is stored', saved.dob);
  check(/Loop Street/.test(saved.postal_address), 'and the postal address', JSON.stringify(saved.postal_address));
  check(!('age' in saved), 'age is not stored - a number typed today is wrong by the next birthday');

  win.webContents.reload(); await wait(2200);
  const form = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes('Zanele')).click(); await wait(1100);
    const field = (label) => {
      const f = [...document.querySelectorAll('.field')].find(x => x.querySelector('label')?.textContent.trim() === label);
      return f?.querySelector('input, textarea')?.value ?? null;
    };
    const headings = [...document.querySelectorAll('.card-head h3')].map(h => h.textContent.trim());
    const labels = [...document.querySelectorAll('.field label')].map(l => l.textContent.trim());
    const statuses = [...document.querySelectorAll('select')]
      .map(s => [...s.options].map(o => o.textContent.trim()))
      .find(opts => opts.includes('Quoted')) ?? [];
    return JSON.stringify({
      headings, labels, statuses,
      age: field('Age'), dob: field('Date of birth'), postal: field('Postal address'),
      ageReadOnly: [...document.querySelectorAll('.field')]
        .find(x => x.querySelector('label')?.textContent.trim() === 'Age')?.querySelector('input')?.readOnly === true,
      tabs: [...document.querySelectorAll('.step-tab')].map(t => t.textContent.replace(/^[\\d✓]+/, '').trim()),
    });
  })()`));

  check(form.age === '17', 'the age is worked out from the date of birth', String(form.age));
  check(form.ageReadOnly, 'and cannot be typed over');
  check(form.dob === born, 'the date of birth shows on the form');
  check(/Loop Street/.test(form.postal || ''), 'so does the postal address');

  log('\n=== the headings GD asked for ===');
  check(form.headings.includes('Parent or provider'), '"Parent or provider", not guardian', form.headings.join(' | '));
  // GD meant the field, not the section: the occasion keeps its heading and
  // the order's own code is the line inside it.
  check(form.headings.includes('The occasion'), 'the occasion keeps its heading', form.headings.join(' | '));
  check(form.labels.includes('Order code'), 'and "Order code" is the field', form.labels.slice(0, 12).join(' | '));
  check(form.headings.includes('Schedule'), 'and the schedule');

  log('\n=== the five dates, and the two ticks moved off the order ===');
  for (const label of ['First consultation', 'Measurement date', 'First fitting', 'Final fitting & delivery', 'Review date']) {
    check(form.labels.includes(label), `the schedule carries "${label}"`, '');
  }
  const ticks = await js(`JSON.stringify([...document.querySelectorAll('.toggle-row')].map(t => t.textContent.trim()))`);
  check(/Measurements taken/.test(ticks), 'measurements taken is ticked here', ticks);
  check(/Measurement form completed/.test(ticks), 'and the form completed', ticks);

  log('\n=== the nine stages ===');
  const expected = [
    'First consultation', 'Quoted', 'Deposit paid (production pending)', 'In production',
    'Ready for first fitting', 'Alterations', 'Ready for final fit',
    'Completed (final deposit due)', 'Completed (paid)',
  ];
  check(JSON.stringify(form.statuses) === JSON.stringify(expected),
    'exactly the nine stages, in order', form.statuses.join(' | '));

  log('\n=== the order of the work ===');
  const order = form.tabs;
  check(order[0] === 'Client' && order[1] === 'Order', 'client, then order');
  check(order[2] === 'Base Garment', 'then the garment, straight after the order it belongs to', order.join(' > '));
  check(order.indexOf('Capture') > order.indexOf('Extras'), 'the photographs come after the suit is specified', order.join(' > '));
  check(order.indexOf('Fitting') > order.indexOf('Preview'), 'and the fitting last but one');

  log('\n=== alterations moved, extras gone ===');
  const where = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const tab = (t) => [...document.querySelectorAll('.step-tab')].find(x => x.textContent.includes(t));
    tab('Order').click(); await wait(800);
    const onOrder = [...document.querySelectorAll('.card-head h3')].map(h => h.textContent.trim());
    tab('Fitting').click(); await wait(900);
    const onFitting = [...document.querySelectorAll('.card-head h3')].map(h => h.textContent.trim());
    return JSON.stringify({ onOrder, onFitting });
  })()`));
  check(where.onOrder.includes('Order details'), '"The job" is now "Order details"', where.onOrder.join(' | '));
  check(!where.onOrder.includes('Alterations'), 'alterations are off the order page');
  check(where.onFitting.includes('Alterations'), 'and on the fitting page, where they start', where.onFitting.join(' | '));
  check(!where.onOrder.some((h) => h === 'Extras'), 'the extras section is off the order page', where.onOrder.join(' | '));
  check(where.onOrder.includes('Money'), 'the money stays on the order');

  log('\n=== the figures survived the rename ===');
  db.updateProject(projectId, { status: 'completed_paid' });
  db.setQuote(projectId, { lines: [{ group: 'Base', label: 'Suit', amount: 5000, key: 'k' }], total: 5000, currency: 'R' });
  const a = db.analytics();
  check(a.totals.delivered >= 1, 'a completed order counts as completed', String(a.totals.delivered));
  check(a.totals.openOrders === a.totals.orders - a.totals.delivered,
    'and is no longer counted as open', `${a.totals.openOrders} open of ${a.totals.orders}`);
  check(a.byStage.completed_paid?.orders >= 1, 'the pipeline knows the new stage', JSON.stringify(Object.keys(a.byStage)));

  log('\n=== every status fits on one line ===');
  // On a narrow window the status column wrapped: "Ready for first fitting"
  // became two lines and a pill twice the height of the one beside it. Every
  // stage is put on the list and read back at a width where that happened.
  const stages = ['first_consultation', 'quoted', 'deposit_paid', 'in_production', 'ready_first_fitting',
    'alterations', 'ready_final_fit', 'completed_due', 'completed_paid'];
  for (const [i, status] of stages.entries()) {
    const cid = db.upsertClient({ name: `Stage${i}`, surname: 'Check', contact: '', email: '' });
    const pid = db.createProject({ clientId: cid, title: `Stage ${i}` });
    await js(`window.gd.projects.update({ id: ${pid}, patch: { status: '${status}' } })`);
  }
  const [wWas, hWas] = win.getSize();
  win.setSize(950, hWas);
  win.webContents.reload(); await wait(2400);
  const list = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Orders')).click(); await wait(900);
    const pills = [...document.querySelectorAll('.table tbody td .pill')].map(p => ({
      text: p.textContent.trim(), h: Math.round(p.getBoundingClientRect().height),
    }));
    const card = document.querySelector('.table').closest('.card');
    return JSON.stringify({ pills, overflowX: getComputedStyle(card).overflowX,
      scrolls: card.scrollWidth > card.clientWidth });
  })()`));
  win.setSize(wWas, hWas);
  const seen = new Set(list.pills.map((p) => p.text));
  check(stages.length <= seen.size, 'every stage is on the list', JSON.stringify([...seen]));
  const heights = new Set(list.pills.map((p) => p.h));
  check(heights.size === 1, 'and every status is one line, the same height as the rest',
    JSON.stringify(list.pills.filter((p) => p.h !== Math.min(...heights)).map((p) => `${p.text} ${p.h}`)));
  check(list.overflowX === 'auto', 'a table too wide for the window scrolls inside its card',
    `overflow-x: ${list.overflowX}`);

  log(`\n${fail === 0 ? 'ALL CLIENT & ORDER CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
