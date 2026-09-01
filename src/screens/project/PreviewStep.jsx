import React, { useMemo, useState } from 'react';
import { api, projectMedia, clientMedia, messageFor } from '../../lib/api.js';
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
  const [activeId, setActiveId] = useState(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [pickingRefs, setPickingRefs] = useState(false);
  const toast = useToast();

  const spec = project.spec ?? {};
  const analysis = project.analysis ?? {};
  const renders = project.renders ?? [];
  const active = renders.find((r) => r.id === activeId) ?? renders[0] ?? null;

  /** Reference images sent with the render, in the order the prompt describes them. */
  const renderRefs = useMemo(() => {
    const out = [];
    const face = photoBySlot('face');
    const front = photoBySlot('front');
    const side = photoBySlot('side');
    const back = photoBySlot('back');

    // Whichever subject photo matches the requested camera angle leads.
    const subject = view === 'side' ? side ?? front : view === 'back' ? back ?? front : front ?? face;
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
  }, [view, selectedRefs, references, photoBySlot, project.client_id]);

  const prompt = useMemo(
    () =>
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
        view,
        refs: renderRefs,
        notes: direction,
        steps,
      }),
    [spec, analysis, view, renderRefs, direction, project.name, project.surname, steps]
  );

  const clauses = describeGarment(spec, steps);
  const missingBase = !spec.suitType;

  async function render() {
    setBusy(true);
    try {
      const result = await api.ai.render({
        projectId: project.id,
        prompt,
        view,
        refs: renderRefs.map((r) => ({
          filename: r.filename,
          mime: r.mime,
          scope: r.scope ?? `project-${project.id}`,
        })),
        referenceIds: selectedRefs,
      });
      await reload();
      setActiveId(result.id);
      toast('Render ready', 'ok');
    } catch (err) {
      toast(messageFor(err), 'err');
    } finally {
      setBusy(false);
    }
  }

  async function applyTweak() {
    if (!active || !tweak.trim()) return;
    setBusy(true);
    try {
      const result = await api.ai.render({
        projectId: project.id,
        prompt: buildTweakPrompt({ instruction: tweak, spec, view: active.view }),
        view: active.view,
        parentId: active.id,
        instruction: tweak,
        refs: [{ filename: active.filename, mime: 'image/png', scope: `project-${project.id}` }],
      });
      await reload();
      setActiveId(result.id);
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
                  >
                    {v.label}
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
                      Rendering the {VIEWS.find((v) => v.key === view)?.label.toLowerCase()} view...
                      <br />
                      <span className="tiny">This usually takes 10-30 seconds.</span>
                    </div>
                  </div>
                ) : active ? (
                  <img src={projectMedia(project.id, active.filename)} alt="Suit visualisation" />
                ) : (
                  <div className="center progress-note">
                    Nothing rendered yet.
                    <br />
                    <span className="tiny">Capture the client and the cloth, build the spec, then render.</span>
                  </div>
                )}
              </div>

              {renders.length > 0 && (
                <div className="render-strip" style={{ marginTop: 12 }}>
                  {renders.map((r) => (
                    <button
                      key={r.id}
                      className={`render-thumb ${active?.id === r.id ? 'active' : ''}`}
                      onClick={() => setActiveId(r.id)}
                      title={r.instruction || `${r.view} view`}
                    >
                      <img src={projectMedia(project.id, r.filename)} alt="" />
                    </button>
                  ))}
                </div>
              )}

              <div className="inline" style={{ marginTop: 12 }}>
                <button className="btn btn-gold" onClick={render} disabled={busy || !hasKey || missingBase}>
                  {active ? 'Render again' : 'Render preview'}
                </button>
                <button className="btn" onClick={() => setPickingRefs(true)}>
                  Reference images{selectedRefs.length ? ` (${selectedRefs.length})` : ''}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowPrompt(true)}>See the prompt</button>
                <div style={{ flex: 1 }} />
                {active && (
                  <>
                    <button
                      className={`btn btn-sm ${active.approved ? 'btn-gold' : ''}`}
                      onClick={async () => {
                        await api.renders.approve({ id: active.id, approved: !active.approved });
                        await reload();
                      }}
                    >
                      {active.approved ? 'Approved' : 'Mark approved'}
                    </button>
                    <ConfirmButton
                      className="btn btn-sm btn-ghost btn-danger"
                      confirmLabel="Delete render?"
                      onConfirm={async () => {
                        await api.renders.delete({ id: active.id });
                        setActiveId(null);
                        await reload();
                      }}
                    >
                      Delete
                    </ConfirmButton>
                  </>
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
        <Modal title="Prompt sent to the model" onClose={() => setShowPrompt(false)} wide>
          <p className="small muted" style={{ marginTop: 0 }}>
            Built from the spec, the measured skin tone and the reference photos. Shown so you can see exactly what
            the model was told - if a render is wrong, this is where to look first.
          </p>
          <pre className="mono" style={{ whiteSpace: 'pre-wrap', background: '#fbfaf7', padding: 14, borderRadius: 9, border: '1px solid var(--line)', maxHeight: '52vh', overflow: 'auto' }}>
            {prompt}
          </pre>
        </Modal>
      )}
    </div>
  );
}
