'use strict';

/**
 * The shop's own details: whose name is on the order form, what number a
 * client rings, what the terms say, and how much of the total has to be in
 * before cutting starts.
 *
 * They are the shop's, typed in Settings > Business and kept in its database.
 * The app ships none: the defaults below are blank, or general settings any
 * shop starts from, so a copy carries a shop's details only because the shop
 * entered them.
 */

const DEFAULT_BUSINESS = {
  businessName: 'GD Suits',
  name: '',
  role: '',
  phone: '',
  email: '',
  // The share of the total due before cutting starts, which orders are
  // checked against.
  depositFraction: 0.5,
  // The informal quote.
  whatsappCountryCode: '27',
  informalValidDays: 14,
  // The shop's own terms, printed on the order form; none until it adds them.
  terms: [],
};

/** Whatever is stored, filled out with the defaults for anything absent. */
function withDefaults(stored) {
  // quotePageUrl was the address of a page the informal quote once linked
  // to. It is gone - the quote goes by email with the renders - and a copy
  // that saved one simply stops showing it.
  const { quotePageUrl, ...b } = stored && typeof stored === 'object' ? stored : {};
  const fraction = Number(b.depositFraction);
  const days = Number(b.informalValidDays);
  return {
    ...DEFAULT_BUSINESS,
    ...b,
    // A deposit outside 0-100% is a typo, not an instruction.
    depositFraction: Number.isFinite(fraction) && fraction >= 0 && fraction <= 1
      ? fraction
      : DEFAULT_BUSINESS.depositFraction,
    terms: Array.isArray(b.terms) && b.terms.length ? b.terms : DEFAULT_BUSINESS.terms,
    whatsappCountryCode: /^\d{1,3}$/.test(String(b.whatsappCountryCode ?? ''))
      ? String(b.whatsappCountryCode)
      : DEFAULT_BUSINESS.whatsappCountryCode,
    informalValidDays: Number.isInteger(days) && days >= 1 && days <= 365 ? days : DEFAULT_BUSINESS.informalValidDays,
  };
}

/**
 * What to save so the shop's details no longer come from the defaults above:
 * whatever is stored, filled out with them. Null when nothing is missing.
 *
 * A shop that never saved its details in Settings has been using the
 * defaults all along, and one that saved them before a field was added is
 * using the default for that field. Saved once, as they are, they are the
 * shop's own, and a later version shipping other defaults changes nothing.
 */
function toKeep(stored) {
  const full = withDefaults(stored);
  return JSON.stringify(full) === JSON.stringify(stored) ? null : full;
}

module.exports = { DEFAULT_BUSINESS, withDefaults, toKeep };
