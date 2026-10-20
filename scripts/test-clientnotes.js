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
  const js = (c) => win.webContents.executeJavaScript(c);

  log('=== guardian details for an under-age client ===');
  const stored = JSON.parse(await js(`(async () => {
    const un = async p => { const r = await p; if(!r.ok) throw new Error(r.error.message); return r.data; };
    const clientId = await un(window.gd.clients.save({
      name: 'Thabo', surname: 'Mokoena', contact: '082 111 2222',
      isMinor: true, secondaryName: 'Naledi Mokoena', secondaryRelationship: 'Mother',
      secondaryContact: '083 444 5555', secondaryEmail: 'naledi@example.com',
    }));
    const projectId = await un(window.gd.projects.create({ clientId, title: 'Matric ball', eventType: 'matric', eventDate: '2026-09-19' }));
    await un(window.gd.projects.update({ id: projectId, patch: {
      consultation_date: '2026-06-01', measurement_date: '2026-06-08',
      first_fitting_date: '2026-08-01', final_fitting_date: '2026-09-10', review_date: '2026-10-01',
      status: 'ready_first_fitting',
      spec: { suitType:'two_piece', buttonColour:'gold', bottomFinish:'tapered', monogramCollar:'T.M.', liningMode:'pattern' },
    } }));
    return JSON.stringify(await un(window.gd.projects.get({ id: projectId })));
  })()`));

  check(stored.is_minor === 1, 'the under-18 flag is stored');
  check(stored.secondary_name === 'Naledi Mokoena', 'the guardian name is stored', stored.secondary_name);
  check(stored.secondary_relationship === 'Mother', 'the relationship is stored');
  check(stored.secondary_contact === '083 444 5555', 'the guardian contact is stored');

  log('\n=== the process dates ===');
  check(stored.consultation_date === '2026-06-01', 'first consultation');
  check(stored.measurement_date === '2026-06-08', 'measurements');
  check(stored.first_fitting_date === '2026-08-01', 'first fitting');
  check(stored.final_fitting_date === '2026-09-10', 'final fitting & delivery');
  check(stored.review_date === '2026-10-01', 'review date', JSON.stringify(stored.review_date));

  log('\n=== the catalog changes ===');
  win.webContents.reload();
  await wait(1900);
  const ui = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    document.querySelector('tbody tr').click(); await wait(900);
    const tab = (name) => [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes(name));
    const labels = () => [...document.querySelectorAll('.field > label')].map(l => l.textContent);
    const options = () => [...document.querySelectorAll('.option')].map(o => o.textContent);

    tab('Jacket').click(); await wait(700);
    const jacket = { labels: labels(), options: options() };

    tab('Pants').click(); await wait(700);
    const pants = { labels: labels(), options: options() };

    tab('Extras').click(); await wait(700);
    const extras = { labels: labels() };

    // GD took the detail customisation page out of the flow.
    const tabs = [...document.querySelectorAll('.step-tab')].map(t => t.textContent.replace(/^[\d✓]+/, '').trim());

    tab('Lining').click(); await wait(700);
    const lining = { labels: labels(), options: options(), fileInputs: document.querySelectorAll('input[type=file]').length };

    const status = document.querySelector('.topbar .pill')?.textContent;
    return JSON.stringify({ jacket, pants, extras, tabs, lining, status });
  })()`));

  check(ui.jacket.labels.includes('Button Finish'), 'the jacket has a button finish choice', ui.jacket.labels.join(' | '));
  check(['Neutral','Gold','Silver','Other Colour'].every(o => ui.jacket.options.some(t => t.includes(o))),
    'with neutral, gold, silver and other - GD calls the last one other, not custom');
  check(!ui.jacket.labels.includes('Sleeve Buttons'), 'sleeve buttons are gone');
  check(ui.pants.labels.includes('Bottom Finish'), 'pants have a bottom finish', ui.pants.labels.join(' | '));
  check(['Slim Fit (Tapered)','Straight Cut','Boot Leg','Wide Leg'].every(o => ui.pants.options.some(t => t.includes(o))),
    'with the bottom fits GD listed', ui.pants.options.join(' | '));
  check(!ui.extras.labels.some(l => l === 'Button Colour'), 'the shirt button colour is gone', ui.extras.labels.join(' | '));
  check(!ui.tabs.some((t) => /Detail/.test(t)), 'the detail customisation page is gone, as GD asked', ui.tabs.join(' > '));
  check(ui.lining.labels.some(l => l.includes('collage')), 'the lining collage upload sits with the lining',
    ui.lining.labels.join(' | '));
  check(ui.lining.fileInputs > 0, 'and it offers a file picker');
  check(ui.status === 'Ready for first fitting', 'the status reads the stage GD named', ui.status);

  // Both were thrown away by main's update gate, which had never been told
  // about them: the switch sprang back on every click and the review date
  // was never kept. Driven here the way GD does it, on the Schedule card.
  log('\n=== the schedule card keeps what is set on it ===');
  const SCHEDULE = `
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const card = () => [...document.querySelectorAll('.card')].find(c => c.querySelector('h3')?.textContent === 'Schedule');
    const toggle = (name) => [...card().querySelectorAll('.toggle-row')].find(r => r.textContent.trim() === name)?.querySelector('[role=switch]');
    const on = (name) => toggle(name)?.getAttribute('aria-checked') === 'true';
    const stored = async () => { const r = await window.gd.projects.get({ id: ${stored.id} }); return r.data; };
  `;
  const schedule = JSON.parse(await js(`(async () => {
    ${SCHEDULE}
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Client')).click(); await wait(900);
    const before = { taken: on('Measurements taken'), form: on('Measurement form completed'), found: !!toggle('Measurements taken') };

    toggle('Measurements taken').click(); await wait(700);
    const afterTaken = { taken: on('Measurements taken'), stored: (await stored()).measurements_done };
    toggle('Measurement form completed').click(); await wait(700);
    const afterForm = { form: on('Measurement form completed'), stored: (await stored()).measurement_form_received };

    const box = [...card().querySelectorAll('.field')].find(f => f.querySelector('label')?.textContent === 'Review date')?.querySelector('input');
    box.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, '2026-10-24');
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    box.blur();
    await wait(700);
    return JSON.stringify({ before, afterTaken, afterForm, review: (await stored()).review_date, reviewShown: box.value });
  })()`));
  check(schedule.before.found && !schedule.before.taken, 'the Schedule card has the Measurements taken switch, off',
    JSON.stringify(schedule.before));
  check(schedule.afterTaken.taken && schedule.afterTaken.stored === 1, 'one click turns it on, and the order keeps it',
    JSON.stringify(schedule.afterTaken));
  check(schedule.afterForm.form && schedule.afterForm.stored === 1, 'as does Measurement form completed beside it',
    JSON.stringify(schedule.afterForm));
  check(schedule.review === '2026-10-24', 'the review date typed in is kept', JSON.stringify(schedule.review));

  win.webContents.reload();
  await wait(1900);
  const reopened = JSON.parse(await js(`(async () => {
    ${SCHEDULE}
    document.querySelector('tbody tr').click(); await wait(900);
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Client')).click(); await wait(900);
    const review = [...card().querySelectorAll('.field')].find(f => f.querySelector('label')?.textContent === 'Review date')?.querySelector('input')?.value;
    const shown = { taken: on('Measurements taken'), form: on('Measurement form completed'), review };
    toggle('Measurements taken').click(); await wait(700);
    return JSON.stringify({ shown, offAgain: !on('Measurements taken'), stored: (await stored()).measurements_done });
  })()`));
  check(reopened.shown.taken && reopened.shown.form && reopened.shown.review === '2026-10-24',
    'opened again, the order shows both switches on and the review date', JSON.stringify(reopened.shown));
  check(reopened.offAgain && reopened.stored === 0, 'and a second click turns it off again', JSON.stringify(reopened));

  log('\n=== what a page may change on an order ===');
  const gate = JSON.parse(await js(`(async () => {
    const id = ${stored.id};
    const get = async () => (await window.gd.projects.get({ id })).data;
    const every = await window.gd.projects.update({ id, patch: {
      title: 'Matric ball', event_type: 'matric', event_other: '', event_date: '2026-09-19', delivery_date: '2026-09-12',
      consultation_date: '2026-06-01', measurement_date: '2026-06-08', first_fitting_date: '2026-08-01',
      final_fitting_date: '2026-09-10', review_date: '2026-10-30', status: 'ready_first_fitting', quantity: 1,
      fabric_name: 'Navy twill', fabric_code: 'NV-1', supplier: 'Mill', first_appointment: '2026-06-01',
      appointment_notes: 'n', comments: 'c', lining: 'l', design: 'd', shirt: 's', balance_note: 'b',
      form_url: 'https://example.com/form', imported_balance: 0,
      measurements_done: true, measurement_form_received: true, form_printed: true,
    } });
    const afterEvery = await get();
    const unknown = await window.gd.projects.update({ id, patch: { title: 'Changed', measurementsDone: true } });
    const notArray = await window.gd.projects.update({ id, patch: ['title'] });
    const afterUnknown = await get();
    return JSON.stringify({
      every: every.ok, everyError: every.error?.message,
      kept: { review: afterEvery.review_date, done: afterEvery.measurements_done, printed: afterEvery.form_printed, supplier: afterEvery.supplier },
      unknown: { ok: unknown.ok, message: unknown.error?.message }, notArray: notArray.ok,
      title: afterUnknown.title,
    });
  })()`));
  check(gate.every && gate.kept.review === '2026-10-30' && gate.kept.done === 1 && gate.kept.printed === 1 && gate.kept.supplier === 'Mill',
    'every field the screens edit is accepted and kept', JSON.stringify({ error: gate.everyError, kept: gate.kept }));
  check(!gate.unknown.ok && /measurementsDone/.test(gate.unknown.message ?? ''),
    'a field main does not know is refused by name - never dropped without a word', JSON.stringify(gate.unknown));
  check(gate.title === 'Matric ball', '  and nothing else in that change is written', gate.title);
  check(!gate.notArray, 'a change that is not a set of fields is refused');

  log(`\n${fail === 0 ? 'ALL CLIENT-NOTE CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
