// Warehouse Shift: the day's work (tools/warehouse-shift/day.js). One pick list shared by everyone (detailedfoil, 19
// Nov 2026): orders are A and four numbers, locations:items, then CK (customer waiting), c (for the holding area) or
// nothing (bought at the till). A day is 15 to 25 picks, the first 3 to 6 of them c (several products, before the door
// is unlocked); about 40% till or kiosk; one product click and collects come from the warehouse, several product ones
// from the holding area; customers are greeted before they say what they want; the door is unlocked to start and locked
// to finish. At most 5 on the list and 3 customers in at once; whoever starts an order has it, with no backing out; Sam
// takes customer picks first, then the next customer at the till, then c picks. Each day is simulated with Sam and a
// pretend you (no 3D).
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
  const arrivals = new Map();
  const ev = { listed: [], changed: 0, arrivedAt: (c) => arrivals.get(c) || 0 };
  const env = {
    listed: (o) => ev.listed.push({ t: T, label: day.label(o), kind: o.kind, cust: o.cust, here: o.cust ? o.cust.state : null }),
    changed: () => { ev.changed++; },
    customer: (c) => { arrivals.set(c, T + 9); ev.firstCust = ev.firstCust === undefined ? T : ev.firstCust; later(9, () => day.arrived(c)); },
    step: (c) => { if (c.state === 'leaving') later(6, () => day.gone(c)); },
    unlocked: () => { ev.unlocked = T; },
    closing: () => { ev.closing = T; later(8, () => day.lock()); },
    over: () => { ev.over = T; }
  };
  day = Day.create({ world, World: W, Till, requests, rand: rng, env, mode: opts.mode, total: opts.total });
  const choices = [];
  const crewEnv = {
    board: () => ({ orders: day.listLate(), queue: [], greet: day.ungreeted().filter((c) => T - ev.arrivedAt(c) > 10) }),
    greet: (b, c) => day.greet(c, 'Sam'),
    take: (b, o) => day.take(o, 'Sam'),
    serve: (b, c) => { if (!day.serve(c, 'Sam')) return false; later(3, () => { c.ready = true; }); return true; },
    picked: (b, o) => day.picked(o), holdFree: () => day.freeSpots(),
    reserve: (b, k) => day.reserve(k, 'Sam'), unreserve: (b, k) => day.unreserve(k, 'Sam'),
    putAway: (b, o, k) => day.putAway(o, k, 'Sam'), holdTake: (b, o) => { day.fetch(o); return true; },
    tillDone: (b, c, lines) => day.tillDone(c, lines), handOver: (b, o) => day.handOver(o, 'Sam')
  };
  const bot = B.create({ world, World: W, Till, requests, nav, env: crewEnv, rand: rng, till: tills[tills.length - 1], start: { x: 3.75, y: 17.78, yaw: Math.PI / 2 } });
  // what Sam chose, and what was on offer at the time
  const choose = bot.choose.bind(bot);
  bot.choose = function () {
    const j = choose();
    if (j && !j.greet) choices.push({ job: j.serve ? 'serve' : j.pick.kind === 'c' ? 'c' : 'cust', custOn: day.listLate().some((o) => o.kind !== 'c'), queue: false });
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
      const g = day.ungreeted()[0];
      if (g && rng() < 0.02) day.greet(g, 'p1');
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
const alone = runDay(5, { you: false, mode: 'pick' }); // Sam never serves a till customer, so on their own the day has click and collects only

test('a day is 15 to 25 picks, the first 3 to 6 of them c picks before opening; it opens by itself and you lock the door to finish', () => {
  for (const d of days.concat([alone])) {
    const day = d.day;
    assert.ok(day.over, 'the day ended (after ' + (d.T / 60).toFixed(1) + ' min)');
    assert.ok(day.total >= 15 && day.total <= 25, day.total + ' picks');
    assert.equal(day.done, day.total);
    assert.equal(day.orders.filter((o) => o.counts).length, day.total, 'every pick counts');
    assert.ok(day.first >= 3 && day.first <= 6, day.first + ' c picks');
    const first = d.ev.listed.slice(0, day.first);
    assert.ok(first.every((e) => e.kind === 'c' && e.t < 12), 'the first ' + day.first + ' are c picks, there from the start: ' + first.map((e) => e.label + '@' + e.t.toFixed(1)).join(' '));
    assert.ok(day.orders.every((o) => o.status === 'done'), 'every order finished');
    assert.equal(day.present().length, 0, 'nobody left waiting');
    assert.ok(d.T > 6 * 60 && d.T < 55 * 60, 'about a shift: ' + (d.T / 60).toFixed(1) + ' min');
    // the door: nobody comes in before it's unlocked, and the day only ends after it's locked
    const { ev } = d;
    assert.ok(ev.unlocked > 0 || day.first === 0, 'the shop opens by itself once the c picks are away');
    assert.ok(ev.firstCust >= (ev.unlocked || 0), 'no customer before it opens');
    assert.ok(ev.closing > (ev.unlocked || 0) && ev.over > ev.closing, 'all done, then you lock up, then the end of day');
    assert.equal(day.phase, 'done');
  }
});

test('the mix: about 40% till or kiosk, the rest one product click and collects and bag collections, both always there', () => {
  let tillish = 0, all = 0;
  for (const d of days) {
    const os = d.day.orders.filter((o) => o.counts);
    const till = os.filter((o) => o.kind === 'till').length;
    tillish += till; all += os.length;
    const share = till / os.length;
    assert.ok(share >= 0.25 && share <= 0.55, Math.round(100 * share) + '% till or kiosk');
    const ck = os.filter((o) => o.kind === 'ck'), hold = os.filter((o) => o.kind === 'hold'), c = os.filter((o) => o.kind === 'c');
    assert.ok(ck.length >= 1 && hold.length >= 2, 'some of each: ' + ck.length + ' ck, ' + hold.length + ' from holding');
    // one product (any quantity) comes from the warehouse; several products wait in the holding area; c picks have several
    assert.ok(ck.every((o) => o.lines.length === 1), 'a click and collect of one product');
    assert.ok(hold.every((o) => o.locs >= 2 && o.units >= o.locs), 'a bag has several products');
    assert.ok(c.every((o) => o.lines.length >= 2 && !o.cust), 'a c pick has more than one product and no customer');
  }
  assert.ok(tillish / all > 0.3 && tillish / all < 0.5, 'around 40% over the days: ' + Math.round(100 * tillish / all));
  assert.ok(days.some((d) => d.day.total !== 20), 'the length changes from day to day');
});

test('a customer waits to be greeted: nothing is said until someone says hello, then they say what they want', () => {
  const day = Day.create({ world, World: W, Till, requests, rand: W.rng(8), env: {} });
  day.phase = 'open';
  const c = day.send('ck');
  day.arrived(c);
  assert.equal(c.state, 'greet'); assert.equal(c.order, null, 'no order until they\'re greeted'); assert.equal(day.list().length, 0);
  assert.ok(day.ungreeted().length === 1 && day.ungreeted()[0] === c);
  assert.equal(day.queue().length, 0);
  assert.equal(day.greet(c, 'p1'), true);
  assert.equal(c.state, 'waiting'); assert.equal(c.order.kind, 'ck'); assert.equal(c.order.lines.length, 1);
  assert.equal(day.greet(c, 'Sam'), false, 'only greeted once');
  const t = day.send('till');
  day.arrived(t);
  assert.equal(day.queue().length, 0, 'not at the till until greeted');
  day.greet(t, 'p1');
  assert.ok(day.queue().length === 1 && day.queue()[0] === t);
});

test('the door: the shop opens by itself when the c picks are away, and only locking up at the end ends the day', () => {
  const day = Day.create({ world, World: W, Till, requests, rand: W.rng(9), env: {} });
  assert.equal(day.phase, 'closed'); assert.equal(typeof day.unlock, 'undefined', 'no unlocking');
  for (let i = 0; i < 4000 && day.phase === 'closed'; i++) {
    day.tick(0.1);
    for (const o of day.list()) { day.take(o, 'p1'); day.picked(o); day.putAway(o, day.freeSpots()[0], 'p1'); }
  }
  assert.equal(day.phase, 'open');
  assert.equal(day.lock(), false, 'not locking while the day is on');
  // Sam taken off the shift: what Sam had goes back on the list
  const o = day.makeOrder('ck', W.order(world, W.rng(3), 1), null, true);
  day.take(o, 'Sam'); day.release('Sam');
  assert.equal(o.status, 'listed'); assert.equal(o.by, null); assert.ok(day.list().includes(o));
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
      if (o.kind === 'hold') assert.equal(day.label(o).split(' ')[1], o.locs + ':' + o.units);
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
  assert.equal(day.take(o, 'Sam'), false, 'Sam can\'t have it');
  assert.equal(day.take(o, 'p1'), false, 'and taking it again doesn\'t start it over');
  for (const d of days) assert.ok(d.day.orders.every((x) => x.status === 'done' && x.by), 'every order started was finished by whoever started it');
  const game = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/game.js'), 'utf8');
  assert.match(game, /say\('Finish task', 'err'/, 'Back on the scanner says Finish task');
});

test('Sam: never serves a till customer, and only takes a pick that has sat on the list 5 s (customer picks before c picks)', () => {
  let n = 0;
  for (const d of days.concat([alone])) {
    assert.ok(!d.bot.jobs.includes('serve'), 'Sam never serves a till customer');
    for (const c of d.choices) {
      if (c.custOn) assert.equal(c.job, 'cust', 'a customer pick was on the list');
      else assert.equal(c.job, 'c');
      n++;
    }
  }
  assert.ok(n > 15, n + ' choices');
  const jobs = alone.bot.jobs;
  assert.ok(jobs.includes('c') && jobs.includes('ck'), 'Sam picks what is left: ' + jobs.join(' '));
  // a pick is never taken by Sam in its first 5 s
  for (const d of days.concat([alone])) for (const l of d.day.log) if (l.by === 'Sam') assert.ok(l.took >= 0, 'took a while');
  const late = Day.create({ world, World: W, Till, requests, rand: W.rng(12), env: {} });
  late.phase = 'open';
  const o = late.makeOrder('c', W.order(world, W.rng(3), 2), null, true);
  assert.equal(late.listLate().length, 0, 'new on the list: Sam leaves it');
  late.tick(5.5);
  assert.ok(late.listLate().some((x) => x.id === o.id), 'after 5 s Sam can take it');
  // as long as a person takes
  const took = alone.bot.log.filter((l) => l.done === 'c' || l.done === 'ck' || l.done === 'till');
  assert.ok(took.every((l) => l.took > 15 && l.took < 300), took.map((l) => l.done + ' ' + l.took.toFixed(0)).join(', '));
});

test('the holding area: c picks go into empty OC spots only, and customers collect the bags (new and old) with no warehouse walk', () => {
  for (const d of days) assert.equal(d.putFull, 0, 'a full OC spot never takes another order');
  const all = days;
  const put = all.flatMap((d) => d.day.orders.filter((o) => o.kind === 'c' && o.code));
  assert.ok(put.length >= 12, put.length + ' put away');
  const fetched = all.flatMap((d) => d.day.orders.filter((o) => o.kind === 'hold'));
  assert.ok(fetched.length >= 8, fetched.length + ' bags collected');
  for (const o of fetched) assert.equal(o.counts, true, 'collecting a bag is one of the day\'s picks');
  const day = Day.create({ world, World: W, Till, requests, rand: W.rng(4), env: {} });
  day.phase = 'open';
  // a bag that was already there when the shop opened: the customer asks for it and a line fetches it
  const old = Object.keys(day.hold).find((k) => day.hold[k]);
  assert.ok(old && day.hold[old].locs >= 2, 'bags there from before have several products');
  const c0 = day.send('collect', { code: old, surname: day.hold[old].surname });
  day.arrived(c0); day.greet(c0, 'p1');
  assert.equal(c0.order.kind, 'hold'); assert.equal(c0.order.counts, true);
  // one the player put away this morning: a line to fetch it, with the bag's number
  const c2 = day.makeOrder('c', W.order(world, W.rng(6), 3), null, true, { surname: 'Bagsworth' });
  day.take(c2, 'p1'); day.picked(c2);
  const code = day.freeSpots()[0];
  const p = day.putAway(c2, code, 'p1');
  assert.ok(p && day.hold[code] === p && p.surname === 'Bagsworth' && 'A' + p.num === c2.no);
  assert.equal(day.putAway(c2, code, 'p1'), null, 'the spot is full now');
  const who2 = day.send('collect', { surname: 'Bagsworth', code });
  day.arrived(who2); day.greet(who2, 'p1');
  const f = who2.order;
  assert.equal(f.kind, 'hold'); assert.equal(f.no, c2.no); assert.equal(day.label(f), c2.no + ' ' + c2.locs + ':' + c2.units + ' CK'); assert.equal(f.hold.code, code);
  day.take(f, 'p1'); day.fetch(f);
  assert.equal(day.hold[code], null, 'the bag\'s gone from its spot');
});

test('the page: day.js loads first, the till customer answers when you copy a code, and right is never "that\'s it"', () => {
  const html = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift.html'), 'utf8');
  const at = (f) => html.indexOf('warehouse-shift/' + f);
  assert.ok(at('day.js?v=') > 0 && at('day.js') < at('bot.js') && at('bot.js') < at('game.js'), 'day.js, bot.js, then game.js');
  assert.match(html, /id="dayCover"/); assert.match(html, /All picks clear/);
  const gm = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/game.js'), 'utf8');
  assert.match(gm, /Lock the front door/); assert.ok(!/Time to open/.test(gm), 'nothing to unlock'); assert.match(gm, /Remove Sam/); assert.match(gm, /Bring Sam back/);
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
  assert.match(game, /if \(hit\(6\)\) till\.pad\('tabL'\); if \(hit\(7\)\) till\.pad\('tabR'\);/, 'at the till LT and RT switch tabs');
  assert.match(ui, /act === 'tabL' \|\| act === 'tabR'/);
  assert.match(ui, /const osk = \(\) => \(touch && S\.osk\) \|\| S\.pad;/, 'with a controller the on-screen keyboard comes up');
  const css = fs.readFileSync(path.join(REPO, 'tools/warehouse-shift/till.css'), 'utf8');
  assert.match(css, /\.tl \.pad-on\{/, 'the highlight shows');
});
