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

   A day is 15 to 25 picks, 20 or so (detailedfoil, 19 Nov 2026). Before opening 3 to 6 of them are c picks (two or more different
   products, no customer): pick them, put them in the holding area, and the shop opens by itself ("Doors open").
   Around 40% (35 to 45) are till or kiosk orders, the rest an even-ish split of click and collect customers with one
   product (picked from the warehouse) and customers who collect a bag already in the holding area (several products;
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
  // which kinds of pick come after the opening c picks (the scanner's Function menu can narrow it, for practice)
  var MODES = { mixed: ['ck', 'collect', 'till', 'kiosk'], pick: ['ck'], hold: ['collect'], till: ['till'], kiosk: ['kiosk'] };
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
    this.total = o.total || (15 + Math.floor(this.r() * 11)); // 15 to 25 picks (detailedfoil: it needn't be exactly 20)
    this.mode = MODES[o.mode] ? o.mode : 'mixed';
    this.canTill = !!(this.requests && this.requests.need && this.requests.need.length);
    this.t = 0; this.nextId = 1; this.used = {};
    this.orders = []; this.customers = []; this.owners = []; this.log = [];
    this.phase = 'closed';                 // closed (c picks, before opening), open, lock (everything's done: waiting for you to lock the front door), done
    this.done = 0; this.released = 0; this.over = false;
    // the holding area: what's in each OC spot, and who's on their way to it (fetching it, or filling it)
    this.hold = {}; this.busy = {};
    var spots = this.world.holding ? this.world.holding.spots : [];
    spots.forEach(function (sp) { self.hold[sp.code] = null; self.busy[sp.code] = null; });
    if (o.hold) { for (var k in o.hold) if (o.hold[k] && k in this.hold) { this.hold[k] = o.hold[k]; this.used[o.hold[k].num] = 1; } }
    else spots.forEach(function (sp) { if (self.r() < 0.45) { var q = self.parcel(self.surname(), null); q.locs = 2 + Math.floor(self.r() * 3); q.units = q.locs + Math.floor(self.r() * 4); self.hold[sp.code] = q; } });
    // the plan: what each of the day's picks will be (3 to 6 c picks first, as many as the holding area has room for)
    var free = 0; for (var hk in this.hold) if (!this.hold[hk]) free++;
    this.first = Math.min(3 + Math.floor(this.r() * 4), free);
    this.plan = [];
    for (var i = 0; i < this.total; i++) this.plan.push(i < this.first ? 'c' : null);
    this.fillPlan(true);
    this.wait = 1.0;                       // seconds to the next pick
    if (this.first === 0) { this.phase = 'open'; this.wait = 3 + 3 * this.r(); }
  }
  Day.prototype.emit = function (name, a, b) { var f = this.env[name]; if (typeof f === 'function') return f.call(this.env, a, b); return undefined; };
  Day.prototype.pick = function (list) { return list[Math.floor(this.r() * list.length)]; };

  /* ---------- the plan ---------- */
  function shuffle(a, r) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  // after the opening c picks: 8 of the 20 (40%) are till or kiosk orders, the rest click and collect, split about evenly
  // between one-product customers and bag collections, a little different each day
  Day.prototype.fillPlan = function (initial) {
    var self = this, from = Math.max(this.first, this.released), n = this.plan.length - from, rest, i;
    if (initial && this.mode === 'mixed') {
      var nt = Math.min(n - 2, Math.round((0.35 + 0.1 * this.r()) * this.total)), tl = Math.max(1, Math.min(nt - 1, Math.round(nt / 2 + (this.r() - 0.5) * 2)));
      var R = n - nt, C = Math.max(Math.min(2, R - 1), Math.min(R - 1, Math.round(R / 2 + (this.r() - 0.5) * 2)));
      rest = [];
      for (i = 0; i < nt; i++) rest.push(i < tl ? 'till' : 'kiosk');
      for (i = 0; i < R; i++) rest.push(i < C ? 'collect' : 'ck');
      shuffle(rest, this.r);
    } else {
      var kinds = MODES[this.mode];
      rest = [];
      for (i = 0; i < n; i++) rest.push(this.pick(kinds));
    }
    // never three the same in a row
    var prev = this.plan.slice(0, from);
    for (i = 0; i < rest.length; i++) {
      var a = i >= 2 ? rest[i - 1] : prev[prev.length - 1], b = i >= 2 ? rest[i - 2] : prev[prev.length - 2];
      if (a === rest[i] && b === rest[i]) { for (var j = i + 1; j < rest.length; j++) if (rest[j] !== rest[i]) { var t = rest[i]; rest[i] = rest[j]; rest[j] = t; break; } }
    }
    for (i = 0; i < rest.length; i++) this.plan[from + i] = (rest[i] === 'till' && !this.canTill) ? 'kiosk' : rest[i];
    void self;
  };
  Day.prototype.setMode = function (m) { if (!MODES[m]) return; this.mode = m; this.fillPlan(false); };

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
  var LATE_PICK = 5;
  Day.prototype.listLate = function () { var t = this.t; return this.list().filter(function (o) { return t - o.t > LATE_PICK; }); };
  // customers at the counter nobody has said hello to yet, the one waiting longest first
  Day.prototype.ungreeted = function () { return this.customers.filter(function (c) { return c.state === 'greet'; }); };
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
  // they've walked up to the counter and wait to be greeted (detailedfoil: nobody should speak with no one there to hear)
  Day.prototype.arrived = function (c) {
    if (c.state !== 'coming') return;
    c.here = this.t; c.state = 'greet';
    this.emit('step', c);
  };
  // someone says hello: now they say what they're here for
  Day.prototype.greet = function (c, who) {
    if (!c || c.state !== 'greet') return false;
    c.greeter = who; c.greeted = this.t;
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
  Day.prototype.canStart = function (k) {
    if (this.projected() >= MAX_LIST) return false;
    if (k === 'c') return this.room() > 0;
    if (k === 'collect') return this.present().length < MAX_IN && !!this.collectable();
    return this.present().length < MAX_IN;
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
    return lo + (hi - lo) * r;
  };
  // the c picks are all in the holding area: the shop opens by itself (detailedfoil: no unlocking, only locking up at the end)
  Day.prototype.open = function () {
    if (this.phase !== 'closed') return false;
    this.phase = 'open'; this.wait = 3 + 3 * this.r();
    this.emit('unlocked');
    return true;
  };
  // the day's done: lock up, and only then does it end
  Day.prototype.lock = function () {
    if (this.phase !== 'lock') return false;
    this.phase = 'done'; this.over = true;
    this.emit('locked');
    this.emit('over');
    return true;
  };
  Day.prototype.tick = function (dt) {
    if (this.over) return;
    this.t += dt;
    if (this.phase === 'lock') return;
    var left = this.released < this.plan.length;
    if (this.phase === 'closed' && this.released >= this.first) { this.check(); return; } // the c picks are out: waiting for them to be put away
    // the next pick
    this.wait -= dt;
    if (this.wait <= 0 && left) {
      var k = this.plan[this.released];
      if (k === 'c' && this.room() <= 0) { // the holding area's full: something else first
        for (var j = this.released + 1; j < this.plan.length; j++) if (this.plan[j] !== 'c') { this.plan[this.released] = this.plan[j]; this.plan[j] = 'c'; k = this.plan[this.released]; break; }
      }
      if (k === 'collect' && !this.collectable()) { // no bag to collect yet: a one product customer instead
        for (var m = this.released + 1; m < this.plan.length; m++) if (this.plan[m] !== 'collect') { this.plan[this.released] = this.plan[m]; this.plan[m] = 'collect'; k = this.plan[this.released]; break; }
        if (k === 'collect') { k = this.plan[this.released] = 'ck'; }
      }
      if (!this.canStart(k)) this.wait = 1 + this.r();
      else if (k !== 'c' && this.present().length >= MAX_IN - 1 && this.projected() > 0 && !(this.crowdT && this.t >= this.crowdT)) {
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
    if (this.released < this.plan.length) {
      if (this.phase === 'closed' && this.released >= this.first && !this.orders.some(function (o) { return o.status !== 'done'; })) {
        this.open();
      }
      return;
    }
    if (this.phase === 'closed') { if (this.orders.some(function (o) { return o.status !== 'done'; })) return; this.open(); return; }
    if (this.phase !== 'open') return;
    if (this.orders.some(function (o) { return o.status !== 'done'; })) return;
    if (this.present().length) return;
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
    this.customers.forEach(function (c) { if (c.by === who && c.state === 'serving') self.unserve(c); });
    for (var k in this.busy) if (this.busy[k] === 'put:' + who) this.busy[k] = null;
  };
  // how the day went, from one person's point of view (who: whatever they passed to take())
  Day.prototype.summary = function (who) {
    var mine = this.orders.filter(function (o) { return o.doneBy === who; });
    return { picks: mine.filter(function (o) { return o.counts; }).length, fetched: mine.filter(function (o) { return o.kind === 'hold'; }).length,
      putAway: mine.filter(function (o) { return o.kind === 'c' && o.code; }).length, total: this.total, minutes: this.t / 60 };
  };

  function create(o) { var d = new Day(o); return d; }
  var api = { create: create, Day: Day, TOTAL: TOTAL, MAX_LIST: MAX_LIST, MAX_IN: MAX_IN, MODES: MODES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShiftDay = api;
})(typeof window !== 'undefined' ? window : this);
