import React, { useCallback, useMemo, useState } from 'react';
import { api, projectMedia, clientMedia, brandedRender, messageFor } from '../../lib/api.js';
import DownloadButton from '../../components/DownloadButton.jsx';
import { buildRenderPrompt, buildTweakPrompt, VIEWS, describeGarment } from '../../lib/promptBuilder.js';
import { Banner, Modal, Spinner, useToast, ConfirmButton } from '../../components/ui.jsx';
import ReferenceLibrary from '../../components/ReferenceLibrary.jsx';
import NotesPanel from '../../components/NotesPanel.jsx';

/**
 * Generates the client-facing visualisation and then refines it.
 *
 * A tweak edits the *previous render* rather than starting over, so the
 * client's likeness and every already-agreed detail survive the change - which
 * is the difference between a usable tool and rolling dice on each attempt.
 */
export default function PreviewStep({ ctx, hasKey, steps }) {
  const { project, references, reload, reloadReferences, addNote, deleteNote, photoBySlot } = ctx;
  const [view, setView] = useState('front');
  const [selectedRefs, setSelectedRefs] = useState([]);
  const [direction, setDirection] = useState('');
  const [tweak, setTweak] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [activeBatch, setActiveBatch] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);
  // A hand-edited prompt replaces the generated one until it is reset. Kept
  // separate from the generated text so the spec can carry on driving that,
  // and the tailor can always see what they diverged from.
  const [promptOverride, setPromptOverride] = useState(null);
  const [promptDraft, setPromptDraft] = useState('');
  const [pickingRefs, setPickingRefs] = useState(false);
  const toast = useToast();

  const spec = ctx.spec ?? project.spec ?? {};
  const analysis = project.analysis ?? {};
  // Scoped to the man on screen: on a wedding party the groom's preview must
  // not be showing the best man's jacket.
  const renders = ctx.renders ?? project.renders ?? [];

  /**
   * One press is one render, and it has four pictures in it.
   *
   * The tabs are angles on a single thing, not four separate things: pressing
   * render produces a set, and the tabs walk round it. So what is selected is
   * the *set*, and the stage shows that set's picture for the angle being
   * looked at. Choosing an older set keeps you in that set as you turn round
   * it, rather than dropping you back into the newest picture per tab, which
   * would be four halves of two different suits.
   *
   * Renders arrive newest first, so the first match in a set is the current
   * one for that angle - a refinement lands in the set it refines.
   */
  const batches = useMemo(() => {
    const seen = [];
    for (const r of renders) if (!seen.includes(r.batch_id)) seen.push(r.batch_id);
    return seen;
  }, [renders]);
  const batch = batches.includes(activeBatch) ? activeBatch : batches[0] ?? null;
  const inBatch = useMemo(() => renders.filter((r) => r.batch_id === batch), [renders, batch]);
  const active = inBatch.find((r) => r.view === view) ?? null;
  const rendered = useMemo(() => new Set(inBatch.map((r) => r.view)), [inBatch]);

  /**
   * Reference images for one view, in the order the prompt describes them.
   *
   * Takes the view rather than reading the selected one, because rendering
   * the whole set needs each view's own photographs: the back view leads with
   * the photograph of the client's back, and sending the front one instead is
   * how every view used to come back front-on.
   */
  const refsForView = useCallback((which) => {
    const out = [];
    const face = photoBySlot('face');
    const front = photoBySlot('front');
    const side = photoBySlot('side');
    const back = photoBySlot('back');

    // Whichever subject photo matches the requested camera angle leads.
    const subject = which === 'side' ? side ?? front : which === 'back' ? back ?? front : front ?? face;
    if (subject) out.push({ ...subject, role: 'subject', label: 'client', slot: subject.slot });
    if (face && face !== subject) out.push({ ...face, role: 'subject', label: 'client face', slot: 'face' });

    const fabric = photoBySlot('fabric');
    if (fabric) out.push({ ...fabric, role: 'swatch', label: 'fabric', slot: 'fabric' });
    const lining = photoBySlot('lining');
    if (lining) out.push({ ...lining, role: 'swatch', label: 'lining', slot: 'lining' });

    for (const id of selectedRefs) {
      const ref = references.find((r) => r.id === id);
      if (ref) {
        out.push({
          filename: ref.filename,
          mime: ref.mime,
          scope: `client-${project.client_id}`,
          role: 'reference',
          label: ref.title || 'style reference',
          slot: 'reference',
        });
      }
    }
    return out;
  }, [selectedRefs, references, photoBySlot, project.client_id]);

  const promptForView = useCallback(
    (which) =>
      buildRenderPrompt({
        spec,
        client: { name: project.name, surname: project.surname },
        analysis: {
          skinToneHex: analysis.skinTone?.hex,
          skinToneLabel: analysis.skinTone?.label,
          undertone: analysis.skinTone?.undertone,
          build: analysis.body?.build,
          posture: analysis.body?.posture,
        },
        view: which,
        refs: refsForView(which),
        notes: direction,
        steps,
      }),
    [spec, analysis, refsForView, direction, project.name, project.surname, steps]
  );

  const renderRefs = useMemo(() => refsForView(view), [refsForView, view]);
  const prompt = useMemo(() => promptForView(view), [promptForView, view]);

  const clauses = describeGarment(spec, steps);
  const missingBase = !spec.suitType;
  const effectivePrompt = promptOverride ?? prompt;
  const promptEdited = promptOverride !== null && promptOverride !== prompt;

  /**
   * Renders the views given, one after another.
   *
   * One press produces the whole set, because a suit is shown to a client
   * from four sides and making the tailor ask for each one separately - then
   * wait, then remember which he had done - is four chances to send a client
   * three views and a gap. They go one at a time rather than at once: the
   * provider rate-limits, and a queue of four gives an honest "3 of 4" to
   * look at instead of a spinner that might mean anything.
   *
   * If a view fails before any has succeeded, the rest are abandoned. That is
   * a missing key, an exhausted quota or no signal - conditions the next
   * three calls would meet too, and there is no sense spending them to be
   * told the same thing four times. A failure *after* something worked is
   * treated as that one view's bad luck, and the others still go.
   *
   * `into` is the set they join. A whole set starts a new one; redoing a
   * single view joins the set it is correcting, so the tailor still has one
   * render with four pictures in it rather than a loose image beside it.
   */
  async function renderViews(views, overridePrompt, into) {
    const batchId = into ?? crypto.randomUUID();
    setBusy(true);
    const failed = [];
    let succeeded = 0;
    let last = null;
    try {
      for (let i = 0; i < views.length; i++) {
        const which = views[i];
        setProgress({ view: which, done: i, total: views.length });
        try {
          // A hand-edited prompt belongs to the view it was written for. The
          // others are still described by the spec.
          const usePrompt =
            overridePrompt ?? (promptOverride !== null && which === view ? promptOverride : promptForView(which));
          const result = await api.ai.render({
            projectId: project.id,
            suitId: ctx.activeSuitId ?? undefined,
            batchId,
            prompt: usePrompt,
            view: which,
            refs: refsForView(which).map((r) => ({
              filename: r.filename,
              mime: r.mime,
              scope: r.scope ?? `project-${project.id}`,
            })),
            referenceIds: selectedRefs,
          });
          succeeded++;
          last = { id: result.id, view: which };
        } catch (err) {
          failed.push({ view: which, message: messageFor(err) });
          if (succeeded === 0) break;
        }
      }
    } finally {
      setProgress(null);
      setBusy(false);
    }

    await reload();
    // Show what was just made, whether that is a new set or the set a single
    // view was corrected in.
    if (succeeded > 0) setActiveBatch(batchId);

    const name = (key) => VIEWS.find((v) => v.key === key)?.label.toLowerCase() ?? key;
    if (failed.length && succeeded === 0) toast(failed[0].message, 'err');
    else if (failed.length) toast(`Rendered ${succeeded}, but the ${failed.map((f) => name(f.view)).join(' and ')} failed`, 'warn');
    else toast(views.length === 1 ? 'Render ready' : `All ${views.length} views rendered`, 'ok');
  }

  const renderEverything = () => renderViews(VIEWS.map((v) => v.key));
  // Correcting one angle of the render on screen, not starting a new one.
  const renderThisView = (overridePrompt) => renderViews([view], overridePrompt, batch ?? undefined);

  async function applyTweak() {
    if (!active || !tweak.trim()) return;
    setBusy(true);
    try {
      const result = await api.ai.render({
        projectId: project.id,
        suitId: ctx.activeSuitId ?? undefined,
        // A refinement belongs to the render it refines.
        batchId: active.batch_id,
        prompt: buildTweakPrompt({ instruction: tweak, spec, view: active.view }),
        view: active.view,
        parentId: active.id,
        instruction: tweak,
        refs: [{ filename: active.filename, mime: 'image/png', scope: `project-${project.id}` }],
      });
      await reload();
      setTweak('');
      toast('Tweak applied', 'ok');
    } catch (err) {
      toast(messageFor(err), 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {!hasKey && (
        <Banner kind="warn">
          No Gemini API key yet, so rendering is switched off. Everything else - capture, spec, measurements,
          notes and pricing - works without it. Add a key in Settings to turn rendering on.
        </Banner>
      )}
      {missingBase && <Banner kind="warn">Pick a suit type in the Base step before rendering.</Banner>}

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 3, minWidth: 520 }}>
          <div className="card">
            <div className="card-head">
              <h3>Preview</h3>
              <div className="spacer" />
              <div className="stepper" style={{ background: 'transparent', border: 0, padding: 0 }}>
                {VIEWS.map((v) => (
                  <button
                    key={v.key}
                    className={`step-tab ${view === v.key ? 'active' : ''}`}
                    onClick={() => setView(v.key)}
                    title={rendered.has(v.key) ? `${v.label} view rendered` : `${v.label} view not rendered yet`}
                  >
                    {v.label}{rendered.has(v.key) ? ' ·' : ''}
                  </button>
                ))}
              </div>
            </div>

            <div className="card-pad">
              <div className="render-stage">
                {busy ? (
                  <div className="center">
                    <Spinner />
                    <div className="progress-note">
                      Rendering the {VIEWS.find((v) => v.key === (progress?.view ?? view))?.label.toLowerCase()} view
                      {progress && progress.total > 1 ? ` - ${progress.done + 1} of ${progress.total}` : ''}...
                      <br />
                      <span className="tiny">
                        {progress && progress.total > 1
                          ? 'Each one takes 10-30 seconds. They are done one at a time.'
                          : 'This usually takes 10-30 seconds.'}
                      </span>
                    </div>
                  </div>
                ) : active ? (
                  // Shown with its badge, exactly as the client will receive it. The
                  // file on disk stays clean so refining it does not feed the mark back in.
                  <img src={brandedRender(project.id, active.filename)} alt="Suit visualisation" />
                ) : (
                  <div className="center progress-note">
                    Nothing rendered yet.
                    <br />
                    <span className="tiny">Capture the client and the cloth, build the spec, then render.</span>
                  </div>
                )}
              </div>

              {/* One entry per render, not per picture. Each shows the angle
                  currently being looked at, so moving along the strip
                  compares like with like. */}
              {batches.length > 1 && (
                <div className="render-strip" style={{ marginTop: 12 }}>
                  {batches.map((id) => {
                    const r = renders.find((x) => x.batch_id === id && x.view === view)
                      ?? renders.find((x) => x.batch_id === id);
                    if (!r) return null;
                    const views = renders.filter((x) => x.batch_id === id).length;
                    return (
                    <button
                      key={id}
                      className={`render-thumb ${batch === id ? 'active' : ''}`}
                      onClick={() => setActiveBatch(id)}
                      title={r.instruction || `${views} view${views === 1 ? '' : 's'}`}
                    >
                      <img src={projectMedia(project.id, r.filename)} alt="" />
                    </button>
                    );
                  })}
                </div>
              )}

              <div className="render-actions">
                <button className="btn btn-gold" onClick={renderEverything} disabled={busy || !hasKey || missingBase}>
                  {rendered.size ? 'Render all four again' : 'Render all four views'}
                </button>
                {/* One view at a time, for when three are right and the
                    fourth is not - four renders is four times the cost. */}
                <button className="btn" onClick={() => renderThisView()} disabled={busy || !hasKey || missingBase}>
                  Just the {VIEWS.find((v) => v.key === view)?.label.toLowerCase()}
                </button>
                <button className="btn" onClick={() => setPickingRefs(true)}>
                  Reference images{selectedRefs.length ? ` (${selectedRefs.length})` : ''}
                </button>
                {active && !busy && (
                  <DownloadButton
                    src={projectMedia(project.id, active.filename)}
                    name={`${project.order_ref || 'GD Suits'} ${active.view} render`}
                    label="Download render"
                  />
                )}
                <button
                  className="btn btn-ghost"
                  onClick={() => { setPromptDraft(effectivePrompt); setShowPrompt(true); }}
                >
                  {promptEdited ? 'Edit the prompt ·' : 'See the prompt'}
                </button>
                {promptEdited && <span className="pill" title="This render uses your edited prompt">edited</span>}
                {active && (
                  <span className="render-actions-end">
                    <button
                      className={`btn ${active.approved ? 'btn-gold' : ''}`}
                      onClick={async () => {
                        await api.renders.approve({ id: active.id, approved: !active.approved });
                        await reload();
                      }}
                    >
                      {active.approved ? 'Approved' : 'Mark approved'}
                    </button>
                    <ConfirmButton
                      className="btn btn-ghost btn-danger"
                      confirmLabel="Delete render?"
                      onConfirm={async () => {
                        await api.renders.delete({ id: active.id });
                        await reload();
                      }}
                    >
                      Delete
                    </ConfirmButton>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-head">
              <h3>Refine this render</h3>
              <div className="spacer" />
              <span className="tiny faint">Edits the current image, keeping the face and pose</span>
            </div>
            <div className="card-pad">
              <textarea
                className="textarea"
                placeholder='One change at a time works best - "make the lapel a little wider", "open the jacket to show the waistcoat", "warmer lighting".'
                value={tweak}
                onChange={(e) => setTweak(e.target.value)}
                disabled={!active}
              />
              <div className="inline" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-primary" onClick={applyTweak} disabled={busy || !active || !tweak.trim() || !hasKey}>
                  Apply tweak
                </button>
              </div>

              {active?.instruction && (
                <p className="tiny faint" style={{ marginBottom: 0 }}>
                  This version came from: "{active.instruction}"
                </p>
              )}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 300 }}>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head"><h3>Going into the render</h3></div>
            <div className="card-pad">
              <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Reference photos ({renderRefs.length})</div>
              {renderRefs.length === 0 ? (
                <p className="tiny faint">No photos captured yet - the render will be generic.</p>
              ) : (
                <div className="swatch-row" style={{ marginBottom: 12 }}>
                  {renderRefs.map((r, i) => (
                    <img
                      key={i}
                      src={r.scope ? clientMedia(project.client_id, r.filename) : projectMedia(project.id, r.filename)}
                      alt={r.label}
                      title={r.label}
                      style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 7, border: '1px solid var(--line)' }}
                    />
                  ))}
                </div>
              )}

              <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Spec being drawn</div>
              {clauses.length === 0 ? (
                <p className="tiny faint">Nothing chosen yet.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {clauses.map((c, i) => <li key={i} className="tiny">{c}</li>)}
                </ul>
              )}

              <hr className="divider" />
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Extra direction (optional)</label>
                <textarea
                  className="textarea"
                  style={{ minHeight: 60 }}
                  placeholder="Standing at an altar, warm evening light..."
                  value={direction}
                  onChange={(e) => setDirection(e.target.value)}
                />
              </div>
            </div>
          </div>

          <NotesPanel step="preview" notes={project.notes} onAdd={(b) => addNote('preview', b)} onDelete={deleteNote} compact />
        </div>
      </div>

      {pickingRefs && (
        <Modal title="Reference images for this render" onClose={() => setPickingRefs(false)} wide
          footer={<><div className="spacer" /><button className="btn btn-primary" onClick={() => setPickingRefs(false)}>Done</button></>}>
          <p className="small muted" style={{ marginTop: 0 }}>
            Pick the references to feed into the next render. They stay on {project.name}'s client file for future orders.
          </p>
          <ReferenceLibrary
            clientId={project.client_id}
            projectId={project.id}
            references={references}
            onChanged={reloadReferences}
            selectable
            selected={selectedRefs}
            onToggleSelect={(id) =>
              setSelectedRefs((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))
            }
          />
        </Modal>
      )}

      {showPrompt && (
        <Modal
          title="The prompt"
          onClose={() => setShowPrompt(false)}
          wide
          footer={
            <>
              <button
                className="btn"
                disabled={promptDraft === prompt}
                onClick={() => { setPromptDraft(prompt); setPromptOverride(null); }}
                title="Go back to the prompt built from the spec"
              >
                Reset to generated
              </button>
              <div className="spacer" />
              <button className="btn" onClick={() => setShowPrompt(false)}>Close</button>
              <button
                className="btn btn-primary"
                onClick={() => { setPromptOverride(promptDraft); setShowPrompt(false); }}
              >
                Keep edits
              </button>
              <button
                className="btn btn-gold"
                disabled={busy || !hasKey || missingBase}
                onClick={() => { setPromptOverride(promptDraft); setShowPrompt(false); renderThisView(promptDraft); }}
              >
                Render with this
              </button>
            </>
          }
        >
          <p className="small muted" style={{ marginTop: 0 }}>
            Built from the spec, the measured skin tone and the reference photos - and editable. If a render is
            wrong, this is where to look first, and where to fix it. Edits stay until you reset, so you can render,
            adjust the wording, and render again until it is right.
          </p>
          {promptEdited && (
            <Banner kind="warn">
              You are using an edited prompt, so changes to the spec no longer update it. Reset to pick them up
              again.
            </Banner>
          )}
          <textarea
            className="textarea mono"
            style={{ minHeight: '46vh', lineHeight: 1.5 }}
            value={promptDraft}
            spellCheck={false}
            onChange={(e) => setPromptDraft(e.target.value)}
          />
          <div className="inline" style={{ justifyContent: 'space-between', marginTop: 6 }}>
            <span className="tiny faint">{promptDraft.length} characters</span>
            <span className="tiny faint">
              The reference photos are attached separately - describing them here does not replace them.
            </span>
          </div>
        </Modal>
      )}
    </div>
  );
}
