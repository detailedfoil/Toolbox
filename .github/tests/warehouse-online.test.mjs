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
const context = () => ({ progress: new Map(), pose: { x: 0, y: 0, squat: true }, items: new Map(world.items.map(it => [it.code, it])) });
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

test('a paid kiosk basket must belong to the serving player and match the customer request', () => {
  const d = fresh(), c = d.send('kiosk'), ctx = context();
  c.state = 'counter'; d.serve(c, 'p3'); c.ready = true; c.at = {};
  ctx.till = () => c.at; ctx.screen = () => {};
  c.pay = { how: 'cash', exact: false, up: false };
  const total = c.kiosk.list[c.kiosk.mine].lines.reduce((sum, l) => sum + Till.price(l.item) * l.qty, 0);
  const args = { id: c.id, how: 'cash', change: Till.tender(total, c.pay) - total, lines: c.kiosk.list[c.kiosk.mine].lines.map(l => ({ sku: l.item.code, qty: l.qty })) };
  assert.equal(command(d, 'p2', 'tillDone', args, ctx), false);
  assert.equal(command(d, 'p3', 'tillDone', { ...args, lines: [] }, ctx), false);
  assert.equal(command(d, 'p3', 'tillDone', { ...args, how: 'card' }, ctx), false);
  assert.equal(command(d, 'p3', 'tillDone', { ...args, change: args.change + 1 }, ctx), false);
  assert.ok(command(d, 'p3', 'tillDone', args, ctx));
  assert.equal(command(d, 'p3', 'tillDone', args, ctx), false);
  assert.equal(d.list().length, 1);
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
