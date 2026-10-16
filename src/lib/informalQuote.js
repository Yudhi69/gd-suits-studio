import { buildSpecSheet } from './promptBuilder.js';
import { buildBreakdown, formatMoney } from './pricing.js';
import { suitsOf } from './quote.js';
import { eventTypesWith } from './catalog.js';

/**
 * The informal quote: what the client is shown before anything is agreed.
 *
 * It is built from whatever has been chosen so far - the base garment alone is
 * enough - so GD can send one as early in the consultation as he likes and
 * send another after the client's changes. Prices follow the price list until
 * the formal quote is sent and the figure is fixed.
 *
 * Two forms of the same thing come out of here. A message, which goes by
 * WhatsApp or email and reads on its own. And, when GD has published the quote
 * page, a link to it: the summary travels inside the link, after the `#`, which
 * a browser never sends to any server - so the page has nothing stored behind
 * it and holds nothing about anyone.
 */

const DAY = 86400000;
const iso = (date) => new Date(date).toISOString().slice(0, 10);
const first = (name) => String(name ?? '').trim().split(/\s+/)[0] ?? '';
const clip = (text, n) => (String(text ?? '').length > n ? `${String(text).slice(0, n - 1)}…` : String(text ?? ''));

/** "14 Nov 2026", the way the date is said, whatever the machine's locale. */
export function prettyDate(value) {
  if (!value) return '';
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.valueOf())) return String(value);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The summary, as plain data. Only what the client needs: first names, never
 * a phone number, address or measurement - the link can be forwarded, and
 * anything in it goes wherever it goes.
 */
export function informalQuote({ order, overrides, steps, business = {}, customOptions = [], today = new Date() }) {
  const suits = suitsOf(order);
  const multi = suits.length > 1;
  const days = business.informalValidDays ?? 14;
  const fraction = business.depositFraction ?? 0.5;
  const minor = !!order.is_minor && !!order.secondary_name;

  const priced = suits.map((suit, i) => {
    const spec = suit.spec ?? {};
    const { lines, total } = buildBreakdown(spec, overrides, steps);
    const who = [first(suit.name ?? order.name), suit.label || suit.fabric_name || ''].filter(Boolean).join(' - ');
    return {
      t: multi ? clip(who || `Suit ${i + 1}`, 80) : '',
      i: buildSpecSheet(spec, steps)
        .flatMap((section) => section.rows.map((r) => [clip(r.label, 60), clip(r.value, 80)]))
        .slice(0, 40),
      l: lines.map((l) => [clip(l.label, 80), l.amount]),
      st: total,
    };
  });
  const total = priced.reduce((t, s) => t + s.st, 0);
  const event = eventTypesWith(customOptions).find((e) => e.key === order.event_type);

  return {
    v: 1,
    ref: order.order_ref || '',
    at: iso(today),
    until: iso(new Date(today).getTime() + days * DAY),
    to: first(minor ? order.secondary_name : order.name),
    who: first(order.name),
    ev: event && event.key !== 'other' ? event.label : clip(order.event_other || '', 60),
    evd: order.event_date || '',
    shop: {
      n: business.businessName || 'GD Suits',
      p: business.phone || '',
      e: business.email || '',
      // So the page's "confirm on WhatsApp" can turn 082... into a number.
      cc: business.whatsappCountryCode || '27',
    },
    s: priced,
    tot: total,
    dep: Math.round(total * fraction * 100) / 100,
    depPct: Math.round(fraction * 100),
  };
}

/** URL-safe base64 of the summary's JSON, as the quote page reads it back. */
export function encodeQuote(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeQuote(text) {
  const b64 = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** The link to the published quote page, or nothing if there is not one. */
export function quoteLink(pageUrl, payload) {
  if (!pageUrl) return '';
  return `${pageUrl.replace(/#.*$/, '')}#q=${encodeQuote(payload)}`;
}

/**
 * The message. With a link it is short - a greeting, the total and the link,
 * which shows the rest properly laid out. Without one it carries the summary
 * itself, in WhatsApp's own *bold*, so it still reads well in the chat.
 */
export function quoteMessage(payload, link = '') {
  const hello = payload.to ? `Hi ${payload.to},` : 'Hi,';
  const occasion = [payload.ev, prettyDate(payload.evd)].filter(Boolean).join(' on ');
  const forWhom = payload.to && payload.who && payload.to !== payload.who ? ` for ${payload.who}` : '';
  const intro = `${hello} here is your informal quote from ${payload.shop.n}${forWhom}${occasion ? ` - ${occasion}` : ''}.`;
  const close = [
    `This is an informal quote, valid until ${prettyDate(payload.until)}. Reply to confirm, or tell us what you would like changed, and we will send you the formal quote.`,
    payload.shop.p ? `${payload.shop.n} · ${payload.shop.p}` : payload.shop.n,
  ];
  const totals = [
    `*Total: ${formatMoney(payload.tot)}*`,
    payload.depPct ? `Deposit to start (${payload.depPct}%): ${formatMoney(payload.dep)}` : '',
  ].filter(Boolean);

  if (link) {
    return [intro, '', link, '', ...totals, '', ...close].join('\n');
  }

  const body = payload.s.flatMap((suit) => [
    ...(suit.t ? [`*${suit.t}*`] : []),
    ...suit.l.map(([label, amount]) => `${label}: ${formatMoney(amount)}`),
    ...(payload.s.length > 1 ? [`Subtotal: ${formatMoney(suit.st)}`] : []),
    '',
  ]);
  const ref = payload.ref ? ` (${payload.ref})` : '';
  return [intro, '', `*Informal quote${ref}*`, '', ...body, ...totals, '', ...close].join('\n');
}

/** The email subject. */
export function quoteSubject(payload) {
  return `Your informal quote from ${payload.shop.n}${payload.ref ? ` - ${payload.ref}` : ''}`;
}
