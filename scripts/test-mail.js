/**
 * Standing emails: the wording, when they fall due, and who they are for.
 *
 * The thing worth checking hardest is that nothing is sent. There is no mail
 * server here and no password for anybody's mailbox - a rule decides what is
 * *due*, and a person still presses send in their own mail client. A tool
 * that quietly emailed clients on a timer would be one bad template away from
 * sending four hundred people the wrong thing.
 */
const { app, BrowserWindow, shell } = require('electron');
require('./fresh.js').freshUserData(app);

// Opening a draft hands a mailto: to the operating system. Recorded here
// instead, which also lets the tests read what would have gone out.
const drafts = [];
shell.openExternal = async (url) => { drafts.push(String(url)); return true; };

require('../electron/main.js');
const db = require('../electron/db.js');
const rules = require('../electron/mailRules.js');

let pass = 0, fail = 0;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (offset) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

app.whenReady().then(async () => {
  await wait(2400);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c);
  const call = (ch, arg) => js(`window.gd.${ch}(${JSON.stringify(arg ?? {})}).then(r => JSON.stringify(r.ok ? { data: r.data } : { error: r.error.message }))`).then(JSON.parse);

  log('=== when a rule falls due ===');
  check(rules.dueOn({ anchor: 'event_date', offsetDays: -7 }, { event_date: '2026-11-14' }) === '2026-11-07',
    'a week before the event is seven days earlier');
  check(rules.dueOn({ anchor: 'event_date', offsetDays: 2 }, { event_date: '2026-11-14' }) === '2026-11-16',
    'and two days after is two days later');
  check(rules.dueOn({ anchor: 'event_date', offsetDays: -7 }, { event_date: '' }) === null,
    'an order with no date set is never due');
  // Months and years are where date arithmetic usually goes wrong.
  check(rules.dueOn({ anchor: 'event_date', offsetDays: -7 }, { event_date: '2027-01-03' }) === '2026-12-27',
    'a week before the third of January is the year before');
  check(rules.dueOn({ anchor: 'event_date', offsetDays: 1 }, { event_date: '2028-02-28' }) === '2028-02-29',
    'and a leap day is counted');
  check(rules.normalise({ offsetDays: 90000 }).offsetDays === 365, 'an absurd offset is clamped, not stored');
  check(rules.normalise({ anchor: 'whenever' }).anchor === 'event_date', 'an anchor that is not a date falls back');
  check(rules.describe({ anchor: 'final_fitting_date', offsetDays: -7 }).includes('1 week before'),
    'and a rule reads back in words', rules.describe({ anchor: 'final_fitting_date', offsetDays: -7 }));

  log('\n=== who it goes to ===');
  check(rules.covers({ audience: 'all' }, 9, []), 'everyone, by default');
  check(rules.covers({ audience: 'only' }, 9, [9]) && !rules.covers({ audience: 'only' }, 8, [9]),
    'only the clients picked');
  check(!rules.covers({ audience: 'except' }, 9, [9]) && rules.covers({ audience: 'except' }, 8, [9]),
    'everyone except the clients picked');
  check(!rules.covers({ audience: 'only' }, 9, []), '"only" with nobody picked goes to nobody');
  check(rules.covers({ audience: 'except' }, 9, []), 'and "except" with nobody picked goes to everyone');

  log('\n=== a rule, and the orders it catches ===');
  const soon = db.upsertClient({ name: 'Sipho', surname: 'Ndlovu', contact: '', email: 'sipho@example.com' });
  const later = db.upsertClient({ name: 'James', surname: 'Botha', contact: '', email: 'james@example.com' });
  const noEmail = db.upsertClient({ name: 'Nomsa', surname: 'Dlamini', contact: '082', email: '' });
  const soonId = db.createProject({ clientId: soon, title: 'Wedding' });
  const laterId = db.createProject({ clientId: later, title: 'Wedding' });
  const noEmailId = db.createProject({ clientId: noEmail, title: 'Wedding' });
  db.updateProject(soonId, { event_date: day(7) });     // a week away - due today
  db.updateProject(laterId, { event_date: day(60) });   // two months away
  db.updateProject(noEmailId, { event_date: day(7) });

  const made = await call('mail.saveRule', {
    name: 'A week before', anchor: 'event_date', offsetDays: -7, audience: 'all',
    subject: 'About {order_ref}', body: 'Hi {client_first}, your suit is for {event_date}.',
  });
  check(made.data?.id, 'a rule can be written', JSON.stringify(made.error));

  let due = (await call('mail.due')).data;
  const refs = due.due.map((d) => d.client);
  check(refs.includes('Sipho Ndlovu'), 'the order a week out is due', JSON.stringify(refs));
  check(!refs.includes('James Botha'), 'the one two months out is not');
  check(!refs.includes('Nomsa Dlamini'), 'and an order with no email address is never offered');

  log('\n=== picking and excluding clients ===');
  await call('mail.saveRule', { id: made.data.id, name: 'A week before', anchor: 'event_date', offsetDays: -7,
    audience: 'except', clientIds: [soon], subject: 's', body: 'b' });
  due = (await call('mail.due')).data;
  check(!due.due.some((d) => d.client === 'Sipho Ndlovu'), 'an excluded client drops out');

  await call('mail.saveRule', { id: made.data.id, name: 'A week before', anchor: 'event_date', offsetDays: -7,
    audience: 'only', clientIds: [later], subject: 's', body: 'b' });
  due = (await call('mail.due', { on: day(53) })).data;
  check(due.due.length === 1 && due.due[0].client === 'James Botha',
    'and "only" leaves just the one picked', JSON.stringify(due.due.map((d) => d.client)));

  log('\n=== the draft, and what it says ===');
  await call('mail.saveRule', { id: made.data.id, name: 'A week before', anchor: 'event_date', offsetDays: -7,
    audience: 'all', subject: 'About {order_ref}', body: 'Hi {client_first}, your suit is for {event_date}.' });
  due = (await call('mail.due')).data;
  const target = due.due.find((d) => d.client === 'Sipho Ndlovu');
  const before = drafts.length;
  const sent = await call('mail.send', { ruleId: target.ruleId, projectId: target.projectId });
  check(sent.data?.opened === true, 'sending opens a draft', JSON.stringify(sent.error));
  // The address is percent-encoded in a mailto:, so it is read back decoded.
  check(drafts.length === before + 1
      && decodeURIComponent(drafts[drafts.length - 1]).startsWith('mailto:sipho@example.com'),
    'addressed to the client, in their own mail program', drafts[drafts.length - 1]?.slice(0, 60));
  const draft = decodeURIComponent(drafts[drafts.length - 1]);
  check(draft.includes('Hi Sipho,'), 'with the placeholders filled in', draft.slice(0, 120));
  check(draft.includes(day(7)), 'including the date it is counting from');

  log('\n=== and it is not offered twice ===');
  due = (await call('mail.due')).data;
  check(!due.due.some((d) => d.client === 'Sipho Ndlovu'), 'once sent, it stops being due');

  log('\n=== overdue is still due ===');
  db.updateProject(laterId, { event_date: day(-3) });  // the event has been and gone
  due = (await call('mail.due')).data;
  const james = due.due.find((d) => d.client === 'James Botha');
  check(james && james.overdue === true, 'a reminder whose day has passed is still offered, and says so',
    JSON.stringify(james));

  log('\n=== nothing is sent without a person ===');
  const beforeIdle = drafts.length;
  await call('mail.due');
  await call('mail.rules');
  check(drafts.length === beforeIdle, 'reading what is due sends nothing at all');

  log('\n=== what a hostile page gets ===');
  const hostile = await call('mail.saveRule', {
    name: 'x'.repeat(5000), anchor: '../../etc', offsetDays: 1e9, audience: 'everyone',
    subject: 's', body: 'b', clientIds: ['not-an-id'],
  });
  check(!!hostile.error, 'a client id that is not an id is refused outright', JSON.stringify(hostile.data));

  // The same nonsense without the bad id: accepted, but nothing stored as given.
  const clamped = await call('mail.saveRule', {
    name: 'x'.repeat(5000), anchor: '../../etc', offsetDays: 1e9, audience: 'everyone', subject: 's', body: 'b',
  });
  const stored = db.listMailRules().find((r) => r.id === clamped.data?.id);
  check(stored && stored.name.length <= 120 && stored.anchor === 'event_date'
    && stored.audience === 'all' && Math.abs(stored.offset_days) <= 365,
    'and every other field is clamped rather than trusted',
    JSON.stringify(stored && { n: stored.name.length, a: stored.anchor, au: stored.audience, o: stored.offset_days }));

  log('\n=== the buttons GD actually presses ===');
  win.webContents.reload(); await wait(2400);
  const ui = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const find = (t) => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === t);
    [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Settings')).click(); await wait(900);
    const emailsTab = [...document.querySelectorAll('.step-tab')].find(t => t.textContent.trim() === 'Emails');
    if (!emailsTab) return JSON.stringify({ tab: false });
    emailsTab.click(); await wait(800);

    const listed = [...document.querySelectorAll('.mail-rule .mail-rule-main')].map(e => e.textContent.trim().slice(0, 40));
    const newBtn = find('New email');
    if (!newBtn) return JSON.stringify({ tab: true, listed, noNewButton: true,
      buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).slice(0, 20) });
    newBtn.click(); await wait(700);

    const dialog = document.querySelector('.modal-backdrop');
    if (!dialog) return JSON.stringify({ tab: true, listed, noDialog: true });
    const picker = [...dialog.querySelectorAll('select')].find(s => s.options[0]?.text.includes('Insert a detail'));
    if (!picker) return JSON.stringify({ tab: true, listed, noPicker: true,
      selects: [...dialog.querySelectorAll('select')].map(s => s.options[0]?.text) });
    const variables = [...(picker?.options ?? [])].slice(1).map(o => o.value);

    // Type a sentence, put the cursor in the middle of it, and insert there.
    const body = dialog.querySelector('textarea');
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setValue.call(body, 'Dear , your suit is ready.');
    body.dispatchEvent(new Event('input', { bubbles: true })); await wait(250);
    body.focus(); body.setSelectionRange(5, 5);
    const setSelect = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setSelect.call(picker, 'client_first');
    picker.dispatchEvent(new Event('change', { bubbles: true })); await wait(400);
    const afterInsert = dialog.querySelector('textarea').value;

    // Name it and save.
    const name = dialog.querySelector('input.input');
    const setInput = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setInput.call(name, 'Day before the fitting');
    name.dispatchEvent(new Event('input', { bubbles: true })); await wait(250);
    [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Add this email').click();
    await wait(900);

    return JSON.stringify({
      tab: true, listed, variables, afterInsert,
      nowListed: [...document.querySelectorAll('.mail-rule .mail-rule-main')].map(e => e.textContent.trim()),
    });
  })()`));
  check(ui.tab, 'Settings has a page for emails');
  check(ui.listed?.length >= 1, 'which lists the standing ones', JSON.stringify(ui.listed));
  check(ui.variables?.length >= 14, 'the message offers every detail the database holds',
    `${ui.variables?.length} offered`);
  check(ui.afterInsert === 'Dear {client_first}, your suit is ready.',
    'and inserts the one picked where the cursor was, not at the end', JSON.stringify(ui.afterInsert));
  check((ui.nowListed ?? []).some((t) => t.includes('Day before the fitting')),
    'a new email can be written and saved', JSON.stringify(ui.nowListed));
  const saved = db.listMailRules().find((r) => r.name === 'Day before the fitting');
  check(saved && saved.body.includes('{client_first}'), 'and it is stored with the detail in it');

  log(`\n${fail === 0 ? 'ALL MAIL CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
