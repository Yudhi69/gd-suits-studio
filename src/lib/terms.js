/**
 * GD Suits' order terms, transcribed from the order form clients sign.
 *
 * They live here rather than in the export template because they are the
 * agreement, not presentation - the 50% deposit rule in clause 5 is the same
 * rule the Business screen checks orders against.
 */
export const ORDER_TERMS = [
  'This GD Suits Order Form will be used as proof of order agreement between company and client.',
  'GD Suits will not accept any responsibility for inaccurate or wrong measurements supplied by client.',
  'GD Suits will not reimburse any deposit after order has been made by client.',
  "It is the client's responsibility to ensure the measurements supplied on GD Suits Order Form is accurate and correct.",
  'GD Suits will only start the tailor process once the 50% deposit is paid up front. This will need to be confirmed via client\'s "Proof of Payment".',
  'If there is any alterations or changes needed to original order, a period of 3 to 5 days will be added to agreed delivery date.',
];

/** The deposit clause, as a number the app can act on. */
export const DEPOSIT_FRACTION = 0.5;

export const GD_CONTACT = {
  name: 'Gareth Duncan',
  role: 'GD Suits Owner',
  phone: '0824856941',
  email: 'gareth@gdsuits.co.za',
};
