/* 3D Floor Plan: putting the stock list on the shelves. Shared by the page (app.js) and the tests.

   parse(text): the stock system's SKU List report, copied as text (same report as Product Search's "Upload stock":
   headings one per line, then one product per line, tab separated) -> {items: [{code, name, qty, loc}], count, noLoc,
   skipped} or null. loc is the Nailed Location, like AAC-04-10-06 = area AAC, bay 04, shelf 10 (counting up from the
   floor), position 06 along the shelf.

   index(bays, locs) + place(idx, loc): where a location is. A bay in data/locations.json holds one or more stock
   system bays (AAA-01, AAA-02 ...), each one a slice of the drawn bay (numbered from the middle aisle, so the left
   block counts from its east end). A location bay is about 12.7 cm per box or slot wide: 1.27 m = 10 boxes. Shelves 1
   to `drawers` of the AA_ areas hold cardboard drawers: 20 positions a shelf, so a full width bay has 10 drawers of 2
   (position 1 is the front of the first drawer, 2 the back) and a half width one has 5 drawers of 4. Everything else
   is a box in a slot. Positions count from the LEFT as you stand facing the shelf (to be confirmed with detailedfoil).

   Kept on the device for the visit only (sessionStorage) and never sent anywhere: stock is store-specific and the
   repo is public. */
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
    return items.length ? { items: items, count: items.length, noLoc: noLoc, skipped: skipped } : null;
  }

  /* ---------- where things are ---------- */

  // the slices of each drawn bay that locations.json gives to each stock system bay
  function index(bays, locs) {
    var idx = { segs: {}, areas: (locs && locs.areas) || {}, list: [] };
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
          if (no !== null) idx.segs[area + '-' + no] = seg;
          if (idx.segs[area] === undefined || no === null) idx.segs[area] = seg;
        });
      });
    });
    return idx;
  }

  // Shelf heights. Shelves 1 to 10 of the AA_ areas (the drawers) are a set distance apart, so shelf 10 is about chin
  // height; the ones above and all the other aisles are spread evenly up to the top shelf, 20 cm under the top of
  // the racking (about two people tall).
  function shelfZ(bay, s) {
    var n = Math.max(2, bay.levels);
    if (bay.pitch) {
      var d = bay.drawerShelves || 10, z10 = 0.12 + (d - 1) * bay.pitch, top = bay.h - 0.2;
      return s <= d ? 0.12 + (s - 1) * bay.pitch : z10 + (s - d) * (top - z10) / Math.max(1, n - d);
    }
    if (bay.kind === 'pallet') return s <= 1 ? 0 : 0.15 + (s - 1) * (bay.h - 0.25) / n;
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
    var seg = idx.segs[area + '-' + bay] || idx.segs[area];
    if (!seg) return null;
    var cfg = idx.areas[area] || {}, w = seg.u1 - seg.u0, i0 = pos - 1;
    var p = { seg: seg, area: area, bay: bay, shelf: shelf, pos: pos, loc: loc, cfg: cfg, drawer: null, slots: 0, slot: 0 };
    if (cfg.drawers && shelf <= cfg.drawers) {
      var boxes = Math.max(1, Math.round(w / BOX_W)), deep = Math.max(1, Math.round((cfg.positions || 20) / boxes));
      p.drawer = { boxes: boxes, deep: deep, box: Math.min(boxes - 1, Math.floor(i0 / deep)), slot: Math.min(deep - 1, i0 % deep) };
    } else {
      var slots = Math.max(1, Math.round(w / BOX_W)), per = cfg.positions || slots;
      p.slots = slots;
      p.slot = per <= slots ? Math.min(slots - 1, i0) : Math.min(slots - 1, Math.floor(i0 * slots / per));
    }
    return p;
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
      var cfg = idx.areas[seg.area];
      if (!cfg || !cfg.drawers) return;
      var boxes = Math.max(1, Math.round((seg.u1 - seg.u0) / BOX_W)), deep = Math.max(1, Math.round((cfg.positions || 20) / boxes));
      for (var s = 1; s <= cfg.drawers; s++) for (var b = 0; b < boxes; b++) out.push({ seg: seg, cfg: cfg, shelf: s, box: b, boxes: boxes, deep: deep, key: drawerKey(seg.area, seg.no, s, b) });
    });
    return out;
  }
  function drawerKey(area, bay, shelf, box) { return area + '-' + bay + '-' + shelf + '-' + box; }

  var storage = {
    save: function (st) { try { sessionStorage.setItem(KEY, JSON.stringify(st.items.map(function (x) { return [x.code, x.name, x.qty, x.loc]; }))); return true; } catch (e) { return false; } },
    load: function () {
      try {
        var s = sessionStorage.getItem(KEY);
        return s ? { items: JSON.parse(s).map(function (a) { return { code: a[0], name: a[1], qty: a[2], loc: a[3] }; }) } : null;
      } catch (e) { return null; }
    },
    clear: function () { try { sessionStorage.removeItem(KEY); } catch (e) { /* nothing kept */ } }
  };

  var api = { parse: parse, index: index, place: place, levelBays: levelBays, shelfZ: shelfZ, shelfGap: shelfGap, cellRect: cellRect, drawers: drawers, drawerKey: drawerKey, BOX_W: BOX_W, storage: storage };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FloorStock = api;
})(typeof window !== 'undefined' ? window : this);
