// Warehouse Shift (Dunstable only): the made-up warehouse adds up. Every nailed product has its own location, the
// locations follow the 3D Floor Plan's numbering, every aisle has stock on both sides, the pick order walks up the
// right side and back down the left, nothing overlaps, and a scan finds the location you aimed at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { REPO, loadModule } from './load.mjs';

const W = loadModule('tools/warehouse-shift/world.js');
const cat = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/data/catalogue.json'), 'utf8'));
const world = W.build(cat);
const overlap = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.005 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.005;

test('the catalogue: every product has a code, a name, a group and a size, and none is listed twice', () => {
  assert.equal(cat.count, cat.items.length);
  assert.ok(cat.items.length > 10000, 'all the nailed products (10,999 on 25 Oct 2026)');
  const seen = new Set();
  for (const [code, name, group, size, colour, photo] of cat.items) {
    assert.match(code, /^[0-9A-Z]{5}$/);
    assert.ok(name && cat.groups.includes(group), code);
    assert.ok(['T', 'S', 'B'].includes(size), code + ' size ' + size);
    assert.ok(colour === '' || /^[0-9a-f]{6}$/.test(colour), code + ' colour ' + colour);
    assert.ok(photo === 0 || photo === 1);
    assert.ok(!seen.has(code), code + ' twice'); seen.add(code);
  }
});

test('every product has a place, and no two share one', () => {
  assert.equal(world.unplaced, 0);
  assert.equal(world.items.length, cat.items.length);
  const used = new Set();
  for (const it of world.items) {
    assert.ok(it.loc, it.code + ' has no location');
    assert.ok(!used.has(it.loc.code), it.loc.code + ' holds two products'); used.add(it.loc.code);
    assert.equal(it.loc.item, it);
  }
  // some spaces are left empty, like a real store
  const free = world.locs.list.filter((l) => !l.item).length;
  assert.ok(free > 500 && free < world.locs.list.length * 0.3, free + ' free');
});

test('locations use the floor plan numbering: AREA-BAY-SHELF-POSITION, bay 1 at the centre aisle, shelf 1 at the bottom', () => {
  for (const l of world.locs.list) {
    assert.match(l.code, /^[A-Z]{3}-\d\d-\d\d-\d\d$/);
    const [area, bay, shelf, pos] = l.code.split('-');
    assert.equal(area, l.face.area); assert.equal(+bay, l.bay.no); assert.equal(+shelf, l.shelf.no); assert.equal(+pos, l.pos);
  }
  for (const f of world.faces) {
    const b1 = f.bays[0], bn = f.bays[f.bays.length - 1];
    if (f.side === 'R') assert.ok(b1.x0 < bn.x0 && Math.abs(b1.x0 - world.RX0) < 0.01, f.area + ': bay 1 at the centre aisle');
    else assert.ok(b1.x1 > bn.x1 && Math.abs(b1.x1 - world.LX1) < 0.01, f.area + ': bay 1 at the centre aisle');
    for (let s = 1; s < f.shelves.length; s++) assert.ok(f.shelves[s].z > f.shelves[s - 1].z, f.area + ': shelves go up');
  }
});

test('positions count from the left as you face the shelf; a tray holds front then back (4 deep in AAA)', () => {
  for (const f of world.faces) {
    const l1 = world.locs.byCode[f.area + '-01-' + (f.kind === 'AA' ? '12' : '02') + '-01'], l2 = world.locs.byCode[f.area + '-01-' + (f.kind === 'AA' ? '12' : '02') + '-02'];
    // facing a south-looking shelf you look north, so your left is west (lower x)
    if (f.facing === 'S') assert.ok(l1.x0 < l2.x0, f.area); else assert.ok(l1.x0 > l2.x0, f.area);
  }
  const a = (c) => world.locs.byCode[c];
  assert.equal(a('AAA-01-05-01').tray, a('AAA-01-05-04').tray, 'AAA: quad trays');
  assert.notEqual(a('AAA-01-05-04').tray, a('AAA-01-05-05').tray);
  assert.ok(a('AAA-01-05-01').slot === 0 && a('AAA-01-05-04').slot === 3, 'front to back');
  assert.equal(a('AAB-02-03-01').tray, a('AAB-02-03-02').tray, 'AAB: double trays');
  assert.notEqual(a('AAB-02-03-02').tray, a('AAB-02-03-03').tray);
  assert.ok(!a('AAB-02-11-01').shelf.tray && a('AAB-02-10-01').shelf.tray, 'trays on the bottom ten shelves only');
  assert.ok(!a('BAA-01-01-01').shelf.tray && !a('BBA-01-01-01').shelf.tray, 'BA and BB have plain shelves');
});

test('every pick aisle has stock on both sides, and the first area is on your right as you walk in', () => {
  assert.equal(world.aisles.length, 11);
  for (const a of world.aisles) {
    assert.equal(a.faces.length, 2);
    const [first, second] = a.faces;
    assert.ok(first.aisle === a && second.aisle === a);
    assert.ok(first.area < second.area, a.no + ': ' + first.area + ' then ' + second.area);
    // walking in from the centre aisle: east on the right side (south on your right), west on the left (north on your right)
    if (a.side === 'R') assert.equal(first.facing, 'N', 'AA/BA aisles: the first face is the one to the south'); else assert.equal(first.facing, 'S');
    for (const f of a.faces) { const width = a.y1 - a.y0; assert.ok(width > 1.2 && width < 1.6, a.no + ' is ' + width.toFixed(2) + ' m wide'); }
  }
});

test('the arrow on each row-end sign points to that area\'s own aisle', () => {
  for (const f of world.faces) {
    const south = f.aisle.cy > f.front; // is the aisle to the south of the face?
    // seen from the centre aisle: on the right side you look east (south = right), on the left side west (north = right)
    const right = f.side === 'R' ? south : !south;
    assert.equal(f.arrow, right ? 1 : -1, f.area);
  }
  assert.equal(world.faceOf.AAA.arrow, -1, 'AAA faces north into aisle 1: left as you look east');
  assert.equal(world.faceOf.AAB.arrow, 1, 'AAB faces south into aisle 1: right as you look east');
  assert.equal(world.faceOf.BBJ.arrow, 1, 'BBJ faces north into aisle 11: right as you look west');
});

test('in location order you walk up the right side (AA then BA) and back down the left (BB)', () => {
  const faces = [...world.faces].sort((p, q) => (p.area < q.area ? -1 : 1));
  const codes = faces.map((f) => f.area);
  assert.deepEqual(codes.slice(0, 5), ['AAA', 'AAB', 'AAC', 'AAD', 'AAE']);
  assert.deepEqual(codes.slice(5, 12), ['BAA', 'BAB', 'BAC', 'BAD', 'BAE', 'BAF', 'BAG']);
  assert.deepEqual(codes.slice(12), ['BBA', 'BBB', 'BBC', 'BBD', 'BBE', 'BBF', 'BBG', 'BBH', 'BBI', 'BBJ']);
  let lastY = Infinity;
  for (const f of faces.filter((x) => x.side === 'R')) { assert.ok(f.front <= lastY + 0.01, f.area + ' is further back'); lastY = f.front; }
  lastY = -Infinity;
  for (const f of faces.filter((x) => x.side === 'L')) { assert.ok(f.front >= lastY - 0.01, f.area + ' is further forward'); lastY = f.front; }
  assert.ok(faces.filter((x) => x.side === 'R').every((f) => f.x0 >= world.RX0 - 0.01), 'AA and BA on the right');
  assert.ok(faces.filter((x) => x.side === 'L').every((f) => f.x1 <= world.LX1 + 0.01 && f.kind === 'BB'), 'BB on the left');
  const r = W.rng(42);
  for (let i = 0; i < 200; i++) {
    const lines = W.order(world, r);
    assert.ok(lines.length >= 1 && lines.length <= 5);
    for (let k = 1; k < lines.length; k++) assert.ok(lines[k - 1].loc.code < lines[k].loc.code, 'sorted by location');
    assert.equal(new Set(lines.map((l) => l.item.code)).size, lines.length, 'no product twice in one order');
    for (const l of lines) assert.ok(l.qty >= 1 && l.qty <= 50);
  }
});

test('nothing overlaps: racking, walls, counters, shop shelving; the building is a bit bigger than the real store', () => {
  const blocks = world.obstacles;
  for (const o of blocks) assert.ok(o.x0 >= -0.01 && o.y0 >= -0.01 && o.x1 <= world.W + 0.01 && o.y1 <= world.D + 0.01, 'inside the building');
  for (let i = 0; i < world.rows.length; i++) for (let j = 0; j < blocks.length; j++) {
    const r = world.rows[i], o = blocks[j];
    if (o.x0 === r.x0 && o.y0 === r.y0 && o.x1 === r.x1 && o.y1 === r.y1) continue;
    assert.ok(!overlap(r, o), 'a row of racking overlaps something at ' + JSON.stringify(o));
  }
  assert.ok(world.W > 19.6 && world.W < 26 && world.D > 21.2 && world.D < 28, world.W + ' x ' + world.D);
  // the centre aisle runs straight down the middle
  const mid = (world.LX1 + world.RX0) / 2;
  assert.ok(Math.abs(mid - world.W / 2) < 0.6, 'centre aisle at ' + mid.toFixed(2) + ' of ' + world.W.toFixed(2));
  // the shop floor is in the front right corner
  const shop = world.rooms.find((r) => r.name === 'Trade+');
  assert.ok(Math.abs(shop.x1 - world.W) < 0.01 && Math.abs(shop.y1 - world.D) < 0.01, 'Trade+ in the corner');
});

test('the walk starts on clear floor, and the counter and every aisle can be reached', () => {
  const BODY = 0.22;
  const free = (x, y) => x > BODY && x < world.W - BODY && y > BODY && y < world.D - BODY && !world.obstacles.some((o) => x > o.x0 - BODY && x < o.x1 + BODY && y > o.y0 - BODY && y < o.y1 + BODY);
  assert.ok(free(world.start.x, world.start.y), 'start');
  // flood fill on a 10 cm grid from the start
  const step = 0.1, nx = Math.ceil(world.W / step), ny = Math.ceil(world.D / step), seen = new Uint8Array(nx * ny), q = [];
  const at = (x, y) => [Math.floor(x / step), Math.floor(y / step)];
  const [sx, sy] = at(world.start.x, world.start.y);
  seen[sy * nx + sx] = 1; q.push([sx, sy]);
  while (q.length) {
    const [i, j] = q.pop();
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= ny || seen[b * nx + a]) continue;
      if (!free((a + 0.5) * step, (b + 0.5) * step)) continue;
      seen[b * nx + a] = 1; q.push([a, b]);
    }
  }
  const reach = (x, y) => { const [i, j] = at(x, y); return !!seen[j * nx + i]; };
  const h = world.handover;
  assert.ok(reach((h.x0 + h.x1) / 2, (h.y0 + h.y1) / 2), 'the counter');
  for (const a of world.aisles) for (const f of [0.15, 0.5, 0.85]) assert.ok(reach(a.x0 + (a.x1 - a.x0) * f, (a.y0 + a.y1) / 2), 'aisle ' + a.no);
  for (const sp of world.holding.spots) assert.ok(reach(world.holding.front + 0.5, (sp.y0 + sp.y1) / 2), 'in front of ' + sp.code);
});

test('a scan finds the location aimed at: the shelf edge label or the tray front', () => {
  let n = 0;
  for (const l of world.locs.list) {
    if (n++ % 7) continue;
    const x = (l.x0 + l.x1) / 2;
    const zLabel = l.tray >= 0 ? l.z0 + 0.05 : l.z0 - (l.face.kind === 'BB' ? 0.05 : 0.034);
    assert.ok(W.sameSpot(W.locationAt(world, l.face, x, zLabel), l), 'label of ' + l.code);
    assert.ok(W.sameSpot(W.locationAt(world, l.face, x, l.z0 + 0.03), l), 'product at ' + l.code);
  }
  assert.equal(W.locationAt(world, world.faces[0], world.faces[0].x0 - 1, 1), null, 'off the end of the row');
});

test('only Dunstable (LB1) gets the tile; the game only uses the Toolbox\'s own photos and draws no floating labels', () => {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(REPO, 'tools.js'), 'utf8') + '\nthis.list = TOOLS;', sandbox);
  const tile = sandbox.list.find((t) => t.name === 'Warehouse Shift');
  assert.ok(tile && tile.url === 'tools/warehouse-shift.html');
  assert.deepEqual([...tile.only], ['LB1']);
  const game = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/game.js'), 'utf8');
  assert.match(game, /me !== STORE/);
  const scene = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/scene.js'), 'utf8');
  assert.ok(!/screwfix\.com/i.test(game + scene), 'never asks Screwfix for photos');
  assert.ok(!/\bSprite\b/.test(scene), 'no labels that float and turn to face you (detailedfoil: nothing floating)');
  // the game used to live at floor-plan.html?shift=1: that address still gets you here
  assert.match(fs.readFileSync(path.join(REPO, 'tools/floor-plan.html'), 'utf8'), /shift[\s\S]{0,80}warehouse-shift\.html/);
});
