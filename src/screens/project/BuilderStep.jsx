import React from 'react';
import { isVisible } from '../../lib/catalog.js';
import Field from '../../components/Field.jsx';
import NotesPanel from '../../components/NotesPanel.jsx';

/** Renders any catalog step. All the builder screens are this one component. */
export default function BuilderStep({ ctx, step, overrides }) {
  const { project, updateSpec, addNote, deleteNote } = ctx;
  const spec = project.spec ?? {};

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
