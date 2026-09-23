'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Points the app at an empty data folder, and empties it first.
 *
 * Every suite was reusing whatever the last run left behind. Most of the time
 * that is invisible, because a suite makes its own client and its own order.
 * It is not invisible when a suite changes something the app remembers: the
 * workflow suite switches the measurement unit to centimetres and checks that
 * the choice survives a reload - which it does, into the next run, where the
 * check that inches are the default then fails. The quote suite is worse: it
 * adds to the price list, so a second run prices the same order higher.
 *
 * Both passed on a clean machine and failed the second time, which is the
 * worst way for a test to be wrong - it fails for the one person who runs it
 * twice, and nothing in the failure says why.
 *
 * Called before `electron/main.js` is required, because that opens the
 * database on the path this sets.
 */
function freshUserData(app) {
  const dir = path.resolve(process.env.DATA_DIR ?? '.testdata/default');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  app.setPath('userData', dir);
  return dir;
}

module.exports = { freshUserData };
