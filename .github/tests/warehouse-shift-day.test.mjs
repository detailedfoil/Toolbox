// Warehouse Shift: the day's work (tools/warehouse-shift/day.js). One pick list shared by everyone (detailedfoil, 19
// Nov 2026): orders are A and four numbers, locations:items, then CK (customer waiting), c (for the holding area) or
// nothing (bought at the till). A day is 20 picks, the first 2 to 4 of them c; at most 5 on the list and 3 customers
// in at once; whoever starts an order has it, with no backing out; Alex takes customer picks first, then the next
// customer at the till, then c picks. Each day here is simulated with Alex and a pretend you (no 3D).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, loadModule } from './load.mjs';

const W = loadModule('tools/warehouse-shift/world.js');
const Till = loadModule('tools/warehouse-shift/till.js');
const B = loadModule('tools/warehouse-shift/bot.js');
const Day = loadModule('tools/warehouse-shift/day.js');
const read = (f) => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const world = W.build(read('tools/warehouse-shift/data/catalogue.json'));
const requests = read('tools/warehouse-shift/data/requests.json');
const nav = new B.Nav(world);
const tills = world.objects.filter((o) => o.kind === 'till' && o.x0 >= world.counter.x0 && o.x1 <= world.counter.x1).sort((a, b) => a.x0 - b.x0);
const LABEL = /^A\d{4} \d+:\d+( CK| c)?$/;

// a whole day: customers take 9 s to walk in and 6 s to walk out; you take an order now and then and spend 30 to 60 s
// on it, and serve a till customer now and then (a minute at the till)
function runDay(seed, opts = {}) {
  const rng = W.rng(seed);
  let T = 0, day = null;
  const timers = [], later = (s, f) => timers.push({ t: T + s, f });
  const ev = { listed: [], changed: 0 };
  const env = {
    listed: (o) => ev.listed.push({ t: T, label: day.label(o), kind: o.kind, cust: o.cust, here: o.cust ? o.cust.state : null }),
    changed: () => { ev.changed++; },
    customer: (c) => later(9, () => day.arrived(c)),
    step: (c) => { if (c.state === 'leaving') later(6, () => day.gone(c)); },
    over: () => { ev.over = T; }
  };
  day = Day.create({ world, World: W, Till, requests, rand: rng, env, mode: opts.mode });
  const choices = [];
  const crewEnv = {
    board: () => ({ orders: day.list(), queue: day.queue() }),
    take: (b, o) => day.take(o, 'Alex'),
    serve: (b, c) => { if (!day.serve(c, 'Alex')) return false; later(3, () => { c.ready = true; }); return true; },
    picked: (b, o) => day.picked(o), holdFree: () => day.freeSpots(),
    reserve: (b, k) => day.reserve(k, 'Alex'), unreserve: (b, k) => day.unreserve(k, 'Alex'),
    putAway: (b, o, k) => day.putAway(o, k, 'Alex'), holdTake: (b, o) => { day.fetch(o); return true; },
    tillDone: (b, c, lines) => day.tillDone(c, lines), handOver: (b, o) => day.handOver(o, 'Alex')
  };
  const bot = B.create({ world, World: W, Till, requests, nav, env: crewEnv, rand: rng, till: tills[tills.length - 1], start: { x: 3.75, y: 17.78, yaw: Math.PI / 2 } });
  // what Alex chose, and what was on offer at the time
  const choose = bot.choose.bind(bot);
  bot.choose = function () {
    const j = choose();
    if (j) choices.push({ job: j.serve ? 'serve' : j.pick.kind === 'c' ? 'c' : 'cust', custOn: day.list().some((o) => o.kind !== 'c'), queue: day.queue().length > 0 });
    return j;
  };
  const you = { busy: null, until: 0, serving: null };
  const out = { day, bot, ev, choices, maxList: 0, maxIn: 0, at3: 0, samples: 0, putFull: 0 };
  const dt = 0.05;
  while (T < (opts.minutes || 60) * 60 && !day.over) {
    T += dt;
    for (let i = timers.length - 1; i >= 0; i--) if (timers[i].t <= T) { const f = timers[i].f; timers.splice(i, 1); f(); }
    day.tick(dt);
    bot.update(dt, [{ id: -1, x: 1, y: 0.9, r: 0.22 }]);
    if (opts.you !== false) {
      if (you.serving) { if (T > you.until) { const c = you.serving; you.serving = null; day.tillDone(c, (c.kind === 'kiosk' ? c.kiosk.list[c.kiosk.mine].lines : c.lines).map((l) => ({ item: l.item, qty: l.qty }))); } }
      else if (!you.busy) {
        const q = day.queue()[0], o = day.list()[0];
        if (q && rng() < 0.004 && day.serve(q, 'p1')) { q.ready = true; you.serving = q; you.until = T + 60; }
        else if (o && rng() < 0.01 && day.take(o, 'p1')) { you.busy = o; you.until = T + 30 + 30 * rng(); }
      } else if (T > you.until) {
        const o = you.busy;
        assert.equal(day.take(o, 'p1'), false); // no starting it over: it's still yours
        if (o.kind === 'hold') { day.fetch(o); day.handOver(o, 'p1'); you.busy = null; }
        else if (o.kind === 'c' && !o.cust) {
          if (o.status === 'taken') day.picked(o);
          const full = Object.keys(day.hold).find((k) => day.hold[k]);
          if (full && day.putAway(o, full, 'p1') !== null) out.putFull++; // a full spot never takes it
          const k = day.freeSpots()[0];
          if (k) { day.putAway(o, k, 'p1'); you.busy = null; } else you.until = T + 5;
        } else { if (o.status === 'taken') day.picked(o); day.handOver(o, 'p1'); you.busy = null; }
      }
    }
    const L = day.list().length, P = day.present().length;
    out.maxList = Math.max(out.maxList, L); out.maxIn = Math.max(out.maxIn, P);
    out.samples++; if (P >= 3) out.at3++;
  }
  out.T = T;
  return out;
}

const days = [11, 23, 37].map((s) => runDay(s));
const alone = runDay(5, { you: false });

test('a day is 20 picks, the first 2 to 4 of them c picks waiting at the start; it ends when they\'re done and nobody\'s waiting', () => {
  for (const d of days.concat([alone])) {
    const day = d.day;
    assert.ok(day.over, 'the day ended (after ' + (d.T / 60).toFixed(1) + ' min)');
    assert.equal(day.done, 20);
    assert.equal(day.orders.filter((o) => o.counts).length, 20, '20 picks');
    assert.ok(day.first >= 2 && day.first <= 4);
    const first = d.ev.listed.slice(0, day.first);
    assert.ok(first.every((e) => e.kind === 'c' && e.t < 6), 'the first ' + day.first + ' are c picks, there from the start: ' + first.map((e) => e.label + '@' + e.t.toFixed(1)).join(' '));
    assert.ok(day.orders.every((o) => o.status === 'done'), 'every order finished');
    assert.equal(day.present().length, 0, 'nobody left waiting');
    assert.ok(d.T > 6 * 60 && d.T < 50 * 60, 'about a shift: ' + (d.T / 60).toFixed(1) + ' min');
  }
});

test('the list stays steady: never more than 5 on it, never more than 3 customers in, and seldom 3 for long', () => {
  for (const d of days.concat([alone])) {
    assert.ok(d.maxList <= 5, d.maxList + ' on the list');
    assert.ok(d.maxIn <= 3, d.maxIn + ' customers in');
    assert.ok(d.at3 / d.samples < 0.5, Math.round(100 * d.at3 / d.samples) + '% of the day with 3 in');
  }
});

test('order numbers, A and four numbers: then locations and items, then CK, c or nothing', () => {
  for (const d of days) {
    const day = d.day, nos = new Map();
    for (const o of day.orders) {
      assert.match(day.label(o), LABEL);
      // locations:items: how many different locations, and how many items altogether
      if (o.kind === 'hold') assert.equal(day.label(o).split(' ')[1], '1:1');
      else {
        assert.equal(o.locs, new Set(o.lines.map((l) => l.loc.code)).size);
        assert.equal(o.units, o.lines.reduce((t, l) => t + l.qty, 0));
        assert.ok(o.lines.every((l, i) => !i || o.lines[i - 1].loc.order <= l.loc.order), 'in walking order');
      }
      // the same number twice only for an online order and the collection of its bag
      if (nos.has(o.no)) assert.ok(nos.get(o.no).kind !== 'hold' && o.kind === 'hold', o.no + ' twice'); else nos.set(o.no, o);
    }
    for (const e of d.ev.listed) {
      if (e.kind === 'c') assert.ok(!e.cust && / c$/.test(e.label), 'c: nobody here (' + e.label + ')');
      if (e.kind === 'ck' || e.kind === 'hold') assert.ok(e.cust && e.here === 'waiting' && / CK$/.test(e.label), 'CK: the customer is here (' + e.label + ')');
      if (e.kind === 'till') assert.ok(e.cust && /^A\d{4} \d+:\d+$/.test(e.label), 'till: no letter (' + e.label + ')');
    }
  }
  // 1 silicone and 2 boxes of screws: 2:3 (detailedfoil's example)
  const day = Day.create({ world, World: W, Till, requests, rand: W.rng(1), env: {} });
  const sil = world.items.find((it) => /silicone/i.test(it.name)), scr = world.items.find((it) => /screws/i.test(it.name));
  const o = day.makeOrder('c', [{ item: sil, qty: 1 }, { item: scr, qty: 2 }], null, true);
  assert.equal(day.label(o).slice(6), '2:3 c');
});

test('whoever starts an order has it: off the list, nobody else can take it, and it gets finished', () => {
  const day = Day.create({ world, World: W, Till, requests, rand: W.rng(2), env: {} });
  const o = day.makeOrder('c', W.order(world, W.rng(3)), null, true);
  assert.ok(day.list().includes(o));
  assert.equal(day.take(o, 'p1'), true);
  assert.ok(!day.list().includes(o), 'off the list');
  assert.equal(day.take(o, 'Alex'), false, 'Alex can\'t have it');
  assert.equal(day.take(o, 'p1'), false, 'and taking it again doesn\'t start it over');
  for (const d of days) assert.ok(d.day.orders.every((x) => x.status === 'done' && x.by), 'every order started was finished by whoever started it');
  const game = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/game.js'), 'utf8');
  assert.match(game, /say\('Finish task', 'err'/, 'Back on the scanner says Finish task');
});

test('Alex: picks a customer is waiting for, then the next customer at the till, then c picks', () => {
  let n = 0;
  for (const d of days.concat([alone])) {
    for (const c of d.choices) {
      if (c.custOn) assert.equal(c.job, 'cust', 'a customer pick was on the list');
      else if (c.queue) assert.equal(c.job, 'serve', 'someone was waiting at the till');
      else assert.equal(c.job, 'c');
      n++;
    }
  }
  assert.ok(n > 40, n + ' choices');
  const jobs = alone.bot.jobs;
  assert.ok(jobs.includes('serve') && jobs.includes('c') && (jobs.includes('ck') || jobs.includes('till')), 'Alex does all of it: ' + jobs.join(' '));
  // as long as a person takes
  const took = alone.bot.log.filter((l) => l.done === 'c' || l.done === 'ck' || l.done === 'till');
  assert.ok(took.every((l) => l.took > 15 && l.took < 300), took.map((l) => l.done + ' ' + l.took.toFixed(0)).join(', '));
});

test('the holding area: c picks go into empty OC spots only, customers collect them, and an early customer turns a c into a CK', () => {
  for (const d of days) assert.equal(d.putFull, 0, 'a full OC spot never takes another order');
  const all = days.concat([alone]);
  const put = all.flatMap((d) => d.day.orders.filter((o) => o.kind === 'c' && o.code));
  assert.ok(put.length >= 6, put.length + ' put away');
  const fetched = all.flatMap((d) => d.day.orders.filter((o) => o.kind === 'hold'));
  assert.ok(fetched.length >= 3, fetched.length + ' bags collected');
  for (const o of fetched) assert.equal(o.counts, false, 'collecting a bag isn\'t one of the day\'s picks');
  // a customer for an online order still on the list: it turns into a CK
  const day = Day.create({ world, World: W, Till, requests, rand: W.rng(4), env: {} });
  const c = day.makeOrder('c', W.order(world, W.rng(5)), null, true, { surname: 'Testman' });
  const who = day.send('owner', { own: c, surname: 'Testman' });
  day.arrived(who);
  assert.equal(c.kind, 'ck'); assert.equal(c.cust, who); assert.match(day.label(c), / CK$/);
  assert.equal(day.orders.length, 1, 'the same order, not a new one');
  // and one whose bag is already in the holding area: a line to fetch it, with the bag's number
  const c2 = day.makeOrder('c', W.order(world, W.rng(6)), null, true, { surname: 'Bagsworth' });
  day.take(c2, 'p1'); day.picked(c2);
  const code = day.freeSpots()[0];
  const p = day.putAway(c2, code, 'p1');
  assert.ok(p && day.hold[code] === p && p.surname === 'Bagsworth' && 'A' + p.num === c2.no);
  assert.equal(day.putAway(c2, code, 'p1'), null, 'the spot is full now');
  const who2 = day.send('owner', { own: c2, surname: 'Bagsworth', code });
  day.arrived(who2);
  const f = who2.order;
  assert.equal(f.kind, 'hold'); assert.equal(f.no, c2.no); assert.equal(day.label(f), c2.no + ' 1:1 CK'); assert.equal(f.hold.code, code);
  day.take(f, 'p1'); day.fetch(f);
  assert.equal(day.hold[code], null, 'the bag\'s gone from its spot');
});

test('the page: day.js loads first, the till customer answers when you copy a code, and right is never "that\'s it"', () => {
  const html = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift.html'), 'utf8');
  const at = (f) => html.indexOf('warehouse-shift/' + f);
  assert.ok(at('day.js?v=') > 0 && at('day.js') < at('bot.js') && at('bot.js') < at('game.js'), 'day.js, bot.js, then game.js');
  assert.match(html, /id="dayCover"/); assert.match(html, /All picks clear/);
  const ui = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/tillui.js'), 'utf8');
  assert.match(ui, /function copyCode[\s\S]{0,400}showCustomer\(code\)/, 'copying a code shows it to the customer');
  const bot = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/bot.js'), 'utf8');
  const right = (src, re) => { const m = re.exec(src); assert.ok(m, 'found the right-product lines'); return m[1]; };
  for (const lines of [right(ui, /const RIGHT = \[([^\]]+)\]/), right(bot, /right: \[([^\]]+)\]/), right(bot, /mine: \[([^\]]+)\]/)]) {
    assert.ok(!/that's it/i.test(lines), 'a right product never "that\'s it" (detailedfoil): ' + lines);
  }
  const game = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/game.js'), 'utf8');
  assert.match(game, /all scanned, Enter moves on to the next location/, 'Enter after the last item at a location');
});

test('controllers: a controller belongs to one player, does everything on the scanner, and works the till', () => {
  const game = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/game.js'), 'utf8');
  assert.match(game, /function claimPads/);
  assert.match(game, /players\.some\(\(p\) => p\.padIndex === gp\.index\)/, 'a controller already someone\'s is left alone');
  assert.match(game, /const prev = padPrev, hit = \(i\) => now\[i\] && !prev\[i\];/, 'a press is a button that wasn\'t down last time');
  for (const [what, re] of [['RT scans', /if \(hit\(7\)\) \{ initAudio\(\); const c = centreNdc\(\); scanAt/], ['A is Enter (detailedfoil)', /if \(hit\(0\)\) \{ SFX\.key\(\); enter\(\); \}/],
    ['B is Back', /if \(hit\(1\)\) back\(\);/], ['X squats', /if \(hit\(2\)\) toggleSquat\(\);/], ['Y is Hint', /if \(hit\(3\)\) useHint\(\);/], ['Start: the menu', /if \(hit\(9\)\) \{ SFX\.key\(\); menu\(true\); \}/]]) assert.match(game, re, what);
  const ui = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/tillui.js'), 'utf8');
  assert.match(ui, /function pad\(act\)/);
  assert.match(ui, /const osk = \(\) => \(touch && S\.osk\) \|\| S\.pad;/, 'with a controller the on-screen keyboard comes up');
  const css = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/till.css'), 'utf8');
  assert.match(css, /\.tl \.pad-on\{/, 'the highlight shows');
});
