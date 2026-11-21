// Warehouse Shift stage 6 (detailedfoil, 21 Nov 2026): split screen side by side with a scanner in each half's bottom
// right corner, the game shrinks to the space above a phone's keyboard, any way up at any time, and a bigger CCTV.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, loadModule } from './load.mjs';

const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

test('split screen is side by side, and the game follows the visible part of the screen', () => {
  const g = read('tools/warehouse-shift/game.js'), c = read('tools/warehouse-shift/game.css');
  assert.match(g, /players\[0\]\.layout\(\{ x: 0, y: 0, w, h: vh \}\); players\[1\]\.layout\(\{ x: w, y: 0, w: vw - w, h: vh \}\)/, 'left and right halves');
  assert.match(c, /\.ws-stage\.split #pv1\{right:50%\}/); assert.match(c, /\.ws-stage\.split \.ws-pv\.p2\{left:50%/);
  assert.match(g, /visualViewport\.addEventListener\('resize', layoutSoon\)/, 'shrinks when a phone keyboard comes up');
  assert.match(read('tools/warehouse-shift.html'), /interactive-widget=resizes-content/);
});

test('any way up: no orientation lock, no rotate prompt, the installed game turns too', () => {
  const g = read('tools/warehouse-shift/game.js'), h = read('tools/warehouse-shift.html');
  assert.ok(!g.includes("orientation.lock("), 'never locks the phone sideways');
  assert.ok(!h.includes('id="rotate"') && !g.includes("$('rotate')"), 'no "turn your phone sideways" prompt');
  assert.equal(JSON.parse(read('tools/warehouse-shift.webmanifest')).orientation, 'any');
});

test('the CCTV screen is most of its wall, and clear of the clock', () => {
  const W = loadModule('tools/warehouse-shift/world.js');
  const world = W.build(JSON.parse(read('tools/warehouse-shift/data/catalogue.json')));
  const tv = world.objects.find((o) => o.kind === 'cctv'), clock = world.objects.find((o) => o.kind === 'clock');
  const wall = world.walls.find((w) => Math.abs(w[0] - tv.x1) < 0.01 && w[1] <= tv.y0 && w[3] >= tv.y1);
  const office = world.walls.filter((w) => Math.abs(w[2] - tv.x1) < 0.01 && w[1] > wall[1]).reduce((m, w) => Math.min(m, w[1]), Infinity);
  const free = Math.min(office, wall[3]) - wall[1];
  assert.ok(tv.y1 - tv.y0 >= free * 0.85, 'almost the whole width: ' + (tv.y1 - tv.y0).toFixed(2) + ' of ' + free.toFixed(2) + ' m');
  assert.ok(tv.y0 >= wall[1] && tv.y1 <= office, 'inside the wall');
  assert.ok(clock.z0 >= tv.z1, 'the clock sits above it');
});
