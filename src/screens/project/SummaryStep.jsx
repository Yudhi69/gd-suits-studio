import React, { useState } from 'react';
import { api, projectMedia, messageFor } from '../../lib/api.js';
import { buildSpecSheet } from '../../lib/promptBuilder.js';
import { buildBreakdown, formatMoney } from '../../lib/pricing.js';
import { EVENT_TYPES, MEASUREMENTS } from '../../lib/catalog.js';
import { useToast, Spinner } from '../../components/ui.jsx';

/**
 * The client-facing summary: the full breakdown the brief asks the tailor to
 * be able to send over for approval, plus the export that writes the whole
 * client file out to a folder.
 */
export default function SummaryStep({ ctx, overrides }) {
  const { project } = ctx;
  const [exporting, setExporting] = useState(false);
  const toast = useToast();

  const spec = project.spec ?? {};
  const analysis = project.analysis ?? {};
  const sections = buildSpecSheet(spec);
  const { lines, total } = buildBreakdown(spec, overrides);
  const approved = project.renders.filter((r) => r.approved);

  async function exportFile() {
    setExporting(true);
    try {
      const result = await api.project.export({ projectId: project.id, html: specSheetHtml() });
      if (result.exported) toast('Client file exported', 'ok');
    } catch (err) {
      toast(messageFor(err), 'err');
    } finally {
      setExporting(false);
    }
  }

  /** Self-contained HTML the tailor can email or print for sign-off. */
  function specSheetHtml() {
    const rows = sections
      .map(
        (s) => `<h3>${s.title}</h3><table>${s.rows
          .map((r) => `<tr><td class="k">${r.label}</td><td>${r.value}</td></tr>`)
          .join('')}</table>`
      )
      .join('');

    const priceRows = lines
      .map((l) => `<tr><td class="k">${l.label}</td><td class="num">${formatMoney(l.amount)}</td></tr>`)
      .join('');

    const measureRows = Object.entries(MEASUREMENTS)
      .map(([key, group]) => {
        const taken = group.fields
          .map((f) => {
            const m = project.measurements.find((x) => x.garment === key && x.field_id === f.id && x.value !== null);
            return m ? `<tr><td class="k">${f.label}</td><td class="num">${m.value} cm</td></tr>` : '';
          })
          .join('');
        return taken ? `<h3>${group.label} measurements</h3><table>${taken}</table>` : '';
      })
      .join('');

    const images = approved
      .map((r) => `<img src="images/${r.filename}" alt="Approved render" />`)
      .join('');

    return `<!doctype html><html><head><meta charset="utf-8"><title>${project.name} ${project.surname} - ${project.title}</title>
<style>
 body{font-family:Georgia,serif;max-width:820px;margin:40px auto;padding:0 24px;color:#14120f}
 h1{font-size:28px;margin:0 0 4px}
 .letterhead{width:260px;max-width:60%;display:block;margin:0 0 26px}
 h3{font-size:15px;margin:26px 0 6px;border-bottom:2px solid #c9a227;padding-bottom:4px;display:inline-block}
 table{width:100%;border-collapse:collapse;font-family:system-ui;font-size:13.5px}
 td{padding:6px 0;border-bottom:1px solid #eeebe4} .k{color:#5d574c;width:55%} .num{text-align:right;font-variant-numeric:tabular-nums}
 .total{font-size:20px;font-weight:700;border-top:2px solid #14120f;padding-top:10px;margin-top:10px;display:flex;justify-content:space-between;font-family:system-ui}
 img{max-width:100%;border-radius:6px;margin:10px 0}
 .meta{font-family:system-ui;font-size:13px;color:#5d574c;margin-bottom:22px}
</style></head><body>
<img class="letterhead" src="images/gd-suits-logo.png" alt="GD Suits" onerror="this.style.display='none'">
<h1>${project.name} ${project.surname}</h1>
<div class="meta">
 <strong>${project.title}</strong><br>
 ${EVENT_TYPES.find((e) => e.key === project.event_type)?.label ?? ''} ${project.event_date ? `&middot; ${project.event_date}` : ''}<br>
 ${project.delivery_date ? `Delivery: ${project.delivery_date}` : ''}
</div>
${images ? `<h3>Approved design</h3>${images}` : ''}
${rows}
${measureRows}
<h3>Price breakdown</h3><table>${priceRows}</table>
<div class="total"><span>Total</span><span>${formatMoney(total)}</span></div>
</body></html>`;
  }

  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div style={{ flex: 2, minWidth: 440 }}>
        <div className="card">
          <div className="card-head">
            <h3>Specification</h3>
            <div className="spacer" />
            <button className="btn btn-sm btn-primary" onClick={exportFile} disabled={exporting}>
              {exporting ? <><Spinner /> Exporting...</> : 'Export client file'}
            </button>
          </div>
          <div className="card-pad">
            {sections.length === 0 ? (
              <p className="muted">Nothing specified yet.</p>
            ) : (
              sections.map((s) => (
                <div key={s.title}>
                  <div className="price-group-title">{s.title}</div>
                  {s.rows.map((r) => (
                    <div className="price-line" key={r.label}>
                      <span className="muted">{r.label}</span>
                      <span style={{ fontWeight: 600 }}>{r.value}</span>
                    </div>
                  ))}
                </div>
              ))
            )}

            {analysis.skinTone && (
              <>
                <div className="price-group-title">Client</div>
                <div className="price-line">
                  <span className="muted">Measured skin tone</span>
                  <span className="inline" style={{ gap: 7 }}>
                    <span className="swatch" style={{ width: 18, height: 18, background: analysis.skinTone.hex }} />
                    <span style={{ fontWeight: 600 }}>{analysis.skinTone.label}</span>
                  </span>
                </div>
              </>
            )}
            {analysis.fabricColour && (
              <div className="price-line">
                <span className="muted">Cloth colour</span>
                <span className="inline" style={{ gap: 7 }}>
                  <span className="swatch" style={{ width: 18, height: 18, background: analysis.fabricColour.hex }} />
                  <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{analysis.fabricColour.label}</span>
                </span>
              </div>
            )}
          </div>
        </div>

        {approved.length > 0 && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-head"><h3>Approved renders</h3></div>
            <div className="card-pad">
              <div className="grid grid-3">
                {approved.map((r) => (
                  <img
                    key={r.id}
                    src={projectMedia(project.id, r.filename)}
                    alt=""
                    style={{ width: '100%', borderRadius: 9, border: '1px solid var(--line)' }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 300 }}>
        <div className="card">
          <div className="card-head"><h3>Quote</h3></div>
          <div className="card-pad">
            {lines.map((l, i) => (
              <div className="price-line" key={`${l.key}-${i}`}>
                <span className="small">{l.label}</span>
                <span className="mono small">{formatMoney(l.amount)}</span>
              </div>
            ))}
            <hr className="divider" />
            <div className="price-line" style={{ fontSize: 19, fontWeight: 700 }}>
              <span>Total</span>
              <span>{formatMoney(total)}</span>
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head"><h3>All notes</h3></div>
          <div className="card-pad" style={{ maxHeight: 420, overflowY: 'auto' }}>
            {project.notes.length === 0 ? (
              <p className="small faint" style={{ margin: 0 }}>No notes recorded.</p>
            ) : (
              project.notes.map((n) => (
                <div key={n.id} className="note">
                  <div className="note-head">
                    <span className="pill pill-quiet">{n.step}</span>
                    <span className="tiny faint">{n.created_at}</span>
                  </div>
                  <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
