/**
 * The "Read me first" page that ships beside every installer.
 *
 * It is generated from docs/installing.md at release time, and the release
 * stops if the page would show raw markdown. So a wording change to the
 * install notes can fail a release long after it was merged - this runs the
 * same conversion before then, and pins the two things the Catalina steps
 * needed from the converter: the macOS warning quoted word for word, and a
 * bold menu name that runs onto the next line of a list item.
 */
const fs = require('fs');
const { build, toHtml, leftovers, SOURCE } = require('./make-install-note.js');

let pass = 0, fail = 0;
const log = (...a) => process.stdout.write(a.join(' ') + '\n');
const check = (ok, label, detail = '') => { ok ? (pass++, log('  ✓', label)) : (fail++, log('  ✗ FAIL:', label, detail)); };

log('=== the real install notes ===');
const page = build(fs.readFileSync(SOURCE, 'utf8'));
check(leftovers(page).length === 0, 'convert with nothing left as raw markdown', leftovers(page).join(' '));
check(page.includes('<blockquote><p>"GD Suits Studio" can\'t be opened because Apple cannot check it for malicious software.'),
  'and quote the Catalina warning as it appears on his screen');
check(/<li><strong>macOS Catalina, Big Sur or Monterey<\/strong>[^<]*<strong>System Preferences<\/strong>/.test(page),
  'with the Catalina menu names in bold, though they wrap onto a second line');

log('\n=== each piece of the converter ===');
let html = toHtml('- **System\n  Preferences** then **Security**');
check(html === '<ul>\n<li><strong>System Preferences</strong> then <strong>Security</strong></li>\n</ul>',
  'bold that runs onto a list item\'s next line stays bold', html);

html = toHtml('> one line\n> and the next\n\nAfter.');
check(html === '<blockquote><p>one line and the next</p></blockquote>\n<p>After.</p>',
  'a quote of several lines is one quote', html);

html = toHtml('1. First\n   carried on\n2. Second');
check(html === '<ol>\n<li>First carried on</li>\n<li>Second</li>\n</ol>', 'numbered steps still number', html);

check(toHtml('> <script>x</script>').includes('&lt;script&gt;'), 'a quote is escaped like everything else');

log('\n=== and the check that guards the release ===');
check(leftovers('<p>**unclosed</p>').length === 1, 'catches bold the converter missed');
check(leftovers('<p>&gt; a quote it did not know</p>').length === 1, 'and a quote it did not recognise');
check(leftovers('<p>a &gt; b</p>').length === 0, 'but not a greater-than sign in a sentence');

log(`\n${fail === 0 ? 'ALL INSTALL NOTE CHECKS PASSED' : 'FAILED'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
