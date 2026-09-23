'use strict';

/**
 * The shop's own details: whose name is on the order form, what number a
 * client rings, what the terms say, and how much of the total has to be in
 * before cutting starts.
 *
 * These were written into the code, which was fine while there was one tailor
 * using it and wrong the moment anything changed - a new number meant a new
 * build. They are settings now, with what was hardcoded as the starting point,
 * so the app carries GD's details because he typed them rather than because
 * they were compiled in.
 */

const DEFAULT_BUSINESS = {
  businessName: 'GD Suits',
  name: 'Gareth Duncan',
  role: 'GD Suits Owner',
  phone: '0824856941',
  email: 'gareth@gdsuits.co.za',
  // Clause 5 of the terms below, as a number the app can actually check
  // orders against.
  depositFraction: 0.5,
  terms: [
    'This GD Suits Order Form will be used as proof of order agreement between company and client.',
    'GD Suits will not accept any responsibility for inaccurate or wrong measurements supplied by client.',
    'GD Suits will not reimburse any deposit after order has been made by client.',
    "It is the client's responsibility to ensure the measurements supplied on GD Suits Order Form is accurate and correct.",
    'GD Suits will only start the tailor process once the 50% deposit is paid up front. This will need to be confirmed via client\'s "Proof of Payment".',
    'If there is any alterations or changes needed to original order, a period of 3 to 5 days will be added to agreed delivery date.',
  ],
};

/** Whatever is stored, filled out with the defaults for anything absent. */
function withDefaults(stored) {
  const b = stored && typeof stored === 'object' ? stored : {};
  const fraction = Number(b.depositFraction);
  return {
    ...DEFAULT_BUSINESS,
    ...b,
    // A deposit outside 0-100% is a typo, not an instruction.
    depositFraction: Number.isFinite(fraction) && fraction >= 0 && fraction <= 1
      ? fraction
      : DEFAULT_BUSINESS.depositFraction,
    terms: Array.isArray(b.terms) && b.terms.length ? b.terms : DEFAULT_BUSINESS.terms,
  };
}

module.exports = { DEFAULT_BUSINESS, withDefaults };
