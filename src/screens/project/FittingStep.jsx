import React, { useState } from 'react';
import { api, projectMedia } from '../../lib/api.js';
import { FITTING_GARMENTS, FITTING_KINDS, fittingLabel } from '../../lib/catalog.js';
import { fileToDataUrl } from '../../lib/image.js';
import { ConfirmButton, DebouncedInput, Empty, useToast } from '../../components/ui.jsx';

const ANGLES = ['front', 'side', 'back'];

/**
 * Fitting sessions. Each one records what the tailor saw, what the client
 * said, and photos of every garment from three angles - the record that
 * justifies the measurement changes made afterwards.
 */
export default function FittingStep({ ctx }) {
  const { project, reload, savePhoto, deletePhoto } = ctx;
  const toast = useToast();
  const spec = project.spec ?? {};

  const garments = FITTING_GARMENTS.filter(
    (g) => (g !== 'waistcoat' || spec.suitType === 'three_piece') && (g !== 'shirt' || spec.shirt)
  );

  // The first visit is the first fitting; anything after it defaults to the
  // final one, which is the shape almost every order actually takes.
  const nextKind = project.fittings.length === 0 ? 'first' : 'final';

  async function addSession(kind) {
    await api.fittings.add({ projectId: project.id, kind });
    // Keep the order's stage in step with the fitting being recorded, so the
    // dashboard reflects reality without anyone remembering to set it.
    await api.projects.update({
      id: project.id,
      patch: { status: kind === 'final' ? 'final_fitting' : 'first_fitting' },
    });
    await reload();
    toast(`${fittingLabel(kind)} started`, 'ok');
  }

  return (
    <div className="stack">
      <div className="inline">
        <div>
          <h2>Fittings</h2>
          <div className="small muted">
            First fitting, then final. Every session is kept, so you can see how the garment moved between them.
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {project.fittings.some((f) => f.kind === 'first') && (
          <button className="btn" onClick={() => addSession('extra')}>Additional fitting</button>
        )}
        <button className="btn btn-gold" onClick={() => addSession(nextKind)}>
          Record {fittingLabel(nextKind).toLowerCase()}
        </button>
      </div>

      {project.fittings.length === 0 ? (
        <Empty
          title="No fittings recorded yet"
          action={<button className="btn btn-primary" onClick={() => addSession('first')}>Record the first fitting</button>}
        >
          Every suit goes through a first fitting, where the corrections are marked up, and a final fitting to
          sign it off. Start a session when the client comes in to try the garment.
        </Empty>
      ) : (
        project.fittings.map((fitting) => (
          <FittingCard
            key={fitting.id}
            fitting={fitting}
            project={project}
            garments={garments}
            onReload={reload}
            onSavePhoto={savePhoto}
            onDeletePhoto={deletePhoto}
          />
        ))
      )}
    </div>
  );
}

function FittingCard({ fitting, project, garments, onReload, onSavePhoto, onDeletePhoto }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const photosFor = (garment, angle) =>
    project.photos.filter((p) => p.fitting_id === fitting.id && p.garment === garment && p.slot === angle);

  async function upload(garment, angle, file) {
    if (!file) return;
    setBusy(true);
    try {
      const { dataUrl, width, height } = await fileToDataUrl(file);
      await onSavePhoto({ slot: angle, garment, dataUrl, fittingId: fitting.id, meta: { width, height } });
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>{fittingLabel(fitting.kind)}</h3>
        <span className={`pill ${fitting.kind === 'final' ? 'pill-ok' : 'pill-warn'}`}>
          Session {fitting.session_no}
        </span>
        <span className="tiny faint">{fitting.created_at}</span>
        <div className="spacer" />
        <select
          className="select"
          style={{ maxWidth: 180 }}
          value={fitting.kind}
          onChange={async (e) => {
            await api.fittings.update({ id: fitting.id, kind: e.target.value });
            onReload();
          }}
        >
          {FITTING_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
        <ConfirmButton
          className="btn btn-sm btn-ghost btn-danger"
          confirmLabel="Delete session?"
          onConfirm={async () => { await api.fittings.delete({ id: fitting.id }); onReload(); }}
        >
          Delete
        </ConfirmButton>
      </div>

      <div className="card-pad">
        <div className="row">
          <div className="field">
            <label>Tailor's notes</label>
            <DebouncedInput
              as="textarea"
              className="textarea"
              placeholder="Sleeve 1.5cm long on the right, collar standing away at the back..."
              value={fitting.tailor_notes}
              onCommit={async (v) => {
                await api.fittings.update({ id: fitting.id, tailorNotes: v, clientNotes: fitting.client_notes });
                onReload();
              }}
            />
          </div>
          <div className="field">
            <label>What the client said</label>
            <DebouncedInput
              as="textarea"
              className="textarea"
              placeholder="Wants it a touch looser through the chest, happy with the length..."
              value={fitting.client_notes}
              onCommit={async (v) => {
                await api.fittings.update({ id: fitting.id, tailorNotes: fitting.tailor_notes, clientNotes: v });
                onReload();
              }}
            />
          </div>
        </div>

        <hr className="divider" />

        {garments.map((garment) => (
          <div key={garment} style={{ marginBottom: 18 }}>
            <div className="price-group-title" style={{ textTransform: 'capitalize' }}>{garment}</div>
            <div className="grid grid-3">
              {ANGLES.map((angle) => {
                const shots = photosFor(garment, angle);
                return (
                  <div key={angle}>
                    <label className="tiny faint" style={{ textTransform: 'capitalize', fontWeight: 700 }}>{angle}</label>
                    <div className="swatch-row" style={{ marginTop: 5 }}>
                      {shots.map((p) => (
                        <div key={p.id} style={{ position: 'relative' }}>
                          <img
                            src={projectMedia(project.id, p.filename)}
                            alt=""
                            style={{ width: 74, height: 96, objectFit: 'cover', borderRadius: 7, border: '1px solid var(--line)' }}
                          />
                          <button
                            className="ref-star"
                            style={{ width: 20, height: 20, fontSize: 11, top: 3, right: 3 }}
                            title="Remove"
                            onClick={() => onDeletePhoto(p.id)}
                          >
                            x
                          </button>
                        </div>
                      ))}
                      <label
                        className="btn btn-sm"
                        style={{ width: 74, height: 96, display: 'grid', placeItems: 'center', cursor: 'pointer' }}
                      >
                        {busy ? '...' : '+'}
                        <input
                          type="file"
                          accept="image/*"
                          hidden
                          onChange={(e) => { upload(garment, angle, e.target.files?.[0]); e.target.value = ''; }}
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <p className="tiny faint" style={{ marginBottom: 0 }}>
          Adjust the numbers on the Measurements step after the fitting - the change is written to this order and to
          the client's running body record.
        </p>
      </div>
    </div>
  );
}
