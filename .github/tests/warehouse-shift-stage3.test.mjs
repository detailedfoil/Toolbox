// Warehouse Shift stage 3 (21 Nov 2026, detailedfoil): OC 9 to 14 on the ground with OC 3 to 8 above them, one row of
// shelves in the middle of the shop, a red kick stool at every row end, customers ask by code only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, loadModule } from './load.mjs';

const W = loadModule('tools/warehouse-shift/world.js');
const Till = loadModule('tools/warehouse-shift/till.js');
const read = (f) => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const world = W.build(read('tools/warehouse-shift/data/catalogue.json'));
const requests = read('tools/warehouse-shift/data/requests.json');

test('holding area: OC-009 to OC-014 are the bottom row of totes, OC-003 to OC-008 sit above them', () => {
  const sp = world.holding.spots, by = (c) => sp.find((s) => s.code === c);
  for (let i = 3; i <= 8; i++) assert.ok(by('OC-00' + i).z0 > by('OC-009').z0 - 1e-9 && by('OC-00' + i).z0 > 0.5, 'OC-00' + i + ' is the upper shelf');
  for (let i = 9; i <= 14; i++) assert.ok(by('OC-0' + String(i).padStart(2, '0')).z0 < 0.2, 'OC-0' + i + ' is the low shelf');
  // from the left as you face it, 9 sits under 3, 10 under 4 and so on
  for (let i = 0; i < 6; i++) { const lo = by('OC-0' + String(9 + i).padStart(2, '0')), hi = by('OC-0' + String(3 + i).padStart(2, '0')); assert.ok(Math.abs(lo.y0 - hi.y0) < 1e-9); }
});

test('the middle of the shop has one row of shelves, with the queue side and the waiting side clear of it', () => {
  const c = world.counter, mid = world.objects.filter((o) => o.kind === 'gondola' && o.x0 > c.x0 + 1 && o.x1 < c.x1 - 0.5);
  assert.equal(mid.length, 1, 'one island row');
  const g = mid[0], centre = (g.x0 + g.x1) / 2;
  assert.ok(Math.abs(centre - (c.x0 + c.x1) / 2) < 1.0, 'in the middle of the counter');
  assert.ok(g.y0 > c.y1 + 1.2, 'the queue and the people waiting have room between the counter and the shelves');
});

test('a red kick stool at the centre aisle end of every row, clear of everything else', () => {
  assert.ok(world.stools.length >= 14, world.stools.length + ' stools');
  assert.equal(world.stools.length, world.faces.length, 'one for every yellow and black end guard');
  const ids = new Set(world.stools.map((s) => s.id)); assert.equal(ids.size, world.stools.length);
  for (const s of world.stools) {
    const inCentre = s.x > world.centre.x0 && s.x < world.centre.x1;
    assert.ok(inCentre, s.area + ': in the centre aisle');
    assert.ok(Math.min(s.x - world.centre.x0, world.centre.x1 - s.x) < 0.7, s.area + ': at the edge of it, against the end guard');
    assert.equal(s.by, null);
  }
  const ks = world.objects.filter((o) => o.kind === 'kickstool');
  assert.equal(ks.length, world.stools.length);
  assert.ok(world.obstacles.length > 0);
  // none of the carried or stood kind of thing is left from the old decorative aisle stools
  assert.equal(world.objects.filter((o) => o.kind === 'stool').length, 2, 'only the two by the back wall are left');
});

test('customers only ask by code', () => {
  const rnd = W.rng(5), kinds = {};
  for (let i = 0; i < 300; i++) for (const ln of Till.makeOrder(world, requests, rnd)) { kinds[ln.kind] = (kinds[ln.kind] || 0) + 1; assert.ok(ln.say.includes(ln.item.code)); assert.equal(ln.quote, ''); }
  assert.deepEqual(Object.keys(kinds), ['code']);
});

test('the game: stool pick-up, Step, the high shelf rule and the stool going home are wired up', () => {
  const g = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/game.js'), 'utf8');
  assert.match(g, /HIGH = 1\.75/); assert.match(g, /function takeStool/); assert.match(g, /function dropStool/); assert.match(g, /function toggleStep/);
  assert.equal((g.match(/Too high: use a kick stool/g) || []).length, 2, 'the pick scan and the putaway scan both need the stool for high shelves');
  assert.match(g, /Crew\.aisleAt\(world, me\.x, me\.y\)/);
  const html = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift.html'), 'utf8');
  assert.match(html, /id="stepBtn"/);
});
