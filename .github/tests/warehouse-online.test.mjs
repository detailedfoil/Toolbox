import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dir = '../../tools/warehouse-shift/';
const W = require(dir + 'world.js'), Till = require(dir + 'till.js'), Day = require(dir + 'day.js');
const { snapshot, command, DayProxy } = require(dir + 'online-day.js');
const read = name => JSON.parse(fs.readFileSync(new URL(dir + 'data/' + name + '.json', import.meta.url)));
const cat = read('catalogue'), requests = read('requests'), world = W.build(cat), other = W.build(cat);
const fresh = () => Day.create({ world, World: W, Till, requests, rand: W.rng(1234) });
const context = () => ({ progress: new Map(), pose: { x: 0, y: 0, squat: true }, items: new Map(world.items.map(it => [it.code, it])) });
const wire = d => JSON.parse(JSON.stringify(snapshot(d, [])));

test('a mirrored day uses local shelves and preserves active scanner, customer and carton references', () => {
  const day = fresh(), c = day.send('kiosk');
  const o = day.makeOrder('till', c.kiosk.list[c.kiosk.mine].lines, c, true); c.order = o;
  c.fig = { c }; // a real figure is cyclic
  const mirror = new DayProxy(other, Day.Day, [], () => {});
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
  const args = { id: c.id, lines: c.kiosk.list[c.kiosk.mine].lines.map(l => ({ sku: l.item.code, qty: l.qty })) };
  assert.equal(command(d, 'p2', 'tillDone', args, ctx), false);
  assert.equal(command(d, 'p3', 'tillDone', { ...args, lines: [] }, ctx), false);
  assert.ok(command(d, 'p3', 'tillDone', args, ctx));
  assert.equal(command(d, 'p3', 'tillDone', args, ctx), false);
  assert.equal(d.list().length, 1);
});
