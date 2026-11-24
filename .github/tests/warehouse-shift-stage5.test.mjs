// Warehouse Shift stage 5 (21 Nov 2026, detailedfoil): the CCTV monitor in place of the notice board (a 2D map of the
// shop floor, counter on the left, door on the right, the two waiting areas pale red and pale green, every customer
// tracked), the same areas marked on the floor, and players drawn as people with their name on the badge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { REPO, loadModule } from './load.mjs';

const W = loadModule('tools/warehouse-shift/world.js');
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
const world = W.build(JSON.parse(read('tools/warehouse-shift/data/catalogue.json')));

// a pretend canvas that remembers the text written on it
function fakeCanvas(w, h) {
  const texts = [];
  const g = new Proxy({ texts, measureText: (t) => ({ width: String(t).length * 8 }), createRadialGradient: () => ({ addColorStop() {} }), fillText: (t, x, y) => texts.push({ t: String(t), x, y }) },
    { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  return { width: w, height: h, getContext: () => g, g };
}
function loadCCTV() {
  const made = [];
  const sandbox = { document: { createElement: () => { const c = fakeCanvas(1024, 600); made.push(c); return c; } }, Math, String };
  sandbox.window = sandbox;
  vm.runInNewContext(read('tools/warehouse-shift/cctv.js'), sandbox, { filename: 'cctv.js' });
  return sandbox.ShiftCCTV;
}

test('the monitor takes the notice board\'s place on the wall, and is bigger', () => {
  assert.ok(!world.objects.some((o) => o.kind === 'board'), 'the notice board is gone');
  const m = world.objects.find((o) => o.kind === 'cctv');
  assert.ok(m && m.wall);
  assert.ok(m.y1 - m.y0 > 1.3 && m.z1 - m.z0 > 0.9, 'wider and taller than the 1.3 x 0.9 m board');
});

test('the map is landscape: tills along the bottom, door at the top, waiting to be served on your right as you serve, collections on your left', () => {
  const C = loadCCTV(), cv = fakeCanvas(1024, 600), counter = world.counter;
  const zones = { queue: { x0: counter.x0 + 0.5, x1: counter.x0 + 2.1, y0: counter.y1, y1: counter.y1 + 2 }, wait: { x0: counter.x1 - 1.35, x1: counter.x1 + 0.3, y0: counter.y1, y1: counter.y1 + 2 } };
  const cam = C.create({ canvas: cv, world, zones }), m = cam.map;
  assert.ok(m.v(counter.y0) > m.v(world.D), 'the counter is below the door');
  assert.ok(m.k * (m.X1 - m.X0) > m.k * (m.Y1 - m.Y0) * 0.9, 'as wide as it is deep, filling the screen');
  // standing behind the counter facing the door (up the map), your right hand is the right of the map
  assert.ok(m.u((zones.queue.x0 + zones.queue.x1) / 2) > m.u((zones.wait.x0 + zones.wait.x1) / 2), 'waiting to be served right of collections');
  // every spot on the shop floor is on the screen
  for (const [x, y] of [[counter.x0, counter.y0], [world.W - 0.01, world.D - 0.01]]) { assert.ok(m.u(x) >= 0 && m.u(x) <= 1024 && m.v(y) >= 0 && m.v(y) <= 600); }
  const people = [
    { x: counter.x0 + 1, y: counter.y1 + 0.5, state: 'queue', colour: '#ff0000' }, { x: counter.x0 + 1, y: counter.y1 + 1.1, state: 'greet' },
    { x: counter.x1 - 0.5, y: counter.y1 + 0.5, state: 'wait' }, { x: counter.x0 + 3, y: counter.y1 + 0.4, state: 'till' },
    { x: counter.x0 + 3, y: counter.y0 - 0.5, staff: true, label: 'Sam' }, { x: 5, y: 5, staff: true, label: 'Far away in the warehouse' }
  ];
  const n = cam.draw({ people, time: '13:30' });
  assert.deepEqual({ ...n }, { queue: 2, till: 1, wait: 1, staff: 1 });
  const texts = cv.g.texts.map((t) => t.t);
  assert.ok(texts.includes('CAM 01  SHOP FLOOR') && texts.includes('13:30'));
  assert.ok(!texts.some((t) => /Waiting to be served|to greet|Staff on the floor/.test(t)), 'no count panel any more');
  assert.ok(texts.includes('S'), 'staff are shown by their initial');
});

test('the floor is marked, players have figures only the other player sees, and names on their badges', () => {
  const g = read('tools/warehouse-shift/game.js'), s = read('tools/warehouse-shift/scene.js'), h = read('tools/warehouse-shift.html');
  assert.ok(!g.includes('S.floorZone('), 'nothing painted on the real shop floor (detailedfoil, 21 Nov 2026)');
  assert.match(g, /function figLayers\(\)[\s\S]{0,200}if \(q !== p\) o\.layers\.enable\(1 \+ q\.idx\)/, 'never their own camera');
  assert.match(g, /P\.fig = S\.makeWorker\(\{ name: P\.name/);
  assert.match(s, /function setBadge\(w, name\)/);
  assert.match(h, /id="nameIn"/); assert.match(h, /warehouse-shift\/cctv\.js\?v=/);
  assert.equal((h.match(/placeholder="Name on badge"/g) || []).length, 2, 'a name box for each player on the join screen');
});
