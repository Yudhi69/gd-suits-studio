'use strict';

/**
 * Standing emails: a piece of wording, a date to count from, and who it is
 * for.
 *
 * "A week before the event, remind them about the final fitting" is a thing
 * GD does by remembering. A rule writes it down once and the app works out
 * which orders are due.
 *
 * What it deliberately does NOT do is send anything by itself. There is no
 * mail server here and no password for his mailbox; a draft is opened in his
 * own mail client, addressed and written, and he presses send. An app that
 * quietly emails clients on a timer is one bad template away from sending
 * four hundred people the wrong thing, and GD would find out from a client.
 * So the timer decides what is *due*, and a person still sends it.
 */

/** The dates a rule can count from, in the order they happen. */
const ANCHORS = [
  { key: 'event_date', label: 'The event' },
  { key: 'consultation_date', label: 'First consultation' },
  { key: 'measurement_date', label: 'Measurement date' },
  { key: 'first_fitting_date', label: 'First fitting' },
  { key: 'final_fitting_date', label: 'Final fitting & delivery' },
  { key: 'delivery_date', label: 'Delivery' },
  { key: 'review_date', label: 'Review date' },
];
const ANCHOR_KEYS = ANCHORS.map((a) => a.key);

/** Who a rule is for. */
const AUDIENCES = [
  { key: 'all', label: 'Every client with that date set' },
  { key: 'only', label: 'Only the clients I pick' },
  { key: 'except', label: 'Everyone except the clients I pick' },
];
const AUDIENCE_KEYS = AUDIENCES.map((a) => a.key);

const DEFAULT_BODY = `Hi {client_first},

A quick reminder about your suit for {event_date}.

{what}

Please let me know if anything has changed.

Kind regards,
{gd_name}
{gd_phone}`;

const DEFAULT_SUBJECT = 'GD Suits - your order {order_ref}';

/**
 * A rule as it should be stored, whatever arrived.
 *
 * Every field is clamped rather than trusted: an offset of nine thousand days
 * or an anchor that is not a date on an order would produce a rule that is
 * either never due or due for everything, and both are worse than a rule that
 * was quietly corrected to something sane.
 */
const MAX_OFFSET_DAYS = 365;

function normalise(rule = {}) {
  const anchor = ANCHOR_KEYS.includes(rule.anchor) ? rule.anchor : 'event_date';
  const audience = AUDIENCE_KEYS.includes(rule.audience) ? rule.audience : 'all';
  const days = Number(rule.offsetDays);
  const offsetDays = Number.isFinite(days)
    ? Math.max(-MAX_OFFSET_DAYS, Math.min(MAX_OFFSET_DAYS, Math.trunc(days)))
    : -7;
  return {
    name: String(rule.name ?? '').trim().slice(0, 120) || 'Untitled email',
    subject: String(rule.subject ?? DEFAULT_SUBJECT).slice(0, 400),
    body: String(rule.body ?? DEFAULT_BODY).slice(0, 20000),
    anchor,
    offsetDays,
    audience,
    enabled: rule.enabled === undefined ? true : !!rule.enabled,
  };
}

/** "a week before the final fitting", for the rule list to read back. */
function describe(rule) {
  const r = normalise(rule);
  const anchor = ANCHORS.find((a) => a.key === r.anchor)?.label.toLowerCase() ?? r.anchor;
  const n = Math.abs(r.offsetDays);
  if (n === 0) return `On the day of ${anchor}`;
  const unit = n % 7 === 0 ? `${n / 7} week${n === 7 ? '' : 's'}` : `${n} day${n === 1 ? '' : 's'}`;
  return `${unit} ${r.offsetDays < 0 ? 'before' : 'after'} ${anchor}`;
}

/** The day a rule falls due for an order, as YYYY-MM-DD, or null. */
function dueOn(rule, project) {
  const r = normalise(rule);
  const anchorDate = String(project?.[r.anchor] ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) return null;
  // Built in UTC on purpose. A date on an order is a day, not a moment, and
  // constructing it locally would slide it either side of midnight depending
  // on where the machine thinks it is.
  const at = new Date(`${anchorDate}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return null;
  at.setUTCDate(at.getUTCDate() + r.offsetDays);
  return at.toISOString().slice(0, 10);
}

/**
 * Whether a rule covers a given client.
 *
 * `only` with nobody picked covers nobody, which is what it says. `except`
 * with nobody picked covers everyone, likewise.
 */
function covers(rule, clientId, picked = []) {
  const r = normalise(rule);
  const listed = picked.includes(clientId);
  if (r.audience === 'only') return listed;
  if (r.audience === 'except') return !listed;
  return true;
}

module.exports = {
  ANCHORS, ANCHOR_KEYS, AUDIENCES, AUDIENCE_KEYS,
  DEFAULT_BODY, DEFAULT_SUBJECT, MAX_OFFSET_DAYS,
  normalise, describe, dueOn, covers,
};
