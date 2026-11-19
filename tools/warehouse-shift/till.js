/* Warehouse Shift: the till. Shared by the page (tillui.js, game.js), the tests and
   .github/warehouse-shift/make-requests.mjs.

   Till customers (detailedfoil, 19 Nov 2026): a customer comes to the trade counter and orders at the till, Fusion
   (the store's till system). They give their postcode, then their surname; you search, pick them from the results,
   then they ask for what they want one thing at a time: by product code, by describing it, or by quoting the
   product's description from the website ("I need the one that says ..."). You find it on the CrashFix tab (the
   Product Search page's own search), add it to the basket on the Fusion tab, and the customer says whether it's
   right. Any product that fits counts (data/requests.json lists them). Then they pay by card or cash and the pick
   list goes to the scanner.

   Everything here is made up: the customers (names, addresses, emails, customer numbers), the postcodes (LU8 and
   LU9 don't exist; real LU postcodes stop at LU7), the prices and the stock levels. Nothing is anyone's real data.
   The product codes, names and descriptions are the public ones Product Search already shows. */
(function (root) {
  'use strict';

  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function pick(r, list) { return list[Math.floor(r() * list.length)]; }

  /* ---------- CrashFix: the product list, built the way the Product Search page builds it ---------- */
  // list = product-search/data/products.json, web = data/web-names.json, dwords = data/desc-words.json. The same
  // items product-search/app.js gives ProductSearch.build(), so a search on the till finds what the real page finds.
  function searchItems(list, web, dwords) {
    var names = (web && web.products) || {}, dw = (dwords && dwords.products) || {};
    return ((list && list.items) || []).map(function (r) {
      var p = names[r[0]] || {}, w = p.name || '';
      if (w && /^(?:url source|title|markdown content|warning)\s*:/i.test(w)) w = '';   // a bad read, waiting to be read again
      var flags = ((r[2] || 0) & 16) | (((r[2] || 0) & 32) && p.a && p.an ? 16 : 0);
      return { sku: r[0], name: r[1], flags: flags, web: w, desc: p.d, photo: !!p.p, dw: dw[r[0]] || '' };
    });
  }

  /* ---------- made-up customers ---------- */
  var MEN = ['Dave', 'Gary', 'Steve', 'Mark', 'Paul', 'Lee', 'Craig', 'Darren', 'Jason', 'Tom', 'Ryan', 'Liam', 'Dan', 'Rob', 'Kevin',
    'Neil', 'Wayne', 'Shaun', 'Matt', 'Chris', 'Adam', 'Jamie', 'Ben', 'Sam', 'Marek', 'Tomasz', 'Raj', 'Imran', 'Kwame', 'Femi',
    'Callum', 'Josh', 'Connor', 'Aaron', 'Ian', 'Phil', 'Terry', 'Colin', 'Barry', 'Nathan', 'Gavin', 'Stuart', 'Owen', 'Kieran'];
  var WOMEN = ['Sarah', 'Claire', 'Emma', 'Lisa', 'Kelly', 'Nicola', 'Gemma', 'Hannah', 'Laura', 'Jo', 'Amy', 'Becky', 'Sophie',
    'Priya', 'Anna', 'Zoe', 'Kirsty', 'Louise', 'Rachel', 'Helen', 'Donna', 'Tracey', 'Jade', 'Chloe', 'Aisha', 'Megan', 'Joanne'];
  var SURNAMES = ['Kowalski', 'Patel', 'Murphy', 'Hughes', 'Walsh', 'Bennett', 'Carter', 'Dixon', 'Fletcher', 'Gibbs', 'Harding',
    'Ingram', 'Jarvis', 'Kemp', 'Lloyd', 'Mason', 'Norris', 'Owens', 'Palmer', 'Quinn', 'Reeves', 'Sharma', 'Tucker', 'Vaughan',
    'Webb', 'Yates', 'Ahmed', 'Begum', 'Clarke', 'Doyle', 'Ellis', 'Foster', 'Grant', 'Hart', 'Iqbal', 'Jenkins', 'Khan', 'Lowe',
    'Marsh', 'Nowak', 'Okafor', 'Pearce', 'Rowe', 'Stone', 'Turner', 'Vincent', 'Wood', 'Barker', 'Chapman', 'Dawson',
    'Farrell', 'Gordon', 'Holt', 'Irwin', 'Jordan', 'Knight', 'Lambert', 'Moss', 'Nash', 'Oliver', 'Parry', 'Riley', 'Sutton',
    'Thorpe', 'Walker', 'Wright', 'Young', 'Adeyemi', 'Brennan', 'Cooper', 'Dunn', 'Evans', 'Fox', 'Garner', 'Hayes', 'Hussain',
    'Mensah', 'Baxter', 'Cartwright', 'Doherty', 'Fenwick', 'Goddard', 'Hollis', 'Lister', 'Mackay', 'Pritchard', 'Rahman'];
  var STREETS = ['Elm Close', 'Station Road', 'Church Lane', 'Mill Way', 'Park Avenue', 'Oak Drive', 'Victoria Street', 'Meadow View',
    'Kingsway', 'Brook Lane', 'Orchard Road', 'The Green', 'Willow Court', 'Chiltern Rise', 'Beech Grove', 'Albion Road',
    'Manor Farm Close', 'Priory Walk', 'Ash Tree Way', 'Foxglove Drive', 'Canal Side', 'Hawthorn Road', 'Bridle Path', 'Coopers Yard'];
  var TRADES = [['Plumber', 'Plumbing & Heating'], ['Electrician', 'Electrical'], ['Builder', 'Building Services'], ['Carpenter', 'Joinery'],
    ['Decorator', 'Decorators'], ['Gas Engineer', 'Gas Services'], ['Landscaper', 'Landscapes'], ['Roofer', 'Roofing'],
    ['Handyman', 'Property Maintenance'], ['Kitchen Fitter', 'Kitchens'], ['Other Trade', 'Services'], ['DIY', '']];
  var UNIT = 'ABDEFGHJLNPQRSTUWXYZ';     // the letters a real postcode's last two can be

  // LU8 and LU9 don't exist (the LU area stops at LU7), so these can never be a real address
  function postcode(r) { return 'LU' + (r() < 0.5 ? 8 : 9) + ' ' + (1 + Math.floor(r() * 9)) + UNIT[Math.floor(r() * UNIT.length)] + UNIT[Math.floor(r() * UNIT.length)]; }
  function customerNo(r) { var s = String(1 + Math.floor(r() * 9)); for (var i = 0; i < 7; i++) s += Math.floor(r() * 10); return s; }
  function person(r, surname, female) {
    var woman = female === undefined ? r() < 0.3 : female, first = pick(r, woman ? WOMEN : MEN);
    var title = woman ? pick(r, ['Mrs', 'Mrs', 'Ms', 'Miss']) : (r() < 0.04 ? 'Dr' : 'Mr');
    var mail = ['example.com', 'example.net', 'example.org'][Math.floor(r() * 3)];
    var email = (r() < 0.5 ? first.toLowerCase() + '.' + surname.toLowerCase() : first[0].toLowerCase() + surname.toLowerCase()) + (r() < 0.55 ? Math.floor(10 + r() * 89) : '') + '@' + mail;
    return { title: title, first: first, surname: surname, email: email, no: customerNo(r) };
  }
  function address(r) { return r() < 0.22 ? 'Flat ' + (1 + Math.floor(r() * 12)) + ', ' + pick(r, STREETS) : (1 + Math.floor(r() * 140)) + ' ' + pick(r, STREETS); }

  // the customer and the other people a search might turn up: maybe someone at the same address with the same
  // surname (then the customer says their first name), others with the surname elsewhere, neighbours
  function makeCustomer(r) {
    var surname = pick(r, SURNAMES), c = person(r, surname), trade = pick(r, TRADES);
    c.postcode = postcode(r); c.address = address(r); c.trade = trade[0];
    c.org = trade[1] && r() < 0.6 ? (r() < 0.5 ? surname + ' ' + trade[1] : c.first[0] + surname[0] + ' ' + trade[1]) : '';
    c.me = true;
    var db = [c];
    if (r() < 0.32) { // someone else at the same address
      var f = person(r, surname, !/^(Mrs|Ms|Miss)$/.test(c.title));
      while (f.first === c.first) f = person(r, surname, !/^(Mrs|Ms|Miss)$/.test(c.title));
      f.postcode = c.postcode; f.address = c.address; f.trade = 'DIY'; f.org = ''; db.push(f); c.twin = true;
    }
    var n = 2 + Math.floor(r() * 4);
    for (var i = 0; i < n; i++) { // the same surname, somewhere else
      var o = person(r, surname); o.postcode = postcode(r); o.address = address(r); o.trade = pick(r, TRADES)[0]; o.org = ''; db.push(o);
    }
    var m = 1 + Math.floor(r() * 3);
    for (var j = 0; j < m; j++) { // neighbours
      var nb = person(r, pick(r, SURNAMES.filter(function (s) { return s !== surname; }))); nb.postcode = c.postcode; nb.address = address(r); nb.trade = 'DIY'; nb.org = ''; db.push(nb);
    }
    c.db = db;
    return c;
  }

  // the Identify Customer search: every box filled in has to match (surname and first name from the start, the
  // whole postcode with or without its space, any part of an email or organisation). Old order refs aren't kept.
  function low(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function pcode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function matches(c, q) {
    var any = false;
    if (low(q.no)) { any = true; if (c.no !== String(q.no).replace(/\D/g, '')) return false; }
    if (low(q.surname)) { any = true; if (low(c.surname).indexOf(low(q.surname)) !== 0) return false; }
    if (low(q.first)) { any = true; if (low(c.first).indexOf(low(q.first)) !== 0) return false; }
    if (low(q.postcode)) { any = true; if (pcode(c.postcode) !== pcode(q.postcode)) return false; }
    if (low(q.email)) { any = true; if (low(c.email).indexOf(low(q.email)) < 0) return false; }
    if (low(q.org)) { any = true; if (!c.org || low(c.org).indexOf(low(q.org)) < 0) return false; }
    if (low(q.ref)) return false;
    return any;
  }
  function lookup(customer, q) {
    return (customer ? customer.db : []).filter(function (c) { return matches(c, q); })
      .sort(function (a, b) { return a.surname.localeCompare(b.surname) || a.first.localeCompare(b.first) || a.postcode.localeCompare(b.postcode); });
  }

  /* ---------- money and stock (made up, the same on every phone) ---------- */
  // pence, VAT included, from the product's code and size: small parts a pound or two to twenty, boxed things up to
  // seventy, bulky things and power tools more
  function price(it) {
    var code = it.code || it.sku || String(it), u = hash(code + 'price') / 4294967296, lo = 2.99, hi = 69.99;
    if (it.size === 'T') { lo = 0.79; hi = 19.99; } else if (it.size === 'B') { lo = 9.99; hi = 189.99; }
    if (it.group === 'powertools') { lo = 39.99; hi = 279.99; }
    if (it.group === 'backbox') { lo = 0.49; hi = 2.99; }
    var v = Math.exp(Math.log(lo) + u * (Math.log(hi) - Math.log(lo)));
    var ends = [0.99, 0.99, 0.49, 0.29, 0.79, 0.99];
    return Math.max(29, Math.round((Math.floor(v) + ends[hash(code + 'ends') % ends.length]) * 100));
  }
  function avail(it) {
    var code = it.code || it.sku || String(it), h = hash(code + 'stock');
    if (it.group === 'backbox') return 60 + h % 240;
    return it.size === 'T' ? 8 + h % 70 : it.size === 'B' ? 2 + h % 9 : 3 + h % 26;
  }
  // VAT is 20% and included: £7.99 is £6.66 + £1.33 VAT, as on the real checkout
  function vat(inc) { var ex = Math.round(inc / 1.2); return { inc: inc, ex: ex, vat: inc - ex }; }
  function money(p) { return '£' + (p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  // what a customer paying cash hands over: the next note up, or enough twenties and fifties
  function tender(inc) {
    var notes = [500, 1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 15000, 20000, 25000, 30000, 40000, 50000];
    for (var i = 0; i < notes.length; i++) if (notes[i] >= inc) return notes[i];
    return Math.ceil(inc / 5000) * 5000;
  }
  function orderNumber(r) { var s = 'A2'; for (var i = 0; i < 10; i++) s += Math.floor(r() * 10); return s; }

  /* ---------- what they ask for ---------- */
  // requests = data/requests.json: describe [code, what they call it, ...other codes that fit], need [code, a
  // sentence from its description, a hint like the size (or ''), ...other codes that fit]. Codes by themselves come
  // from anything on the shelves.
  var ASK_CODE = ['Can I get {c}?', 'Have you got {c} in stock?', 'I need {c}, please.', 'Product code {c}.', 'It\'s {c} off the website.', 'Can I order {c}?'];
  var ASK_DESC = ['Have you got {x}?', 'I\'m after {x}.', 'Can I get {x}, please?', 'Do you do {x}?', 'I need {x}.', 'Looking for {x}.'];
  var ASK_NEED = ['I need the one that says:', 'I saw it on your website. It says:', 'I\'m after something, the description says:', 'I need an item that... hang on, it says:', 'It\'s this one off the website:'];
  var ASK_QTY = ['I\'ll take {n}.', '{n} of them, please.', 'I need {n} of those.', 'Make it {n}.', 'Can I have {n}?'];
  var NEXT = ['Next one...', 'And...', 'Also...', 'What else... right.', 'And one more thing...'];

  // a till customer's order: 1 to 3 lines, each its own product, each asked for by code, description or need
  function makeOrder(world, requests, r, n) {
    var byCode = world.byCode || (world.byCode = (function () { var m = {}; world.items.forEach(function (it) { m[it.code] = it; }); return m; })());
    var placed = function (code) { return !!(byCode[code] && byCode[code].loc); };
    if (!n) { var u = r(); n = u < 0.45 ? 1 : u < 0.8 ? 2 : 3; }
    var lines = [], used = {}, guard = 0;
    var desc = (requests && requests.describe) || [], need = (requests && requests.need) || [];
    while (lines.length < n && guard++ < 400) {
      var k = r(), kind = k < 0.3 || (!desc.length && !need.length) ? 'code' : k < 0.65 && desc.length ? 'describe' : need.length ? 'need' : 'describe';
      var it, accept, words = [], quote = '', hint = '', clue = '';
      if (kind === 'code') {
        it = world.items[Math.floor(r() * world.items.length)];
        accept = [it.code];
      } else {
        var e = kind === 'describe' ? desc[Math.floor(r() * desc.length)] : need[Math.floor(r() * need.length)];
        it = byCode[e[0]];
        accept = kind === 'describe' ? e.slice(2) : e.slice(3);
        accept = [e[0]].concat(accept);
        if (kind === 'describe') words = [e[1]]; else { quote = e[1]; hint = e[2] || ''; }
      }
      if (!it || !placed(it.code) || used[it.code]) continue;
      accept = accept.filter(placed);
      if (accept.some(function (c) { return used[c]; })) continue;
      accept.forEach(function (c) { used[c] = 1; });
      var qty = Math.max(1, Math.min(10, quantity(it, r)));
      qty = Math.min(qty, avail(it));
      var say;
      if (kind === 'code') say = pick(r, ASK_CODE).replace('{c}', it.code);
      else if (kind === 'describe') say = pick(r, ASK_DESC).replace('{x}', words[0]);
      else say = pick(r, ASK_NEED);
      clue = kind === 'code' ? 'That\'s ' + it.code.split('').join(' ') + '.' : 'I think the code starts with ' + it.code.slice(0, 3) + '.';
      lines.push({ kind: kind, item: it, qty: qty, accept: accept, say: say, quote: quote, hint: hint, clue: clue,
        qtySay: qty > 1 ? pick(r, ASK_QTY).replace('{n}', qty) : '', next: lines.length ? pick(r, NEXT) : '' });
    }
    return lines;
  }
  // how many a till customer wants: mostly one or two, back boxes by the five or ten
  function quantity(it, r) {
    var u = r();
    if (it.group === 'backbox') return [5, 10, 10, 6][Math.floor(u * 4)];
    if (it.size === 'T') return u < 0.5 ? 1 : u < 0.75 ? 2 : u < 0.86 ? 3 : u < 0.94 ? 4 : 5;
    if (it.size === 'S') return u < 0.75 ? 1 : u < 0.94 ? 2 : 3;
    return u < 0.9 ? 1 : 2;
  }
  // a line added to the basket: is it what they asked for?
  function judge(line, code, qty) {
    if (!line || line.accept.indexOf(code) < 0) return 'wrong';
    return Number(qty) === line.qty ? 'right' : 'qty';
  }

  var api = { hash: hash, searchItems: searchItems, makeCustomer: makeCustomer, lookup: lookup, matches: matches, postcode: postcode,
    price: price, avail: avail, vat: vat, money: money, tender: tender, orderNumber: orderNumber, makeOrder: makeOrder, judge: judge,
    quantity: quantity, SURNAMES: SURNAMES, MEN: MEN, WOMEN: WOMEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShiftTill = api;
})(typeof window !== 'undefined' ? window : this);
