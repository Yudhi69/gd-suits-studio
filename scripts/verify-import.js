const APP = process.env.HOME + '/Library/Application Support/GD Suits Studio';
const raw = require('better-sqlite3')(APP + '/data/gdsuits.db', { readonly: true });
const one = (s) => raw.prepare(s).get();
const all = (s) => raw.prepare(s).all();
const R = (n) => 'R' + Math.round(n).toLocaleString();

console.log('clients', one('SELECT COUNT(*) n FROM clients').n,
            ' orders', one('SELECT COUNT(*) n FROM projects').n,
            ' payments', one('SELECT COUNT(*) n FROM payments').n);

console.log('\nthe record that was already there is untouched:');
all(`SELECT c.name, c.surname, p.title,
       (SELECT COUNT(*) FROM photos WHERE client_id = c.id) ph,
       (SELECT COUNT(*) FROM notes  WHERE client_id = c.id) nt
     FROM clients c LEFT JOIN projects p ON p.client_id = c.id
     WHERE p.import_source = '' OR p.import_source IS NULL`)
  .forEach((r) => console.log(`    ${r.name} ${r.surname} | ${r.title} | ${r.ph} photos, ${r.nt} notes`));

console.log('\nby stage:');
all(`SELECT status, COUNT(*) n FROM projects GROUP BY status ORDER BY n DESC`)
  .forEach((r) => console.log('   ' + r.status.padEnd(15), String(r.n).padStart(4)));

console.log('\ncloth that actually sells:');
all(`SELECT fabric_name v, COUNT(*) n FROM projects WHERE fabric_name <> '' GROUP BY v ORDER BY n DESC LIMIT 8`)
  .forEach((r) => console.log('   ' + String(r.n).padStart(4), r.v));

console.log('\norders by event year:');
all(`SELECT substr(event_date,1,4) y, COUNT(*) n FROM projects WHERE event_date <> '' GROUP BY y ORDER BY y`)
  .forEach((r) => console.log('   ' + r.y, String(r.n).padStart(4)));

const bal = (w) => one(`SELECT COALESCE(SUM(imported_balance),0) t FROM projects ${w}`).t;
console.log('\nmoney:');
console.log('   legacy balance, all rows   ', R(bal('')));
console.log('     on delivered orders      ', R(bal("WHERE status = 'delivered'")), ' (historical - recorded at order time)');
console.log('     on open orders           ', R(bal("WHERE status <> 'delivered'")), ' (may still be owed)');
console.log('   payments recorded          ', R(one('SELECT COALESCE(SUM(amount),0) t FROM payments').t));

console.log('\nwhat came across per order:');
const pct = (n) => (100 * n / 772).toFixed(0) + '%';
for (const [label, col] of [['measurement form link', 'form_url'], ['design', 'design'], ['lining', 'lining'],
                            ['shirt', 'shirt'], ['measured-on date', 'consultation_date'],
                            ['first fitting date', 'first_fitting_date'], ['final fitting date', 'final_fitting_date']]) {
  const n = one(`SELECT COUNT(*) n FROM projects WHERE ${col} <> ''`).n;
  console.log('   ' + label.padEnd(24), String(n).padStart(4), pct(n));
}

console.log('\nrepeat clients (more than one order):');
all(`SELECT c.name, c.surname, COUNT(*) n FROM projects p JOIN clients c ON c.id = p.client_id
     GROUP BY c.id HAVING n > 1 ORDER BY n DESC LIMIT 5`)
  .forEach((r) => console.log('   ' + String(r.n).padStart(2), r.name, r.surname));
