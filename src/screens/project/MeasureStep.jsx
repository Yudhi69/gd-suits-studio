import React, { useState } from 'react';
import { MEASUREMENTS } from '../../lib/catalog.js';
import { api, messageFor } from '../../lib/api.js';
import { DebouncedInput, Spinner, useToast, Banner } from '../../components/ui.jsx';
import NotesPanel from '../../components/NotesPanel.jsx';

const ADVICE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    flags: {
      type: 'ARRAY',
      description: 'Measurements that look inconsistent with the others, with the reason',
      items: {
        type: 'OBJECT',
        properties: {
          field: { type: 'STRING' },
          issue: { type: 'STRING' },
          suggestion: { type: 'STRING' },
        },
        required: ['field', 'issue'],
      },
    },
    notes: { type: 'ARRAY', items: { type: 'STRING' }, description: 'General observations for the cutter' },
  },
  required: ['flags'],
};

export default function MeasureStep({ ctx }) {
  const { project, saveMeasurement, addNote, deleteNote } = ctx;
  const [checking, setChecking] = useState(false);
  const [advice, setAdvice] = useState(null);
  const toast = useToast();

  const spec = project.spec ?? {};
  const value = (garment, fieldId) =>
    project.measurements.find((m) => m.garment === garment && m.field_id === fieldId);

  // A 2-piece has no waistcoat to measure.
  const groups = Object.entries(MEASUREMENTS).filter(
    ([key]) => key !== 'waistcoat' || spec.suitType === 'three_piece'
  );

  const filled = project.measurements.filter((m) => m.value !== null).length;
  const totalFields = groups.reduce((sum, [, g]) => sum + g.fields.length, 0);

  async function sanityCheck() {
    const taken = project.measurements
      .filter((m) => m.value !== null)
      .map((m) => `${m.garment}.${m.field_id} = ${m.value}cm`)
      .join('\n');

    if (!taken) {
      toast('Enter some measurements first.', 'err');
      return;
    }

    setChecking(true);
    try {
      const { data } = await api.ai.analyse({
        projectId: project.id,
        schema: ADVICE_SCHEMA,
        prompt:
          'You are a master tailor checking a set of measurements before cutting. Here they are, in centimetres:\n\n' +
          taken +
          '\n\nFlag any value that is inconsistent with the others or outside a plausible human range, ' +
          'explain briefly why, and suggest what to re-measure. If everything is coherent, return an empty flags list. ' +
          'Be specific and practical - this goes straight onto a cutting docket.',
      });
      setAdvice(data);
      toast(data.flags?.length ? `${data.flags.length} thing(s) worth re-checking` : 'Measurements look coherent', data.flags?.length ? 'info' : 'ok');
    } catch (err) {
      toast(messageFor(err), 'err');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div style={{ flex: 2, minWidth: 460 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Measurements</h3>
              <div className="tiny faint">{filled} of {totalFields} taken - all in centimetres</div>
            </div>
            <div className="spacer" />
            <button className="btn btn-sm btn-primary" onClick={sanityCheck} disabled={checking}>
              {checking ? <><Spinner /> Checking...</> : 'AI sanity check'}
            </button>
          </div>
          <div className="card-pad">
            {project.measurements.some((m) => m.source === 'carried-over') && (
              <Banner kind="info">
                Values highlighted in gold were carried over from this client's previous order. Confirm or correct each one.
              </Banner>
            )}

            {groups.map(([key, group]) => (
              <div key={key} style={{ marginTop: 18 }}>
                <div className="price-group-title">{group.label}</div>
                {group.fields.map((field) => {
                  const row = value(key, field.id);
                  return (
                    <div className="measure-row" key={field.id}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{field.label}</div>
                        <div className="tiny faint">{field.hint}</div>
                      </div>
                      <DebouncedInput
                        type="number"
                        step="0.5"
                        className={`input measure-input ${row?.source === 'carried-over' ? 'carried' : ''}`}
                        placeholder="-"
                        value={row?.value ?? ''}
                        onCommit={(v) => saveMeasurement(key, field.id, v === '' ? null : Number(v))}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {advice && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-head"><h3>Sanity check</h3></div>
            <div className="card-pad">
              {advice.flags?.length ? (
                advice.flags.map((f, i) => (
                  <div key={i} className="banner banner-warn" style={{ marginBottom: 8 }}>
                    <div>
                      <strong>{f.field}</strong> - {f.issue}
                      {f.suggestion && <div className="small" style={{ marginTop: 3 }}>{f.suggestion}</div>}
                    </div>
                  </div>
                ))
              ) : (
                <Banner kind="info">Nothing looks out of place.</Banner>
              )}
              {advice.notes?.map((n, i) => <p key={i} className="small muted">{n}</p>)}
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 300 }}>
        <NotesPanel step="measurements" notes={project.notes} onAdd={(b) => addNote('measurements', b)} onDelete={deleteNote} />
      </div>
    </div>
  );
}
