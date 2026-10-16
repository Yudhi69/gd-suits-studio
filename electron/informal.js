'use strict';

/**
 * The informal quote: a summary of the order sent to the client by WhatsApp
 * or email before anything is agreed, so they can say yes or ask for changes
 * before GD draws up the formal quote.
 *
 * The message itself is written in the window, where the catalogue and the
 * prices live. Who it goes to is decided here, from the order on file - the
 * window says what to send, never where.
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

/** What is kept on the order about the informal quote: when, how, for how much, and the answer. */
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
    link: !!next.link,
  };
}

module.exports = { whatsappNumber, recipientOf, whatsappUrl, record, STATUSES, VIAS };
