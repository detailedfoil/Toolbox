/* Product Search: which products are the same thing in different sizes (Goldscrew 4mm x 40mm 200 Pack, 5mm x 50mm
 * 200 Pack...), so the page can show them as one result with a size switcher.
 *
 * Each name has its sizes taken out: measurements (50mm, 2.5Ltr, 18V, 2.0Ah), dimensions (4mm x 40mm, M6 x 50,
 * 2 x 2.0Ah), pack sizes (200 Pack, Pk200, 1000pcs, pack of 10) and any other bare numbers. What's left is the
 * product's "family": two products with the same family are sizes of each other. What was taken out is the size label.
 *
 * The screwfix.com name is used when the GitHub check has found it: it's written the same way across a range. A product
 * not read yet uses its stock-system name, and joins a family only when that stock name, sizes taken out, belongs to
 * exactly one family of named products (stock names are abbreviated, "Elbow 15mm Pk10" could be any of several elbows).
 * Two unread products with the same stock name family are grouped with each other.
 * Colours, models and anything else that isn't a size stay in the name, so those are never grouped (gold and silver
 * screws are separate families). A family is also only ever one way of measuring (detailedfoil, 22 Oct 2026): sizes in
 * mm, sizes in inches and screws in gauge (8ga x 1 1/2") are kept apart, even in the same range. A product not read
 * yet joins a named family only when its stock name measures the same way.
 * Brands are never mixed (detailedfoil, 22 Oct 2026). screwfix.com names always start with the brand, so named families
 * can't mix them. Stock names sometimes leave the brand out ("Endfeed Elbow 15mm"), so a product not read yet only joins
 * a named family whose brand is in its stock name, and products not read yet are only grouped with each other when their
 * stock name starts with a brand seen on screwfix.com (the first word of the screwfix.com names).
 *
 * group(items) -> sets on each item: fam (the array of items in its family, sorted by size, shared by them all; only
 * when there are 2 or more) and size (its size label, e.g. "5mm x 50mm 200 Pack"). Returns the number of families.
 */
(function (root) {
  'use strict';

  var NUM = '\\d+(?:[.,]\\d+)?(?:\\s*/\\s*\\d+|\\s+\\d+\\s*/\\s*\\d+)?(?![\\d.,])';   // 4, 4.5, 1/2, 1 1/2; never part of a number
  var UNIT = '(?:mm2|mm²|mm|cm|km|m|ltrs?|litres?|liters?|l|ml|cl|kg|g|kw|w|v|mah|ah|inch(?:es)?|in|"|ft|ga|lm|mtrs?|metres?|meters?|nm|bar|psi|amps?|a|grit|gauge|swg|awg|way|gang|pin|core)';
  var PACK_WORD = '(?:pk|pks|pack|packs|pcs?|pce|pieces?)';
  // sizes, in the order they're tried: dimensions, packs, measurements, then any other number
  var SIZE = new RegExp(
    '(?:\\bm?' + NUM + '\\s*' + UNIT + '?\\s*(?:[x×]\\s*m?' + NUM + '\\s*' + UNIT + '?\\s*)+(?![a-z]))' +        // 4mm x 40mm, M6 x 50, 2 x 2.0Ah
    '|(?:\\b' + PACK_WORD + '\\s*(?:of\\s*)?' + NUM + '\\b)' +                                                   // Pk200, pack of 10
    '|(?:\\b' + NUM + '\\s*-?\\s*' + PACK_WORD + '\\b)' +                                                       // 200 Pack, 1000pcs
    '|(?:\\b' + NUM + '(?:\\s*-\\s*' + NUM + ')?\\s*' + UNIT + '(?![a-z0-9]))' +                                   // 50mm, 2.5Ltr, 18V, 41-43"
    '|(?:\\bsize\\s+' + NUM + ')' +                                                                             // Size 9
    '|(?:\\b(?:(?:x{1,3}|extra)[- ]?)?(?:small|large)\\b|\\bmedium\\b|\\b(?:[2-5]?x{1,3}l|xs)\\b)' +             // Large, X Large, XXL
    '|(?:(?:^|(?<=[^a-z0-9]))' + NUM + '(?![a-z0-9]))',                                                         // 1-2-3, Grade 40
    'gi');
  var LABEL_PART = new RegExp('[a-z"×]', 'i');   // a size with a unit or an x in it, not a bare number

  var UNIT_WORD = new RegExp('^' + UNIT + '$', 'i');

  /* name -> {key, label, full}: label = the sizes with a unit or an x in them, full = every size and number.
     stock: it's a stock-system name, where 1.0mm is written "1 0mm" */
  function split(name, stock) {
    var s = String(name || '').replace(/[‘’′]/g, "'").replace(/[“”″]/g, '"').replace(/[–—]/g, '-');
    if (stock) s = s.replace(/(^|[^\d.,\-])(\d{1,2}) (\d)(?=(?:mm|m|cm|l|ltr|v|ah|kg|g)\b)/gi, '$1$2.$3');
    s = s.replace(/(\d)([a-z]{3,})/gi, function (m, d, w) { return UNIT_WORD.test(w) ? m : d + ' ' + w; })   // 30Gold -> 30 Gold
      .replace(/([a-z])(pk\d)/gi, '$1 $2');                                                 // GoldPk200 -> Gold Pk200
    var parts = [], bare = [], all = [];
    var rest = s.replace(SIZE, function (m) {
      var t = m.trim();
      (LABEL_PART.test(t) ? parts : bare).push(t);
      all.push(t);
      return ' ';
    });
    var key = rest.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
      .replace(/\b(?:x|of|with|and|the|for|in|a)\b/g, ' ').replace(/\s+/g, ' ').trim();
    var label = (parts.length ? parts : bare).join(' ').replace(/\s+/g, ' ');
    return { key: key, label: label, full: all.join(' ').replace(/\s+/g, ' ') };
  }

  // the way a size is measured: 'm' metric (mm, m, L, kg...), 'i' inches or feet (", 1/2, ft), 'g' gauge; '' none
  function system(label) {
    var t = String(label), out = '';
    if (/\d\s*(?:mm2|mm²|mm|cm|km|m|ltrs?|litres?|liters?|l|ml|cl|kg|g)(?![a-z])/i.test(t)) out += 'm';
    if (/\d\s*(?:"|inch|in\b|ft\b|')|\d\s*\/\s*\d/i.test(t)) out += 'i';
    if (/\d\s*(?:ga|gauge|swg|awg)\b/i.test(t)) out += 'g';
    return out;
  }

  // numbers in a label, for sorting sizes: "4.5mm x 40mm 200 Pack" -> [4.5, 40, 200]
  function nums(label) {
    var out = [], re = /(\d+)\s+(\d+)\s*\/\s*(\d+)|(\d+)\s*\/\s*(\d+)|(\d+(?:[.,]\d+)?)/g, m;
    while ((m = re.exec(String(label)))) {
      if (m[1]) out.push(+m[1] + m[2] / m[3]);            // 1 1/2 -> 1.5
      else if (m[4]) out.push(m[4] / m[5]);               // 3/4 -> 0.75
      else out.push(parseFloat(m[6].replace(',', '.')));
    }
    return out;
  }
  function bySize(a, b) {
    var x = nums(a.size), y = nums(b.size);
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === undefined) return -1;
      if (y[i] === undefined) return 1;
      if (x[i] !== y[i]) return x[i] - y[i];
    }
    return a.size < b.size ? -1 : a.size > b.size ? 1 : (a.sku < b.sku ? -1 : 1);
  }

  function group(items) {
    var byKey = new Map();           // family key -> [items]
    var stockToWeb = new Map();      // stock name family -> Set of web name families
    var brands = new Set();          // the first word of every screwfix.com name: the brand
    var info = items.map(function (it) {
      var st = split(it.name, true), web = it.web ? split(it.web) : null;
      it.size = (web || st).label;
      it.sizeFull = (web || st).full;
      delete it.fam;
      // a family is a name without its sizes, measured one way
      st.fam = st.key && st.key + ' |' + system(st.label);
      if (web) web.fam = web.key && web.key + ' |' + system(web.label);
      if (web && web.fam) {
        brands.add(web.key.split(' ')[0]);
        if (!stockToWeb.has(st.key)) stockToWeb.set(st.key, new Set());
        stockToWeb.get(st.key).add(web.fam);
      }
      return { it: it, st: st, web: web };
    });
    function put(key, it) {
      if (!key) return;
      var list = byKey.get(key);
      if (list) list.push(it); else byKey.set(key, [it]);
    }
    info.forEach(function (x) {
      if (x.web && x.web.fam) { put('w ' + x.web.fam, x.it); return; }
      var webs = stockToWeb.get(x.st.key), words = x.st.key.split(' ');
      if (!webs) {
        if (brands.has(words[0])) put('s ' + x.st.fam, x.it);   // grouped with others not read yet, only under a known brand
        return;
      }
      // join the one named family with this stock name, if it's the same brand and measures the same way; otherwise
      // wait to be read
      if (webs.size === 1) {
        var only = webs.values().next().value;
        var sameWay = only.slice(only.lastIndexOf('|') + 1) === x.st.fam.slice(x.st.fam.lastIndexOf('|') + 1);
        if (sameWay && words.indexOf(only.split(' ')[0]) >= 0) put('w ' + only, x.it);
      }
    });
    var count = 0;
    byKey.forEach(function (list) {
      if (list.length < 2) return;
      // the same size twice isn't a size range (two colours, say, whose names differ only by a number)
      var low = function (x) { return String(x).toLowerCase().replace(/\s+/g, ''); };
      var sizes = new Set(list.map(function (it) { return low(it.size); }));
      if (sizes.size < list.length) {
        // two the same: use every number in the name instead ("1 5 SWA 3 Core 25m" and "2 5 SWA 3 Core 25m")
        var full = new Set(list.map(function (it) { return low(it.sizeFull); }));
        if (full.size > sizes.size) list.forEach(function (it) { it.size = it.sizeFull; });
        sizes = new Set(list.map(function (it) { return low(it.size); }));
      }
      list.forEach(function (it) { delete it.sizeFull; });
      if (sizes.size < 2) return;
      list.sort(bySize);
      list.forEach(function (it) { it.fam = list; });
      count++;
    });
    return count;
  }

  var api = { group: group, split: split, system: system };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ProductFamilies = api;
})(this);
