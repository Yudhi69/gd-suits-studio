import React, { useState } from 'react';
import { projectMedia } from '../../lib/api.js';
import { PHOTO_SLOTS } from '../../lib/catalog.js';
import { nameColour } from '../../lib/colour.js';
import PhotoSlot from '../../components/PhotoSlot.jsx';
import ColourSampler from '../../components/ColourSampler.jsx';
import NotesPanel from '../../components/NotesPanel.jsx';
import { Banner, Modal, useToast } from '../../components/ui.jsx';

const SWATCH_SLOTS = PHOTO_SLOTS.filter((s) => s.role === 'swatch');

/**
 * The cloth and the lining. Photographing the actual bolt is what makes the
 * render match what will be cut - the swatch photo is sent to the model as a
 * reference, and the sampled colour is named in the prompt as a cross-check.
 */
export default function FabricStep({ ctx }) {
  const { project, savePhoto, deletePhoto, addNote, deleteNote, updateAnalysis, photoBySlot } = ctx;
  const [sampling, setSampling] = useState(null);
  const toast = useToast();

  const analysis = project.analysis ?? {};

  return (
    <div className="stack">
      <Banner kind="info">
        Shoot the cloth flat, filling the frame, in daylight if you can. This photo is what the AI matches the
        suit colour and weave to.
      </Banner>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 2, minWidth: 420 }}>
          <div className="card">
            <div className="card-head"><h3>Cloth &amp; lining</h3></div>
            <div className="card-pad">
              <div className="photo-grid">
                {SWATCH_SLOTS.map((slot) => {
                  const photo = photoBySlot(slot.key);
                  return (
                    <PhotoSlot
                      key={slot.key}
                      slot={slot}
                      photo={photo ? { ...photo, url: projectMedia(project.id, photo.filename) } : null}
                      onSave={({ dataUrl, meta }) => savePhoto({ slot: slot.key, dataUrl, meta })}
                      onClear={(p) => deletePhoto(p.id)}
                      onOpen={() => setSampling({ photo, slot })}
                    />
                  );
                })}
              </div>

              <hr className="divider" />

              <div className="grid grid-2">
                {SWATCH_SLOTS.map((slot) => {
                  const key = slot.key === 'fabric' ? 'fabricColour' : 'liningColour';
                  const picked = analysis[key];
                  const photo = photoBySlot(slot.key);
                  return (
                    <div key={slot.key}>
                      <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>{slot.label} colour</div>
                      <div className="inline">
                        <div className="swatch swatch-lg" style={{ background: picked?.hex ?? '#00000010' }} />
                        <div style={{ flex: 1 }}>
                          {picked ? (
                            <>
                              <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>{picked.label}</div>
                              <div className="tiny faint mono">{picked.hex}</div>
                            </>
                          ) : (
                            <div className="tiny faint">Not sampled yet</div>
                          )}
                          <button
                            className="btn btn-sm"
                            style={{ marginTop: 6 }}
                            disabled={!photo}
                            onClick={() => setSampling({ photo, slot })}
                          >
                            {picked ? 'Re-sample' : 'Sample colour'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 300 }}>
          <NotesPanel step="fabric" notes={project.notes} onAdd={(b) => addNote('fabric', b)} onDelete={deleteNote} />
        </div>
      </div>

      {sampling?.photo && (
        <Modal title={`Sample the ${sampling.slot.label.toLowerCase()}`} onClose={() => setSampling(null)} wide>
          <ColourSampler
            src={projectMedia(project.id, sampling.photo.filename)}
            mode="swatch"
            value={analysis[sampling.slot.key === 'fabric' ? 'fabricColour' : 'liningColour']}
            onPick={async (picked) => {
              const key = sampling.slot.key === 'fabric' ? 'fabricColour' : 'liningColour';
              await updateAnalysis({ [key]: { ...picked, label: nameColour(picked.hex) } });
              setSampling(null);
              toast(`${sampling.slot.label} colour recorded`, 'ok');
            }}
          />
        </Modal>
      )}
    </div>
  );
}
