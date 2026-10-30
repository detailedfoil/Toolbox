/* 3D Floor Plan: putting the stock list on the shelves. Shared by the page (app.js) and the tests.

   parse(text): the stock system's SKU List report, copied as text (same report as Product Search's "Upload stock":
   headings one per line, then one product per line, tab separated) -> {items: [{code, name, qty, loc}], count, noLoc,
   skipped} or null. loc is the Nailed Location, like AAC-04-10-06 = area AAC, bay 04, shelf 10 (counting up from the
   floor), position 06 along the shelf.

   index(bays, locs) + place(idx, loc): where a location is. A bay in data/locations.json holds one or more stock
   system bays (AAA-01, AAA-02 ...), each one a slice of the drawn bay (numbered from the middle aisle, so the left
   block counts from its east end). A bay number the plan doesn't have (BBC-09, say) has no place; an area given
   without bay numbers (BBK) takes all of its bays. Shelves 1 to `drawers` of the AA_ areas hold cardboard drawers,
   `drawerPositions` a shelf (20, or 12 where the drawers are wider): position 1 is the front of the first drawer, 2
   the back, except in a half width slice (AAA 1 to 8), where the 20 positions are 5 drawers of 4. Everything else is a
   box in a slot, `positions` slots a shelf. Positions count from the LEFT as you stand facing the shelf (to be
   confirmed with detailedfoil).

   arrange(items, idx): every product placed and what each shelf holds. freeSpots(arranged, idx): the locations with
   nothing nailed to them (see there).

   Kept on this device (localStorage) until "Clear stock", and never sent anywhere or put in the repo: stock is
   store-specific and the repo is public. */
(function (root) {
  'use strict';

  var SKU = /^(\d{3}[A-Z]{2}|\d{4}[A-Z]|\d{5})$/;
  var LOC = /^([A-Z]{3})-(\d{1,2})-(\d{1,2})-(\d{1,2})$/;
  var KEY = 'fp-stock-v1';
  var BOX_W = 0.127;      // one drawer or slot, in metres
  var LEFT_EDGE = 10.5;   // bays that end before this are in the left block: their aisle is on the east side
  var KNOWN = {
    14: ['SKU Code', 'SKU Definition State', 'SKU Type', 'Description', 'Base Unit Qty', 'Total Qty', 'Available Qty', 'Unreserved Qty',
         'Age Restricted', 'Hazardous', 'Aerosol', 'Non Trolleyable', 'Nailed Location', 'SKU held'],
    10: ['SKU Code', 'Description', 'Total Qty', 'Available Qty', 'Unreserved Qty', 'Age Restricted', 'Hazardous', 'Aerosol',
         'Nailed Location', 'SKU held']
  };
  // which way you look from, and which way the positions run (left to right as you face the shelf)
  var FACE = { S: { psign: 1 }, N: { psign: -1 }, W: { psign: 1 }, E: { psign: -1 } };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function low(s) { return String(s || '').trim().toLowerCase(); }
  function code(v) { return String(v || '').trim().toUpperCase().replace(/O/g, '0'); }
  function num(v) { var m = /-?\d+/.exec(String(v || '').replace(/,/g, '')); return m ? parseInt(m[0], 10) : null; }

  function parse(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var head = null, i = 0, items = [], seen = {}, noLoc = 0, skipped = 0;
    for (; i < lines.length; i++) {
      if (low(lines[i].split('\t')[0]) !== 'sku code') continue;
      var h = [], j = i;
      for (; j < lines.length; j++) {
        var cells = lines[j].split('\t');
        if (h.length && cells.length > 3 && SKU.test(code(cells[0]))) break;
        h.push(cells[0].trim());
      }
      head = h; i = j;
      break;
    }
    if (!head) i = 0;
    var cols = function (hh) {
      var at = function (name) { for (var k = 0; k < hh.length; k++) if (low(hh[k]) === low(name)) return k; return -1; };
      return { sku: at('SKU Code'), name: at('Description'), avail: at('Available Qty'), loc: at('Nailed Location') };
    };
    var col = head ? cols(head) : null;
    for (; i < lines.length; i++) {
      var c = lines[i].split('\t');
      if (c.length < 4) continue;
      var sku = code(c[0]);
      if (!SKU.test(sku)) { if (lines[i].trim()) skipped++; continue; }
      var C = col;
      if (!C || C.loc < 0) { if (!KNOWN[c.length]) { skipped++; continue; } C = cols(KNOWN[c.length]); }
      var get = function (k) { return C[k] >= 0 && C[k] < c.length ? c[C[k]] : ''; };
      var loc = String(get('loc')).trim().toUpperCase();
      var lm = LOC.exec(loc);
      if (!lm) { noLoc++; continue; }
      loc = lm[1] + '-' + pad2(+lm[2]) + '-' + pad2(+lm[3]) + '-' + pad2(+lm[4]);
      if (seen[sku + loc]) continue;
      seen[sku + loc] = 1;
      items.push({ code: sku, name: String(get('name')).replace(/\s+/g, ' ').trim(), qty: num(get('avail')) || 0, loc: loc });
    }
    // a paste that stops part way through a row has been cut off (copy and paste have size limits)
    var last = '', wide = 0;
    for (var q = lines.length - 1; q >= 0; q--) if (lines[q].trim()) { last = lines[q]; break; }
    for (var q2 = 0; q2 < lines.length; q2++) { var n2 = lines[q2].split('\t').length; if (SKU.test(code(lines[q2].split('\t')[0])) && n2 > wide) wide = n2; }
    var cells2 = last.split('\t');
    var cut = SKU.test(code(cells2[0])) && cells2.length < wide;
    return items.length ? { items: items, count: items.length, noLoc: noLoc, skipped: skipped, cut: cut } : null;
  }

  /* ---------- where things are ---------- */

  // the slices of each drawn bay that locations.json gives to each stock system bay
  function index(bays, locs) {
    var idx = { segs: {}, whole: {}, areas: (locs && locs.areas) || {}, list: [], notFree: {} };
    ((locs && locs.notFree) || []).forEach(function (k) { idx.notFree[k] = 1; });
    var faces = (locs && locs.faces) || {};
    bays.forEach(function (b) {
      var codes = locs && locs.bays && locs.bays[b.id];
      if (!codes) return;
      var ax = b.along === 'x', open = b.open || 'S', f = faces[b.id] || {}, groups = {}, order = [];
      codes.forEach(function (c) {
        var p = c.split('-');
        if (!groups[p[0]]) { groups[p[0]] = []; order.push(p[0]); }
        groups[p[0]].push(p[1] ? +p[1] : null);
      });
      order.forEach(function (area) {
        var nums = groups[area], n = nums.length;
        var face = f[area] || (open.length === 1 ? open : (ax ? 'S' : 'W'));
        var v0 = ax ? b.y0 : b.x0, v1 = ax ? b.y1 : b.x1;
        if (open.length === 2) { // open both sides: this area has the shop side or the back side
          var mid = (v0 + v1) / 2;
          if (face === 'S' || face === 'E') v0 = mid; else v1 = mid;
        }
        var a0 = ax ? b.x0 : b.y0, a1 = ax ? b.x1 : b.y1, wid = (a1 - a0) / n;
        var dir = ax && (b.row === 'W' || b.x1 <= LEFT_EDGE) ? -1 : 1; // the back wall run counts from the back right corner too
        nums.forEach(function (no, k) {
          var u0 = dir > 0 ? a0 + k * wid : a1 - (k + 1) * wid;
          var seg = { bay: b, area: area, no: no, k: k, n: n, face: face, along: b.along, u0: u0, u1: u0 + wid, v0: v0, v1: v1, psign: FACE[face].psign };
          idx.list.push(seg);
          if (no !== null) idx.segs[area + '-' + no] = seg; else idx.whole[area] = seg;
        });
      });
    });
    return idx;
  }

  // an area's settings from locations.json, with any for this one bay on top (AAC 5 and 6 have bigger drawers)
  function bayCfg(idx, area, no) {
    var a = idx.areas[area] || {}, o = a.bays && no !== null && no !== undefined ? a.bays[pad2(no)] : null;
    if (!o) return a;
    var c = {}, k;
    for (k in a) c[k] = a[k];
    for (k in o) c[k] = o[k];
    return c;
  }
  // the drawers on one drawer shelf of a slice: at least 2 deep (front and back), 4 deep in a half width slice
  function drawerShape(idx, seg) {
    var P = bayCfg(idx, seg.area, seg.no).drawerPositions || 20;
    var across = Math.max(1, Math.round((seg.u1 - seg.u0) / BOX_W));
    var deep = Math.max(2, Math.round(P / across));
    return { boxes: Math.ceil(P / deep), deep: deep, positions: P };
  }
  function isDrawerShelf(cfg, shelf) { return !!(cfg.drawers && shelf <= cfg.drawers); }

  // Shelf heights. Shelves 1 to 10 of the AA_ areas (the drawers) are a set distance apart, so shelf 10 is about chin
  // height; the ones above and all the other aisles are spread evenly up to the top shelf, 20 cm under the top of
  // the racking (about two people tall). Pallet racking: shelf 1 is the floor, the rest are the beams.
  function shelfZ(bay, s) {
    var n = Math.max(2, bay.levels);
    if (bay.pitch) {
      var d = bay.drawerShelves || 10, z10 = 0.12 + (d - 1) * bay.pitch, top = bay.h - 0.2;
      return s <= d ? 0.12 + (s - 1) * bay.pitch : z10 + (s - d) * (top - z10) / Math.max(1, n - d);
    }
    if (bay.kind === 'pallet') return s <= 1 ? 0 : 0.15 + (s - 1) * (bay.h - 0.25) / (n - 1);
    return 0.12 + (s - 1) * (bay.h - 0.2) / (n - 1);
  }
  // room above a shelf for what sits on it
  function shelfGap(bay, s) {
    var n = Math.max(2, bay.levels);
    return s < n ? shelfZ(bay, s + 1) - shelfZ(bay, s) : shelfZ(bay, s) - shelfZ(bay, s - 1);
  }

  // gives each bay with stock locations its number of shelves and where each plank goes (drawBay draws them)
  function levelBays(bays, locs) {
    var areas = (locs && locs.areas) || {};
    bays.forEach(function (b) {
      var codes = locs && locs.bays && locs.bays[b.id];
      if (!codes) return;
      var n = 0, pitch = 0, drawerShelves = 0;
      codes.forEach(function (c) {
        var cfg = areas[c.split('-')[0]];
        if (cfg) { n = Math.max(n, cfg.shelves || 0); if (cfg.pitch) { pitch = cfg.pitch; drawerShelves = cfg.drawers || 0; } }
      });
      if (!n) return;
      b.levels = b.kind === 'pallet' ? n + 1 : n;
      if (pitch) { b.pitch = pitch; b.drawerShelves = drawerShelves; }
      if (b.kind !== 'pallet') { b.zs = []; for (var k = 1; k <= n; k++) b.zs.push(shelfZ(b, k)); }
    });
  }

  function place(idx, loc) {
    var m = LOC.exec(String(loc || ''));
    if (!m) return null;
    var area = m[1], bay = +m[2], shelf = +m[3], pos = +m[4];
    var seg = idx.segs[area + '-' + bay] || idx.whole[area];
    if (!seg || !shelf || !pos) return null;
    var cfg = bayCfg(idx, area, seg.no), i0 = pos - 1;
    var p = { seg: seg, area: area, bay: bay, shelf: shelf, pos: pos, loc: loc, cfg: cfg, drawer: null, slots: 0, slot: 0 };
    if (isDrawerShelf(cfg, shelf)) {
      var sh = drawerShape(idx, seg);
      p.drawer = { boxes: sh.boxes, deep: sh.deep, positions: sh.positions, box: Math.min(sh.boxes - 1, Math.floor(i0 / sh.deep)), slot: i0 % sh.deep };
    } else {
      // one slot per position: the area's usual number, more if this one is further along
      p.slots = Math.max(cfg.positions || Math.round((seg.u1 - seg.u0) / BOX_W) || 1, pos);
      p.slot = i0;
    }
    return p;
  }

  // Every product placed (it.pl) and what each shelf holds:
  // {shelves: {'AAA-01-05': {key, seg, area, bay, shelf, drawer, used: {pos: item}, max, cells}}, placed, unplaced: {area: n}}.
  // Every box on one ordinary shelf gets the same number of cells (the furthest position on it decides), so none overlap.
  function arrange(items, idx) {
    var out = { shelves: {}, placed: [], unplaced: {} };
    items.forEach(function (it) {
      var p = place(idx, it.loc);
      it.pl = p;
      if (!p) { var a = String(it.loc).slice(0, 3); out.unplaced[a] = (out.unplaced[a] || 0) + 1; return; }
      var k = p.area + '-' + pad2(p.bay) + '-' + pad2(p.shelf);
      var s = out.shelves[k] || (out.shelves[k] = { key: k, seg: p.seg, area: p.area, bay: p.bay, shelf: p.shelf, drawer: !!p.drawer, used: {}, max: 0, cells: 0 });
      s.used[p.pos] = it;
      if (p.pos > s.max) s.max = p.pos;
      if (p.slots > s.cells) s.cells = p.slots;
      out.placed.push(it);
    });
    out.placed.forEach(function (it) { if (!it.pl.drawer) it.pl.slots = out.shelves[it.pl.area + '-' + pad2(it.pl.bay) + '-' + pad2(it.pl.shelf)].cells; });
    return out;
  }

  /* Locations with nothing nailed to them (detailedfoil, 30 Oct 2026: "if it goes AAA-01-01-01 then AAA-01-01-03 assume
     there is a free spot in AAA-01-01-02"). A drawer shelf has a known number of positions, so every one of them not in
     the list is free ('drawer'). On an ordinary shelf only the gaps count ('gap'): positions before the last one in use,
     as nobody knows how many labels a shelf has after its last product. A shelf with nothing on it at all, under one in
     the same bay that has, is free as a whole ('shelf'), unless locations.json says it's empty on purpose. Returns runs of free positions next to each other on one shelf,
     in location order: {key, loc, area, bay, shelf, from, to, n, kind, seg, cells, prev, next} (prev / next: the
     products either side, if any; a whole shelf has from = to = n = 0), plus totals. */
  function freeSpots(arr, idx) {
    var runs = [], shelves = arr.shelves, tops = {}, nf = idx.notFree || {};
    // a shelf, bay or area left empty on purpose (locations.json `notFree`) has no free spots
    function kept(key) { var p = key.split('-'); return !!(nf[key] || nf[p[0] + '-' + p[1]] || nf[p[0]]); }
    function add(s, kind, free, cells) {
      if (kept(s.key)) return;
      for (var i = 0; i < free.length; i++) {
        var from = free[i], to = from;
        while (i + 1 < free.length && free[i + 1] === to + 1) to = free[++i];
        runs.push({ key: s.key, loc: s.key + '-' + pad2(from), area: s.area, bay: s.bay, shelf: s.shelf, from: from, to: to, n: to - from + 1,
          kind: kind, seg: s.seg, cells: cells, prev: s.used[from - 1] || null, next: s.used[to + 1] || null });
      }
    }
    // drawer shelves: every drawer on the racking, stock or not
    idx.list.forEach(function (seg) {
      var cfg = bayCfg(idx, seg.area, seg.no);
      if (!cfg.drawers || seg.no === null) return;
      var P = drawerShape(idx, seg).positions;
      for (var sh = 1; sh <= cfg.drawers; sh++) {
        var k = seg.area + '-' + pad2(seg.no) + '-' + pad2(sh);
        var s = shelves[k] || { key: k, seg: seg, area: seg.area, bay: seg.no, shelf: sh, used: {} }, free = [];
        for (var p = 1; p <= P; p++) if (!s.used[p]) free.push(p);
        add(s, 'drawer', free, P);
      }
    });
    // ordinary shelves: the gaps, and the highest shelf in use in each bay
    Object.keys(shelves).forEach(function (k) {
      var s = shelves[k];
      if (s.drawer) return;
      var free = [];
      for (var p = 1; p < s.max; p++) if (!s.used[p]) free.push(p);
      add(s, 'gap', free, s.cells);
      var b = s.area + '-' + pad2(s.bay), t = tops[b];
      if (!t || s.shelf > t.shelf) tops[b] = s;
    });
    // whole shelves with nothing on them, under the highest one in use
    Object.keys(tops).forEach(function (b) {
      var t = tops[b], cfg = bayCfg(idx, t.area, t.seg.no), first = cfg.drawers ? cfg.drawers + 1 : 1;
      for (var sh = first; sh < t.shelf; sh++) {
        var k = b + '-' + pad2(sh);
        if (shelves[k] || kept(k)) continue;
        runs.push({ key: k, loc: k, area: t.area, bay: t.bay, shelf: sh, from: 0, to: 0, n: 0, kind: 'shelf', seg: t.seg, cells: 1, prev: null, next: null });
      }
    });
    runs.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : a.from - b.from; });
    var byArea = {}, positions = 0, whole = 0;
    runs.forEach(function (r) {
      var a = byArea[r.area] || (byArea[r.area] = { positions: 0, shelves: 0 });
      if (r.kind === 'shelf') { a.shelves++; whole++; } else { a.positions += r.n; positions += r.n; }
    });
    return { runs: runs, positions: positions, shelves: whole, byArea: byArea };
  }

  // cell i of `count` along the shelf (counting from the left as you face it) and slot j of `jCount` from the front
  function cellRect(seg, i, count, j, jCount) {
    var w = (seg.u1 - seg.u0) / count;
    var a0 = seg.psign > 0 ? seg.u0 + i * w : seg.u1 - (i + 1) * w, a1 = a0 + w;
    var d = (seg.v1 - seg.v0) / jCount, b0, b1;
    if (seg.face === 'S' || seg.face === 'E') { b1 = seg.v1 - j * d; b0 = b1 - d; } else { b0 = seg.v0 + j * d; b1 = b0 + d; }
    return seg.along === 'x' ? { x0: a0, x1: a1, y0: b0, y1: b1 } : { x0: b0, x1: b1, y0: a0, y1: a1 };
  }

  // every drawer on the racking: shelves 1 to `drawers` of each bay in an area that has them
  function drawers(idx) {
    var out = [];
    idx.list.forEach(function (seg) {
      var cfg = bayCfg(idx, seg.area, seg.no);
      if (!cfg.drawers) return;
      var sh = drawerShape(idx, seg);
      for (var s = 1; s <= cfg.drawers; s++) for (var b = 0; b < sh.boxes; b++) {
        out.push({ seg: seg, cfg: cfg, shelf: s, box: b, boxes: sh.boxes, deep: sh.deep, positions: sh.positions, key: drawerKey(seg.area, seg.no, s, b) });
      }
    });
    return out;
  }
  function drawerKey(area, bay, shelf, box) { return area + '-' + bay + '-' + shelf + '-' + box; }

  // What was typed in a search box as the start of one or more locations: "AAC-03", "aac 3", "AAC0312", "AAA-01, AAA-02"
  // -> ['AAC-03'] ... (padded, so they match the list), or null if it doesn't look like locations.
  function locQuery(q) {
    var parts = String(q || '').toUpperCase().split(/[,+]/).map(function (x) { return x.trim(); }).filter(Boolean), out = [];
    for (var i = 0; i < parts.length; i++) {
      var m = /^([A-Z]{3})\s*-?\s*([\d\s-]*)$/.exec(parts[i]);
      if (!m) return null;
      var rest = m[2].trim(), nums = [];
      if (rest && /[\s-]/.test(rest)) nums = rest.split(/[\s-]+/).filter(Boolean);
      else if (rest && rest.length % 2 === 0) nums = rest.match(/\d\d/g);
      else if (rest.length === 1) nums = [rest];
      else if (rest) return null;
      if (nums.length > 3 || nums.some(function (n) { return n.length > 2; })) return null;
      out.push([m[1]].concat(nums.map(function (n) { return pad2(+n); })).join('-'));
    }
    return out.length ? out : null;
  }

  // Kept on this device (localStorage, so it is there next time you open the page) and never sent anywhere.
  // "Clear stock" removes it. A copy from before this change may still be in sessionStorage: it is moved across.
  function enc(st) { return JSON.stringify(st.items.map(function (x) { return [x.code, x.name, x.qty, x.loc]; })); }
  function dec(s) { return { items: JSON.parse(s).map(function (a) { return { code: a[0], name: a[1], qty: a[2], loc: a[3] }; }) }; }
  var storage = {
    save: function (st) {
      var s = enc(st);
      try { localStorage.setItem(KEY, s); try { sessionStorage.removeItem(KEY); } catch (e1) { /* fine */ } return true; } catch (e) { /* full or blocked */ }
      try { sessionStorage.setItem(KEY, s); return true; } catch (e2) { return false; }
    },
    load: function () {
      try {
        var s = localStorage.getItem(KEY);
        if (s) return dec(s);
        s = sessionStorage.getItem(KEY);
        if (s) { try { localStorage.setItem(KEY, s); sessionStorage.removeItem(KEY); } catch (e3) { /* keep it for the visit */ } return dec(s); }
      } catch (e) { /* nothing kept */ }
      return null;
    },
    clear: function () { try { localStorage.removeItem(KEY); } catch (e) { /* nothing kept */ } try { sessionStorage.removeItem(KEY); } catch (e2) { /* nothing kept */ } }
  };

  var api = { parse: parse, index: index, place: place, arrange: arrange, freeSpots: freeSpots, levelBays: levelBays, shelfZ: shelfZ, shelfGap: shelfGap,
    cellRect: cellRect, drawers: drawers, drawerKey: drawerKey, drawerShape: drawerShape, bayCfg: bayCfg, pad2: pad2, locQuery: locQuery, BOX_W: BOX_W, storage: storage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FloorStock = api;
})(typeof window !== 'undefined' ? window : this);
