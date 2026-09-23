'use strict';

/**
 * Turns docs/installing.md into the page that ships beside the installers.
 *
 *   node scripts/make-install-note.js [outputPath]
 *
 * A .md file in a zip is a developer's habit. Double-clicked on a Mac it opens
 * in TextEdit with every asterisk showing, and on Windows it may not open at
 * all - which is a poor first impression from an app whose whole argument is
 * that it was made for one tailor. An .html file double-clicks into his
 * browser and looks like something.
 *
 * Generated rather than hand-written so the page cannot drift from the notes
 * in the repository: there is one source, and this is a rendering of it.
 *
 * The converter handles exactly what that file uses - headings, paragraphs,
 * bold, emphasis, inline code, tables, ordered and unordered lists, and rules.
 * It is not a markdown parser and is not trying to be; anything it does not
 * recognise would come out as plain text, which the check at the end catches.
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', 'docs', 'installing.md');

/** Everything that reaches the page is escaped first, then marked up. */
const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Inline markup, applied after escaping so a stray `<` cannot become a tag. */
function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/ --- /g, ' &mdash; ')
    .replace(/ -- /g, ' &ndash; ');
}

const isTableRow = (line) => /^\|.*\|\s*$/.test(line);
const isDivider = (line) => /^\|[\s:|-]+\|\s*$/.test(line);
const cells = (line) => line.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim());

function toHtml(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const flush = () => { flushParagraph(); flushList(); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line.trim()) { flush(); continue; }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^---+\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }

    if (isTableRow(line)) {
      flush();
      const head = cells(line);
      const rows = [];
      let j = i + 1;
      if (j < lines.length && isDivider(lines[j])) j++;
      while (j < lines.length && isTableRow(lines[j])) rows.push(cells(lines[j++]));
      i = j - 1;
      out.push('<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>');
      for (const row of rows) out.push('<tr>' + row.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>');
      out.push('</tbody></table>');
      continue;
    }

    const ordered = /^(\d+)\.\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (ordered || bullet) {
      flushParagraph();
      const want = ordered ? 'ol' : 'ul';
      if (list !== want) { flushList(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${inline((ordered ? ordered[2] : bullet[1]))}</li>`);
      continue;
    }

    // A continuation line of a list item, indented under it.
    if (list && /^\s{2,}\S/.test(line)) {
      const last = out.pop();
      out.push(last.replace(/<\/li>$/, ` ${inline(line.trim())}</li>`));
      continue;
    }

    paragraph.push(line.trim());
  }
  flush();
  return out.join('\n');
}

const STYLE = `
  :root { color-scheme: light; }
  body { margin: 0; background: #f4f2ee; color: #14120f;
         font: 16px/1.65 'Iowan Old Style', Palatino, Georgia, serif; }
  main { max-width: 680px; margin: 0 auto; padding: 56px 28px 96px; }
  h1 { font-size: 34px; line-height: 1.15; margin: 0 0 8px; letter-spacing: .2px; }
  h2 { font-size: 22px; margin: 44px 0 10px; }
  h3 { font-size: 17px; margin: 28px 0 6px; }
  p { margin: 0 0 14px; }
  hr { border: 0; border-top: 1px solid #e2ded5; margin: 36px 0; }
  code { font: 13.5px ui-monospace, SFMono-Regular, Menlo, monospace;
         background: #ebe8e1; padding: 1px 5px; border-radius: 4px; }
  strong { font-weight: 700; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 18px; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #e2ded5; vertical-align: top; }
  th { font-size: 13px; text-transform: uppercase; letter-spacing: 1.4px; color: #5d574c; }
  ol, ul { margin: 0 0 16px; padding-left: 22px; }
  li { margin: 0 0 7px; }
  .mark { display: flex; align-items: baseline; gap: 12px; margin-bottom: 30px;
          font-size: 13px; letter-spacing: 3px; text-transform: uppercase; color: #8a6d14; }
  @media print { body { background: #fff; } main { padding: 0; } }
`;

function build(markdown) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Installing GD Suits Studio</title>
<style>${STYLE}</style></head>
<body><main>
<div class="mark">GD Suits</div>
${toHtml(markdown)}
</main></body></html>`;
}

if (require.main === module) {
  const out = process.argv[2] ?? path.join(__dirname, '..', 'release', 'Read me first.html');
  const html = build(fs.readFileSync(SOURCE, 'utf8'));

  // Anything the converter did not understand would be sitting in the page as
  // literal markdown. Cheaper to notice here than in the tailor's browser.
  const leftovers = html.replace(/<[^>]+>/g, '').match(/\*\*|^#{1,4}\s|\|\s*-{3,}/gm);
  if (leftovers) {
    console.error(`unconverted markdown left on the page: ${[...new Set(leftovers)].join(' ')}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`wrote ${path.relative(process.cwd(), out)}  ${(html.length / 1024).toFixed(1)} kB`);
}

module.exports = { build, toHtml, inline };
