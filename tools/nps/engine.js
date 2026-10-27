/* NPS engine: reads the dated NPS workbook and works out the numbers for any target.
   All "how many" answers use whole-number arithmetic, so they're exact: the smallest
   number that actually gets there. (The spreadsheet sometimes asks for one extra
   because of floating-point rounding; this doesn't.)
   Works in the browser (window.NPS) and in Node (module.exports) for testing. */
(function (root) {
  "use strict";

  var SCALE = 10000;          // targets are held in hundredths of a percent: 87.7% -> 8770
  var ON_TARGET = 87.7;       // the workbook's "On Target" line (%): green at or above this
  var AMBER = 85.7;           // amber from here up to just under green; red below this (%)
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

  /* ---------- the survey export: one row per customer ---------- */

  // Area 20, named the way the old workbook named them, with the other names the exports use.
  var STORES = [
    ["Amersham (XA6)"], ["Berkhamsted (CB3)"], ["Biggleswade (ED1)"], ["Bishops Stortford (VA2)"],
    ["Chesham (SB9)"], ["Dunstable (LB1)"], ["Epping - Thornwood (RB9)", "epping"], ["Flitwick (JM5)"],
    ["Harlow (AT2)"], ["Hemel Hempstead (IT9)"], ["Hertford (IC6)"], ["Hoddesdon (UB4)"],
    ["Houghton Regis (DB4)", "dunstable houghton regis"], ["Leighton Buzzard (FA2)"], ["Letchworth (TT8)"],
    ["Luton - Bilton Way (LT2)", "luton"], ["Luton - Windmill (AL2)", "luton lap", "luton windmill trading est"],
    ["Royston (ED6)"], ["Saffron Walden (JR8)"], ["St Albans (OA7)", "st albans hatfield road"],
    ["Stevenage (ET3)"], ["Welwyn Garden City (IT6)"]
  ];
  function key(name) { return str(name).toLowerCase().replace(/\([^()]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim(); }
  var BY_KEY = {}, BY_CODE = {};
  STORES.forEach(function (row) {
    var m = /\(([A-Z0-9]+)\)$/.exec(row[0]);
    if (m) BY_CODE[m[1]] = row[0];
    row.forEach(function (n) { BY_KEY[key(n)] = row[0]; });
  });
  function storeName(raw) {
    var code = /\(([A-Za-z0-9]+)\)\s*$/.exec(str(raw));
    if (code && BY_CODE[code[1].toUpperCase()]) return BY_CODE[code[1].toUpperCase()];
    return BY_KEY[key(raw)] || str(raw);
  }

  // rows: the sheet as rows of cells (first row first). Finds the Store and LTR ("likely to
  // recommend", 0 to 10) columns and counts 9-10 as promoters, 7-8 passives, 0-6 detractors.
  // Rows with no score (the customer skipped the question) are left out, as the dashboard does.
  function parseResponses(rows, fileName) {
    var h = -1, cs = -1, cl = -1, r, c;
    for (r = 0; r < Math.min(rows.length, 15) && h < 0; r++) {
      var row = rows[r] || [];
      cs = -1; cl = -1;
      for (c = 0; c < row.length; c++) {
        var t = str(row[c]).toLowerCase();
        if (cs < 0 && (t === "store" || t === "branch" || t === "store name")) cs = c;
        if (cl < 0 && (t === "ltr" || /likely.*recommend/.test(t))) cl = c;
      }
      if (cs > -1 && cl > -1) h = r;
    }
    if (h < 0) return null;

    var byName = {}, order = [];
    for (r = h + 1; r < rows.length; r++) {
      var cells = rows[r] || [], raw = str(cells[cs]), v = str(cells[cl]);
      if (!raw || !/^\d{1,2}(\.0+)?$/.test(v)) continue;
      var score = Number(v);
      if (score < 0 || score > 10) continue;
      var name = storeName(raw);
      if (!byName[name]) { byName[name] = { name: name, p: 0, pa: 0, d: 0 }; order.push(name); }
      byName[name][score >= 9 ? "p" : score >= 7 ? "pa" : "d"] += 1;
    }
    if (!order.length) throw new Error("This file has no recommend scores in it.");
    var stores = order.map(function (n) { return byName[n]; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(fileName || "");
    return { date: m ? m[0] : "", fileName: fileName || "", stores: stores, area: sumArea(stores), responses: true };
  }

  /* Pasted text, one store per line: the name, then promoters, passives and detractors.
     Lenient on purpose: commas, tabs, pipes or spaces between, a header line, a rank in front,
     a score as a percentage, labels like "P 148" all get through. A date (DD.MM.YYYY) anywhere
     in the text is the data date. "Area Total" is used if given, otherwise the stores are added up. */
  var SEP = "\\s,;|:=\\t";
  var WHOLE = new RegExp("(?:^|[" + SEP + "])(\\d{1,7})(?=$|[" + SEP + "])", "g");

  function parseText(text) {
    text = String(text || "").replace(/\r/g, "");
    var t = text.trim();
    if (!t) throw new Error("Paste the NPS data first.");

    if (t[0] === "{") {                                   // the site's own data file
      var j;
      try { j = JSON.parse(t); } catch (e) { throw new Error("That looks like data but it's cut off. Copy all of it and paste again."); }
      if (!j || !Array.isArray(j.stores) || !j.stores.length) throw new Error("No stores found in that data.");
      var js = j.stores.map(function (s) { return { name: str(s.name), p: num(s.p), pa: num(s.pa), d: num(s.d) }; });
      return { date: str(j.date), fileName: "", stores: js, area: j.area ? { name: "Area Total", p: num(j.area.p), pa: num(j.area.pa), d: num(j.area.d) } : sumArea(js) };
    }

    var dm = /\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})\b/.exec(text);
    var date = dm ? ("0" + dm[1]).slice(-2) + "." + ("0" + dm[2]).slice(-2) + "." + dm[3] : "";

    var stores = [], area = null, seen = {}, order = ["p", "pa", "d"];
    text.split("\n").forEach(function (raw) {
      var line = raw.replace(/\*\*/g, "").replace(/[\u2013\u2014]/g, "-").trim();
      if (!line || /^[-|:=\s]+$/.test(line)) return;               // blank, or a table rule like |---|---|
      var hits = [], m;
      WHOLE.lastIndex = 0;
      while ((m = WHOLE.exec(line))) hits.push({ v: Number(m[1]), at: m.index + m[0].length - m[1].length });
      if (hits.length < 3) {                                          // a header: note the column order
        var lo = line.toLowerCase(), ip = lo.indexOf("promoter"), ipa = lo.indexOf("passive"), id = lo.indexOf("detractor");
        if (ip > -1 && ipa > -1 && id > -1) order = [["p", ip], ["pa", ipa], ["d", id]].sort(function (a, b) { return a[1] - b[1]; }).map(function (x) { return x[0]; });
        return;
      }
      var k = hits.length;                                            // a responses column after the three: drop it
      if (k >= 4 && hits[k - 1].v === hits[k - 4].v + hits[k - 3].v + hits[k - 2].v && hits[k - 1].v > 0) hits.pop();
      var three = hits.slice(-3);
      var name = line.slice(0, hits[hits.length - 3].at)
        .replace(/^[\s|]+/, "")
        .replace(/^(?:#?\d{1,2}[.)]?[\s|]+|[-*\u2022]\s+)/, "")                     // rank or bullet in front
        .replace(/(?:[\s|,;:=\t]+[-+]?\d+(?:\.\d+)?%?)+[\s|,;:=\t]*$/, "")        // a score or rank after the name
        .replace(/[\s|,;:=\t]*\b(?:p|promoters?)\s*[:=]?[\s|,;:=\t]*$/i, "")     // "P 148"
        .replace(/[\s|,;:=\t-]+$/, "")
        .trim();
      if (!/[a-z]/i.test(name)) return;
      var rec = { name: name };
      order.forEach(function (key, i) { rec[key] = three[i].v; });
      if (/^(area\s*)?total$/i.test(name) || /^area$/i.test(name)) { area = { name: "Area Total", p: rec.p, pa: rec.pa, d: rec.d }; return; }
      if (seen[name.toLowerCase()]) throw new Error(name + " is in the list twice.");
      seen[name.toLowerCase()] = true;
      stores.push(rec);
    });

    if (stores.length < 2) throw new Error("Couldn't find the stores. Each line needs a store name then its promoters, passives and detractors.");
    var sum = sumArea(stores);
    return { date: date, fileName: "", stores: stores, area: area || sum,
      areaMatches: !area || (area.p === sum.p && area.pa === sum.pa && area.d === sum.d) };
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

  // Green / amber / red for a set of counts, worked out exactly (null with no responses).
  function band(x) {
    if (!total(x)) return null;
    var d = x.p - x.d, N = total(x), g = targetFrac(ON_TARGET), a = targetFrac(AMBER);
    return d * g.b >= g.a * N ? "green" : d * a.b >= a.a * N ? "amber" : "red";
  }

  // The two lines a store is measured against: how far off, or how much room to spare.
  function ladder(x) {
    return [["green", ON_TARGET], ["amber", AMBER]].map(function (l) {
      var f = targetFrac(l[1]), N = total(x);
      var met = N ? (x.p - x.d) * f.b >= f.a * N : false;
      return { key: l[0], pct: l[1], met: met, needed: promotersToFrac(x, f), detractorsToSpare: detractorsToSpareFrac(x, f) };
    });
  }

  // Everything the calculator shows for one set of counts against a target (in %).
  // stores: the area's stores to rank against, or null for the whole area.
  function calculate(x, targetPct, stores) {
    var N = total(x), s = nps(x), f = targetFrac(targetPct);
    var out = {
      total: N, score: s, band: band(x), ladder: ladder(x),
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
      var r = { name: s.name, p: s.p, pa: s.pa, d: s.d, total: N, nps: n, band: band(s) };
      if (!N) return r;
      r.onTarget = (s.p - s.d) * f.b >= f.a * N;
      r.toTarget = promotersToFrac(s, f);
      r.toAmber = promotersToFrac(s, targetFrac(AMBER));
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
    var count = function (k) { return rows.filter(function (r) { return r.band === k; }).length; };
    return { rows: rows, area: area, onTargetCount: count("green"), counts: { green: count("green"), amber: count("amber"), red: count("red") } };
  }

  // Share of a total spread over the stores, rounded up (workbook "per store")
  function perStore(n, storeCount) { return typeof n === "number" && isFinite(n) && n > 0 ? exactCeil(n, storeCount) : 0; }

  var api = {
    ON_TARGET: ON_TARGET, AMBER: AMBER, GREAT: GREAT, band: band, ladder: ladder,
    parseWorkbook: parseWorkbook, parseText: parseText, parseResponses: parseResponses, storeName: storeName, total: total, nps: nps,
    calculate: calculate, overview: overview, rankAmong: rankAmong, perStore: perStore
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NPS = api;
})(typeof window !== "undefined" ? window : this);
