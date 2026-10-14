const { app, BrowserWindow, nativeImage } = require('electron');
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
// Every render comes back as a different picture, so a test can tell which
// one was sent on as a reference.
let served = 0;
const distinctPng = (n) => {
  const px = Buffer.alloc(4 * 4 * 4);
  for (let i = 0; i < 16; i++) px.set([n & 255, (n * 37) & 255, (n * 91) & 255, 255], i * 4);
  return nativeImage.createFromBitmap(px, { width: 4, height: 4 }).toPNG().toString('base64');
};
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  captured.push({ url: String(url), headers: opts?.headers, body: JSON.parse(opts.body) });
  renderCalls++;
  if (failOn.has(renderCalls)) {
    return new Response(JSON.stringify({ error: { message: 'the model is having a day' } }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }
  return new Response(
    JSON.stringify({
      candidates: [{
        content: { parts: [{ text: 'Rendered.' }, { inlineData: { mimeType: 'image/png', data: distinctPng(++served) } }] },
        finishReason: 'STOP',
      }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
};

require('../electron/main.js');
const db = require('../electron/db.js');
const secrets = require('../electron/secrets.js');
const storage = require('../electron/storage.js');

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

  log('\n=== the row of buttons under a render ===');
  // Measured, not eyeballed: the row carried three different button heights.
  const row = JSON.parse(await js(`(() => {
    const bar = document.querySelector('.render-actions');
    if (!bar) return JSON.stringify({ found: false });
    const buttons = [...bar.querySelectorAll('button')].map(b => ({
      label: b.textContent.trim().slice(0, 22),
      h: Math.round(b.getBoundingClientRect().height),
      top: Math.round(b.getBoundingClientRect().top),
    }));
    return JSON.stringify({ found: true, buttons, rows: new Set(buttons.map(b => b.top)).size });
  })()`));
  check(row.found && row.buttons.length >= 4, 'the buttons are all in one row', JSON.stringify(row.buttons?.length));
  const heights = new Set((row.buttons ?? []).map((b) => b.h));
  check(heights.size === 1, 'and every one of them is the same height', JSON.stringify([...heights]));

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


  /* ---------------------------------------------------------------------
     The shoes, and one cloth in all four views.

     GD's set came back with a gold check covering a twentieth of the
     trousers from three angles and a third of them from the fourth: four
     renders, each guessing at the cloth on its own. These drive the real
     pages - the shoes go in through Extras, the cloth through the Cloth
     page - and read what reaches the model off the wire.
     --------------------------------------------------------------------- */
  log('\n=== the shoes, from the Extras page ===');
  const shoeClient = db.upsertClient({ name: 'Shoe', surname: 'Cloth', contact: '', email: '' });
  const shoeProject = db.createProject({ clientId: shoeClient, title: 'Shoes and cloth' });
  db.updateProject(shoeProject, { spec: { suitType: 'two_piece', lapel: 'notch' } });
  await js(`(async () => {
    const un = async (p) => { const r = await p; if (!r.ok) throw new Error(r.error.message); return r.data; };
    const solid = (hex) => { const c = document.createElement('canvas'); c.width = 60; c.height = 80;
      const x = c.getContext('2d'); x.fillStyle = hex; x.fillRect(0, 0, 60, 80); return c.toDataURL('image/png'); };
    // Navy, with a gold stripe 4px wide every 64px: a sixteenth of the cloth.
    // Each stripe starts half a pixel in, so its edges are part gold and part
    // navy - as every fine line in a real photograph is.
    const cloth = () => { const c = document.createElement('canvas'); c.width = 640; c.height = 480;
      const x = c.getContext('2d'); x.fillStyle = '#1d2a44'; x.fillRect(0, 0, 640, 480);
      x.fillStyle = '#b8a060'; for (let at = 30; at < 640; at += 64) x.fillRect(at + 0.5, 0, 4, 480);
      return c.toDataURL('image/png'); };
    const add = (slot, dataUrl) => un(window.gd.photos.add({ projectId: ${shoeProject}, slot, dataUrl }));
    await add('front', solid('#a03030')); await add('side', solid('#30a030')); await add('back', solid('#3030a0'));
    await add('face', solid('#a0a030')); await add('lining', solid('#a030a0')); await add('fabric', cloth());
    return true;
  })()`);
  win.webContents.reload();
  await new Promise((r2) => setTimeout(r2, 2400));

  const openStep = (step) => js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.step-tab')].find(t => t.textContent.includes(${JSON.stringify(step)})).click();
    await wait(900);
    return true;
  })()`);
  await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Orders')).click(); await wait(800);
    [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes('Shoe Cloth')).click(); await wait(1000);
    return true;
  })()`);
  await openStep('Extras');

  const shoesUi = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const card = () => [...document.querySelectorAll('.photo-slot')]
      .find(s => s.querySelector('.photo-meta')?.textContent.includes('Photo of the shoes'));
    const before = !!card();
    const toggle = [...document.querySelectorAll('.toggle-row')]
      .find(r => r.firstElementChild?.firstElementChild?.textContent.trim() === 'Shoes');
    toggle?.querySelector('[role=switch]')?.click();
    await wait(900);
    const after = !!card();
    const upload = async (hex) => {
      const c = document.createElement('canvas'); c.width = 90; c.height = 60;
      const x = c.getContext('2d'); x.fillStyle = hex; x.fillRect(0, 0, 90, 60);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'shoes.png', { type: 'image/png' }));
      const input = card().querySelector('input[type=file]');
      input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(1500);
    };
    if (after) { await upload('#202020'); await upload('#5a3a1a'); }
    const shown = card()?.querySelector('.photo-frame img')?.getAttribute('src') ?? '';
    return JSON.stringify({ before, after, shown });
  })()`));
  check(!shoesUi.before && shoesUi.after, 'a place for a photo of the shoes appears once Shoes is ticked, and not before',
    JSON.stringify(shoesUi));
  const groomSuitId = db.primarySuitId(shoeProject);
  let shoePhotos = db.getProject(shoeProject).photos.filter((p) => p.slot === 'shoes');
  check(shoePhotos.length === 1 && shoePhotos[0].suit_id === groomSuitId,
    'a second photo replaces the first - one pair, kept with this suit', JSON.stringify(shoePhotos.map((p) => p.suit_id)));
  check(shoePhotos.length === 1 && shoesUi.shown.includes(shoePhotos[0].filename), 'and the page shows the one that is kept');

  const tie = JSON.parse(await js(`window.gd.photos.add({ projectId: ${shoeProject}, slot: 'tie_reference', dataUrl: '${png}' })
    .then(r => JSON.stringify({ ok: r.ok, error: r.error?.message ?? '' }))`));
  check(tie.ok, 'a tie photo can be added - the Extras page always offered one, and saving it used to be refused', tie.error);

  log('\n=== the cloth, measured on the Cloth page ===');
  await openStep('Cloth');
  const measured = await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 20 && !document.querySelector('.measured-cloth'); i++) await wait(250);
    return JSON.stringify({
      text: document.querySelector('.measured-cloth')?.textContent ?? '',
      colours: document.querySelectorAll('.measured-cloth-colour').length,
    });
  })()`).then(JSON.parse);
  // A sixteenth is 6.25%; the measurement samples 4000 points, so a point either way is the same answer.
  check(/9[3-5]%/.test(measured.text) && /gold\s*[5-7]%/i.test(measured.text),
    'it shows what the render will be told: the navy and the gold, and how much of each', measured.text);
  check(measured.colours === 2, 'and only those two - the soft edges of a fine line are not a colour of their own',
    `${measured.colours}: ${measured.text}`);

  log('\n=== one press: the front first, then the rest drawn to match it ===');
  await openStep('Preview');
  const sentFrom = captured.length;
  resetCalls();
  await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Render all four')).click();
    for (let i = 0; i < 60 && [...document.querySelectorAll('button')].some(b => b.disabled && /Render all four/.test(b.textContent)); i++) await wait(500);
    await wait(800);
    return true;
  })()`);
  const scope = storage.scopeForProject(shoeProject);
  shoePhotos = db.getProject(shoeProject).photos.filter((p) => p.slot === 'shoes');
  const shoesData = shoePhotos[0] ? storage.readAsBase64(scope, shoePhotos[0].filename) : null;
  const firstSet = db.getProject(shoeProject).renders;
  const frontRender = firstSet.find((r) => r.view === 'front');
  const frontData = frontRender ? storage.readAsBase64(scope, frontRender.filename) : '';
  const read = (c) => {
    const parts = c.body.contents[0].parts;
    const text = parts.find((p) => p.text)?.text ?? '';
    return {
      text,
      images: parts.filter((p) => p.inlineData).map((p) => p.inlineData.data),
      named: [...text.matchAll(/^Image (\d+) \(([^)]+)\)/gm)].map((m) => ({ n: Number(m[1]), label: m[2] })),
    };
  };
  const sent = captured.slice(sentFrom).map(read);
  if (process.env.DUMP_PROMPTS) require('fs').writeFileSync(process.env.DUMP_PROMPTS, sent.map((r) => r.text).join('\n\n=========\n\n'));
  check(sent.length === 4 && firstSet.length === 4, 'four views, four renders', `${sent.length} sent, ${firstSet.length} stored`);
  check(sent.every((r) => r.named.length === r.images.length && r.named.every((x, i) => x.n === i + 1)),
    'each prompt names every image it is sent, numbered in the order they are attached',
    JSON.stringify(sent.map((r) => [r.named.length, r.images.length])));
  check(sent.every((r) => { const at = r.named.findIndex((x) => x.label === 'shoes'); return at >= 0 && r.images[at] === shoesData; }),
    'the photo of the shoes goes with all four views, at the place the prompt says it is');
  check(/Put exactly these on the client/.test(sent[0]?.text ?? ''), 'and the model is told to put exactly those shoes on the client');
  check(/THE SHOT - this is FRONT/.test(sent[0]?.text ?? '') && !sent[0].named.some((x) => x.label === 'front view')
    && !sent[0].images.includes(frontData), 'the front is drawn first, from the photographs alone');
  check(sent.slice(1).length === 3 && sent.slice(1).every((r) => {
    const at = r.named.findIndex((x) => x.label === 'front view');
    return at >= 0 && r.images[at] === frontData;
  }), 'the side, the back and the 3/4 are each sent the front that was just drawn');
  check(/This picture is the SIDE view/.test(sent[1]?.text ?? '') && /This picture is the 3\/4 view/.test(sent[3]?.text ?? '')
    && /Take nothing else from it: not its camera angle, its pose or its framing/.test(sent[2]?.text ?? ''),
    'told to copy its cloth, and not its angle');

  const clothOf = (t) => t.split('\n\n').find((para) => para.startsWith('The cloth:')) ?? '';
  const cloths = sent.map((r) => clothOf(r.text));
  check(cloths[0] && cloths.every((c) => c === cloths[0]), 'all four prompts describe the cloth in the same words', cloths[0]);
  check(/the jacket and trousers are both cut from the one bolt/.test(cloths[0]), 'that the trousers are the same cloth as the jacket');
  check(/is the ground, about 9[3-5]% of the cloth; gold \(#[0-9a-f]{6}\) about [5-7]%/.test(cloths[0]),
    'and what the swatch measures - navy about 94%, gold about 6%', cloths[0]);
  check(/The gold stays exactly as fine and as sparse as it is in the swatch/.test(cloths[0]), 'with the gold kept as fine as it is there');

  log('\n=== redoing one view ===');
  const oneFrom = captured.length;
  await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.card-head .stepper .step-tab')].find(t => t.textContent.trim().startsWith('Side')).click(); await wait(500);
    [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Just the side').click();
    for (let i = 0; i < 40 && [...document.querySelectorAll('button')].some(b => b.disabled && /Just the side/.test(b.textContent)); i++) await wait(400);
    await wait(700);
    return true;
  })()`);
  const redo = captured.slice(oneFrom).map(read);
  check(redo.length === 1 && redo[0].images[redo[0].named.findIndex((x) => x.label === 'front view')] === frontData,
    'just the side is sent the front of the set it joins', String(redo.length));

  log('\n=== more images than a render takes ===');
  for (const title of ['Ref A', 'Ref B', 'Ref C', 'Ref D']) {
    await js(`window.gd.references.add({ clientId: ${shoeClient}, projectId: ${shoeProject}, dataUrl: '${png}', kind: 'style', title: '${title}' })`);
  }
  win.webContents.reload();
  await new Promise((r2) => setTimeout(r2, 2400));
  await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.nav-item')].find(b => b.textContent.includes('Orders')).click(); await wait(800);
    [...document.querySelectorAll('tbody tr')].find(r => r.textContent.includes('Shoe Cloth')).click(); await wait(1000);
    return true;
  })()`);
  await openStep('Preview');
  const capFrom = captured.length;
  const capUi = await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Reference images')).click(); await wait(700);
    for (const title of ['Ref A', 'Ref B', 'Ref C', 'Ref D']) {
      [...document.querySelectorAll('.modal .ref-card')].find(c => c.textContent.includes(title))?.querySelector('.ref-thumb')?.click();
      await wait(200);
    }
    [...document.querySelectorAll('.modal button')].find(b => b.textContent.trim() === 'Done').click(); await wait(500);
    [...document.querySelectorAll('.card-head .stepper .step-tab')].find(t => t.textContent.trim().startsWith('Side')).click(); await wait(500);
    const note = [...document.querySelectorAll('p.tiny')].find(p => /left out/.test(p.textContent))?.textContent ?? '';
    [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('Render all four')).click();
    for (let i = 0; i < 60 && [...document.querySelectorAll('button')].some(b => b.disabled && /Render all four/.test(b.textContent)); i++) await wait(500);
    await wait(800);
    return note;
  })()`);
  const capped = captured.slice(capFrom).map(read);
  const capSets = new Set(db.getProject(shoeProject).renders.map((r) => r.batch_id));
  check(capped.length === 4 && capped.every((r) => r.images.length <= 8 && r.named.length === r.images.length),
    'the shoes, the front and four style references still render - no view is sent more than eight images',
    JSON.stringify(capped.map((r) => r.images.length)));
  check(capSets.size === 2 && db.getProject(shoeProject).renders.length === 9, 'and none of the four failed',
    `${db.getProject(shoeProject).renders.length} renders in ${capSets.size} sets`);
  check(capped.every((r) => r.named.some((x) => x.label === 'shoes') && r.named.some((x) => x.label === 'fabric swatch')),
    'it is the style references that give way, not the shoes or the cloth');
  check(/2 style references left out/.test(capUi), 'and the page says how many were left out', capUi);
  const used = Object.fromEntries(db.styleHistory(shoeClient).references.map((r) => [r.title, r.times_used]));
  check(used['Ref A'] === 4 && used['Ref B'] === 4 && used['Ref C'] === 1 && !used['Ref D'],
    'the client’s style history counts only the references that were sent', JSON.stringify(used));

  log('\n=== shoes no longer on the order ===');
  await openStep('Extras');
  await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.toggle-row')].find(r => r.firstElementChild?.firstElementChild?.textContent.trim() === 'Shoes')
      ?.querySelector('[role=switch]')?.click();
    await wait(900);
    return true;
  })()`);
  await openStep('Preview');
  const untickedPrompt = await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('See the prompt')).click(); await wait(600);
    const text = document.querySelector('.modal textarea')?.value ?? '';
    [...document.querySelectorAll('.modal button')].find(b => b.textContent.trim() === 'Close')?.click();
    return text;
  })()`);
  check(untickedPrompt.includes('THE SHOT') && !/\(shoes\)/.test(untickedPrompt),
    'untick Shoes and the photo stops going into the render');
  check(db.getProject(shoeProject).photos.some((p) => p.slot === 'shoes'), 'though it stays on file, for when they are ticked again');

  log('\n=== a second person on the order ===');
  const bestMan2 = db.upsertClient({ name: 'Second', surname: 'Shoes', contact: '', email: '' });
  const suitB2 = db.addSuit({ projectId: shoeProject, clientId: bestMan2, label: 'Best man' });
  await js(`window.gd.photos.add({ projectId: ${shoeProject}, suitId: ${suitB2}, clientId: ${bestMan2}, slot: 'shoes', dataUrl: '${png}' })`);
  const bySuit = db.getProject(shoeProject).photos.filter((p) => p.slot === 'shoes');
  check(bySuit.filter((p) => p.suit_id === groomSuitId).length === 1 && bySuit.filter((p) => p.suit_id === suitB2).length === 1,
    'the second person’s shoes are kept with their own suit, and do not replace the groom’s', JSON.stringify(bySuit.map((p) => p.suit_id)));

  log(`\n${fail === 0 ? 'ALL RENDER PIPELINE CHECKS PASSED' : 'FAILED'} \u2014 ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('FAIL', e.stack); app.exit(1); });
