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
async function game(t, { online = true, phone = false, installed = false, loadPhotos = false, event = null, storage = {}, speech = null } = {}) {
  const w = new JSDOM(page, { runScripts: 'outside-only', pretendToBeVisual: true,
    url: origin + '/Toolbox/tools/warehouse-shift.html' + (online ? '?relay=' + relay : '') }).window;

  const $ = id => w.document.getElementById(id);
  w.matchMedia = q => ({ matches: (phone && q === '(pointer: coarse)') || (installed && q.includes('display-mode: fullscreen')) });
  if (!phone) delete w.ontouchstart;
  w.innerWidth = phone ? 844 : 1280; w.innerHeight = phone ? 390 : 720;
  for (const [key, value] of Object.entries(storage)) w.localStorage.setItem(key, value);
  w.localStorage.setItem('toolbox.signedIn.area20', 'STEPHEN');
  w.localStorage.setItem('ws-helped', '1'); w.localStorage.setItem('ws-sound', speech ? 'on' : 'off');
  if (speech) {
    w.speechSynthesis = speech;
    w.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  }
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

function openShop(device) {
  const p = device.s.players[0];
  p.openPc();
  const pc = p.D.root.querySelector('.ws-pc');
  pc.querySelector('[data-pc="shop"]').click();
  assert.equal(pc.querySelector('.ws-shop').hidden, false);
  return pc;
}

test('character voices read English dialogue and can be muted without muting game sounds', async t => {
  const calls = [];
  const speech = {
    getVoices: () => [{ lang: 'en-GB', localService: true }, { lang: 'en-IE', localService: true },
      { lang: 'fr-FR', localService: true }, { lang: 'fi-FI', localService: true }],
    speak: utterance => calls.push(utterance),
    cancel: () => calls.push(null)
  };
  const { $, s, w } = await game(t, { online: false, speech });
  $('startBtn').click();
  const p = s.players[0], sam = s.crew[0], day = s.day();
  day.plan.length = 0;
  Object.assign(s.me, { x: sam.x, y: sam.y });
  sam.say('Excuse me, please.');
  assert.equal(calls.at(-1).lang, 'en-GB');
  assert.equal(calls.at(-1).volume, 0.5);
  const cust = day.send('till');
  p.till.open(1);
  p.till.serve(cust.cust, cust.lines, '#246', { dayCust: cust, hello: 'Hello, I would like to order.' });
  assert.equal(calls.at(-1).text, 'Hello, I would like to order.');
  assert.equal(calls.at(-1).lang, 'en-IE');
  sam.say('I can take the next order.');
  assert.equal(calls.at(-1).lang, 'en-IE', 'nearby chatter does not interrupt the customer at the till');
  for (const [id, lang] of [[3, 'fr-FR'], [6, 'fi-FI']]) {
    const hello = 'Could I collect my order, please?';
    p.till.serve(cust.cust, cust.lines, '#246', { dayCust: { id }, hello });
    assert.equal(calls.at(-1).lang, lang);
    assert.equal(calls.at(-1).text, hello, 'the foreign-language voice still reads English');
  }
  p.closeTill();
  assert.equal(calls.at(-1), null, 'stepping away stops the till speech');
  p.menu(true);
  p.D.scMenu.querySelector('[data-k="8"]').click();
  assert.equal(w.localStorage.getItem('ws-voices'), 'off');
  assert.equal(w.localStorage.getItem('ws-sound'), 'on');
  assert.equal($('voicesOn').checked, false);
  const count = calls.length;
  sam.say('I will be by holding.');
  assert.equal(calls.length, count);
  assert.equal(sam.log.at(-1).text, 'I will be by holding.');
});

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

test('a shop-floor sale fills the replen scanner and the middle shelf pays the batch once', async t => {
  const { $, s, w } = await game(t, { online: false, phone: true });
  $('startBtn').click();
  const day = s.day(), player = s.players[0], scanner = player.D;
  s.tapRow(2); s.tapRow(2);
  assert.match(scanner.scRows.textContent, /Shop floor full/);
  const c = day.send('kiosk'), basket = c.kiosk.list[c.kiosk.mine].lines;
  const ix = day.world.items.findIndex(it => it.loc?.face.area === 'BAA' && it.loc.z0 > 0.45 && it.loc.z1 < 1.8 &&
    it.size !== 'B' && w.ShiftWorld.room(it) >= 4 && basket.every(l => l.item !== it));
  assert.ok(ix >= 0);
  day.floorRandom = () => (ix + 0.5) / day.world.items.length;
  c.state = 'counter'; day.serve(c, 'Sam');
  assert.ok(c.floorOffer?.say.includes('floor') || c.floorOffer?.say.includes('shelf'));
  const order = day.tillDone(c, basket);
  assert.ok(order.lines.every(l => l.item !== c.floorOffer.item));
  const batch = day.orders.find(o => o.kind === 'replen');
  assert.equal(day.list().includes(batch), false);
  const before = day.baseXP;
  s.enter(); assert.equal(s.order(), batch);
  assert.match(scanner.scText.textContent, /Pick replen/);
  const ln = batch.lines[0], l = ln.loc;
  s.me.x = (l.x0 + l.x1) / 2; s.me.y = l.face.front + l.face.out * 0.65;
  s.me.yaw = l.face.out > 0 ? 0 : Math.PI;
  s.me.pitch = Math.atan2((l.z0 + l.z1) / 2 - s.me.eye, 0.65);
  s.applyCam(); s.cam.updateMatrixWorld();
  for (let i = 0; i < ln.qty; i++) s.scanAt(...player.centre());
  assert.equal(s.full(), true);
  await s.confirmQty(); assert.equal(s.state(), 'restock');
  assert.equal(day.baseXP, before);
  assert.equal(day.restock(batch, 'p1', s.me), false);
  const shelf = s.world.replenShelf;
  Object.assign(s.me, { x: shelf.x1 + 0.7, y: (shelf.y0 + shelf.y1) / 2, yaw: Math.PI / 2, pitch: -0.4 });
  s.applyCam();
  assert.match(scanner.tillBtn.textContent, /Restock shelf/);
  scanner.tillBtn.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
  assert.equal(batch.status, 'done');
  assert.equal(day.baseXP, before + 10 * ln.qty);
  assert.equal(day.restock(batch, 'p1', s.me), false);
  assert.match(scanner.scRows.textContent, /Shop floor full/);
});

test('Quick Pick confirms the top customer pick only when doing putaway empty-handed', async t => {
  const { $, s } = await game(t, { online: false, phone: true });
  $('startBtn').click();
  for (const job of s.prio()) job.on = false;
  const day = s.day(), button = $('scQuickPick'), options = $('scConfirm'), hint = s.players[0].D.scConfirmHint;
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
  assert.deepEqual(Array.from(options.querySelectorAll('button:not([hidden])'), option => option.textContent),
    ['Function', 'Hint', 'Quick Pick']);
  assert.equal(collect.status, 'listed');
  assert.equal(s.players[0].stats.hints, 0);
  hint.click();
  assert.equal(s.players[0].stats.hints, 1, 'choose Hint after opening with Quick Pick');
  assert.ok(options.hidden);
  assert.equal(collect.status, 'listed');
  $('scHint').click();
  s.back();
  assert.ok(options.hidden);
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
  second.s.players[0].D.scConfirmQuickPick.click();
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
  const counter = s.world.counter, target = first.fig.group.position, player = s.players[0];
  function aimAtCustomer(x, y) {
    Object.assign(s.me, { x, y, yaw: Math.atan2(x - target.x, y - target.z),
      pitch: Math.atan2(1.2 - s.me.eye, Math.hypot(x - target.x, y - target.z)) });
    s.applyCam();
  }
  aimAtCustomer(target.x, counter.y0 - 0.7);
  assert.equal($('tillBtn').textContent.trim(), 'GreetF');
  assert.equal($('tillBtn').hidden, false);
  assert.match(player.D.scNote.textContent, /say hello/);
  for (const [x, y] of [[target.x, counter.y1 + 0.2], [counter.x0 - 0.1, counter.y0 - 0.7]]) {
    aimAtCustomer(x, y);
    assert.ok($('tillBtn').hidden || !$('tillBtn').textContent.startsWith('Greet'));
    assert.doesNotMatch(player.D.scNote.textContent, /say hello/);
  }
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
  day.scannerMixups.unlabelled.until = 1;
  s.applyCam(); await s.openTill();
  const recovery = player.D.scannerRecovery;
  assert.equal($('scanner').hidden, false);
  assert.equal(recovery.hidden, true);
  assert.equal(s.till.session().dayCust, first);
  assert.equal(first.by, 'p1');
  assert.ok(day.canGreet('p2'));
  assert.equal(day.serve(first, 'Sam'), false);
  assert.equal(day.serve(second, 'p1'), false);
  day.tillDone(first, first.kiosk.list[first.kiosk.mine].lines);
  assert.equal($('scanner').hidden, true);
  assert.equal(recovery.hidden, false);
  assert.match(recovery.textContent, /Close the till, then walk up to Sam/);
  player.banner('Other shift message');
  assert.equal(recovery.hidden, false);
  s.closeTill();
  assert.equal(recovery.hidden, false);
  const sam = s.crew[0];
  s.me.x = sam.x; s.me.y = sam.y;
  s.tick(0.1);
  assert.equal($('scanner').hidden, false);
  assert.equal($('bannerTitle').textContent, 'Scanner returned');
  assert.equal(recovery.hidden, true);
  s.tick(9);
  assert.equal(fourth.at, till);
  assert.equal(fourth.ready, true);
});

test('Sam waits near holding until till-trained, and only then can roll light duties', async t => {
  const { $, s } = await game(t, { online: false, event: 'lightDuties' });
  $('startBtn').click();
  const sam = s.crew[0], day = s.day();
  assert.equal(day.event, null);
  day.wait = Infinity;
  s.prio().find(job => job.id === 'delivery').on = false;
  const near = spot => Math.hypot(sam.x - spot.x, sam.y - spot.y) < 0.85;
  s.tick(30);
  assert.ok(near(sam.waitSpot) && !sam.atTill, 'untrained Sam waits by holding');
  day.credit('p1', 'till-training-test', 150);
  openShop({ s }).querySelector('[data-training="queue"]').click();
  s.players[0].closePc();
  s.tick(30);
  assert.ok(near(sam.post) && sam.atTill, 'trained Sam covers his till when idle');
  s.newDay();
  assert.equal(s.day().event, 'lightDuties');
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

test('Sam rings once after six seconds when within reach and skips customers already helped', async t => {
  const { $, s } = await game(t, { online: false });
  $('twoBtn').click(); s.join({ kind: 'kb' }); s.join({ kind: 'pad', pad: 0 }); $('joinGo').click();
  const day = s.day();
  day.plan.length = 0; day.mode = 'kiosk';
  const sam = s.crew[0], bell = s.world.bell;
  sam.update = () => {};
  Object.assign(sam, { x: bell.x, y: bell.y - 0.8 });
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
  const host = await game(t, { storage: { 'ws-digital-first': '4' } }), guests = [];
  host.$('onlineBtn').click(); host.$('hostRoom').click();
  await until(() => !host.$('roomBtn').hidden, 'host admission');
  // Schedule just the jobs this test exercises while Sam continues to run in the host.
  const day = host.s.day(); day.plan.length = 0;
  assert.equal(day.walkinTill, 0.35, "the host sets the mix for the entire room");
  for (const job of host.s.prio()) job.on = false;
  const room = host.$('roomBtn').textContent.slice(0, 6);
  for (let i = 0; i < 3; i++) {
    const guest = await game(t, { phone: i === 0, storage: i === 2 ?
      { 'ws-shift-xp/prior': '600', 'ws-kit-shoes': '1', 'ws-kit-label': '1', 'ws-sam-training': '{"queue":"paid"}' } : {} });
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
    g.$('bannerText').textContent === 'Help needed on tills' &&
    /Sam isn't till trained yet.*100 XP/.test(g.s.players[0].D.bannerDetail.textContent)),  'phone bell press to reach all four players');
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
  // The host's shift clock crashes the scanner of the guest currently on a pick.
  day.faultSchedule = [0.25];
  host.s.tick(0.3);
  await until(() => !s.players[0].D.scCodeRain.hidden, 'guest scanner to show falling text');
  assert.ok(host.s.players[0].D.scannerFault.hidden);
  assert.ok(!await s.day().request('swapScanner', {}), 'the counter is too far from the office');
  assert.ok(!await s.day().line(local, 0));
  const dock = s.world.scannerDock;
  Object.assign(s.me, { x: dock.x, y: dock.y - 0.85, yaw: Math.PI, pitch: Math.atan2(dock.z - s.me.eye, 0.85) });
  s.applyCam();
  assert.match(s.players[0].D.tillBtn.textContent, /Swap scanner/);
  s.players[0].D.tillBtn.dispatchEvent(new picker.w.Event('pointerdown', { bubbles: true }));
  await until(() => s.players[0].D.scannerFault.hidden, 'replacement to restore the guest scanner');
  assert.equal(s.order(), local);

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
  const liveCredit = 'ws-shift-xp/' + day.shiftId;
  const liveTotal = String(day.baseXP + Math.round(day.coveredXP * 0.05));
  await until(() => picker.w.localStorage.getItem(liveCredit) === liveTotal, 'guest to receive XP before disconnect');
  const connections = picker.sockets.length;
  picker.sockets.at(-1).terminate();
  await until(() => second.status === 'listed', 'disconnect to release the job');
  await until(() => picker.sockets.length === connections + 1 && s.state() === 'home' && picker.$('onlineCover').hidden, 'phone to rejoin and reset scanner');
  assert.equal(s.world.locs.byCode[lastShelf].item, null, 'reconnecting keeps the shelf empty');
  assert.equal(picker.w.localStorage.getItem(liveCredit), liveTotal, 'replaying the snapshot preserves earned XP');
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
  const kioskOrder = customer.kiosk.list[customer.kiosk.mine];
  kioskOrder.lines = kioskOrder.lines.filter(l => !l.shortage);
  host.w.ShiftTill.addStockRequest(day.world, kioskOrder.lines, () => 0.1);
  kioskOrder.total = kioskOrder.lines.reduce((sum, l) => sum + host.w.ShiftTill.price(l.item) * l.qty, 0);
  day.arrived(customer);
  await until(() => customer.by === 'p4', 'cashier to claim the customer');
  day.scannerMixups.labelled.limit = day.scannerMixups.labelled.until = 1;
  host.s.tick(6);
  await until(() => cashier.till.stage() === 'details', 'customer to walk to the guest till');
  assert.equal(guests[2].$('scanner').hidden, false);
  assert.equal(cashier.players[0].D.scannerRecovery.hidden, true);
  const ui = cashier.till.debug, session = cashier.till.session();
  assert.equal(session.cust.third.say, customer.cust.third.say);
  ui.F.no.value = session.cust.no; ui.search(); ui.select();
  assert.equal(session.stage, 'kiosk');
  ui.openKiosk(); ui.S.ksel = session.kiosk.mine; ui.kioskSelect();
  if (customer.floorOffer) {
    assert.equal(session.ready, false);
    await until(() => cashier.till.el.querySelector('.fu-delivery.picked'), 'guest till to scan the shelf item');
  }
  ui.goPay();
  assert.equal(session.stage, 'ordering', 'the customer needs the extra line set to TCND');
  const extra = kioskOrder.lines.at(-1);
  const delivery = cashier.till.el.querySelector('[data-delivery="' + session.basket.findIndex(row => row.code === extra.item.code) + '"]');
  assert.equal(delivery.textContent, 'Today');
  delivery.click();
  assert.equal(delivery.textContent, 'TCND');
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
  await until(() => guests[2].$('scanner').hidden, 'guest cashier to lose their scanner after payment');
  assert.equal(cashier.players[0].D.scannerRecovery.hidden, false);
  assert.ok([host, ...guests.slice(0, 2)].every(g => !g.$('scanner').hidden && g.s.players[0].D.scannerRecovery.hidden));
  assert.equal(cashier.till.session().orderNo, customer.order.no);
  assert.ok(customer.order.lines.every(l => l.item.code !== extra.item.code), 'only Today items go to the warehouse');
  assert.equal(day.orders.filter(o => o.cust === customer).length, 1);
  cashier.closeTill();
  cashier.me.x = host.s.crew[0].x; cashier.me.y = host.s.crew[0].y;
  cashier.applyCam();
  await until(() => !guests[2].$('scanner').hidden, 'guest to collect their scanner from Sam');
  assert.equal(cashier.players[0].D.scannerRecovery.hidden, true);
  assert.ok(host.s.crew[0].log.some(line => /name/.test(line.text)), 'Sam notices the name on the guest scanner');
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
  await until(() => Number(picker.w.localStorage.getItem(liveCredit)) === day.baseXP + Math.round(day.coveredXP * 0.05), 'guest to bank live team XP');
  const guestShop = openShop(picker);
  assert.equal(guestShop.querySelector('[data-pc="jobs"]').disabled, true);
  picker.s.players[0].closePc();
  day.phase = 'lock'; assert.equal(day.lock(), true);
  await until(() => !host.$('dayCover').hidden && guests.every(g => !g.$('dayCover').hidden), 'end of day screens');
  const receipt = 'ws-shift-xp/' + day.shiftId;
  for (const device of [host, ...guests]) {
    const active = day.contributors.has(device.s.players[0].id);
    assert.equal(device.w.localStorage.getItem(receipt), active ? String(day.report.xp) : null);
    assert.equal(device.$('shiftScore').textContent, host.$('shiftScore').textContent);
  }
  const beforeReconnect = picker.$('careerXP').textContent;
  const endedConnections = picker.sockets.length;
  picker.sockets.at(-1).terminate();
  await until(() => picker.sockets.length > endedConnections && picker.$('onlineCover').hidden && !picker.$('dayCover').hidden,
    'guest to rejoin the completed shift');
  assert.equal(picker.$('careerXP').textContent, beforeReconnect);
  const previous = s.day();
  assert.equal(previous.report.id, day.shiftId);
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
  assert.equal(cancelled.walkinTill, 0.35, 'the host tier also applies on the next day');
  assert.equal(cancelled.delivery.length, 0);
  assert.equal(cancelled.firstDay, false);
  cancelled.walkinTill = 0;
  const visitor = cancelled.start('ck');
  cancelled.arrived(visitor); cancelled.greet(visitor, 'p1');
  cancelled.take(visitor.order, 'p1'); cancelled.picked(visitor.order); cancelled.handOver(visitor.order, 'p1');
  await until(() => guests.every(g => g.s.day().clockMinute() === cancelled.clockMinute() && g.s.day().done === 1),
    'customer handover to advance the shared wall clock');
  const shoeUser = guests[2].s;
  const highItem = host.s.world.items.find(it => it.loc?.face.kind === 'AA' && it.loc.shelf.no >= 13 && host.w.ShiftWorld.room(it) > 0);
  const high = cancelled.makeOrder('c', [{ item: highItem, qty: 1 }], null, true);
  await until(() => shoeUser.day().orders.some(o => o.id === high.id), 'high pick to reach the guest with shoes');
  const proxy = shoeUser.day(), highJob = proxy.orders.find(o => o.id === high.id), shelf = highJob.lines[0].loc;
  assert.ok(await proxy.take(highJob));
  shoeUser.me.x = (shelf.x0 + shelf.x1) / 2; shoeUser.me.y = shelf.face.front + shelf.face.out * 0.65;
  assert.equal(await proxy.line(highJob, 0), false);
  shoeUser.players[0].toggleStep();
  assert.ok(await proxy.line(highJob, 0), 'host accepts high shelf with deployed shoes');
  assert.ok(host.s.world.stools.every(stool => !stool.by));
  host.sockets.at(-1).terminate();
  await until(() => host.sockets.length === 2 && guests.every(g => g.$('onlineCover').hidden), 'original host to reconnect');
  assert.equal(host.s.crew.length, 1);
  assert.ok(guests.every(g => g.s.day().event === 'failedDelivery'));
  host.sockets.at(-1).send(JSON.stringify({ type: 'leave' }));
  await until(() => guests.every(g => !g.$('onlineCover').hidden && /host left/.test(g.$('roomMessage').textContent)), 'room to end for everyone');
});

test('split-screen banks till-cover XP and buys separate Sam skills mid-shift', async t => {
  const { $, w, s } = await game(t, { online: false });
  $('twoBtn').click(); s.join({ kind: 'kb' }); s.join({ kind: 'pad', pad: 0 }); $('joinGo').click();
  const [p, worker] = s.players;
  p.D.scFn.click();
  assert.ok(!p.D.scConfirm.hidden && worker.D.scConfirm.hidden);
  assert.ok(p.D.scConfirmHint.hidden && p.D.scConfirmQuickPick.hidden, 'home only offers Function');
  p.D.scConfirmFn.click();
  assert.ok(!p.D.scMenu.hidden && worker.D.scMenu.hidden);
  p.back();
  const d = s.day(), counter = s.world.counter, till = s.tills[0];
  assert.ok(d.firstDay);
  assert.ok(d.delivery.length >= 4 && d.delivery.length <= 5);
  const jobsOn = () => Array.from(s.prio().filter(j => j.on), j => j.id);
  assert.deepEqual(jobsOn(), ['delivery']);

  // A fresh Sam neither greets nor serves, even after the bell.
  d.plan.length = 0;
  const c = d.send('till');
  d.arrived(c);
  d.t += 6;
  assert.equal(s.crew[0].choose()?.greet, undefined);
  const sam = s.crew[0], bell = s.world.bell;
  const originalUpdate = sam.update;
  sam.update = () => false;
  Object.assign(sam, { x: bell.x, y: bell.y - 4 });
  s.tick(0.3);
  assert.doesNotMatch(p.D.bannerDetail.textContent, /100 XP on the Manager PC/);
  assert.equal(c.helpCalled, undefined);
  Object.assign(sam, { x: bell.x, y: bell.y - 0.8 });
  s.tick(0.3);
  assert.match(p.D.bannerDetail.textContent, /100 XP on the Manager PC/);
  assert.equal(c.state, 'greet');

  Object.assign(sam, { x: bell.x, y: bell.y - 4 });
  sam.update = originalUpdate;
  Object.assign(p.me, { x: counter.x1 - 0.1, y: counter.y0 - 1.68, speed: 2 });
  Object.assign(worker.me, { x: counter.x0 - 4, y: counter.y0 - 4 });
  s.tick(0.3);
  assert.equal(p.D.coverBonus.hidden, false);
  assert.equal(p.D.coverBonus.textContent, 'Service Champ bonus +5% XP');
  d.credit('p2', 'test-work', 900);
  assert.ok(d.contributors.has('p1'), 'standing cover contributes');
  Object.assign(p.me, { x: (till.x0 + till.x1) / 2, y: counter.y1 + 0.6 });
  d.credit('p2', 'test-uncovered', 10);
  assert.equal(d.coveredXP, 900);
  const key = 'ws-shift-xp/' + d.shiftId;
  assert.equal(Number(w.localStorage.getItem(key)), 955);
  const pc = openShop({ s });
  const buy = id => pc.querySelector('[data-training="' + id + '"]').click();
  buy('queue'); buy('queue');
  assert.equal(p.D.xpBalance.textContent, '855 XP');
  assert.deepEqual(jobsOn(), ['queue', 'delivery']);
  assert.equal(s.crew[0].choose().greet, c, 'till training lets Sam greet immediately');
  buy('hold');
  assert.deepEqual(jobsOn(), ['queue', 'hold', 'delivery']);
  buy('cust');
  assert.deepEqual(jobsOn(), ['cust', 'queue', 'hold', 'delivery']);
  assert.equal(worker.D.xpBalance.textContent, '655 XP');
  p.closePc();

  d.phase = 'lock'; d.lock();
  const total = d.report.xp;
  assert.equal(Number(w.localStorage.getItem(key)), total);
  assert.equal(d.report.coverBonus, Math.round(900 * (1 + d.report.score / 4000) * 0.05));
  assert.match($('earnedXP').textContent, /Service Champ bonus/);
  assert.match($('scoreUnlock').textContent, /Sam’s job presets/);
  d.emit('over');
  assert.match($('careerXP').textContent, new RegExp('^' + total + ' career XP'));
  assert.equal([...Array(w.localStorage.length).keys()].filter(i => w.localStorage.key(i).startsWith('ws-shift-xp/')).length, 1);

  p.openPc();
  const panel = pc.querySelector('.ws-presets');
  const preset = (action, i) => panel.querySelector('[data-pc="' + action + '"][data-i="' + i + '"]').click();
  preset('load', 1);
  assert.equal(jobsOn().length, 4);
  assert.equal(s.prio()[0].id, 'delivery');
  preset('save', 0);
  assert.equal(JSON.parse(w.localStorage.getItem('ws-sam-preset-0'))[0].id, 'delivery');
  const storage = Object.fromEntries(Object.entries(w.localStorage));
  const reopened = await game(t, { online: false, storage });
  assert.match(reopened.$('careerXP').textContent, /4\/4 skills/);
  assert.equal(reopened.s.prio().filter(j => j.on).length, 4);
});

test('paid job slots become skills based on saved priorities without changing XP', async t => {
  const oldJobs = ['hold', 'delivery', 'queue', 'cust'].map(id => ({ id, on: id === 'queue' || id === 'delivery' }));
  const { $, w, s } = await game(t, { online: false, storage: {
    'ws-sam-prio': JSON.stringify(oldJobs), 'ws-sam-job-slots': '2', 'ws-shift-xp/prior': '500'
  } });
  $('startBtn').click();
  const pc = openShop({ s });
  assert.equal(pc.querySelector('[data-training="queue"]').textContent, 'Trained');
  assert.match($('careerXP').textContent, /2\/4 skills.*400 XP available/);
  s.players[0].closePc();
  const bell = s.world.bell;
  Object.assign(s.me, { x: bell.x, y: bell.y - 0.9, yaw: Math.PI, pitch: Math.atan2(bell.z - s.me.eye, 0.9) });
  s.applyCam();
  s.players[0].D.tillBtn.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
  assert.equal($('bannerTitle').textContent, 'Ding dong');
  assert.equal(s.players[0].D.bannerDetail.hidden, true);
  openShop({ s }).querySelector('[data-training="hold"]').click();
  assert.match($('careerXP').textContent, /3\/4 skills.*300 XP available/);
  const saved = Object.fromEntries(Object.entries(w.localStorage));
  const reopened = await game(t, { online: false, storage: saved });
  assert.match(reopened.$('careerXP').textContent, /3\/4 skills.*300 XP available/);
});

test('kickstool shoes and a named scanner spend earned XP once and work on a phone after relaunch', async t => {
  const first = await game(t, { online: false, phone: true, storage: { 'ws-shift-xp/previous': '500' } });
  first.$('startBtn').click(); openShop(first);
  const buy = id => first.w.document.querySelector('[data-kit="' + id + '"]').click();
  buy('label'); buy('shoes'); buy('shoes');
  assert.match(first.$('careerXP').textContent, /0 XP available/);
  assert.ok(first.w.document.querySelector('[data-training="queue"]').disabled);
  const { $, s, w } = await game(t, { online: false, phone: true, storage: Object.fromEntries(Object.entries(first.w.localStorage)) });
  $('nameIn').value = 'JO'; $('nameIn').dispatchEvent(new w.Event('input'));
  $('startBtn').click();
  const p = s.players[0];
  assert.equal(p.D.nameLabel.hidden, false);
  assert.equal(p.D.nameLabel.textContent, 'JO');
  assert.equal(p.D.stepBtn.hidden, false);
  p.D.stepBtn.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
  assert.equal(p.me.step, true); assert.ok(s.world.stools.every(stool => !stool.by));
  p.D.stepBtn.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
  assert.equal(p.me.step, false);
});

test('a phone buys scanner reliability, swaps at the office and keeps its delivery carton', async t => {
  const initial = await game(t, { phone: true, online: false, storage: { 'ws-shift-xp/prior': '350' } });
  initial.$('startBtn').click();
  const pc = openShop(initial);
  const upgrade = pc.querySelector('[data-reliability]');
  upgrade.click(); upgrade.click();
  assert.match(pc.querySelector('[data-status="reliability"]').textContent, /Tier 3\/5 · Up to 3 disconnects/);
  assert.ok(upgrade.disabled);
  const { s, $, w } = await game(t, { phone: true, online: false, storage: Object.fromEntries(Object.entries(initial.w.localStorage)) });
  $('startBtn').click();
  const day = s.day(), p = s.players[0];
  assert.equal(day.faultSchedule.length, 3);
  p.page(-1); s.enter();
  const first = day.deliveryLeft()[0], cage = s.world.goodsin[first.src].obj;
  Object.assign(s.me, { x: (cage.x0 + cage.x1) / 2, y: cage.y1 + 0.35, yaw: 0 });
  s.me.pitch = Math.atan2(cage.z1 / 2 - s.me.eye, s.me.y - (cage.y0 + cage.y1) / 2);
  s.applyCam(); s.cam.updateMatrixWorld(); s.scanAt(...p.centre());
  const held = day.delivery.find(d => d.by === 'p1');
  assert.ok(held);
  day.faultSchedule = [0.25];
  s.tick(0.3);
  assert.ok(!p.D.scannerFault.hidden && p.D.scScreen.hidden && !p.D.scCodeRain.hidden);
  assert.ok(p.D.scConnectionIssue.hidden && p.D.scSwapHelp.hidden);
  await until(() => !p.D.scConnectionIssue.hidden, 'connection error to follow the falling text');
  assert.equal(p.D.scConnectionIssue.textContent, 'Server connection issue');
  assert.ok(p.D.scCodeRain.hidden && p.D.scSwapHelp.hidden);
  await until(() => !p.D.scSwapHelp.hidden, 'the office swap message to follow the connection error');
  assert.match(p.D.scSwapHelp.textContent, /charging dock in the office/);
  s.enter(); assert.equal(s.state(), 'pato');
  const q = s.world.scannerDock;
  Object.assign(s.me, { x: q.x, y: q.y - 0.85, yaw: Math.PI, pitch: Math.atan2(q.z - s.me.eye, 0.85) });
  s.applyCam(); assert.match(p.D.tillBtn.textContent, /Swap scanner/);
  p.D.tillBtn.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
  assert.ok(p.D.scannerFault.hidden && !p.D.scScreen.hidden);
  assert.equal(s.state(), 'pato'); assert.equal(held.by, 'p1');
});

test('Digital First upgrades spend shared XP, persist, and apply when the next shift starts', async t => {
  const initial = await game(t, { online: false, phone: true, storage: { 'ws-shift-xp/prior': '350' } });
  initial.$('startBtn').click();
  const pc = openShop(initial);
  const upgrade = pc.querySelector('[data-digital]');
  assert.match(pc.querySelector('[data-status="digital"]').textContent, /Tier 1\/5 · 20% click & collect/);
  upgrade.click();
  upgrade.click();
  assert.equal(initial.w.localStorage.getItem('ws-digital-first'), '3');
  assert.ok(upgrade.disabled, 'the remaining 50 XP cannot buy another tier');
  assert.ok(pc.querySelector('[data-training="queue"]').disabled, 'Digital First spends the same XP as Sam training');

  const saved = Object.fromEntries(Object.entries(initial.w.localStorage));
  const reopened = await game(t, { online: false, phone: true, storage: saved });
  reopened.$('startBtn').click();
  assert.equal(reopened.s.day().walkinTill, 0.5);
  assert.equal(reopened.$('dayCover').querySelector('[data-digital]'), null);
  assert.match(openShop(reopened).querySelector('[data-status="digital"]').textContent, /Tier 3\/5 · 50% click & collect/);
});

for (const lesson of ['tour', 'kiosk', 'catalogue', 'holding']) {
  test('playable induction completes ' + lesson + ' without a career write', async t => {
    const { w, sockets } = await game(t, { online: false, storage: { 'ws-shift-xp/existing': '442', 'ws-kit-shoes': '1' } });
    w.eval(readFileSync(path.join(REPO, '.github/warehouse-shift/tutorial-playthrough.js'), 'utf8'));
    assert.ok(await w.playTutorial(lesson));
    assert.equal(sockets.length, 0);
  });
}
