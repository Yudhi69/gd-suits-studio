const { app, BrowserWindow } = require('electron');
const path = require('path');
app.setPath('userData', path.resolve(process.env.DATA_DIR));

// Stub Google's model list so the picker can be exercised without a key.
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  const u = String(url);
  // Both providers are stubbed; anything else is a genuine call and passes
  // through. Without OpenAI here the credit test hit the live API and got a
  // 401 for the fake key, which is not what it was asserting.
  const stubbed = u.includes('generativelanguage.googleapis.com') || u.includes('api.openai.com');
  if (!stubbed) return realFetch(url, opts);
  // Google's real 429 for an image model on a free-tier project, captured
  // live. "limit: 0" is the tell: the free tier never had any allowance for
  // this model, so there is no reset to wait for.
  if (u.includes('no-free-allowance:generateContent')) {
    return new Response(JSON.stringify({
      error: {
        code: 429,
        message: 'You exceeded your current quota, please check your plan and billing details.\n' +
          '* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, ' +
          'limit: 0, model: gemini-2.5-flash-preview-image',
        status: 'RESOURCE_EXHAUSTED',
        details: [{
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
        }],
      },
    }), { status: 429, headers: { 'content-type': 'application/json' } });
  }
  if (u.includes('api.openai.com/v1/models')) {
    return new Response(JSON.stringify({ data: [{ id: 'gpt-image-1' }, { id: 'gpt-4o' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }
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
  // Free allowance used up - a 429 that will not clear until tomorrow.
  if (u.includes('quota-exhausted:generateContent')) {
    return new Response(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED',
      message: 'You exceeded your current quota, please check your plan and billing details.',
      details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
        violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }),
      { status: 429, headers: { 'content-type': 'application/json' } });
  }
  // A retired model, with Google naming the replacement.
  if (u.includes('retired-model:generateContent')) {
    return new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND',
      message: 'This model models/retired-model is no longer available to new users. Please update your code to use models/gemini-3.6-flash for the latest features.' } }),
      { status: 404, headers: { 'content-type': 'application/json' } });
  }
  // OpenAI reports an empty credit balance as a 429, same as throttling.
  if (u.includes('api.openai.com') && u.includes('/images/')) {
    return new Response(JSON.stringify({ error: { type: 'insufficient_quota', code: 'credit_balance_exhausted',
      message: 'You have no credits remaining. Add credits to continue using the API.' } }),
      { status: 429, headers: { 'content-type': 'application/json' } });
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
  await js(`window.gd.ai.setConfig({
    image: { provider: 'gemini', model: 'gemini-2.5-flash' },
    vision: { provider: 'gemini', model: 'gemini-2.5-flash' },
    customBaseUrl: '',
  })`);
  win.webContents.reload();
  await wait(2000);

  const ui = JSON.parse(await js(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    [...document.querySelectorAll('.nav-item')].find(b=>b.textContent.includes('Settings')).click();
    await wait(2000);
    // The first select is the image *provider*; the model picker follows it.
    const selects = [...document.querySelectorAll('.card select')];
    const imageSelect = selects[1];
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
  const saved = await js(`window.gd.ai.providers().then(r => r.data.config.image.model)`);
  check(saved !== 'gemini-2.5-flash', 'the text model was replaced rather than left to 404', String(saved));
  check(/image|banana/.test(String(saved)), 'and replaced with one that can return an image', String(saved));
  check(ui.selected === saved, 'the dropdown shows what was saved', `${ui.selected} vs ${saved}`);

  log('\n=== and the message says something actionable ===');
  const errText = await js(`(async () => {
    const r = await window.gd.ai.render({ projectId: 1, prompt: 'x', view: 'front', refs: [], model: 'gemini-2.5-flash' });
    return r.ok ? 'unexpectedly succeeded' : r.error.message;
  })()`);
  check(/cannot produce images/i.test(errText), 'asking a text model for an image explains why', errText.slice(0, 90));

  log('\n=== providers ===');
  const provs = JSON.parse(await js(`window.gd.ai.providers().then(r => JSON.stringify(r.data.providers.map(p => ({ id: p.id, image: p.supportsImage, vision: p.supportsVision, key: !!p.key.present }))))`));
  check(provs.length >= 4, 'more than one provider is offered', provs.map(p=>p.id).join(', '));
  check(provs.find(p=>p.id==='openai')?.image === true, 'OpenAI can render');
  check(provs.find(p=>p.id==='anthropic')?.image === false, 'Claude is marked as unable to render');
  check(provs.find(p=>p.id==='anthropic')?.vision === true, 'Claude is offered for reads');
  check(provs.every(p => !('apiKey' in p)), 'no provider row carries key material');

  const imageProviders = JSON.parse(await js(`(async () => {
    const selects = [...document.querySelectorAll('.card select')];
    return JSON.stringify([...selects[0].options].map(o => o.value));
  })()`));
  check(!imageProviders.includes('anthropic'), 'Claude is absent from the image provider list', imageProviders.join(', '));

  log('\n=== a 429 is not always throttling ===');
  const quotaErr = await js(`window.gd.ai.render({ projectId: 1, prompt: 'x', view: 'front', refs: [], model: 'quota-exhausted' }).then(r => r.ok ? 'ok' : r.error.message)`);
  check(/free daily quota/i.test(quotaErr), 'a used-up free allowance says so, and when it resets', quotaErr.slice(0, 80));
  check(!/wait a moment/i.test(quotaErr), 'and does not tell the tailor to wait for something that will not clear');

  const retiredErr = await js(`window.gd.ai.render({ projectId: 1, prompt: 'x', view: 'front', refs: [], model: 'retired-model' }).then(r => r.ok ? 'ok' : r.error.message)`);
  check(/retired/i.test(retiredErr), 'a retired model is reported as retired', retiredErr.slice(0, 80));
  check(/gemini-3\.6-flash/.test(retiredErr), "and names Google's suggested replacement", retiredErr.slice(0, 100));

  await js(`window.gd.ai.setConfig({ image:{provider:'openai',model:'gpt-image-1'}, vision:{provider:'gemini',model:'gemini-3.6-flash'}, customBaseUrl:'' })`);
  await js(`window.gd.secrets.set({ name: 'openai', value: 'sk-test-123' })`);
  const creditErr = await js(`window.gd.ai.render({ projectId: 1, prompt: 'x', view: 'front', refs: [] }).then(r => r.ok ? 'ok' : r.error.message)`);
  check(/no API credit/i.test(creditErr), 'an empty OpenAI balance is reported as credit, not throttling', creditErr.slice(0, 80));
  check(/ChatGPT Plus/i.test(creditErr), 'and says plainly that ChatGPT Plus does not fund the API');

  log('\n=== a custom endpoint must be https, unless it is local ===');
  const localOk = await js(`window.gd.ai.setConfig({ image:{provider:'custom',model:'x'}, vision:{provider:'gemini',model:'gemini-3.6-flash'}, customBaseUrl: 'http://localhost:7860/v1' }).then(r => r.ok ? 'ALLOWED' : r.error.message)`);
  check(localOk === 'ALLOWED', 'a local model server over http is allowed', localOk);
  const remoteHttp = await js(`window.gd.ai.setConfig({ image:{provider:'custom',model:'x'}, vision:{provider:'gemini',model:'gemini-3.6-flash'}, customBaseUrl: 'http://example.com/v1' }).then(r => r.ok ? 'ALLOWED' : r.error.message)`);
  check(remoteHttp !== 'ALLOWED', 'but a remote http endpoint is still refused', remoteHttp);

  log('\n=== a custom endpoint must be https ===');
  const bad = await js(`window.gd.ai.setConfig({ image:{provider:'custom',model:'x'}, vision:{provider:'gemini',model:'gemini-2.5-flash'}, customBaseUrl: 'http://insecure.example' }).then(r => r.ok ? 'ALLOWED' : r.error.message)`);
  check(bad !== 'ALLOWED' && /https/i.test(bad), 'a plain http endpoint is refused', bad);

  log('\n=== a model with no free allowance is not a model to wait on ===');
  const gem = require('../electron/ai/gemini.js');
  let quotaMsg = '';
  try {
    await gem.generateImage({ apiKey: 'AIza-test', model: 'no-free-allowance', prompt: 'a navy suit' });
    quotaMsg = '(no error thrown)';
  } catch (err) {
    quotaMsg = err.message;
  }
  check(/billing/i.test(quotaMsg), 'it says the fix is billing', quotaMsg.slice(0, 90));
  check(!/midnight/i.test(quotaMsg), 'and does NOT send the tailor away to wait for a reset', quotaMsg.slice(0, 90));
  check(/aistudio\.google\.com/.test(quotaMsg), 'and names where to go', quotaMsg.slice(0, 120));

  log(`\n${fail === 0 ? 'ALL MODEL CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
