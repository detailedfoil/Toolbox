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
    for (const c of codes) { assert.match(c, /^[A-Z]{3}-\d\d$/); assert.ok(!claimed.has(c), c + ' is on both ' + claimed.get(c) + ' and ' + id); claimed.set(c, id); }
  }
  for (const id of Object.keys(locs.unsure)) assert.ok(locs.bays[id], id + ' is marked unsure but has no location');
  const { attach, where } = loadModule('tools/floor-plan/bays.js');
  assert.equal(where(['AAA-01', 'AAA-02']), 'AAA 1+2');
  const a = attach(list(L), locs), by = Object.fromEntries(a.map((b) => [b.id, b]));
  assert.equal(by.J1f.where, 'AAA 1+2'); assert.equal(by.K6b.where, 'BAB 6'); assert.equal(by.H3f.where, 'AAE 1');
  assert.ok(by.K1f.x0 < by.K6f.x0, 'bay 1 is the middle-aisle (left) end');
});
