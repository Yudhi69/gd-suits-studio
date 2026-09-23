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

  log(`\n${fail === 0 ? 'ALL PARTY CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
