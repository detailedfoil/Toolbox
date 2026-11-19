// Warehouse Shift: Alex, the coworker (tools/warehouse-shift/bot.js). Alex can reach every location without walking
// into anything, serves all four kinds of customer at a person's pace, keeps to detailedfoil's rule of one person to a
// pick aisle (whoever's in first has it), walks round you, and fetches the holding area bag kept for their customer.
// Each shift here is simulated with a pretend page (no 3D), on the same clock the game uses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, loadModule } from './load.mjs';

const W = loadModule('tools/warehouse-shift/world.js');
const Till = loadModule('tools/warehouse-shift/till.js');
const B = loadModule('tools/warehouse-shift/bot.js');
const read = (f) => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const world = W.build(read('tools/warehouse-shift/data/catalogue.json'));
const requests = read('tools/warehouse-shift/data/requests.json');
const nav = new B.Nav(world);
const tills = world.objects.filter((o) => o.kind === 'till' && o.x0 >= world.counter.x0 && o.x1 <= world.counter.x1);
const ALEX_TILL = tills[tills.length - 1];
const START = { x: 3.75, y: 17.78, yaw: Math.PI / 2 };   // outside the staff room door, as in game.js
const YOU = 0.22;

// a pretend page: customers take 9 s to walk in, the holding area keeps a bag for whoever's come for it
function shift(seed, opts = {}) {
  const rng = W.rng(seed);
  let T = 0;
  const timers = [], parcels = {}, reserved = new Set(), events = [];
  const later = (s, f) => timers.push({ t: T + s, f });
  world.holding.spots.forEach((sp) => { parcels[sp.code] = Till.holdParcel(rng, {}); });
  const env = {
    customer(b, c, delay, done) { later(delay + 9, done); },
    holdReserve() {
      const full = Object.keys(parcels).filter((k) => parcels[k] && !reserved.has(k));
      if (!full.length) return null;
      const code = full[Math.floor(rng() * full.length)];
      reserved.add(code);
      return { code, parcel: parcels[code] };
    },
    holdTake(b, code) { events.push({ take: code, reserved: reserved.has(code), wanted: b.cust && b.cust.hold && b.cust.hold.code }); parcels[code] = null; return true; },
    handOver(b, c) { if (c.hold) { const code = c.hold.code; later(4, () => { parcels[code] = Till.holdParcel(rng, {}); reserved.delete(code); }); } },
    say(b, who, line) { events.push({ t: T, who, text: line.text }); }
  };
  const bot = B.create({ world, World: W, Till, requests, nav, env, rand: rng, till: ALEX_TILL, start: START });
  const you = { id: 0, x: 1.0, y: 0.9, r: YOU, moving: false };
  const out = { bot, events, closestWall: 9, closestYou: 9, intoYourAisle: 0, queued: 0 };
  const dt = 0.05;
  while (T < (opts.minutes || 30) * 60) {
    T += dt;
    for (let i = timers.length - 1; i >= 0; i--) if (timers[i].t <= T) { const f = timers[i].f; timers.splice(i, 1); f(); }
    if (opts.you) opts.you(you, bot, T);
    bot.update(dt, [you]);
    out.closestWall = Math.min(out.closestWall, nav.clear(bot.x, bot.y));
    out.closestYou = Math.min(out.closestYou, Math.hypot(bot.x - you.x, bot.y - you.y));
    const ya = B.aisleAt(world, you.x, you.y);
    if (ya && B.aisleAt(world, bot.x, bot.y) === ya && you.inFirst) out.intoYourAisle++;
    if (bot.queue) out.queued++;
  }
  out.done = bot.log.filter((l) => l.done);
  return out;
}
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;

test('Alex can reach every location, the holding area, the tote stack and their till, standing clear of everything', () => {
  const bot = B.create({ world, World: W, Till, requests, nav, env: {}, rand: W.rng(1), till: ALEX_TILL, start: START });
  // everywhere a body fits that can be walked to from the till
  const nx = nav.nx, ny = nav.ny, seen = new Uint8Array(nx * ny), q = [];
  const cell = (x, y) => Math.floor(y / B.CELL) * nx + Math.floor(x / B.CELL);
  const s0 = cell(bot.post.x, bot.post.y);
  assert.ok(nav.clr[s0] >= B.BODY, 'the spot behind the till');
  seen[s0] = 1; q.push(s0);
  while (q.length) {
    const k = q.pop(), i = k % nx, j = (k - i) / nx;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b2 = j + dj, k2 = b2 * nx + a;
      if (a < 0 || b2 < 0 || a >= nx || b2 >= ny || seen[k2] || nav.clr[k2] < B.BODY) continue;
      seen[k2] = 1; q.push(k2);
    }
  }
  const ok = (p) => nav.clear(p.x, p.y) >= B.BODY - 0.02 && seen[cell(p.x, p.y)];
  const fine = (spot) => ok(spot) || (spot.alts || []).some(ok);
  let n = 0;
  for (const loc of world.locs.list) {
    const st = bot.standFor(loc);
    assert.ok(fine(st), 'somewhere to stand for ' + loc.code);
    assert.ok(Math.abs(st.y - loc.face.front) < 0.75, loc.code + ': close enough to reach');
    n++;
  }
  assert.equal(n, world.locs.list.length); assert.ok(n > world.items.length, n + ' locations');
  for (const sp of world.holding.spots) assert.ok(fine(bot.holdStand(sp.code).at), 'in front of ' + sp.code);
  assert.ok(fine(bot.toteSpot), 'the tote stack');
  assert.ok(ok(START), 'the staff room door');
  // and a real path along the way, never closer to a shelf than a body allows
  const r = W.rng(5);
  for (let i = 0; i < 40; i++) {
    const loc = world.locs.list[Math.floor(r() * world.locs.list.length)], st = bot.standFor(loc);
    const p = nav.find(bot.post.x, bot.post.y, st.x, st.y, null, B.BODY);
    assert.ok(p && p.length >= 2, 'a way to ' + loc.code);
    for (let k = 1; k < p.length; k++) {
      const a = p[k - 1], b2 = p[k], d = Math.hypot(b2.x - a.x, b2.y - a.y);
      for (let u = 0; u <= d; u += 0.05) assert.ok(nav.clear(a.x + (b2.x - a.x) * u / d, a.y + (b2.y - a.y) * u / d) >= B.BODY - 0.03, 'the way to ' + loc.code + ' cuts a corner');
    }
  }
});

test('a shift: Alex serves all four kinds of customer, a quarter each, at a person\'s pace, without walking into anything', () => {
  const s = shift(20261119, { minutes: 45 });
  const kinds = {};
  for (const d of s.done) (kinds[d.done] = kinds[d.done] || []).push(d.took);
  for (const k of ['pick', 'hold', 'till', 'kiosk']) assert.ok(kinds[k] && kinds[k].length >= 3, k + ': ' + (kinds[k] || []).length + ' served');
  assert.ok(s.done.length >= 20 && s.done.length <= 60, s.done.length + ' customers in 45 minutes');
  // as long as a person would take (customer at the counter to hand over)
  assert.ok(avg(kinds.pick) > 25 && avg(kinds.pick) < 90, 'single item click and collect ' + avg(kinds.pick).toFixed(0) + ' s');
  assert.ok(avg(kinds.hold) > 20 && avg(kinds.hold) < 80, 'holding area ' + avg(kinds.hold).toFixed(0) + ' s');
  assert.ok(avg(kinds.till) > 60 && avg(kinds.till) < 300, 'till order ' + avg(kinds.till).toFixed(0) + ' s');
  assert.ok(avg(kinds.kiosk) > 40 && avg(kinds.kiosk) < 220, 'kiosk order ' + avg(kinds.kiosk).toFixed(0) + ' s');
  // every timing varies
  assert.ok(Math.max(...kinds.pick) - Math.min(...kinds.pick) > 5, 'picks vary');
  // the odd slip (about one thing in fifteen), never a disaster
  const slips = s.bot.stats.slips;
  assert.ok(slips >= 1 && slips < s.done.length, slips + ' slips');
  assert.ok(s.closestWall >= B.BODY - 0.03, 'came within ' + s.closestWall.toFixed(3) + ' m of something');
  // never three of the same kind in a row
  const order = s.done.map((d) => d.done);
  for (let i = 2; i < order.length; i++) assert.ok(!(order[i] === order[i - 1] && order[i] === order[i - 2]), 'three ' + order[i] + ' in a row');
  // the customers talk: postcode then surname at the till, an OC location and surname at the holding area
  const said = s.events.filter((e) => e.who === 'cust').map((e) => e.text).join('\n');
  assert.match(said, /Postcode's LU[89] \d[A-Z]{2}\.\nSurname's /);
  assert.match(said, /OC-0\d\d/);
});

test('the holding area: Alex fetches the bag kept for their customer, never anyone else\'s', () => {
  const s = shift(77, { minutes: 30 });
  const takes = s.events.filter((e) => e.take);
  assert.ok(takes.length >= 3, takes.length + ' bags fetched');
  for (const t of takes) { assert.ok(t.reserved, t.take + ' was kept for them'); assert.equal(t.take, t.wanted); }
});

test('one person to a pick aisle (detailedfoil): Alex waits by the end of an aisle you\'re in, and never touches you', () => {
  for (const seed of [3, 8, 21]) {
    let mode = 'idle', since = 0, aisle = null;
    const s = shift(seed, {
      minutes: 20,
      you(you, bot, T) {
        const g = bot.walking && bot.goal ? B.aisleAt(world, bot.goal.x, bot.goal.y) : null;
        if (mode === 'idle' && g && !B.aisleAt(world, bot.x, bot.y) && Math.hypot(bot.x - g.mouth, bot.y - g.cy) > 4) {
          mode = 'in'; since = T; aisle = g; // you're in there first
          you.x = g.side === 'R' ? g.x0 + 2.5 : g.x1 - 2.5; you.y = g.cy; you.moving = false; you.inFirst = true;
        } else if (mode === 'in' && T - since > 14) { // out to the centre aisle, off to one side
          mode = 'out'; since = T; you.inFirst = false;
          you.x = (world.LX1 + world.RX0) / 2 + (aisle.side === 'R' ? -0.6 : 0.6); you.y = aisle.cy + 3;
        } else if (mode === 'out' && T - since > 40) { mode = 'idle'; you.x = 1.0; you.y = 0.9; }
      }
    });
    assert.equal(s.intoYourAisle, 0, 'seed ' + seed + ': Alex went into the aisle you were in');
    assert.ok(s.queued > 0, 'seed ' + seed + ': Alex waited for you');
    assert.ok(s.closestYou >= 2 * YOU, 'seed ' + seed + ': Alex came within ' + s.closestYou.toFixed(3) + ' m of you');
    assert.ok(s.done.length >= 8, 'seed ' + seed + ': ' + s.done.length + ' customers served');
    assert.ok(s.events.some((e) => e.who === 'me' && /wait|after you/.test(e.text)), 'seed ' + seed + ': Alex says they\'ll wait');
  }
  // the rule itself: an aisle is the space between two rows of racking, not the centre aisle or the open floor
  const a = world.aisles[0];
  assert.equal(B.aisleAt(world, (a.x0 + a.x1) / 2, a.cy), a);
  assert.equal(B.aisleAt(world, (world.LX1 + world.RX0) / 2, a.cy), null, 'the centre aisle is open to everyone');
  assert.equal(B.aisleAt(world, world.W / 2, world.BACK / 2), null, 'so is the back walkway');
});

test('Alex walks round you: standing on their spot, in the centre aisle, or walking up and down it', () => {
  const mid = (world.LX1 + world.RX0) / 2;
  const cases = {
    post: (you, bot) => { you.x = bot.post.x; you.y = bot.post.y; },      // on Alex's spot at the till, all shift
    centre: (you) => { you.x = mid; you.y = 8; },                           // in the middle of the centre aisle
    pacing: (() => { let dir = 1; return (you, bot) => {                    // up and down it, stopping for Alex
      const ny = you.y + dir * 1.5 * 0.05;
      if (you.y < 2 || you.y > 17) { you.x = mid + 0.2; you.y = Math.max(2.5, Math.min(16.5, you.y)); }
      if (Math.hypot(mid + 0.2 - bot.x, ny - bot.y) >= 2 * YOU) { you.y = ny; you.x = mid + 0.2; you.moving = true; } else you.moving = false;
      if (you.y < 2.5) dir = 1; if (you.y > 16.5) dir = -1;
    }; })()
  };
  for (const [name, fn] of Object.entries(cases)) {
    const s = shift(8, { minutes: 15, you: fn });
    assert.ok(s.done.length >= 7, name + ': ' + s.done.length + ' customers served');
    assert.ok(s.closestYou >= 2 * YOU - 0.005, name + ': came within ' + s.closestYou.toFixed(3) + ' m of you');
  }
});

test('the game: Alex is on the page, has their own till, and you can\'t walk into an aisle Alex is in', () => {
  const html = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift.html'), 'utf8');
  assert.ok(html.indexOf('warehouse-shift/bot.js') > 0 && html.indexOf('warehouse-shift/bot.js') < html.indexOf('warehouse-shift/game.js'), 'bot.js loads before game.js');
  const game = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/game.js'), 'utf8');
  assert.match(game, /!blocked\(nx, me\.y\) && !crewStop\(nx, me\.y\)/, 'your walking checks Alex');
  assert.match(game, /is down this aisle: wait for them to come out/);
  assert.match(game, /crew\.some\(\(b\) => b\.atTill === t\)/, 'the till Alex is using isn\'t yours');
  assert.match(game, /parcels\[sp\.code\] && !reserved\.has\(sp\.code\)/, 'your customers aren\'t sent for a bag kept for Alex\'s');
  const scene = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/scene.js'), 'utf8');
  assert.match(scene, /function makeWorker/);
  assert.ok(!/\bSprite\b/.test(scene), 'Alex\'s name is on their badge, not floating over their head');
});
