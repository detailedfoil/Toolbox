/* NPS engine: reads the dated NPS workbook and works out the numbers for any target.
   All "how many" answers use whole-number arithmetic, so they're exact: the smallest
   number that actually gets there. (The spreadsheet sometimes asks for one extra
   because of floating-point rounding; this doesn't.)
   Works in the browser (window.NPS) and in Node (module.exports) for testing. */
(function (root) {
  "use strict";

  var SCALE = 10000;          // targets are held in hundredths of a percent: 87.7% -> 8770
  var ON_TARGET = 87.7;       // the workbook's "On Target" line (%)
  var GREAT = 90;             // the workbook's "Great" line (%)

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function str(v) { return v == null ? "" : String(v).trim(); }

  // Integer ceil / floor of a / b (whole numbers, b > 0)
  function exactCeil(a, b) { var q = Math.floor(a / b); return q * b < a ? q + 1 : q; }
  function exactFloor(a, b) { var q = Math.floor(a / b); return q * b > a ? q - 1 : q; }

  /* ---------- parsing ---------- */

  function cell(ws, col, row) { var c = ws[col + row]; return c ? c.v : undefined; }

  // wb is a SheetJS workbook object. Only the Store Breakdown sheet is needed.
  function parseWorkbook(wb, fileName) {
    var sheetName = wb.SheetNames.filter(function (n) { return n.trim().toLowerCase() === "store breakdown"; })[0];
    if (!sheetName) throw new Error("This file has no Store Breakdown sheet. Upload the dated NPS workbook (.xlsx).");
    var ws = wb.Sheets[sheetName];

    var headerRow = 0, r;
    for (r = 1; r <= 40; r++) { if (str(cell(ws, "B", r)).toLowerCase() === "store") { headerRow = r; break; } }
    if (!headerRow) throw new Error("Couldn't find the Store column on the Store Breakdown sheet.");

    var stores = [], area = null;
    for (r = headerRow + 1; r <= headerRow + 80; r++) {
      var name = str(cell(ws, "B", r));
      if (!name) { if (stores.length) break; else continue; }
      if (/^blue cells|^green numbers|^target/i.test(name)) break;
      var rec = { name: name, p: num(cell(ws, "C", r)), pa: num(cell(ws, "D", r)), d: num(cell(ws, "E", r)) };
      if (name.toLowerCase() === "area total") { area = rec; break; }
      stores.push(rec);
    }
    if (!stores.length) throw new Error("No stores found on the Store Breakdown sheet.");

    var m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(fileName || "");
    return { date: m ? m[0] : "", fileName: fileName || "", stores: stores, area: area || sumArea(stores) };
  }

  function sumArea(stores) {
    return stores.reduce(function (a, s) { return { name: "Area Total", p: a.p + s.p, pa: a.pa + s.pa, d: a.d + s.d }; },
      { name: "Area Total", p: 0, pa: 0, d: 0 });
  }

  /* ---------- core maths ---------- */

  function total(x) { return x.p + x.pa + x.d; }
  function nps(x) { var t = total(x); return t ? (x.p - x.d) / t : null; }

  // A score as an exact fraction a / b
  function frac(x) { return { a: x.p - x.d, b: total(x) }; }
  function targetFrac(pct) { return { a: Math.round(pct * 100), b: SCALE }; }   // 87.7 -> 8770 / 10000

  // Fewest extra promoters (and nothing else) to reach score a/b. Reaching it exactly counts.
  function promotersToFrac(x, f) {
    var N = total(x);
    if (!N) return null;
    var lhs = f.a * N - f.b * (x.p - x.d);       // need (b - a) * k >= lhs
    if (lhs <= 0) return 0;
    if (f.b - f.a <= 0) return Infinity;          // 100% can't be reached once anything else is in
    return exactCeil(lhs, f.b - f.a);
  }

  // Most extra detractors / passives before the score drops under a/b.
  function detractorsToSpareFrac(x, f) {
    var N = total(x); if (!N) return 0;
    var room = f.b * (x.p - x.d) - f.a * N;       // need (a + b) * k <= room
    if (room < 0) return 0;
    return exactFloor(room, f.a + f.b);
  }
  function passivesToSpareFrac(x, f) {
    var N = total(x); if (!N) return 0;
    var room = f.b * (x.p - x.d) - f.a * N;       // need a * k <= room
    if (room < 0) return 0;
    if (f.a <= 0) return Infinity;
    return exactFloor(room, f.a);
  }

  // Promoters needed to win back one extra detractor / passive, holding today's score
  // to 0.1% (the workbook rounds the score to 3 decimals for this).
  function offset(x, extraD) {
    var N = total(x); if (!N) return null;
    var diff = x.p - x.d, sign = diff < 0 ? -1 : 1;
    var S = sign * exactFloor(2000 * Math.abs(diff) + N, 2 * N);    // ROUND((p-d)/N, 3) * 1000, half away from zero
    var f = { a: S, b: 1000 };
    var after = { p: x.p, pa: x.pa + (extraD ? 0 : 1), d: x.d + (extraD ? 1 : 0) };
    return promotersToFrac(after, f);
  }

  // Position among the area's stores (ties share a place, like the workbook).
  function rankAmong(stores, score) {
    return stores.filter(function (s) { return nps(s) > score; }).length + 1;
  }

  // The next better score among the stores (and how to reach it)
  function nextUp(x, stores) {
    var s = nps(x), best = null;
    stores.forEach(function (o) {
      var v = nps(o);
      if (v != null && v > s && (best === null || v < nps(best))) best = o;
    });
    if (!best) return null;
    return { rank: rankAmong(stores, nps(best)), score: nps(best), name: best.name, promoters: promotersToFrac(x, frac(best)) };
  }

  // Everything the calculator shows for one set of counts against a target (in %).
  // stores: the area's stores to rank against, or null for the whole area.
  function calculate(x, targetPct, stores) {
    var N = total(x), s = nps(x), f = targetFrac(targetPct);
    var out = {
      total: N, score: s,
      pPct: N ? x.p / N : 0, paPct: N ? x.pa / N : 0, dPct: N ? x.d / N : 0,
      afterPromoter: N ? (x.p + 1 - x.d) / (N + 1) : null,
      afterPassive: N ? (x.p - x.d) / (N + 1) : null,
      afterDetractor: N ? (x.p - x.d - 1) / (N + 1) : null,
      onTarget: N ? (x.p - x.d) * f.b >= f.a * N : false,
      needed: promotersToFrac(x, f),
      detractorsToSpare: detractorsToSpareFrac(x, f),
      passivesToSpare: passivesToSpareFrac(x, f),
      offsetDetractor: offset(x, true),
      offsetPassive: offset(x, false)
    };
    if (N && stores && stores.length) {
      out.rank = rankAmong(stores, s);
      out.nextUp = nextUp(x, stores);
    }
    return out;
  }

  // Every store against a target (in %), best first, plus the area line.
  function overview(data, targetPct) {
    var stores = data.stores, f = targetFrac(targetPct);
    var leader = stores.reduce(function (b, s) { return b === null || nps(s) > nps(b) ? s : b; }, null);

    function line(s) {
      var N = total(s), n = nps(s);
      var r = { name: s.name, p: s.p, pa: s.pa, d: s.d, total: N, nps: n };
      if (!N) return r;
      r.onTarget = (s.p - s.d) * f.b >= f.a * N;
      r.toTarget = promotersToFrac(s, f);
      r.detractorsToSpare = detractorsToSpareFrac(s, f);
      r.passivesToSpare = passivesToSpareFrac(s, f);
      r.toTop = promotersToFrac(s, frac(leader));
      r.offsetPassive = offset(s, false);
      r.offsetDetractor = offset(s, true);
      return r;
    }

    var rows = stores.map(function (s) {
      var r = line(s);
      if (r.total) { r.rank = rankAmong(stores, r.nps); r.nextUp = nextUp(s, stores); }
      return r;
    }).sort(function (a, b) { return (b.nps == null ? -2 : b.nps) - (a.nps == null ? -2 : a.nps); });

    var area = line(data.area);
    area.perStore = typeof area.toTarget === "number" && isFinite(area.toTarget) && area.toTarget > 0
      ? exactCeil(area.toTarget, stores.length) : 0;
    return { rows: rows, area: area, onTargetCount: rows.filter(function (r) { return r.onTarget; }).length };
  }

  // Share of a total spread over the stores, rounded up (workbook "per store")
  function perStore(n, storeCount) { return typeof n === "number" && isFinite(n) && n > 0 ? exactCeil(n, storeCount) : 0; }

  var api = {
    ON_TARGET: ON_TARGET, GREAT: GREAT,
    parseWorkbook: parseWorkbook, total: total, nps: nps,
    calculate: calculate, overview: overview, rankAmong: rankAmong, perStore: perStore
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NPS = api;
})(typeof window !== "undefined" ? window : this);
