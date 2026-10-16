import React, { useEffect, useMemo, useState } from 'react';
import { api, messageFor } from '../lib/api.js';
import { formatMoney } from '../lib/pricing.js';
import { orderBreakdown } from '../lib/quote.js';
import { informalQuote, quoteLink, quoteMessage, quoteSubject, prettyDate } from '../lib/informalQuote.js';
import { Banner, Modal, Spinner, useToast } from './ui.jsx';

/**
 * Sending the informal quote.
 *
 * Shows exactly what will go - to whom, and every word of it - and sends it
 * only when GD presses a button. WhatsApp opens with the chat chosen and the
 * message written, so even then the last tap is his.
 */
export function InformalQuoteModal({ project, overrides, steps, business, customOptions, onClose, onSent }) {
  const [recipient, setRecipient] = useState(null);
  // Read fresh: the quote page address may have been set in Settings since
  // the app opened, and the copy loaded at startup would not know it.
  const [shop, setShop] = useState(business ?? null);
  const [busy, setBusy] = useState(null);
  const toast = useToast();

  useEffect(() => {
    api.informal.recipient({ projectId: project.id }).then(setRecipient).catch(() => setRecipient({}));
    api.business.get().then(setShop).catch(() => {});
  }, [project.id]);

  const payload = useMemo(
    () => informalQuote({ order: project, overrides, steps, business: shop ?? {}, customOptions }),
    [project, overrides, steps, shop, customOptions]
  );
  const link = quoteLink(shop?.quotePageUrl, payload);
  const text = quoteMessage(payload, link);
  const empty = payload.s.every((s) => !s.i.length && !s.l.length);

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

  const send = (via) => run(via, () => api.informal.send({
    projectId: project.id, via, text, subject: quoteSubject(payload), total: payload.tot, link: !!link,
  }), (r) => (r.via === 'whatsapp'
    ? 'WhatsApp opened with the message - press send there'
    : r.sent ? `Sent to ${r.to}` : 'Email opened - check it, then send'));

  const copy = () => run('copy', () => api.informal.copy({ projectId: project.id, text, total: payload.tot, link: !!link }),
    () => 'Message copied - paste it wherever you like');

  return (
    <Modal title="Informal quote" onClose={onClose} wide>
      <div className="stack">
        <div>
          <div className="price-line">
            <span className="muted">To</span>
            <span>
              {recipient?.name || 'The client'}
              {recipient?.guardian && <span className="faint"> (parent or provider)</span>}
            </span>
          </div>
          <div className="price-line">
            <span className="muted">WhatsApp</span>
            <span className={recipient?.whatsapp ? 'mono' : 'faint small'}>
              {recipient === null ? '...' : recipient.whatsapp
                ? `+${recipient.whatsapp}`
                : 'No number on file - WhatsApp will ask who to send it to'}
            </span>
          </div>
          <div className="price-line">
            <span className="muted">Email</span>
            <span className={recipient?.email ? '' : 'faint small'}>{recipient?.email || 'No email on file'}</span>
          </div>
        </div>

        {empty && <Banner kind="warn">Nothing is chosen for this order yet - pick the base garment first.</Banner>}

        <div className="note informal-message">{text}</div>

        {link ? (
          <div className="inline tiny faint">
            <span>The link opens the summary laid out on a page of its own. Nothing about the order is stored there.</span>
            <button className="btn btn-sm btn-ghost" onClick={() => window.open(link)}>Preview the page</button>
          </div>
        ) : (
          <p className="tiny faint" style={{ margin: 0 }}>
            The whole summary goes in the message. To send a link to a laid-out page instead, put the quote
            page&apos;s address in Settings &rarr; Your business.
          </p>
        )}

        <div className="inline">
          <button className="btn btn-gold" disabled={!!busy || empty} onClick={() => send('whatsapp')}>
            {busy === 'whatsapp' ? <><Spinner /> Opening...</> : 'Send by WhatsApp'}
          </button>
          <button
            className="btn"
            disabled={!!busy || empty || !recipient?.email}
            title={recipient?.email ? '' : 'There is no email address on file'}
            onClick={() => send('email')}
          >
            {busy === 'email' ? <><Spinner /> Sending...</> : recipient?.emailVia === 'gmail' ? 'Send by email' : 'Open as an email'}
          </button>
          <button className="btn btn-ghost" disabled={!!busy || empty} onClick={copy}>Copy message</button>
        </div>
        <p className="tiny faint" style={{ margin: 0 }}>
          Prices follow the price list until the formal quote is sent from the Summary page, which fixes them.
        </p>
      </div>
    </Modal>
  );
}

const VIA = { whatsapp: 'WhatsApp', email: 'email', copied: 'a copied message' };

/** Where the informal quote stands, on the order page. */
export function InformalQuoteCard({ project, overrides, steps, onOpen, onFormal, reload }) {
  const iq = project.informalQuote;
  const toast = useToast();
  const live = orderBreakdown(project, overrides, steps).total;
  const moved = iq && Math.abs(live - (iq.total ?? 0)) >= 0.005;

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
            A summary of the order, sent by WhatsApp or email before anything is agreed. The client confirms or
            asks for changes, and the formal quote follows.
          </p>
        ) : (
          <div className="small" style={{ marginBottom: 10 }}>
            Sent {prettyDate(iq.sentAt)} by {VIA[iq.via] ?? iq.via}{iq.to ? ` to ${iq.to}` : ''}, for{' '}
            <strong>{formatMoney(iq.total)}</strong>.
            {iq.status === 'confirmed' && <> The client confirmed on {prettyDate(iq.answeredAt)}.</>}
            {iq.status === 'changes' && <> The client asked for changes on {prettyDate(iq.answeredAt)}.</>}
            {moved && (
              <div className="tiny" style={{ marginTop: 6, color: 'var(--warn)' }}>
                The order now comes to {formatMoney(live)} - send it again if the client should see the new figure.
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
          {iq?.status === 'confirmed' && (
            <button className="btn btn-sm btn-primary" onClick={onFormal}>Make the formal quote</button>
          )}
        </div>
      </div>
    </div>
  );
}
