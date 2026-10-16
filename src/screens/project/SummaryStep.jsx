import React, { useState } from 'react';
import { api, projectMedia, messageFor } from '../../lib/api.js';
import { buildSpecSheet } from '../../lib/promptBuilder.js';
import { formatMoney } from '../../lib/pricing.js';
import { orderBreakdown, quoteFromOrder, quoteDrift, isDraft, suitsOf, suitName } from '../../lib/quote.js';
import { prettyDate } from '../../lib/informalQuote.js';
import { ConfirmButton } from '../../components/ui.jsx';
import {
  eventTypesWith, MEASUREMENTS, measureRows, measuredGarments, statusLabel, PROCESS_DATES, STEPS,
} from '../../lib/catalog.js';
import { formatMeasure, unitLabel } from '../../lib/units.js';
import { ORDER_TERMS, GD_CONTACT } from '../../lib/terms.js';
import { useToast, Spinner, Banner, Modal } from '../../components/ui.jsx';

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

/** Notes are filed under the page they were written on; this is that page's name. */
const PAGE_NAMES = {
  client: 'Client', order: 'Order', capture: 'Photos & Cloth', fabric: 'Photos & Cloth',
  measurements: 'Measurements', preview: 'Preview', fitting: 'Fitting', summary: 'Summary',
  details: 'Detail Customisation',
  ...Object.fromEntries(STEPS.map((s) => [s.key, s.title])),
};

/**
 * The client-facing summary: the whole order as it will be made and charged -
 * every suit on it, with its own cloth, design and measurements - plus the
 * formal quote and the export that writes the client file out to a folder.
 */
export default function SummaryStep({ ctx, overrides, steps, unit = 'cm', business, customOptions = [] }) {
  const { project } = ctx;
  const [exporting, setExporting] = useState(false);
  const [mailing, setMailing] = useState(false);
  const [confirmSend, setConfirmSend] = useState(null);
  const [confirmFix, setConfirmFix] = useState(false);
  const toast = useToast();

  const megabytes = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

  const suits = suitsOf(project);
  const multi = suits.length > 1;
  const analysis = project.analysis ?? {};
  const live = orderBreakdown(project, overrides, steps);
  // Once the order has left draft the agreed figure is the quote; the live one
  // is only there to show whether the price list has moved since.
  const { lines, total } = project.quote ?? live;
  const drift = quoteDrift(project.quote, project, overrides, steps);
  const approved = project.renders.filter((r) => r.approved);
  const event = eventTypesWith(customOptions).find((e) => e.key === project.event_type);
  const eventLabel = project.event_type === 'other' && project.event_other ? project.event_other : event?.label ?? '';
  const paid = (project.payments ?? []).reduce((t, p) => t + (p.kind === 'refund' ? -p.amount : p.amount), 0);

  /** Each suit: who it is for, what it is cut from, how it is made, what it measures. */
  const perSuit = suits.map((suit, i) => {
    const spec = suit.spec ?? {};
    const measures = measuredGarments(spec.suitType).map((garment) => ({
      garment,
      label: MEASUREMENTS[garment].label,
      rows: measureRows(garment)
        .map((r) => ({
          ...r,
          value: project.measurements.find((m) => m.garment === garment && m.field_id === r.id && m.value !== null
            && (suit.id ? m.suit_id === suit.id : true))?.value ?? null,
        }))
        .filter((r) => r.value !== null),
    })).filter((g) => g.rows.length);
    return {
      id: suit.id ?? i,
      title: suitName(suit, i, suits),
      cloth: [suit.fabric_name, suit.fabric_code, suit.supplier].filter(Boolean),
      sections: buildSpecSheet(spec, steps),
      measures,
    };
  });

  /**
   * Emails the formal quote, with the renders if the wording asks for them.
   *
   * The formal quote is the one with a fixed price, so an order still in
   * draft is fixed first - with GD saying so. Before this, sending from a
   * draft went out with no prices in it at all, because the email reads the
   * agreed figures and a draft has none.
   *
   * Through Gmail the app sends it itself, so it is shown first - to whom,
   * what it says, what is attached - and sent only when GD says so. As a
   * draft it opens in his own mail program, which is its own review.
   */
  function emailQuote() {
    if (!project.quote) setConfirmFix(true);
    else previewAndSend();
  }

  async function fixAndEmail() {
    setConfirmFix(false);
    try {
      await api.projects.setQuote({ id: project.id, quote: quoteFromOrder(project, overrides, steps, 'quoted') });
      if (isDraft(project.status)) await api.projects.update({ id: project.id, patch: { status: 'quoted' } });
      await ctx.reload();
      toast(`Price fixed at ${formatMoney(live.total)}`, 'ok');
    } catch (err) {
      toast(messageFor(err), 'err');
      return;
    }
    await previewAndSend();
  }

  // The send itself, once a fixed quote is on the order.
  async function previewAndSend() {
    setMailing(true);
    try {
      const preview = await api.quote.preview({ projectId: project.id });
      if (preview.via === 'gmail') { setConfirmSend(preview); return; }
      await sendQuote();
    } catch (err) {
      toast(messageFor(err), 'err');
    } finally {
      setMailing(false);
    }
  }

  async function sendQuote() {
    const r = await api.quote.email({ projectId: project.id });
    const withRenders = r.attached ? ` with ${r.attached} render${r.attached === 1 ? '' : 's'}` : '';
    if (r.sent) toast(`Sent to ${r.to}${withRenders}`, 'ok');
    else if (r.via === 'draft-file') toast(`Draft opened${withRenders} - check it, then send`, 'ok');
    else toast(`Draft opened for ${r.to}`, 'ok');
  }

  async function requote() {
    await api.projects.setQuote({
      id: project.id,
      quote: quoteFromOrder(project, overrides, steps, project.status),
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
    // From the one list the schedule page uses, so a date added there cannot
    // quietly go missing from the form the client signs.
    const schedule = PROCESS_DATES.filter(({ key }) => project[key]);
    const table = (rows) => `<table>${rows
      .map(([label, value, num]) => `<tr><td class="k">${esc(label)}</td><td${num ? ' class="num"' : ''}>${esc(value)}</td></tr>`)
      .join('')}</table>`;

    const orderRows = [
      ['Order number', project.order_ref],
      ['Number of suits', suits.length],
      ...(!multi ? [['Fabric', suits[0]?.fabric_name], ['Material code', suits[0]?.fabric_code]] : []),
      ['Paid to date', paid ? formatMoney(paid) : ''],
      ['Balance due', total ? formatMoney(Math.max(0, total - paid)) : ''],
    ].filter(([, value]) => value !== '' && value !== undefined && value !== null);

    const scheduleRows = schedule.length
      ? `<h3>Schedule</h3>${table(schedule.map(({ key, label }) => [label, prettyDate(project[key]), true]))}`
      : '';

    const suitBlocks = perSuit.map((s) => {
      const head = multi ? `<h2>${esc(s.title)}</h2>` : '';
      const cloth = multi && s.cloth.length ? `<p class="meta">Cloth: ${esc(s.cloth.join(' · '))}</p>` : '';
      const spec = s.sections.map((sec) => `<h3>${esc(sec.title)}</h3>${table(sec.rows.map((r) => [r.label, r.value]))}`).join('');
      const measures = s.measures
        .map((g) => `<h3>${esc(g.label)} measurements (${esc(unitLabel(unit))})</h3>${table(g.rows.map((r) => [r.label, formatMeasure(r.value, unit), true]))}`)
        .join('');
      return `${head}${cloth}${spec}${measures}`;
    }).join('');

    const priceRows = lines
      .map((l) => [multi && l.group ? `${l.group} - ${l.label}` : l.label, formatMoney(l.amount), true]);

    const images = approved
      .map((r) => `<img src="images/${encodeURIComponent(r.filename)}" alt="Approved render" />`)
      .join('');

    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(project.name)} ${esc(project.surname)} - ${esc(project.order_ref || project.title)}</title>
<style>
 body{font-family:Georgia,serif;max-width:820px;margin:40px auto;padding:0 24px;color:#14120f}
 h1{font-size:28px;margin:0 0 4px}
 h2{font-size:19px;margin:34px 0 4px;padding-top:14px;border-top:1px solid #d9d3c5}
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
<p class="meta" style="margin-bottom:14px"><strong>${esc(project.name)} ${esc(project.surname)}</strong>${project.order_ref ? ` &middot; ${esc(project.order_ref)}` : ''}</p>
<div class="meta">
 ${esc(eventLabel)}${project.event_date ? ` &middot; ${esc(prettyDate(project.event_date))}` : ''}<br>
 ${project.delivery_date ? `Delivery: ${esc(prettyDate(project.delivery_date))}` : ''}
 ${project.is_minor && project.secondary_name
   ? `<br>Approvals to ${esc(project.secondary_name)}${project.secondary_relationship ? ` (${esc(project.secondary_relationship)})` : ''}${project.secondary_contact ? ` &middot; ${esc(project.secondary_contact)}` : ''}`
   : ''}
</div>
${scheduleRows}
${images ? `<h3>Approved design</h3>${images}` : ''}
${suitBlocks}
${orderRows.length ? `<h3>Order</h3>${table(orderRows.map(([k, v]) => [k, v, true]))}` : ''}
<h3>Price breakdown</h3>${table(priceRows)}
<div class="total"><span>Total</span><span>${esc(formatMoney(total))}</span></div>
${project.quote ? `<p style="font-family:system-ui;font-size:12px;color:#5d574c">Quoted ${esc(prettyDate(project.quote.at))}. This price is held for this order.</p>` : ''}

<h3>Terms and conditions</h3>
<ol class="terms">${(business?.terms ?? ORDER_TERMS).map((t) => `<li>${esc(t)}</li>`).join('')}</ol>

<h3>Contact us if you have any further queries</h3>
<p class="meta">
  ${esc(business?.name ?? GD_CONTACT.name)}<br>${esc(business?.role ?? GD_CONTACT.role)}<br>
  ${esc(business?.phone ?? GD_CONTACT.phone)}<br>${esc(business?.email ?? GD_CONTACT.email)}
</p>

<p class="sign">Client signature: ______________________________&nbsp;&nbsp;&nbsp;Date: ______________</p>
</body></html>`;
  }

  const groups = lines.reduce((acc, line) => {
    const key = multi ? line.group : '';
    (acc[key] ??= []).push(line);
    return acc;
  }, {});

  return (
    <>
    {confirmFix && (
      <Modal title="Send the formal quote" onClose={() => setConfirmFix(false)}>
        <div className="stack">
          <p style={{ margin: 0 }}>
            The formal quote fixes the price at <strong>{formatMoney(live.total)}</strong> and moves the order to
            <strong> Quoted</strong>. After this, a change to the price list will not change what this client pays
            unless you re-quote.
          </p>
          <div className="inline">
            <button className="btn btn-gold" onClick={fixAndEmail}>Fix the price and send</button>
            <button className="btn btn-ghost" onClick={() => setConfirmFix(false)}>Cancel</button>
          </div>
        </div>
      </Modal>
    )}
    {confirmSend && (
      <Modal title="Send the quote" onClose={() => setConfirmSend(null)} wide>
        <div className="stack">
          <div className="price-line"><span className="muted">To</span><span>{confirmSend.to}</span></div>
          <div className="price-line"><span className="muted">From</span><span>{confirmSend.from}</span></div>
          <div className="price-line"><span className="muted">Subject</span><span>{confirmSend.subject}</span></div>
          <div className="note" style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto' }}>{confirmSend.body}</div>
          {confirmSend.attachments.length > 0 ? (
            <div>
              <div className="price-group-title">
                Attached - {confirmSend.attachments.length} render{confirmSend.attachments.length === 1 ? '' : 's'}, {megabytes(confirmSend.totalBytes)}
              </div>
              {confirmSend.attachments.map((a) => (
                <div key={a.name} className="tiny faint mono">{a.name}</div>
              ))}
            </div>
          ) : (
            <div className="tiny faint">No renders attached.</div>
          )}
          {confirmSend.omitted > 0 && (
            <Banner kind="warn">
              {confirmSend.omitted} render{confirmSend.omitted === 1 ? '' : 's'} left off - together they would
              be too large for Gmail to accept.
            </Banner>
          )}
          <div className="inline">
            <button
              className="btn btn-gold"
              disabled={mailing}
              onClick={async () => {
                setMailing(true);
                try { await sendQuote(); setConfirmSend(null); }
                catch (err) { toast(messageFor(err), 'err'); }
                finally { setMailing(false); }
              }}
            >
              {mailing ? <><Spinner /> Sending...</> : 'Send it'}
            </button>
            <button className="btn btn-ghost" onClick={() => setConfirmSend(null)}>Cancel</button>
          </div>
        </div>
      </Modal>
    )}
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <div className="stack" style={{ flex: 2, minWidth: 440 }}>
        <div className="card">
          <div className="card-head">
            <h3>The order</h3>
            <div className="spacer" />
            <button
              className="btn btn-sm"
              title={project.email ? `Email the formal quote to ${project.email}` : 'The client has no email address yet'}
              disabled={!project.email || mailing}
              onClick={emailQuote}
            >
              {mailing ? <><Spinner /> Preparing...</> : 'Email the formal quote'}
            </button>
            <button className="btn btn-sm btn-primary" onClick={exportFile} disabled={exporting}>
              {exporting ? <><Spinner /> Exporting...</> : 'Export client file'}
            </button>
          </div>
          <div className="card-pad">
            <SummaryLine label="Client" value={`${project.name} ${project.surname}`.trim()} />
            <SummaryLine label="Order number" value={project.order_ref} mono />
            <SummaryLine label="Occasion" value={[eventLabel, prettyDate(project.event_date)].filter(Boolean).join(' · ')} />
            <SummaryLine label="Delivery" value={prettyDate(project.delivery_date)} />
            <SummaryLine label="Status" value={statusLabel(project.status)} />
            {project.is_minor && project.secondary_name && (
              <SummaryLine
                label="Approvals to"
                value={`${project.secondary_name}${project.secondary_relationship ? ` (${project.secondary_relationship})` : ''}`}
              />
            )}
            <SummaryLine label="Suits" value={multi ? `${suits.length} suits` : '1 suit'} />
            {project.postal_address && <SummaryLine label="Deliver to" value={project.postal_address} />}
          </div>
        </div>

        {perSuit.map((s) => (
          <div className="card" key={s.id}>
            <div className="card-head">
              <h3>{multi ? s.title : 'Specification'}</h3>
              <div className="spacer" />
              {s.cloth.length > 0 && <span className="tiny faint">{s.cloth.join(' · ')}</span>}
            </div>
            <div className="card-pad">
              {s.sections.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>Nothing specified yet.</p>
              ) : (
                s.sections.map((sec) => (
                  <div key={sec.title}>
                    <div className="price-group-title">{sec.title}</div>
                    {sec.rows.map((r) => (
                      <div className="price-line" key={r.label}>
                        <span className="muted">{r.label}</span>
                        <span style={{ fontWeight: 600 }}>{r.value}</span>
                      </div>
                    ))}
                  </div>
                ))
              )}
              {s.measures.map((g) => (
                <div key={g.garment}>
                  <div className="price-group-title">{g.label} measurements</div>
                  {g.rows.map((r) => (
                    <div className="price-line" key={r.id}>
                      <span className="muted">{r.label}</span>
                      <span className="mono small">{formatMeasure(r.value, unit)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}

        {(analysis.skinTone || analysis.fabricColour) && (
          <div className="card">
            <div className="card-head"><h3>Measured colours</h3></div>
            <div className="card-pad">
              {analysis.skinTone && (
                <div className="price-line">
                  <span className="muted">Skin tone</span>
                  <span className="inline" style={{ gap: 7 }}>
                    <span className="swatch" style={{ width: 18, height: 18, background: analysis.skinTone.hex }} />
                    <span style={{ fontWeight: 600 }}>{analysis.skinTone.label}</span>
                  </span>
                </div>
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
        )}

        {approved.length > 0 && (
          <div className="card">
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

      <div className="stack" style={{ flex: 1, minWidth: 300 }}>
        {/* The dates the order runs to, where the order is signed off. */}
        {PROCESS_DATES.some(({ key }) => project[key]) && (
          <div className="card">
            <div className="card-head"><h3>Schedule</h3></div>
            <div className="card-pad">
              {PROCESS_DATES.filter(({ key }) => project[key]).map(({ key, label }) => (
                <div className="price-line" key={key}>
                  <span className="muted">{label}</span>
                  <span className="small">{prettyDate(project[key])}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-head">
            <h3>Quote</h3>
            <div className="spacer" />
            {project.quote
              ? <span className="pill pill-ok">Fixed {prettyDate(project.quote.at)}</span>
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
            {!project.quote && (
              <p className="tiny faint" style={{ marginTop: 0 }}>
                This total follows the price list until the formal quote is sent, then it is fixed.
              </p>
            )}
            {Object.entries(groups).map(([group, groupLines]) => (
              <div key={group || 'all'}>
                {group && <div className="price-group-title">{group}</div>}
                {groupLines.map((l, i) => (
                  <div className="price-line" key={`${l.key}-${i}`}>
                    <span className="small">{l.label}</span>
                    <span className="mono small">{formatMoney(l.amount)}</span>
                  </div>
                ))}
              </div>
            ))}
            <hr className="divider" />
            <div className="price-line" style={{ fontSize: 19, fontWeight: 700 }}>
              <span>Total</span>
              <span>{formatMoney(total)}</span>
            </div>
            {(paid > 0 || project.quote) && (
              <>
                <div className="price-line"><span className="muted small">Paid to date</span><span className="mono small">{formatMoney(paid)}</span></div>
                <div className="price-line"><span className="small" style={{ fontWeight: 600 }}>Balance due</span><span className="mono small">{formatMoney(Math.max(0, total - paid))}</span></div>
              </>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>All notes</h3></div>
          <div className="card-pad" style={{ maxHeight: 420, overflowY: 'auto' }}>
            {project.notes.length === 0 ? (
              <p className="small faint" style={{ margin: 0 }}>No notes recorded.</p>
            ) : (
              project.notes.map((n) => (
                <div key={n.id} className="note">
                  <div className="note-head">
                    <span className="pill pill-quiet">{PAGE_NAMES[n.step] ?? n.step}</span>
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
    </>
  );
}

function SummaryLine({ label, value, mono }) {
  if (!value) return null;
  return (
    <div className="price-line">
      <span className="muted">{label}</span>
      <span className={mono ? 'mono small' : ''} style={{ fontWeight: 600, textAlign: 'right', whiteSpace: 'pre-wrap' }}>{value}</span>
    </div>
  );
}
