'use strict';

/**
 * A made-up shop for the test suites: its price list and its details.
 *
 * The app ships no figures, terms or contact details - a shop types its own
 * in Settings, and they live only in its database. So a suite that checks
 * what an order costs, or what the order form says, first gives its fresh
 * database a shop to work from. Every figure, name and number here is
 * invented, and none is any real shop's.
 *
 * The list prices what a shop would usually price - every suit in five
 * qualities, luxury wool as a range, nine items sold on their own and the
 * options that cost extra - so the suites reach every kind of figure. Two
 * qualities (premium Italian and linen) are left off it, so a suite can
 * check a quality the shop has not priced.
 */

const SUITS = ['two_piece', 'three_piece', 'blazer_only', 'pants_only', 'waistcoat_only'];

/**
 * A row per quality, a figure per suit type, in SUITS order. Deliberately
 * low, so no one mistakes it for any shop's list.
 */
const GRID = {
  standard_wool: [2050, 2600, 1500, 610, 470],
  premium_wool: [2300, 2900, 1700, 680, 520],
  super_fine: [2700, 3300, 1950, 760, 590],
  italian: [3100, 3800, 2250, 845, 660],
  luxury: [3650, 4450, 2650, 985, 780],
  material_supplied: [1350, 1900, 1100, 430, 340],
};
/** Luxury wool is priced by the cloth: the bottom is above, the top here. */
const LUXURY_TOP = [5900, 7000, 4100, 1450, 1150];

/** Items sold on their own: a toggle or a text field with a flat fee. */
const ITEMS = {
  shirt: 380,
  coat: 1200,
  lapelChain: 95,
  lapelPin: 155,
  tiePin: 65,
  cufflinks: 170,
  cufflinkSet: 145,
  express: 450,
  thirdPocket: 85,
};

/** Options that cost extra. Any option not here costs nothing. */
const OPTIONS = {
  'neckwearType:tie': 5,
  'neckwearType:bow': 55,
  'lapel:peak': 115,
  'lapel:shawl': 125,
  'lapelWidth:custom': 30,
  'tuxedoFinish:satin': 210,
  'breast:double': 190,
  'buttonColour:gold': 25,
  'buttonColour:silver': 20,
  'buttonColour:custom': 105,
  'pockets:patch': 205,
  'pockets:slanted': 110,
  'vents:double': 225,
  'liningMode:vinyl': 160,
  'liningMode:pattern': 175,
  'customLiningScope:jacket_waistcoat': 130,
  'wcBreast:double': 135,
  'wcLapel:lapel': 325,
  'wcPockets:standard': 15,
  'pleats:single': 10,
  'pleats:double': 75,
  'waistbandJoin:double_button': 235,
  'waistbandExtras:side_adjusters': 70,
  'waistbandExtras:elastic_band': 50,
  'hem:turn_up': 45,
  'shirtCollar:cutaway': 35,
  'shirtCollar:wing': 40,
  'shirtCuff:french': 245,
  'shirtButtonColour:metallic': 185,
  'shirtButtonColour:covered': 165,
  'shirtButtonColour:metallic_silver': 195,
  'shirtButtonColour:metallic_gold': 215,
  'shirtChest:pleated': 290,
};

const gridKey = (suit, quality) => `suitType:${suit}@${quality}`;

/** The list as the shop's database holds it: `{ prices, upTo }`. */
function examplePriceList() {
  const prices = { ...ITEMS, ...OPTIONS };
  const upTo = {};
  for (const [quality, row] of Object.entries(GRID)) {
    SUITS.forEach((suit, i) => { prices[gridKey(suit, quality)] = row[i]; });
  }
  SUITS.forEach((suit, i) => { upTo[gridKey(suit, 'luxury')] = LUXURY_TOP[i]; });
  return { prices, upTo };
}

/** The suit's figure in a quality, and the top of its range if it has one. */
const suitFigure = (suit, quality) => GRID[quality]?.[SUITS.indexOf(suit)] ?? null;
const suitTop = (suit, quality) => (quality === 'luxury' ? LUXURY_TOP[SUITS.indexOf(suit)] : null);

const EXAMPLE_BUSINESS = {
  businessName: 'GD Suits',
  name: 'Quinn Taylor',
  role: 'Owner',
  phone: '021 555 0100',
  email: 'shop@example.com',
  depositFraction: 0.5,
  whatsappCountryCode: '27',
  informalValidDays: 14,
  terms: [
    'Half of the total is paid before the cloth is cut.',
    'The rest is paid at the last fitting, before the suit goes home.',
    'Fittings are booked with the shop and moved with a day’s notice.',
  ],
};

/**
 * Gives the fresh database at `dir` the example shop, before the app opens
 * it - the app never writes a price list itself, so this is the only way one
 * gets there in a suite. Pass `{ priceList: null }` or `{ business: null }`
 * to leave either out.
 */
function seedExampleShop(dir, { priceList = examplePriceList(), business = EXAMPLE_BUSINESS } = {}) {
  const db = require('../../electron/db.js');
  const conn = db.open(dir);
  try {
    if (priceList) db.setSetting('priceList', priceList);
    if (business) db.setSetting('business', business);
  } finally {
    conn.close();
  }
}

module.exports = {
  SUITS, GRID, LUXURY_TOP, ITEMS, OPTIONS, EXAMPLE_BUSINESS,
  examplePriceList, seedExampleShop, suitFigure, suitTop,
};
