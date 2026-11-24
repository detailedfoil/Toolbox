/* Warehouse Shift: the day's work (detailedfoil, 19 Nov 2026). Shared by the page (game.js, which also passes it on
   to Sam in bot.js) and the tests. No drawing here: game.js walks the customers about and draws the holding area.

   One pick list on everyone's scanner. Each order on it is A and four numbers, then how many locations and how many
   items (1 silicone and 2 boxes of screws is 2:3), then what it's for:
     CK      a click and collect customer is at the counter now, waiting for it
     c       an online click and collect with nobody here yet: pick it, then put it away in any empty OC spot in the
             holding area, where its customer collects it later
     (none)  bought at the till: the customer is waiting by the counter
   Whoever starts an order has it: it comes off the list, and there's no backing out. A till customer pays, then
   stands to one side while anyone picks their order, and the next customer can be served meanwhile. A click and
   collect customer whose order is still a c turns it into a CK (if someone is picking it, they bring it to the counter
   instead of the holding area); one whose order is already in the holding area gets it fetched from there (a CK line
   too, A and the number on its despatch note, but not one of the day's picks).

   A day is 15 to 25 picks and starts with the shop open. Holding-area picks (c) arrive throughout the day.
   Digital First sets the share of customers coming to order or pay at a till. The rest are split between
   click and collect customers with one product (picked from the warehouse) and customers who collect a bag already in the holding area (several products;
   no warehouse walk, bags may have been there since before opening). A customer who walks up is greeted first (an
   input from you or Sam), then tells you what they're here for. When all 20 are done and nobody is waiting, the door
   is locked, and only then does the end of day screen come. The list stays steady: at most 5 at once, now and then
   empty for a few seconds. At most 3 customers in at once, and seldom 3 for long.

   create(opts): opts.world, World (world.js), Till (till.js), requests (data/requests.json), rand, total, mode, and
   env, told what happens: listed(order), changed(order), customer(c) (walk them in, then call arrived(c) at the
   counter), step(c) (they've somewhere new to stand), holdSet(code, parcel), over(). tick(dt) once a frame. */
(function (root) {
  'use strict';

  var TOTAL = 20;          // picks in a day, about (15 to 25 when not told)
  var MAX_LIST = 5;        // on the pick list at once
  var MAX_IN = 3;          // customers in at once
  var MID_C = [4, 7];      // c picks that come in during the day (there are none before opening: detailedfoil, 20 Nov 2026)
  var DIGITAL_FIRST = [
    { collection: 20, cost: 0 },
    { collection: 35, cost: 100 },
    { collection: 50, cost: 200 },
    { collection: 65, cost: 350 },
    { collection: 80, cost: 500 }
  ];
  var KIOSK_SHARE = 1 / 3; // of the customers who still need to pay
  // which kinds of pick come after the opening c picks (the scanner's Function menu can narrow it, for practice)
  var MODES = { mixed: ['ck', 'collect', 'till', 'kiosk'], pick: ['ck'], hold: ['collect'], till: ['till'], kiosk: ['kiosk'] };
  var EVENTS = {
    sale: { title: 'Big sale today', message: 'Expect more customers throughout the shift.' },
    failedDelivery: { title: 'Delivery cancelled', message: 'Serve customers and hand over their orders to advance the clock.' },
    website: { title: 'Website down', message: 'Click & collect only. Expect fewer customers today.' },
    fusion: { title: 'Fusion down', message: 'Click & collect only. The tills are closed today.' },
    lightDuties: { title: 'Sam is on light duties', message: 'Sam can serve on tills and fetch orders from the holding area.' }
  };
  var EVENT_IDS = Object.keys(EVENTS);
  function rollEvent(rand) {
    var roll = rand();
    return roll < 0.25 ? EVENT_IDS[Math.floor(roll / 0.25 * EVENT_IDS.length)] : null;
  }
  var CC = ['Click and collect for {n}, please.', "Hiya, I've got a click and collect. Name's {n}.", 'Got an order to collect, under {n}.',
    "I've come for my click and collect. It's under {n}."];
  var HELLO = {
    till: ['Morning! Can I order a few bits?', "Hiya, I'd like to order some stuff.", 'Alright? Need to order a couple of things.', "Hello, I'd like to place an order.", 'Can I order some bits, please?'],
    kiosk: ['Morning! Can you sort my order out?', 'Hiya, I need to pay for an order.', 'Alright? Got an order to pay for.', 'Hello, can you put my order through?']
  };

  function Day(o) {
    var self = this;
    this.world = o.world; this.World = o.World; this.Till = o.Till; this.requests = o.requests || null;
    this.r = o.rand || Math.random; this.env = o.env || {};
    this.firstDay = !!o.firstDay;
    this.total = o.total || (15 + Math.floor(this.r() * 11)); // 15 to 25 picks (detailedfoil: it needn't be exactly 20)
    this.mode = MODES[o.mode] ? o.mode : 'mixed';
    this.event = this.mode === 'mixed' && EVENT_IDS.indexOf(o.event) >= 0 ? o.event : null;
    var digital = DIGITAL_FIRST[o.digitalTier - 1] || DIGITAL_FIRST[0];
    this.tillShare = (100 - digital.collection) / 100;
    this.walkinTill = o.walkinTill === undefined ? this.tillShare : o.walkinTill;
    this.canTill = !!(this.requests && this.requests.need && this.requests.need.length);
    this.t = 0; this.nextId = 1; this.used = {};
    this.orders = []; this.customers = []; this.owners = []; this.log = [];
    this.phase = 'closed';                 // closed (c picks, before opening), open, lock (everything's done: waiting for you to lock the front door), done
    this.shiftId = o.shiftId || null;
    this.floorRandom = this.World.rng(this.World.hash((this.shiftId || '') + '/floor sales'));
    this.floorTarget = 2 + Math.floor(this.floorRandom() * 3);
    this.floorAllocated = 0;
    this.xpActions = new Set();
    this.contributors = new Set();
    this.baseXP = 0;
    this.coveredXP = 0;
    this.offlineScanners = new Set();
    const mixupRandom = this.World.rng(this.World.hash((this.shiftId || '') + '/scanner mix-ups'));
    const nextMixupGap = () => 1 + Math.floor(mixupRandom() * (this.firstDay ? 2 : 3));
    this.scannerMixups = {
      count: 0, nextGap: nextMixupGap,
      unlabelled: { limit: 2 + Math.floor(mixupRandom() * 3), until: nextMixupGap() },
      labelled: { limit: Math.floor(mixupRandom() * 2), until: nextMixupGap() }
    };
    this.faultSchedule = [];
    const faults = 6 - (o.scannerTier || 1);
    const faultRandom = this.World.rng(this.World.hash(this.shiftId || 'scanner dock'));
    const intervalScale = (this.firstDay ? 0.6 : 1) * 5 / faults;
    for (let i = 0; i < faults; i++) this.faultSchedule.push((20 + faultRandom() * 30) * intervalScale);
    this.done = 0; this.released = 0; this.over = false;
    // the holding area: what's in each OC spot, and who's on their way to it (fetching it, or filling it)
    this.hold = {}; this.busy = {};
    var spots = this.world.holding ? this.world.holding.spots : [];
    spots.forEach(function (sp) { self.hold[sp.code] = null; self.busy[sp.code] = null; });
    if (o.hold) { for (var k in o.hold) if (o.hold[k] && k in this.hold) { this.hold[k] = o.hold[k]; this.used[o.hold[k].num] = 1; } }
    else spots.forEach(function (sp) { if (self.r() < 0.45) { var q = self.parcel(self.surname(), null); q.locs = 2 + Math.floor(self.r() * 3); q.units = q.locs + Math.floor(self.r() * 4); self.hold[sp.code] = q; } });
    // the plan: what each of the day's picks will be (3 to 6 c picks first, as many as the holding area has room for)
    var free = 0; for (var hk in this.hold) if (!this.hold[hk]) free++;
    this.first = 0;                        // no morning c picks: the shop just opens (detailedfoil, 20 Nov 2026)
    this.plan = [];
    for (var i = 0; i < this.total; i++) this.plan.push(i < this.first ? 'c' : null);
    this.fillPlan(true);
    this.makeDelivery(this.event === 'failedDelivery' ? 0 : o.delivery);
    this.wait = 1.0;                       // seconds to the next pick
    if (this.first === 0) { this.phase = 'open'; this.wait = 3 + 3 * this.r(); }
  }
  Day.prototype.emit = function (name, a, b) { var f = this.env[name]; if (typeof f === 'function') return f.call(this.env, a, b); return undefined; };
  Day.prototype.pick = function (list) { return list[Math.floor(this.r() * list.length)]; };
  Day.prototype.tillsOpen = function () { return this.event !== 'website' && this.event !== 'fusion'; };
  Day.prototype.samCanPick = function (o) { return this.event !== 'lightDuties' || o.kind === 'hold'; };
  Day.prototype.clockMinute = function () {
    var progress;
    if (this.event === 'failedDelivery') {
      progress = this.done / this.total;
    } else {
      var delivery = this.delivery;
      progress = delivery.length ? delivery.reduce(function (done, d) { return done + Number(d.done); }, 0) / delivery.length : 1;
    }
    return 7 * 60 + Math.floor(Math.min(1, progress) * 13 * 60);
  };

  Day.prototype.checkScannerFault = function (dt) {
    if (this.phase !== 'open' || !this.faultSchedule.length) return;
    const holders = (this.emit('scannerHolders') || []).filter(who => !this.offlineScanners.has(who));
    const working = holders.filter(who =>
      this.orders.some(order => order.by === who && (order.status === 'taken' || order.status === 'picked')) ||
      this.delivery.some(carton => carton.by === who && !carton.done));
    if (!working.length) return;
    // Count shift time with a scanner job underway. Idle, missing and failed scanners pause the countdown.
    this.faultSchedule[0] -= dt;
    if (this.faultSchedule[0] > 0) return;
    this.faultSchedule.shift();
    const who = this.pick(working);
    this.offlineScanners.add(who);
    this.emit('scannerFault', who);
    this.emit('playtest', 'scanner.crash', { who });
  };
  Day.prototype.atScannerDock = function (pos) {
    const dock = this.world.scannerDock, desk = this.world.pc.desk;
    return pos.x >= desk.x0 - 0.08 && pos.x <= desk.x1 + 0.08 && pos.y <= desk.y0 &&
      Math.hypot(pos.x - dock.x, pos.y - dock.y) <= 1.45;
  };
  Day.prototype.swapScanner = function (who, pos) {
    const swapped = this.atScannerDock(pos) && this.offlineScanners.delete(who);
    if (swapped) this.emit('playtest', 'scanner.swap', { who });
    return swapped;
  };

  /* ---------- the plan ---------- */
  function shuffle(a, r) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  // Keep background holding-area picks separate from the customer mix.
  Day.prototype.fillPlan = function (initial) {
    var from = Math.max(this.first, this.released), n = this.plan.length - from, rest, i;
    if (initial && this.mode === 'mixed') {
      var nc = Math.max(0, Math.min(n - 4, MID_C[0] + Math.floor(this.r() * (MID_C[1] - MID_C[0] + 1))));
      n -= nc;
      var nt = Math.max(0, Math.round(this.tillShare * n));
      var kiosks = Math.max(Number(nt >= 2), Math.round(nt * KIOSK_SHARE));
      var collections = n - nt, bags = Math.floor(collections / 2);
      rest = [];
      for (i = 0; i < nc; i++) rest.push('c');
      for (i = 0; i < nt; i++) rest.push(i < kiosks ? 'kiosk' : 'till');
      for (i = 0; i < collections; i++) rest.push(i < bags ? 'collect' : 'ck');
      if (this.event) rest = this.eventPlan(rest, nc);
      shuffle(rest, this.r);
    } else {
      var kinds = MODES[this.mode];
      rest = [];
      for (i = 0; i < n; i++) rest.push(this.mode === 'mixed' ? this.walkInKind() : this.pick(kinds));
    }
    if (initial && this.firstDay) {
      // Round the two workloads independently so a third of the day's customers still come in.
      var holding = rest.filter(function (k) { return k === 'c'; }).length;
      var holdingLeft = Math.round(holding / 3), customersLeft = Math.round((rest.length - holding) / 3);
      rest = rest.filter(function (k) { return k === 'c' ? holdingLeft-- > 0 : customersLeft-- > 0; });
      this.total = this.plan.length = rest.length;
    }
    // never three the same in a row
    var prev = this.plan.slice(0, from);
    for (i = 0; i < rest.length; i++) {
      var a = i >= 2 ? rest[i - 1] : prev[prev.length - 1], b = i >= 2 ? rest[i - 2] : prev[prev.length - 2];
      if (a === rest[i] && b === rest[i]) { for (var j = i + 1; j < rest.length; j++) if (rest[j] !== rest[i]) { var t = rest[i]; rest[i] = rest[j]; rest[j] = t; break; } }
    }
    for (i = 0; i < rest.length; i++) this.plan[from + i] = (rest[i] === 'till' && !this.canTill) ? 'kiosk' : rest[i];
  };
  Day.prototype.walkInKind = function () {
    if (this.r() < this.tillShare) return this.r() < KIOSK_SHARE ? 'kiosk' : 'till';
    return this.r() < 0.5 ? 'collect' : 'ck';
  };
  Day.prototype.eventPlan = function (plan, holdingPicks) {
    var customers = plan.slice(holdingPicks);
    if (this.event === 'failedDelivery') {
      plan = customers;
    } else if (this.event === 'sale') {
      var extra = Math.ceil(this.total * 0.4);
      for (var i = 0; i < extra; i++) plan.push(this.walkInKind());
    } else if (!this.tillsOpen()) {
      // Existing click & collect orders can still be picked and collected during either outage.
      var size = this.event === 'website' ? Math.ceil(customers.length * 0.7) : customers.length;
      plan = plan.slice(0, holdingPicks);
      for (var j = 0; j < size; j++) plan.push(j % 2 ? 'ck' : 'collect');
    }
    this.total = plan.length;
    this.plan.length = this.total;
    return plan;
  };
  Day.prototype.setMode = function (m) { if (this.event || !MODES[m]) return; this.mode = m; this.fillPlan(false); };

  /* ---------- the delivery: cartons on the roll cages and pallets at goods in, each to go to its own location ---------- */
  // detailedfoil, 20 Nov 2026: when there are no orders, put the delivery away (Putaway on the scanner). The day
  // can't be locked up until it's all away.
  var DELIVERY = [11, 16];  // cartons a day
  Day.prototype.makeDelivery = function (n) {
    var self = this, gi = this.world.goodsin || [];
    this.delivery = [];
    if (!gi.length || n === 0) return;
    if (!n) n = DELIVERY[0] + Math.floor(this.r() * (DELIVERY[1] - DELIVERY[0] + 1));
    if (this.firstDay) n = Math.round(n / 3);
    var slots = [];
    gi.forEach(function (g) { g.slots.forEach(function (sl, k) { slots.push({ src: g.i, slot: k }); }); });
    // fill from the bottom up, spread over the cages and pallets
    slots.sort(function (a, b) { return (gi[a.src].slots[a.slot].z0 - gi[b.src].slots[b.slot].z0) || (self.r() - 0.5); });
    // the delivery is products that are out of stock: ones a pick emptied earlier, topped up with a few more taken off
    // their shelves now. Each carton goes into an EMPTY place (its own old one, or another empty one in the same row).
    var World = this.World, world = this.world, taken = {}, items = (world.out || []).filter(function (it) { return it.old; }).slice(0, Math.min(n, slots.length)), guard = 0;
    while (items.length < Math.min(n, slots.length) && guard++ < 3000) {
      var it = world.items[Math.floor(this.r() * world.items.length)];
      if (!it.loc || items.indexOf(it) >= 0 || (it.reserved || 0) > 0) continue;
      World.vacate(world, it); this.emit('stock', it); items.push(it);
    }
    items.forEach(function (it, i) {
      var to = World.emptyFor(world, it, taken, self.r) || it.old;
      taken[to.code] = 1;
      var q = 2 + Math.floor(self.r() * 5) * (it.size === 'T' ? 2 : 1);
      self.delivery.push({ id: i + 1, item: it, loc: to, qty: q, src: slots[i].src, slot: slots[i].slot, by: null, done: false });
    });
  };
  // cartons nobody has taken yet (from one cage or pallet, or anywhere)
  Day.prototype.deliveryLeft = function (src) { return this.delivery.filter(function (d) { return !d.by && !d.done && (src === undefined || src === null || d.src === src); }); };
  // take the top carton off a cage or pallet: it's yours to put away
  Day.prototype.paTake = function (src, who) {
    if (who === 'Sam' && this.event === 'lightDuties') return null;
    var left = this.deliveryLeft(src);
    if (!left.length) return null;
    var gi = this.world.goodsin, top = left.reduce(function (a, b) { return gi[b.src].slots[b.slot].z0 > gi[a.src].slots[a.slot].z0 ? b : a; });
    top.by = who; top.takenAt = this.t;
    this.emit('playtest', 'carton.start', { who, carton: top.id, units: top.qty });
    this.emit('delivery', top);
    return top;
  };
  Day.prototype.paPut = function (d, who) {
    if (!d || d.done || d.by !== who) return false;
    d.done = true; d.doneBy = who; d.finishedAt = this.t;
    this.emit('playtest', 'carton.finish', { who, carton: d.id });
    this.credit(who, 'carton-' + d.id, 10);
    this.World.place(this.world, d.item, d.loc, d.qty); this.emit('stock', d.item);
    this.log.push({ t: this.t, kind: 'putaway', by: who, took: this.t - d.takenAt });
    this.emit('delivery', d);
    this.check();
    return true;
  };

  /* ---------- numbers and names ---------- */
  // A and four numbers, never the same twice in a day
  Day.prototype.number = function () {
    var n, guard = 0;
    do { n = String(1000 + Math.floor(this.r() * 9000)); } while (this.used[n] && guard++ < 500);
    this.used[n] = 1;
    return 'A' + n;
  };
  // a surname nobody in the holding area (or on its way there) has: every surname there is different (detailedfoil)
  Day.prototype.surname = function () {
    var taken = {}, k;
    for (k in this.hold) if (this.hold[k]) taken[this.hold[k].surname] = 1;
    this.orders.forEach(function (o) { if (o.kind === 'c' && o.status !== 'done') taken[o.surname] = 1; });
    return this.Till.holdParcel(this.r, taken).surname;
  };
  // a bagged order for the holding area: the despatch note shows its number and the surname, big
  Day.prototype.parcel = function (surname, no) {
    var p = this.Till.holdParcel(this.r, {});
    p.surname = surname;
    if (no) p.num = no.slice(1); else { p.num = this.number().slice(1); }
    return p;
  };

  /* ---------- the list ---------- */
  Day.prototype.list = function () {
    return this.orders.filter(function (o) { return o.status === 'listed' && o.kind !== 'replen'; })
      .sort(function (a, b) { return Number(a.kind === 'c') - Number(b.kind === 'c'); });
  };
  Day.prototype.label = function (o) { return o.no + ' ' + o.locs + ':' + o.units + (o.kind === 'c' ? ' c' : o.kind === 'till' ? '' : ' CK'); };
  // what's coming onto the list: what's on it, customers walking in who'll put a line on it, till customers not paid yet
  Day.prototype.projected = function () {
    var n = this.list().length;
    this.customers.forEach(function (c) {
      if (c.order) return;
      if (c.kind === 'till' || c.kind === 'kiosk') { if (c.state === 'coming' || c.state === 'greet' || c.state === 'counter' || c.state === 'serving') n++; }
      else if (c.state === 'coming' || c.state === 'greet') n++;
    });
    return n;
  };
  Day.prototype.present = function () { return this.customers.filter(function (c) { return c.state !== 'gone' && c.state !== 'leaving'; }); };
  // till customers at the counter that nobody is serving yet
  Day.prototype.queue = function () { return this.customers.filter(function (c) { return c.state === 'counter' && !c.by; }); };
  // picks nobody has started for a while: Sam only takes a pick after it has sat on the list for 15 s, and never serves
  // a till customer, so what you serve and pick is yours (detailedfoil, 19 Nov 2026)
  var LATE_PICK = 4;  // 4 s (detailedfoil, 21 Nov 2026; it was 5)
  Day.prototype.listLate = function () { var t = this.t; return this.list().filter(function (o) { return t - o.t > LATE_PICK; }); };
  // picks on the list that Sam will take once they've sat 4 s: he waits at his till for them and does nothing else
  Day.prototype.listEarly = function () { var t = this.t; return this.list().filter(function (o) { return t - o.t <= LATE_PICK; }); };
  // customers at the counter nobody has said hello to yet, the one waiting longest first
  Day.prototype.ungreeted = function () { return this.customers.filter(function (c) { return c.state === 'greet'; }); };
  Day.prototype.makeOrder = function (kind, lines, cust, counts, extra) {
    var World = this.World;
    lines = (lines || []).filter(function (l) { return l.item && l.item.loc && World.room(l.item) >= 1; }).map(function (l) {
      var q = Math.min(l.qty, World.room(l.item)); l.item.reserved = (l.item.reserved || 0) + q;
      return { item: l.item, loc: l.item.loc, qty: q };
    });
    var batch = kind === 'replen' && this.orders.find(o => o.kind === kind && o.status === 'listed');
    if (batch) lines = batch.lines.concat(lines);
    lines.sort(function (a, b) { return a.loc.order - b.loc.order; });
    var locs = {}, units = 0;
    lines.forEach(function (l) { locs[l.loc.code] = 1; units += l.qty; });
    if (batch) {
      Object.assign(batch, { lines, locs: Object.keys(locs).length, units });
      this.emit('listed', batch);
      return batch;
    }
    var o = { id: this.nextId++, no: (extra && extra.no) || this.number(), kind: kind, lines: lines, locs: Object.keys(locs).length, units: units,
      status: 'listed', by: null, cust: cust || null, counts: counts !== false, t: this.t, surname: cust ? cust.surname : null, code: null, hold: null };
    if (extra) for (var k in extra) if (k !== 'no') o[k] = extra[k];
    this.orders.push(o);
    this.emit('playtest', 'pick.listed', { order: o.id, kind: o.kind, customer: cust?.id });
    this.emit('listed', o);
    return o;
  };

  /* ---------- picking ---------- */
  // whoever starts an order has it, and there's no backing out
  Day.prototype.take = function (o, who) {
    if (this.over || !o || o.status !== 'listed' || (who === 'Sam' && !this.samCanPick(o))) return false;
    o.status = 'taken'; o.by = who; o.takenAt = this.t;
    this.emit('playtest', 'pick.start', { who, order: o.id, kind: o.kind, lines: o.lines.length, units: o.units });
    this.emit('changed', o);
    if (this.phase === 'closed') this.check(); // Sam on the last morning pick: customers can start coming in
    return true;
  };
  // the picked units come off the shelf; a pick of everything that was there leaves the place empty
  Day.prototype.picked = function (o) {
    var self = this;
    if (o.status === 'taken') {
      o.status = 'picked';
      this.emit('playtest', 'pick.collected', { who: o.by, order: o.id });
      (o.lines || []).forEach(function (l) {
        var it = l.item;
        it.stock = (it.stock === undefined ? self.World.stockOf(it) : it.stock) - l.qty; it.reserved = Math.max(0, (it.reserved || 0) - l.qty);
        if (it.stock <= 0 && it.loc) { self.World.vacate(self.world, it); self.emit('stock', it); }
      });
    }
    this.emit('changed', o);
  };
  // the bag out of its OC spot, for a customer at the counter
  Day.prototype.fetch = function (o) {
    var code = o.hold && o.hold.code;
    if (!code) return null;
    var p = this.hold[code];
    this.hold[code] = null; this.busy[code] = null;
    this.emit('holdSet', code, null);
    o.status = 'picked';
    this.emit('changed', o);
    this.emit('playtest', 'pick.collected', { who: o.by, order: o.id });
    return p;
  };
  // empty OC spots nobody is on their way to fill
  Day.prototype.freeSpots = function () {
    var out = [];
    for (var k in this.hold) if (!this.hold[k] && !this.busy[k]) out.push(k);
    return out;
  };
  Day.prototype.reserve = function (code, who) { if (this.hold[code] || this.busy[code]) return false; this.busy[code] = 'put:' + who; return true; };
  Day.prototype.unreserve = function (code, who) { if (this.busy[code] === 'put:' + who) this.busy[code] = null; };
  // a picked c order into an empty OC spot: it waits there for its customer
  Day.prototype.putAway = function (o, code, who) {
    if (o.status === 'done' || !(code in this.hold) || this.hold[code] || (this.busy[code] && this.busy[code] !== 'put:' + who)) return null;
    var p = this.parcel(o.surname, o.no);
    p.order = o; p.locs = o.locs; p.units = o.units;
    this.hold[code] = p; this.busy[code] = null;
    o.code = code; o.status = 'done'; o.doneBy = who;
    this.emit('holdSet', code, p);
    this.emit('changed', o);
    this.finish(o);
    return p;
  };
  // the tote (or bag) over the counter: the customer takes it and goes
  Day.prototype.handOver = function (o, who) {
    if (o.status === 'done') return false;
    o.status = 'done'; o.doneBy = who;
    var c = o.cust;
    if (c) { c.handedAt = this.t; c.state = 'leaving'; this.emit('step', c); }
    this.emit('changed', o);
    this.finish(o);
    return true;
  };
  Day.prototype.finish = function (o) {
    o.finishedAt = this.t;
    this.emit('playtest', 'pick.finish', { who: o.doneBy, order: o.id, kind: o.kind, customer: o.cust?.id });
    this.credit(o.doneBy, 'finished-' + o.id, 10);
    if (o.counts) this.done++;
    this.log.push({ t: this.t, no: o.no, kind: o.kind, by: o.doneBy, took: this.t - (o.takenAt || o.t) });
    this.check();
  };

  /* ---------- the till ---------- */
  Day.prototype.scannerMixup = function (c, who, labelled) {
    if (c.scannerChecked || c.by !== who || c.state !== 'serving' || !c.ready) return false;
    c.scannerChecked = true;
    const mixups = this.scannerMixups;
    const target = labelled ? mixups.labelled : mixups.unlabelled;
    // The same shift total applies even when players share the tills or buy a name label mid-shift.
    if (mixups.count >= target.limit || --target.until > 0) return false;
    mixups.count++;
    target.until = mixups.nextGap();
    return true;
  };
  // Add a shop-floor purchase to the first till sale, then spread any remaining units across the shift.
  Day.prototype.offerFloorItem = function (c) {
    if (c.floorOffer || this.floorAllocated >= this.floorTarget) return;
    var kiosk = c.kind === 'kiosk' && c.kiosk.list[c.kiosk.mine];
    var lines = kiosk ? kiosk.lines : c.lines;
    if (!lines || !lines.length) return;
    var remaining = this.floorTarget - this.floorAllocated;
    var futureTills = this.plan.slice(this.released).filter(k => k === 'till' || k === 'kiosk').length;
    if (this.floorAllocated && futureTills && this.released / this.plan.length < this.floorAllocated / this.floorTarget) return;
    var qty = futureTills ? 1 : remaining;
    var used = new Set(lines.flatMap(l => l.accept || [l.item.code]));
    var start = Math.floor(this.floorRandom() * this.world.items.length);
    for (var i = 0; i < this.world.items.length; i++) {
      var item = this.world.items[(start + i) % this.world.items.length];
      if (!item.loc || item.size === 'B' || used.has(item.code) || this.World.room(item) < qty) continue;
      var intro = ["I picked this up off the shop-floor shelf.", "I've brought this over from the shop floor.", "Got this one off the shelf out front."];
      var say = intro[Math.floor(this.floorRandom() * intro.length)];
      var line = { floor: true, kind: 'code', item, qty, accept: [item.code], say, clue: say, qtySay: qty > 1 ? qty + ' of these, please.' : '' };
      var shortage = lines.findIndex(l => l.shortage);
      lines.splice(shortage < 0 ? lines.length : shortage, 0, line);
      if (kiosk) kiosk.total += this.Till.price(item) * qty;
      item.reserved = (item.reserved || 0) + qty;
      this.floorAllocated += qty;
      c.floorOffer = line;
      break;
    }
  };
  Day.prototype.atReplenShelf = function (pose) {
    var s = this.world.replenShelf;
    return Math.hypot(Math.max(s.x0 - pose.x, 0, pose.x - s.x1), Math.max(s.y0 - pose.y, 0, pose.y - s.y1)) <= 1.35;
  };
  Day.prototype.restock = function (o, who, pose) {
    if (this.over || !o || o.kind !== 'replen' || o.by !== who || o.status !== 'picked' || !this.atReplenShelf(pose)) return false;
    o.status = 'done'; o.doneBy = who;
    this.credit(who, 'replen-' + o.id, 10 * o.units);
    this.emit('changed', o);
    return true;
  };
  Day.prototype.serve = function (c, who) {
    if (!this.tillsOpen() || !c || c.state !== 'counter' || c.by) return false;
    if (this.customers.some(function (other) { return other.state === 'serving' && other.by === who; })) return false;
    this.offerFloorItem(c);
    c.state = 'serving'; c.by = who; c.greeter = who; c.ready = false;
    this.emit('playtest', 'sale.start', { who, customer: c.id, kind: c.kind });
    this.emit('step', c);
    return true;
  };
  // they'd been called over but nobody had started on them: back to waiting for whoever's free
  Day.prototype.unserve = function (c) {
    if (!c || c.state !== 'serving') return;
    this.emit('playtest', 'sale.requeue', { who: c.by, customer: c.id });
    c.state = 'counter'; c.by = null; c.ready = false;
    this.emit('step', c);
  };
  // paid for: the order goes on the list and the customer stands to one side
  Day.prototype.tillDone = function (c, lines, extra) {
    if (c.order) return c.order;
    this.emit('playtest', 'sale.paid', { who: c.by, customer: c.id, kind: c.kind });
    this.credit(c.by, 'sale-' + c.id, 15);
    var pickLines = lines.filter(function (line) { return !line.tcnd && !line.shortage && line.item !== c.floorOffer?.item; });
    var o = this.makeOrder('till', pickLines, c, true, extra);
    if (c.floorOffer) {
      var floor = c.floorOffer;
      floor.item.reserved -= floor.qty;
      this.makeOrder('replen', [floor], null, false);
    }
    this.emit('salePaid', c, c.by);
    c.order = o; c.state = 'waiting'; c.by = null; c.ready = false;
    this.emit('step', c);
    return o;
  };
  // a customer going without what they came for: their pick comes later instead
  Day.prototype.giveUp = function (c) {
    if (c.state === 'gone' || c.state === 'leaving') return;
    if (c.floorOffer && !c.order) {
      c.floorOffer.item.reserved -= c.floorOffer.qty;
      this.floorAllocated -= c.floorOffer.qty;
      c.floorOffer = null;
    }
    var o = c.order;
    if (o && o.status !== 'done') {
      if (o.kind === 'hold') { this.busy[o.hold.code] = null; o.status = 'done'; o.counts = false; this.plan.push('collect'); }
      else if (o.status === 'listed') { o.status = 'done'; o.counts = false; this.plan.push(o.kind === 'till' ? (c.kind === 'kiosk' ? 'kiosk' : 'till') : 'ck'); }
      else o.cust = null; // someone's picking it: it goes in the holding area instead
      if (o.cust === null && o.kind === 'ck') o.kind = 'c';
    } else if (!o && (c.kind === 'till' || c.kind === 'kiosk' || c.kind === 'ck' || c.kind === 'collect')) this.plan.push(c.kind);
    if (c.code && this.busy[c.code] === 'collect:' + c.id) this.busy[c.code] = null;
    c.state = 'leaving';
    this.emit('step', c);
    this.check();
  };

  /* ---------- customers ---------- */
  Day.prototype.send = function (kind, extra) {
    var Till = this.Till, c = { id: this.customers.length + 1, kind: kind, state: 'coming', surname: null, order: null, by: null, ready: false, t: this.t, say: '' };
    if (extra) for (var k in extra) c[k] = extra[k];
    if (kind === 'till' || kind === 'kiosk') {
      this.tillCust(c, kind);
    } else {
      if (!c.surname) c.surname = this.surname();
      if (c.code) this.busy[c.code] = 'collect:' + c.id;
      c.say = c.code ? Till.holdSay(this.r, c.code, c.surname) : this.pick(CC).replace('{n}', c.surname);
    }
    this.customers.push(c);
    this.emit('customer', c);
    return c;
  };
  // fills in a customer who wants the till (a till order, or one sent from the kiosk)
  Day.prototype.tillCust = function (c, kind) {
    var Till = this.Till;
    c.kind = kind;
    c.cust = c.cust || Till.makeCustomer(this.r); c.pay = Till.payment(this.r);
    c.kiosk = Till.makeKiosk(this.world, this.r, c.cust);
    if (kind === 'till') { // the kiosk list is everyone else's
      c.kiosk.list.splice(c.kiosk.mine, 1); c.kiosk.mine = -1;
      c.lines = Till.makeOrder(this.world, this.requests, this.r);
      if (!c.lines.length) { c.kind = kind = 'kiosk'; c.kiosk = Till.makeKiosk(this.world, this.r, c.cust); }
    }
    var kioskOrder = kind === 'kiosk' && c.kiosk.list[c.kiosk.mine];
    var lines = kioskOrder ? kioskOrder.lines : c.lines;
    // Keep the extra till decision independent of arrivals, kiosk contents and normal picks.
    var stockRandom = this.World.rng(this.World.hash(c.cust.no + '/' + c.id + '/stock request'));
    Till.addStockRequest(this.world, lines, stockRandom);
    var last = lines[lines.length - 1];
    if (kioskOrder && last && last.shortage) kioskOrder.total += Till.price(last.item) * last.qty;
    c.surname = c.cust.surname;
    c.say = this.pick(HELLO[kind]);
  };
  // The customer reveals what they need only after a greeting, using the branch's Digital First mix.
  Day.prototype.decide = function (c) {
    if (!this.tillsOpen() || this.mode !== 'mixed' || !this.canTill || !this.walkinTill) return;
    var want = this.r() < this.walkinTill, isTill = c.kind === 'till' || c.kind === 'kiosk';
    // The last walk-in can bring the rest of today's floor items, even on a quiet first day.
    if (!want && this.floorAllocated < this.floorTarget && !this.plan.slice(this.released).some(k => k !== 'c') &&
        !this.customers.some(other => other !== c && (other.state === 'coming' || other.state === 'greet' || other.state === 'counter'))) want = true;
    if (want) {
      if (isTill) return;
      this.freeCode(c);
      this.tillCust(c, this.r() < KIOSK_SHARE ? 'kiosk' : 'till');
      return;
    }
    // a click and collect: about half of them are a bag from the holding area, half one product from the warehouse
    // (detailedfoil, 21 Nov 2026), whatever the walk-in was going to be
    if (isTill) { c.kiosk = null; c.lines = null; c.pay = null; c.cust = null; }
    var bag = this.r() < 0.5;
    if (bag && !(c.code && this.hold[c.code])) {
      this.freeCode(c);
      var code = this.collectable();
      if (code) { c.code = code; c.surname = this.hold[code].surname; this.busy[code] = 'collect:' + c.id; }
    } else if (!bag) this.freeCode(c);
    c.kind = c.code ? 'collect' : 'ck';
    c.say = c.code ? this.Till.holdSay(this.r, c.code, c.surname) : this.pick(CC).replace('{n}', c.surname);
  };
  Day.prototype.freeCode = function (c) {
    if (c.code && this.busy[c.code] === 'collect:' + c.id) this.busy[c.code] = null;
    c.code = null;
  };
  // they've walked up to the counter and wait to be greeted (detailedfoil: nobody should speak with no one there to hear)
  Day.prototype.arrived = function (c) {
    if (c.state !== 'coming') return;
    c.here = this.t; c.state = 'greet';
    this.emit('playtest', 'customer.arrived', { customer: c.id });
    this.emit('step', c);
  };
  Day.prototype.canGreet = function (who) {
    return !this.customers.some(function (c) {
      return (c.state === 'counter' && c.greeter === who) || (c.state === 'serving' && c.by === who);
    });
  };
  // someone says hello: now they say what they're here for
  Day.prototype.greet = function (c, who) {
    if (!c || c.state !== 'greet' || (who !== 'Sam' && !this.canGreet(who))) return false;
    c.greeter = who; c.greeted = this.t;
    this.credit(who, 'greet-' + c.id, 5);
    this.decide(c);
    this.emit('playtest', 'customer.greeted', { who, customer: c.id, kind: c.kind });
    if (c.kind === 'till' || c.kind === 'kiosk') { c.state = 'counter'; this.emit('step', c); return true; }
    if (c.code && this.hold[c.code]) { // a bag in the holding area (several products): a line to fetch it
      var p = this.hold[c.code];
      c.state = 'waiting';
      c.order = this.makeOrder('hold', [], c, true, { no: 'A' + p.num, hold: { code: c.code, parcel: p }, locs: p.locs || 2, units: p.units || 3 });
      this.busy[c.code] = 'fetch:' + c.order.id;
      this.emit('step', c);
      return true;
    }
    // a click and collect of one product (any quantity), not picked yet: it's picked from the warehouse
    c.state = 'waiting';
    c.order = this.makeOrder('ck', this.World.order(this.world, this.r, 1), c, true);
    this.emit('step', c);
    return true;
  };
  Day.prototype.gone = function (c) { c.state = 'gone'; this.check(); };
  // a bag (several products) in the holding area nobody's coming for yet
  Day.prototype.collectable = function () {
    var out = [];
    for (var k in this.hold) { if (this.hold[k] && !this.busy[k]) out.push(k); }
    return out.length ? out[Math.floor(this.r() * out.length)] : null;
  };
  // empty OC spots once every c order not yet put away has had one
  Day.prototype.room = function () {
    var pending = this.orders.filter(function (o) { return o.kind === 'c' && o.status !== 'done' && !o.cust; }).length;
    var free = 0;
    for (var k in this.hold) if (!this.hold[k] && !(this.busy[k] && this.busy[k].indexOf('put:') === 0)) free++;
    return free - pending;
  };

  /* ---------- the director: when the next pick comes ---------- */
  // customer flow follows the delivery (detailedfoil, 21 Nov 2026): the further the day's picks are ahead of the
  // delivery being put away, the longer the wait for the next one, and past a point no more come until it catches up,
  // so the delivery and the picks finish around the same time
  Day.prototype.lag = function () {
    var n = this.delivery.length;
    if (!n || !this.plan.length) return 0;
    var done = this.delivery.filter(function (x) { return x.done; }).length;
    return this.released / this.plan.length - done / n;
  };
  Day.prototype.customerLimit = function () { return Math.max(MAX_IN, this.emit('playerCount') || 0); };
  Day.prototype.canStart = function (k) {
    if (this.lag() > 0.4) return false;
    if (this.projected() >= MAX_LIST) return false;
    if (k === 'c') return this.room() > 0;
    if (k === 'collect') return this.present().length < this.customerLimit() && !!this.collectable();
    return this.present().length < this.customerLimit();
  };
  Day.prototype.start = function (k) {
    this.released++;
    if (k === 'c') return this.makeOrder('c', this.World.order(this.world, this.r, 2 + Math.floor(this.r() * 3)), null, true, { surname: this.surname() });
    if (k === 'collect') { var code = this.collectable(); return this.send('collect', { code: code, surname: this.hold[code].surname }); }
    return this.send(k);
  };
  // the wait for the next pick: short when the list is empty, longer the more there is to do
  Day.prototype.gap = function () {
    if (this.phase === 'closed') return 0.4 + 0.8 * this.r();
    var L = Math.min(4, this.projected()), r = (this.r() + this.r()) / 2;
    var lo = [4, 12, 20, 30, 40][L], hi = [9, 26, 40, 55, 70][L];
    return (lo + (hi - lo) * r) * (this.lag() > 0.15 ? 2 : 1) * (this.event === 'sale' ? 0.75 : 1);
  };
  // the c picks are all in the holding area: the shop opens by itself (detailedfoil: no unlocking, only locking up at the end)
  Day.prototype.open = function () {
    if (this.phase !== 'closed') return false;
    this.phase = 'open'; this.wait = 3 + 3 * this.r();
    this.emit('unlocked');
    return true;
  };
  // the day's done: lock up, and only then does it end
  Day.prototype.credit = function (who, key, amount) {
    if (this.over || !/^p[1-4]$/.test(who) || this.xpActions.has(key)) return;
    this.xpActions.add(key);
    this.contributors.add(who);
    this.baseXP += amount;
    var cover = this.emit('tillCover') || [];
    if (cover.length) {
      this.coveredXP += amount;
      for (var staff of cover) if (/^p[1-4]$/.test(staff)) this.contributors.add(staff);
    }
    this.emit('xpChanged');
    this.emit('playtest', 'xp.earned', { who, source: key.split('-')[0], amount, covered: cover.length > 0 });
  };
  Day.prototype.confirmLine = function (order, index, who) {
    if (order.kind === 'replen') return;
    this.credit(who, 'line-' + order.id + '-' + index, 10);
  };
  Day.prototype.shiftReport = function () {
    function pace(target, elapsed) {
      return Number.isFinite(elapsed) ? Math.min(1, target / Math.max(1, elapsed)) : 0;
    }
    var customers = this.customers.filter(c => Number.isFinite(c.here));
    var picks = this.orders.filter(o => o.counts && o.lines.length && Number.isFinite(o.finishedAt));
    var noDelivery = this.event === 'failedDelivery';
    var categories = [
      ['Greetings', 100, customers.map(c => pace(12, c.greeted - c.here))],
      ['Customer waits', noDelivery ? 450 : 300, customers.map(c => {
        var target = c.kind === 'collect' ? 90 : c.kind === 'ck' ? 100 : 180;
        return pace(target, c.handedAt - c.here);
      })],
      ['Picking', 250, picks.map(o => pace(45 + 15 * (o.lines.length - 1), o.finishedAt - o.takenAt))],
      ['Delivery', noDelivery ? 0 : 150, this.delivery.map(d => pace(30, d.finishedAt - d.takenAt))]
    ];
    // When a practice day contains no timed jobs of one kind, share its weight among the applicable jobs.
    var weight = categories.reduce((n, row) => n + (row[2].length ? row[1] : 0), 0);
    var remaining = 800, active = categories.filter(row => row[1] && row[2].length);
    var rows = active.map(([label, max, samples], i) => {
      var possible = i === active.length - 1 ? remaining : Math.round(800 * max / weight);
      remaining -= possible;
      return { label, possible, earned: Math.round(possible * samples.reduce((a, b) => a + b, 0) / samples.length) };
    });
    rows.push({ label: 'Lock-up', possible: 200, earned: this.over ? 200 : 0 });
    var score = rows.reduce((n, row) => n + row.earned, 0);
    var bonus = Math.round(this.baseXP * score / 4000);
    // Round once at lock-up, including the performance bonus on covered work.
    var coverBonus = Math.round(this.coveredXP * (1 + score / 4000) * 0.05);
    return { id: this.shiftId, rows, score, baseXP: this.baseXP, bonus, coverBonus, xp: this.baseXP + bonus + coverBonus };
  };
  Day.prototype.lock = function () {
    if (this.phase !== 'lock') return false;
    for (const o of this.orders) {
      if (o.kind === 'replen' && (o.status === 'listed' || o.status === 'taken')) {
        for (const l of o.lines) l.item.reserved -= l.qty;
      }
      if (o.kind === 'replen' && o.status !== 'done') { o.status = 'skipped'; o.by = null; }
    }
    this.phase = 'done'; this.over = true; this.report = this.shiftReport();
    this.emit('locked');
    this.emit('over');
    return true;
  };
  Day.prototype.tick = function (dt) {
    if (this.over) return;
    this.t += dt;
    if (this.phase === 'lock') return;
    this.checkScannerFault(dt);
    var left = this.released < this.plan.length;
    if (this.phase === 'closed' && this.released >= this.first) { this.check(); return; } // the c picks are out: waiting for them to be put away
    // the next pick
    this.wait -= dt;
    if (this.wait <= 0 && left) {
      var k = this.plan[this.released];
      if (k === 'c' && this.room() <= 0) { // the holding area's full: something else first
        for (var j = this.released + 1; j < this.plan.length; j++) if (this.plan[j] !== 'c') { this.plan[this.released] = this.plan[j]; this.plan[j] = 'c'; k = this.plan[this.released]; break; }
        // only c picks left and nowhere to put them: a customer comes for a bag instead, which makes room
        if (k === 'c' && this.collectable() && !this.customers.some(function (c) { return c.kind === 'collect' && c.state !== 'gone' && c.state !== 'leaving'; })) k = this.plan[this.released] = 'collect';
      }
      if (k === 'collect' && !this.collectable()) { // no bag to collect yet: a one product customer instead
        for (var m = this.released + 1; m < this.plan.length; m++) if (this.plan[m] !== 'collect') { this.plan[this.released] = this.plan[m]; this.plan[m] = 'collect'; k = this.plan[this.released]; break; }
        if (k === 'collect') { k = this.plan[this.released] = 'ck'; }
      }
      if (!this.canStart(k)) this.wait = 1 + this.r();
      else if (k !== 'c' && this.present().length >= this.customerLimit() - 1 && this.projected() > 0 && !(this.crowdT && this.t >= this.crowdT)) {
        // two in already and something to do: a third comes in a while later, so it's seldom three for long
        if (!this.crowdT) this.crowdT = this.t + 15 + 25 * this.r();
        this.wait = 1 + this.r();
      } else { this.crowdT = 0; this.start(k); this.wait = this.gap(); }
    }
    if (this.phase === 'open' && left && this.projected() === 0 && this.wait > 9) this.wait = 4 + 5 * this.r(); // never empty for long
    this.check();
  };
  // c picks all away: time to open. Everything done and nobody waiting: time to lock up.
  Day.prototype.check = function () {
    if (this.over) return;
    // before opening, a pick Sam has already started doesn't hold the doors shut (detailedfoil, 20 Nov 2026)
    var left = function (o) { return o.status !== 'done' && !(o.status === 'taken' && o.by === 'Sam'); };
    if (this.released < this.plan.length) {
      if (this.phase === 'closed' && this.released >= this.first && !this.orders.some(left)) {
        this.open();
      }
      return;
    }
    if (this.phase === 'closed') { if (this.orders.some(left)) return; this.open(); return; }
    if (this.phase !== 'open') return;
    if (this.orders.some(function (o) { return o.kind !== 'replen' && o.status !== 'done'; })) return;
    if (this.present().length) return;
    if (this.delivery.some(function (d) { return !d.done; })) return; // the delivery has to be away first
    this.phase = 'lock'; this.emit('closing');
  };
  // someone leaves the shift part way (Sam taken off): what they had goes back on the list, their customer back in the queue
  Day.prototype.release = function (who) {
    var self = this;
    this.orders.forEach(function (o) {
      if (o.by !== who || o.status === 'done' || o.status === 'listed') return;
      if (o.kind === 'hold' && o.hold && o.status === 'picked') { self.hold[o.hold.code] = o.hold.parcel; self.busy[o.hold.code] = 'fetch:' + o.id; self.emit('holdSet', o.hold.code, o.hold.parcel); }
      o.status = 'listed'; o.by = null; self.emit('changed', o);
    });
    this.customers.forEach(function (c) {
      if (c.greeter === who) c.greeter = null;
      if (c.by === who && c.state === 'serving') self.unserve(c);
    });
    for (var k in this.busy) if (this.busy[k] === 'put:' + who) this.busy[k] = null;
    this.delivery.forEach(function (d) { if (d.by === who && !d.done) { d.by = null; self.emit('delivery', d); } });
  };
  // how the day went, from one person's point of view (who: whatever they passed to take())
  Day.prototype.summary = function (who) {
    var mine = this.orders.filter(function (o) { return o.doneBy === who; });
    return { picks: mine.filter(function (o) { return o.counts; }).length, fetched: mine.filter(function (o) { return o.kind === 'hold'; }).length,
      putAway: mine.filter(function (o) { return o.kind === 'c' && o.code; }).length, total: this.total, minutes: this.t / 60,
      delivery: this.delivery.filter(function (d) { return d.doneBy === who; }).length };
  };

  function create(o) { var d = new Day(o); return d; }
  var api = { create: create, Day: Day, DELIVERY: DELIVERY, TOTAL: TOTAL, MAX_LIST: MAX_LIST, MAX_IN: MAX_IN, MODES: MODES, EVENTS: EVENTS, DIGITAL_FIRST: DIGITAL_FIRST, rollEvent: rollEvent };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShiftDay = api;
})(typeof window !== 'undefined' ? window : this);
