/* Product Search: the search itself. No network, no libraries: build() takes the product list once and
 * find() answers each keystroke from an index kept in memory (a few milliseconds for 10,000 products).
 *
 * What it copes with:
 *  - SKUs: whole or part ("843", "843p"), any case, letter O for zero (Screwfix codes never contain O),
 *    and one wrong or swapped character in a full 5 character code ("Did you mean").
 *  - Names: every word must match the start of a word in the name ("isol val" finds Isolating Valve),
 *    both the stock-system name and the screwfix.com name when the overnight check has found it.
 *  - Small spelling mistakes (one slip in a short word, two in a long one), only used when a word matches
 *    nothing as typed, so "tape" doesn't also find taps.
 *  - The way the stock names are written: 1.5 is stored as "1 5", "Pk10" / "10pk" / "pack of 10",
 *    "blk" for black, '2"' and "2in" for 2 inch, "15 mm" and "15mm", "P-Trap" and "ptrap" and "p trap".
 *  - A few trade words people use for the same thing (bulb / lamp, spanner / wrench, allen / hex...).
 */
(function (root) {
  'use strict';

  /* ---------- turning text into words ---------- */

  // abbreviations and spellings -> one way of writing them (used on the names and on what's typed)
  var SAME = {
    blk: 'black', bk: 'black', blck: 'black', wht: 'white', wh: 'white', wte: 'white', gry: 'grey', gray: 'grey',
    slv: 'silver', chr: 'chrome', chrm: 'chrome', galv: 'galvanised', galvanized: 'galvanised', galvanzied: 'galvanised',
    aluminum: 'aluminium', alu: 'aluminium', color: 'colour', colors: 'colour', csk: 'countersunk', cyl: 'cylinder',
    circ: 'circular', stl: 'steel', sq: 'square', ss: 'stainless', trd: 'trade', flx: 'flex', mag: 'magnetic',
    vis: 'visibility', pk: 'pack', pks: 'pack', pkt: 'pack', pc: 'piece', pcs: 'piece', pce: 'piece',
    pozidriv: 'pozi', pozidrive: 'pozi', pz: 'pozi', philips: 'phillips', ph: 'phillips',
    mtr: 'metre', mtrs: 'metre', meter: 'metre', meters: 'metre', metres: 'metre',
    knives: 'knife', lightbulb: 'light bulb', lightbulbs: 'light bulb', hd: 'heavy duty', wd40: 'wd 40',
    centre: 'center', organiser: 'organizer', '&': 'and'
  };
  // words people type that the names say differently: tried as well as the word typed (query only)
  var ALSO = {
    bulb: ['lamp'], lamp: ['bulb'], spanner: ['wrench'], wrench: ['spanner'], faucet: ['tap'], mastic: ['sealant'],
    caulk: ['sealant'], hoover: ['vacuum'], hoove: ['vacuum'], torch: ['flashlight'], flashlight: ['torch'],
    plasterboard: ['drywall'], drywall: ['plasterboard'], allen: ['hex'], jubilee: ['hose'], zip: ['cable'],
    gaffer: ['duct'], duct: ['gaffer'], loo: ['toilet', 'wc'], toilet: ['wc'], wc: ['toilet'], ladder: ['steps'],
    rawlplug: ['plug'], screwdriver: ['driver'], hacksaw: ['hack'], stanley: ['utility'], mole: ['locking'],
    sander: ['sanding'], aerosol: ['spray'], spray: ['aerosol'], hazard: ['hazardous'], paintbrush: ['brush'], extension: ['ext'], ext: ['extension']
  };
  var FLAG_WORDS = [[1, 'hazardous'], [2, 'aerosol'], [4, 'non trolleyable'], [8, 'sharp liquid'], [16, 'age restricted challenge 25 over 18']];
  var STOP = { x: 1, of: 1, and: 1, with: 1, for: 1, the: 1, to: 1, in: 1, on: 1, each: 1, a: 1 };
  var UNITS = 'mm|cm|m|km|kg|g|mg|ml|cl|l|ltr|litre|litres|v|w|kw|a|ah|mah|lm|k|kva|ft|m2|m3|psi|bar|nm|rpm|db|mtr|metre|metres|meter|meters';

  function stem(w) {
    if (w.length <= 3 || /\d/.test(w)) return w;
    if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (/(ch|sh|x|ss|z)es$/.test(w)) return w.slice(0, -2);
    if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
  }

  /* text -> list of words, in order (stop words kept as null so neighbours aren't joined across them) */
  function words(text) {
    var s = ' ' + String(text || '').toLowerCase()
      .replace(/[‘’′]/g, "'").replace(/[“”″]/g, '"').replace(/[–—]/g, '-') + ' ';
    s = s.replace(/&/g, ' and ')
      .replace(/(\d)\.(\d)/g, '$1 $2')                                   // 1.5 -> 1 5, the way the stock names write it
      .replace(/(\d+)\s*\/\s*(\d+)/g, '$1f$2')                          // 1/2 -> 1f2, so 1/2" isn't 2"
      .replace(/(\d)\s*x\s*(?=\d)/g, '$1 x ')                            // 100x50 -> 100 x 50
      .replace(/(\d)\s*(?:"|''|inch(?:es)?\b)/g, '$1inch ')               // 2" / 2 inch -> 2inch
      .replace(/(\d)in\b/g, '$1inch')                                     // 2in -> 2inch
      .replace(new RegExp('(\\d)\\s+(' + UNITS + ')\\b', 'g'), '$1$2')     // 15 mm -> 15mm
      .replace(/\bpk\s*(\d+)\b/g, 'pack $1').replace(/\b(\d+)\s*pk\b/g, '$1 pack')
      .replace(/\b(\d+)\s*pcs?\b/g, '$1 piece')
      .replace(/(\d)(?:mtrs?|metres?|meters?)\b/g, '$1m').replace(/(\d)(?:ltrs?|litres?)\b/g, '$1l');
    var out = [];
    (s.match(/[a-z0-9]+/g) || []).forEach(function (w) {
      var rep = SAME[w];
      (rep ? rep.split(' ') : [w]).forEach(function (x) {
        out.push(STOP[x] ? null : stem(x));
      });
    });
    return out;
  }

  /* ---------- spelling slips ---------- */

  // how many single-letter changes (add, drop, swap for another, swap two neighbours) turn a into b.
  // -> [whole word, best start of b] (the second for someone still typing); anything past max counts as max + 1
  var R0 = new Int32Array(64), R1 = new Int32Array(64), R2 = new Int32Array(64);
  function slips(a, b, max) {
    var la = a.length, lb = Math.min(b.length, la + max), big = max + 1;
    if (la > 60 || lb < la - max) return [big, big];
    var p2 = R0, p1 = R1, cur = R2, t;
    for (var j = 0; j <= lb; j++) p1[j] = j;
    for (var i = 1; i <= la; i++) {
      cur[0] = i;
      var best = i, ai = a.charCodeAt(i - 1);
      for (j = 1; j <= lb; j++) {
        var bj = b.charCodeAt(j - 1);
        var v = p1[j - 1] + (ai === bj ? 0 : 1);
        if (p1[j] + 1 < v) v = p1[j] + 1;
        if (cur[j - 1] + 1 < v) v = cur[j - 1] + 1;
        if (i > 1 && j > 1 && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === bj && p2[j - 2] + 1 < v) v = p2[j - 2] + 1;
        cur[j] = v;
        if (v < best) best = v;
      }
      if (best > max) return [big, big];
      t = p2; p2 = p1; p1 = cur; cur = t;
    }
    var whole = b.length <= lb ? Math.min(p1[b.length], big) : big, start = big;
    for (j = Math.max(1, la - max); j <= lb; j++) if (p1[j] < start) start = p1[j];
    return [whole, start];
  }
  function allowance(q) { return q.length >= 8 ? 2 : q.length >= 4 ? 1 : 0; }

  /* ---------- codes ---------- */

  var SKU_SHAPE = /^(\d{3}[A-Z]{2}|\d{4}[A-Z]|\d{5})$/;
  // what's typed -> a code (or part of one), or null if it can't be one
  function asCode(q) {
    var c = String(q || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0');
    return /^[0-9A-Z]{2,5}$/.test(c) && /\d/.test(c) ? c : null;
  }
  // codes one slip away: one character different, or two neighbours swapped
  function nearCode(a, b) {
    if (a.length !== b.length) return false;
    var diff = [];
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) { diff.push(i); if (diff.length > 2) return false; }
    if (diff.length === 1) return true;
    return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }

  /* ---------- the index ---------- */

  function lowerBound(arr, x) {
    var lo = 0, hi = arr.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /* items: [{sku, name, web?, flags}] -> searcher */
  function build(items) {
    var post = new Map();                       // word -> [item numbers]
    function add(w, n) {
      var list = post.get(w);
      if (!list) post.set(w, [n]);
      else if (list[list.length - 1] !== n) list.push(n);
    }
    items.forEach(function (it, n) {
      // the warnings count as words too, so "hazardous" or "aerosol paint" finds them
      var flagged = FLAG_WORDS.filter(function (f) { return it.flags & f[0]; }).map(function (f) { return f[1]; }).join(' ');
      [it.name, it.web, flagged].forEach(function (text) {
        if (!text) return;
        var ws = words(text);
        for (var i = 0; i < ws.length; i++) {
          if (!ws[i]) continue;
          add(ws[i], n);
          // neighbours joined too, so "light switch" finds "Lightswitch" and "ptrap" finds "P-Trap"
          if (ws[i + 1] && ws[i].length + ws[i + 1].length <= 16) add(ws[i] + ws[i + 1], n);
        }
      });
    });
    var vocab = Array.from(post.keys()).sort();
    var bySku = new Map();
    items.forEach(function (it, n) { bySku.set(it.sku, n); });
    var cache = new Map();

    /* one typed word -> Map(item -> score). fuzzy: also allow spelling slips */
    function matchWord(q, fuzzy) {
      var key = (fuzzy ? '~' : '') + q;
      if (cache.has(key)) return cache.get(key);
      var hits = new Map(), digits = /^\d+$/.test(q);
      function give(w, score) {
        var list = post.get(w);
        for (var k = 0; k < list.length; k++) if (!(hits.get(list[k]) >= score)) hits.set(list[k], score);
      }
      if (post.has(q)) give(q, 10);
      if (q.length >= 2 || digits) {
        // words that start with what's typed; for a number only its units (15 -> 15mm, not 150mm)
        for (var i = lowerBound(vocab, q); i < vocab.length && vocab[i].lastIndexOf(q, 0) === 0; i++) {
          var w = vocab[i];
          if (w === q || (digits && /\d/.test(w[q.length]))) continue;
          give(w, 6 + 3 * q.length / w.length);
        }
      }
      var max = allowance(q);
      if (fuzzy && max && !digits) {
        for (var j = 0; j < vocab.length; j++) {
          var v = vocab[j];
          if (v.length < q.length - max || hits.size > 6000) continue;
          var d = slips(q, v, max);
          if (d[0] <= max) give(v, 5 - d[0] * 1.5);
          else if (d[1] <= max && q.length >= 4) give(v, 4.5 - d[1] * 1.5);   // still typing a longer word
        }
      }
      if (cache.size > 400) cache.clear();
      cache.set(key, hits);
      return hits;
    }

    /* a typed word and the words it can also mean -> Map(item -> score) */
    function matchAny(q, fuzzy) {
      var out = new Map(matchWord(q, fuzzy));
      (ALSO[q] || []).forEach(function (alt) {
        words(alt).filter(Boolean).forEach(function (a) {
          matchWord(a, false).forEach(function (s, n) { if (!(out.get(n) >= s - 1)) out.set(n, s - 1); });
        });
      });
      return out;
    }

    /* the name search: every typed word must match (two typed words joined count for both) */
    function byName(qs, fuzzy) {
      var per = qs.map(function (q) { return matchAny(q, fuzzy); });
      for (var i = 0; i + 1 < qs.length; i++) {
        var joined = matchWord(qs[i] + qs[i + 1], false);
        if (!joined.size) continue;
        [i, i + 1].forEach(function (k) {
          per[k] = new Map(per[k]);
          joined.forEach(function (s, n) { if (!(per[k].get(n) >= s)) per[k].set(n, s); });
        });
      }
      per.sort(function (a, b) { return a.size - b.size; });
      var out = [];
      per[0].forEach(function (s, n) {
        var total = s;
        for (var k = 1; k < per.length; k++) { var t = per[k].get(n); if (t === undefined) return; total += t; }
        out.push({ n: n, score: total });
      });
      return out;
    }

    // each product's words, made when first needed, to reward typed words that sit side by side in the name
    var wordsOf = new Array(items.length);
    function together(n, qs) {
      var ws = wordsOf[n] || (wordsOf[n] = words(items[n].name).concat([null], words(items[n].web || '')));
      var bonus = 0, starts = function (w, q) { return w && w.lastIndexOf(q, 0) === 0; };
      for (var i = 0; i + 1 < qs.length; i++) {
        for (var p = 0; p + 1 < ws.length; p++) if (starts(ws[p], qs[i]) && starts(ws[p + 1], qs[i + 1])) { bonus += 4; break; }
      }
      if (qs.length && starts(ws[0], qs[0])) bonus += 1;
      return bonus;
    }
    function rank(list, qs) {
      var order = function (a, b) {
        return b.score - a.score || items[a.n].name.length - items[b.n].name.length || (items[a.n].sku < items[b.n].sku ? -1 : 1);
      };
      list.sort(order);
      var top = list.slice(0, 600);
      top.forEach(function (r) { r.score += together(r.n, qs); });
      return top.sort(order).concat(list.slice(600));
    }

    var UNIT_ONLY = new RegExp('^\\d+(' + UNITS + '|inch)$', 'i');

    /* what's typed -> {list: [{item, how}], total, note} ; how: 'sku' | 'near' | 'name' | 'close' */
    function find(text, limit) {
      limit = limit || 300;
      var raw = String(text || '').trim();
      var res = { list: [], total: 0, note: '' };
      if (!raw) return res;
      var seen = new Set(), codes = [], names = [];
      function push(to, n, how) { if (!seen.has(n)) { seen.add(n); to.push({ item: items[n], how: how }); } }

      // codes: the whole code, then codes starting with what's typed, then codes containing it
      var code = asCode(raw), whole = false;
      if (code && code.length >= 3) {
        if (bySku.has(code)) { push(codes, bySku.get(code), 'sku'); whole = true; }
        var starts = [], within = [];
        items.forEach(function (it, n) {
          var at = it.sku.indexOf(code);
          if (at === 0) starts.push(n); else if (at > 0) within.push(n);
        });
        starts.concat(within).forEach(function (n) { push(codes, n, 'sku'); });
        if (!codes.length && code.length === 5 && SKU_SHAPE.test(code)) {
          items.forEach(function (it, n) { if (nearCode(code, it.sku)) push(codes, n, 'near'); });
          if (codes.length) res.note = 'No product ' + code + '. Did you mean one of these?';
        }
      }

      var qs = words(raw).filter(Boolean);
      if (!qs.length) qs = raw.toLowerCase().match(/[a-z0-9]+/g) || [];
      if (qs.length && !whole) {
        var named = byName(qs, false), close = [];
        // few or no hits as typed: add close spellings (not when it was clearly a code)
        if (named.length < 5 && !codes.length) {
          var have = new Set(named.map(function (r) { return r.n; }));
          close = byName(qs, true).filter(function (r) { return !have.has(r.n); });
        }
        if (!named.length && !close.length && qs.length > 1 && !codes.length) {
          // nothing has every word: show what has the most of them
          var count = new Map(), score = new Map(), most = 0;
          qs.forEach(function (q) {
            matchAny(q, true).forEach(function (s, n) { count.set(n, (count.get(n) || 0) + 1); score.set(n, (score.get(n) || 0) + s); });
          });
          count.forEach(function (c) { if (c > most) most = c; });
          if (most >= Math.max(1, qs.length - 1)) {
            count.forEach(function (c, n) { if (c === most) close.push({ n: n, score: score.get(n) }); });
            if (close.length) res.note = 'Nothing matches every word, so these match most of them.';
          }
        }
        if (!named.length && close.length && !res.note) res.note = 'Showing close spellings.';
        rank(named, qs).forEach(function (r) { push(names, r.n, 'name'); });
        rank(close, qs).forEach(function (r) { push(names, r.n, 'close'); });
      }
      // "12v", "22mm": a size, so names first; otherwise codes first
      var list = UNIT_ONLY.test(raw.replace(/\s+/g, '')) && names.length ? names.concat(codes) : codes.concat(names);
      res.total = list.length;
      res.list = list.slice(0, limit);
      return res;
    }

    return { find: find, size: items.length, words: vocab.length };
  }

  var api = { build: build, words: words, slips: slips, asCode: asCode, SKU_SHAPE: SKU_SHAPE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ProductSearch = api;
})(this);
