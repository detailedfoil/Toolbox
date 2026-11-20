// Warehouse Shift: Sam, the coworker (tools/warehouse-shift/bot.js). Sam can reach every location without walking
// into anything, works from the shared pick list (day.js) at a person's pace (till customers, picks, c picks into the
// holding area, bags fetched from it), won't go down an aisle you're already in, walks round you, and pushes a
// trolley that stays inside the aisle. Each shift here is simulated with a pretend page (no 3D), on the game's clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, loadModule } from './load.mjs';

const W = loadModule('tools/warehouse-shift/world.js');
const Day = loadModule('tools/warehouse-shift/day.js');
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

// a pretend page with a day's work (day.js): customers take 9 s to walk in and 6 s to walk out, and 3 s to come over
// to Sam's till. Nobody else picks, so Sam does everything.
function shift(seed, opts = {}) {
  const rng = W.rng(seed);
  let T = 0, day = null;
  const timers = [], events = [];
  const later = (s, f) => timers.push({ t: T + s, f });
  const dayEnv = {
    customer: (c) => later(9, () => day.arrived(c)),
    step: (c) => { if (c.state === 'leaving') later(6, () => day.gone(c)); },
    closing: () => later(5, () => day.lock())
  };
  const arrived = new Map();
  dayEnv.customer = (c) => { arrived.set(c, T + 9); later(9, () => day.arrived(c)); };
  day = Day.create({ world, World: W, Till, requests, rand: rng, env: dayEnv, mode: opts.mode });
  const env = {
    board: () => ({ orders: day.listLate(), queue: [], prio: ['cust', 'hold', 'delivery'], delivery: day.deliveryLeft().length, greet: day.ungreeted().filter((c) => T - (arrived.get(c) || 0) > 10) }),
    paSources: () => world.goodsin.filter((g) => day.deliveryLeft(g.i).length).map((g) => g.i),
    paTake: (b, src) => day.paTake(src, 'Sam'), paPut: (b, d) => day.paPut(d, 'Sam'),
    greet: (b, c) => day.greet(c, 'Sam'),
    take: (b, o) => day.take(o, 'Sam'),
    serve: (b, c) => { if (!day.serve(c, 'Sam')) return false; later(3, () => { c.ready = true; }); return true; },
    picked: (b, o) => day.picked(o), holdFree: () => day.freeSpots(),
    reserve: (b, k) => day.reserve(k, 'Sam'), unreserve: (b, k) => day.unreserve(k, 'Sam'),
    putAway: (b, o, k) => { events.push({ put: k, free: !day.hold[k] }); return day.putAway(o, k, 'Sam'); },
    holdTake: (b, o) => { events.push({ take: o.hold.code, kept: day.busy[o.hold.code] === 'fetch:' + o.id }); day.fetch(o); return true; },
    tillDone: (b, c, lines) => day.tillDone(c, lines), handOver: (b, o) => day.handOver(o, 'Sam'),
    say(b, who, line) { events.push({ t: T, who, text: line.text }); }
  };
  const bot = B.create({ world, World: W, Till, requests, nav, env, rand: rng, till: ALEX_TILL, start: START });
  const you = { id: -1, x: 1.0, y: 0.9, r: YOU, moving: false };
  const out = { bot, day, events, closestWall: 9, closestYou: 9, intoYourAisle: 0, queued: 0, trolleyInShelf: 0 };
  const dt = 0.05;
  while (T < (opts.minutes || 30) * 60) {
    T += dt;
    for (let i = timers.length - 1; i >= 0; i--) if (timers[i].t <= T) { const f = timers[i].f; timers.splice(i, 1); f(); }
    day.tick(dt);
    if (day.over) { day = Day.create({ world, World: W, Till, requests, rand: rng, env: dayEnv, hold: day.hold }); out.days = (out.days || 0) + 1; }
    if (opts.you) opts.you(you, bot, T);
    bot.update(dt, [you]);
    out.closestWall = Math.min(out.closestWall, nav.clear(bot.x, bot.y));
    out.closestYou = Math.min(out.closestYou, Math.hypot(bot.x - you.x, bot.y - you.y));
    const ya = B.aisleAt(world, you.x, you.y);
    if (ya && B.aisleAt(world, bot.x, bot.y) === ya && you.inFirst) out.intoYourAisle++;
    if (bot.queue) out.queued++;
    // the trolley never pokes into the racking either side of the aisle it's in
    const a = B.aisleAt(world, bot.x, bot.y), t = bot.trolley;
    if (a) { const half = (Math.abs(Math.cos(t.phi)) * B.TROLLEY.len + Math.abs(Math.sin(t.phi)) * B.TROLLEY.wide) / 2; if (t.y - half < a.y0 - 0.005 || t.y + half > a.y1 + 0.005) out.trolleyInShelf++; }
  }
  out.done = bot.log.filter((l) => l.done);
  return out;
}
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;

test('Sam can reach every location, the holding area, the tote stack and their till, standing clear of everything', () => {
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

test('a shift on their own: Sam picks what is left on the list and puts c picks away at a person\'s pace, and never serves the till', () => {
  const s = shift(20261119, { minutes: 45, mode: 'pick' }); // Sam serves no till customers, so on their own it's click and collects
  const by = {};
  for (const d of s.done) (by[d.done] = by[d.done] || []).push(d.took);
  assert.ok(!by.till, 'Sam never serves a till customer (detailedfoil)');
  assert.ok(by.c && by.c.length >= 3, 'c: ' + (by.c || []).length);
  assert.ok((by.ck || []).length + (by.hold || []).length >= 2, 'click and collects: ' + JSON.stringify(Object.keys(by)));
  assert.ok(s.done.length >= 6 && s.done.length <= 90, s.done.length + ' jobs in 45 minutes');
  // as long as a person would take: a till conversation, a c pick into the holding area
  assert.ok(avg(by.c) > 20 && avg(by.c) < 200, 'a c pick ' + avg(by.c).toFixed(0) + ' s');
  assert.ok(Math.max(...by.c) - Math.min(...by.c) > 3, 'every timing varies');
  // the odd slip (about one thing in fifteen), never a disaster
  const slips = s.bot.stats.slips;
  assert.ok(slips >= 1 && slips < s.done.length * 2, slips + ' slips');
  assert.ok(s.closestWall >= B.BODY - 0.03, 'came within ' + s.closestWall.toFixed(3) + ' m of something');
  assert.equal(s.trolleyInShelf, 0, 'the trolley pokes into the racking');
  // c picks only ever go into empty OC spots
  assert.ok(s.events.filter((e) => e.put).every((e) => e.free));
});

test('the holding area: Sam fetches the bag on the line they took, kept for that customer', () => {
  let takes = [];
  for (const seed of [77, 78, 79]) takes = takes.concat(shift(seed, { minutes: 25 }).events.filter((e) => e.take));
  assert.ok(takes.length >= 2, takes.length + ' bags fetched');
  for (const t of takes) assert.ok(t.kept, t.take + ' was kept for the customer whose line Sam took');
});

test('one person to a pick aisle (detailedfoil): Sam waits by the end of an aisle you\'re in, and never touches you', () => {
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
    assert.equal(s.intoYourAisle, 0, 'seed ' + seed + ': Sam went into the aisle you were in');
    assert.ok(s.queued > 0, 'seed ' + seed + ': Sam waited for you');
    assert.ok(s.closestYou >= 2 * YOU, 'seed ' + seed + ': Sam came within ' + s.closestYou.toFixed(3) + ' m of you');
    assert.ok(s.done.length >= 3, 'seed ' + seed + ': ' + s.done.length + ' jobs done');
    assert.ok(s.events.some((e) => e.who === 'me' && /wait|after you/.test(e.text)), 'seed ' + seed + ': Sam says they\'ll wait');
  }
  // the rule itself: an aisle is the space between two rows of racking, not the centre aisle or the open floor
  const a = world.aisles[0];
  assert.equal(B.aisleAt(world, (a.x0 + a.x1) / 2, a.cy), a);
  assert.equal(B.aisleAt(world, (world.LX1 + world.RX0) / 2, a.cy), null, 'the centre aisle is open to everyone');
  assert.equal(B.aisleAt(world, world.W / 2, world.BACK / 2), null, 'so is the back walkway');
});

test('Sam walks round you: standing on their spot, in the centre aisle, or walking up and down it', () => {
  const mid = (world.LX1 + world.RX0) / 2;
  const cases = {
    post: (you, bot) => { you.x = bot.post.x; you.y = bot.post.y; },      // on Sam's spot at the till, all shift
    centre: (you) => { you.x = mid; you.y = 8; },                           // in the middle of the centre aisle
    pacing: (() => { let dir = 1; return (you, bot) => {                    // up and down it, stopping for Sam
      const ny = you.y + dir * 1.5 * 0.05;
      if (you.y < 2 || you.y > 17) { you.x = mid + 0.2; you.y = Math.max(2.5, Math.min(16.5, you.y)); }
      if (Math.hypot(mid + 0.2 - bot.x, ny - bot.y) >= 2 * YOU) { you.y = ny; you.x = mid + 0.2; you.moving = true; } else you.moving = false;
      if (you.y < 2.5) dir = 1; if (you.y > 16.5) dir = -1;
    }; })()
  };
  for (const [name, fn] of Object.entries(cases)) {
    const s = shift(8, { minutes: 15, you: fn });
    assert.ok(s.done.length >= 3, name + ': ' + s.done.length + ' jobs done');
    assert.ok(s.closestYou >= 2 * YOU - 0.005, name + ': came within ' + s.closestYou.toFixed(3) + ' m of you');
  }
});

test('the game: Sam is on the page, has their own till, and you can\'t walk through Sam or their trolley', () => {
  const html = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift.html'), 'utf8');
  assert.ok(html.indexOf('warehouse-shift/bot.js') > 0 && html.indexOf('warehouse-shift/bot.js') < html.indexOf('warehouse-shift/game.js'), 'bot.js loads before game.js');
  const game = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/game.js'), 'utf8');
  assert.match(game, /!blocked\(nx, me\.y\) && !crewStop\(me, nx, me\.y\)/, 'your walking checks Sam');
  assert.match(game, /const g = trolleyGap\(b, x, y\);\s*if \(g < BODY/, 'and their trolley');
  assert.match(game, /if \(t === ALEX_TILL\) continue;/, 'the till by the gap is Sam\'s');
  assert.ok(!/is down this aisle/.test(game), 'two people can share an aisle: Sam\'s trolley does the blocking (detailedfoil)');
  const scene = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/scene.js'), 'utf8');
  assert.match(scene, /function makeWorker/); assert.match(scene, /function makeTrolley/);
  assert.ok(!/\bSprite\b/.test(scene), 'Sam\'s name is on their badge, not floating over their head');
  // parked to pick, the trolley and Sam fill the aisle: nobody gets past
  const bot = B.create({ world, World: W, Till, requests, nav, env: {}, rand: W.rng(9), till: ALEX_TILL, start: START });
  const loc = world.locs.byCode['AAC-03-12-02'], st = bot.standFor(loc);
  bot.x = st.x; bot.y = st.y; bot.yaw = st.yaw; bot.walking = false;
  for (let i = 0; i < 60; i++) bot.moveTrolley(0.05);
  const a = loc.face.aisle, t = bot.trolley, across = Math.abs(Math.sin(t.phi)) * B.TROLLEY.len + Math.abs(Math.cos(t.phi)) * B.TROLLEY.wide;
  const ty0 = t.y - (Math.abs(Math.cos(t.phi)) * B.TROLLEY.len + Math.abs(Math.sin(t.phi)) * B.TROLLEY.wide) / 2, ty1 = t.y + (Math.abs(Math.cos(t.phi)) * B.TROLLEY.len + Math.abs(Math.sin(t.phi)) * B.TROLLEY.wide) / 2;
  const gaps = [ty0 - a.y0, a.y1 - ty1, Math.max(ty0, bot.y + B.BODY) - Math.min(ty1, bot.y - B.BODY)].map((g) => Math.max(0, g));
  void across;
  const lo = Math.min(bot.y - B.BODY, ty0) - a.y0, hi = a.y1 - Math.max(bot.y + B.BODY, ty1);
  assert.ok(Math.max(lo, hi) < 2 * YOU, 'room left beside them: ' + lo.toFixed(2) + ' and ' + hi.toFixed(2) + ' m (' + gaps.map((g) => g.toFixed(2)).join(', ') + ')');
  assert.ok(Math.abs(t.y - bot.y) > B.BODY + B.TROLLEY.wide / 2 - 0.02, 'and Sam isn\'t standing in it');
});
