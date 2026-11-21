// Warehouse Shift stage 2 (21 Nov 2026, detailedfoil): about half the click and collects are bags from the holding area,
// stock comes off the shelf and a pick of the last units leaves the place empty, a delivery goes into an EMPTY place,
// customers give surname then postcode then a third detail, Sam waits 4 s on his own pick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, loadModule } from './load.mjs';

const W = loadModule('tools/warehouse-shift/world.js');
const Till = loadModule('tools/warehouse-shift/till.js');
const Day = loadModule('tools/warehouse-shift/day.js');
const read = (f) => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const world = W.build(read('tools/warehouse-shift/data/catalogue.json'));
const requests = read('tools/warehouse-shift/data/requests.json');

test('walk-ins who want click and collect: about half collect a bag from the holding area, half are one product from the warehouse', () => {
  let bag = 0, one = 0, till = 0;
  for (let s = 1; s <= 60; s++) {
    const day = Day.create({ world: W.build(read('tools/warehouse-shift/data/catalogue.json'), 5), World: W, Till, requests, rand: W.rng(s), env: {} });
    day.phase = 'open';
    for (let i = 0; i < 6; i++) {
      const c = day.send('ck'); day.arrived(c); assert.ok(day.greet(c, 'p1'));
      if (c.kind === 'collect') { bag++; assert.ok(c.order && c.order.kind === 'hold'); } else if (c.kind === 'ck') one++; else till++;
      if (c.state === 'counter') {
        assert.ok(day.serve(c, 'p1'));
        day.tillDone(c, c.kind === 'kiosk' ? c.kiosk.list[c.kiosk.mine].lines : c.lines);
      }
      assert.doesNotMatch(c.say, /OC-/, 'customers do not say the OC number');
    }
  }
  const share = bag / (bag + one);
  assert.ok(share > 0.4 && share < 0.6, 'bags are about half of the click and collects: ' + bag + ' of ' + (bag + one));
  assert.ok(till / (bag + one + till) > 0.35 && till / (bag + one + till) < 0.55, 'and about 45% of walk-ins still want the till');
});

test('stock: a pick of every unit leaves the place empty, and the product is out of stock until a delivery', () => {
  const w = W.build(read('tools/warehouse-shift/data/catalogue.json'), 7);
  const day = Day.create({ world: w, World: W, Till, requests, rand: W.rng(3), env: {}, delivery: 0 });
  const it = w.items.find((x) => x.loc && W.room(x) >= 3);
  const loc = it.loc, all = W.room(it);
  const o = day.makeOrder('ck', [{ item: it, qty: all - 1 }], null, true);
  day.take(o, 'p1'); day.picked(o);
  assert.equal(it.loc, loc, 'some are left: the place keeps its product'); assert.equal(it.stock, 1);
  const o2 = day.makeOrder('ck', [{ item: it, qty: 5 }], null, true);
  assert.equal(o2.lines[0].qty, 1, 'an order can only take what is there');
  day.take(o2, 'p1'); day.picked(o2);
  assert.equal(it.loc, null); assert.equal(loc.item, null, 'the place is empty'); assert.ok(w.out.includes(it));
  assert.equal(day.makeOrder('ck', [{ item: it, qty: 1 }], null, true).lines.length, 0, 'out of stock: nothing to pick');
  // the next delivery brings it back, into an empty place of its own kind in the same row
  const d2 = Day.create({ world: w, World: W, Till, requests, rand: W.rng(4), env: {} });
  const line = d2.delivery.find((x) => x.item === it);
  assert.ok(line, 'it is in the next delivery');
  assert.ok(!line.loc.item && line.loc.face === loc.face && line.loc.cls === loc.cls);
  const top = d2.paTake(line.src, 'p1');
  void top;
});

test('deliveries: every carton has its own empty place, and putting it away fills it', () => {
  const w = W.build(read('tools/warehouse-shift/data/catalogue.json'), 9);
  const d = Day.create({ world: w, World: W, Till, requests, rand: W.rng(11), env: {} });
  const to = new Set(d.delivery.map((x) => x.loc.code));
  assert.equal(to.size, d.delivery.length, 'no two cartons for one place');
  for (const x of d.delivery) { assert.equal(x.loc.item, null); assert.equal(x.item.loc, null); }
  while (d.delivery.some((x) => !x.done)) { const c = d.paTake(null, 'p1'); assert.ok(c); d.paPut(c, 'p1'); assert.equal(c.loc.item, c.item); assert.equal(c.item.loc, c.loc); assert.equal(c.item.stock, c.qty); }
});

test('customers give their surname first, then postcode, then (after a search) first name, email or door number, never the organisation', () => {
  const kinds = {};
  for (let s = 1; s <= 300; s++) {
    const c = Till.makeCustomer(W.rng(s));
    kinds[c.third.kind] = (kinds[c.third.kind] || 0) + 1;
    if (c.twin) assert.notEqual(c.third.kind, 'door', 'a twin at the same address cannot be told apart by door number');
    assert.ok(c.third.say.length > 5);
    if (c.third.kind === 'email') assert.ok(c.third.say.includes(c.email));
    if (c.third.kind === 'first') assert.ok(c.third.say.includes(c.first));
    if (c.org) assert.ok(!c.third.say.includes(c.org));
  }
  assert.ok(kinds.first && kinds.email && kinds.door, JSON.stringify(kinds));
  const src = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/tillui.js'), 'utf8');
  assert.ok(src.indexOf("say(\"Surname's \" + s.cust.surname + '.')") < src.indexOf("say(\"Postcode's \" + s.cust.postcode + '.')"), 'surname before postcode');
});

test('Sam: waits 4 s for a pick to be his, doing nothing else, and walks to the till before saying hello', () => {
  const day = Day.create({ world, World: W, Till, requests, rand: W.rng(2), env: {}, walkinTill: 0 });
  day.phase = 'open';
  const o = day.makeOrder('ck', W.order(world, W.rng(5), 1), null, true);
  assert.equal(day.listEarly().length, 1);
  assert.equal(day.listLate().length, 0);
  day.t += 4.5;
  assert.equal(day.listEarly().length, 0);
  assert.equal(day.listLate().length, 1);
  void o;
  const bot = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/bot.js'), 'utf8');
  assert.match(bot, /if \(b\.early && b\.early\.length\) return null/);
  assert.match(bot, /job\.greet\) \{[^\n]*\n\s*if \(!this\.atPost\(\)\) yield\* this\.walkTo\(this\.post\)/);
});
