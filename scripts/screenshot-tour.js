const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const OUT = process.env.SHOT_DIR;
app.setPath('userData', require('path').resolve(process.env.DATA_DIR));

require('../electron/main.js');

const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
  log('  shot:', name);
}

app.whenReady().then(async () => {
  await wait(2500);
  const win = BrowserWindow.getAllWindows()[0];
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message);
  });

  // Seed a realistic consultation through the same IPC the UI uses.
  const seed = await win.webContents.executeJavaScript(`(async () => {
    const gd = window.gd;
    const un = async (p) => { const r = await p; if (!r.ok) throw new Error(r.error.message); return r.data; };
    const clientId = await un(gd.clients.save({ name: 'Sipho', surname: 'Ndlovu', contact: '082 555 0134', email: 'sipho@example.com' }));
    const projectId = await un(gd.projects.create({ clientId, title: 'Wedding suit - midnight blue', eventType: 'wedding', eventDate: '2026-11-14', deliveryDate: '2026-11-01' }));
    await un(gd.projects.update({ id: projectId, patch: { spec: {
      suitType: 'three_piece', jacketFit: 'slim', lapel: 'peak', lapelWidth: 'wide',
      tuxedoFinish: 'plain', breast: 'single', buttonsSingle: '2', pockets: 'flap',
      vents: 'double', sleeveButtons: '4', pantsFit: 'tapered', pleats: 'none',
      waistband: 'side_adjusters', waistbandJoin: 'single_button', hem: 'turn_up', turnUpWidth: 'slim',
      wcShape: 'v_cut', wcBreast: 'single', wcButtons: '5', wcLapel: 'lapel', wcPockets: 'standard',
      shirt: true, shirtCollar: 'cutaway', shirtCuff: 'french', neckwear: true, neckwearType: 'bow',
      lapelPin: true, liningMode: 'colour', liningColour: '#7b1113',
      monogramLining: 'Sipho & Naledi, 14.11.2026', stitching: 'black'
    }, analysis: {
      skinTone: { hex: '#6b4a32', label: 'Rich Brown, warm undertone', undertone: 'warm', luminance: 0.31 },
      fabricColour: { hex: '#1b2a4a', label: 'deep blue' }
    } } }));
    await un(gd.notes.add({ projectId, step: 'jacket', body: 'Client wants the peak lapel bold - showed a photo of a 1930s cut.' }));
    await un(gd.notes.add({ projectId, step: 'capture', body: 'Right shoulder sits noticeably lower. Balance the cut.' }));
    for (const [g, f, v] of [['jacket','chest',104],['jacket','waist',92],['jacket','shoulder',46.5],['jacket','sleeve',64],['pants','pantWaist',88],['pants','inseam',79]]) {
      await un(gd.measurements.save({ projectId, garment: g, fieldId: f, value: v }));
      await un(gd.clientMeasurements.save({ clientId, garment: g, fieldId: f, value: v }));
    }
    return { clientId, projectId };
  })()`);
  log('seeded:', JSON.stringify(seed));

  win.webContents.reload();
  await wait(1800);
  await shot(win, '01-dashboard');

  // Open the order, then walk the stepper.
  const steps = await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('tbody tr').click();
    await new Promise(r => setTimeout(r, 900));
    return [...document.querySelectorAll('.step-tab')].map(b => b.textContent.trim());
  })()`);
  log('steps:', steps.join(' | '));
  await shot(win, '02-client-step');

  for (const [i, name] of [[1,'03-capture'],[2,'04-cloth'],[4,'05-jacket'],[9,'06-measurements'],[10,'07-preview'],[12,'08-summary']]) {
    await win.webContents.executeJavaScript(`(async () => {
      const tabs = document.querySelectorAll('.step-tab');
      if (tabs[${i}]) tabs[${i}].click();
      await new Promise(r => setTimeout(r, 700));
    })()`);
    await shot(win, name);
  }

  // Settings
  await win.webContents.executeJavaScript(`(async () => {
    [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Settings')).click();
    await new Promise(r => setTimeout(r, 700));
  })()`);
  await shot(win, '09-settings');

  log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'no console errors');
  app.exit(0);
}).catch((e) => { log('FAIL', e.stack); app.exit(1); });
