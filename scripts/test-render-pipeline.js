const { app, BrowserWindow } = require('electron');
require('./fresh.js').freshUserData(app);

const log = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => { ok ? (pass++, log('  \u2713', label)) : (fail++, log('  \u2717 FAIL:', label, detail)); };

// Intercept the one outbound call the app makes, so the whole render pipeline
// can be exercised without a real key or network.
const captured = [];
// Which render calls should come back as failures, counted from the next
// reset. Rendering four views at once has to behave when the third one dies.
let renderCalls = 0;
let failOn = new Set();
const resetCalls = () => { renderCalls = 0; failOn = new Set(); };
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  captured.push({ url: String(url), headers: opts?.headers, body: JSON.parse(opts.body) });
  renderCalls++;
  if (failOn.has(renderCalls)) {
    return new Response(JSON.stringify({ error: { message: 'the model is having a day' } }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }
  const onePixelPng =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  return new Response(
    JSON.stringify({
      candidates: [{
        content: { parts: [{ text: 'Rendered.' }, { inlineData: { mimeType: 'image/png', data: onePixelPng } }] },
        finishReason: 'STOP',
      }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};

require('../electron/main.js');
const db = require('../electron/db.js');
const secrets = require('../electron/secrets.js');

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 2200));
  const win = BrowserWindow.getAllWindows()[0];
  secrets.set('gemini', 'TEST-KEY-1234');

  const out = await win.webContents.executeJavaScript(`(async () => {
    const gd = window.gd;
    const un = async (p) => { const r = await p; if (!r.ok) throw new Error(r.error.message); return r.data; };
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC';

    const clientId = await un(gd.clients.save({ name: 'Test', surname: 'Client' }));
    const projectId = await un(gd.projects.create({ clientId, title: 'Render test' }));
    const front  = await un(gd.photos.add({ projectId, slot: 'front',  dataUrl: png }));
    const fabric = await un(gd.photos.add({ projectId, slot: 'fabric', dataUrl: png }));
    const ref    = await un(gd.references.add({ clientId, projectId, dataUrl: png, kind: 'style', title: 'Bold peak' }));

    const render = await un(gd.ai.render({
      projectId,
      prompt: 'PROMPT-UNDER-TEST',
      view: 'front',
      refs: [
        { filename: front.filename,  mime: 'image/png', scope: 'project-' + projectId },
        { filename: fabric.filename, mime: 'image/png', scope: 'project-' + projectId },
        { filename: ref.filename,    mime: 'image/png', scope: 'client-' + clientId },
      ],
      referenceIds: [ref.id],
    }));

    // The saved render must be servable straight back to an <img>.
    const res = await fetch(render.url);

    // And a tweak must chain off it.
    const tweak = await un(gd.ai.render({
      projectId, prompt: 'TWEAK-PROMPT', view: 'front',
      parentId: render.id, instruction: 'wider lapel',
      refs: [{ filename: render.filename, mime: 'image/png', scope: 'project-' + projectId }],
    }));

    const full = await un(gd.projects.get({ id: projectId }));
    return JSON.stringify({
      renderId: render.id,
      servedStatus: res.status,
      servedBytes: (await res.arrayBuffer()).byteLength,
      renderCount: full.renders.length,
      tweakParent: full.renders.find(r => r.id === tweak.id).parent_id,
      tweakInstruction: full.renders.find(r => r.id === tweak.id).instruction,
      clientId,
    });
  })()`);

  const r = JSON.parse(out);
  log('render id:', r.renderId, '| served back: HTTP', r.servedStatus, r.servedBytes, 'bytes');
  log('renders stored:', r.renderCount, '| tweak parent:', r.tweakParent, '| instruction:', r.tweakInstruction);

  const first = captured[0];
  log('');
  log('--- outbound request ---');
  log('url    :', first.url);
  log('api key header sent:', first.headers['x-goog-api-key'] === 'TEST-KEY-1234');
  log('modalities:', JSON.stringify(first.body.generationConfig.responseModalities));
  const parts = first.body.contents[0].parts;
  log('parts  :', parts.length, '->', parts.map(p => p.text ? 'text(' + p.text + ')' : 'image/' + p.inlineData.mimeType.split('/')[1] + '[' + p.inlineData.data.length + 'b]').join(', '));
  log('requests made:', captured.length, '(render + tweak)');

  // The style reference must be recorded against the render for style history.
  const hist = db.styleHistory(r.clientId);
  log('style history: reference "' + hist.references[0].title + '" used ' + hist.references[0].times_used + 'x');

  /* ---------------------------------------------------------------------
     Four views, one press.

     The stage used to show the newest render whatever its view, so the four
     tabs only changed what would be rendered next: render the back and all
     four tabs showed the back. These drive the real buttons.
     --------------------------------------------------------------------- */
  log('\n=== four views, one press ===');
  const js = (code) => win.webContents.executeJavaScript(code);

  const clientId = db.upsertClient({ name: 'Four', surname: 'Views', contact: '', email: '' });
  const projectId = db.createProject({ clientId, title: 'Four views' });
  db.updateProject(projectId, { spec: { suitType: 'two_piece', lapel: 'notch' } });
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC';
  for (const slot of ['front', 'side', 'back', 'face', 'fabric']) {
    await js(`window.gd.photos.add({ projectId: ${projectId}, slot: '${slot}', dataUrl: '${png}' })`);
  }

  win.webContents.reload();
  await new Promise((r2) => setTimeout(r2, 2400));

  const openPreview = `(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Orders')).click(); await wait(800);
    [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes('Four Views')).click(); await wait(1000);
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes('Preview')).click(); await wait(900);
    return true;
  })()`;
  await js(openPreview);

  resetCalls();
  const pressed = await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Render all four'));
    if (!btn) return JSON.stringify({ found: false });
    btn.click();
    // Four renders, one after another.
    for (let i = 0; i < 60 && [...document.querySelectorAll('button')].some(b => b.disabled && /Render all four/.test(b.textContent)); i++) await wait(500);
    await wait(800);
    return JSON.stringify({ found: true });
  })()`).then(JSON.parse);
  check(pressed.found, 'the preview offers one press for all four views');

  const stored = db.getProject(projectId).renders;
  const byView = {};
  for (const r2 of stored) byView[r2.view] = (byView[r2.view] ?? 0) + 1;
  check(stored.length === 4, 'one press produced four renders', `${stored.length}: ${JSON.stringify(byView)}`);
  check(['front', 'side', 'back', 'three_quarter'].every((v2) => byView[v2] === 1),
    'one under each view, and only one', JSON.stringify(byView));
  check(new Set(stored.map((r2) => r2.filename)).size === 4, 'four separate files');

  // Each view's prompt must have carried that view's own camera instruction,
  // or the model is being asked for the same picture four times.
  const prompts = captured.slice(-4).map((c) => c.body.contents[0].parts.find((p) => p.text)?.text ?? '');
  check(prompts.some((t) => /FRONT view/i.test(t)) && prompts.some((t) => /BACK view/i.test(t)),
    'each view asked the model for its own camera angle');

  check(stored.every((r2) => r2.suit_id), 'every render records the suit it is of',
    JSON.stringify(stored.map((r2) => r2.suit_id)));

  // One press is one render with four pictures in it, not four renders that
  // happened close together.
  const batches = new Set(stored.map((r2) => r2.batch_id));
  check(batches.size === 1 && [...batches][0], 'all four belong to one render', JSON.stringify([...batches]));

  log('\n=== the tabs show their own view ===');
  const seen = await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const out = {};
    const tabs = [...document.querySelectorAll('.card-head .stepper .step-tab')];
    for (const tab of tabs) {
      tab.click(); await wait(500);
      const src = document.querySelector('.render-stage img')?.getAttribute('src') ?? '';
      out[tab.textContent.replace(/[^A-Za-z0-9/]/g, '')] = src.split('/').pop().split('?')[0];
    }
    return JSON.stringify(out);
  })()`).then(JSON.parse);
  const shown = Object.values(seen);
  check(shown.length === 4 && shown.every(Boolean), 'every tab shows a picture', JSON.stringify(seen));
  check(new Set(shown).size === 4, 'and a different one on each - not the newest render four times', JSON.stringify(seen));

  log('\n=== a second press is a second render ===');
  resetCalls();
  await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Render all four')).click();
    for (let i = 0; i < 60 && [...document.querySelectorAll('button')].some(b => b.disabled && /Render all four/.test(b.textContent)); i++) await wait(500);
    await wait(800);
    return true;
  })()`);
  const after = db.getProject(projectId).renders;
  const sets = [...new Set(after.map((r2) => r2.batch_id))];
  check(after.length === 8 && sets.length === 2, 'two presses, two renders of four', `${after.length} pictures in ${sets.length} sets`);
  check(sets.every((id) => after.filter((r2) => r2.batch_id === id).length === 4), 'and each set holds four');

  // The strip picks the render; the tabs turn round it. Choosing the older
  // one and walking the tabs must stay inside it.
  const walked = await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const thumbs = [...document.querySelectorAll('.render-thumb')];
    if (thumbs.length < 2) return JSON.stringify({ thumbs: thumbs.length, shown: [] });
    thumbs[1].click(); await wait(600);
    const out = { thumbs: thumbs.length, shown: [] };
    for (const tab of [...document.querySelectorAll('.card-head .stepper .step-tab')]) {
      tab.click(); await wait(450);
      out.shown.push((document.querySelector('.render-stage img')?.getAttribute('src') ?? '').split('/').pop().split('?')[0]);
    }
    return JSON.stringify(out);
  })()`).then(JSON.parse);
  check(walked.thumbs === 2, 'the strip lists renders, not pictures - two presses, two entries', String(walked.thumbs));
  const older = new Set(after.filter((r2) => r2.batch_id === sets[1]).map((r2) => r2.filename));
  check(walked.shown.length === 4 && walked.shown.every((f) => older.has(f)),
    'choosing the older render and turning round it stays in that render', JSON.stringify(walked.shown));

  /* ---------------------------------------------------------------------
     A render belongs to one man, not to the order.
     --------------------------------------------------------------------- */
  log('\n=== a second man on the same order ===');
  const bestMan = db.upsertClient({ name: 'Best', surname: 'Man', contact: '', email: '' });
  const suitB = db.addSuit({ projectId, clientId: bestMan, label: 'Best man' });
  db.addRender({ projectId, suitId: suitB, view: 'front', filename: 'render-bestman.png', prompt: '', instruction: '' });
  const all = db.getProject(projectId).renders;
  const groomSuit = db.primarySuitId(projectId);
  check(all.length === after.length + 1, 'the order holds both men\u2019s renders', `${all.length}`);
  check(all.filter((r2) => r2.suit_id === groomSuit).length === after.length,
    'all but one of them are the groom\u2019s', `${all.filter((r2) => r2.suit_id === groomSuit).length} of ${all.length}`);
  check(all.filter((r2) => r2.suit_id === suitB).length === 1,
    'and one is the best man\u2019s - they are no longer one pool');

  /* ---------------------------------------------------------------------
     What happens when a view fails.
     --------------------------------------------------------------------- */
  log('\n=== when one of the four fails ===');
  const project2 = db.createProject({ clientId, title: 'Failing views' });
  db.updateProject(project2, { spec: { suitType: 'two_piece' } });
  await js(`window.gd.photos.add({ projectId: ${project2}, slot: 'front', dataUrl: '${png}' })`);

  resetCalls();
  failOn = new Set([3]);
  await js(`(async () => {
    const un = async (p) => { const r = await p; if (!r.ok) throw new Error(r.error.message); return r.data; };
    return true;
  })()`);
  // Driven through the handler rather than the button, so the failing view is
  // exactly the third and the test does not depend on render timing.
  const outcomes = [];
  for (const v2 of ['front', 'side', 'back', 'three_quarter']) {
    const res2 = JSON.parse(await js(`window.gd.ai.render({ projectId: ${project2}, view: '${v2}', prompt: 'p', refs: [] }).then(r => JSON.stringify({ ok: r.ok }))`));
    outcomes.push(res2.ok);
  }
  check(outcomes.filter(Boolean).length === 3 && outcomes[2] === false,
    'the one that failed is the one that failed, and the rest still land', JSON.stringify(outcomes));
  check(db.getProject(project2).renders.length === 3, 'only the successful three are stored');

  log(`\n${fail === 0 ? 'ALL RENDER PIPELINE CHECKS PASSED' : 'FAILED'} \u2014 ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('FAIL', e.stack); app.exit(1); });
