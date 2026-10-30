import React, { useState } from 'react';
import { MEASUREMENTS, measureRows, measuredGarments } from '../../lib/catalog.js';
import { UNITS, toDisplay, fromDisplay, unitShort, unitLabel, stepFor } from '../../lib/units.js';
import { api, messageFor, projectMedia, clientMedia } from '../../lib/api.js';
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

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * The figures the sanity check is asked about: this suit's only, each under
 * the name the tailor reads on screen.
 *
 * It used to send every measurement on the order, keyed by internal ids like
 * `pants.ankleLoop` - so on a wedding party the groom and the best man were
 * checked as one impossible body, and the answer came back naming fields
 * nobody could find on the page.
 */
export function measurementsForCheck(measurements, suitId, garments) {
  const lines = [];
  for (const garment of garments) {
    for (const row of measureRows(garment)) {
      const m = measurements.find((x) => x.garment === garment && x.field_id === row.id
        && x.value !== null && (suitId ? x.suit_id === suitId : true));
      if (m) lines.push(`${MEASUREMENTS[garment].label} - ${row.label}: ${m.value} cm`);
    }
  }
  return lines;
}

export default function MeasureStep({ ctx, unit = 'cm', onUnitChange, business }) {
  const { project, saveMeasurement, addNote, deleteNote } = ctx;
  const [checking, setChecking] = useState(false);
  const [advice, setAdvice] = useState(null);
  const toast = useToast();

  const spec = ctx.spec ?? project.spec ?? {};
  // The numbers belong to the suit being worked on. Without this the page
  // showed whichever measurement came first, so on a wedding party the best
  // man was measured against the groom's chest.
  const value = (garment, fieldId) =>
    project.measurements.find(
      (m) => m.garment === garment && m.field_id === fieldId
        && (ctx.activeSuitId ? m.suit_id === ctx.activeSuitId : true)
    );

  // Nothing to measure for a garment this order does not include.
  const groups = measuredGarments(spec.suitType).map((key) => [key, MEASUREMENTS[key]]);

  const [exporting, setExporting] = useState(false);

  /**
   * The measurement form, as one file.
   *
   * It is the sheet GD sends a client who is measuring themselves at home and
   * the sheet the cutter works from, so it carries the figures already taken,
   * a blank beside each one that has not been, and the photographs and design
   * references - a measurement without a picture of the man is half a form.
   */
  async function exportForm() {
    setExporting(true);
    try {
      const person = ctx.activeSuit
        ? `${ctx.activeSuit.name} ${ctx.activeSuit.surname}`.trim()
        : `${project.name} ${project.surname}`.trim();

      const table = groups.map(([key, group]) => {
        const rows = measureRows(key).map((f) => {
          const m = value(key, f.id);
          const shown = m && m.value !== null ? toDisplay(m.value, unit) : '';
          return `<tr><td>${esc(f.label)}</td><td class="num">${esc(shown)}</td><td class="u">${esc(unitShort(unit))}</td></tr>`;
        }).join('');
        return `<h3>${esc(group.label ?? key)}</h3><table>${rows}</table>`;
      }).join('');

      const pictures = (project.photos ?? [])
        .filter((p) => !p.fitting_id && ['front', 'side', 'back', 'fabric', 'lining'].includes(p.slot))
        .filter((p) => (ctx.activeSuit ? p.client_id === ctx.activeSuit.client_id || p.suit_id === ctx.activeSuit.id : true))
        .map((p) => `<figure><img src="${projectMedia(project.id, p.filename)}"><figcaption>${esc(p.slot)}</figcaption></figure>`)
        .join('');

      const refs = (ctx.references ?? [])
        .map((r) => `<figure><img src="${clientMedia(project.client_id, r.filename)}"><figcaption>${esc(r.title || 'Reference')}</figcaption></figure>`)
        .join('');

      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Measurement form - ${esc(person)}</title>
<style>
 body{font-family:'Iowan Old Style',Palatino,Georgia,serif;color:#14120f;margin:38px;max-width:860px}
 h1{font-size:26px;margin:0 0 2px} h2{font-size:15px;font-weight:400;color:#5d574c;margin:0 0 20px}
 h3{font-size:13px;text-transform:uppercase;letter-spacing:.09em;margin:22px 0 6px;color:#8a6d14}
 table{width:100%;border-collapse:collapse;font-family:system-ui;font-size:13px}
 td{border-bottom:1px solid #e7e2d8;padding:7px 4px}
 td.num{width:90px;text-align:right;border-bottom:1px solid #14120f}
 td.u{width:34px;color:#8b8578;font-size:11px}
 .meta{font-family:system-ui;font-size:13px;color:#5d574c;line-height:1.6}
 .pics{display:flex;flex-wrap:wrap;gap:12px;margin-top:8px}
 figure{margin:0;width:150px} img{width:100%;border-radius:8px;border:1px solid #e7e2d8}
 figcaption{font-family:system-ui;font-size:10.5px;color:#8b8578;text-transform:capitalize;margin-top:3px}
 .sign{font-family:system-ui;font-size:12.5px;margin-top:34px;color:#5d574c}
</style></head><body>
<h1>Measurement form</h1>
<h2>${esc(person)}${project.order_ref ? ` &middot; ${esc(project.order_ref)}` : ''}</h2>
<p class="meta">
  ${project.contact ? `${esc(project.contact)}<br>` : ''}${project.email ? `${esc(project.email)}<br>` : ''}
  ${ctx.activeSuit?.fabric_name ? `Cloth: ${esc(ctx.activeSuit.fabric_name)}${ctx.activeSuit.fabric_code ? ` (${esc(ctx.activeSuit.fabric_code)})` : ''}<br>` : ''}
  ${project.event_date ? `Needed by: ${esc(project.event_date)}` : ''}
</p>
${table}
${pictures ? `<h3>Photographs</h3><div class="pics">${pictures}</div>` : ''}
${refs ? `<h3>Design reference</h3><div class="pics">${refs}</div>` : ''}
<p class="sign">Measured by: ______________________  Date: ____________</p>
<p class="meta" style="margin-top:22px">${[business?.name, business?.businessName, business?.phone, business?.email]
  .map((x) => String(x ?? '').trim()).filter(Boolean).map(esc).join(' &middot; ')}</p>
</body></html>`;

      const res = await api.forms.save({
        projectId: project.id,
        html,
        name: `${person} measurement form`,
      });
      if (res?.saved) toast(`Saved ${res.name}`, 'ok');
    } catch (err) {
      toast(messageFor(err), 'err');
    } finally {
      setExporting(false);
    }
  }

  // Counted for the suit on screen, the way the page shows them.
  const allRows = groups.flatMap(([key]) => measureRows(key).map((r) => ({ garment: key, ...r })));
  const filled = allRows.filter((r) => value(r.garment, r.id)?.value != null).length;
  const totalFields = allRows.length;

  async function sanityCheck() {
    // Always sent in centimetres regardless of what is on screen: it is the
    // stored unit, and an unambiguous one for the model to reason in.
    const taken = measurementsForCheck(project.measurements, ctx.activeSuitId, groups.map(([key]) => key));

    if (!taken.length) {
      toast('Enter some measurements first.', 'err');
      return;
    }

    setChecking(true);
    setAdvice(null);
    try {
      const { data, switchedFrom, model } = await api.ai.analyse({
        projectId: project.id,
        schema: ADVICE_SCHEMA,
        prompt:
          'You are a master tailor checking one client\'s measurements before the cloth is cut. ' +
          'They were taken with a tape, in centimetres:\n\n' +
          taken.join('\n') +
          '\n\nFlag any value that is inconsistent with the others or outside a plausible human range, ' +
          'explain briefly why, and suggest what to re-measure. Name each flagged measurement exactly as it is ' +
          'written above. Missing measurements are not errors - they have simply not been taken yet. ' +
          'If everything is coherent, return an empty flags list. ' +
          'Be specific and practical - this goes straight onto a cutting docket.',
      });
      if (switchedFrom !== undefined) toast(`The reading model${switchedFrom ? ` ${switchedFrom}` : ''} is no longer available - switched to ${model}`, 'info');
      if (!data || !Array.isArray(data.flags)) throw new Error('The check came back in a shape the app could not read. Try it again.');
      setAdvice(data);
      toast(data.flags.length ? `${data.flags.length} thing(s) worth re-checking` : 'Measurements look coherent', data.flags.length ? 'info' : 'ok');
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
              <div className="tiny faint">{filled} of {totalFields} taken - shown in {unitLabel(unit)}</div>
            </div>
            <div className="spacer" />
            <button className="btn btn-sm" onClick={exportForm} disabled={exporting} style={{ marginRight: 8 }}>
              {exporting ? 'Saving...' : 'Measurement form'}
            </button>
            <div className="unit-switch" role="group" aria-label="Measurement units">
              {UNITS.map((u) => (
                <button
                  key={u.key}
                  className={unit === u.key ? 'active' : ''}
                  aria-pressed={unit === u.key}
                  onClick={() => onUnitChange?.(u.key)}
                >
                  {u.label}
                </button>
              ))}
            </div>
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
                  // A pair - the two biceps - is one row with two boxes side
                  // by side, each saved under its own id.
                  const ids = field.pair ? [field.id, field.pair.id] : [field.id];
                  return (
                    <div className={`measure-row ${field.pair ? 'measure-row-pair' : ''}`} key={field.id}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{field.label}</div>
                        <div className="tiny faint">{field.hint}</div>
                      </div>
                      <div className="measure-pair">
                        {ids.map((id, i) => {
                          const row = value(key, id);
                          return (
                            <div className="measure-entry" key={id}>
                              {field.pair && <span className="measure-side">{field.pair.sides[i]}</span>}
                              <DebouncedInput
                                type="number"
                                step={stepFor(unit)}
                                aria-label={field.pair ? `${field.label} ${field.pair.sides[i]}` : field.label}
                                className={`input measure-input ${row?.source === 'carried-over' ? 'carried' : ''}`}
                                placeholder="-"
                                value={toDisplay(row?.value, unit)}
                                onCommit={(v) => saveMeasurement(key, id, fromDisplay(v, unit))}
                              />
                              <span className="measure-unit">{unitShort(unit)}</span>
                            </div>
                          );
                        })}
                      </div>
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
