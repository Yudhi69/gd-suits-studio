import React from 'react';
import CaptureStep from './CaptureStep.jsx';
import FabricStep from './FabricStep.jsx';
import NotesPanel from '../../components/NotesPanel.jsx';

/**
 * The photographs and the cloth, on one page.
 *
 * They were two steps, one after the other, and GD asked for them together:
 * both are the camera coming out, usually in the same few minutes, and both
 * exist to feed the render. One set of notes covers the page, and the notes
 * already written against the cloth page show here too.
 */
export default function PhotosStep({ ctx }) {
  const { project, addNote, deleteNote } = ctx;
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div className="stack" style={{ flex: 2, minWidth: 460 }}>
        <CaptureStep ctx={ctx} bare />
        <FabricStep ctx={ctx} bare />
      </div>
      <div style={{ flex: 1, minWidth: 300 }}>
        <NotesPanel
          step="capture"
          alsoShow={['fabric']}
          notes={project.notes}
          onAdd={(b) => addNote('capture', b)}
          onDelete={deleteNote}
        />
      </div>
    </div>
  );
}
