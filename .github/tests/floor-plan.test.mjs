// 3D Floor Plan (Dunstable only): the layout adds up (every bay inside the building, no two bays in the same
// place, every name different), the walk starts somewhere you can stand, and only LB1 gets the tile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { REPO, loadModule } from './load.mjs';

const L = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/floor-plan/data/layout.json'), 'utf8'));
const { list } = loadModule('tools/floor-plan/bays.js');
const bays = list(L);
const { w: W, d: D } = L.building;
const overlap = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.005 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.005;
const rect = (r) => (Array.isArray(r) ? { x0: r[0], y0: r[1], x1: r[2], y1: r[3] } : r);

test('every rack run lists its bay edges in order, starting and ending where the run does', () => {
  for (const r of L.racks) {
    assert.ok(r.edges.length >= 2, r.row + ' needs at least one bay');
    for (let i = 1; i < r.edges.length; i++) assert.ok(r.edges[i] > r.edges[i - 1], r.row + ': edges must go up');
    const [a0, a1] = r.along === 'x' ? [r.x0, r.x1] : [r.y0, r.y1];
    assert.ok(Math.abs(r.edges[0] - a0) < 0.001 && Math.abs(r.edges[r.edges.length - 1] - a1) < 0.001, r.row + ': edges must run from ' + a0 + ' to ' + a1);
    assert.ok(r.x1 > r.x0 && r.y1 > r.y0 && r.h > 0, r.row + ' has a size');
    assert.ok(/^(N|S|E|W|NS|EW)$/.test(r.open), r.row + ': open must say which side you reach it from');
  }
});

test('every bay has its own name', () => {
  assert.ok(bays.length > 90);
  const seen = new Set();
  for (const b of bays) { assert.ok(!seen.has(b.id), 'two bays are called ' + b.id); seen.add(b.id); }
  assert.ok(seen.has('W1') && seen.has('A1b') && seen.has('A1f') && seen.has('C4') && seen.has('K6f') && seen.has('L5'));
});

test('every bay is inside the building, and no two bays, walls or counters are in the same place', () => {
  for (const b of bays) assert.ok(b.x0 >= 0 && b.y0 >= 0 && b.x1 <= W + 0.001 && b.y1 <= D + 0.001, b.id + ' is outside the building');
  for (let i = 0; i < bays.length; i++) for (let j = i + 1; j < bays.length; j++) assert.ok(!overlap(bays[i], bays[j]), bays[i].id + ' and ' + bays[j].id + ' overlap');
  const solid = [...L.walls.map(rect), ...L.columns.map(rect), ...L.objects.filter((o) => ['counter', 'cupboard', 'gondola', 'table', 'worktop', 'desk'].includes(o.kind))];
  for (const b of bays) for (const s of solid) assert.ok(!overlap(b, s), b.id + ' runs into something at ' + JSON.stringify(s));
});

test('the walk starts on a clear bit of floor', () => {
  const R = 0.2, { x, y } = L.start;
  const solid = [...L.walls.map(rect), ...L.columns.map(rect), ...bays];
  assert.ok(x > R && y > R && x < W - R && y < D - R);
  for (const s of solid) assert.ok(!(x > s.x0 - R && x < s.x1 + R && y > s.y0 - R && y < s.y1 + R), 'the start is inside ' + JSON.stringify(s));
});

test('only Dunstable (LB1) gets the tile, and the page checks too', () => {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(REPO, 'tools.js'), 'utf8') + '\nthis.list = TOOLS;', sandbox);
  const tile = sandbox.list.find((t) => t.url === 'tools/floor-plan.html');
  assert.ok(tile, 'the 3D Floor Plan tile is missing');
  assert.deepEqual([...tile.only], ['LB1']);
  assert.match(fs.readFileSync(path.join(REPO, 'tools/floor-plan/app.js'), 'utf8'), /const STORE = 'LB1';/);
});

test('stock locations: every one belongs to a real bay, none is claimed twice, and bay 1 is the middle-aisle end', () => {
  const locs = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/floor-plan/data/locations.json'), 'utf8'));
  const ids = new Set(bays.map((b) => b.id)), claimed = new Map();
  for (const [id, codes] of Object.entries(locs.bays)) {
    assert.ok(ids.has(id), id + ' is not a bay in layout.json');
    for (const c of codes) { assert.match(c, /^[A-Z]{3}(-\d\d)?$/); assert.ok(!claimed.has(c), c + ' is on both ' + claimed.get(c) + ' and ' + id); claimed.set(c, id); }
  }
  for (const id of Object.keys(locs.unsure)) assert.ok(locs.bays[id], id + ' is marked unsure but has no location');
  const { attach, where } = loadModule('tools/floor-plan/bays.js');
  assert.equal(where(['AAA-01', 'AAA-02']), 'AAA 1+2');
  const a = attach(list(L), locs), by = Object.fromEntries(a.map((b) => [b.id, b]));
  assert.equal(by.J1f.where, 'AAA 1+2'); assert.equal(by.K6b.where, 'BAB 6'); assert.equal(by.H3f.where, 'AAC 3');
  assert.ok(by.K1f.x0 < by.K6f.x0, 'bay 1 is the middle-aisle (left) end');
  assert.equal(by.D4f.where, 'BBA 1+2'); assert.ok(by.D4f.x0 > by.D1b.x0, 'in the left block bay 1 is at the aisle (right) end');
  assert.equal(by.C4.where, 'BBC 1+2, BBD 1+2'); assert.equal(by.E2.where, 'BBI 3+4, BBK'); assert.equal(by.P1.where, 'LAC 1+2');
  assert.ok(by.L2.holding && by.L4.holding); assert.equal(by.L1.where, 'LAB 1+2'); assert.equal(by.L3.where, 'LAB 3+4');
});

// ---- stock on the shelves (made-up products: the real stock list never goes in the repo, it is public) ----
const FS = loadModule('tools/floor-plan/stock.js');
const LOCS = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/floor-plan/data/locations.json'), 'utf8'));
const withLocs = () => { const bs = list(L); loadModule('tools/floor-plan/bays.js').attach(bs, LOCS); FS.levelBays(bs, LOCS); return bs; };
const REPORT = ['D.A.I.', 'SKU List', 'WHERE Nailed = YES', 'SKU Code\tFind text in SKU Code', 'SKU Definition State', 'SKU Type', 'Description', 'Base Unit Qty', 'Total Qty',
  'Available Qty', 'Unreserved Qty', 'Age Restricted', 'Hazardous', 'Aerosol', 'Non Trolleyable', 'Nailed Location', 'SKU held',
  ['10001', 'COMPLETE', 'HOST', 'Test Screw Pk100', 1, 6, 6, 6, 'NO', 'NO', 'NO', 'NO', 'AAA-01-05-06', 'NO'].join('\t'),
  ['10002', 'COMPLETE', 'HOST', 'Test Bolt', 1, 2, 2, 2, 'NO', 'NO', 'NO', 'NO', 'BAA-1-5-3', 'NO'].join('\t'),
  ['10003', 'COMPLETE', 'HOST', 'No location yet', 1, 2, 2, 2, 'NO', 'NO', 'NO', 'NO', '', 'NO'].join('\t')].join('\n');

test('the stock report is read: product, name, available quantity and location (padded)', () => {
  const r = FS.parse(REPORT);
  assert.equal(r.count, 2); assert.equal(r.noLoc, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(r.items[0])), { code: '10001', name: 'Test Screw Pk100', qty: 6, loc: 'AAA-01-05-06' });
  assert.equal(r.items[1].loc, 'BAA-01-05-03');
  assert.equal(FS.parse('nothing useful here'), null);
});

test('shelves: shelf 10 of the AA_ areas is about chin height, the top shelf is about two people tall, others are even', () => {
  const bs = withLocs(), by = Object.fromEntries(bs.map((b) => [b.id, b]));
  const j = by.J1f;
  assert.equal(j.levels, 15);
  assert.ok(Math.abs(FS.shelfZ(j, 10) - 1.5) < 0.05, 'shelf 10 is ' + FS.shelfZ(j, 10));
  assert.ok(Math.abs(FS.shelfZ(j, 15) - (j.h - 0.2)) < 0.01 && j.h >= 3.5);
  for (let s = 2; s <= 10; s++) assert.ok(Math.abs(FS.shelfZ(j, s) - FS.shelfZ(j, s - 1) - 0.153) < 0.001);
  const k = by.K1f; // BAA has 10 shelves spread evenly
  const gaps = []; for (let s = 2; s <= 10; s++) gaps.push(FS.shelfZ(k, s) - FS.shelfZ(k, s - 1));
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 0.001 && gaps[0] > 0.3);
});

test('locations land on the right bay, slice and drawer', () => {
  const bs = withLocs(), idx = FS.index(bs, LOCS), P = (loc) => FS.place(idx, loc);
  const a = P('AAA-01-05-06'), b = P('AAA-02-05-06'), c = P('AAA-09-05-06');
  assert.equal(a.seg.bay.id, 'J1f'); assert.equal(b.seg.bay.id, 'J1f'); assert.equal(c.seg.bay.id, 'J5f');
  assert.ok(a.seg.u1 <= b.seg.u0 + 1e-9, 'AAA-01 is the middle-aisle half of J1f');
  assert.deepEqual([a.drawer.boxes, a.drawer.deep, a.drawer.box, a.drawer.slot], [5, 4, 1, 1]);   // half width: 5 drawers of 4
  assert.deepEqual([c.drawer.boxes, c.drawer.deep, c.drawer.box, c.drawer.slot], [10, 2, 2, 1]);  // full width: 10 drawers of 2
  assert.equal(P('AAA-01-01-04').drawer.box, 0); assert.equal(P('AAA-01-01-05').drawer.box, 1);   // 4 deep: 1 to 4 are one drawer
  assert.equal(P('AAC-01-11-02').drawer, null);                                                   // shelf 11 up is not drawers
  assert.equal(P('BBB-01-02-01').seg.bay.id, 'D4b'); assert.equal(P('BBB-08-02-01').seg.bay.id, 'D1b'); // left block counts from the aisle
  assert.equal(P('BBC-01-02-01').seg.face, 'S'); assert.equal(P('BBD-01-02-01').seg.face, 'N');
  assert.equal(P('HAB-01-01-01').seg.bay.id, 'E3b');                                              // area-only codes
  assert.equal(P('ZZZ-01-01-01'), null);
});

test('positions run left to right as you face the shelf, and the front of a drawer faces you', () => {
  const bs = withLocs(), idx = FS.index(bs, LOCS);
  const front = FS.place(idx, 'BAA-01-01-01').seg, back = FS.place(idx, 'BAB-01-01-01').seg;   // K1f faces south, K1b faces north
  const x = (seg, i) => FS.cellRect(seg, i, 10, 0, 1).x0;
  assert.ok(x(front, 0) < x(front, 9) && x(back, 0) > x(back, 9));
  const f = FS.cellRect(front, 0, 1, 0, 2), r = FS.cellRect(front, 0, 1, 1, 2);
  assert.ok(f.y0 > r.y0, 'front slot is the one nearer the shop floor on a south-facing bay');
});

test('every drawer sits inside its bay and no two drawers overlap', () => {
  const bs = withLocs(), idx = FS.index(bs, LOCS), ds = FS.drawers(idx);
  assert.ok(ds.length > 2500);
  const seen = new Set();
  for (const d of ds) {
    assert.ok(!seen.has(d.key), 'duplicate drawer ' + d.key); seen.add(d.key);
    const r = FS.cellRect(d.seg, d.box, d.boxes, 0, 1), b = d.seg.bay;
    assert.ok(r.x0 >= b.x0 - 1e-6 && r.x1 <= b.x1 + 1e-6 && r.y0 >= b.y0 - 1e-6 && r.y1 <= b.y1 + 1e-6, d.key + ' is outside ' + b.id);
  }
});
