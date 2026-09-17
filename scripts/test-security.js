const { app, BrowserWindow } = require('electron');
const path = require('path');
app.setPath('userData', require('path').resolve(process.env.DATA_DIR));

require('../electron/main.js');

const log = (...a) => process.stdout.write(a.join(' ') + '\n');
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; log('  ✓', label); }
  else { fail++; log('  ✗ FAIL:', label, detail); }
};

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 2500));
  const win = BrowserWindow.getAllWindows()[0];

  const results = await win.webContents.executeJavaScript(`(async () => {
    const gd = window.gd;
    const out = {};
    const call = async (p) => { const r = await p; return r; };

    const clientId = (await call(gd.clients.save({ name: 'Sec', surname: 'Test' }))).data;
    const projectId = (await call(gd.projects.create({ clientId, title: 'Sec' }))).data;
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC';
    const photo = (await call(gd.photos.add({ projectId, slot: 'front', dataUrl: png }))).data;
    const ref = (await call(gd.references.add({ clientId, projectId, dataUrl: png, kind: 'style', title: 'Ref' }))).data;

    // --- IPC input validation -------------------------------------------
    out.badId       = await call(gd.projects.get({ id: '1 OR 1=1' }));
    out.negId       = await call(gd.projects.get({ id: -5 }));
    out.badSlot     = await call(gd.photos.add({ projectId, slot: '../../evil', dataUrl: png }));
    out.htmlDataUrl = await call(gd.photos.add({ projectId, slot: 'front', dataUrl: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' }));
    out.badSetting  = await call(gd.settings.set({ key: '../../etc/passwd', value: 1 }));

    // --- path traversal through the AI reference loader ------------------
    out.traversalRef = await call(gd.ai.render({
      projectId, prompt: 'x', view: 'front',
      refs: [{ filename: '../../../../etc/passwd', scope: 'project-' + projectId }],
    }));
    out.traversalScope = await call(gd.ai.render({
      projectId, prompt: 'x', view: 'front',
      refs: [{ filename: photo.filename, scope: '../../..' }],
    }));
    out.modelInjection = await call(gd.ai.render({
      projectId, prompt: 'x', view: 'front', refs: [], model: '../../../v1/evil',
    }));

    // --- a legitimate image must actually load ---------------------------
    // Built through the same helpers the interface uses, not the URL the IPC
    // handler happens to return. Those two drifted apart once and every client
    // photograph silently failed to load while the traversal check below kept
    // passing - because a broken scheme also fails to return 200.
    const uiPhotoUrl = gd.projectMedia(projectId, photo.filename);
    const uiRefUrl = gd.clientMedia(clientId, ref.filename);
    out.uiPhotoUrl = uiPhotoUrl;
    try {
      const r = await fetch(uiPhotoUrl);
      out.photoLoads = 'HTTP ' + r.status + '/' + (await r.arrayBuffer()).byteLength;
    } catch (e) { out.photoLoads = 'THREW ' + e.message; }
    try {
      const r = await fetch(uiRefUrl);
      out.refLoads = 'HTTP ' + r.status + '/' + (await r.arrayBuffer()).byteLength;
    } catch (e) { out.refLoads = 'THREW ' + e.message; }
    out.imgTag = await new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve('loaded ' + im.naturalWidth + 'x' + im.naturalHeight);
      im.onerror = () => resolve('ERROR');
      im.src = uiPhotoUrl;
      setTimeout(() => resolve('timeout'), 3000);
    });

    // --- the media protocol must not escape its folder -------------------
    try {
      const r = await fetch('gdmedia://media/project-' + projectId + '/..%2f..%2f..%2fsecrets.json');
      out.mediaTraversal = 'HTTP ' + r.status;
    } catch (e) { out.mediaTraversal = 'blocked: ' + e.message.slice(0, 40); }

    // --- the renderer must have no network of its own --------------------
    try {
      await fetch('https://example.com/exfiltrate');
      out.rendererNetwork = 'ALLOWED';
    } catch (e) { out.rendererNetwork = 'blocked'; }

    try {
      await fetch('https://generativelanguage.googleapis.com/v1beta/models');
      out.rendererGoogle = 'ALLOWED';
    } catch (e) { out.rendererGoogle = 'blocked'; }

    // --- the renderer must have no Node ----------------------------------
    out.nodeExposed = typeof require !== 'undefined' || typeof process !== 'undefined' || typeof module !== 'undefined';
    out.bridgeKeys = Object.keys(window.gd).length;

    // --- the API key must never be readable from the renderer ------------
    const desc = (await call(gd.secrets.describe({ name: 'gemini' }))).data;
    out.keyLeak = JSON.stringify(desc);

    return out;
  })()`);

  log('\n=== IPC input validation ===');
  check(!results.badId.ok, 'SQL-ish id rejected', JSON.stringify(results.badId));
  check(!results.negId.ok, 'negative id rejected');
  check(!results.badSlot.ok, 'photo slot outside the allowlist rejected');
  check(!results.htmlDataUrl.ok, 'text/html disguised as a photo rejected');
  check(!results.badSetting.ok, 'unknown settings key rejected');

  log('\n=== stored media actually loads ===');
  check(/^gdmedia:\/\/media\//.test(results.uiPhotoUrl ?? ''), 'the interface builds the same URL shape as the main process', results.uiPhotoUrl);
  check(/^HTTP 200\/\d+$/.test(results.photoLoads ?? ''), 'a client photograph loads through gdmedia://', results.photoLoads);
  check(/^HTTP 200\/\d+$/.test(results.refLoads ?? ''), 'a client reference image loads through gdmedia://', results.refLoads);
  check((results.imgTag ?? '').startsWith('loaded'), 'and renders in an <img> tag, which is what the UI does', results.imgTag);

  log('\n=== path traversal ===');
  check(!results.traversalRef.ok, 'traversal in a reference filename rejected');
  check(!results.traversalScope.ok, 'traversal in a media scope rejected');
  check(!results.modelInjection.ok, 'path injection via model name rejected');
  check(results.mediaTraversal !== 'HTTP 200', 'gdmedia:// cannot escape its folder', results.mediaTraversal);

  log('\n=== renderer isolation ===');
  check(results.rendererNetwork === 'blocked', 'renderer cannot reach the internet', results.rendererNetwork);
  check(results.rendererGoogle === 'blocked', 'renderer cannot even reach Google directly', results.rendererGoogle);
  check(results.nodeExposed === false, 'no Node primitives in the renderer');
  check(results.bridgeKeys > 0 && results.bridgeKeys < 30, 'bridge exposes only the declared surface (' + results.bridgeKeys + ' groups)');
  check(!/AIza|github_pat|sk-/.test(results.keyLeak), 'no raw key material reaches the renderer', results.keyLeak);

  log(`\n${fail === 0 ? 'ALL SECURITY CHECKS PASSED' : 'SECURITY CHECKS FAILED'} — ${pass} passed, ${fail} failed`);
  app.exit(fail === 0 ? 0 : 1);
}).catch((e) => { log('HARNESS FAIL', e.stack); app.exit(1); });
