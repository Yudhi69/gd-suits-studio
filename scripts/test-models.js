const { app, BrowserWindow } = require('electron');
const path = require('path');
app.setPath('userData', path.resolve(process.env.DATA_DIR));

// Stub Google's model list so the picker can be exercised without a key.
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = String(url);
  if (!u.includes('generativelanguage.googleapis.com')) return realFetch(url, opts);
  if (u.includes('/models?')) {
    return new Response(JSON.stringify({
      models: [
        { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-flash-image', displayName: 'Nano Banana', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3-pro-image-preview', displayName: 'Gemini 3 Pro Image', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', displayName: 'Embeddings', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/imagen-3.0-generate-002', displayName: 'Imagen 3', supportedGenerationMethods: ['predict'] },
        { name: 'models/nano-banana-pro-preview', displayName: 'Nano Banana Pro', description: 'Image generation model', supportedGenerationMethods: ['generateContent'] },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  // Google answers a text model asked for IMAGE output with a 404.
  if (u.includes(':generateContent')) {
    const body = JSON.parse(opts?.body ?? '{}');
    const wantsImage = (body.generationConfig?.responseModalities ?? []).includes('IMAGE');
    const isImageModel = /image|banana/i.test(u);
    if (wantsImage && !isImageModel) {
      return new Response(JSON.stringify({ error: { message: 'models/gemini-2.5-flash is not found for API version v1beta' } }), { status: 404 });
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [
      { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' } },
    ] }, finishReason: 'STOP' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
};

require('../electron/main.js');
const secrets = require('../electron/secrets.js');
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };

app.whenReady().then(async () => {
  await wait(2400);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (c) => win.webContents.executeJavaScript(c);

  secrets.set('gemini', 'TEST-KEY-123');
  await js(`(async () => {
    const un = async p => { const r = await p; if(!r.ok) throw new Error(r.error.message); return r.data; };
    const clientId = await un(window.gd.clients.save({ name:'M', surname:'T' }));
    await un(window.gd.projects.create({ clientId, title:'M' }));
  })()`);
  // A TEXT model saved in the image slot. This is the real-world failure: it
  // is on the key and lists fine, so a naive "is it available?" check passes,
  // then every render 404s because it cannot return an image.
  await js(`window.gd.settings.set({ key: 'imageModel', value: 'gemini-2.5-flash' })`);
  win.webContents.reload();
  await wait(2000);

  const ui = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.nav-item')].find(b=>b.textContent.includes('Settings')).click();
    await wait(2000);
    const selects = [...document.querySelectorAll('.card select')];
    const imageSelect = selects[0];
    const groups = imageSelect ? [...imageSelect.querySelectorAll('optgroup')].map(g => g.label) : [];
    const options = imageSelect ? [...imageSelect.querySelectorAll('option')].map(o => o.value).filter(Boolean) : [];
    return JSON.stringify({
      isDropdown: !!imageSelect && imageSelect.tagName === 'SELECT',
      groups,
      options,
      selected: imageSelect?.value,
      pill: [...document.querySelectorAll('.pill')].map(p=>p.textContent).join(' | '),
    });
  })()`));

  log('=== the model field is a dropdown of real models ===');
  check(ui.isDropdown, 'the image model is chosen from a list, not typed');
  check(ui.groups.includes('Image models'), 'image models are grouped first', ui.groups.join(', '));
  check(ui.options.includes('gemini-2.5-flash-image'), 'an image model is offered', ui.options.join(', '));
  check(!ui.options.includes('text-embedding-004'), 'models that cannot generate content are excluded');
  check(!ui.options.includes('imagen-3.0-generate-002'), 'models this app cannot call are excluded');
  check(ui.options.includes('gemini-2.5-pro'), 'every usable model stays reachable in the second group');

  check(ui.options.includes('nano-banana-pro-preview'), 'an image model without "image" in its name is still found', ui.options.join(', '));

  log('\n=== a text model in the image slot heals itself ===');
  const saved = await js(`window.gd.settings.get({ key: 'imageModel', fallback: '' }).then(r => r.data)`);
  check(saved !== 'gemini-2.5-flash', 'the text model was replaced rather than left to 404', String(saved));
  check(/image|banana/.test(String(saved)), 'and replaced with one that can return an image', String(saved));
  check(ui.selected === saved, 'the dropdown shows what was saved', `${ui.selected} vs ${saved}`);

  log('\n=== and the message says something actionable ===');
  const errText = await js(`(async () => {
    const r = await window.gd.ai.render({ projectId: 1, prompt: 'x', view: 'front', refs: [], model: 'gemini-2.5-flash' });
    return r.ok ? 'unexpectedly succeeded' : r.error.message;
  })()`);
  check(/cannot produce images/i.test(errText), 'asking a text model for an image explains why', errText.slice(0, 90));

  log(`\n${fail === 0 ? 'ALL MODEL CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
