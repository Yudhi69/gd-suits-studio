# GD Suits Studio

An offline-first consultation tool for GD Suits. It captures the client, the
cloth and the design, keeps the tailor's notes at every step, prices the suit
as it is built, and — when there is a connection — renders a photorealistic
preview of the finished garment on the actual client.

Everything except rendering works with no internet at all.

---

## Running it

**As an installed app.** Open the installer in `release/` and drag the app
across.

- macOS, Apple Silicon: `GD Suits Studio-0.1.0-arm64.dmg`
- macOS, Intel: `GD Suits Studio-0.1.0.dmg`
- Windows: `GD Suits Studio Setup 0.1.0.exe`

The builds are **ad-hoc signed, not notarised**, so the first launch on macOS
needs a right-click → *Open* to get past Gatekeeper. See *Signing* below.

**From source.**

```bash
npm install
npm run dev      # Vite + Electron with hot reload
npm start        # production bundle, run locally
```

---

## Turning on AI rendering

1. Get a free API key at [aistudio.google.com](https://aistudio.google.com).
2. Open **Settings → AI rendering**, paste it, press **Save**.
3. Press **Test connection & list models** — the model dropdowns fill with
   whatever that key can actually use, so nothing is hard-coded to a model
   name that may be retired.

The key is encrypted with the OS keychain (Keychain on macOS, DPAPI on
Windows) and never leaves the machine except in calls to Google.

Without a key the app still does: client capture, skin-tone sampling, fabric
colour extraction, the full suit builder, measurements, fittings, notes,
pricing and export. Only the render and the two AI reads are switched off.

---

## What it does

**Capture.** Front, side, back and face photos by file, drag-and-drop, paste or
live camera. Fabric and lining are photographed the same way.

**Skin tone.** Click the client's face and the app measures the tone from the
photo's pixels — median-sampled with the extremes trimmed, so a highlight or a
shadow does not skew it. It reports depth and undertone, suggests cloths that
tend to flatter that tone, and hands the measured value to the render prompt so
the model is *told* the complexion instead of guessing it. This is all local;
it works with no signal.

**The builder.** A progressive step-by-step flow rather than one long form,
with the running price always on screen. Every option in it comes from
`src/lib/catalog.js` — add a field there and it appears in the flow, in the
price breakdown, in the spec sheet and in the render prompt with no other code
change.

**Rendering.** The spec is composed into a tailoring prompt — real clauses like
"peak lapels, 3.5 inches wide", "single breasted with 2 buttons", "double
vents" — and sent to Gemini along with the client photo, the fabric swatch and
any chosen reference images. **See the prompt** shows exactly what was sent,
so when a render is wrong you can see why.

**Tweaking.** A tweak edits the *previous render* rather than starting over, so
the client's face, pose, lighting and every already-agreed detail survive the
change. Renders form a chain, and each one records the instruction that
produced it.

**Reference images.** Belong to the *client*, not to one order — the pictures
someone brings in are the best record of their taste. Tag them, pin favourites,
feed them into any future render. The app records which references actually fed
which render, so the style history is evidence rather than a guess.

**Fittings.** Sessions with the tailor's notes and the client's own comments,
plus photos of each garment from three angles.

**Export.** Writes the whole client file to a folder — JSON, every photo and
render, and a printable HTML spec sheet with the price breakdown to send for
sign-off.

---

## Data model

`client_id` is the root of everything: every row traces back to exactly one
client, and deleting a client removes it all. But each table keeps its own row
id, because **a client has many orders** — they come back for a second suit,
and the brief explicitly asks for that.

The useful split is between what belongs to the *person* and what belongs to
the *order*:

| Belongs to the client (carries between suits) | Belongs to one order |
| --- | --- |
| identity and contact details | the spec being built |
| style reference library | capture photos, fabric, lining |
| body measurements (last known) | as-cut measurements |
| | renders, notes, fittings |

A returning client's measurements are copied onto a new order automatically and
flagged in gold as carried over, so they get confirmed rather than re-taken
from scratch.

Everything lives in one folder — **Settings → About → Open data folder**:

```
data/gdsuits.db        SQLite: clients, projects, spec, notes, measurements, renders
media/client-<id>/     reference images (survive any single order)
media/project-<id>/    capture photos and renders
secrets.json           the API key, encrypted by the OS keychain
```

Back that folder up and the whole shop's history travels with it.

---

## Layout

```
electron/          main process — window, IPC, database, files, the one API call
  main.js          IPC surface and startup
  db.js            SQLite schema and queries (migrations are versioned)
  storage.js       image files, scoped per client / per order
  secrets.js       API key, encrypted via Electron safeStorage
  ai/gemini.js     the only outbound network code in the app
src/               renderer (React)
  lib/catalog.js   every option, price and prompt phrasing — the file to edit
  lib/pricing.js   breakdown and totals
  lib/promptBuilder.js  spec → render prompt
  lib/colour.js    offline skin tone and fabric colour analysis
  screens/         dashboard, client file, settings, the consultation flow
scripts/           headless tests (see below)
```

---

## Appearance

Light, dark, or follow the system — the switch is at the bottom of the sidebar.
"System" keeps following: the OS media query is watched, so a machine that
flips to dark at sunset takes the app with it.

One deliberate exception runs through both themes. The surfaces used to **judge
colour** — the photo frames, the swatch previews and the colour sampler — are
held to a strictly neutral grey rather than the warm off-white used everywhere
else. A warm ground behind a fabric swatch or a client's face biases exactly
the judgement this app exists to support.

---

## Tests

```bash
npm test              # security checks, then the render pipeline
npm run test:security # proves the hardening actually blocks attacks
npm run test:render   # drives the whole render pipeline with the network stubbed
npm run test:tour     # boots the UI, walks every step, writes screenshots
```

Neither needs an API key. `test:render` intercepts the outbound call and checks
the request shape, that the returned image is stored and served back, that a
tweak chains to its parent, and that reference usage is recorded.
`test:security` attempts real attacks — path traversal, id injection, a
disguised HTML payload, renderer network egress — and fails if any succeeds.

---

## Security

The renderer is treated as untrusted. The realistic threat is not a targeted
attacker; it is a hostile string arriving through a client name, a fitting note
or — most plausibly — text returned by the AI. These controls are what stop
that becoming access to the tailor's machine or their client files.

**Process isolation**
- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. There are
  no Node primitives in the renderer at all.
- The preload exposes one explicit channel list and nothing else. Results cross
  as plain objects, so no live object graph is shared.

**Network** — the renderer has none. The single outbound call lives in the main
process, so *any* request originating in the renderer is either a bug or
exfiltration, and is blocked outright. `generativelanguage.googleapis.com` is
the only host the app ever contacts.

**Navigation and devices** — navigation away from the bundled app is refused,
`<webview>` is blocked, links open in the real browser only after their scheme
is checked, and every device permission is denied except the camera.

**Content Security Policy** — production runs `default-src 'none'` with no
inline script and no `eval`. The looser policy Vite's HMR needs applies only in
development, which is why the two are kept separate.

**Input validation** — every value crossing IPC is checked in `electron/validate.js`:
ids must be positive integers, filenames must match the generated shape,
media scopes must be `project-<n>` or `client-<n>`, uploads must really be
images and under 12 MB, and model names cannot contain path characters.
Path traversal is impossible before it reaches the filesystem.

**SQL** — every query is parameterised. The two places that build a statement
dynamically assemble it from a fixed allowlist of column names, never from
input.

**Exported spec sheets** — the export is assembled as raw HTML, so every
interpolated value is escaped. Without that, a client whose name contained
markup would produce a file that executed it when opened.

**Secrets** — the API key is encrypted with the OS keychain (Keychain /
DPAPI), written `0600`, and never crosses into the renderer; the UI only ever
sees a masked hint.

### What is *not* covered

- **Client data is not encrypted at rest.** Photographs, measurements and
  contact details sit in a plain SQLite database and image files, with the
  folder restricted to the owner. If a laptop is lost, **full-disk encryption
  is what protects that data** — turn on FileVault (Mac) or BitLocker
  (Windows). This is stated in Settings → About & data as well.
- **Rendering sends client photographs to Google.** That is the point of the
  feature, but it is personal information leaving the country, so get the
  client's agreement first. Under POPIA that consent should be informed and
  recorded, and a client's file should be deleted once there is no longer a
  reason to keep it — deleting a client removes their orders, photos,
  references and renders.
- **Builds are ad-hoc signed, not notarised** (see *Signing*).
- `npm audit` reports **0 vulnerabilities in what ships**. There are advisories
  in `electron-builder`'s own dependency tree — build tooling only, mostly in
  `electron-updater`, which this app does not use. Clearing them needs a major
  `electron-builder` upgrade; the build chain here is verified working, so that
  is a deliberate deferral rather than an oversight.

---

## Building installers

```bash
npm run dist:mac     # both .dmg files
npm run dist:win     # .exe installer
```

Both build from a Mac with no extra tooling — the Windows `.exe` was produced
on this machine. All three installers in `release/` were built and the macOS
one was launched and verified; the `.exe` has been built but not yet run on a
Windows machine.

The mac target builds each architecture in a separate pass. Running them in one
pass makes electron-builder do both in parallel, and they collide in a shared
temp directory (`hdiutil resize` fails and you silently get only one DMG).

**Note:** building for another architecture rebuilds the native SQLite module
for that architecture *in place*, which leaves the dev app unable to start.
Each `dist:` script rebuilds it for the host afterwards; if you ever run
`electron-builder` directly, finish with `npx electron-builder install-app-deps`.

### Signing

Builds are **ad-hoc signed** so they run without an Apple Developer account.
Two things this handles, both of which fail silently otherwise:

- Apple Silicon refuses to run any unsigned binary — an unsigned build is
  killed at launch with no error at all.
- `codesign --deep` does *not* fix it. macOS rejects the result with
  "different Team IDs" because the nested Electron Framework keeps its original
  signature. `build/afterPack.js` signs nested code explicitly, innermost
  first.

To distribute properly, get an Apple Developer ID, set `build.mac.identity` in
`package.json` to that identity and `build.mac.hardenedRuntime` back to `true`,
then notarise. `afterPack.js` stands aside automatically once an identity is
set.

---

## Known limits

- Renders are AI images, not a turnable 3D model. Front, side, back and
  three-quarter views are generated separately.
- Image models are not perfectly faithful to fine detail. Button count and
  lapel shape usually land; a specific monogram will not. The spec sheet, not
  the render, is what the cutter works from.
- Lining monograms are deliberately kept out of the render prompt — they are
  recorded on the spec sheet, but asking a model to paint hidden text produces
  artefacts.
- The Windows installer builds cleanly from macOS but has not been launched on
  a Windows machine — worth a smoke test before handing it to anyone.
