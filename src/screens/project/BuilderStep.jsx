import React from 'react';
import { isVisible } from '../../lib/catalog.js';
import Field from '../../components/Field.jsx';
import { projectMedia } from '../../lib/api.js';
import NotesPanel from '../../components/NotesPanel.jsx';

/** Renders any catalog step. All the builder screens are this one component. */
export default function BuilderStep({ ctx, step, overrides, onCatalogChanged }) {
  const { project, updateSpec, addNote, deleteNote, savePhoto, deletePhoto } = ctx;
  const spec = ctx.spec ?? project.spec ?? {};

  // Image fields attach files to the order rather than setting a spec value,
  // so they get the media handlers instead of onChange.
  const media = {
    photosFor: (slot) => project.photos.filter((p) => p.slot === slot && !p.fitting_id),
    urlFor: (filename) => projectMedia(project.id, filename),
    add: ({ slot, dataUrl, meta }) => savePhoto({ slot, dataUrl, meta }),
    remove: (id) => deletePhoto(id),
  };

  const fields = step.fields.filter((f) => isVisible(f, spec));

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
            {fields.map((field) => (
              <Field
                key={field.id}
                field={field}
                spec={spec}
                overrides={overrides}
                onChange={updateSpec}
                onCatalogChanged={onCatalogChanged}
                media={media}
              />
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
