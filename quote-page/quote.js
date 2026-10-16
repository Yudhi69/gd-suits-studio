/*
 * The informal quote page.
 *
 * GD Suits Studio sends a client a link to this page with the summary of their
 * order inside the link, after "#q=". A browser never sends that part to the
 * server, so this page is a static file with nothing behind it: it stores
 * nothing, asks nothing of any server, and anyone hosting it sees no orders.
 *
 * Anyone can make a link, so everything read from it is treated as text -
 * never as markup - and checked for shape before it is shown. The figures are
 * informal; the formal quote is drawn up in the app from its own records, so a
 * link that has been tampered with changes nothing but what this page says.
 */
(function () {
  'use strict';

  var root = document.getElementById('quote');

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function decode(hash) {
    var match = /(?:^#|&)q=([A-Za-z0-9_-]+)/.exec(hash || '');
    if (!match) return null;
    try {
      var b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
      b64 += '==='.slice((b64.length + 3) % 4);
      var binary = atob(b64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      return null;
    }
  }

  var isText = function (v) { return typeof v === 'string' && v.length <= 400; };
  var isMoney = function (v) { return typeof v === 'number' && isFinite(v) && Math.abs(v) < 1e9; };

  function valid(q) {
    if (!q || q.v !== 1 || !Array.isArray(q.s) || q.s.length < 1 || q.s.length > 40) return false;
    if (!isMoney(q.tot) || !q.shop || !isText(q.shop.n)) return false;
    return q.s.every(function (s) {
      return s && Array.isArray(s.i) && Array.isArray(s.l) && s.i.length <= 60 && s.l.length <= 80 &&
        s.i.every(function (r) { return Array.isArray(r) && isText(r[0]) && isText(r[1]); }) &&
        s.l.every(function (r) { return Array.isArray(r) && isText(r[0]) && isMoney(r[1]); });
    });
  }

  function money(n) {
    return 'R' + Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function day(value) {
    if (!isText(value) || !/^\d{4}-\d{2}-\d{2}/.test(value)) return '';
    var d = new Date(value.slice(0, 10) + 'T12:00:00Z');
    return isNaN(d) ? '' : d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  /** The shop's number as WhatsApp wants it: country code and digits only. */
  function whatsapp(raw, cc) {
    var text = String(raw || '').trim();
    var code = /^\d{1,3}$/.test(String(cc || '')) ? String(cc) : '27';
    var digits = text.charAt(0) === '+' ? text.slice(1).replace(/\D/g, '') : text.replace(/\D/g, '');
    if (text.charAt(0) !== '+') {
      if (digits.indexOf('00') === 0) digits = digits.slice(2);
      else if (digits.charAt(0) === '0') digits = code + digits.slice(1);
    }
    return /^\d{8,15}$/.test(digits) ? digits : '';
  }

  function action(label, href, primary) {
    var a = el('a', primary ? 'action primary' : 'action', label);
    a.href = href;
    a.rel = 'noopener noreferrer';
    return a;
  }

  function broken() {
    root.textContent = '';
    root.appendChild(el('h1', null, 'This link is incomplete'));
    root.appendChild(el('p', 'muted', 'Part of the link seems to be missing. Ask GD Suits to send it again.'));
  }

  function render(q) {
    root.textContent = '';
    var multi = q.s.length > 1;

    var head = el('section', 'head');
    head.appendChild(el('p', 'eyebrow', 'Informal quote' + (isText(q.ref) && q.ref ? ' · ' + q.ref : '')));
    head.appendChild(el('h1', null, isText(q.to) && q.to ? 'For ' + q.to : 'Your quote'));
    var occasion = [isText(q.ev) ? q.ev : '', day(q.evd)].filter(Boolean).join(' · ');
    if (isText(q.who) && q.who && q.who !== q.to) occasion = q.who + (occasion ? ' · ' + occasion : '');
    if (occasion) head.appendChild(el('p', 'occasion', occasion));
    root.appendChild(head);

    q.s.forEach(function (suit) {
      var card = el('section', 'card');
      if (multi && isText(suit.t) && suit.t) card.appendChild(el('h2', null, suit.t));
      if (suit.i.length) {
        card.appendChild(el('h3', null, "What's included"));
        var dl = el('dl', 'spec');
        suit.i.forEach(function (row) {
          var line = el('div', 'spec-row');
          line.appendChild(el('dt', null, row[0]));
          line.appendChild(el('dd', null, row[1]));
          dl.appendChild(line);
        });
        card.appendChild(dl);
      }
      if (suit.l.length) {
        card.appendChild(el('h3', null, 'Price'));
        var list = el('div', 'lines');
        suit.l.forEach(function (row) {
          var line = el('div', 'line');
          line.appendChild(el('span', null, row[0]));
          line.appendChild(el('span', 'amount', money(row[1])));
          list.appendChild(line);
        });
        if (multi && isMoney(suit.st)) {
          var sub = el('div', 'line subtotal');
          sub.appendChild(el('span', null, 'Subtotal'));
          sub.appendChild(el('span', 'amount', money(suit.st)));
          list.appendChild(sub);
        }
        card.appendChild(list);
      }
      root.appendChild(card);
    });

    var total = el('section', 'card total-card');
    var line = el('div', 'line total');
    line.appendChild(el('span', null, 'Total'));
    line.appendChild(el('span', 'amount', money(q.tot)));
    total.appendChild(line);
    if (isMoney(q.dep) && q.depPct) {
      var dep = el('div', 'line deposit');
      dep.appendChild(el('span', null, 'Deposit to start (' + Number(q.depPct) + '%)'));
      dep.appendChild(el('span', 'amount', money(q.dep)));
      total.appendChild(dep);
    }
    var until = day(q.until);
    total.appendChild(el('p', 'muted small',
      'This is an informal quote' + (until ? ', valid until ' + until : '') +
      '. Confirm it, or tell us what you would like changed, and we will send you the formal quote.'));
    root.appendChild(total);

    var actions = el('section', 'actions');
    var ref = isText(q.ref) && q.ref ? ' ' + q.ref : '';
    var number = whatsapp(q.shop.p, q.shop.cc);
    if (number) {
      actions.appendChild(action('Confirm on WhatsApp',
        'https://wa.me/' + number + '?text=' + encodeURIComponent('Hi, I confirm the informal quote' + ref + ' (' + money(q.tot) + ').'), true));
      actions.appendChild(action('Ask for changes',
        'https://wa.me/' + number + '?text=' + encodeURIComponent('Hi, about the informal quote' + ref + ' - I would like to change: ')));
    }
    if (isText(q.shop.e) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.shop.e)) {
      actions.appendChild(action('Reply by email',
        'mailto:' + encodeURIComponent(q.shop.e) + '?subject=' + encodeURIComponent('Informal quote' + ref) +
        '&body=' + encodeURIComponent('Hi,\n\nAbout the informal quote' + ref + ' (' + money(q.tot) + '):\n\n')));
    }
    root.appendChild(actions);

    var foot = el('footer', 'foot');
    foot.appendChild(el('span', null, q.shop.n));
    if (isText(q.shop.p) && q.shop.p) foot.appendChild(el('span', null, q.shop.p));
    if (isText(q.shop.e) && q.shop.e) foot.appendChild(el('span', null, q.shop.e));
    root.appendChild(foot);

    document.title = 'Informal quote' + ref + ' - ' + q.shop.n;
  }

  function show() {
    var q = decode(window.location.hash);
    if (valid(q)) render(q);
    else broken();
  }

  window.addEventListener('hashchange', show);
  show();
})();
