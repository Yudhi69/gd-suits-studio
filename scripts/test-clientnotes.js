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
      first_fitting_date: '2026-08-01', final_fitting_date: '2026-09-10',
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

    tab('Detail').click(); await wait(700);
    const details = { labels: labels(), options: options(), fileInputs: document.querySelectorAll('input[type=file]').length };

    tab('Lining').click(); await wait(700);
    const lining = { labels: labels(), options: options(), fileInputs: document.querySelectorAll('input[type=file]').length };

    const status = document.querySelector('.topbar .pill')?.textContent;
    return JSON.stringify({ jacket, pants, extras, details, lining, status });
  })()`));

  check(ui.jacket.labels.includes('Button Finish'), 'the jacket has a button finish choice', ui.jacket.labels.join(' | '));
  check(['Neutral','Gold','Silver','Other Colour'].every(o => ui.jacket.options.some(t => t.includes(o))),
    'with neutral, gold, silver and other - GD calls the last one other, not custom');
  check(!ui.jacket.labels.includes('Sleeve Buttons'), 'sleeve buttons are gone');
  check(ui.pants.labels.includes('Bottom Finish'), 'pants have a bottom finish', ui.pants.labels.join(' | '));
  check(['Slim Fit (Tapered)','Straight Cut','Boot Leg','Wide Leg'].every(o => ui.pants.options.some(t => t.includes(o))),
    'with the bottom fits GD listed', ui.pants.options.join(' | '));
  check(!ui.extras.labels.some(l => l === 'Button Colour'), 'the shirt button colour is gone', ui.extras.labels.join(' | '));
  check(ui.details.labels.some(l => l.includes('Embroidery Monogram')), 'the monogram is one field with places to choose',
    ui.details.labels.join(' | '));
  check(ui.details.options.some(o => o.includes('Jacket collar')), 'and the jacket collar is one of them', ui.details.options.join(' | '));
  check(ui.lining.labels.some(l => l.includes('collage')), 'the lining collage upload sits with the lining',
    ui.lining.labels.join(' | '));
  check(ui.lining.fileInputs > 0, 'and it offers a file picker');
  check(ui.status === 'Ready for first fitting', 'the status reads the stage GD named', ui.status);

  log(`\n${fail === 0 ? 'ALL CLIENT-NOTE CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
