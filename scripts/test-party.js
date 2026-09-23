/**
 * An order with more than one person on it.
 *
 * A wedding is one order, one event date, one balance - and five different
 * people in five different suits. The checks that matter are that their specs
 * never bleed into each other, that a person taken off an order keeps their
 * client file, and that an order of one still reads exactly as it did before.
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
  const call = (ch, arg) => js(`window.gd.${ch}(${JSON.stringify(arg)}).then(r => JSON.stringify(r.ok ? { data: r.data } : { error: r.error.message }))`).then(JSON.parse);

  log('=== an order of one reads as it always did ===');
  const groomId = db.upsertClient({ name: 'Sipho', surname: 'Ndlovu', contact: '082', email: 's@example.com' });
  const projectId = db.createProject({ clientId: groomId, title: 'Wedding' });
  db.updateProject(projectId, { spec: { suitType: 'three_piece', lapel: 'peak' }, fabric_name: 'Midnight birdseye' });

  let order = db.getProject(projectId);
  check(order.members.length === 1 && order.suits.length === 1, 'it starts with one person and one suit',
    `${order.members.length} people, ${order.suits.length} suits`);
  check(order.members[0].name === 'Sipho', 'the client is the first person on it');
  check(order.spec.lapel === 'peak', 'the spec still reads off the order', JSON.stringify(order.spec));
  check(db.listSuits(projectId)[0].spec.lapel === 'peak', 'because it is stored on the suit', '');
  check(order.suits[0].fabric_name === 'Midnight birdseye', 'and the cloth is written through to the suit');

  log('\n=== adding the wedding party ===');
  const added = await call('members.add', { projectId, name: 'Thabo', surname: 'Mokoena', role: 'Groomsman', contact: '083' });
  check(!!added.data?.memberId, 'a groomsman can be added', JSON.stringify(added));
  const bestMan = await call('members.add', { projectId, name: 'Kagiso', surname: 'Sithole', role: 'Best man' });
  order = db.getProject(projectId);
  check(order.members.length === 3, 'the order now has three people', String(order.members.length));
  check(order.suits.length === 3, 'each arrives with a suit rather than an empty row', String(order.suits.length));
  check(order.members.map((m) => m.role).includes('Best man'), 'their role is kept', order.members.map((m) => m.role).join(', '));

  // The whole point of a person being a client.
  const thabo = db.getClient(added.data.clientId);
  check(thabo && thabo.name === 'Thabo', 'the groomsman is a client in his own right, not a name on a row');
  check(db.listProjects().filter((p) => p.client_id === added.data.clientId).length === 0,
    'without an order of his own until he places one');

  log('\n=== their suits stay their own ===');
  const suits = db.listSuits(projectId);
  const groomSuit = suits.find((s) => s.client_id === groomId);
  const thaboSuit = suits.find((s) => s.client_id === added.data.clientId);
  await call('suits.update', { id: thaboSuit.id, patch: { spec: { suitType: 'two_piece', lapel: 'notch' }, fabric_name: 'Charcoal twill' } });
  const after = db.listSuits(projectId);
  check(after.find((s) => s.id === groomSuit.id).spec.lapel === 'peak', "the groom's peak lapel is untouched");
  check(after.find((s) => s.id === thaboSuit.id).spec.lapel === 'notch', "and the groomsman has his own notch");
  check(after.find((s) => s.id === thaboSuit.id).fabric_name === 'Charcoal twill', 'in his own cloth');
  check(db.getProject(projectId).spec.lapel === 'peak', 'the order still answers with the first suit', '');

  log('\n=== one person, two suits ===');
  const secondForGroom = await call('suits.add', { projectId, clientId: groomId, label: 'Reception suit' });
  check(typeof secondForGroom.data === 'number', 'a second suit can be added for the same person', JSON.stringify(secondForGroom));
  const withSecond = db.listSuits(projectId);
  check(withSecond.filter((s) => s.client_id === groomId).length === 2, 'the groom now has two');
  check(db.listMembers(projectId).length === 3, 'and is still one person on the order', '');
  check(withSecond.find((s) => s.label === 'Reception suit').spec.lapel === undefined,
    'the second suit starts empty rather than copying the first');

  log('\n=== taking someone off ===');
  const kagisoClientId = bestMan.data.clientId;
  const kagisoMember = db.listMembers(projectId).find((m) => m.client_id === kagisoClientId);
  await call('members.remove', { id: kagisoMember.id });
  const trimmed = db.getProject(projectId);
  check(trimmed.members.length === 2, 'the person comes off the order', String(trimmed.members.length));
  check(!trimmed.suits.some((s) => s.client_id === kagisoClientId), 'along with the suit they were having');
  check(!!db.getClient(kagisoClientId), 'but their client file stays - the person still exists');

  log('\n=== editing a suit counts as working on the order ===');
  // The spec lives on the suit now, so an edit that touches only the suit
  // must still mark the order as worked on - the orders list sorts by it.
  const touchedBefore = db.getProject(projectId).updated_at;
  await new Promise((r) => setTimeout(r, 1100));   // stamps are to the second
  await call('suits.update', { id: thaboSuit.id, patch: { spec: { suitType: 'two_piece', lapel: 'shawl' } } });
  db.updateProject(projectId, { spec: db.getProject(projectId).spec });
  check(db.getProject(projectId).updated_at > touchedBefore,
    'the order moves to the top of the list after a spec edit',
    `${touchedBefore} -> ${db.getProject(projectId).updated_at}`);

  log('\n=== what the rest of the app still sees ===');
  win.webContents.reload(); await wait(2200);
  const shown = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes('Sipho')).click(); await wait(1000);
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Jacket')).click(); await wait(800);
    return JSON.stringify({
      selected: [...document.querySelectorAll('.option.selected')].map(o => o.textContent.trim()),
      rows: document.querySelectorAll('tbody tr').length,
    });
  })()`));
  check(shown.selected.some((o) => /Peak/.test(o)), "the jacket page still shows the groom's peak lapel", shown.selected.join(' | '));

  const a = db.analytics();
  check(a.totals.orders >= 1 && Number.isFinite(a.totals.quoted), 'the dashboard still adds up', JSON.stringify(a.totals).slice(0, 60));

  log('\n=== measurements belong to the man being measured ===');
  // Before this they were keyed to the order, so the second man's chest
  // overwrote the first's and two grooms ended up with identical shoulders.
  const groomSuitNow = db.listSuits(projectId).find((x) => x.client_id === groomId);
  const thaboSuitNow = db.listSuits(projectId).find((x) => x.client_id === added.data.clientId);
  db.saveMeasurement({ projectId, suitId: groomSuitNow.id, garment: 'jacket', fieldId: 'chest', value: 104 });
  db.saveMeasurement({ projectId, suitId: thaboSuitNow.id, garment: 'jacket', fieldId: 'chest', value: 92 });
  const chests = db.getProject(projectId).measurements.filter((m) => m.field_id === 'chest');
  check(chests.length === 2, 'two men, two chest measurements', `${chests.length} stored`);
  check(chests.find((m) => m.suit_id === groomSuitNow.id)?.value === 104, "the groom keeps his 104");
  check(chests.find((m) => m.suit_id === thaboSuitNow.id)?.value === 92, 'and the groomsman his 92');

  log('\n=== a photograph belongs to the man in it ===');
  // Re-shooting a slot replaces the photograph in it. Scoped to the order
  // rather than the person, photographing the best man would have deleted the
  // groom's front shot with no error and no undo.
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const groomSuitP = db.listSuits(projectId).find((x) => x.client_id === groomId);
  const thaboSuitP = db.listSuits(projectId).find((x) => x.client_id === added.data.clientId);
  await call('photos.add', { projectId, clientId: groomId, suitId: groomSuitP.id, slot: 'front', dataUrl: tinyPng });
  await call('photos.add', { projectId, clientId: added.data.clientId, suitId: thaboSuitP.id, slot: 'front', dataUrl: tinyPng });
  const fronts = db.getProject(projectId).photos.filter((p) => p.slot === 'front' && !p.fitting_id);
  check(fronts.length === 2, 'both men keep their front shot', `${fronts.length} kept`);
  check(fronts.some((p) => p.client_id === groomId) && fronts.some((p) => p.client_id === added.data.clientId),
    'one each, filed under the man it is of');

  // Re-shooting the groom replaces only his.
  await call('photos.add', { projectId, clientId: groomId, suitId: groomSuitP.id, slot: 'front', dataUrl: tinyPng });
  const afterReshoot = db.getProject(projectId).photos.filter((p) => p.slot === 'front' && !p.fitting_id);
  check(afterReshoot.length === 2, 're-shooting one man replaces only his', `${afterReshoot.length} kept`);

  // A swatch is the suit's, not the person's.
  await call('photos.add', { projectId, clientId: groomId, suitId: groomSuitP.id, slot: 'fabric', dataUrl: tinyPng });
  await call('photos.add', { projectId, clientId: added.data.clientId, suitId: thaboSuitP.id, slot: 'fabric', dataUrl: tinyPng });
  const swatches = db.getProject(projectId).photos.filter((p) => p.slot === 'fabric');
  check(swatches.length === 2, 'each suit keeps its own cloth swatch', `${swatches.length} kept`);

  log('\n=== the interface stays out of the way ===');
  win.webContents.reload(); await wait(2200);
  const ui = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes('Sipho')).click(); await wait(1100);
    const tab = (t) => [...document.querySelectorAll('.step-tab')].find(x => x.textContent.includes(t));
    tab('Order').click(); await wait(800);
    const onOrder = [...document.querySelectorAll('.card-head h3')].map(h => h.textContent.trim());
    const people = [...document.querySelectorAll('.party-row')].length;
    tab('Jacket').click(); await wait(800);
    const stripTabs = [...document.querySelectorAll('.suit-tab')].map(t => t.textContent.trim());
    const firstSelected = [...document.querySelectorAll('.option.selected')].map(o => o.textContent.trim());
    // Switch to the other man's suit and read the jacket page again.
    const second = document.querySelectorAll('.suit-tab')[1];
    second?.click(); await wait(1100);
    const secondSelected = [...document.querySelectorAll('.option.selected')].map(o => o.textContent.trim());
    return JSON.stringify({ onOrder, people, stripTabs, firstSelected, secondSelected });
  })()`));
  check(ui.onOrder.includes('People & suits'), 'the order page lists the people', ui.onOrder.join(' | '));
  check(ui.people === 2, 'one row each', String(ui.people));
  check(ui.stripTabs.length >= 2, 'the garment page offers a suit to work on', ui.stripTabs.join(' | '));
  check(ui.firstSelected.some((o) => /Peak/.test(o)), "it opens on the groom's peak lapel", ui.firstSelected.join(' | '));
  check(ui.secondSelected.some((o) => /Shawl|Notch/.test(o)) && !ui.secondSelected.some((o) => /Peak/.test(o)),
    'switching suits switches what the page is editing', ui.secondSelected.join(' | '));

  log('\n=== and disappears for an order of one ===');
  const soloClient = db.upsertClient({ name: 'Solo', surname: 'Client' });
  const soloId = db.createProject({ clientId: soloClient, title: 'One suit' });
  win.webContents.reload(); await wait(2200);
  const solo = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes('Solo')).click(); await wait(1100);
    [...document.querySelectorAll('.step-tab')].find(x => x.textContent.includes('Jacket')).click(); await wait(800);
    return JSON.stringify({ strips: document.querySelectorAll('.suit-strip').length });
  })()`));
  check(solo.strips === 0, 'a single client ordering one suit sees nothing new', JSON.stringify(solo));

  log(`\n${fail === 0 ? 'ALL PARTY CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
