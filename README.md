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

## Tests

```bash
npm run test:render   # drives the whole render pipeline with the network stubbed
npm run test:tour     # boots the UI, walks every step, writes screenshots
```

`test:render` needs no API key — it intercepts the outbound call and checks the
request shape, that the returned image is stored and served back, that a tweak
chains to its parent, and that reference usage is recorded.

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
