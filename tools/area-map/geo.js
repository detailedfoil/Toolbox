/* Area Map: the sums and the search, kept apart from the page so the tests can run them (window.AreaGeo in the page,
   module.exports in Node). Nothing here touches the network.

   setup(stores, areas) -> the store and area lists ready to use: each store gains id (from its name, for links),
     town and words (for the search); each area gains its stores, countries and a bounding box.
   miles(a, b) -> straight-line miles between two {lat, lng}.
   distance(m, inIreland) -> '1.2 miles' or, in Ireland, '1.9 km'.
   nearest(stores, at, n) -> the n stores nearest a {lat, lng}, each as {store, miles}.
   areaAt(areas, at) -> the area whose shape holds that spot, or null (at sea).
   search(data, query) -> {areas: [...], stores: [...]} best first; codes are not in the data, so a query is a store
     name, a town, part of an address, a postcode or an area ("20", "area 20", "I01").
   looksLikePlace(query) -> 'postcode' | 'outcode' | 'place' | '' : whether to offer the UK place lookup.
   csv(stores) -> a CSV of name, address, postcode, country and area. */
(function (root) {
  'use strict';
  var R = 3958.8; // earth's radius in miles

  function norm(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ').replace(/\bst\.?\s/g, 'st ').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function slug(t) { return norm(t).replace(/ /g, '-'); }
  var compact = function (pc) { return String(pc || '').replace(/\s+/g, '').toUpperCase(); };

  function areaSort(a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true }); }

  function setup(stores, areas) {
    var byArea = {};
    stores.forEach(function (s) {
      s.id = slug(s.name);
      s.town = s.name.split(' - ')[0].replace(/ ROI$/, '');
      s.words = norm(s.name + ' ' + s.address).split(' ');
      s.nameWords = norm(s.name).split(' ');
      s.pc = compact(s.postcode);
      (byArea[s.area] = byArea[s.area] || []).push(s);
    });
    areas.forEach(function (a) {
      a.list = (byArea[a.id] || []).slice().sort(function (x, y) { return x.name.localeCompare(y.name); });
      var seen = {};
      a.countries = [];
      a.list.forEach(function (s) { if (!seen[s.country]) { seen[s.country] = 1; a.countries.push(s.country); } });
      var b = [90, 180, -90, -180];
      a.shape.forEach(function (poly) {
        poly[0].forEach(function (p) {
          if (p[1] < b[0]) b[0] = p[1]; if (p[0] < b[1]) b[1] = p[0];
          if (p[1] > b[2]) b[2] = p[1]; if (p[0] > b[3]) b[3] = p[0];
        });
      });
      a.box = b;
    });
    areas.sort(function (x, y) { return areaSort(x.id, y.id); });
    return { stores: stores, areas: areas };
  }

  function miles(a, b) {
    var r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.pow(Math.sin(dLng / 2), 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function distance(m, inIreland) {
    var n = inIreland ? m * 1.609344 : m, unit = inIreland ? 'km' : (n >= 0.95 && n < 1.05 ? 'mile' : 'miles');
    return (n < 10 ? n.toFixed(1) : String(Math.round(n))) + ' ' + unit;
  }

  function nearest(stores, at, n) {
    return stores.map(function (s) { return { store: s, miles: miles(at, s) }; })
      .sort(function (x, y) { return x.miles - y.miles; }).slice(0, n || 5);
  }

  function inRing(x, y, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function areaAt(areas, at) {
    for (var i = 0; i < areas.length; i++) {
      var a = areas[i], b = a.box;
      if (at.lat < b[0] || at.lat > b[2] || at.lng < b[1] || at.lng > b[3]) continue;
      for (var k = 0; k < a.shape.length; k++) {
        var poly = a.shape[k];
        if (inRing(at.lng, at.lat, poly[0]) && !poly.slice(1).some(function (h) { return inRing(at.lng, at.lat, h); })) return a;
      }
    }
    return null;
  }

  // one edit (a letter wrong, missing, extra or two swapped) between a and b
  function oneOff(a, b) {
    if (a === b) return true;
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    var i = 0;
    while (i < la && i < lb && a[i] === b[i]) i++;
    if (la === lb) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
    return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }

  var AREA_Q = /^(?:area\s*)?(i\s*0?[1-9]|\d{1,2})$/i;

  function search(data, query) {
    var q = norm(query), out = { areas: [], stores: [] };
    if (!q) return out;
    var am = AREA_Q.exec(String(query).trim());
    if (am) {
      var want = am[1].replace(/\s+/g, '').toUpperCase().replace(/^I(\d)$/, 'I0$1');
      data.areas.forEach(function (a) { if (a.id.toUpperCase() === want) out.areas.push(a); });
      if (out.areas.length) return out; // "20" is the area, not every store with a 20 in its address
    }
    var terms = q.split(' '), pcq = compact(query);
    var scored = [];
    data.stores.forEach(function (s) {
      var score = 0, all = true;
      terms.forEach(function (t) {
        var best = 0;
        for (var i = 0; i < s.nameWords.length; i++) {
          if (s.nameWords[i] === t) best = Math.max(best, i === 0 ? 10 : 8);
          else if (s.nameWords[i].indexOf(t) === 0) best = Math.max(best, i === 0 ? 7 : 6);
        }
        if (!best) for (var j = 0; j < s.words.length; j++) {
          if (s.words[j] === t) { best = 4; break; }
          if (s.words[j].indexOf(t) === 0) best = Math.max(best, 3);
        }
        if (!best) all = false;
        score += best;
      });
      if (pcq.length >= 2 && /\d/.test(pcq) && s.pc.indexOf(pcq) === 0) { score = Math.max(score, 9 + pcq.length); all = true; }
      if (all && score) scored.push({ s: s, score: score + (norm(s.name).indexOf(q) === 0 ? 5 : 0) });
    });
    if (!scored.length) {
      // close spellings: every term (4+ letters) one letter out from a word in the name or address
      data.stores.forEach(function (s) {
        var ok = terms.every(function (t) {
          return s.words.some(function (w) { return w.indexOf(t) === 0 || (t.length >= 4 && (oneOff(t, w) || oneOff(t, w.slice(0, t.length)))); });
        });
        if (ok) scored.push({ s: s, score: 1 });
      });
    }
    scored.sort(function (x, y) { return y.score - x.score || x.s.name.localeCompare(y.s.name); });
    out.stores = scored.map(function (x) { return x.s; });
    return out;
  }

  function looksLikePlace(query) {
    var q = String(query || '').trim();
    if (AREA_Q.test(q)) return '';
    if (/^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(q)) return 'postcode';
    if (/^[A-Z]{1,2}\d[A-Z\d]?$/i.test(q)) return 'outcode';
    if (/^[a-z][a-z' .-]{2,}$/i.test(q)) return 'place';
    return '';
  }

  function csv(stores) {
    var cell = function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return ['Store,Address,Postcode,Country,Area'].concat(stores.map(function (s) {
      return [s.name, s.address, s.postcode, s.country, s.area].map(cell).join(',');
    })).join('\r\n') + '\r\n';
  }

  var api = { setup: setup, miles: miles, distance: distance, nearest: nearest, areaAt: areaAt, search: search, looksLikePlace: looksLikePlace, csv: csv, slug: slug, areaSort: areaSort };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AreaGeo = api;
})(this);
