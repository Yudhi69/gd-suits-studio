import React from 'react';
import { isVisible, allFieldsOf } from '../../lib/catalog.js';
import { qualityOf } from '../../lib/pricing.js';
import Field from '../../components/Field.jsx';
import { projectMedia } from '../../lib/api.js';
import NotesPanel from '../../components/NotesPanel.jsx';

/** Renders any catalog step. All the builder screens are this one component. */
export default function BuilderStep({ ctx, step, steps = [step], overrides, onCatalogChanged, onOverridesChanged }) {
  const { project, updateSpec, addNote, deleteNote, savePhoto, deletePhoto, photoBySlot } = ctx;
  const spec = ctx.spec ?? project.spec ?? {};

  // Image fields attach files to the order rather than setting a spec value,
  // so they get the media handlers instead of onChange.
  const media = {
    // The suit's own pictures. On a wedding party the groom's tie photo is not
    // the best man's, so they are read for the suit being edited, the way the
    // single photographs already were.
    photosFor: (slot) => project.photos.filter((p) => p.slot === slot && !p.fitting_id
      && (!ctx.activeSuitId || p.suit_id === ctx.activeSuitId)),
    // A single photograph, owned the way the render reads it: the shoes on the
    // best man's page are the best man's.
    photoFor: (slot) => photoBySlot?.(slot) ?? null,
    urlFor: (filename) => projectMedia(project.id, filename),
    add: ({ slot, dataUrl, meta }) => savePhoto({ slot, dataUrl, meta }),
    remove: (id) => deletePhoto(id),
  };

  const fields = step.fields.filter((f) => isVisible(f, spec));
  const everyField = allFieldsOf(steps);
  const byId = (id) => everyField.find((f) => f.id === id && f.step !== step.key);
  const suitField = everyField.find((f) => f.id === 'suitType');
  const shared = {
    spec,
    overrides,
    onChange: updateSpec,
    onCatalogChanged,
    onOverridesChanged,
    media,
    quality: qualityOf(spec, steps),
    suitOpt: suitField?.options?.find((o) => o.key === spec.suitType) ?? null,
  };

  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div style={{ flex: 2, minWidth: 460 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>{step.title}</h3>
              {step.blurb && <div className="tiny faint">{step.blurb}</div>}
            </div>
          </div>
          <div className="card-pad">
            {fields.length === 0 && step.empty && <p className="small muted" style={{ margin: 0 }}>{step.empty}</p>}
            {fields.map((field) => (
              <React.Fragment key={field.id}>
                {field.section && <div className="price-group-title field-section">{field.section}</div>}
                <Recalled fields={(field.recall ?? []).map(byId).filter((f) => f && isVisible(f, spec))} shared={shared} />
                <Field field={field} {...shared} />
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 300 }}>
        <NotesPanel
          step={step.key}
          notes={project.notes}
          onAdd={(b) => addNote(step.key, b)}
          onDelete={deleteNote}
        />
      </div>
    </div>
  );
}

/**
 * Answers given on an earlier page, shown again where they matter - the shirt
 * colour above the shirt code. They are the same answers, not copies: a change
 * here changes the earlier page, so the order is never charged or printed
 * twice for one choice.
 */
function Recalled({ fields, shared }) {
  if (!fields.length) return null;
  return (
    <div className="recalled">
      <div className="tiny faint" style={{ marginBottom: 8 }}>Chosen earlier - change it here or there</div>
      {fields.map((f) => <Field key={f.id} field={f} {...shared} />)}
    </div>
  );
}
