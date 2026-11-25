import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dir = '../../tools/warehouse-shift/';
const W = require(dir + 'world.js'), Till = require(dir + 'till.js'), Day = require(dir + 'day.js');
const { snapshot, command, DayProxy, release } = require(dir + 'online-day.js');
const read = name => JSON.parse(fs.readFileSync(new URL(dir + 'data/' + name + '.json', import.meta.url)));
const cat = read('catalogue'), requests = read('requests'), world = W.build(cat), other = W.build(cat);
const fresh = () => Day.create({ world, World: W, Till, requests, rand: W.rng(1234) });
const context = () => ({ progress: new Map(), needsStep: () => false, pose: { x: 0, y: 0, squat: true }, items: new Map(world.items.map(it => [it.code, it])) });
const wire = (d, tracked = new Set([...d.delivery.map(d => d.item), ...d.orders.flatMap(o => o.lines.map(l => l.item))])) =>
  JSON.parse(JSON.stringify(snapshot(d, [], tracked)));

test('a mirrored day uses local shelves and preserves active scanner, customer and carton references', () => {
  const day = fresh(), c = day.send('kiosk');
  const o = day.makeOrder('till', c.kiosk.list[c.kiosk.mine].lines, c, true); c.order = o;
  c.fig = { c }; // a real figure is cyclic
  const mirror = new DayProxy(other, Day.Day, [], () => {}, W, () => {});
  mirror.apply(wire(day));
  const [order] = mirror.orders, [customer] = mirror.customers, [carton] = mirror.delivery;
  assert.equal(order.cust, customer); assert.equal(customer.order, order);
  assert.notEqual(order.lines[0].item, o.lines[0].item);
  assert.equal(order.lines[0].loc.item, order.lines[0].item);
  assert.equal(customer.kiosk.list[customer.kiosk.mine].lines[0].item, order.lines.find(l => l.item.code === c.kiosk.list[c.kiosk.mine].lines[0].item.code).item);
  day.take(o, 'p2'); mirror.apply(wire(day));
  assert.equal(mirror.orders[0], order); assert.equal(mirror.delivery[0], carton);
  assert.equal(order.by, 'p2'); assert.equal(mirror.list().length, 0);
});

test('two scanners contend for one pick and only its owner can scan each line and finish it once', () => {
  const d = fresh(), ctx = context(), o = d.start('c'), id = o.id;
  const act = (who, op, args = {}) => command(d, who, op, { id, ...args }, ctx);
  assert.equal(act('p2', 'take'), true); assert.equal(act('p3', 'take'), false);
  const code = d.freeSpots()[0];
  assert.equal(act('p2', 'putAway', { code }), false);
  o.lines.forEach((l, index) => {
    ctx.pose.x = (l.loc.x0 + l.loc.x1) / 2; ctx.pose.y = l.loc.face.front;
    ctx.needsStep = () => true;
    ctx.pose.step = false;
    assert.equal(act('p2', 'line', { index }), false, 'a high shelf needs a claimed stool and a step up');
    ctx.pose.step = true;
    assert.equal(act('p3', 'line', { index }), false);
    assert.equal(act('p2', 'line', { index }), true); assert.equal(act('p2', 'line', { index }), false);
  });
  const spot = world.holding.spots.find(s => s.code === code);
  ctx.pose.x = spot.x1; ctx.pose.y = spot.y0;
  assert.equal(act('p2', 'putAway', { code }).surname, o.surname); assert.equal(act('p2', 'putAway', { code }), false);
  assert.equal(d.done, 1);
});

test('cartons return to goods in on disconnect and another player can finish one', () => {
  const d = fresh(), ctx = context(), g = world.goodsin[d.delivery[0].src];
  Object.assign(ctx.pose, g.stand);
  const id = command(d, 'p2', 'paTake', { src: g.i }, ctx);
  assert.ok(id); d.release('p2');
  assert.equal(command(d, 'p3', 'paTake', { src: g.i }, ctx), id);
  const l = d.delivery.find(x => x.id === id).loc;
  ctx.pose.x = (l.x0 + l.x1) / 2; ctx.pose.y = l.face.front;
  assert.equal(command(d, 'p2', 'paPut', { id }, ctx), false);
  assert.equal(command(d, 'p3', 'paPut', { id }, ctx), true);
  assert.equal(command(d, 'p3', 'paPut', { id }, ctx), false);
});

test('returning a carton requires its owner at the original cage and awards no XP', () => {
  const d = fresh(), ctx = context(), source = world.goodsin[d.delivery[0].src];
  const carton = d.paTake(source.i, 'p2');
  const args = { id: carton.id, src: source.i };
  const { slot, loc } = carton;
  assert.equal(command(d, 'p2', 'paReturn', args, ctx), false, 'the player must carry it back');
  Object.assign(ctx.pose, source.stand);
  assert.equal(command(d, 'p3', 'paReturn', args, ctx), false, 'another player cannot return it');
  assert.equal(command(d, 'p2', 'paReturn', { ...args, src: source.i + 1 }, ctx), false, 'the source must match');
  assert.equal(command(d, 'p2', 'paReturn', args, ctx), true);
  assert.equal(command(d, 'p2', 'paReturn', args, ctx), false, 'retries cannot return the same carton twice');
  assert.equal(d.baseXP, 0);
  assert.equal(carton.item.loc, null);
  assert.equal(carton.slot, slot);
  assert.equal(carton.loc, loc);
  assert.equal(command(d, 'p3', 'paTake', { src: source.i }, ctx), carton.id);
  const samCarton = d.paTake(source.i, 'Sam') || d.paTake(undefined, 'Sam');
  assert.ok(samCarton);
  assert.equal(command(d, 'Sam', 'paReturn', { id: samCarton.id, src: samCarton.src }, ctx), false);
  assert.equal(samCarton.by, 'Sam');
});

test('a paid kiosk basket must belong to the serving player and match the customer request', () => {
  const d = fresh(), c = d.send('kiosk'), ctx = context();
  c.state = 'counter'; d.serve(c, 'p3'); c.ready = true; c.at = {};
  ctx.till = () => c.at; ctx.screen = () => {};
  c.pay = { how: 'cash', exact: false, up: false };
  const request = c.kiosk.list[c.kiosk.mine];
  request.lines = request.lines.filter(l => !l.shortage);
  Till.addStockRequest(world, request.lines, () => 0.1);
  const total = request.lines.reduce((sum, l) => sum + Till.price(l.item) * l.qty, 0);
  const args = { id: c.id, how: 'cash', change: Till.tender(total, c.pay) - total, lines: request.lines.map(l => ({ sku: l.item.code, qty: l.qty, tcnd: l.shortage === 'tcnd' })) };
  assert.equal(command(d, 'p2', 'tillDone', args, ctx), false);
  assert.equal(command(d, 'p3', 'tillDone', { ...args, lines: [] }, ctx), false);
  assert.equal(command(d, 'p3', 'tillDone', { ...args, how: 'card' }, ctx), false);
  assert.equal(command(d, 'p3', 'tillDone', { ...args, change: args.change + 1 }, ctx), false);
  const extra = request.lines.at(-1).item, reserved = extra.reserved;
  const todayOnly = args.lines.map(l => ({ ...l, tcnd: false }));
  assert.equal(command(d, 'p3', 'tillDone', { ...args, lines: todayOnly }, ctx), false);
  assert.equal(command(d, 'p3', 'tillDone', { ...args, lines: args.lines.slice(0, -1) }, ctx), false);
  assert.ok(command(d, 'p3', 'tillDone', args, ctx));
  assert.equal(extra.reserved, reserved);
  assert.ok(c.order.lines.every(l => l.item !== extra));
  assert.equal(command(d, 'p3', 'tillDone', args, ctx), false);
  assert.equal(d.list().length, 1);
});

test('guests share replen batches, deposit only at the shop shelf and must restock every batch to lock up', () => {
  const d = fresh(), ctx = context(), shelf = world.replenShelf;
  const items = world.items.filter(it => it.loc && W.room(it) >= 2).slice(0, 3);
  const sale = item => d.makeOrder('replen', [{ item, qty: 1 }], null, false);
  const batch = sale(items[0]);
  assert.equal(sale(items[1]), batch);
  const act = (who, op, args = {}) => command(d, who, op, { id: batch.id, ...args }, ctx);
  assert.ok(act('p2', 'take'));
  assert.equal(act('p3', 'take'), false);
  const later = sale(items[2]), reserved = items[2].reserved;
  assert.notEqual(later.id, batch.id);
  for (const [index, l] of batch.lines.entries()) {
    ctx.pose.x = (l.loc.x0 + l.loc.x1) / 2; ctx.pose.y = l.loc.face.front;
    assert.ok(act('p2', 'line', { index }));
  }
  assert.equal(act('p2', 'restock'), false);
  Object.assign(ctx.pose, { x: shelf.x1 + 0.5, y: (shelf.y0 + shelf.y1) / 2 });
  assert.equal(act('p3', 'restock'), false);
  assert.ok(act('p2', 'restock'));
  assert.equal(act('p2', 'restock'), false);
  assert.equal(d.baseXP, 20);
  d.plan.length = d.released;
  d.delivery.forEach(carton => carton.done = true);
  d.check();
  assert.equal(d.phase, 'open');
  assert.equal(d.lock(), false);
  assert.equal(items[2].reserved, reserved);
  assert.ok(d.take(later, 'p1'));
  d.picked(later);
  d.check();
  assert.equal(d.lock(), false);
  assert.ok(d.restock(later, 'p1', ctx.pose));
  assert.equal(d.phase, 'lock');
  assert.ok(d.lock());
  assert.equal(d.baseXP, 30);
});

test('delivery locations and shelf stock survive a move, a late join and a new day', () => {
  const host = W.build(cat), guest = W.build(cat), stockItems = new Set(), visuals = [];
  const start = () => Day.create({ world: host, World: W, Till, requests, rand: W.rng(3912),
    env: { stock: item => stockItems.add(item), listed: o => o.lines.forEach(l => stockItems.add(l.item)) } });
  const day = start(), carton = day.delivery.find(d => d.loc !== d.item.old);
  assert.ok(carton, 'at least one carton moves to a different shelf');
  const oldCode = carton.item.old.code, newCode = carton.loc.code;
  const replica = new DayProxy(guest, Day.Day, [], () => {}, W, item => visuals.push(item.code));
  const mirror = () => replica.apply(wire(day, stockItems));
  mirror();
  const localCarton = replica.delivery.find(d => d.id === carton.id);
  assert.equal(localCarton.item.loc, null);
  assert.equal(localCarton.loc.code, newCode);
  assert.equal(guest.locs.byCode[oldCode].item, null);
  carton.by = 'p2';
  assert.ok(day.paPut(carton, 'p2'));
  mirror();
  assert.equal(localCarton.item.loc, localCarton.loc);
  assert.equal(localCarton.item.stock, carton.qty);
  const updates = visuals.length;
  mirror();
  assert.equal(visuals.length, updates, 'identical snapshots do not redraw shelves');

  const order = day.makeOrder('c', [{ item: carton.item, qty: 1 }], null, true);
  day.take(order, 'p2'); day.picked(order); mirror();
  assert.equal(localCarton.item.stock, carton.qty - 1);
  assert.equal(replica.orders.find(o => o.id === order.id).lines[0].loc, localCarton.loc);
  const next = start(), lateWorld = W.build(cat);
  const late = new DayProxy(lateWorld, Day.Day, [], () => {}, W, () => {});
  late.apply(wire(next, stockItems));
  assert.equal(late.items.get(carton.item.code).loc?.code, carton.item.loc?.code);
  assert.equal(late.items.get(carton.item.code).stock, carton.item.stock);
});

test('losing a picked tote restores its stock once and preserves other reservations', () => {
  const host = W.build(cat), day = Day.create({ world: host, World: W, Till, requests, delivery: 0 });
  const [empty, shared] = host.items.filter(it => W.room(it) >= 3);
  const oldLoc = empty.loc, available = W.room(empty), sharedStock = W.room(shared);
  day.makeOrder('c', [{ item: shared, qty: 1 }], null, true);
  const order = day.makeOrder('c', [{ item: empty, qty: available }, { item: shared, qty: 2 }], null, true);
  day.take(order, 'p2'); day.picked(order);
  assert.equal(empty.loc, null);
  release(day, 'p2'); release(day, 'p2');
  assert.equal(order.status, 'listed');
  assert.equal(oldLoc.item, empty);
  assert.equal(empty.stock, available);
  assert.equal(shared.stock, sharedStock);
  assert.equal(shared.reserved, 3);
  assert.equal(W.room(empty), 0);
  day.take(order, 'p3'); day.picked(order);
  assert.equal(empty.loc, null);
  assert.equal(shared.stock, sharedStock - 2);
  assert.equal(shared.reserved, 1);
});

test('shift score rewards timely work, counts abandoned customers and reallocates cancelled delivery', () => {
  const d = fresh();
  d.customers = [{ kind: 'ck', here: 10, greeted: 22, handedAt: 110 },
    { kind: 'collect', here: 50 }];
  d.orders = [{ counts: true, lines: [{}, {}], takenAt: 0, finishedAt: 60 }];
  d.delivery = [{ takenAt: 10, finishedAt: 70 }];
  d.phase = 'lock';
  assert.ok(d.lock());
  assert.deepEqual(d.report.rows.map(r => [r.label, r.earned, r.possible]), [
    ['Greetings', 50, 100], ['Customer waits', 150, 300], ['Picking', 250, 250],
    ['Delivery', 75, 150], ['Lock-up', 200, 200]
  ]);
  assert.equal(d.report.score, 725);
  assert.equal(d.report.xp, 0);
  d.event = 'failedDelivery'; d.delivery = [];
  const cancelled = d.shiftReport();
  assert.equal(cancelled.score, 725);
  assert.equal(cancelled.rows.find(r => r.label === 'Customer waits').possible, 450);
  assert.ok(!cancelled.rows.some(r => r.label === 'Delivery'));
});

test('the host scores each completed human action once and sends the same result to a guest', () => {
  const d = fresh();
  d.shiftId = 'test-shift'; d.walkinTill = 0; d.floorTarget = 0;
  const c = d.send('kiosk');
  d.arrived(c);
  assert.ok(d.greet(c, 'p2')); assert.equal(d.greet(c, 'p2'), false);
  assert.ok(d.serve(c, 'p3'));
  const lines = c.kiosk.list[c.kiosk.mine].lines, o = d.tillDone(c, lines);
  assert.equal(d.tillDone(c, lines), o);
  assert.ok(d.take(o, 'p1'));
  o.lines.forEach((_, i) => { d.confirmLine(o, i, 'p1'); d.confirmLine(o, i, 'p1'); });
  d.picked(o);
  assert.ok(d.handOver(o, 'p1')); assert.equal(d.handOver(o, 'p1'), false);
  const carton = d.paTake(null, 'p2'); assert.ok(d.paPut(carton, 'p2')); assert.equal(d.paPut(carton, 'p2'), false);
  const samCarton = d.paTake(null, 'Sam'); assert.ok(d.paPut(samCarton, 'Sam'));
  assert.equal(d.baseXP, 5 + 15 + 10 * o.lines.length + 10 + 10);
  d.phase = 'lock'; d.lock();
  const mirror = new DayProxy(other, Day.Day, [], () => {}, W, () => {});
  mirror.apply(wire(d)); mirror.apply(wire(d));
  assert.deepEqual(mirror.report, d.report);
  assert.equal(mirror.report.xp, d.baseXP + Math.round(d.baseXP * d.report.score / 4000));
  assert.deepEqual(mirror.eligible.sort(), ['p1', 'p2', 'p3']);
  assert.equal(d.lock(), false);
});

test('scanner mix-ups use a shift-wide target and check each ready customer once', () => {
  const observed = [new Set(), new Set()];
  for (let seed = 0; seed < 24; seed++) {
    for (const [i, labelled] of [false, true].entries()) {
      const day = Day.create({ world, World: W, Till, requests, rand: W.rng(1234), delivery: 0, shiftId: 'mix-up-' + seed });
      let count = 0;
      for (let n = 0; n < 15; n++) {
        const who = n % 2 ? 'p1' : 'p2';
        const customer = { state: 'serving', by: who, ready: false };
        assert.equal(day.scannerMixup(customer, who, labelled), false);
        customer.ready = true;
        assert.equal(day.scannerMixup(customer, 'p3', labelled), false);
        if (day.scannerMixup(customer, who, labelled)) count++;
        assert.equal(day.scannerMixup(customer, who, labelled), false);
      }
      observed[i].add(count);
    }
  }
  assert.deepEqual([...observed[0]].sort(), [2, 3, 4]);
  assert.deepEqual([...observed[1]].sort(), [0, 1]);
});

test('buying a scanner label honours mix-ups that already happened that shift', () => {
  const day = fresh();
  const mixups = day.scannerMixups;
  mixups.unlabelled.until = mixups.labelled.until = mixups.labelled.limit = 1;
  const serving = { state: 'serving', by: 'p1', ready: true };
  assert.equal(day.scannerMixup({ ...serving }, 'p1', false), true);
  assert.equal(day.scannerMixup({ ...serving }, 'p1', true), false);
  assert.equal(mixups.count, 1);
});

test('scanner faults interrupt a held order after random working time and respect each tier', () => {
  const dock = world.scannerDock, front = { x: dock.x, y: dock.y - 0.8 };
  for (let tier = 1; tier <= 5; tier++) {
    const faults = [];
    const d = Day.create({ world, World: W, Till, requests, rand: W.rng(123 + tier), scannerTier: tier,
      event: 'failedDelivery', env: { scannerHolders: () => ['p1', 'p2'], scannerFault: id => faults.push(id) } });
    d.wait = 100_000;
    const originalSchedule = Array.from(d.faultSchedule);
    assert.equal(originalSchedule.length, 6 - tier);
    d.tick(600);
    assert.deepEqual(Array.from(d.faultSchedule), originalSchedule, 'idle time consumes no fault budget');
    const order = d.makeOrder('c', [], null, false);
    assert.equal(d.take(order, 'p2'), true);
    for (const delay of originalSchedule) {
      const before = faults.length;
      d.tick(delay / 2);
      assert.equal(faults.length, before);
      d.tick(delay);
      assert.equal(faults.length, before + 1);
      assert.equal(faults.at(-1), 'p2', 'only the player with an active job can lose their scanner');
      assert.equal(order.status, 'taken');
      const next = d.faultSchedule[0];
      d.tick(600);
      assert.equal(d.faultSchedule[0], next, 'an offline scanner pauses the countdown');
      assert.equal(d.swapScanner('p2', world.start), false);
      assert.equal(d.swapScanner('p2', front), true);
      assert.equal(d.swapScanner('p2', front), false);
      if (next !== undefined) {
        d.tick(59);
        assert.equal(d.faultSchedule[0], next, 'the replacement has 60 seconds of protection');
        d.tick(1);
        order.status = 'picked';
        d.tick(next + 1);
        assert.equal(d.faultSchedule[0], next, 'a collected order can be handed over safely');
        order.status = 'taken';
      }
    }
    d.tick(600);
    assert.equal(faults.length, 6 - tier);
  }
});

test('the counter queue uses arrival time even when customers reach it out of spawn order', () => {
  const d = Day.create({ world, World: W, Till, requests, rand: W.rng(321) });
  const later = d.send('till'), earlier = d.send('kiosk');
  d.t = 3; d.arrived(earlier);
  d.t = 8; d.arrived(later);
  assert.deepEqual(d.ungreeted(), [earlier, later]);
  assert.equal(d.greet(later, 'p1'), true);
  assert.equal(d.greet(earlier, 'p2'), true);
  assert.deepEqual(d.queue(), [earlier, later]);
});

test('checkout reserves the full paid quantity or sends the sale back to Fusion', () => {
  const local = W.build(cat);
  const d = Day.create({ world: local, World: W, Till, requests, rand: W.rng(23), delivery: 0 });
  const item = local.items.find(it => it.loc && W.room(it) >= 3);
  item.stock = 3;
  const first = d.send('till'), second = d.send('till');
  const line = { item, qty: 3 };
  assert.deepEqual(d.checkout(first, [{ item, qty: 10 }]), { shortage: { code: item.code, available: 3 } });
  assert.equal(d.orders.length, 0);
  assert.equal(d.checkout(first, [line]).order.lines[0].qty, 3);
  second.lines = [line];
  second.state = 'serving'; second.by = 'p2'; second.ready = true; second.at = {};
  second.pay = { how: 'card' };
  const ctx = { items: new Map([[item.code, item]]), till: () => second.at, screen: () => {} };
  const args = { id: second.id, how: 'card', lines: [{ sku: item.code, qty: 3 }] };
  assert.deepEqual(command(d, 'p2', 'tillDone', args, ctx), { shortage: { code: item.code, available: 0 } });
  assert.equal(second.order, null);
  assert.equal(second.state, 'serving');
  args.lines[0].tcnd = true;
  assert.equal(command(d, 'p2', 'tillDone', args, ctx), second.order.id);
  assert.equal(second.order.status, 'done');
  assert.equal(second.state, 'leaving');
  assert.equal(d.list().length, 1);
  assert.equal(item.reserved, 3);
});
