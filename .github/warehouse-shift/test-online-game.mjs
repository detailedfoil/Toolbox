// Four independent game pages talking to a local Wrangler instance. Only canvas drawing is stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import WebSocket from 'ws';
import { REPO } from '../tests/load.mjs';

const origin = 'https://detailedfoil.github.io', base = path.join(REPO, 'tools');
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
  for (const script of w.document.scripts) {
    const asset = script.getAttribute('src')?.split('?')[0]; if (!asset || asset.startsWith('../')) continue;
    w.eval(readFileSync(path.join(base, asset), 'utf8'));
    if (asset.endsWith('three.min.js')) {
      w.THREE = { ...w.THREE, WebGLRenderer: class {
        capabilities = { getMaxAnisotropy: () => 1, maxTextureSize: 1024 };
        setPixelRatio() {} setSize() {} compile() {} setScissorTest() {} setScissor() {} setViewport() {}
        render(scene, cam) { cam.updateMatrixWorld(); }
      } };
    }
  }
  await until(() => w.__shift, 'warehouse to load: ' + $('msgText').textContent);
  return { w, $, s: w.__shift, sockets };
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
  const room = host.$('roomBtn').textContent.slice(0, 6);
  for (let i = 0; i < 3; i++) {
    const guest = await game(t, { phone: i === 0 });
    guest.$('onlineBtn').click(); guest.$('roomCode').value = room; guest.$('joinRoom').click();
    await until(() => !guest.$('roomBtn').hidden, 'guest admission: ' + guest.$('roomMessage').textContent);
    assert.equal(guest.s.crew.length, 0); guests.push(guest);
  }
  assert.equal(host.s.crew.length, 1);
  const [phone] = guests;
  assert.equal(phone.$('stickZone').hidden, false);
  assert.equal(host.$('roomBtn').textContent, room + ' · 4/4');
  const day = host.s.day(); day.wait = 1000;
  const items = ['AAA', 'BBC'].map(area => host.s.world.items.find(it => it.loc.face.area === area && it.loc.z0 < 1.3 && it.loc.z0 > 0.2));
  const order = day.makeOrder('c', items.map(item => ({ item, qty: 2 })), null, true, { surname: 'Test' });
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
  const code = s.day().freeSpots()[0], sp = s.world.holding.spots.find(v => v.code === code);
  s.me.x = sp.x1 + 0.65; s.me.y = (sp.y0 + sp.y1) / 2; s.me.yaw = Math.PI / 2;
  s.me.pitch = Math.atan2((sp.z0 + sp.z1) / 2 - s.me.eye, 0.65); s.applyCam(); s.cam.updateMatrixWorld();
  await s.scanPut(...s.players[0].centre());
  assert.equal(order.status, 'done'); assert.equal(day.hold[code].num, order.no.slice(1));
  await until(() => guests.every(g => g.s.day().hold[code]?.num === day.hold[code].num), 'holding area to match');
  const second = day.start('c');
  await until(() => s.day().list().some(o => o.id === second.id), 'second pick');
  s.enter(); await until(() => second.by === s.players[0].id, 'second claim');
  picker.sockets.at(-1).terminate();
  await until(() => second.status === 'listed', 'disconnect to release the job');
  await until(() => picker.sockets.length === 2 && s.state() === 'home' && picker.$('onlineCover').hidden, 'phone to rejoin and reset scanner');
  // A guest occupies an existing till, identifies the kiosk customer, and pays through Fusion.
  const cashier = guests[2].s, till = cashier.tills[0];
  cashier.me.x = (till.x0 + till.x1) / 2; cashier.me.y = cashier.world.counter.y0 - 0.7;
  cashier.me.yaw = Math.PI; cashier.me.pitch = Math.atan2(1.15 - cashier.me.eye, (till.y0 + till.y1) / 2 - cashier.me.y);
  cashier.applyCam(); assert.equal(cashier.nearTill(), till);
  await cashier.openTill(); assert.equal(cashier.till.isOpen(), true);
  day.mode = 'kiosk';
  const customer = day.send('kiosk'); customer.pay = { how: 'cash', say: 'Cash, please.' };
  day.arrived(customer);
  await until(() => customer.by === 'p4', 'cashier to claim the customer');
  host.s.tick(6);
  await until(() => cashier.till.stage() === 'details', 'customer to walk to the guest till');
  const ui = cashier.till.debug, session = cashier.till.session();
  ui.F.no.value = session.cust.no; ui.search(); ui.select();
  assert.equal(session.stage, 'kiosk');
  ui.openKiosk(); ui.S.ksel = session.kiosk.mine; ui.kioskSelect();
  ui.goPay(); ui.payCash(); guests[2].w.document.querySelector('[data-act="change"]').click();
  await until(() => customer.order && cashier.till.stage() === 'done', 'host-confirmed cash payment');
  assert.equal(cashier.till.session().orderNo, customer.order.no);
  assert.equal(day.orders.filter(o => o.cust === customer).length, 1);
  cashier.closeTill();
  const previous = s.day(); host.s.newDay();
  await until(() => s.day() !== previous && s.day().total === host.s.day().total, 'new day');
  host.sockets.at(-1).terminate();
  await until(() => host.sockets.length === 2 && guests.every(g => g.$('onlineCover').hidden), 'original host to reconnect');
  assert.equal(host.s.crew.length, 1);
  host.sockets.at(-1).send(JSON.stringify({ type: 'leave' }));
  await until(() => guests.every(g => !g.$('onlineCover').hidden && /host left/.test(g.$('roomMessage').textContent)), 'room to end for everyone');
});
