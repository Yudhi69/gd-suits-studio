# GD Suits Studio

An offline-first consultation tool for GD Suits. It captures the client, the
cloth and the design, keeps the tailor's notes at every step, prices the suit
as it is built, and — when there is a connection — renders a photorealistic
preview of the finished garment on the actual client.

Everything except rendering works with no internet at all.

---

## Running it

**As an installed app.** Open the installer in `release/` and drag the app
across. Three are built: a `-arm64.dmg` for Apple Silicon, a plain `.dmg` for
Intel, and a `Setup ... .exe` for Windows.

**It runs on macOS 10.15 Catalina and later**, and Windows 10 and later. The
floor is set by Electron, not by this code: Electron 33 and newer need macOS 11,
so the app is held on **Electron 32** - the newest that still runs on Catalina,
which is what the client's Intel MacBook has. Every Mac build checks this for
itself (`build/macosFloor.js`, run from `afterPack`): it reads the minimum macOS
recorded in every compiled file in the bundle and refuses to package one that
asks for more than 10.15. Raising Electron past 32 will fail that check, by
design - drop Catalina knowingly or not at all.

The builds are **signed with the project's own certificate, not an Apple
Developer ID, and not notarised**, so the first launch on macOS needs a
right-click → *Open* to get past Gatekeeper. See *Signing* below.

[**docs/installing.md**](docs/installing.md) is the same thing written for the
tailor rather than for a developer - which file to take, what each warning
screen says, and why it appears. It is what goes out with a build.

**From source.**

```bash
npm install
npm run dev      # Vite + Electron with hot reload
npm start        # production bundle, run locally
```

---

## Turning on AI rendering

**Settings → AI rendering.** Add a key for any provider, then choose which one
does which job — renders and reads can use different providers.

| Provider | Renders | Reads | Key from |
| --- | --- | --- | --- |
| Google Gemini | yes | yes | aistudio.google.com |
| OpenAI | yes | yes | platform.openai.com |
| Anthropic (Claude) | **no** | yes | console.anthropic.com |
| Custom (OpenAI-compatible) | yes | yes | your own endpoint |

Claude cannot generate images, so it is simply absent from the image provider
list rather than offered and then failing. The custom option covers anything
speaking the OpenAI wire format — OpenRouter, Together, an Azure deployment, a
local server — and its endpoint must be https.

Model dropdowns fill themselves from whichever key is set. Only models the app
can actually call are offered, so nothing is hard-coded to a name that may be
retired — and if a saved model can no longer do the job, it is swapped for one
that can rather than left to fail on every render. A text model in the image
slot is the specific trap that catches people: it lists fine, accepts the
request, then answers 404.

Every key is encrypted with the OS keychain (Keychain on macOS, DPAPI on
Windows) and never leaves the machine except in calls to that provider.

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
with the running price always on screen. Every built-in option comes from
`src/lib/catalog.js` — add a field there and it appears in the flow, in the
price breakdown, in the spec sheet and in the render prompt with no other code
change.

**Your own catalog.** Shops offer things the built-in list does not, so items
and whole categories can be added from **Settings → Price list** without
touching any code:

- **+ Add item** under any category. Either a *yes / no* add-on with one price
  (a pocket square, a garment bag) or a *pick one* item whose alternatives are
  priced separately (shoe style, cufflink metal).
- **+ Add a category** for a group the built-in flow does not cover. It becomes
  its own step in the consultation, after the built-in ones.
- **+ Add option** on *every* selector, right where it is missed — another
  lapel shape, another event type, another cloth finish. Added in the builder
  itself rather than in Settings, and available on every order from then on.
  Your own options carry an *edit* link; built-in ones cannot be edited away.
- Each item can carry wording for the render prompt — *"a folded silk pocket
  square in the breast pocket"*. Leave it blank and the item stays out of the
  render, which is what you want for something that is not visible on a suit.

Custom entries are stored as the same shape as built-in fields, which is the
point: once saved they render in the builder, price into the quote, appear on
the spec sheet and reach the AI through exactly the same code paths. Deleting
one leaves existing orders untouched — a delivered suit should not change
because the price list was tidied up afterwards.

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

**Fittings.** Every suit goes through a **first fitting**, where the real
corrections are marked up, and a **final fitting** to sign it off — with room
for an additional visit between them. Each session records the tailor's notes,
the client's own comments and photos of each garment from three angles.
Recording a fitting moves the order's status to match, so the dashboard
reflects reality without anyone remembering to set it.

**Centimetres or inches.** A toggle on the Measurements step switches the whole
app between them. Everything is *stored* in centimetres regardless — a client's
body record has to stay comparable across orders, and it would drift badly if
some measurements were saved in inches depending on who took them.

**Quotes are frozen once agreed.** While an order is a draft its total follows
the price list. The moment it leaves draft — approved, in fitting, delivered —
the figures are written onto the order and stop moving, because by then a
number has been shown to a client. Change a price afterwards, or delete an
option the client chose, and the agreed quote holds; the app shows what today's
price list *would* say and offers an explicit **Re-quote** rather than
rewriting history. This applies to the dashboard, the client file and the
exported sheet alike.

**Orders of several suits.** A wedding party is one order with a suit per
person (or several for one person). Every suit is priced from its own spec,
and the running total, the dashboard, the frozen quote and the summary are
the whole order - with the suit on screen shown beside the total. Each suit
has its own cloth on the Order page; the first suit's cloth is mirrored onto
the order row, which is what the order list and the database sheet read.

**Retired options.** Taking an option off a list (GD's October notes did, for
jacket fit "Other", the old cuff and shirt-button choices) marks it
`retired` in `catalog.js` rather than deleting it: it is no longer offered,
but an order that chose it still shows it, prices it and prints it.

**Typed colours.** Lining, tuxedo, button, shirt, tie and pocket-square
colours are typed in words (`colourText` fields); there is no colour wheel. A
colour stored as a hex code by an older build is read out as words with the
code beside it, in the builder, the spec sheet and the render prompt.

**Renaming options.** Settings → Price list → **Rename** stores GD's own words
for a built-in option in the `labelOverrides` setting, keyed exactly like the
price list (`jacketFit:medium`). Only labels change; option keys - and so every
order - stay as they were.

**The informal quote.** From the Order page or the price bar: a summary of
whatever has been chosen, emailed to the client with the order's renders
attached (badged JPEGs, the same set and path as the quote email - Gmail when
connected and allowed, otherwise a draft file opened in GD's mail program).
WhatsApp and Copy carry the same words without the pictures. Before it goes,
GD sees every line at its price-list figure and can change any of them, add
his own lines (a discount, a rush charge), or go back to the price list.

What was sent is stored on the order (`informal_quote_json`): his lines, the
total, how it went, which pictures, the client's answer - and the price-list
lines it was worked out from (`basis`). While the order still prices to that
same basis, his figures are what reopening the informal quote starts from and
what fixing the price fixes it at (`agreedQuote`), with the price list's own
total kept beside them (`listTotal`) so the drift banner reports the price
list moving, not GD's discount. Change the order and the figures fall back to
the price list. Re-quoting from the drift banner is deliberately the price
list. The recipient is decided in the main process from the order (the parent
or provider for a minor), never taken from the window. Sending the formal
quote from the Summary page fixes the price first if the order is still a
draft.

**Alterations follow the measurement list.** On the Fitting page an
alteration is entered against the measurements of a garment. Logging it moves
the suit's measurement (and the wearer's body record); cancelling or deleting
it moves the figure back, unless someone has changed it since.

**Database.** A sidebar page with GD's workbook tabs (Current orders,
Completed, Suit progress, Alterations, Extras) and columns, editable in place.
DESIGN/LINING/SHIRT are worked out from the spec unless free text has been
written over them; quoted, balance and quantity are derived and read-only.
Export writes the tab as CSV for Excel.

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

## Updates

An installed copy looks for a new version **each time it opens**, and
**Settings → Updates → Check for updates** looks on demand. Either compares the
installed version against a release feed, shows what changed, and offers the
download built for that machine (arm64 vs Intel vs Windows is chosen
automatically).

**Install** then **Restart now**, and the next copy that opens is the new
version: nothing to find in Downloads, nothing to drag, no installer to click
through. **Later** works too - an update made ready goes in the next time the
app quits.

Electron's own updater (Squirrel / `electron-updater`) cannot do this here:
Squirrel only accepts a replacement that meets the running copy's own signature
requirement, and every copy released before October 2026 was ad-hoc signed - a
requirement naming that one build and nothing else. So `electron/installer.js`
does what an installer would, and everything that lets the app run what it
downloaded is a gate passed first, in the main process:

- Only a release read from **this repository's own feed**, whose file is one of
  that repository's release files (checked after the URL is normalised, so
  `../` cannot walk out of it). A custom update address still downloads, but
  never installs itself - a setting is not a reason to run code.
- Only when GitHub states the file's **SHA-256** and the download matches it.
- **On a Mac**, the disk image is opened read-only and out of sight, the one
  real `*.app` folder in it is copied out (a link is not followed), and it must
  have this app's bundle identifier, exactly the version the release names, and
  a code signature that is intact **and made with the project's certificate**
  (`codesign --verify --deep --strict -R` against `installer.SIGNER`; see
  *Signing*) - checked when it is unpacked and again at the moment it is handed
  over. An ad-hoc build, or one signed by anyone else, is offered as a download
  instead. A fixed `/bin/sh`
  script, given the paths as arguments, waits for the app to exit, copies the
  new bundle beside the old and swaps them with two renames in the same folder,
  putting the old one back if the second fails, then reopens the app.
- **On Windows**, the downloaded installer is hashed again at hand-over and run
  silently as an update (`/S --updated --force-run`); it closes the app,
  replaces it in place and reopens it.
- Only in an **installed copy that this account can write to**. A copy run from
  source, from the installer disk, from macOS's quarantine copy
  (App Translocation) or from a folder the account cannot change says why and
  falls back to the download.

Anything that fails a gate falls back to the download the tailor installs by
hand, with the reason shown. A version that was handed over and did not go in
(the result is checked on the next launch) is offered as a download from then
on rather than retried on every quit. The update is made ready inside the
app's own data folder (`updates/`), never in Downloads, and the record of it is
a setting a page can neither read nor write.

On a Mac, the first launch after each update may ask for the keychain password
once, so the new copy can read the saved API keys. The project certificate does
not stop this: macOS only carries a saved password across builds for apps
signed with an Apple-issued certificate, and ties it to the exact build
otherwise. The app says so and asks for **Always Allow**. An Apple Developer ID
would end it - see *Signing*.

Copies older than this change cannot install themselves - they update once by
hand, the old way, and from then on they do.

**Only the newest copy opens.** An update in place replaces the copy that was
running, but a copy opened from anywhere else - straight from the disk image,
from Downloads, from a `release/` folder Spotlight found - would leave the one
in Applications as it was, and the Dock would go on opening that. So as an
installed copy starts (`electron/placement.js`):

- It records the newest version opened on this account, and where it was. A
  copy older than that does not run: it opens the newer copy if that is still
  where it was, and otherwise says it is out of date and quits, offering the
  releases page. An older version would be opening orders a newer one has
  already changed.
- A Mac copy outside Applications opens the copy in Applications instead when
  that one is at least as new, and otherwise offers to **move itself there**,
  replacing the older one (Electron's `app.moveToApplicationsFolder`; the
  replaced copy goes to the Bin). If the older copy is still open it is not
  handed control - the tailor is asked to quit it first.
- Anything else under the app's name in Applications, or a copy renamed by
  hand, is left alone.

Copies released before this check cannot be stopped by it - they do not have
it. Moving the new copy into Applications replaces them.

A release that is not installed in place is downloaded **once**. The copy that
is running stays the old version until the new one is installed, so the
release goes on being newer than it; the app remembers the installer it saved
and, while that file is still in the Downloads folder exactly as it was
checked, shows it ("Already in your Downloads folder") instead of offering the
download again. Delete or change the file and the release is offered afresh.
On the newest version, Updates says "Up to date" and offers nothing - and main
refuses a download or an install if asked anyway.

**Publishing a release.** Nothing to do by hand: every merge to `main` builds
both platforms and publishes a release (`.github/workflows/release.yml`),
numbered `<major>.<minor>.<run number>` from `package.json`. Put
`[skip release]` in the merge commit message for a change that does not need
one, such as a docs-only PR. The default feed is the releases endpoint for
this repository.

A copy run from source reports the `version` in `package.json` (`0.1.0`), which
the workflow stamps only inside the build, so it will always see the latest
release as newer. That is expected; installed copies report their real number.

Two things to know while the repository is **private**: its releases are
private too, so the check returns "no releases found" until either an access
token is set (Settings → Updates → Where updates come from) or releases are
published somewhere public. A token is fine for your own machine but should
not be shipped to anyone else's — publish releases publicly before handing the
app out. The feed can also point at a plain JSON file of the shape
`{ version, notes, url, assets: [{ name, url }] }`; it must be https.

Looking on launch is **on by default** in an installed copy and can be
turned off in the same place (a copy run from source looks only if it is
turned on). A version it finds is put in front of the tailor once; after that
it is the flag in the corner and the Updates page. It is one GET for the
latest version number; nothing about the user or their clients is sent.

---

## Tests

```bash
npm test              # security, updates, catalog, workflow, then the render pipeline
npm run test:security # proves the hardening actually blocks attacks
npm run test:updates  # the update flow against a stubbed release feed
npm run test:install  # an update installing itself, with real disk images and a real swap (macOS)
npm run test:signing  # afterPack's signing, a real launch, and what the installer accepts (macOS)
npm run test:placement # an older copy never opens; a copy outside Applications moves there
npm run test:catalog  # adds a custom category and items, then checks the whole chain
npm run test:models   # the model picker only offers models the key really has
npm run test:workflow # units, custom options on built-in selectors, first/final fittings
npm run test:quote    # an agreed quote must not move when the price list does
npm run test:migrations # every historical schema version upgrades without data loss
npm run test:render   # drives the whole render pipeline with the network stubbed
npm run test:tour     # boots the UI, walks every step, writes screenshots
npm run test:feedback # GD's October notes, end to end in the running app
```

Run the suites from a plain terminal. A shell inside VS Code (or any Electron
app) exports `ELECTRON_RUN_AS_NODE=1`, which turns `electron` into plain Node
and every suite fails at `app.setName` - `unset ELECTRON_RUN_AS_NODE` first.

Neither needs an API key. `test:render` intercepts the outbound call and checks
the request shape, that the returned image is stored and served back, that a
tweak chains to its parent, and that reference usage is recorded.
`test:security` attempts real attacks — path traversal, id injection, a
disguised HTML payload, renderer network egress — and fails if any succeeds.
`test:updates` covers version comparison, per-platform asset selection, and
that a `file://` or `javascript:` download address is refused. `test:install`
builds tiny app bundles and disk images, signed with a throwaway certificate
the way releases are signed with the real one, then runs the unpacking,
the signature checks and the swap itself for real against folders of its own -
nothing in Applications is touched; only the network and the final hand-over
to the quitting app are stubbed. `test:catalog`
adds a category and both kinds of item through the real UI, then checks they
appear in the builder, charge the right amount and reach the spec sheet.

`test:workflow` deliberately does **not** assert on simulated typing. React's
controlled inputs only update from a genuine keystroke — neither a programmatic
`.value` write nor Electron's `insertText` moves React's state — so asserting
on it would test Electron's input simulation rather than this app. The unit
conversion is asserted from both directions instead.

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

**Informal quotes** — the window supplies the words and GD's figures; the
main process supplies the recipient and the attachments from the order on
file, so a compromised window cannot send an order's details or renders to a
number or address that is not on it. The figures are validated in main
(bounded line count, labels and amounts) and the stored total is summed there,
never taken from the window. WhatsApp opens through `openExternalSafely`
(https only). Nothing is hosted: there is no quote page and no link.

**Alterations** — an alteration may only name a suit on its own order; the
measurement figures before and after are read from the database, not taken
from the window.

**Spreadsheet export** — a cell beginning `=`, `+`, `-` or `@` is prefixed
with an apostrophe, so a client name typed as a formula stays text in Excel.

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
- **Builds are signed with the project's own certificate, not an Apple
  Developer ID, and not notarised** (see *Signing*).
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

The Mac installers build on a Mac. **The Windows installer is built by the
release workflow on a Windows runner.** On a Mac, electron-builder stamps the
`.exe` through Wine, which is Intel-only, so it needs Rosetta - and macOS 27 no
longer has it. On Apple silicon without Rosetta `dist:win` fails at that step,
and worse, leaves a Windows build of the SQLite driver in `node_modules`, so run
`npx electron-builder install-app-deps` afterwards before any test.

The mac target builds each architecture in a separate pass. Running them in one
pass makes electron-builder do both in parallel, and they collide in a shared
temp directory (`hdiutil resize` fails and you silently get only one DMG).

**Note:** building for another architecture rebuilds the native SQLite module
for that architecture *in place*, which leaves the dev app unable to start.
Each `dist:` script rebuilds it for the host afterwards; if you ever run
`electron-builder` directly, finish with `npx electron-builder install-app-deps`.

### Hardening the binary

`build/afterPack.js` flips Electron's build-time fuses before signing. The one
that matters is **RunAsNode**: left on, the shipped app can be driven as a
plain Node process, which sidesteps every renderer control in `security.js`.
Also off: `NODE_OPTIONS` injection and `--inspect` (which would attach a
debugger to the process holding the API key). On: asar integrity validation and
`OnlyLoadAppFromAsar`, so a modified archive is refused and an unpacked `app/`
folder cannot be loaded in its place.

Verified against a real tamper — extract the archive, edit `main.js`, repack,
re-sign ad-hoc, and the app aborts:

```
FATAL:asar_util.cc(144)] Integrity check failed for asar archive
```

Note what that does **not** cover without an Apple Developer ID: an attacker
who can rewrite the archive on the machine can also rewrite the hash in
`Info.plist` and re-sign ad hoc, and macOS will run it. What the project
certificate does stop is such a copy arriving as an update. These fuses raise
the bar and are the correct pairing for a real Developer ID signature; they are
not a substitute for one.

### Signing

Every Mac release is signed with **the project's own certificate**:
self-made, CN "GD Suits Studio", valid until 2046. Its public half is
`build/signing-cert.pem`, and `electron/installer.js` names it by SHA-1 as
`SIGNER`. What that buys:

- **Updates are bound to it.** An installed copy installs an update only if it
  carries this certificate (see *Updates*). A release built anywhere else, or
  signed by anyone else, is offered as a download instead.
- **macOS names the app by its certificate, not by one build.** Its designated
  requirement is `identifier "za.co.gdsuits.studio" and certificate leaf =
  H"…"`, the same for every release, so a permission granted to one version
  (the camera) should carry to the next. Not yet seen on a real update.

What it does not do: Gatekeeper still warns on first launch, and the keychain
still asks once after each update - both need an Apple Developer ID.

**Where it lives.** The release job reads two Actions secrets,
`MAC_SIGNING_P12` (the certificate and key, base64) and `MAC_SIGNING_PASSWORD`.
`build/mac-keychain.sh` puts them in a throwaway keychain of their own, never on
the keychain search list, and `build/afterPack.js` signs from it with
`codesign --keychain`. The job stops if the secrets are missing, and afterPack
stops any CI build that would come out unsigned - or signed with a certificate
other than `SIGNER` - rather than publish a release no installed copy would
take. The only other copy of the key is the owner's backup; it is not in this
repository. A build on a laptop has no keychain and is signed ad hoc: it runs,
but nothing installed takes it as an update.

**Changing the certificate** strands every copy that trusts only the old one:
they fall back to the download. To change it without that, first ship a release
(signed with the old one) whose `SIGNER` check accepts both.

Two things the signing handles, both of which fail silently otherwise:

- Apple Silicon refuses to run any unsigned binary — an unsigned build is
  killed at launch with no error at all.
- `codesign --deep` does *not* fix it. macOS rejects the result with
  "different Team IDs" because the nested Electron Framework keeps its original
  signature. `build/afterPack.js` signs nested code explicitly, innermost
  first, all with the same certificate.

To distribute properly, get an Apple Developer ID, set `build.mac.identity` in
`package.json` to that identity and `build.mac.hardenedRuntime` back to `true`,
then notarise. `afterPack.js` stands aside automatically once an identity is
set. Do that in two releases: the first still signed with the project
certificate and accepting the Developer ID as well, so installed copies take
the second.

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
