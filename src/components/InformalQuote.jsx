import React, { useEffect, useMemo, useState } from 'react';
import { api, messageFor, projectMedia } from '../lib/api.js';
import { formatMoney, priceGrid } from '../lib/pricing.js';
import { orderBreakdown, basisOf, sentFigures, suitsOf } from '../lib/quote.js';
import {
  informalQuote, quoteMessage, quoteSubject, prettyDate, startingFigures, figuresFrom, alternativeFor, isAdded,
} from '../lib/informalQuote.js';
import { Banner, Modal, Spinner, useToast } from './ui.jsx';

/**
 * Sending the informal quote.
 *
 * GD sees every figure first and can change any of them - reprice a line, add
 * a discount - and the message rewrites itself as he does. Then it goes by
 * email with the client's renders attached, only when he presses send. Through
 * Gmail the app sends it; otherwise it opens in his own mail program, pictures
 * and all, for him to send from there. WhatsApp and copying carry the same
 * words without the pictures.
 */
export function InformalQuoteModal({ project, overrides, steps, business, customOptions, onClose, onSent }) {
  const [preview, setPreview] = useState(null);
  const [shop, setShop] = useState(business ?? null);
  const [busy, setBusy] = useState(null);
  const toast = useToast();

  const list = useMemo(() => orderBreakdown(project, overrides, steps), [project, overrides, steps]);
  const start = useMemo(() => startingFigures(project, list), [project, list]);
  const [amounts, setAmounts] = useState(start.amounts);
  const [added, setAdded] = useState(start.added);
  const [attach, setAttach] = useState(true);
  const [compare, setCompare] = useState([]);

  useEffect(() => {
    api.informal.preview({ projectId: project.id }).then(setPreview).catch(() => setPreview({ pictures: [] }));
    api.business.get().then(setShop).catch(() => {});
  }, [project.id]);

  const figures = figuresFrom(list, amounts, added);
  const addedTotal = figures.lines.filter(isAdded).reduce((t, l) => t + l.amount, 0);
  const options = useMemo(() => comparisons(project, overrides, steps), [project, overrides, steps]);
  const alternatives = options
    .filter((o) => compare.includes(o.id))
    .map((o) => ({ label: o.label, total: alternativeFor(project, o.change, overrides, steps, addedTotal).total }));
  const payload = informalQuote({ order: project, figures, business: shop ?? {}, customOptions, steps, alternatives });
  const unpriced = list.lines.filter((l) => l.unpriced);
  const pictures = preview?.pictures ?? [];
  const withPictures = attach && pictures.length > 0;
  const emailText = quoteMessage(payload, { renders: withPictures ? preview.rendersLine : '' });
  // The same words without the sentence about pictures, which only email carries.
  const plainText = quoteMessage(payload);
  const subject = quoteSubject(payload);
  const empty = !list.lines.length;
  const changed = Math.abs(figures.total - list.total) >= 0.005 || figures.lines.length !== list.lines.length;

  // Grouped as they are priced: by suit on a party, by page on one suit.
  const groups = list.lines.reduce((acc, line) => {
    (acc[line.group ?? ''] ??= []).push(line);
    return acc;
  }, {});
  const multi = suitsOf(project).length > 1;

  async function run(kind, fn, done) {
    setBusy(kind);
    try {
      const result = await fn();
      toast(done(result), 'ok');
      onSent?.();
    } catch (err) {
      toast(messageFor(err), 'err');
    } finally {
      setBusy(null);
    }
  }

  const figuresArg = { lines: figures.lines, basis: basisOf(list.lines) };

  const sendEmail = () => run('email', () => api.informal.send({
    projectId: project.id, via: 'email', text: emailText, subject, pictures: withPictures, ...figuresArg,
  }), (r) => {
    const pics = r.attached ? ` with ${r.attached} render${r.attached === 1 ? '' : 's'}` : '';
    const left = r.omitted ? ` (${r.omitted} left off - too large for one email)` : '';
    return r.sent ? `Sent to ${r.to}${pics}${left}` : `Email opened${pics}${left} - check it, then send`;
  });

  const sendWhatsapp = () => run('whatsapp', () => api.informal.send({
    projectId: project.id, via: 'whatsapp', text: plainText, subject, ...figuresArg,
  }), (r) => (r.copied
    ? 'WhatsApp opened - the message is too long for a link, so it is copied: paste it there and send'
    : 'WhatsApp opened with the message - press send there'));

  const copy = () => run('copy', () => api.informal.copy({ projectId: project.id, text: plainText, ...figuresArg }),
    () => 'Message copied - paste it wherever you like');

  const setAmount = (key, value) => setAmounts((a) => ({ ...a, [key]: value }));
  const setAddedAt = (i, patch) => setAdded((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const reset = () => { setAmounts(Object.fromEntries(list.lines.map((l) => [l.key, l.amount]))); setAdded([]); };

  const emailLabel = !preview?.email
    ? 'Email'
    : preview.emailVia === 'gmail' ? `Send to ${preview.email}` : 'Open the email to send';

  return (
    <Modal title="Informal quote" onClose={onClose} wide>
      <div className="stack">
        <div>
          <div className="price-line">
            <span className="muted">To</span>
            <span>
              {preview?.name || 'The client'}
              {preview?.guardian && <span className="faint"> (parent or provider)</span>}
            </span>
          </div>
          <div className="price-line">
            <span className="muted">Email</span>
            <span className={preview?.email ? '' : 'faint small'}>
              {preview === null ? '...' : preview.email || 'No email on file - add one on the Client page'}
            </span>
          </div>
          {preview?.email && (
            <div className="price-line">
              <span className="muted">Sent</span>
              <span className="small">
                {preview.emailVia === 'gmail'
                  ? `By the app, through Gmail as ${preview.from}`
                  : 'Opens in your mail program, ready for you to send'}
              </span>
            </div>
          )}
        </div>

        {empty && <Banner kind="warn">Nothing is chosen for this order yet - pick the base garment first.</Banner>}
        {unpriced.length > 0 && (
          <Banner kind="warn">
            {[...new Set(unpriced.map((l) => l.label))].join(', ')}: this quality has no price for this suit type yet, so it is
            shown at the suit type&apos;s own price. Set it in Settings &gt; Price list, or change the figure below.
          </Banner>
        )}

        {!empty && (
          <div className="informal-figures">
            <div className="inline">
              <strong>The figures</strong>
              <span className="tiny faint">
                {start.fromSent ? 'As you last sent them. ' : 'From the price list. '}
                Change any of them before it goes - only this quote changes, not the price list.
              </span>
              <div className="spacer" />
              {changed && <button className="btn btn-sm btn-ghost" onClick={reset}>Back to the price list</button>}
            </div>
            {Object.entries(groups).map(([group, lines]) => (
              <div key={group || 'all'}>
                {group && <div className="price-group-title">{group}</div>}
                {lines.map((l) => (
                  <div className="price-line informal-line" key={l.key}>
                    <span className="small">{l.label}</span>
                    <span className="inline">
                      {Math.abs((Number(amounts[l.key]) || 0) - l.amount) >= 0.005 && (
                        <span className="tiny faint" title="The price list's figure">{formatMoney(l.amount)}</span>
                      )}
                      <input
                        className="input input-bare mono informal-amount"
                        type="number"
                        min="0"
                        step="any"
                        aria-label={`${multi ? `${group} - ` : ''}${l.label}`}
                        value={amounts[l.key] ?? ''}
                        onChange={(e) => setAmount(l.key, e.target.value)}
                      />
                    </span>
                  </div>
                ))}
              </div>
            ))}
            {added.length > 0 && <div className="price-group-title">Adjustments</div>}
            {added.map((row, i) => (
              <div className="price-line informal-line" key={i}>
                <input
                  className="input input-bare small"
                  placeholder="Discount, rush fee..."
                  aria-label="What this line is"
                  value={row.label}
                  maxLength={120}
                  onChange={(e) => setAddedAt(i, { label: e.target.value })}
                />
                <span className="inline">
                  <input
                    className="input input-bare mono informal-amount"
                    type="number"
                    step="any"
                    aria-label="Its amount - negative for a discount"
                    value={row.amount}
                    onChange={(e) => setAddedAt(i, { amount: e.target.value })}
                  />
                  <button className="btn btn-icon btn-ghost" title="Remove this line"
                    onClick={() => setAdded((rows) => rows.filter((_, j) => j !== i))}>×</button>
                </span>
              </div>
            ))}
            <button className="btn btn-sm btn-ghost" style={{ marginTop: 6 }}
              onClick={() => setAdded((rows) => [...rows, { label: '', amount: '' }])}>
              + Add a line
            </button>
            <div className="price-line" style={{ marginTop: 8 }}>
              <strong>Total</strong>
              <span>
                {changed && <span className="tiny faint">price list {formatMoney(list.total)} · </span>}
                <strong className="mono">{formatMoney(figures.total)}</strong>
              </span>
            </div>
          </div>
        )}

        {!empty && options.length > 0 && (
          <Compare
            options={options}
            chosen={compare}
            onChange={setCompare}
            totalOf={(o) => alternativeFor(project, o.change, overrides, steps, addedTotal)}
          />
        )}

        <div>
          <div className="price-line"><span className="muted">Subject</span><span className="small">{subject}</span></div>
          <div className="note informal-message">{emailText}</div>
        </div>

        {pictures.length > 0 ? (
          <div>
            <label className="inline small" style={{ cursor: 'pointer' }}>
              <input type="checkbox" className="informal-attach" checked={attach} onChange={(e) => setAttach(e.target.checked)} />
              Attach the renders - {pictures.length} picture{pictures.length === 1 ? '' : 's'}, with the GD Suits badge
            </label>
            {attach && (
              <div className="informal-renders">
                {pictures.map((p) => (
                  <img key={p.name} src={projectMedia(project.id, p.file)} alt={p.name} title={p.name} />
                ))}
              </div>
            )}
          </div>
        ) : (
          preview && (
            <p className="tiny faint" style={{ margin: 0 }}>
              No renders yet - render the suit on the Preview page and they will be attached.
            </p>
          )
        )}

        <div className="inline" style={{ flexWrap: 'wrap' }}>
          <button
            className="btn btn-gold"
            disabled={!!busy || empty || !preview?.email}
            title={preview?.email ? '' : 'There is no email address on file'}
            onClick={sendEmail}
          >
            {busy === 'email' ? <><Spinner /> Sending...</> : emailLabel}
          </button>
          <button className="btn" disabled={!!busy || empty} onClick={sendWhatsapp}>
            {busy === 'whatsapp' ? <><Spinner /> Opening...</> : 'Send by WhatsApp'}
          </button>
          <button className="btn btn-ghost" disabled={!!busy || empty} onClick={copy}>Copy message</button>
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>
          WhatsApp and the copied message carry the same words without the pictures
          {preview?.whatsapp ? ` (WhatsApp to +${preview.whatsapp})` : ''}. While the order stays as it is, the formal
          quote on the Summary page is fixed at these figures.
        </p>
      </div>
    </Modal>
  );
}

/**
 * The other qualities and suit types the order could be priced in, for a
 * client weighing them up. A party's suits are not all one type, so there it
 * is each suit as chosen in another quality; one suit can change type too.
 */
function comparisons(project, overrides, steps) {
  const grid = priceGrid(steps, overrides);
  if (!grid) return [];
  const suits = suitsOf(project);
  const qualityKey = grid.field.id;
  const one = suits.length === 1 ? suits[0].spec ?? {} : null;
  const out = [];
  for (const { quality } of grid.rows) {
    if (one) {
      for (const suit of grid.suits) {
        if (one[qualityKey] === quality.key && one.suitType === suit.key) continue;
        out.push({
          id: `${quality.key}|${suit.key}`, quality, suit,
          label: `${quality.label} ${suit.label}`, change: { [qualityKey]: quality.key, suitType: suit.key },
        });
      }
    } else if (!suits.every((s) => s.spec?.[qualityKey] === quality.key)) {
      out.push({ id: `${quality.key}|`, quality, suit: null, label: `Every suit in ${quality.label}`, change: { [qualityKey]: quality.key } });
    }
  }
  return out;
}

/** Ticking the options to put beside the quote. */
function Compare({ options, chosen, onChange, totalOf }) {
  const suits = [...new Map(options.filter((o) => o.suit).map((o) => [o.suit.key, o.suit])).values()];
  const qualities = [...new Map(options.map((o) => [o.quality.key, o.quality])).values()];
  const toggle = (id) => onChange(chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id]);
  const cell = (o) => {
    if (!o) return <td key="none" className="faint tiny">This quote</td>;
    const { total, unpriced } = totalOf(o);
    return (
      <td key={o.id}>
        {unpriced ? <span className="tiny faint">No price yet</span> : (
          <label className="inline small" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={chosen.includes(o.id)} onChange={() => toggle(o.id)} aria-label={o.label} />
            <span className="mono">{formatMoney(total)}</span>
          </label>
        )}
      </td>
    );
  };

  return (
    <div className="informal-compare">
      <div className="inline">
        <strong>Compare</strong>
        <span className="tiny faint">Tick any to list them under the total - the same choices in another quality or suit.</span>
      </div>
      <table className="compare-grid">
        <thead>
          <tr>
            <th />
            {suits.length ? suits.map((s) => <th key={s.key}>{s.label}</th>) : <th>Every suit</th>}
          </tr>
        </thead>
        <tbody>
          {qualities.map((q) => (
            <tr key={q.key}>
              <th>{q.label}</th>
              {suits.length
                ? suits.map((s) => cell(options.find((o) => o.quality.key === q.key && o.suit?.key === s.key)))
                : [cell(options.find((o) => o.quality.key === q.key))]}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const VIA = { whatsapp: 'WhatsApp', email: 'email', copied: 'a copied message' };

/** Where the informal quote stands, on the summary page. */
export function InformalQuoteCard({ project, overrides, steps, onOpen, onFormal, reload }) {
  const iq = project.informalQuote;
  const toast = useToast();
  const list = orderBreakdown(project, overrides, steps);
  // A quote sent with its figures kept is out of date once the order no
  // longer gives the lines they were worked from; an older one, once the
  // total moves.
  const moved = iq && (iq.basis?.length ? !sentFigures(project, list) : Math.abs(list.total - (iq.total ?? 0)) >= 0.005);

  async function mark(status) {
    try {
      await api.informal.mark({ projectId: project.id, status });
      await reload();
      toast(status === 'confirmed' ? 'Marked as confirmed' : 'Marked as wanting changes', 'ok');
    } catch (err) {
      toast(messageFor(err), 'err');
    }
  }

  const pill = !iq ? <span className="pill pill-quiet">Not sent</span>
    : iq.status === 'confirmed' ? <span className="pill pill-ok">Confirmed</span>
      : iq.status === 'changes' ? <span className="pill pill-warn">Changes asked</span>
        : <span className="pill">Waiting for reply</span>;

  return (
    <div className="card">
      <div className="card-head">
        <h3>Informal quote</h3>
        <div className="spacer" />
        {pill}
      </div>
      <div className="card-pad">
        {!iq ? (
          <p className="small muted" style={{ marginTop: 0 }}>
            The whole consultation - every style choice and its cost - sent to the client with their renders before
            anything is agreed. You see every figure first and can change any of them, and can put other qualities
            beside it to compare. The client confirms or asks for changes, and the formal quote follows.
          </p>
        ) : (
          <div className="small" style={{ marginBottom: 10 }}>
            Sent {prettyDate(iq.sentAt)} by {VIA[iq.via] ?? iq.via}{iq.to ? ` to ${iq.to}` : ''}
            {iq.pictures ? ` with ${iq.pictures} render${iq.pictures === 1 ? '' : 's'}` : ''}, for{' '}
            <strong>{formatMoney(iq.total)}</strong>.
            {iq.status === 'confirmed' && <> The client confirmed on {prettyDate(iq.answeredAt)}.</>}
            {iq.status === 'changes' && <> The client asked for changes on {prettyDate(iq.answeredAt)}.</>}
            {moved && (
              <div className="tiny" style={{ marginTop: 6, color: 'var(--warn)' }}>
                The order has changed since - on the price list it now comes to {formatMoney(list.total)}. Send it
                again if the client should see the new figures.
              </div>
            )}
          </div>
        )}
        <div className="inline" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-sm btn-gold" onClick={onOpen}>{iq ? 'Send again' : 'Send informal quote'}</button>
          {iq && iq.status !== 'confirmed' && (
            <button className="btn btn-sm" onClick={() => mark('confirmed')}>Client confirmed</button>
          )}
          {iq && iq.status === 'sent' && (
            <button className="btn btn-sm btn-ghost" onClick={() => mark('changes')}>Asked for changes</button>
          )}
          {iq?.status === 'confirmed' && onFormal && (
            <button className="btn btn-sm btn-primary" onClick={onFormal}>Make the formal quote</button>
          )}
        </div>
      </div>
    </div>
  );
}
