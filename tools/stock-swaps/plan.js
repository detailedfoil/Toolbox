/* Stock Swaps: reading a plan out of data/plans.json, kept apart from the page so the tests can run it
   (window.SwapPlan in the page, module.exports in Node). Nothing here touches the page or the network.

   The plans themselves are worked out ahead by .github/stock-swaps/make-plans.py: one for every slider step, with
   and without Swaps only. A run in the file is [a, b, round trip minutes, lines], a line [way, item, units, low]
   (way 0 = a to b, 1 = b to a; low 1 = going to a store with under 2 days of it).

   setup(doc) -> the file ready to use (doc.byName: store index by name)
   stepIndex(doc, mins) -> the slider step nearest those minutes
   plan(doc, mins, swapsOnly) -> {mins, swapsOnly, runs, skip}: runs best first and numbered 1, 2, 3 ... (see enrich
     for what each holds); skip = runs not worth the trip, biggest first
   forStore(p, s) -> the same plan with only the runs store s is in, numbered again from 1
   totals(runs, s) -> {runs, units, swaps, sends, gets}; sends and gets are from store s's side (when s is given)
   score(units, swapped, mins, rules) -> units a van hour, swapped units counting 1.5
   tierOf(units, score, rules) -> 0 Most effective, 1 Worth doing, 2 Marginal, 3 Not worth your time (TIERS) */
(function (root) {
  'use strict';
  var TIERS = ['Most effective', 'Worth doing', 'Marginal', 'Not worth your time'];

  function setup(doc) {
    if (!doc || !doc.plans || !doc.steps || !doc.index || !doc.stores || !doc.rules) throw new Error('This is not a Stock Swaps plan file');
    doc.byName = {};
    doc.stores.forEach(function (s, i) { doc.byName[s.name] = i; });
    return doc;
  }

  function stepIndex(doc, mins) {
    var best = 0;
    doc.steps.forEach(function (m, i) { if (Math.abs(m - mins) < Math.abs(doc.steps[best] - mins)) best = i; });
    return best;
  }

  function score(units, swapped, mins, rules) {
    return (units + 2 * rules.swapBonus * swapped) / ((mins + rules.handling) / 60);
  }

  function tierOf(units, sc, rules) {
    if (units < rules.minUnits || sc < rules.minScore - 1e-9) return 3;
    return sc >= rules.tiers[0] ? 0 : sc >= rules.tiers[1] ? 1 : 2;
  }

  function enrich(doc, r) {
    var a = r[0], b = r[1], mins = r[2], ab = 0, ba = 0;
    var lines = r[3].map(function (l) {
      if (l[0] === 0) ab += l[2]; else ba += l[2];
      return { from: l[0] === 0 ? a : b, to: l[0] === 0 ? b : a, item: l[1], qty: l[2], low: !!l[3] };
    });
    var units = ab + ba, swapped = Math.min(ab, ba), sc = score(units, swapped, mins, doc.rules);
    return {
      a: a, b: b, key: a + '-' + b, mins: mins, lines: lines, ab: ab, ba: ba, units: units, swapped: swapped,
      swap: swapped >= doc.rules.swapMin, score: sc, tier: tierOf(units, sc, doc.rules)
    };
  }

  function plan(doc, mins, swapsOnly) {
    var k = stepIndex(doc, mins), p = doc.plans[doc.index[swapsOnly ? 'swaps' : 'all'][k]];
    var runs = p.runs.map(function (r) { return enrich(doc, r); });
    runs.sort(function (x, y) { return x.tier - y.tier || y.score - x.score || y.units - x.units; });
    runs.forEach(function (r, i) { r.rank = i + 1; });
    var skip = p.skip.map(function (r) { var e = enrich(doc, r); e.tier = 3; return e; });
    skip.sort(function (x, y) { return y.units - x.units || x.mins - y.mins; });
    return { mins: doc.steps[k], swapsOnly: !!swapsOnly, runs: runs, skip: skip };
  }

  function has(r, s) { return r.a === s || r.b === s; }

  function forStore(p, s) {
    var runs = p.runs.filter(function (r) { return has(r, s); }).map(function (r, i) {
      var c = {};
      for (var k in r) c[k] = r[k];
      c.areaRank = r.rank;
      c.rank = i + 1;
      return c;
    });
    return { mins: p.mins, swapsOnly: p.swapsOnly, store: s, runs: runs, skip: p.skip.filter(function (r) { return has(r, s); }) };
  }

  function totals(runs, s) {
    var t = { runs: runs.length, units: 0, swaps: 0, sends: 0, gets: 0 };
    runs.forEach(function (r) {
      t.units += r.units;
      if (r.swap) t.swaps++;
      if (s != null) r.lines.forEach(function (l) { if (l.from === s) t.sends += l.qty; else if (l.to === s) t.gets += l.qty; });
    });
    return t;
  }

  /* "STOCK LAST UPDATED 12:00AM TODAY" / "YESTERDAY" / "3 DAYS AGO" / the date. stockDate is "d.m.yyyy"; the stock
     export is the start of that day (12:00AM). now is the viewer's clock. */
  function stockAge(stockDate, now) {
    var m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(stockDate || '').trim());
    if (!m) return { text: 'STOCK LAST UPDATED ' + stockDate, days: null };
    var then = Date.UTC(+m[3], +m[2] - 1, +m[1]);
    var d = now || new Date();
    var days = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - then) / 86400000);
    var when = days <= 0 ? 'TODAY' : days === 1 ? 'YESTERDAY' : days <= 6 ? days + ' DAYS AGO' : 'ON ' + stockDate;
    return { text: 'STOCK LAST UPDATED 12:00AM ' + when, days: Math.max(0, days) };
  }

  var api = { stockAge: stockAge, TIERS: TIERS, setup: setup, stepIndex: stepIndex, plan: plan, forStore: forStore, totals: totals, score: score, tierOf: tierOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SwapPlan = api;
})(this);
