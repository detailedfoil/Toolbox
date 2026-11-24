import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const dir = '../../tools/warehouse-shift/';
const W = require(dir + 'world.js'), Till = require(dir + 'till.js'), Day = require(dir + 'day.js');
const { command } = require(dir + 'online-day.js');
const read = file => JSON.parse(readFileSync(new URL(dir + 'data/' + file + '.json', import.meta.url)));
const catalogue = read('catalogue'), requests = read('requests');
const fresh = (event, options = {}) => Day.create({
  world: W.build(catalogue), World: W, Till, requests, rand: W.rng(842), total: 20, event, ...options
});
const visitors = day => day.plan.filter(kind => kind !== 'c');

test('ordinary shifts have a 25 percent chance of exactly one full-day event', () => {
  assert.equal(Day.rollEvent(() => 0.25), null);
  assert.equal(Day.rollEvent(() => 0.99), null);
  assert.deepEqual([0.025, 0.075, 0.125, 0.175, 0.225].map(roll => Day.rollEvent(() => roll)), Object.keys(Day.EVENTS));
  assert.equal(fresh('fusion', { mode: 'till', delivery: 0 }).event, null);
});

test('the sale adds customers while both outages serve click and collect only', () => {
  const normal = fresh(null, { delivery: 0 });
  const sale = fresh('sale', { delivery: 0 });
  const website = fresh('website', { delivery: 0 });
  const fusion = fresh('fusion', { delivery: 0 });
  assert.equal(visitors(sale).length, visitors(normal).length + 8);
  normal.r = sale.r = () => 0.5;
  assert.ok(sale.gap() < normal.gap());
  assert.equal(visitors(website).length, Math.ceil(visitors(normal).length * 0.7));
  assert.equal(visitors(fusion).length, visitors(normal).length);

  for (const day of [website, fusion]) {
    assert.equal(day.tillsOpen(), false);
    assert.equal(command(day, 'p2', 'tillOpen', { till: 0 }, { open: () => true }), false);
    day.setMode('kiosk');
    for (const kind of visitors(day)) {
      assert.ok(kind === 'collect' || kind === 'ck');
      const customer = day.start(kind === 'collect' && !day.collectable() ? 'ck' : kind);
      day.arrived(customer);
      assert.ok(day.greet(customer, 'p1'));
      assert.ok(['ck', 'hold'].includes(customer.order.kind));
    }
  }
});

test('on a cancelled delivery day only completing customer orders advances the clock', () => {
  const day = fresh('failedDelivery', { walkinTill: 0 });
  assert.equal(day.delivery.length, 0);
  assert.equal(day.plan.length, day.total);
  assert.equal(day.total, visitors(fresh(null, { delivery: 0 })).length);
  assert.ok(!day.plan.includes('c'));
  assert.equal(day.clockMinute(), 420);
  assert.ok(day.plan.some(kind => kind === 'till' || kind === 'kiosk'));
  while (day.released < day.plan.length) {
    day.tick(100);
    const customer = day.customers.at(-1);
    const before = day.clockMinute();
    day.arrived(customer); day.greet(customer, 'p1');
    if (day.serve(customer, 'p1')) {
      const lines = customer.kind === 'kiosk' ? customer.kiosk.list[customer.kiosk.mine].lines : customer.lines;
      day.tillDone(customer, lines);
    }
    assert.equal(day.clockMinute(), before, 'greeting and paying leave the clock alone');
    const order = customer.order;
    assert.ok(day.take(order, 'p1'));
    if (order.kind === 'hold') day.fetch(order);
    else day.picked(order);
    assert.equal(day.clockMinute(), before, 'picking alone leaves the clock alone');
    assert.equal(day.handOver(order, 'p1'), true);
    assert.equal(day.handOver(order, 'p1'), false);
    day.gone(customer);
    assert.equal(day.clockMinute(), 420 + Math.floor(780 * (day.released / day.total)));
  }
  assert.equal(day.clockMinute(), 1200);
  assert.equal(day.phase, 'lock');
  assert.equal(day.lock(), true);
});

test('on light duties Sam can serve and fetch bags while players do warehouse work', () => {
  const code = 'OC-001';
  const day = fresh('lightDuties', { hold: { [code]: { num: '4200', surname: 'Bell' } }, walkinTill: 0 });
  const customer = day.send('kiosk');
  day.arrived(customer); day.greet(customer, 'Sam');
  assert.ok(day.serve(customer, 'Sam'));
  const sale = day.tillDone(customer, customer.kiosk.list[customer.kiosk.mine].lines);
  const collection = day.send('collect', { code, surname: 'Bell' });
  day.arrived(collection); day.greet(collection, 'Sam');
  for (const order of [sale, day.makeOrder('ck', []), day.makeOrder('c', [])]) {
    assert.equal(day.take(order, 'Sam'), false);
    assert.equal(day.take(order, 'p1'), true);
  }
  assert.ok(day.take(collection.order, 'Sam'));
  assert.equal(day.fetch(collection.order).surname, 'Bell');
  assert.ok(day.handOver(collection.order, 'Sam'));
  assert.equal(day.paTake(null, 'Sam'), null);
  assert.ok(day.paTake(null, 'p1'));
});

test('putaway paces customer arrivals while holding picks and replacement visits can still start', () => {
  const day = fresh(null, { delivery: 10 });
  day.plan = ['ck', 'ck', 'c', ...Array(8).fill('ck')];
  day.total = day.plan.length;
  function runDirector() {
    for (let tick = 0; tick < 20; tick++) {
      day.tick(100);
      for (const customer of day.customers) customer.state = 'gone';
      for (const order of day.orders) order.status = 'done';
    }
  }
  runDirector();
  assert.equal(day.customers.length, 1);
  assert.equal(day.orders.filter(order => order.kind === 'c').length, 1);
  day.customers[0].state = 'greet';
  day.giveUp(day.customers[0]);
  runDirector();
  assert.equal(day.customers.length, 2);
  for (const carton of day.delivery.slice(0, 5)) carton.done = true;
  runDirector();
  assert.equal(day.clockMinute(), 13 * 60 + 30);
  assert.equal(day.customers.length - 1, 5);
  for (const carton of day.delivery.slice(5, 9)) carton.done = true;
  runDirector();
  assert.equal(day.customers.length - 1, 10);
  assert.equal(day.phase, 'open');
  day.delivery.at(-1).done = true;
  day.tick(1);
  assert.equal(day.clockMinute(), 20 * 60);
  assert.equal(day.phase, 'lock');
});

test('repeated Fusion identities get distinct emails across accounts and customer visits', () => {
  const day = fresh(null);
  const seen = new Set(), residents = new Set();
  for (let i = 0; i < 10; i++) {
    day.r = W.rng(842);
    const { cust } = day.send('kiosk');
    for (const record of cust.db) {
      assert.ok(!seen.has(record.email));
      seen.add(record.email);
      const resident = [record.first, record.postcode, record.address].join('/');
      assert.ok(!residents.has(resident));
      residents.add(resident);
    }
    if (cust.third.kind === 'email') assert.ok(cust.third.say.includes(cust.email));
  }
});
