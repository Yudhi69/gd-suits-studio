import React, { useState } from 'react';
import { api, projectMedia, messageFor } from '../../lib/api.js';
import { buildSpecSheet } from '../../lib/promptBuilder.js';
import { buildBreakdown, formatMoney } from '../../lib/pricing.js';
import { quoteFromSpec, quoteDrift, isDraft } from '../../lib/quote.js';
import { ConfirmButton } from '../../components/ui.jsx';
import { EVENT_TYPES, MEASUREMENTS, statusLabel } from '../../lib/catalog.js';
import { formatMeasure, unitLabel } from '../../lib/units.js';
import { ORDER_TERMS, GD_CONTACT } from '../../lib/terms.js';
import { useToast, Spinner, Banner } from '../../components/ui.jsx';

/**
 * The spec sheet is assembled as raw HTML and then written to disk, so every
 * value that goes into it has to be escaped. A client name, a fitting note or
 * an order title is free text typed by a person - without this, a name
 * containing markup would execute when the exported file is opened in a
 * browser.
 */
const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * The client-facing summary: the full breakdown the brief asks the tailor to
 * be able to send over for approval, plus the export that writes the whole
 * client file out to a folder.
 */
export default function SummaryStep({ ctx, overrides, steps, unit = 'cm' }) {
  const { project } = ctx;
  const [exporting, setExporting] = useState(false);
  const toast = useToast();

  const spec = project.spec ?? {};
  const analysis = project.analysis ?? {};
  const sections = buildSpecSheet(spec, steps);
  const live = buildBreakdown(spec, overrides, steps);
  // Once the order has left draft the agreed figure is the quote; the live one
  // is only there to show whether the price list has moved since.
  const { lines, total } = project.quote ?? live;
  const drift = quoteDrift(project.quote, spec, overrides, steps);
  const approved = project.renders.filter((r) => r.approved);

  async function requote() {
    await api.projects.setQuote({
      id: project.id,
      quote: quoteFromSpec(spec, overrides, steps, project.status),
    });
    await ctx.reload();
    toast('Re-quoted at today\'s prices', 'ok');
  }

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
    const schedule = [
      ['consultation_date', 'First consultation'],
      ['measurement_date', 'Measurements'],
      ['first_fitting_date', 'First fitting'],
      ['final_fitting_date', 'Final fitting & delivery'],
    ].filter(([key]) => project[key]);
    const paid = (project.payments ?? []).reduce((t, p) => t + (p.kind === 'refund' ? -p.amount : p.amount), 0);
    const orderDetail = [
      ['Number of suits', project.quantity ?? 1],
      ['Fabric', project.fabric_name],
      ['Code / colour', project.fabric_code],
      ['Paid to date', paid ? formatMoney(paid) : ''],
      ['Balance due', total ? formatMoney(Math.max(0, total - paid)) : ''],
    ].filter(([, value]) => value !== '' && value !== undefined && value !== null);
    const orderRows = orderDetail.length
      ? `<h3>Order</h3><table>${orderDetail
          .map(([label, value]) => `<tr><td class="k">${esc(label)}</td><td class="num">${esc(value)}</td></tr>`)
          .join('')}</table>`
      : '';

    const scheduleRows = schedule.length
      ? `<h3>Schedule</h3><table>${schedule
          .map(([key, label]) => `<tr><td class="k">${esc(label)}</td><td class="num">${esc(project[key])}</td></tr>`)
          .join('')}</table>`
      : '';

    const rows = sections
      .map(
        (s) => `<h3>${esc(s.title)}</h3><table>${s.rows
          .map((r) => `<tr><td class="k">${esc(r.label)}</td><td>${esc(r.value)}</td></tr>`)
          .join('')}</table>`
      )
      .join('');

    const priceRows = lines
      .map((l) => `<tr><td class="k">${esc(l.label)}</td><td class="num">${esc(formatMoney(l.amount))}</td></tr>`)
      .join('');

    const measureRows = Object.entries(MEASUREMENTS)
      .map(([key, group]) => {
        const taken = group.fields
          .map((f) => {
            const m = project.measurements.find((x) => x.garment === key && x.field_id === f.id && x.value !== null);
            return m ? `<tr><td class="k">${esc(f.label)}</td><td class="num">${esc(formatMeasure(m.value, unit))}</td></tr>` : '';
          })
          .join('');
        return taken ? `<h3>${esc(group.label)} measurements (${esc(unitLabel(unit))})</h3><table>${taken}</table>` : '';
      })
      .join('');

    const images = approved
      .map((r) => `<img src="images/${encodeURIComponent(r.filename)}" alt="Approved render" />`)
      .join('');

    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(project.name)} ${esc(project.surname)} - ${esc(project.title)}</title>
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
 .terms{font-family:system-ui;font-size:12.5px;color:#14120f;line-height:1.55;padding-left:18px}
 .terms li{margin-bottom:6px}
 .sign{font-family:system-ui;font-size:13px;margin-top:34px;color:#14120f}
</style></head><body>
<img class="letterhead" src="images/gd-suits-logo.png" alt="GD Suits" onerror="this.style.display='none'">
<h1>Order Form</h1>
<p class="meta" style="margin-bottom:14px"><strong>${esc(project.name)} ${esc(project.surname)}</strong></p>
<div class="meta">
 <strong>${esc(project.title)}</strong><br>
 ${esc(EVENT_TYPES.find((e) => e.key === project.event_type)?.label ?? '')} ${project.event_date ? `&middot; ${esc(project.event_date)}` : ''}<br>
 ${project.delivery_date ? `Delivery: ${esc(project.delivery_date)}` : ''}
 ${project.is_minor && project.secondary_name
   ? `<br>Approvals to ${esc(project.secondary_name)}${project.secondary_relationship ? ` (${esc(project.secondary_relationship)})` : ''}${project.secondary_contact ? ` &middot; ${esc(project.secondary_contact)}` : ''}`
   : ''}
</div>
${scheduleRows}
${images ? `<h3>Approved design</h3>${images}` : ''}
${rows}
${measureRows}
${orderRows}
<h3>Price breakdown</h3><table>${priceRows}</table>
<div class="total"><span>Total</span><span>${esc(formatMoney(total))}</span></div>
${project.quote ? `<p style="font-family:system-ui;font-size:12px;color:#5d574c">Quoted ${esc(String(project.quote.at ?? '').slice(0, 10))}. This price is held for this order.</p>` : ''}

<h3>Terms and conditions</h3>
<ol class="terms">${ORDER_TERMS.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>

<h3>Contact us if you have any further queries</h3>
<p class="meta">
  ${esc(GD_CONTACT.name)}<br>${esc(GD_CONTACT.role)}<br>
  ${esc(GD_CONTACT.phone)}<br>${esc(GD_CONTACT.email)}
</p>

<p class="sign">Client signature: ______________________________&nbsp;&nbsp;&nbsp;Date: ______________</p>
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
          <div className="card-head">
            <h3>Quote</h3>
            <div className="spacer" />
            {project.quote
              ? <span className="pill pill-ok">Agreed {String(project.quote.at ?? '').slice(0, 10)}</span>
              : <span className="pill pill-quiet">Draft - still moving</span>}
          </div>
          <div className="card-pad">
            {drift && (
              <Banner kind="warn">
                <div>
                  The price list has changed since this was agreed - today it would be{' '}
                  <strong>{formatMoney(drift.live.total)}</strong> ({drift.label}). The client was quoted{' '}
                  <strong>{formatMoney(total)}</strong>, and that is what stands.
                  <div style={{ marginTop: 8 }}>
                    <ConfirmButton
                      className="btn btn-sm"
                      confirmLabel="Replace the agreed quote?"
                      onConfirm={requote}
                    >
                      Re-quote at today's prices
                    </ConfirmButton>
                  </div>
                </div>
              </Banner>
            )}
            {isDraft(project.status) && (
              <p className="tiny faint" style={{ marginTop: 0 }}>
                This total follows the price list until the order is approved, then it is fixed.
              </p>
            )}
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
