const { app, BrowserWindow } = require('electron');
require('./fresh.js').freshUserData(app);

const log = (...a) => process.stdout.write(a.join(' ') + '\n');

// Intercept the one outbound call the app makes, so the whole render pipeline
// can be exercised without a real key or network.
const captured = [];
const realFetch = global.fetch;
global.fetch = async (url, opts) => {
  captured.push({ url: String(url), headers: opts?.headers, body: JSON.parse(opts.body) });
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
  app.exit(0);
}).catch((e) => { log('FAIL', e.stack); app.exit(1); });
