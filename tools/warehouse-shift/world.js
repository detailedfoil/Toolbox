/* Warehouse Shift: the made-up warehouse and where every product sits. Shared by the page (game.js) and the tests.

   detailedfoil can't publish his store's real layout, so this one is invented, a bit bigger than the real Dunstable
   store (21.9 x 24.25 m inside against 19.6 x 21.2 m), with wider aisles so the labels are easier to read. What is
   copied from the 3D Floor Plan: the location numbering (AREA-BAY-SHELF-POSITION, AAC-01-12-06: bay 1 at the centre
   aisle end, shelf 1 at the bottom, positions counted from the LEFT as you face the shelf; a double tray holds
   positions front then back, a quad tray four from front to back), shelf heights (AA_ trays 15.3 cm apart up to
   chin height, the top shelf 20 cm under the 3.6 m racking) and the shop floor (trade counter, tills, gondolas,
   Trade+), moved into the front right corner (detailedfoil: "not completely in the middle").

   Plan coordinates are metres: x across from the inside of the left wall, y from the inside of the back wall
   towards the shop front, z up. One straight centre aisle runs from the back walkway to the front. The right side
   holds the small parts and boxed stock, front to back: AAA (quad trays), AAB to AAE (double trays on the bottom ten
   shelves), BAA to BAG. The left side holds the bulky stock, BBA nearest the front to BBJ at the back. Every pick aisle has stock on
   both sides. A pick list is sorted AA, BA, then BBJ down to BBA, so it walks you up the right side and back down
   the left (detailedfoil's order). The first area of each aisle is on your right as you walk in from the centre aisle.

   build(catalogue) -> the world: faces, aisles, locations, the products on them, the shop floor and what blocks
   walking. Products come from data/catalogue.json (made by .github/warehouse-shift/make-catalogue.py): all 10,999
   nailed products, sized T (tray), S (shelf) or B (bulky). The same seed gives the same warehouse on every phone, so
   it can be learnt. */
(function (root) {
  'use strict';

  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  /* ---------- sizes, metres ---------- */
  var BAY = 1.35;                     // one bay of racking
  var NBAYS = 7;                      // bays in a row
  var GAP = 0.25;                     // racking to the side walls
  var AISLE = 2.5;                    // the centre aisle
  var PICK = 1.35;                    // the aisles between rows (a real one is about 0.9)
  var BACK = 1.7;                     // the walkway along the back wall
  var RACK_H = 3.6, TOP = 3.4;        // racking height, top shelf
  var POST = 0.06;                    // upright frames
  var SPINE = 0.05;                   // the gap between the two faces of a back-to-back row
  var DEEP = { AA: 0.5, BA: 0.5, BB: 0.65 };
  var LX0 = GAP, LX1 = GAP + NBAYS * BAY;            // left block: 0.25 to 9.70
  var RX0 = LX1 + AISLE, RX1 = RX0 + NBAYS * BAY;    // right block: 12.20 to 21.65
  var W = RX1 + GAP;                                  // 21.90
  var H = 6.0, WT = 0.25;                             // eaves, wall thickness
  var DX = W - 17.64 + 14.87 - 14.87;                 // (kept for reading: see SHOP below)

  /* ---------- what each area holds ---------- */
  // AA_: 16 shelves, the bottom 10 are trays (AAA quad trays in half-width bays, the rest double trays), the 6 above
  // are plain shelves of small boxes. BA_: 9 shelves of 9 small-item positions. BB_: 5 long-span levels of bulky
  // stock, 3 big positions on the bottom level and 4 on the others.
  var AREAS = {};
  AREAS.AAA = { kind: 'AA', half: true, deep: 4, trays: 5, upper: 4 };
  ['AAB', 'AAC', 'AAD', 'AAE'].forEach(function (a) { AREAS[a] = { kind: 'AA', deep: 2, trays: 6, upper: 9 }; });
  ['BAA', 'BAB', 'BAC', 'BAD', 'BAE', 'BAF', 'BAG'].forEach(function (a) { AREAS[a] = { kind: 'BA', cells: 9 }; });
  ['BBA', 'BBB', 'BBC', 'BBD', 'BBE', 'BBF', 'BBG', 'BBH', 'BBI', 'BBJ'].forEach(function (a) { AREAS[a] = { kind: 'BB', cells: [3, 4, 4, 4, 4] }; });
  var SHELVES = { AA: 16, BA: 9, BB: 5 }, TRAY_SHELVES = 10, PITCH = 0.153, TRAY_H = 0.095;

  // the rows: right side from the front, left side from the back. s = the face that looks south (you stand south
  // of it), n = the face that looks north.
  var RIGHT = [{ n: 'AAA' }, { s: 'AAB', n: 'AAC' }, { s: 'AAD', n: 'AAE' }, { s: 'BAA', n: 'BAB' }, { s: 'BAC', n: 'BAD' }, { s: 'BAE', n: 'BAF' }, { s: 'BAG' }];
  // the left side from the back: BBA is the row nearest the front, BBB next, and so on to BBJ at the back (detailedfoil, 19 Nov 2026)
  var LEFT = [{ s: 'BBJ' }, { s: 'BBH', n: 'BBI' }, { s: 'BBF', n: 'BBG' }, { s: 'BBD', n: 'BBE' }, { s: 'BBB', n: 'BBC' }, { n: 'BBA' }];
  // the order a pick list walks: up the right side, then back down the left from BBJ at the back to BBA at the front
  var WALK = ['AAA', 'AAB', 'AAC', 'AAD', 'AAE', 'BAA', 'BAB', 'BAC', 'BAD', 'BAE', 'BAF', 'BAG', 'BBJ', 'BBI', 'BBH', 'BBG', 'BBF', 'BBE', 'BBD', 'BBC', 'BBB', 'BBA'];
  var HALFGAP = 0.06;                 // extra space each side of the middle of a half-width bay (AAA-01 | AAA-02)

  function shelfZ(kind, s) {
    if (kind === 'AA') {
      var z10 = 0.12 + (TRAY_SHELVES - 1) * PITCH;
      return s <= TRAY_SHELVES ? 0.12 + (s - 1) * PITCH : z10 + (s - TRAY_SHELVES) * (TOP - z10) / (SHELVES.AA - TRAY_SHELVES);
    }
    return 0.12 + (s - 1) * (TOP - 0.12) / (SHELVES[kind] - 1);
  }
  // the room above a shelf: up to the next one, or the top of the racking
  function shelfTop(kind, s) { return s < SHELVES[kind] ? shelfZ(kind, s + 1) : RACK_H; }
  function rowDepth(r, kind) { return (r.s && r.n ? 2 * DEEP[kind] + SPINE : DEEP[kind] + SPINE); }

  /* ---------- a small, repeatable random number source ---------- */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  /* ---------- the racking ---------- */
  function racking() {
    var rows = [], faces = [], aisles = [];
    var kindOf = function (r) { return AREAS[r.s || r.n].kind; };
    var depthR = 0;
    RIGHT.forEach(function (r, i) { depthR += rowDepth(r, kindOf(r)) + (i < RIGHT.length - 1 ? PICK : 0); });
    var RF = BACK + depthR; // the front of the right block
    // right side: from the front edge going back
    var y = RF;
    RIGHT.forEach(function (r, i) {
      var k = kindOf(r), d = rowDepth(r, k);
      rows.push({ side: 'R', i: i, kind: k, x0: RX0, x1: RX1, y0: y - d, y1: y, s: r.s || null, n: r.n || null });
      y -= d + PICK;
    });
    y = BACK;
    LEFT.forEach(function (r, i) {
      var k = kindOf(r), d = rowDepth(r, k);
      rows.push({ side: 'L', i: i, kind: k, x0: LX0, x1: LX1, y0: y, y1: y + d, s: r.s || null, n: r.n || null });
      y += d + PICK;
    });
    var LF = y - PICK; // the front of the left block
    rows.forEach(function (row) {
      var k = row.kind, dp = DEEP[k];
      if (row.s) faces.push(face(row.s, row, 'S', row.y1 - dp, row.y1));
      if (row.n) faces.push(face(row.n, row, 'N', row.y0, row.y0 + dp));
    });
    // the pick aisles, numbered in walking order (right side from the front, then left side from the back)
    var R = rows.filter(function (r) { return r.side === 'R'; }), Lr = rows.filter(function (r) { return r.side === 'L'; });
    for (var i = 0; i + 1 < R.length; i++) aisles.push(aisle('R', aisles.length + 1, R[i], R[i + 1], R[i].n, R[i + 1].s, RX0, RX1));
    for (var j = 0; j + 1 < Lr.length; j++) aisles.push(aisle('L', aisles.length + 1, Lr[j + 1], Lr[j], Lr[j].s, Lr[j + 1].n, LX0, LX1));
    var byCode = {};
    faces.forEach(function (f) { byCode[f.area] = f; });
    aisles.forEach(function (a) { a.faces = a.codes.map(function (c) { byCode[c].aisle = a; return byCode[c]; }); });
    // the arrow on the sign at the centre-aisle end of each face's row: 1 = to the right as you look at the sign, -1 =
    // left. Facing a right-side row end you look east (south on your right); facing a left-side one you look west.
    faces.forEach(function (f) { f.arrow = (f.side === 'R') === (f.facing === 'S') ? 1 : -1; });
    return { rows: rows, faces: faces, aisles: aisles, byCode: byCode, RF: RF, LF: LF };
  }
  // south row first: the aisle runs between the north edge of `south` and the south edge of `north`.
  // `first` is the face on your right as you walk in from the centre aisle.
  function aisle(side, no, south, north, first, second, x0, x1) {
    return { side: side, no: no, x0: x0, x1: x1, y0: north.y1, y1: south.y0, codes: [first, second],
      mouth: side === 'R' ? x0 : x1, cy: (north.y1 + south.y0) / 2 };
  }
  function face(code, row, facing, y0, y1) {
    var cfg = AREAS[code], k = cfg.kind, n = cfg.half ? NBAYS * 2 : NBAYS, w = (row.x1 - row.x0) / n;
    var f = { area: code, kind: k, cfg: cfg, side: row.side, row: row, facing: facing, y0: y0, y1: y1,
      front: facing === 'S' ? y1 : y0, back: facing === 'S' ? y0 : y1, out: facing === 'S' ? 1 : -1,
      x0: row.x0, x1: row.x1, psign: facing === 'S' ? 1 : -1, bays: [], shelves: [] };
    // bay 1 is at the centre aisle end: the right block's west end, the left block's east end
    for (var b = 0; b < n; b++) {
      var bx0 = row.side === 'R' ? row.x0 + b * w : row.x1 - (b + 1) * w;
      // the usable width between the upright frames: drawn bays have a frame at each end; a half-width bay only
      // on its outer end (the two halves share one bay of racking)
      var drawn = cfg.half ? Math.floor(b / 2) : b, dx0 = row.side === 'R' ? row.x0 + drawn * BAY : row.x1 - (drawn + 1) * BAY;
      var ux0 = Math.max(bx0, dx0 + POST / 2 + 0.035), ux1 = Math.min(bx0 + w, dx0 + BAY - POST / 2 - 0.035);
      if (cfg.half) { // a little space between the two halves that share a bay, so the locations are easy to tell apart
        var first = b % 2 === 0;
        if ((row.side === 'R') === first) ux1 -= HALFGAP; else ux0 += HALFGAP;
      }
      f.bays.push({ no: b + 1, x0: bx0, x1: bx0 + w, ux0: ux0, ux1: ux1, drawn: drawn });
    }
    for (var s = 1; s <= SHELVES[k]; s++) {
      var tray = k === 'AA' && s <= TRAY_SHELVES;
      var cells = tray ? cfg.trays * cfg.deep : k === 'AA' ? cfg.upper : Array.isArray(cfg.cells) ? cfg.cells[s - 1] : cfg.cells;
      f.shelves.push({ no: s, z: shelfZ(k, s), top: shelfTop(k, s), tray: tray, cells: cells, trays: tray ? cfg.trays : 0, deep: tray ? cfg.deep : 1 });
    }
    return f;
  }

  /* ---------- every location ---------- */
  // A location: {code, face, bay, shelf, pos, tray: index of its tray from the left (trays only), slot: 0 = front,
  // x0, x1 (its width along the row), d0, d1 (how far back from the front edge it reaches), z0 (the shelf),
  // z1 (the shelf above), cls: T / S / B (what size of product it's for)}.
  function locations(rk) {
    var list = [], byCode = {};
    rk.faces.forEach(function (f) {
      var dp = DEEP[f.kind];
      f.bays.forEach(function (b) {
        var uw = b.ux1 - b.ux0;
        f.shelves.forEach(function (sh) {
          var n = sh.tray ? sh.trays : sh.cells, cw = uw / n;
          for (var c = 0; c < n; c++) { // c counts from the left as you face the shelf
            var x0 = f.psign > 0 ? b.ux0 + c * cw : b.ux1 - (c + 1) * cw;
            for (var j = 0; j < sh.deep; j++) {
              var pos = c * sh.deep + j + 1;
              var code = f.area + '-' + pad2(b.no) + '-' + pad2(sh.no) + '-' + pad2(pos);
              var loc = { code: code, face: f, bay: b, shelf: sh, pos: pos, cell: c, slot: j, tray: sh.tray ? c : -1,
                x0: x0, x1: x0 + cw, d0: j * dp / sh.deep, d1: (j + 1) * dp / sh.deep, z0: sh.z, z1: sh.top,
                cls: sh.tray ? 'T' : f.kind === 'BB' ? 'B' : 'S', item: null };
              list.push(loc); byCode[code] = loc;
            }
          }
        });
      });
    });
    list.sort(function (a, b) {
      var ra = WALK.indexOf(a.face.area), rb = WALK.indexOf(b.face.area);
      if (ra !== rb) return ra - rb;
      return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
    });
    list.forEach(function (l, i) { l.order = i; });
    return { list: list, byCode: byCode };
  }

  /* ---------- the products on them ---------- */
  // Each size of product fills its own kind of location, in walking order, so like sits with like (the catalogue is
  // sorted by group, then name). A spread of spaces is left empty, as in a real store. If one size ever has more
  // products than places, the rest go to the next best kind (small parts onto shelves, bulky onto shelves).
  function stock(locs, items, seed) {
    var r = rng(seed), byCls = { T: [], S: [], B: [] }, want = { T: [], S: [], B: [] };
    locs.list.forEach(function (l) { byCls[l.cls].push(l); });
    items.forEach(function (it) { (want[it.size] || want.S).push(it); });
    var spare = {}, extra = { T: [], S: [], B: [] }, next = { T: ['S', 'B'], S: ['B', 'T'], B: ['S', 'T'] };
    ['T', 'S', 'B'].forEach(function (c) {
      var cap = byCls[c].length;
      if (want[c].length > cap) { extra[c] = want[c].slice(cap); want[c] = want[c].slice(0, cap); }
      spare[c] = cap - want[c].length;
    });
    ['T', 'S', 'B'].forEach(function (c) {
      extra[c].forEach(function (it) {
        for (var k = 0; k < 2; k++) { var to = next[c][k]; if (spare[to] > 0) { want[to].push(it); spare[to]--; return; } }
      });
    });
    var placed = [];
    ['T', 'S', 'B'].forEach(function (c) {
      var L = byCls[c], P = want[c], free = L.length - P.length, empty = {};
      // pick which spaces stay empty: a shuffle of the indexes, the first `free` of them
      var idx = L.map(function (_, i) { return i; });
      for (var i = idx.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
      for (var k = 0; k < free; k++) empty[idx[k]] = 1;
      var p = 0;
      for (var q = 0; q < L.length && p < P.length; q++) {
        if (empty[q]) continue;
        L[q].item = P[p]; P[p].loc = L[q]; placed.push(P[p]); p++;
      }
    });
    placed.sort(function (a, b) { return a.loc.order - b.loc.order; });
    return placed;
  }

  /* ---------- the shop floor and everything else ---------- */
  // The trade counter, Trade+ and their shelving are the 3D Floor Plan's (tools/floor-plan/data/layout.json), moved
  // so Trade+ sits in the front right corner: real x + SX, y + SY. The staff room and toilets keep their x.
  var SY = 3.05, SX = W - 2.77 - 14.87;
  function rect(x0, y0, x1, y1) { return { x0: x0, y0: y0, x1: x1, y1: y1 }; }
  function shop(o) { var c = {}; for (var k in o) c[k] = o[k]; if ('x0' in c) { c.x0 += SX; c.x1 += SX; c.y0 += SY; c.y1 += SY; } if (c.edges) c.edges = c.edges.map(function (e) { return e + (c.along === 'y' ? SY : SX); }); return c; }
  function staff(o) { var c = {}; for (var k in o) c[k] = o[k]; if ('y0' in c) { c.y0 += SY; c.y1 += SY; } return c; }

  // carton slots: a roll cage takes 2 deep x 3 high, a pallet 2 x 2 a layer, 3 layers
  function cageSlots(c) {
    var out = [], w = c.x1 - c.x0 - 0.16, d = (c.y1 - c.y0 - 0.16) / 2;
    for (var k = 0; k < 3; k++) for (var j = 0; j < 2; j++) out.push({ x0: c.x0 + 0.08, x1: c.x0 + 0.08 + w, y0: c.y0 + 0.08 + j * d + 0.01, y1: c.y0 + 0.08 + (j + 1) * d - 0.01, z0: 0.16 + k * 0.52, z1: 0.16 + k * 0.52 + 0.42 });
    return out;
  }
  function palletSlots(p) {
    var out = [], cw = (p.x1 - p.x0) / 2, cd = (p.y1 - p.y0) / 2;
    for (var k = 0; k < 3; k++) for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) out.push({ x0: p.x0 + i * cw + 0.01, x1: p.x0 + (i + 1) * cw - 0.01, y0: p.y0 + j * cd + 0.01, y1: p.y0 + (j + 1) * cd - 0.01, z0: 0.14 + k * 0.28, z1: 0.14 + k * 0.28 + 0.26 });
    return out;
  }
  function building(rk) {
    var D = 21.2 + SY;
    var b = { w: W, d: D, h: H, t: WT };
    var openings = [
      { wall: 'back', from: 0.8, to: 1.66, type: 'exit', h: 2.1, name: 'Fire exit' },
      { wall: 'front', from: 2.4, to: 3.2, type: 'exit', h: 2.1, name: 'Fire exit' },
      { wall: 'front', from: 5.6, to: 9.2, type: 'shutter', h: 4.0, name: 'Goods in' },
      { wall: 'front', from: 10.4 + SX, to: 11.65 + SX, type: 'glass', h: 2.85 },
      { wall: 'front', from: 11.65 + SX, to: 12.55 + SX, type: 'entrance', h: 2.85, name: 'Entrance' },
      { wall: 'front', from: 12.55 + SX, to: 13.2 + SX, type: 'glass', h: 2.85 },
      { wall: 'right', from: 9.0, to: 9.86, type: 'exit', h: 2.1, name: 'Fire exit' }
    ];
    var walls = [
      // staff room and toilets (front left)
      [0, 13.9, 3.29, 14.08], [3.15, 14.08, 3.29, 14.35], [3.15, 15.15, 3.29, 17.99], [0, 17.81, 3.29, 17.99], [0, 18.95, 2.31, 19.13],
      [2.15, 17.99, 2.31, 18.15], [2.15, 18.9, 2.31, 19.15], [2.15, 19.95, 2.31, 21.2]
    ].map(function (w) { return [w[0], w[1] + SY, w[2], w[3] + SY]; });
    // the shop: goods in on its left, Trade+ on its right, the office tucked between goods in and the shop
    // (the wall down the middle of the shop floor, between the trade counter and Trade+, was taken out: detailedfoil, 20 Nov 2026)
    walls.push([9.49 + SX, 14.75 + SY, 9.65 + SX, D]);
    var OX0 = 9.49 + SX - 1.95, OY0 = D - 3.3;
    walls.push([OX0 - 0.15, OY0 - 0.15, OX0, D], [OX0, OY0 - 0.15, OX0 + 0.45, OY0], [OX0 + 1.2, OY0 - 0.15, 9.49 + SX, OY0]);
    var rooms = [
      staff({ name: 'Staff room', x0: 0, y0: 14.08, x1: 3.15, y1: 17.81, floor: 'vinyl', ceiling: 2.85 }),
      staff({ name: 'WC', x0: 0, y0: 17.99, x1: 2.15, y1: 18.95, floor: 'vinyl', ceiling: 2.85, small: true }),
      staff({ name: 'Accessible WC', x0: 0, y0: 19.13, x1: 2.15, y1: 21.2, floor: 'vinyl', ceiling: 2.85, small: true }),
      // one big shop floor right across to the right-hand wall (detailedfoil, 20 Nov 2026)
      shop({ name: 'Trade counter', x0: 9.65, y0: 15.5, x1: 17.64, y1: 21.2, floor: 'tile', ceiling: 2.85 }),
      { name: 'Office', x0: OX0, y0: OY0, x1: 9.49 + SX, y1: D, floor: 'vinyl', ceiling: 2.85, small: true }
    ];
    var objects = [
      shop({ kind: 'heater', name: 'Heater', x0: 10.1, y0: 13.73, x1: 17.2, y1: 14.5, z0: 3.5, z1: 3.85 }),
      // the one long counter, the left-hand wall to 0.9 m short of the right-hand wall (the gap staff walk through), with
      // 4 tills (detailedfoil, 20 Nov 2026). From behind it: the queue to be served on your right (the left-hand wall end),
      // customers who've paid or checked in waiting on your left, by the gap. The last till, by the gap, is Sam's.
      shop({ kind: 'counter', name: 'Trade counter', x0: 9.65, y0: 14.95, x1: 16.74, y1: 15.5 }),
      shop({ kind: 'till', x0: 11.18, y0: 15.05, x1: 11.5, y1: 15.3 }), shop({ kind: 'till', x0: 12.48, y0: 15.05, x1: 12.8, y1: 15.3 }),
      shop({ kind: 'till', x0: 13.78, y0: 15.05, x1: 14.1, y1: 15.3 }), shop({ kind: 'till', x0: 15.08, y0: 15.05, x1: 15.4, y1: 15.3 }),
      shop({ kind: 'gondola', x0: 9.65, y0: 17.6, x1: 10.25, y1: 20.42, z1: 1.8, along: 'y', edges: [17.6, 18.41, 19.41, 20.42], open: 'E' }),
      // ONE row of shelves in the middle of the floor (detailedfoil, 21 Nov 2026): the queue to be served stands on one side of
      // it, customers waiting for orders they've paid for on the other, so it's easy to see which is which
      shop({ kind: 'gondola', x0: 12.65, y0: 17.0, x1: 13.75, y1: 20.4, z1: 1.5, along: 'y', edges: [17.0, 18.13, 19.27, 20.4], open: 'EW' }),
      shop({ kind: 'gondola', x0: 17.05, y0: 17.6, x1: 17.6, y1: 20.62, z1: 1.8, along: 'y', edges: [17.6, 18.6, 19.6, 20.62], open: 'W' }),
      // staff room and toilets
      staff({ kind: 'table', x0: 0.3, y0: 15.2, x1: 1.0, y1: 16.4, z1: 0.75 }),
      staff({ kind: 'chair', x0: 1.05, y0: 15.4, x1: 1.45, y1: 15.8, face: 'W' }), staff({ kind: 'chair', x0: 1.05, y0: 15.9, x1: 1.45, y1: 16.3, face: 'W' }),
      staff({ kind: 'chair', x0: 0.45, y0: 14.75, x1: 0.85, y1: 15.15, face: 'S' }), staff({ kind: 'chair', x0: 0.45, y0: 16.45, x1: 0.85, y1: 16.85, face: 'N' }),
      staff({ kind: 'worktop', x0: 0.15, y0: 17.2, x1: 3.1, y1: 17.81, z1: 0.9 }), staff({ kind: 'sink', x0: 0.35, y0: 17.3, x1: 1.0, y1: 17.7 }),
      staff({ kind: 'wc', x0: 0.1, y0: 18.4, x1: 0.7, y1: 18.78, face: 'E' }), staff({ kind: 'basin', x0: 1.1, y0: 18.0, x1: 1.45, y1: 18.3 }),
      staff({ kind: 'wc', x0: 0.6, y0: 20.6, x1: 0.98, y1: 21.18, face: 'N' }), staff({ kind: 'basin', x0: 0.02, y0: 19.6, x1: 0.37, y1: 20.0 }),
      // the office
      { kind: 'desk', x0: OX0 + 0.1, y0: D - 0.75, x1: 9.49 + SX - 0.1, y1: D - 0.05, z1: 0.75 },
      { kind: 'chair', x0: OX0 + 0.75, y0: D - 1.25, x1: OX0 + 1.15, y1: D - 0.85, face: 'S' },
      { kind: 'cupboard', name: 'Cupboard', x0: OX0 + 0.05, y0: OY0 + 0.05, x1: OX0 + 0.55, y1: OY0 + 0.6, z1: 1.2 },
      // goods in and the warehouse
      { kind: 'cupboard', name: 'Electrics', x0: 3.5, y0: D - 0.3, x1: 4.75, y1: D, z1: 2.0 },
      { kind: 'cage', name: 'Cage', x0: OX0 - 0.75, y0: OY0 - 0.15 - 0.62, x1: OX0 - 0.15, y1: OY0 - 0.15, z1: 1.8 },
      { kind: 'panel', x0: 2.0, y0: 0, x1: 2.07, y1: 0.52, z1: 3.0 }, { kind: 'panel', x0: W - 2.07, y0: 0, x1: W - 2.0, y1: 0.57, z1: 3.0 }
    ];
    // roll cages waiting at goods in, and a pallet or two of deliveries
    var cages = [], pallets = [];
    for (var i = 0; i < 4; i++) cages.push({ kind: 'rollcage', x0: 5.0 + i * 0.85, y0: D - 2.6, x1: 5.72 + i * 0.85, y1: D - 1.8, z1: 1.75 });
    pallets.push({ kind: 'pallet', x0: 6.2, y0: D - 4.3, x1: 7.4, y1: D - 3.3, z1: 1.3 }, { kind: 'pallet', x0: 7.8, y0: D - 4.3, x1: 9.0, y1: D - 3.3, z1: 0.9 });
    objects = objects.concat(cages, pallets);
    // the delivery waits on these to be put away (detailedfoil, 20 Nov 2026): each roll cage and pallet holds cartons in slots
    var goodsin = cages.map(function (c) { return { kind: 'cage', obj: c, slots: cageSlots(c) }; }).concat(pallets.map(function (p) { return { kind: 'pallet', obj: p, slots: palletSlots(p) }; }));
    goodsin.forEach(function (g, i) { var o = g.obj; g.i = i; g.x = (o.x0 + o.x1) / 2; g.stand = { x: g.x, y: o.y0 - 0.5, yaw: 0, alts: [{ x: g.x - 0.35, y: o.y0 - 0.5 }, { x: g.x + 0.35, y: o.y0 - 0.5 }, { x: g.x, y: o.y0 - 0.75 }] }; });
    // the manager's desk in the office: its PC sets what Sam does first (detailedfoil, 20 Nov 2026)
    var desk = objects.find(function (o) { return o.kind === 'desk'; });
    var pc = { x: (desk.x0 + desk.x1) / 2 + 0.25, y: desk.y1 - 0.18, z: 1.0, desk: desk };
    // the everyday bits: kick stools at the end of a few aisles, a pallet truck, a stack of totes by the counter,
    // fire extinguishers on the walls, a mop bucket, a notice board and a clock
    // (the red kick stools live at the centre aisle end of every row, in front of its yellow and black end guard: see `stools`)
    var stools = [];
    // one per row end (a back-to-back row has two end guards side by side: one stool between them, detailedfoil 21 Nov 2026)
    rk.rows.forEach(function (r, i) {
      var x = r.side === 'R' ? r.x0 - POST / 2 - 0.35 : r.x1 + POST / 2 + 0.35, y = (r.y0 + r.y1) / 2;
      stools.push({ id: i, area: r.s || r.n, x: x, y: y, home: { x: x, y: y }, by: null });
      objects.push({ kind: 'kickstool', stoolId: i, x0: x - 0.32, y0: y - 0.32, x1: x + 0.32, y1: y + 0.32, z1: 0.7 }); // bigger (detailedfoil, 21 Nov 2026)
    });
    objects.push({ kind: 'stool', x0: 3.9, y0: 0.35, x1: 4.32, y1: 0.77, z1: 0.42 }, { kind: 'stool', x0: 14.3, y0: 0.4, x1: 14.72, y1: 0.82, z1: 0.42 });
    objects.push({ kind: 'pallettruck', x0: 10.35, y0: D - 3.6, x1: 10.9, y1: D - 2.0, z1: 1.2 });
    objects.push({ kind: 'totes', x0: RX0 + 0.35, y0: rk.RF + 0.12, x1: RX0 + 0.95, y1: rk.RF + 0.52, z1: 1.45 });
    objects.push({ kind: 'bucket', x0: 0.35, y0: 0.3, x1: 0.75, y1: 0.7, z1: 0.75 });
    [{ x: 2.35, y: 0.06, f: 'S' }, { x: W - 0.06, y: 10.6, f: 'W' }, { x: 9.75, y: D - 0.06, f: 'N' }, { x: W - 0.06, y: rk.RF - 1.0, f: 'W' }].forEach(function (e) {
      var ax = e.f === 'S' || e.f === 'N';
      objects.push({ kind: 'extinguisher', face: e.f, x0: ax ? e.x - 0.12 : e.x - 0.18, y0: ax ? e.y - 0.18 : e.y - 0.12, x1: ax ? e.x + 0.12 : e.x + 0.06, y1: ax ? e.y + 0.06 : e.y + 0.12, z1: 1.1, wall: true });
    });
    var shopWall = 9.49 + SX;
    // the CCTV monitor (detailedfoil, 21 Nov 2026): it replaces the notice board, bigger, a map of the shop floor (cctv.js)
    // almost the whole width of its wall, the shop's back wall to the office (detailedfoil, 21 Nov 2026: "bigger, almost the whole width")
    objects.push({ kind: 'cctv', face: 'W', x0: shopWall - 0.07, y0: 17.95, x1: shopWall, y1: 20.65, z0: 0.78, z1: 2.4, wall: true });
    objects.push({ kind: 'clock', face: 'W', x0: shopWall - 0.05, y0: 19.05, x1: shopWall, y1: 19.45, z0: 2.46, z1: 2.82, wall: true });
    var zones = [{ name: 'Goods in', x0: 4.7, y0: D - 4.6, x1: 9.9, y1: D - 0.6 }];
    // the holding area, beside goods in against the staff room wall (detailedfoil, 19 Nov 2026): long-span shelving
    // you face from goods in. On your left the bay for big loose items (OC-001 on the floor, OC-002 on the shelf
    // above, labels on the shelf edge), on your right the bay of blue totes, six a shelf on the bottom two shelves
    // (OC-009 to OC-014 at the bottom, on the ground, OC-003 to OC-008 above them, from the left; detailedfoil, 21 Nov 2026), each with an order in a yellow bag.
    // The shelves higher up stay empty.
    var hold = holding(3.3, D - 5.95);
    objects.push(hold.obj);
    var columns = [[5.0, 0, 5.4, 0.45], [(LX1 + RX0) / 2 - 0.2, 0, (LX1 + RX0) / 2 + 0.2, 0.45], [16.9, 0, 17.3, 0.45]];
    var counter = objects[1];
    return { b: b, openings: openings, walls: walls, rooms: rooms, objects: objects, zones: zones, columns: columns, counter: counter, D: D, holding: hold, goodsin: goodsin, pc: pc, stools: stools };
  }
  // x0 = the back of the shelving (against the wall), y0 = its end nearest the back of the building. It faces +x:
  // standing in front of it you look towards the left wall, so your left is towards the shop front (bigger y).
  function holding(x0, y0) {
    var DEPTH = 0.62, P = 0.06, TOTE_BAY = 2.6, BIG_BAY = 1.6;
    var front = x0 + DEPTH;
    var yT0 = y0, yT1 = y0 + P + TOTE_BAY + P / 2, yB1 = yT1 + BIG_BAY + P / 2;
    var decks = [0.75, 1.4, 2.05], low = 0.1, top = 2.45;
    var spots = [];
    // the big items bay (your left): OC-001 on the floor, OC-002 on the first shelf
    var bigA = yT1 + P / 2, bigB = yB1 - P;
    spots.push({ code: 'OC-001', kind: 'floor', y0: bigA + 0.08, y1: bigB - 0.08, z0: 0, z1: decks[0] - 0.12, label: { z: 0.1 } });
    spots.push({ code: 'OC-002', kind: 'shelf', y0: bigA + 0.08, y1: bigB - 0.08, z0: decks[0], z1: decks[1] - 0.12, label: { z: decks[0] - 0.035 } });
    // the tote bay: positions from the left as you face it, so from the bigger y end
    var tA = y0 + P, tB = yT1 - P / 2, tw = (tB - tA) / 6;
    [low, decks[0]].forEach(function (z, row) {
      for (var i = 0; i < 6; i++) {
        var yr = tB - i * tw;
        spots.push({ code: 'OC-0' + pad2((row ? 3 : 9) + i), kind: 'tote', y0: yr - tw + 0.012, y1: yr - 0.012, z0: z, z1: z + 0.32 });
      }
    });
    spots.forEach(function (sp) { sp.x0 = x0 + 0.04; sp.x1 = front - 0.02; });
    return { x0: x0, x1: front, y0: y0, y1: yB1, front: front, decks: decks, low: low, top: top, post: P, split: yT1, spots: spots,
      obj: { kind: 'holding', name: 'Holding area', x0: x0, y0: y0, x1: front, y1: yB1, z1: top } };
  }

  /* ---------- walking ---------- */
  var BLOCKS = { holding: 1, counter: 1, cupboard: 1, cage: 1, panel: 1, gondola: 1, table: 1, worktop: 1, desk: 1, wc: 1, rollcage: 1, pallet: 1, stool: 1, kickstool: 1, pallettruck: 1, totes: 1, bucket: 1 };
  function obstacles(rk, bl) {
    var out = [];
    rk.rows.forEach(function (r) { out.push(rect(r.x0, r.y0, r.x1, r.y1)); });
    bl.walls.forEach(function (w) { out.push(rect(w[0], w[1], w[2], w[3])); });
    bl.columns.forEach(function (c) { out.push(rect(c[0], c[1], c[2], c[3])); });
    bl.objects.forEach(function (o) {
      if (!BLOCKS[o.kind]) return;
      var bounds = rect(o.x0, o.y0, o.x1, o.y1);
      if (o.kind === 'kickstool') {
        var dx = (o.x1 - o.x0) / 4, dy = (o.y1 - o.y0) / 4;
        bounds.walk = rect(o.x0 + dx, o.y0 + dy, o.x1 - dx, o.y1 - dy);
        bounds.stool = bl.stools[o.stoolId];
      }
      out.push(bounds);
    });
    return out;
  }

  /* ---------- a scan: which location is at this spot on a shelf face ---------- */
  // x along the row, z height, both where the line from the scanner meets the face's front edge. A location's label
  // sits just under its shelf, so the strip from just under one shelf to just under the next belongs to it. Trays
  // answer with their front position (the whole tray scans as one).
  function locationAt(world, f, x, z) {
    if (x < f.x0 || x > f.x1 || z < 0 || z > RACK_H) return null;
    var bay = null;
    for (var i = 0; i < f.bays.length; i++) if (x >= f.bays[i].x0 && x <= f.bays[i].x1) { bay = f.bays[i]; break; }
    if (!bay) return null;
    var sh = null;
    for (var s = f.shelves.length - 1; s >= 0; s--) {
      var below = f.shelves[s].tray ? 0.025 : 0.085;
      if (z >= f.shelves[s].z - below) { sh = f.shelves[s]; break; }
    }
    if (!sh) sh = f.shelves[0];
    var n = sh.tray ? sh.trays : sh.cells, uw = bay.ux1 - bay.ux0;
    var c = Math.floor((f.psign > 0 ? x - bay.ux0 : bay.ux1 - x) / uw * n);
    c = Math.max(0, Math.min(n - 1, c));
    return world.locs.byCode[f.area + '-' + pad2(bay.no) + '-' + pad2(sh.no) + '-' + pad2(c * sh.deep + 1)] || null;
  }
  // two locations count as the same scan if they're the same place, or in the same tray
  function sameSpot(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    return a.tray >= 0 && a.face === b.face && a.bay === b.bay && a.shelf === b.shelf && a.tray === b.tray;
  }

  /* ---------- orders ---------- */
  // A customer's order: 1 to 5 different products (mostly 1 to 3), sorted by location so the scanner walks you up the
  // right side and back down the left. Quantities look like real ones: a few small parts, back boxes by the ten, one
  // of anything big.
  function quantity(it, r) {
    var u = r();
    if (it.group === 'backbox') return [10, 20, 25, 50][Math.floor(u * 4)];
    if (it.size === 'T') return u < 0.45 ? 1 : u < 0.7 ? 2 : u < 0.82 ? 3 : u < 0.9 ? 4 : u < 0.96 ? 5 : 10;
    if (it.size === 'S') return u < 0.72 ? 1 : u < 0.92 ? 2 : 3;
    return u < 0.88 ? 1 : 2;
  }
  // stock (detailedfoil, 21 Nov 2026): every place holds a few of its product, picks take them off, and a pick that takes
  // the last of them leaves the place empty (the product goes out of stock until a delivery brings it back, into an EMPTY
  // place). `it.stock` is how many are there now, `it.reserved` how many are promised to orders on the list.
  function stockOf(it) {
    var u = (hash(it.code + 'stock') % 1000) / 1000;
    return it.size === 'T' ? 3 + Math.floor(u * 22) : it.size === 'B' ? 2 + Math.floor(u * 4) : 2 + Math.floor(u * 8);
  }
  function room(it) { if (it.stock === undefined) it.stock = stockOf(it); return it.stock - (it.reserved || 0); }
  // takes the product off its place (it's out of stock): the place is empty
  function vacate(world, it) {
    if (!it.loc) return;
    it.old = it.loc; it.loc.item = null; it.loc = null; it.stock = 0; it.reserved = 0;
    (world.out = world.out || []).push(it);
  }
  // puts a product into an empty place
  function place(world, it, loc, n) {
    it.loc = loc; loc.item = it; it.stock = n; it.reserved = 0;
    if (world.out) { var k = world.out.indexOf(it); if (k >= 0) world.out.splice(k, 1); }
  }
  // an empty place of the product's own kind, in the same row as where it was (so it goes back to its own part of the
  // store), a different one if there is one; `taken` are places already promised to other cartons
  function emptyFor(world, it, taken, r) {
    var old = it.old, cands = [];
    if (!old) return null;
    world.locs.list.forEach(function (l) {
      if (l.item || taken[l.code] || l.face !== old.face || l.cls !== old.cls) return;
      cands.push(l);
    });
    cands.sort(function (a, b) { return Math.abs(a.order - old.order) - Math.abs(b.order - old.order); });
    var diff = cands.filter(function (l) { return l !== old; });
    var from = (diff.length ? diff : cands).slice(0, 5);
    return from.length ? from[Math.floor(r() * from.length)] : null;
  }
  function order(world, r, n) {
    var items = world.items, lines = [], seen = {};
    if (!n) { var u = r(); n = u < 0.28 ? 1 : u < 0.6 ? 2 : u < 0.82 ? 3 : u < 0.94 ? 4 : 5; }
    var guard = 0;
    while (lines.length < n && guard++ < 1000) {
      var it = items[Math.floor(r() * items.length)];
      if (seen[it.code] || !it.loc || room(it) < 1) continue;
      seen[it.code] = 1;
      lines.push({ item: it, loc: it.loc, qty: Math.min(quantity(it, r), room(it)) });
    }
    lines.sort(function (a, b) { return a.loc.order - b.loc.order; });
    return lines;
  }

  /* ---------- the whole world ---------- */
  function build(catalogue, seed) {
    var rk = racking(), bl = building(rk), locs = locations(rk);
    var items = (catalogue.items || []).map(function (a) {
      return { code: a[0], name: a[1], group: a[2], size: a[3], colour: a[4] ? parseInt(a[4], 16) : 0xc8b08a, photo: !!a[5], loc: null };
    });
    var placed = stock(locs, items, seed || 20261119);
    var D = bl.D;
    var counter = bl.counter;
    var world = {
      W: W, D: D, H: H, WT: WT, RACK_H: RACK_H, TOP: TOP, POST: POST, DEEP: DEEP, BAY: BAY, AISLE: AISLE, PICK: PICK, BACK: BACK,
      LX0: LX0, LX1: LX1, RX0: RX0, RX1: RX1, RF: rk.RF, LF: rk.LF, TRAY_H: TRAY_H, TRAY_SHELVES: TRAY_SHELVES,
      rows: rk.rows, faces: rk.faces, aisles: rk.aisles, faceOf: rk.byCode,
      locs: locs, items: placed, unplaced: items.length - placed.length,
      building: bl.b, openings: bl.openings, walls: bl.walls, rooms: bl.rooms, objects: bl.objects, zones: bl.zones, columns: bl.columns,
      counter: counter, holding: bl.holding, goodsin: bl.goodsin, pc: bl.pc, stools: bl.stools,
      // the service bell: a big red button on the staff side of the counter (your side, not the customers') (detailedfoil, 19 Nov 2026)
      bell: { x: counter.x0 + 0.9, y: counter.y0, z: 0.62 },
      // stand behind the counter (the warehouse side) to hand an order over; the customer waits on the shop side
      handover: rect(counter.x0 - 0.3, counter.y0 - 1.4, counter.x1 + 0.3, counter.y0),
      customer: { x: (counter.x0 + counter.x1) / 2 + 0.25, y: counter.y1 + 0.42 },
      start: { x: (LX1 + RX0) / 2 + 0.25, y: counter.y0 - 0.75, yaw: 0.04 },
      centre: { x0: LX1, x1: RX0 },
      pad2: pad2
    };
    world.obstacles = obstacles(rk, bl);
    return world;
  }

  var api = { WALK: WALK, build: build, order: order, stockOf: stockOf, room: room, vacate: vacate, place: place, emptyFor: emptyFor, quantity: quantity, locationAt: locationAt, sameSpot: sameSpot, shelfZ: shelfZ, rng: rng, hash: hash, pad2: pad2,
    AREAS: AREAS, SHELVES: SHELVES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShiftWorld = api;
})(typeof window !== 'undefined' ? window : this);
