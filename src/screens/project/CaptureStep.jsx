import React, { useState } from 'react';
import { api, projectMedia, messageFor } from '../../lib/api.js';
import { PHOTO_SLOTS } from '../../lib/catalog.js';
import { suggestFabrics } from '../../lib/colour.js';
import PhotoSlot from '../../components/PhotoSlot.jsx';
import DownloadButton from '../../components/DownloadButton.jsx';
import ColourSampler from '../../components/ColourSampler.jsx';
import NotesPanel from '../../components/NotesPanel.jsx';
import { Banner, Modal, Spinner, useToast } from '../../components/ui.jsx';

const SUBJECT_SLOTS = PHOTO_SLOTS.filter((s) => s.role === 'subject');

/** Structured shape asked of the vision model, so the reply is usable data. */
const BODY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    build: { type: 'STRING', description: 'Short description of the overall build, e.g. "lean, long-limbed"' },
    posture: { type: 'STRING', description: 'Posture observations relevant to tailoring, e.g. "slight forward head, right shoulder lower"' },
    shoulders: { type: 'STRING', description: 'Shoulder slope and width notes' },
    proportions: { type: 'STRING', description: 'Torso to leg proportion notes' },
    fitAdvice: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Concrete tailoring recommendations' },
    cautions: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Things that would fit badly on this body' },
  },
  required: ['build', 'posture', 'fitAdvice'],
};

export default function CaptureStep({ ctx }) {
  const { project, savePhoto, deletePhoto, addNote, deleteNote, updateAnalysis, photoBySlot } = ctx;
  const [sampling, setSampling] = useState(null);
  const [analysing, setAnalysing] = useState(false);
  const [viewing, setViewing] = useState(null);
  const toast = useToast();

  const analysis = project.analysis ?? {};
  const tone = analysis.skinTone ?? null;

  async function runBodyAnalysis() {
    const subjectPhotos = SUBJECT_SLOTS
      .map((s) => photoBySlot(s.key))
      .filter(Boolean)
      .map((p) => ({ filename: p.filename, mime: p.mime }));

    if (!subjectPhotos.length) {
      toast('Capture at least one photo of the client first.', 'err');
      return;
    }

    setAnalysing(true);
    try {
      const { data } = await api.ai.analyse({
        projectId: project.id,
        refs: subjectPhotos,
        schema: BODY_SCHEMA,
        prompt:
          'You are an experienced bespoke tailor assessing a client from their fitting photographs. ' +
          'Describe only what you can actually see that affects how a suit should be cut - build, posture, ' +
          'shoulder slope and asymmetry, torso-to-leg proportion. Give practical cutting recommendations ' +
          '(for example: "a slightly extended shoulder will balance the sloped right side"). ' +
          'Be respectful and clinical, the way a tailor writes on a work docket. Do not guess at weight, ' +
          'height in numbers, age or ethnicity.',
      });
      await updateAnalysis({ body: data });
      toast('Body read saved to the client file', 'ok');
    } catch (err) {
      toast(messageFor(err), 'err');
    } finally {
      setAnalysing(false);
    }
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <h3>Client photographs</h3>
          <div className="spacer" />
          <span className="tiny faint">Front, side and back are what the render is built from</span>
        </div>
        <div className="card-pad">
          <div className="photo-grid">
            {SUBJECT_SLOTS.map((slot) => {
              const photo = photoBySlot(slot.key);
              return (
                <PhotoSlot
                  key={slot.key}
                  slot={slot}
                  photo={photo ? { ...photo, url: projectMedia(project.id, photo.filename) } : null}
                  onSave={({ dataUrl, meta }) => savePhoto({ slot: slot.key, dataUrl, meta })}
                  onClear={(p) => deletePhoto(p.id)}
                  onOpen={(p) => setViewing(p)}
                  downloadName={`${project.name} ${project.surname} ${slot.label}`}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 2, minWidth: 420 }}>
          <div className="card">
            <div className="card-head">
              <h3>Skin tone</h3>
              <div className="spacer" />
              {tone && <span className="pill">{tone.hex}</span>}
            </div>
            <div className="card-pad">
              {!photoBySlot('face') && !photoBySlot('front') ? (
                <Banner kind="info">Capture a face or front photo first, then sample the skin tone from it.</Banner>
              ) : (
                <>
                  <p className="small muted" style={{ marginTop: 0 }}>
                    Sampled from the photo on this machine - no internet needed. The measured tone is handed to the
                    render so the model is told the client's complexion instead of inventing one.
                  </p>
                  <div className="inline">
                    <button
                      className="btn btn-primary"
                      onClick={() => setSampling(photoBySlot('face') ?? photoBySlot('front'))}
                    >
                      {tone ? 'Re-sample skin tone' : 'Sample skin tone'}
                    </button>
                    {tone && (
                      <>
                        <div className="swatch swatch-lg" style={{ background: tone.hex }} />
                        <div>
                          <div style={{ fontWeight: 600 }}>{tone.label}</div>
                          <div className="tiny faint mono">{tone.hex} - luminance {tone.luminance}</div>
                        </div>
                      </>
                    )}
                  </div>

                  {tone && (
                    <>
                      <hr className="divider" />
                      <div className="small" style={{ fontWeight: 600, marginBottom: 8 }}>What tends to flatter this tone</div>
                      {suggestFabrics(tone).map((s) => (
                        <div key={s.name} className="price-line">
                          <span style={{ fontWeight: 600, minWidth: 190 }}>{s.name}</span>
                          <span className="small muted" style={{ textAlign: 'right' }}>{s.why}</span>
                        </div>
                      ))}
                      <p className="tiny faint" style={{ marginBottom: 0, marginTop: 10 }}>
                        Worked out on this machine from the measured tone - a starting point for your own judgement, not a rule.
                      </p>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-head">
              <h3>AI body read</h3>
              <div className="spacer" />
              <button className="btn btn-sm btn-primary" onClick={runBodyAnalysis} disabled={analysing}>
                {analysing ? <><Spinner /> Reading...</> : analysis.body ? 'Read again' : 'Read the photos'}
              </button>
            </div>
            <div className="card-pad">
              {!analysis.body ? (
                <p className="small muted" style={{ margin: 0 }}>
                  Sends the captured photos to Gemini for a tailoring assessment - build, posture, shoulder slope and
                  what to do about them. Needs a connection; everything else on this screen does not.
                </p>
              ) : (
                <div className="stack">
                  <ReadRow label="Build" value={analysis.body.build} />
                  <ReadRow label="Posture" value={analysis.body.posture} />
                  {analysis.body.shoulders && <ReadRow label="Shoulders" value={analysis.body.shoulders} />}
                  {analysis.body.proportions && <ReadRow label="Proportions" value={analysis.body.proportions} />}
                  {analysis.body.fitAdvice?.length > 0 && (
                    <div>
                      <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Recommendations</div>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {analysis.body.fitAdvice.map((a, i) => <li key={i} className="small">{a}</li>)}
                      </ul>
                    </div>
                  )}
                  {analysis.body.cautions?.length > 0 && (
                    <div>
                      <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Watch out for</div>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {analysis.body.cautions.map((a, i) => <li key={i} className="small">{a}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 300 }}>
          <NotesPanel step="capture" notes={project.notes} onAdd={(b) => addNote('capture', b)} onDelete={deleteNote} />
        </div>
      </div>

      {sampling && (
        <Modal title="Sample the skin tone" onClose={() => setSampling(null)} wide>
          <ColourSampler
            src={projectMedia(project.id, sampling.filename)}
            mode="skin"
            value={tone}
            onPick={async (picked) => {
              await updateAnalysis({ skinTone: picked });
              setSampling(null);
              toast(`Skin tone locked in: ${picked.label}`, 'ok');
            }}
          />
        </Modal>
      )}

      {viewing && (
        <Modal title="Photo" onClose={() => setViewing(null)} wide>
          <img src={projectMedia(project.id, viewing.filename)} alt="" style={{ width: '100%', borderRadius: 10 }} />
          <div className="inline" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            <DownloadButton
              src={projectMedia(project.id, viewing.filename)}
              name={`${project.name} ${project.surname} ${viewing.slot || 'photo'}`}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}

function ReadRow({ label, value }) {
  return (
    <div>
      <div className="tiny faint" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>{label}</div>
      <div className="small">{value}</div>
    </div>
  );
}
