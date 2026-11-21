// Four independent game pages talking to a local Wrangler instance. Only canvas drawing is stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import WebSocket from 'ws';
import { REPO } from '../tests/load.mjs';

const origin = process.env.RELAY_TEST_ORIGIN || 'https://detailedfoil.github.io', base = path.join(REPO, 'tools');
const page = readFileSync(path.join(base, 'warehouse-shift.html'), 'utf8');
const relay = 'http://127.0.0.1:' + (process.env.RELAY_PORT || 8787);
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(check, what) {
  const limit = Date.now() + 8000;
  while (!check()) { if (Date.now() > limit) assert.fail('Timed out waiting for ' + what); await pause(30); }
}
async function game(t, { online = true, phone = false } = {}) {
  const w = new JSDOM(page, { runScripts: 'outside-only', pretendToBeVisual: true,
    url: origin + '/Toolbox/tools/warehouse-shift.html' + (online ? '?online=1&relay=' + relay : '') }).window;

  const $ = id => w.document.getElementById(id);
  w.matchMedia = q => ({ matches: phone && q === '(pointer: coarse)' });
  if (!phone) delete w.ontouchstart;
  w.innerWidth = phone ? 844 : 1280; w.innerHeight = phone ? 390 : 720;
  w.localStorage.setItem('toolbox.signedIn.area20', 'STEPHEN');
  w.localStorage.setItem('ws-helped', '1'); w.localStorage.setItem('ws-sound', 'off');
  w.fetch = async url => new Response(readFileSync(path.join(base, String(url).split('?')[0])));
  const sockets = [];
  w.WebSocket = class extends WebSocket {
    constructor(url, protocols) { super(String(url), protocols || [], { origin }); sockets.push(this); }
  };
  t.after(() => {
    for (const ws of sockets) { ws.onclose = null; ws.onmessage = null; ws.terminate(); }
    w.close();
  });
  const blank = () => {}, gradient = () => ({ addColorStop: blank });
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({ measureText: s => ({ width: String(s).length * 8 }),
    createRadialGradient: gradient, createLinearGradient: gradient }, { get: (o, k) => o[k] || blank });
  let lastCCTV = [];
  for (const script of w.document.scripts) {
    const asset = script.getAttribute('src')?.split('?')[0]; if (!asset || asset.startsWith('../')) continue;
    w.eval(readFileSync(path.join(base, asset), 'utf8'));
    if (asset.endsWith('cctv.js')) {
      const create = w.ShiftCCTV.create;
      w.ShiftCCTV.create = options => {
        const cctv = create(options);
        return { ...cctv, draw(frame) { lastCCTV = frame.people; return cctv.draw(frame); } };
      };
    }
    if (asset.endsWith('three.min.js')) {
      w.THREE = { ...w.THREE, WebGLRenderer: class {
        capabilities = { getMaxAnisotropy: () => 1, maxTextureSize: 1024 };
        setPixelRatio() {} setSize() {} compile() {} setScissorTest() {} setScissor() {} setViewport() {}
        render(scene, cam) { cam.updateMatrixWorld(); }
      } };
    }
  }
  await until(() => w.__shift, 'warehouse to load: ' + $('msgText').textContent);
  return { w, $, s: w.__shift, sockets, cctv: () => lastCCTV };
}

test('the normal game starts solo and local split-screen without opening a socket', async t => {
  for (const split of [false, true]) {
    const { $, s, sockets } = await game(t, { online: false });
    assert.equal($('onlineBtn').hidden, true);
    if (split) { $('twoBtn').click(); s.join({ kind: 'kb' }); s.join({ kind: 'pad', pad: 0 }); $('joinGo').click(); }
    else $('startBtn').click();
    assert.equal(s.split(), split); assert.equal(s.players.length, split ? 2 : 1);
    assert.equal($('startCover').hidden, true); assert.equal(s.state(), 'home'); assert.equal(sockets.length, 0);
  }
});

test('a phone and two other guests share the host game, pick, reconnect and follow the host into the next day', async t => {
  const host = await game(t), guests = [];
  host.$('onlineBtn').click(); host.$('hostRoom').click();
  await until(() => !host.$('roomBtn').hidden, 'host admission');
  // Schedule just the jobs this test exercises while Sam continues to run in the host.
  const day = host.s.day(); day.plan.length = 0;
  for (const job of host.s.prio()) job.on = false;
  const room = host.$('roomBtn').textContent.slice(0, 6);
  for (let i = 0; i < 3; i++) {
    const guest = await game(t, { phone: i === 0 });
    guest.$('nameIn').value = ['River', 'Lake', 'Oak'][i];
    guest.$('nameIn').dispatchEvent(new guest.w.Event('input'));
    guest.$('onlineBtn').click(); guest.$('roomCode').value = room; guest.$('joinRoom').click();
    await until(() => !guest.$('roomBtn').hidden, 'guest admission: ' + guest.$('roomMessage').textContent);
    assert.equal(guest.s.crew.length, 0); guests.push(guest);
  }
  assert.equal(host.s.crew.length, 1);
  const [phone] = guests;
  assert.equal(phone.$('stickZone').hidden, false);
  assert.equal(host.$('roomBtn').textContent, room + ' · 4/4');
  await until(() => [host, ...guests].every(g => ['Sam', 'River', 'Lake', 'Oak'].every(name =>
    g.cctv().some(p => p.staff && p.label === name))), 'named staff and one Sam on each CCTV monitor');
  const visibility = hidden => {
    Object.defineProperty(host.w.document, 'hidden', { configurable: true, value: hidden });
    host.w.document.dispatchEvent(new host.w.Event('visibilitychange'));
  };
  visibility(true);
  await until(() => guests.every(g => !g.$('onlineCover').hidden && /paused/.test(g.$('roomMessage').textContent)), 'host tab to pause every guest');
  visibility(false);
  await until(() => guests.every(g => g.$('onlineCover').hidden), 'host tab to resume every guest');
  const stoolId = host.s.world.stools[0].id;
  const aimAtStool = g => {
    const s = g.s, stool = s.world.stools.find(v => v.id === stoolId);
    const side = stool.home.x < (s.world.centre.x0 + s.world.centre.x1) / 2 ? 1 : -1;
    s.me.x = stool.home.x + side * 0.9; s.me.y = stool.home.y;
    s.me.yaw = side * Math.PI / 2; s.me.pitch = Math.atan2(0.25 - s.me.eye, 0.9); s.applyCam();
    return s.players[0].D.tillBtn;
  };
  const stoolButtons = guests.slice(0, 2).map(aimAtStool);
  for (const b of stoolButtons) { assert.match(b.textContent, /Take stool/); b.dispatchEvent(new b.ownerDocument.defaultView.Event('pointerdown', { bubbles: true })); }
  await until(() => host.s.world.stools[0].by && guests.every(g => g.s.world.stools[0].by === host.s.world.stools[0].by),
    'exactly one player to get the contested stool');
  const holder = guests.find(g => g.s.players[0].stool);
  assert.equal(guests.filter(g => g.s.players[0].stool).length, 1);
  holder.s.players[0].toggleStep(); assert.ok(holder.s.me.step);
  holder.sockets.at(-1).terminate();
  await until(() => holder.sockets.length === 2 && holder.$('onlineCover').hidden &&
    [host, ...guests].every(g => g.s.world.stools[0].by === null), 'disconnected stool returns home');
  assert.ok(!holder.s.me.step && !holder.s.players[0].stool);

  const items = ['AAA', 'BBC'].map(area => host.s.world.items.find(it => it.loc?.face.area === area && it.loc.z0 < 1.3 && it.loc.z0 > 0.2));
  const lastShelf = items[0].loc.code;
  const order = day.makeOrder('c', items.map((item, i) => ({ item, qty: i ? 2 : host.w.ShiftWorld.room(item) })), null, true, { surname: 'Test' });
  await until(() => guests.every(g => g.s.day().list().some(o => o.id === order.id)), 'shared scanner list');
  for (const g of guests) g.s.enter(); // Today Picking
  phone.s.enter(); guests[1].s.enter(); // claim the same job before either scanner has the answer
  await until(() => guests.some(g => g.s.state() === 'scan'), 'host to confirm the claim');
  const picker = guests.find(g => g.s.state() === 'scan');
  assert.equal(guests.filter(g => g.s.state() === 'scan').length, 1);
  const s = picker.s, local = s.order();
  for (const ln of local.lines) {
    const l = ln.loc;
    s.me.x = (l.x0 + l.x1) / 2; s.me.y = l.face.front + l.face.out * 0.65;
    s.me.squat = l.z0 < 0.45; s.me.eye = s.me.squat ? 0.95 : 1.62; s.me.yaw = l.face.out > 0 ? 0 : Math.PI;
    s.me.pitch = Math.atan2((l.z0 + l.z1) / 2 - s.me.eye, 0.65);
    s.applyCam(); s.cam.updateMatrixWorld();
    for (let n = 0; n < ln.qty; n++) s.scanAt(...s.players[0].centre());
    assert.equal(s.full(), true, 'scanned ' + l.code);
    await s.confirmQty();
  }
  assert.equal(order.status, 'picked'); assert.equal(s.state(), 'put');
  await until(() => guests.every(g => !g.s.world.locs.byCode[lastShelf].item), 'the last unit to disappear for every guest');
  const code = s.day().freeSpots()[0], sp = s.world.holding.spots.find(v => v.code === code);
  s.me.x = sp.x1 + 0.65; s.me.y = (sp.y0 + sp.y1) / 2; s.me.yaw = Math.PI / 2;
  s.me.pitch = Math.atan2((sp.z0 + sp.z1) / 2 - s.me.eye, 0.65); s.applyCam(); s.cam.updateMatrixWorld();
  await s.scanPut(...s.players[0].centre());
  assert.equal(order.status, 'done'); assert.equal(day.hold[code].num, order.no.slice(1));
  await until(() => guests.every(g => g.s.day().hold[code]?.num === day.hold[code].num), 'holding area to match');
  const second = day.start('c');
  await until(() => s.day().list().some(o => o.id === second.id), 'second pick');
  s.enter(); await until(() => second.by === s.players[0].id, 'second claim');
  const connections = picker.sockets.length;
  picker.sockets.at(-1).terminate();
  await until(() => second.status === 'listed', 'disconnect to release the job');
  await until(() => picker.sockets.length === connections + 1 && s.state() === 'home' && picker.$('onlineCover').hidden, 'phone to rejoin and reset scanner');
  assert.equal(s.world.locs.byCode[lastShelf].item, null, 'reconnecting keeps the shelf empty');
  for (const d of s.day().delivery) assert.equal(d.loc.code, day.delivery.find(x => x.id === d.id).loc.code);
  // A guest occupies an existing till, identifies the kiosk customer, and pays through Fusion.
  const cashier = guests[2].s, till = cashier.tills[0];
  cashier.me.x = (till.x0 + till.x1) / 2; cashier.me.y = cashier.world.counter.y0 - 0.7;
  cashier.me.yaw = Math.PI; cashier.me.pitch = Math.atan2(1.15 - cashier.me.eye, (till.y0 + till.y1) / 2 - cashier.me.y);
  cashier.applyCam(); assert.equal(cashier.nearTill(), till);
  await cashier.openTill(); assert.equal(cashier.till.isOpen(), true);
  assert.equal(guests[2].w.document.querySelector('[data-v="tillNumber"]').textContent, '1');
  day.mode = 'kiosk';
  const customer = day.send('kiosk'); customer.pay = { how: 'cash', say: 'Cash, please.' };
  day.arrived(customer);
  await until(() => customer.by === 'p4', 'cashier to claim the customer');
  host.s.tick(6);
  await until(() => cashier.till.stage() === 'details', 'customer to walk to the guest till');
  const ui = cashier.till.debug, session = cashier.till.session();
  assert.equal(session.cust.third.say, customer.cust.third.say);
  ui.F.no.value = session.cust.no; ui.search(); ui.select();
  assert.equal(session.stage, 'kiosk');
  ui.openKiosk(); ui.S.ksel = session.kiosk.mine; ui.kioskSelect();
  ui.goPay(); ui.payCash();
  const cash = session.cash, tillPage = guests[2].w.document;
  assert.ok(cash.due > 0);
  ui.drTake(1);
  cashier.closeTill();
  await cashier.openTill();
  assert.equal(cashier.till.session(), session, 'returning to the till resumes the same sale');
  assert.deepEqual([...cash.hand], [1], 'the coin already taken stays in hand');
  ui.drStart();
  const give = tillPage.querySelector('[data-act="drgive"]');
  give.click();
  assert.ok(!customer.order, 'the host waits for the drawer');
  let left = cash.due;
  for (const amount of guests[2].w.ShiftTill.DENOMS) {
    while (left >= amount) {
      tillPage.querySelector('[data-dr="' + amount + '"]').click();
      left -= amount;
    }
  }
  assert.equal(left, 0);
  give.click();
  await until(() => customer.order && cashier.till.stage() === 'done', 'host-confirmed cash payment');
  assert.equal(cashier.till.session().orderNo, customer.order.no);
  assert.equal(day.orders.filter(o => o.cust === customer).length, 1);
  cashier.closeTill();
  // Reserve the fetched bag's OC slot until the tote actually crosses the counter.
  day.mode = 'hold';
  const collect = day.send('collect', { code, surname: day.hold[code].surname });
  day.arrived(collect); day.greet(collect, 'p1');
  const runner = guests[1].s, runnerDay = runner.day();
  await until(() => runnerDay.list().some(o => o.id === collect.order.id), 'holding-area collection');
  const job = runnerDay.list().find(o => o.id === collect.order.id);
  assert.ok(await runnerDay.take(job));
  runner.me.x = sp.x1 + 0.65; runner.me.y = (sp.y0 + sp.y1) / 2;
  assert.ok(await runnerDay.fetch(job));
  assert.ok(!day.freeSpots().includes(code), 'no other order can occupy a bag return slot');
  const h = runner.world.handover;
  runner.me.x = (h.x0 + h.x1) / 2; runner.me.y = (h.y0 + h.y1) / 2;
  assert.ok(await runnerDay.handOver(job));
  assert.ok(day.freeSpots().includes(code));
  await until(() => guests.every(g => g.s.figs.some(f => f.c?.id === collect.id && f.counterTote)), 'the same parcel on every counter');
  const previous = s.day();
  day.phase = 'lock'; assert.equal(day.lock(), true);
  await until(() => !host.$('dayCover').hidden && guests.every(g => !g.$('dayCover').hidden), 'end of day screens');
  assert.equal(host.$('nextDayBtn').hidden, false);
  assert.ok(guests.every(g => g.$('nextDayBtn').hidden));
  picker.$('nextDayBtn').click();
  assert.equal(picker.$('dayCover').hidden, false);
  assert.equal(s.day(), previous);
  host.$('nextDayBtn').click();
  await until(() => s.day() !== previous && s.day().total === host.s.day().total, 'new day');
  host.sockets.at(-1).terminate();
  await until(() => host.sockets.length === 2 && guests.every(g => g.$('onlineCover').hidden), 'original host to reconnect');
  assert.equal(host.s.crew.length, 1);
  host.sockets.at(-1).send(JSON.stringify({ type: 'leave' }));
  await until(() => guests.every(g => !g.$('onlineCover').hidden && /host left/.test(g.$('roomMessage').textContent)), 'room to end for everyone');
});
