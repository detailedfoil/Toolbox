/* Warehouse Shift: the day's work (detailedfoil, 19 Nov 2026). Shared by the page (game.js, which also passes it on
   to Alex in bot.js) and the tests. No drawing here: game.js walks the customers about and draws the holding area.

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

   A day is 20 picks of any kind; the first 2 to 4 are c picks, waiting when the day starts. The list stays steady: at
   most 5 at once, new ones coming in unevenly, now and then empty for a few seconds. At most 3 customers in at once,
   and seldom 3 for long. The day ends when all 20 are done and nobody is waiting.

   create(opts): opts.world, World (world.js), Till (till.js), requests (data/requests.json), rand, total, mode, and
   env, told what happens: listed(order), changed(order), customer(c) (walk them in, then call arrived(c) at the
   counter), step(c) (they've somewhere new to stand), holdSet(code, parcel), over(). tick(dt) once a frame. */
(function (root) {
  'use strict';

  var TOTAL = 20;          // picks in a day (detailedfoil)
  var MAX_LIST = 5;        // on the pick list at once
  var MAX_IN = 3;          // customers in at once
  var OWNER = 0.35;        // how many online orders have their customer come in later the same day
  // which kinds of pick come after the first c picks (the scanner's Function menu can narrow it, for practice)
  var MODES = { mixed: ['c', 'ck', 'till', 'kiosk'], pick: ['ck'], hold: ['c'], till: ['till'], kiosk: ['kiosk'] };
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
    this.total = o.total || TOTAL;
    this.mode = MODES[o.mode] ? o.mode : 'mixed';
    this.canTill = !!(this.requests && this.requests.need && this.requests.need.length);
    this.t = 0; this.nextId = 1; this.used = {};
    this.orders = []; this.customers = []; this.owners = []; this.log = [];
    this.done = 0; this.released = 0; this.over = false;
    // the holding area: what's in each OC spot, and who's on their way to it (fetching it, or filling it)
    this.hold = {}; this.busy = {};
    var spots = this.world.holding ? this.world.holding.spots : [];
    spots.forEach(function (sp) { self.hold[sp.code] = null; self.busy[sp.code] = null; });
    if (o.hold) { for (var k in o.hold) if (o.hold[k] && k in this.hold) { this.hold[k] = o.hold[k]; this.used[o.hold[k].num] = 1; } }
    else spots.forEach(function (sp) { if (self.r() < 0.45) self.hold[sp.code] = self.parcel(self.surname(), null); });
    // the plan: what each of the day's picks will be
    this.first = 2 + Math.floor(this.r() * 3);
    this.plan = [];
    for (var i = 0; i < this.total; i++) this.plan.push(i < this.first ? 'c' : null);
    this.fillPlan();
    this.wait = 1.0;                       // seconds to the next pick
    this.collectT = 40 + 50 * this.r();    // the next customer for a bag in the holding area
  }
  Day.prototype.emit = function (name, a, b) { var f = this.env[name]; if (typeof f === 'function') return f.call(this.env, a, b); return undefined; };
  Day.prototype.pick = function (list) { return list[Math.floor(this.r() * list.length)]; };

  /* ---------- the plan ---------- */
  Day.prototype.fillPlan = function () {
    var kinds = MODES[this.mode], self = this;
    for (var i = Math.max(this.first, this.released); i < this.plan.length; i++) {
      var k = this.pick(kinds);
      // never three the same in a row
      if (kinds.length > 1 && i >= 2 && this.plan[i - 1] === k && this.plan[i - 2] === k) k = kinds[(kinds.indexOf(k) + 1 + Math.floor(this.r() * (kinds.length - 1))) % kinds.length];
      if (k === 'till' && !this.canTill) k = 'kiosk';
      this.plan[i] = k;
    }
    void self;
  };
  Day.prototype.setMode = function (m) { if (!MODES[m]) return; this.mode = m; this.fillPlan(); };

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
  Day.prototype.list = function () { return this.orders.filter(function (o) { return o.status === 'listed'; }); };
  Day.prototype.label = function (o) { return o.no + ' ' + o.locs + ':' + o.units + (o.kind === 'c' ? ' c' : o.kind === 'till' ? '' : ' CK'); };
  // what's coming onto the list: what's on it, customers walking in who'll put a line on it, till customers not paid yet
  Day.prototype.projected = function () {
    var n = this.list().length;
    this.customers.forEach(function (c) {
      if (c.order) return;
      if (c.kind === 'till' || c.kind === 'kiosk') { if (c.state === 'coming' || c.state === 'counter' || c.state === 'serving') n++; }
      else if (c.state === 'coming' && !(c.kind === 'owner' && c.own && c.own.status !== 'done')) n++;
    });
    return n;
  };
  Day.prototype.present = function () { return this.customers.filter(function (c) { return c.state !== 'gone' && c.state !== 'leaving'; }); };
  // till customers at the counter that nobody is serving yet
  Day.prototype.queue = function () { return this.customers.filter(function (c) { return c.state === 'counter' && !c.by; }); };
  Day.prototype.makeOrder = function (kind, lines, cust, counts, extra) {
    lines = (lines || []).filter(function (l) { return l.item && l.item.loc; }).map(function (l) { return { item: l.item, loc: l.item.loc, qty: l.qty }; });
    lines.sort(function (a, b) { return a.loc.order - b.loc.order; });
    var locs = {}, units = 0;
    lines.forEach(function (l) { locs[l.loc.code] = 1; units += l.qty; });
    var o = { id: this.nextId++, no: (extra && extra.no) || this.number(), kind: kind, lines: lines, locs: Object.keys(locs).length, units: units,
      status: 'listed', by: null, cust: cust || null, counts: counts !== false, t: this.t, surname: cust ? cust.surname : null, code: null, hold: null };
    if (extra) for (var k in extra) if (k !== 'no') o[k] = extra[k];
    this.orders.push(o);
    this.emit('listed', o);
    return o;
  };

  /* ---------- picking ---------- */
  // whoever starts an order has it, and there's no backing out
  Day.prototype.take = function (o, who) {
    if (!o || o.status !== 'listed') return false;
    o.status = 'taken'; o.by = who; o.takenAt = this.t;
    this.emit('changed', o);
    return true;
  };
  Day.prototype.picked = function (o) { if (o.status === 'taken') o.status = 'picked'; this.emit('changed', o); };
  // the bag out of its OC spot, for a customer at the counter
  Day.prototype.fetch = function (o) {
    var code = o.hold && o.hold.code;
    if (!code) return null;
    var p = this.hold[code];
    this.hold[code] = null; this.busy[code] = null;
    this.emit('holdSet', code, null);
    o.status = 'picked';
    this.emit('changed', o);
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
    if (!(code in this.hold) || this.hold[code] || (this.busy[code] && this.busy[code] !== 'put:' + who)) return null;
    var p = this.parcel(o.surname, o.no);
    p.order = o;
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
    if (c) { c.state = 'leaving'; this.emit('step', c); }
    this.emit('changed', o);
    this.finish(o);
    return true;
  };
  Day.prototype.finish = function (o) {
    if (o.counts) this.done++;
    this.log.push({ t: this.t, no: o.no, kind: o.kind, by: o.doneBy, took: this.t - (o.takenAt || o.t) });
    this.check();
  };

  /* ---------- the till ---------- */
  Day.prototype.serve = function (c, who) {
    if (!c || c.state !== 'counter' || c.by) return false;
    c.state = 'serving'; c.by = who; c.ready = false;
    this.emit('step', c);
    return true;
  };
  // they'd been called over but nobody had started on them: back to waiting for whoever's free
  Day.prototype.unserve = function (c) {
    if (!c || c.state !== 'serving') return;
    c.state = 'counter'; c.by = null; c.ready = false;
    this.emit('step', c);
  };
  // paid for: the order goes on the list and the customer stands to one side
  Day.prototype.tillDone = function (c, lines, extra) {
    var o = this.makeOrder('till', lines, c, true, extra);
    c.order = o; c.state = 'waiting'; c.by = null; c.ready = false;
    this.emit('step', c);
    return o;
  };
  // a customer going without what they came for: their pick comes later instead
  Day.prototype.giveUp = function (c) {
    if (c.state === 'gone' || c.state === 'leaving') return;
    var o = c.order;
    if (o && o.status !== 'done') {
      if (o.kind === 'hold') { this.busy[o.hold.code] = null; o.status = 'done'; }
      else if (o.status === 'listed') { o.status = 'done'; o.counts = false; this.plan.push(o.kind === 'till' ? (c.kind === 'kiosk' ? 'kiosk' : 'till') : 'ck'); }
      else o.cust = null; // someone's picking it: it goes in the holding area instead
      if (o.cust === null && o.kind === 'ck') o.kind = 'c';
    } else if (!o && (c.kind === 'till' || c.kind === 'kiosk' || c.kind === 'ck')) this.plan.push(c.kind);
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
      c.cust = Till.makeCustomer(this.r); c.pay = Till.payment(this.r);
      c.kiosk = Till.makeKiosk(this.world, this.r, c.cust);
      if (kind === 'till') { // the kiosk list is everyone else's
        c.kiosk.list.splice(c.kiosk.mine, 1); c.kiosk.mine = -1;
        c.lines = Till.makeOrder(this.world, this.requests, this.r);
        if (!c.lines.length) { c.kind = kind = 'kiosk'; c.kiosk = Till.makeKiosk(this.world, this.r, c.cust); }
      }
      c.surname = c.cust.surname;
      c.say = this.pick(HELLO[kind]);
    } else {
      if (!c.surname) c.surname = this.surname();
      if (c.code) this.busy[c.code] = 'collect:' + c.id;
      c.say = c.code ? Till.holdSay(this.r, c.code, c.surname) : this.pick(CC).replace('{n}', c.surname);
    }
    this.customers.push(c);
    this.emit('customer', c);
    return c;
  };
  // they've walked up to the counter
  Day.prototype.arrived = function (c) {
    if (c.state !== 'coming') return;
    c.here = this.t;
    if (c.kind === 'till' || c.kind === 'kiosk') { c.state = 'counter'; this.emit('step', c); return; }
    var o = c.own;
    if (c.kind === 'owner' && o) {
      if (o.status !== 'done') { // still on the list, or being picked: it's for a customer at the counter now
        o.kind = 'ck'; o.cust = c; c.order = o; c.state = 'waiting';
        this.emit('changed', o); this.emit('step', c);
        return;
      }
      if (o.code && this.hold[o.code] && this.hold[o.code].order === o) c.code = o.code;
    }
    if (c.code && this.hold[c.code]) { // in the holding area: a line to fetch it
      var p = this.hold[c.code];
      c.state = 'waiting';
      c.order = this.makeOrder('hold', [], c, false, { no: 'A' + p.num, hold: { code: c.code, parcel: p }, locs: 1, units: 1 });
      this.busy[c.code] = 'fetch:' + c.order.id;
      this.emit('step', c);
      return;
    }
    // a click and collect nobody's picked yet: one of the day's picks
    var u = this.r(), lines = this.World.order(this.world, this.r, u < 0.5 ? 1 : u < 0.8 ? 2 : 3);
    c.state = 'waiting';
    c.order = this.makeOrder('ck', lines, c, true);
    this.emit('step', c);
  };
  Day.prototype.gone = function (c) { c.state = 'gone'; this.check(); };
  // a bag in the holding area nobody's coming for yet
  Day.prototype.collectable = function () {
    var self = this, out = [];
    for (var k in this.hold) {
      var p = this.hold[k];
      if (!p || this.busy[k]) continue;
      if (p.order && this.owners.some(function (w) { return w.order === p.order; })) continue; // its owner's on the way
      out.push(k);
    }
    void self;
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
  Day.prototype.canStart = function (k) {
    if (this.projected() >= MAX_LIST) return false;
    if (k === 'c') return this.room() > 0;
    return this.present().length < MAX_IN;
  };
  Day.prototype.start = function (k) {
    this.released++;
    if (k === 'c') {
      var o = this.makeOrder('c', this.World.order(this.world, this.r), null, true, { surname: this.surname() });
      if (this.released > this.first && this.r() < OWNER) this.owners.push({ order: o, at: this.t + 60 + 150 * this.r() });
      return o;
    }
    return this.send(k);
  };
  // the wait for the next pick: short when the list is empty, longer the more there is to do
  Day.prototype.gap = function () {
    if (this.released < this.first) return 0.4 + 0.8 * this.r();
    var L = Math.min(4, this.projected()), r = (this.r() + this.r()) / 2;
    var lo = [4, 12, 20, 30, 40][L], hi = [9, 26, 40, 55, 70][L];
    return lo + (hi - lo) * r;
  };
  Day.prototype.tick = function (dt) {
    if (this.over) return;
    this.t += dt;
    var left = this.released < this.plan.length;
    // customers for today's online orders
    for (var i = this.owners.length - 1; i >= 0; i--) {
      var w = this.owners[i];
      if (this.t < w.at) continue;
      var o = w.order, inHold = o.status === 'done';
      if (!left || (inHold && !(o.code && this.hold[o.code] && this.hold[o.code].order === o) || (inHold && this.busy[o.code]))) { this.owners.splice(i, 1); continue; }
      if (this.present().length < MAX_IN - 1 && (!inHold || this.projected() < MAX_LIST)) { this.owners.splice(i, 1); this.send('owner', { own: o, surname: o.surname, code: inHold ? o.code : null }); }
      else w.at = this.t + 6 + 10 * this.r();
    }
    // the next pick
    this.wait -= dt;
    if (this.wait <= 0 && left) {
      var k = this.plan[this.released];
      if (k === 'c' && this.room() <= 0) { // the holding area's full: something else first
        for (var j = this.released + 1; j < this.plan.length; j++) if (this.plan[j] !== 'c') { this.plan[this.released] = this.plan[j]; this.plan[j] = 'c'; k = this.plan[this.released]; break; }
      }
      if (!this.canStart(k)) this.wait = 1 + this.r();
      else if (k !== 'c' && this.present().length >= MAX_IN - 1 && this.projected() > 0 && !(this.crowdT && this.t >= this.crowdT)) {
        // two in already and something to do: a third comes in a while later, so it's seldom three for long
        if (!this.crowdT) this.crowdT = this.t + 15 + 25 * this.r();
        this.wait = 1 + this.r();
      } else { this.crowdT = 0; this.start(k); this.wait = this.gap(); }
    }
    if (left && this.released >= this.first && this.projected() === 0 && this.wait > 9) this.wait = 4 + 5 * this.r(); // never empty for long
    // someone for a bag in the holding area (not one of the day's picks)
    this.collectT -= dt;
    if (this.collectT <= 0) {
      this.collectT = 50 + 70 * this.r();
      var code = left && this.released >= this.first && this.present().length < MAX_IN - 1 && this.projected() < MAX_LIST ? this.collectable() : null;
      if (code) this.send('collect', { code: code, surname: this.hold[code].surname });
    }
    this.check();
  };
  // the day's done: every pick started and finished, nobody waiting, no bag on its way to the counter
  Day.prototype.check = function () {
    if (this.over || this.released < this.plan.length) return;
    if (this.orders.some(function (o) { return o.status !== 'done'; })) return;
    if (this.present().length) return;
    this.over = true;
    this.emit('over');
  };
  // how the day went, from one person's point of view (who: whatever they passed to take())
  Day.prototype.summary = function (who) {
    var mine = this.orders.filter(function (o) { return o.doneBy === who; });
    return { picks: mine.filter(function (o) { return o.counts; }).length, fetched: mine.filter(function (o) { return o.kind === 'hold'; }).length,
      putAway: mine.filter(function (o) { return o.kind === 'c' && o.code; }).length, total: this.total, minutes: this.t / 60 };
  };

  function create(o) { return new Day(o); }
  var api = { create: create, Day: Day, TOTAL: TOTAL, MAX_LIST: MAX_LIST, MAX_IN: MAX_IN, MODES: MODES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShiftDay = api;
})(typeof window !== 'undefined' ? window : this);
