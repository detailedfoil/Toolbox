/* NPS engine: reads the dated NPS workbook and reproduces its maths.
   Works in the browser (window.NPS) and in Node (module.exports) for testing. */
(function (root) {
  "use strict";

  var TARGET = 0.877;      // "On Target" line used throughout the workbook
  var GREAT = 0.9;         // "Great" line on the calculator
  var STORE_COUNT_DIVISOR = 22;

  // Excel works to 15 significant digits, so round to that before ceil/floor to match the workbook exactly.
  function ceil(x) { return Math.ceil(+x.toPrecision(15)); }
  function floor(x) { return Math.floor(+x.toPrecision(15)); }
  function round3(x) { return Math.round(x * 1000 + 1e-9) / 1000; }

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function str(v) { return v == null ? "" : String(v).trim(); }

  /* ---- parsing ---- */
  function findSheet(wb, name) {
    var hit = wb.SheetNames.filter(function (n) { return n.trim().toLowerCase() === name; })[0];
    if (!hit) throw new Error('Could not find a "' + name + '" sheet. Is this the NPS workbook?');
    return wb.Sheets[hit];
  }
  function cell(ws, col, row) {
    var c = ws[col + row];
    return c ? c.v : undefined;
  }

  // wb is a SheetJS workbook object
  function parseWorkbook(wb, fileName) {
    var sb = findSheet(wb, "store breakdown");
    var lb = findSheet(wb, "leaderboard");

    // Store Breakdown: header row has "Store" in column B; stores run until "Area Total".
    var r = 1, headerRow = 0;
    for (; r <= 40; r++) { if (str(cell(sb, "B", r)).toLowerCase() === "store") { headerRow = r; break; } }
    if (!headerRow) throw new Error('Could not find the "Store" header on the Store Breakdown sheet.');

    var stores = [], area = null;
    for (r = headerRow + 1; r <= headerRow + 60; r++) {
      var name = str(cell(sb, "B", r));
      if (!name) { if (area) break; else continue; }
      var rec = { name: name, p: num(cell(sb, "C", r)), pa: num(cell(sb, "D", r)), d: num(cell(sb, "E", r)) };
      if (name.toLowerCase() === "area total") { area = rec; break; }
      if (/^blue cells|^green numbers|^target/i.test(name)) break;
      stores.push(rec);
    }
    if (!stores.length) throw new Error("No stores found on the Store Breakdown sheet.");

    // Leaderboard: last year's NPS by store name, plus the area line.
    var ly = {}, areaLY = null, lbHeader = 0;
    for (r = 1; r <= 20; r++) { if (str(cell(lb, "C", r)).toLowerCase() === "store") { lbHeader = r; break; } }
    if (!lbHeader) throw new Error('Could not find the "Store" header on the Leaderboard sheet.');
    for (r = lbHeader + 1; r <= lbHeader + 60; r++) {
      var n2 = str(cell(lb, "C", r));
      var v = cell(lb, "E", r);
      if (n2.toLowerCase() === "area total") { areaLY = typeof v === "number" ? v : null; break; }
      if (n2 && n2.toUpperCase() !== "YOU" && typeof v === "number") ly[n2] = v;
    }

    var missing = stores.filter(function (s) { return !(s.name in ly); }).map(function (s) { return s.name; });
    var m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(fileName || "");

    return {
      date: m ? m[0] : "",
      fileName: fileName || "",
      stores: stores,
      area: area || sumArea(stores),
      ly: ly,
      areaLY: areaLY,
      warnings: missing.length ? ["No last year figure for: " + missing.join(", ")] : []
    };
  }
  function sumArea(stores) {
    return stores.reduce(function (a, s) { return { name: "Area Total", p: a.p + s.p, pa: a.pa + s.pa, d: a.d + s.d }; },
      { name: "Area Total", p: 0, pa: 0, d: 0 });
  }

  /* ---- maths ---- */
  function total(x) { return x.p + x.pa + x.d; }
  function nps(x) { var t = total(x); return t ? (x.p - x.d) / t : null; }

  // Additional promoters needed to reach target t (0..1)
  function promotersNeeded(x, t) {
    var N = total(x);
    if (!N) return "-";
    if (t >= 1) return "N/A";
    return Math.max(0, ceil((t * N + x.d - x.p) / (1 - t)));
  }
  // Promoters needed to offset one extra detractor / passive while holding NPS
  function offsetDetractor(x) {
    var N = total(x); if (!N) return "-";
    var s = round3((x.p - x.d) / N);
    if (s >= 1) return "N/A";
    return Math.max(0, ceil((s * (N + 1) + x.d + 1 - x.p) / (1 - s)));
  }
  function offsetPassive(x) {
    var N = total(x); if (!N) return "-";
    var s = round3((x.p - x.d) / N);
    if (s >= 1) return "N/A";
    return Math.max(0, ceil((s * (N + 1) + x.d - x.p) / (1 - s)));
  }
  function ratingFor(score) {
    if (score == null) return "-";
    return score >= GREAT ? "Great" : score >= TARGET ? "On Target" : "Below Target";
  }

  // Everything the Calculator sheet shows for one set of counts
  function calculate(x, targetPct) {
    var N = total(x), s = nps(x);
    var perStore = promotersNeeded(x, targetPct);
    return {
      total: N,
      score: s,
      rating: ratingFor(s),
      pPct: N ? x.p / N : 0, paPct: N ? x.pa / N : 0, dPct: N ? x.d / N : 0,
      afterPromoter: N ? (x.p + 1 - x.d) / (N + 1) : null,
      afterPassive: N ? (x.p - x.d) / (N + 1) : null,
      afterDetractor: N ? (x.p - (x.d + 1)) / (N + 1) : null,
      needed: perStore,
      perStore: typeof perStore === "number" ? ceil(perStore / STORE_COUNT_DIVISOR) : perStore,
      offsetDetractor: offsetDetractor(x),
      offsetPassive: offsetPassive(x)
    };
  }

  // Store Breakdown table (stores sorted best first, then the area total row)
  function breakdown(data) {
    var rows = data.stores.map(function (s) { return { s: s, n: nps(s), t: total(s) }; });
    var scores = rows.map(function (r) { return r.n; });
    var top = Math.max.apply(null, scores);
    function rankOf(n) { return scores.filter(function (o) { return o > n; }).length + 1; }
    function line(s, isArea) {
      var N = total(s), n = nps(s);
      if (!N) return { name: s.name, p: s.p, pa: s.pa, d: s.d, total: 0, nps: null };
      var topDen = 1 - (top >= 1 ? 0.999 : top);
      var toTop = rankOf(n) === 1 ? 0 : Math.max(0, ceil((top * N + s.d - s.p) / topDen));
      return {
        name: s.name, p: s.p, pa: s.pa, d: s.d, total: N, nps: n,
        rank: rankOf(n),
        toTop: toTop,
        toTarget: n >= TARGET ? 0 : Math.max(0, ceil((TARGET * N + s.d - s.p) / (1 - TARGET))),
        detractorsLeft: n < TARGET ? 0 : Math.max(0, floor((s.p - s.d - TARGET * N) / (1 + TARGET))),
        offsetPassive: offsetPassive(s),
        offsetDetractor: offsetDetractor(s),
        isArea: !!isArea
      };
    }
    var out = rows.slice().sort(function (a, b) { return b.n - a.n; }).map(function (r) { return line(r.s); });
    return { stores: out, area: line(data.area, true), top: top };
  }

  // Leaderboard: year-on-year change, with this year's rank and last year's rank
  function leaderboard(data) {
    var rows = data.stores.map(function (s) {
      var n = nps(s), l = data.ly[s.name];
      return { name: s.name, now: n, ly: l, change: l == null ? null : n - l };
    });
    function ranks(key) {
      var vals = rows.filter(function (r) { return r[key] != null; }).map(function (r) { return r[key]; });
      return function (v) { return vals.filter(function (o) { return o > v; }).length + 1; };
    }
    var rNow = ranks("now"), rLy = ranks("ly");
    rows.forEach(function (r) {
      r.rankNow = rNow(r.now);
      r.rankLy = r.ly == null ? null : rLy(r.ly);
    });
    rows.sort(function (a, b) { return (b.change == null ? -9 : b.change) - (a.change == null ? -9 : a.change); });
    rows.forEach(function (r, i) { r.pos = i + 1; });
    var an = nps(data.area);
    return {
      rows: rows,
      area: { now: an, ly: data.areaLY, change: data.areaLY == null ? null : an - data.areaLY }
    };
  }

  // Where would a score sit among the stores (the "YOU" position)
  function position(data, score) {
    if (score == null) return "-";
    return data.stores.filter(function (s) { return nps(s) > score; }).length + 1;
  }

  var api = {
    TARGET: TARGET, GREAT: GREAT, STORE_COUNT_DIVISOR: STORE_COUNT_DIVISOR,
    parseWorkbook: parseWorkbook, total: total, nps: nps,
    calculate: calculate, breakdown: breakdown, leaderboard: leaderboard, position: position
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NPS = api;
})(typeof window !== "undefined" ? window : this);
