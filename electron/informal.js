'use strict';

const v = require('./validate');

/**
 * The informal quote: a summary of the order sent to the client before
 * anything is agreed - by email with their renders attached, or by WhatsApp -
 * so they can say yes or ask for changes before GD draws up the formal quote.
 *
 * The message itself is written in the window, where the catalogue and the
 * prices live, and GD can change any figure in it before it goes. Who it goes
 * to, and which pictures ride with it, are decided here from the order on
 * file - the window says what to send, never where, and never which files.
 */

/** A WhatsApp number as wa.me wants it: country code and digits, nothing else. */
function whatsappNumber(raw, countryCode = '27') {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const cc = /^\d{1,3}$/.test(String(countryCode)) ? String(countryCode) : '27';
  let digits;
  if (text.startsWith('+')) digits = text.slice(1).replace(/\D/g, '');
  else {
    const bare = text.replace(/\D/g, '');
    if (bare.startsWith('00')) digits = bare.slice(2);
    else if (bare.startsWith('0')) digits = cc + bare.slice(1);
    else digits = bare;
  }
  // E.164 is at most 15 digits; anything under 8 is not a phone number.
  return /^\d{8,15}$/.test(digits) ? digits : '';
}

/**
 * Who the quote goes to. For a client under 18 that is the parent or provider
 * on file - they approve and pay - and the client otherwise.
 */
function recipientOf(project) {
  const minor = !!project.is_minor && !!(project.secondary_name || project.secondary_contact || project.secondary_email);
  if (minor) {
    return {
      name: project.secondary_name || '',
      phone: project.secondary_contact || '',
      email: project.secondary_email || '',
      guardian: true,
    };
  }
  return {
    name: `${project.name ?? ''} ${project.surname ?? ''}`.trim(),
    phone: project.contact || '',
    email: project.email || '',
    guardian: false,
  };
}

/** The address that opens WhatsApp with the message written and the chat chosen. */
function whatsappUrl(number, text) {
  return `https://wa.me/${number || ''}?text=${encodeURIComponent(text)}`;
}

const STATUSES = ['sent', 'confirmed', 'changes'];
const VIAS = ['whatsapp', 'email', 'copied'];
const MAX_LINES = 400;

const cents = (n) => Math.round(n * 100) / 100;

/**
 * The figures as GD settled on them, checked: a bounded list of lines, each
 * with a label and an amount. The total is added up here from those lines,
 * never taken from the window, so what is recorded is the sum of what was
 * sent. `basis` is the price list's lines at the time, [key, amount], which
 * is how the window later tells whether the order has changed since.
 */
function figures(lines, basis) {
  if (!Array.isArray(lines) || !lines.length) throw new v.ValidationError('There are no figures to send yet.');
  if (lines.length > MAX_LINES) throw new v.ValidationError('That is too many quote lines');
  if (!Array.isArray(basis) || basis.length > MAX_LINES) throw new v.ValidationError('The price list the figures came from is missing');
  const clean = lines.map((line) => {
    if (!line || typeof line !== 'object') throw new v.ValidationError('A quote line is not a line');
    const label = v.str(line.label, 'label', 200).trim();
    if (!label) throw new v.ValidationError('Every quote line needs a description');
    return {
      group: v.str(line.group, 'group', 120),
      label,
      amount: cents(v.num(line.amount, 'amount', { min: -1e7, max: 1e7 }) ?? 0),
      key: v.str(line.key, 'key', 160),
    };
  });
  const keys = basis.map((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2) throw new v.ValidationError('The price list the figures came from is not a list of lines');
    return [v.str(pair[0], 'key', 160), cents(v.num(pair[1], 'amount', { min: -1e7, max: 1e7 }) ?? 0)];
  });
  return { lines: clean, basis: keys, total: cents(clean.reduce((t, l) => t + l.amount, 0)) };
}

/**
 * What is kept on the order about the informal quote: when, how, to whom, the
 * figures it went with, how many pictures, and the answer. A record from
 * before the figures were kept reads back with none, which simply means the
 * formal quote starts from the price list.
 */
function record(previous, patch) {
  const base = previous && typeof previous === 'object' ? previous : {};
  const next = { ...base, ...patch };
  return {
    status: STATUSES.includes(next.status) ? next.status : 'sent',
    via: VIAS.includes(next.via) ? next.via : base.via ?? 'copied',
    sentAt: String(next.sentAt ?? '').slice(0, 40),
    answeredAt: String(next.answeredAt ?? '').slice(0, 40),
    total: Number.isFinite(Number(next.total)) ? Number(next.total) : 0,
    to: String(next.to ?? '').slice(0, 200),
    lines: Array.isArray(next.lines) ? next.lines.slice(0, MAX_LINES) : [],
    basis: Array.isArray(next.basis) ? next.basis.slice(0, MAX_LINES) : [],
    pictures: Number.isInteger(next.pictures) && next.pictures > 0 ? next.pictures : 0,
  };
}

module.exports = { whatsappNumber, recipientOf, whatsappUrl, figures, record, STATUSES, VIAS };
