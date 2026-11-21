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
async function game(t, { online = true, phone = false, installed = false, loadPhotos = false, event = null } = {}) {
  const w = new JSDOM(page, { runScripts: 'outside-only', pretendToBeVisual: true,
    url: origin + '/Toolbox/tools/warehouse-shift.html' + (online ? '?relay=' + relay : '') }).window;

  const $ = id => w.document.getElementById(id);
  w.matchMedia = q => ({ matches: (phone && q === '(pointer: coarse)') || (installed && q.includes('display-mode: fullscreen')) });
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
  if (loadPhotos) w.Image = class {
    set src(url) {
      if (url.includes('/photos/')) w.setTimeout(() => this.onload(), 0);
    }
  };
  const blank = () => {}, gradient = () => ({ addColorStop: blank });
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({ measureText: s => ({ width: String(s).length * 8 }),
    createRadialGradient: gradient, createLinearGradient: gradient }, { get: (o, k) => o[k] || blank });
  let lastCCTV = [];
  for (const script of w.document.scripts) {
    const asset = script.getAttribute('src')?.split('?')[0]; if (!asset || asset.startsWith('../')) continue;
    w.eval(readFileSync(path.join(base, asset), 'utf8'));
    if (asset.endsWith('/day.js')) w.ShiftDay.rollEvent = () => event;
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
        copyTextureToTexture() {}
      } };
    }
  }
  await until(() => w.__shift, 'warehouse to load: ' + $('msgText').textContent);
  return { w, $, s: w.__shift, sockets, cctv: () => lastCCTV };
}

test('the normal game starts solo and local split-screen without opening a socket', async t => {
  for (const split of [false, true]) {
    const { $, s, sockets } = await game(t, { online: false });
    assert.equal($('onlineBtn').hidden, false);
    if (split) { $('twoBtn').click(); s.join({ kind: 'kb' }); s.join({ kind: 'pad', pad: 0 }); $('joinGo').click(); }
    else $('startBtn').click();
    assert.equal(s.split(), split); assert.equal(s.players.length, split ? 2 : 1);
    assert.equal($('startCover').hidden, true); assert.equal(s.state(), 'home'); assert.equal(sockets.length, 0);
  }
});

test('Quick Pick confirms the top customer pick only when doing putaway empty-handed', async t => {
  const { $, s } = await game(t, { online: false, phone: true });
  $('startBtn').click();
  for (const job of s.prio()) job.on = false;
  const day = s.day(), button = $('scQuickPick'), confirm = $('scConfirm').querySelector('button');
  for (const o of day.list()) day.take(o, 'test');
  s.players[0].page(-1);
  s.enter();
  assert.equal(s.state(), 'pa');
  assert.equal(button.hidden, true);

  const stock = day.makeOrder('c', []);
  const collect = day.makeOrder('ck', []);
  const till = day.makeOrder('till', []);
  assert.deepEqual(Array.from(day.list()), [collect, till, stock]);
  assert.equal(button.hidden, false);
  assert.doesNotMatch($('scText').textContent, /Picks waiting/);
  button.click();
  assert.equal($('scConfirm').hidden, false);
  assert.equal(confirm.textContent, 'Quick Pick');
  assert.equal(collect.status, 'listed');
  s.back();
  assert.equal($('scConfirm').hidden, true);

  $('scHint').click();
  assert.equal(s.players[0].stats.hints, 0);
  confirm.click();
  assert.equal(s.players[0].stats.hints, 1);

  const carton = day.deliveryLeft()[0], goods = s.world.goodsin[carton.src].obj;
  s.me.x = (goods.x0 + goods.x1) / 2; s.me.y = goods.y1 + 0.35;
  s.me.yaw = 0; s.me.pitch = Math.atan2(goods.z1 / 2 - s.me.eye, s.me.y - (goods.y0 + goods.y1) / 2);
  s.applyCam(); s.cam.updateMatrixWorld();
  s.scanAt(...s.players[0].centre());
  assert.equal(s.state(), 'pato');
  assert.equal(button.hidden, true);

  // Reopen the shift in another test page for the claim, using a real line item.
  const second = await game(t, { online: false, phone: true });
  second.$('startBtn').click();
  for (const job of second.s.prio()) job.on = false;
  const pickDay = second.s.day();
  const item = second.s.world.items.find(it => it.loc && second.w.ShiftWorld.room(it) > 0);
  const urgent = pickDay.makeOrder('till', [{ item, qty: 1 }]);
  second.s.players[0].page(-1);
  second.s.enter();
  second.$('scQuickPick').click();
  assert.equal(urgent.status, 'listed');
  second.$('scConfirm').querySelector('button').click();
  assert.equal(second.s.order(), urgent);
  assert.equal(urgent.by, 'p1');
  assert.equal(second.$('scQuickPick').hidden, true);
});

test('both split-screen cameras retain their shelf photos across frame refreshes', async t => {
  const { $, s } = await game(t, { online: false, loadPhotos: true });
  $('twoBtn').click(); s.join({ kind: 'kb' }); s.join({ kind: 'pad', pad: 0 }); $('joinGo').click();
  const faces = s.world.faces.filter(f => f.kind === 'BB');
  for (const [idx, f] of [faces[0], faces.at(-1)].entries()) {
    const p = s.players[idx];
    p.me.x = (f.x0 + f.x1) / 2; p.me.y = f.front + 0.8 * f.out;
    p.me.yaw = f.out > 0 ? 0 : Math.PI; p.me.pitch = 0;
    p.applyCam();
  }
  const mesh = s.S.groups.main.children.find(o => o.geometry?.getAttribute('aUv'));
  const occupied = () => {
    const ys = Array.from({ length: mesh.count }, (_, i) => mesh.instanceMatrix.array[i * 16 + 14]);
    return [faces[0], faces.at(-1)].every(f => ys.some(y => Math.abs(y - f.front) < 0.8));
  };
  await until(occupied, 'photos on shelves in both halves');
  for (let i = 0; i < 5; i++) {
    await pause(100);
    assert.ok(occupied(), 'both views keep their photos after refresh');
  }
});

test('greeted customers walk to separate tills, wait for a free one and can be served by a teammate', async t => {
  const { $, s } = await game(t, { online: false });
  $('startBtn').click();
  const day = s.day();
  day.mode = 'kiosk'; day.wait = 999;
  day.plan.length = 0;
  // Keep Sam busy while the counter fills.
  s.crew[0].update = () => {};
  const customers = Array.from({ length: 4 }, () => day.send('kiosk'));
  s.tick(20);
  const [first, second, third, fourth] = customers;
  assert.ok(day.greet(first, 'p2'));
  assert.equal(day.greet(second, 'p2'), false);
  assert.ok(day.greet(second, 'p3'));
  assert.ok(day.greet(third, 'p4'));
  assert.ok(day.greet(fourth, 'p1'));
  assert.equal(new Set(customers.slice(0, 3).map(c => c.at)).size, 3);
  assert.ok(fourth.spot.queue);
  s.tick(8);
  assert.ok(customers.slice(0, 3).every(c => c.ready && Math.abs(c.fig.group.position.x - c.spot.x) < 0.02));

  const till = first.at;
  s.me.x = (till.x0 + till.x1) / 2; s.me.y = s.world.counter.y0 - 0.7;
  s.me.yaw = Math.PI; s.me.pitch = Math.atan2(1.15 - s.me.eye, (till.y0 + till.y1) / 2 - s.me.y);
  const rand = day.r; day.r = () => 0.099;
  s.applyCam(); await s.openTill();
  day.r = rand;
  assert.equal($('scanner').hidden, true);
  assert.equal($('bannerTitle').textContent, 'Sam has your scanner');
  assert.equal(s.till.session().dayCust, first);
  assert.equal(first.by, 'p1');
  assert.ok(day.canGreet('p2'));
  assert.equal(day.serve(first, 'Sam'), false);
  assert.equal(day.serve(second, 'p1'), false);
  s.closeTill();
  const sam = s.crew[0];
  s.me.x = sam.x; s.me.y = sam.y;
  s.tick(0.1);
  assert.equal($('scanner').hidden, false);
  assert.equal($('bannerTitle').textContent, 'Scanner returned');
  day.tillDone(first, first.kiosk.list[first.kiosk.mine].lines);
  s.tick(9);
  assert.equal(fourth.at, till);
  assert.equal(fourth.ready, true);
});

test('the parked tote closes the aisle until Sam leaves, and idle stools have half-size walking bounds', async t => {
  const { $, s } = await game(t, { online: false });
  $('startBtn').click();
  const player = s.players[0], sam = s.crew[0], a = s.world.aisles.find(a => a.side === 'R');
  sam.update = () => {};
  sam.x = (a.x0 + a.x1) / 2; sam.y = a.cy;
  sam.moveTrolley(0.05);
  player.me.x = a.mouth - 0.8; player.me.y = a.cy; player.me.yaw = 0;
  player.input.keys.add('r');
  const walk = () => { for (let i = 0; i < 35; i++) player.update(0.05, i * 50); };
  walk();
  assert.ok(player.me.x < a.mouth);
  sam.x = s.world.start.x; sam.y = s.world.start.y;
  sam.trolley.x = sam.x; sam.trolley.y = sam.y;
  walk();
  assert.ok(player.me.x > a.mouth + 0.5);
  for (const bounds of s.world.obstacles.filter(o => o.stool)) {
    const model = s.world.objects.find(o => o.kind === 'kickstool' && o.stoolId === bounds.stool.id);
    assert.ok(Math.abs(2 * (bounds.walk.x1 - bounds.walk.x0) - (model.x1 - model.x0)) < 1e-8);
    assert.ok(Math.abs(2 * (bounds.walk.y1 - bounds.walk.y0) - (model.y1 - model.y0)) < 1e-8);
  }
});

test('Sam rings once at six seconds for unattended customers and skips customers already helped', async t => {
  const { $, s } = await game(t, { online: false });
  $('twoBtn').click(); s.join({ kind: 'kb' }); s.join({ kind: 'pad', pad: 0 }); $('joinGo').click();
  const day = s.day();
  day.plan.length = 0; day.mode = 'kiosk';
  s.crew[0].update = () => {};
  const waiting = day.send('kiosk'); day.arrived(waiting);
  s.tick(5.7);
  assert.ok(s.players.every(p => p.D.bannerTitle.textContent !== 'Ding dong'));
  s.tick(0.5);
  assert.ok(s.players.every(p => p.D.bannerTitle.textContent === 'Ding dong' && p.D.bannerText.textContent === 'Help needed on tills'));
  for (const p of s.players) p.banner('Picking', '', 1500);
  const helped = day.send('kiosk'); day.arrived(helped); day.greet(helped, 'p1'); day.serve(helped, 'p2');
  s.tick(8);
  assert.ok(s.players.every(p => p.D.bannerTitle.textContent === 'Picking'));
});

test('the wall clock follows shelved cartons from 07:00 to 20:00', async t => {
  const { $, s } = await game(t, { online: false });
  $('startBtn').click();
  for (const job of s.prio()) job.on = false;
  const day = s.day();
  const cartons = day.delivery.slice(0, 2);
  assert.equal(cartons.length, 2);
  day.delivery = cartons;
  let minute;
  s.S.clockTick = value => { minute = value; };
  s.tick(0.05);
  assert.equal(minute, 7 * 60);

  const first = day.paTake(null, 'p1');
  assert.ok(first);
  s.tick(0.05);
  assert.equal(minute, 7 * 60);
  assert.ok(day.paPut(first, 'p1'));
  s.tick(0.05);
  assert.equal(minute, 13 * 60 + 30);

  assert.ok(day.paPut(day.paTake(null, 'p1'), 'p1'));
  s.tick(0.05);
  assert.equal(minute, 20 * 60);
});

test('a cancelled delivery starts at 07:00 and appears on the handheld scanner', async t => {
  const { $, s } = await game(t, { online: false, phone: true, event: 'failedDelivery' });
  $('startBtn').click();
  assert.equal($('bannerTitle').textContent, 'Delivery cancelled');
  assert.equal(s.day().delivery.length, 0);
  let minute;
  s.S.clockTick = value => { minute = value; };
  s.tick(0.05);
  assert.equal(minute, 7 * 60);
  s.players[0].page(-1);
  s.enter();
  assert.match($('scText').textContent, /Delivery cancelled/);
});

test('an installed phone with the ordinary launch URL can host or join from its start screen', async t => {
  const manifest = JSON.parse(readFileSync(path.join(base, 'warehouse-shift.webmanifest'), 'utf8'));
  assert.equal(manifest.id, './warehouse-shift.html');
  assert.equal(manifest.start_url, './warehouse-shift.html');
  const { w, $, sockets } = await game(t, { online: false, phone: true, installed: true });
  assert.equal(w.location.search, '');
  assert.equal($('onlineBtn').hidden, false);
  $('onlineBtn').click();
  assert.equal($('onlineCover').hidden, false);
  assert.equal($('roomControls').hidden, false);
  assert.equal(sockets.length, 0);
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
  assert.equal(day.customerLimit(), 4);
  const bell = phone.s.world.bell;
  phone.s.me.x = bell.x; phone.s.me.y = bell.y - 0.9;
  phone.s.me.yaw = Math.PI; phone.s.me.pitch = Math.atan2(bell.z - phone.s.me.eye, 0.9);
  phone.s.applyCam();
  const bellButton = phone.s.players[0].D.tillBtn;
  assert.match(bellButton.textContent, /Ring bell/);
  bellButton.dispatchEvent(new phone.w.Event('pointerdown', { bubbles: true }));
  await until(() => [host, ...guests].every(g => g.$('bannerTitle').textContent === 'Ding dong' &&
    g.$('bannerText').textContent === 'Help needed on tills'), 'phone bell press to reach all four players');
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
  const rand = day.r; day.r = () => 0.05;
  host.s.tick(6); day.r = rand;
  await until(() => guests[2].$('scanner').hidden, 'guest cashier to lose their scanner');
  assert.ok([host, ...guests.slice(0, 2)].every(g => !g.$('scanner').hidden));
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
  cashier.me.x = host.s.crew[0].x; cashier.me.y = host.s.crew[0].y;
  cashier.applyCam();
  await until(() => !guests[2].$('scanner').hidden, 'guest to collect their scanner from Sam');
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
  host.w.ShiftDay.rollEvent = () => 'failedDelivery';
  host.$('nextDayBtn').click();
  await until(() => s.day() !== previous && guests.every(g => g.s.day().event === 'failedDelivery' &&
    g.s.day().clockMinute() === 7 * 60 && g.$('bannerTitle').textContent === 'Delivery cancelled'), 'host event to start on all devices');
  const cancelled = host.s.day();
  assert.equal(cancelled.delivery.length, 0);
  cancelled.walkinTill = 0;
  const visitor = cancelled.start('ck');
  cancelled.arrived(visitor); cancelled.greet(visitor, 'p1');
  cancelled.take(visitor.order, 'p1'); cancelled.picked(visitor.order); cancelled.handOver(visitor.order, 'p1');
  await until(() => guests.every(g => g.s.day().clockMinute() === cancelled.clockMinute() && g.s.day().done === 1),
    'customer handover to advance the shared wall clock');
  host.sockets.at(-1).terminate();
  await until(() => host.sockets.length === 2 && guests.every(g => g.$('onlineCover').hidden), 'original host to reconnect');
  assert.equal(host.s.crew.length, 1);
  assert.ok(guests.every(g => g.s.day().event === 'failedDelivery'));
  host.sockets.at(-1).send(JSON.stringify({ type: 'leave' }));
  await until(() => guests.every(g => !g.$('onlineCover').hidden && /host left/.test(g.$('roomMessage').textContent)), 'room to end for everyone');
});
