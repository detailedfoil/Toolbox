/* Warehouse Shift: Sam, a coworker who does the same job as you (detailedfoil, 19 Nov 2026: "like a coworker, and
   they do the same thing, and they take as long to do everything as a human would"). A scripted worker, not an AI
   model. Shared by the page (game.js draws Sam and the customers) and the tests.

   Sam works from the same pick list as you (day.js), in detailedfoil's order: first any pick a customer is waiting
   for (CK, and orders paid for at the till), then the next customer at the till, then the c picks for the holding
   area. Free again, they look at the list straight away. They serve till customers at the right-hand till of the trade
   counter (surname, postcode, a third detail, then each product asked for, card or cash; kiosk orders found on Kiosk Orders), and the
   order goes on the list for whoever gets to it first. Once they start an order they finish it: picked into a tote,
   then over the counter to its customer, or into an empty OC spot in the holding area for a c pick (to the counter
   instead if its customer walks in meanwhile). Everything takes as long as it would take a person: walking at about
   1.3 m/s, reading the scanner, putting the tote down, kneeling for the bottom shelves, aiming the scanner and a moment
   per item, typing at the till and searching for what was asked for. Every timing varies, and about one thing in
   fifteen goes wrong and costs a few seconds (a wrong scan, the wrong aisle, a typo, the wrong product shown to the
   customer, one too many picked); a slip never changes what the customer gets.

   The pick aisles (the ones off the centre aisle, not the centre aisle itself) take one person at a time
   (detailedfoil, 19 Nov 2026): whoever is in an aisle first has it, and anyone else waits by its end until they come
   out. Sam waits beside the opening, clear of the way out; you can't walk in while Sam is in there (game.js). In the
   open (the centre aisle, the back walkway, behind the counter, goods in) Sam walks round you and any other
   coworker: they stop when you're in the way, go round if there's room, and say excuse me if you don't move.

   Nav(world): the floor on a 10 cm grid, how far each spot is from the nearest obstacle, and the shortest way round.
   create(opts): a worker. update(dt, others) once a frame (others: you and any other worker, {x, y, r, moving}); the
   drawing reads where they are and what they're doing (x, y, yaw, speed, kneeling, aim, carry ...). opts.env does
   the rest: board() (what's on the list and who's at the till), take, serve, picked, holdFree, reserve, unreserve,
   putAway, holdTake, tillDone and handOver (all passed on to day.js), and the speech bubbles, the sounds and the trays. */
(function (root) {
  'use strict';

  /* ---------- the floor: where a body fits, and the way round ---------- */
  var CELL = 0.1;        // grid cell, metres
  var BODY = 0.22;       // a body's radius (yours is the same in game.js)
  var FAR = 1.0;         // clearance is worked out up to a metre
  var SOFT = 0.5;        // closer than this to a shelf costs a little more, so paths keep to the middle of aisles
  var DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1], DIAG = CELL * Math.SQRT2;
  // Sam's trolley (detailedfoil, 19 Nov 2026): a stack of blue totes on a grey base with wheels. Pushed in front
  // on the open floor and parked across the entrance when Sam is inside a pick aisle.
  var TROLLEY = { len: 0.78, wide: 0.5, ahead: 0.6, behind: 0.56 };

  function Nav(world) {
    var nx = Math.ceil(world.W / CELL), ny = Math.ceil(world.D / CELL), n = nx * ny, clr = new Float32Array(n);
    for (var j = 0; j < ny; j++) {
      var y = (j + 0.5) * CELL;
      for (var i = 0; i < nx; i++) { var x = (i + 0.5) * CELL; clr[j * nx + i] = Math.min(FAR, x, world.W - x, y, world.D - y); }
    }
    world.obstacles.forEach(function (o) {
      var x0 = Math.min(o.x0, o.x1), x1 = Math.max(o.x0, o.x1), y0 = Math.min(o.y0, o.y1), y1 = Math.max(o.y0, o.y1);
      var i0 = Math.max(0, Math.floor((x0 - FAR) / CELL)), i1 = Math.min(nx - 1, Math.floor((x1 + FAR) / CELL));
      var j0 = Math.max(0, Math.floor((y0 - FAR) / CELL)), j1 = Math.min(ny - 1, Math.floor((y1 + FAR) / CELL));
      for (var jj = j0; jj <= j1; jj++) {
        var cy = (jj + 0.5) * CELL, dy = Math.max(y0 - cy, 0, cy - y1);
        for (var ii = i0; ii <= i1; ii++) {
          var cx = (ii + 0.5) * CELL, dx = Math.max(x0 - cx, 0, cx - x1), d = Math.sqrt(dx * dx + dy * dy), q = jj * nx + ii;
          if (d < clr[q]) clr[q] = d;
        }
      }
    });
    this.W = world.W; this.D = world.D; this.nx = nx; this.ny = ny; this.clr = clr;
    this.g = new Float64Array(n); this.from = new Int32Array(n); this.seen = new Uint32Array(n); this.done = new Uint32Array(n); this.stamp = 0;
  }
  // how far a point is from the nearest obstacle (between cell centres it's blended)
  Nav.prototype.clear = function (x, y) {
    var fx = x / CELL - 0.5, fy = y / CELL - 0.5, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    if (i < 0 || j < 0 || i + 1 >= this.nx || j + 1 >= this.ny) return 0;
    var c = this.clr, nx = this.nx, k = j * nx + i;
    return (c[k] * (1 - u) + c[k + 1] * u) * (1 - v) + (c[k + nx] * (1 - u) + c[k + nx + 1] * u) * v;
  };
  // other people as round obstacles: {x, y, r} -> what find() checks
  function rings(discs, R) {
    if (!discs || !discs.length) return null;
    return discs.map(function (d) { var rr = (d.r || BODY) + R; return { x: d.x, y: d.y, rr: rr * rr }; });
  }
  function inRing(dz, x, y) {
    if (!dz) return false;
    for (var i = 0; i < dz.length; i++) { var dx = x - dz[i].x, dy = y - dz[i].y; if (dx * dx + dy * dy < dz[i].rr) return true; }
    return false;
  }
  Nav.prototype.cellOk = function (k, R, dz) {
    if (this.clr[k] < R) return false;
    if (!dz) return true;
    var nx = this.nx, i = k % nx;
    return !inRing(dz, (i + 0.5) * CELL, ((k - i) / nx + 0.5) * CELL);
  };
  // the nearest cell a body fits in, within `max` metres of a point (-1 if none)
  Nav.prototype.nearest = function (x, y, R, dz, max) {
    var nx = this.nx, ny = this.ny, ci = Math.floor(x / CELL), cj = Math.floor(y / CELL), best = -1, bd = Infinity, m = Math.ceil(max / CELL);
    for (var dj = -m; dj <= m; dj++) for (var di = -m; di <= m; di++) {
      var i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      var k = j * nx + i, d = Math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - y);
      if (d < bd && d <= max && this.cellOk(k, R, dz)) { bd = d; best = k; }
    }
    return best;
  };
  Nav.prototype.fits = function (x, y, R, discs) { return this.clear(x, y) >= R && !inRing(rings(discs, R), x, y); };
  // the shortest way from a to b for a body of radius R, round `discs` (other people) too: a list of points, or null
  Nav.prototype.find = function (ax, ay, bx, by, discs, R) {
    R = R || BODY;
    var nx = this.nx, ny = this.ny, clr = this.clr, self = this, dz = rings(discs, R);
    var s = this.nearest(ax, ay, R, dz, 0.6), t = this.nearest(bx, by, R, dz, 0.8);
    if (s < 0 || t < 0) return null;
    var stamp = ++this.stamp, g = this.g, from = this.from, seen = this.seen, done = this.done;
    var ti = t % nx, tj = (t - ti) / nx;
    var h = function (k) { var i = k % nx, j = (k - i) / nx, di = Math.abs(i - ti), dj = Math.abs(j - tj); return (Math.max(di, dj) + 0.41421356 * Math.min(di, dj)) * CELL; };
    var hk = [], hv = [];
    var push = function (k, v) {
      var i = hk.length; hk.push(k); hv.push(v);
      while (i > 0) { var p = (i - 1) >> 1; if (hv[p] <= v) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; }
      hk[i] = k; hv[i] = v;
    };
    var pop = function () {
      var top = hk[0], lk = hk.pop(), lv = hv.pop(), n = hk.length;
      if (n) {
        var i = 0;
        for (;;) { var a = 2 * i + 1, b = a + 1, m = i, mv = lv; if (a < n && hv[a] < mv) { m = a; mv = hv[a]; } if (b < n && hv[b] < mv) { m = b; } if (m === i) break; hk[i] = hk[m]; hv[i] = hv[m]; i = m; }
        hk[i] = lk; hv[i] = lv;
      }
      return top;
    };
    g[s] = 0; seen[s] = stamp; from[s] = -1; push(s, h(s));
    while (hk.length) {
      var k = pop();
      if (done[k] === stamp) continue;
      done[k] = stamp;
      if (k === t) break;
      var i = k % nx, j = (k - i) / nx;
      for (var d = 0; d < 8; d++) {
        var ii = i + DI[d], jj = j + DJ[d];
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        var q = jj * nx + ii;
        if (done[q] === stamp || !self.cellOk(q, R, dz)) continue;
        if (d >= 4 && (!self.cellOk(j * nx + ii, R, dz) || !self.cellOk(jj * nx + i, R, dz))) continue; // no cutting corners
        var c = clr[q], ng = g[k] + (d >= 4 ? DIAG : CELL) * (1 + (c < SOFT ? (SOFT - c) * 5 : 0));
        if (seen[q] !== stamp || ng < g[q]) { seen[q] = stamp; g[q] = ng; from[q] = k; push(q, ng + h(q)); }
      }
    }
    if (done[t] !== stamp) return null;
    var cells = [];
    for (var k2 = t; k2 >= 0; k2 = from[k2]) cells.push(k2);
    cells.reverse();
    var pts = cells.map(function (k3) { var i3 = k3 % nx; return { x: (i3 + 0.5) * CELL, y: ((k3 - i3) / nx + 0.5) * CELL }; });
    if (this.fits(ax, ay, R - 0.02, discs)) pts[0] = { x: ax, y: ay };
    if (this.fits(bx, by, R, discs)) pts[pts.length - 1] = { x: bx, y: by };
    return this.smooth(pts, dz, R);
  };
  // can a body walk straight from p to q, keeping to the space it had at either end (up to 30 cm from shelves)?
  Nav.prototype.straight = function (p, q, dz, R) {
    var need = Math.max(R, Math.min(0.3, this.clear(p.x, p.y), this.clear(q.x, q.y))) - 0.005;
    var d = Math.hypot(q.x - p.x, q.y - p.y), n = Math.max(1, Math.ceil(d / 0.05));
    for (var i = 1; i < n; i++) {
      var x = p.x + (q.x - p.x) * i / n, y = p.y + (q.y - p.y) * i / n;
      if (this.clear(x, y) < need || inRing(dz, x, y)) return false;
    }
    return true;
  };
  // the grid's zig-zag pulled straight wherever the way is clear
  Nav.prototype.smooth = function (pts, dz, R) {
    if (pts.length <= 2) return pts;
    var out = [pts[0]], a = 0;
    while (a < pts.length - 1) {
      var best = a + 1, misses = 0;
      for (var b = a + 2; b < pts.length; b++) {
        if (this.straight(pts[a], pts[b], dz, R)) { best = b; misses = 0; } else if (++misses > 12) break;
      }
      out.push(pts[best]); a = best;
    }
    return out;
  };
  function pathLength(p, x, y) {
    var L = 0, px = x, py = y;
    for (var i = 0; i < p.length; i++) { L += Math.hypot(p[i].x - px, p[i].y - py); px = p[i].x; py = p[i].y; }
    return L;
  }

  /* ---------- small helpers ---------- */
  function ang(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
  function segDist(px, py, ax, ay, bx, by) {
    var vx = bx - ax, vy = by - ay, L = vx * vx + vy * vy, u = L ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L)) : 0;
    return Math.hypot(px - ax - vx * u, py - ay - vy * u);
  }
  // the pick aisle a point is in (between two rows of racking, past the end of the rows), or null: the centre aisle,
  // the back walkway and the open floor aren't pick aisles
  function aisleAt(world, x, y) {
    var A = world.aisles;
    for (var i = 0; i < A.length; i++) { var a = A[i]; if (x > a.x0 && x < a.x1 && y > a.y0 && y < a.y1) return a; }
    return null;
  }
  // is anyone (other than me) in that aisle?
  function inAisle(world, a, people) {
    for (var i = 0; i < people.length; i++) {
      var p = people[i], r = p.r || 0;
      if (p.x + r > a.x0 && p.x - r < a.x1 && p.y + r > a.y0 && p.y - r < a.y1) return p;
    }
    return null;
  }

  /* ---------- how long things take a person, seconds (each one varies between the two) ---------- */
  var PACE = {
    walk: 1.32,            // metres a second, a steady walk round a warehouse with a scanner in your hand
    turn: 4.6,             // radians a second
    read: [1.0, 2.2],      // reading the scanner when an order comes through
    label: [0.4, 1.0],     // finding the right label on the shelf
    aim: [0.35, 0.75],     // raising the scanner to it
    item: [0.6, 1.2],      // each item off the shelf into the tote
    stock: [0.7, 1.3],     // each item out of a delivery carton onto the shelf
    high: [0.3, 0.8],      // more for each item up on the high shelves
    kneel: [0.55, 0.9],    // getting down for the bottom shelves, or back up
    tote: [0.5, 0.85],     // putting the tote down or picking it up
    grab: [0.8, 1.4],      // taking an empty tote off the stack
    key: [0.16, 0.3],      // one key at the till
    code: [3.5, 7],        // finding a product the customer gave the code for (CrashFix, then copying it)
    describe: [8, 18],     // finding one they described
    need: [12, 28],        // finding one from a sentence of its description
    add: [3, 5],           // switching to Fusion, typing the part number and quantity
    put: [0.8, 1.5],       // putting a bagged order into its OC tote
    reply: [0.6, 1.3],     // the customer answering
    card: [4, 8],          // the customer tapping their card
    cash: [7, 14],         // counting cash, then the change
    give: [0.6, 1.0],      // putting the tote on the counter
    look: [0.5, 1.2]       // standing at the till with nothing to do: how often they check the scanner again
  };
  var SLIP = 1 / 15;       // about one thing in fifteen goes wrong (detailedfoil: "just to slow it down a bit")

  /* ---------- what Sam says ---------- */
  var SAY = {
    greet: ['Hiya, you alright?', 'Morning! What can I do for you?', 'Hi there, how can I help?', 'Alright? What can I get you?'],
    again: ['Sorry, say that again?', 'Sorry, what was the postcode?', "Sorry, didn't catch that."],
    more: ['Anything else?', 'What else can I get you?', 'Got it. Anything else?', 'Lovely. Next one?'],
    total: ["That's {m}, please.", 'That comes to {m}.', '{m} altogether, please.'],
    going: ["Lovely, it'll be out in a minute.", "Cheers, we'll get that picked for you now.", "Right, it's on the pick list. Won't be long."],
    done: ['There you go!', 'Here you go, all done.', 'There you are. Have a good one!', 'All yours, cheers!'],
    excuse: ['Excuse me!', 'Sorry, can I just get past?', 'Just squeezing by, sorry!', 'Scuse me!'],
    queue: ["I'll wait till you're out.", "No rush, I'll wait.", "I'll go down after you."],
    busy: ["Sorry, won't be a moment.", "Sorry about the tote! Just finishing up.", "Thanks for waiting. I'll move it as soon as I'm out.", "Won't be a sec!", 'Two secs, nearly done.', "I'm just in here, won't be long."],
    // the customers (the till's own lines are in till.js, day.js and tillui.js); a right product is never "that's it",
    // which sounds like the end of the order (detailedfoil)
    tillHi: ['Morning! Can I order a few bits?', "Hiya, I'd like to order some stuff.", 'Alright? Need to order a couple of things.', "Hello, I'd like to place an order."],
    kioskHi: ['Morning! Can you sort my order out?', 'Hiya, I need to pay for an order.', 'Alright? Got an order to pay for.', 'Hello, can you put my order through?'],
    right: ["Yes, that's the one!", "Spot on, that's the one.", "That's the one, cheers.", 'Perfect, that one.', 'Yep, that one.'],
    wrong: ["No, that's not it.", 'Not that one, mate.', "No, that's not what I'm after."],
    all: ["That's everything. I'll pay now.", "That's the lot, cheers.", "That's all I need. How much is that?"],
    mine: ["That's the one, yeah.", "Yep, that's mine.", "That's mine, cheers."],
    notMine: ["That's not mine."],
    tap: ['Tapping now.', "There's my card.", 'Contactless OK?'],
    wait: ["Cheers. I'll wait here.", "Lovely, I'll wait over here.", "Thanks, I'll be by the counter."],
    thanks: ['Cheers!', 'Thanks, see you.', 'Nice one, ta.', 'Brilliant, thanks.']
  };
  /* ---------- a worker ---------- */
  // opts: world, World (world.js), Till (till.js), requests (data/requests.json), nav, env, rand, id, name,
  // till (the till they use: a world object), start {x, y, yaw}
  function Bot(o) {
    var self = this;
    this.id = o.id || 1; this.name = o.name || 'Sam';
    this.world = o.world; this.World = o.World; this.Till = o.Till; this.requests = o.requests || null;
    this.nav = o.nav || new Nav(o.world); this.env = o.env || {};
    var r = o.rand || Math.random;
    this.rand = r;
    this.r = BODY;
    this.pace = 0.94 + r() * 0.12;            // some people are a bit quicker than others
    this.walkSpeed = PACE.walk;
    var w = this.world, c = w.counter, t = o.till;
    this.till = t;
    // behind their till, facing the shop; the customer waits across the counter
    var tx = (t.x0 + t.x1) / 2;
    this.post = { x: tx, y: c.y0 - 0.4, yaw: 0, alts: [{ x: tx - 0.45, y: c.y0 - 0.4 }, { x: tx + 0.45, y: c.y0 - 0.42 }, { x: tx, y: c.y0 - 0.85 }] };
    this.custSpot = { x: tx, y: c.y1 + 0.42 };
    var st = w.objects.find(function (x) { return x.kind === 'totes'; });
    this.toteSpot = st ? { x: (st.x0 + st.x1) / 2, y: st.y1 + 0.42, yaw: Math.PI, alts: [{ x: st.x0 - 0.42, y: (st.y0 + st.y1) / 2, yaw: Math.PI / 2 }] } : null;
    var hold = w.holding;
    this.waitSpot = hold ? { x: hold.front + 0.85, y: (hold.y0 + hold.y1) / 2, yaw: -Math.PI / 2 } : this.post;
    var s = o.start || this.waitSpot;
    this.x = s.x; this.y = s.y; this.yaw = s.yaw || 0;
    this.speed = 0; this.moving = false; this.turning = 0;
    this.trolley = { x: this.x + Math.sin(this.yaw) * TROLLEY.ahead, y: this.y + Math.cos(this.yaw) * TROLLEY.ahead, theta: this.yaw, d: TROLLEY.ahead, phi: this.yaw };
    // what the drawing shows
    this.kneeling = false; this.bending = false; this.typing = false; this.reading = false; this.giving = false; this.lookT = 0;
    this.aim = null; this.beam = 0; this.beamTo = null;
    this.carry = null; this.toteDown = false; this.items = []; this.bagMesh = null;
    this.atTill = null;
    // walking
    this.walking = false; this.arrived = true; this.goal = null; this.path = null; this.pi = 0; this.faceYaw = null;
    this.waitT = 0; this.replanT = 0; this.excused = 0; this.noPath = 0; this.altI = -1; this.queue = null; this.others = [];
    // the job in hand: the order they're picking, the till customer they're serving
    this.t = 0; this.sleep = 0; this.until = null; this.order = null; this.cust = null; this.log = []; this.slips = 0; this.jobs = [];
    this.stats = { orders: 0, lines: 0, units: 0, slips: 0, tills: 0, putaway: 0 }; this.busyT = {};
    this.job = this.life();
    void self;
  }

  /* how long something takes this time: lo to hi seconds, usually near the middle, a touch slower or quicker for this person */
  Bot.prototype.T = function (lo, hi) {
    if (Array.isArray(lo)) { hi = lo[1]; lo = lo[0]; }
    var r = this.rand;
    return (lo + (hi - lo) * (r() + r()) / 2) * this.pace;
  };
  Bot.prototype.slip = function () { if (this.rand() < SLIP) { this.slips++; this.stats.slips++; return true; } return false; };
  Bot.prototype.pick = function (list) { return list[Math.floor(this.rand() * list.length)]; };
  Bot.prototype.emit = function (name, a, b, c) { var f = this.env[name]; if (typeof f === 'function') return f.call(this.env, this, a, b, c); return undefined; };
  Bot.prototype.say = function (text) { this.emit('say', 'me', { text: text }); this.log.push({ t: this.t, who: 'me', text: text }); };
  // what a customer says (c: the customer, or the one at the till)
  Bot.prototype.cSay = function (line, c) {
    if (typeof line === 'string') line = { text: line };
    c = c || this.cust;
    this.emit('say', 'cust', line, c); this.log.push({ t: this.t, who: 'cust', text: line.text });
  };

  /* ---------- each frame ---------- */
  Bot.prototype.update = function (dt, others, rate = 1) {
    others = others || [];
    this.others = others;
    this.t += dt;
    dt *= rate;
    if (this.beam > 0) this.beam -= dt;
    if (this.lookT > 0) this.lookT -= dt;
    this.move(dt, others);
    this.moveTrolley(dt);
    this.run(dt);
  };
  // the trolley swings round them (the short way, so never into the shelf they face) and keeps inside the aisle
  Bot.prototype.moveTrolley = function (dt) {
    var t = this.trolley;
    if (!t) return;
    var aisle = aisleAt(this.world, this.x, this.y);
    if (aisle) {
      t.x = aisle.mouth + (aisle.side === 'R' ? 1 : -1) * TROLLEY.wide / 2;
      t.y = aisle.cy; t.phi = 0;
      return;
    }
    var parked = !this.walking || !!(this.queue && this.queue.there);
    var wantT = parked ? this.yaw + Math.PI : this.yaw, wantD = parked ? TROLLEY.behind : TROLLEY.ahead, wantF = parked ? this.yaw + Math.PI / 2 : this.yaw;
    var k = Math.min(1, dt * 5);
    t.theta = ang(t.theta + ang(wantT - t.theta) * k);
    t.d += (wantD - t.d) * k;
    var df = ang(wantF - t.phi);
    if (df > Math.PI / 2) df -= Math.PI; else if (df < -Math.PI / 2) df += Math.PI; // a box looks the same turned round
    t.phi = ang(t.phi + df * k);
    t.x = this.x + Math.sin(t.theta) * t.d; t.y = this.y + Math.cos(t.theta) * t.d;
  };
  // the job is a list of steps written as a generator: each step hands back how long to wait (seconds), or a test to
  // wait for (a function), or nothing for "next frame"
  Bot.prototype.run = function (dt) {
    if (this.sleep > 0) { this.sleep -= dt; if (this.sleep > 0) return; }
    if (this.until) { if (!this.until()) return; this.until = null; }
    for (var n = 0; n < 40; n++) {
      var r = this.job.next();
      if (r.done) { this.job = this.life(); return; }
      var v = r.value;
      if (typeof v === 'number') { if (v > 0) { this.sleep = v; return; } }
      else if (typeof v === 'function') { if (!v()) { this.until = v; return; } }
      else return;
    }
  };

  /* ---------- walking ---------- */
  Bot.prototype.goTo = function (spot) {
    this.goal = spot; this.path = null; this.pi = 0; this.arrived = false; this.walking = true;
    this.waitT = 0; this.replanT = 0; this.excused = 0; this.noPath = 0; this.altI = -1; this.faceYaw = null; this.queue = null;
    this.atTill = null;
  };
  Bot.prototype.turnTo = function (want, dt, rate) {
    var d = ang(want - this.yaw), m = (rate || PACE.turn) * dt;
    var step = Math.max(-m, Math.min(m, d));
    this.yaw = ang(this.yaw + step);
    this.turning = Math.abs(step) / Math.max(1e-6, dt);
    return Math.abs(d - step) < 0.01;
  };
  Bot.prototype.brake = function (dt) { this.speed = Math.max(0, this.speed - 5 * dt); };
  // the one in the way (if any): someone on the next metre of the way, or close by and in the direction I'm going.
  // Stepping sideways or away from someone is never blocked (hits() stops anyone getting too close).
  Bot.prototype.blocker = function (others, tx, ty) {
    var best = null, bd = Infinity, hx = tx - this.x, hy = ty - this.y, hl = Math.hypot(hx, hy) || 1;
    var ex = this.x + hx / hl * Math.min(1.0, hl), ey = this.y + hy / hl * Math.min(1.0, hl);
    for (var i = 0; i < others.length; i++) {
      var o = others[i], dx = o.x - this.x, dy = o.y - this.y, d = Math.hypot(dx, dy), gap = d - this.r - (o.r || BODY);
      if (gap > 0.9) continue;
      var facing = (dx * hx + dy * hy) / (hl * (d || 1));
      var onWay = segDist(o.x, o.y, this.x, this.y, ex, ey) < this.r + (o.r || BODY) + 0.06;
      if (facing > 0.35 && (onWay || gap < 0.12)) { if (d < bd) { bd = d; best = o; } }
    }
    return best;
  };
  Bot.prototype.hits = function (x, y, others) {
    for (var i = 0; i < others.length; i++) {
      var o = others[i], lim = this.r + (o.r || BODY) + 0.02, dn = Math.hypot(x - o.x, y - o.y);
      if (dn < lim && dn < Math.hypot(this.x - o.x, this.y - o.y)) return true;
    }
    return false;
  };
  // a step (sx, sy) that keeps clear of shelves and people; brushing past someone it slides round them -> [x, y] or null
  Bot.prototype.tryStep = function (sx, sy, others) {
    var nx = this.x + sx, ny = this.y + sy;
    if (this.nav.clear(nx, ny) >= this.r - 0.03 && !this.hits(nx, ny, others)) return [nx, ny];
    var slid = false;
    for (var i = 0; i < others.length; i++) {
      var o = others[i], dx = o.x - this.x, dy = o.y - this.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
      if (d > this.r + (o.r || BODY) + 0.08) continue;
      var dot = sx * ux + sy * uy;
      if (dot > 0) { sx -= (dot + 0.002) * ux; sy -= (dot + 0.002) * uy; slid = true; }
    }
    if (!slid) return null;
    nx = this.x + sx; ny = this.y + sy;
    return this.nav.clear(nx, ny) >= this.r - 0.03 && !this.hits(nx, ny, others) ? [nx, ny] : null;
  };
  Bot.prototype.where = function () { return this.altI >= 0 && this.goal.alts ? this.goal.alts[this.altI] : this.goal; };
  // the next of the goal's other spots a body fits in (someone's standing on this one)
  Bot.prototype.nextAlt = function (others) {
    var alts = this.goal.alts || [];
    for (var i = this.altI + 1; i < alts.length; i++) {
      if (this.nav.fits(alts[i].x, alts[i].y, this.r, others)) { this.altI = i; this.path = null; this.replanT = 0; return true; }
    }
    return false;
  };
  Bot.prototype.move = function (dt, others) {
    this.moving = false; this.turning = 0;
    if (!this.walking) {
      this.brake(dt);
      if (this.faceYaw !== null) this.turnTo(this.faceYaw, dt, PACE.turn * 0.85);
      return;
    }
    // waiting for someone to come out of the aisle I'm going down
    var q = this.queue;
    if (q) {
      q.t += dt;
      var who = inAisle(this.world, q.aisle, others);
      if (who) {
        if (!q.there) { if (this.follow(dt, others, q.spot) === 'arrived') { q.there = true; this.path = null; } }
        else { this.brake(dt); this.turnTo(q.yaw, dt, PACE.turn * 0.8); }
        if (q.t > 4.5 && !q.said && (who.human || who.id <= 0)) { q.said = true; this.say(this.pick(SAY.queue)); }
        return;
      }
      this.queue = null; this.path = null; this.replanT = 0; this.waitT = 0; // they're out: my turn
    }
    var goal = this.where();
    if (this.follow(dt, others, goal) === 'arrived') {
      this.walking = false; this.arrived = true; this.speed = 0; this.path = null;
      this.faceYaw = goal.yaw !== undefined ? goal.yaw : this.goal.yaw !== undefined ? this.goal.yaw : null;
    }
  };
  // a step along the path to `goal`: 'arrived', 'moving' or 'wait'
  Bot.prototype.follow = function (dt, others, goal) {
    var w = this.world;
    if (!this.path) {
      this.replanT -= dt;
      if (this.replanT > 0) return 'wait';
      this.path = this.nav.find(this.x, this.y, goal.x, goal.y, null, this.r);
      this.pi = 1; this.replanT = 0.5;
      if (!this.path) { if (!this.queue && ++this.noPath > 4 && !this.nextAlt(others)) this.noPath = 0; return 'wait'; }
      this.noPath = 0;
    }
    if (this.pi >= this.path.length) this.pi = this.path.length - 1;
    var tgt = this.path[this.pi], last = this.pi === this.path.length - 1;
    var dx = tgt.x - this.x, dy = tgt.y - this.y, d = Math.hypot(dx, dy);
    while (!last && d < 0.2) { this.pi++; tgt = this.path[this.pi]; last = this.pi === this.path.length - 1; dx = tgt.x - this.x; dy = tgt.y - this.y; d = Math.hypot(dx, dy); }
    if (last && d < 0.03) return 'arrived';
    // one person to an aisle: look down it on the way, and wait by the end if someone's in there
    if (!this.queue) {
      var here = aisleAt(w, this.x, this.y);
      for (var i = this.pi; i < this.path.length; i++) {
        var a = aisleAt(w, this.path[i].x, this.path[i].y);
        if (!a || a === here) continue;
        if (Math.hypot(this.x - a.mouth, this.y - a.cy) < 1.9) { var who = inAisle(w, a, others); if (who) { this.startQueue(a, others); return 'wait'; } }
        break;
      }
    }
    var want = Math.atan2(dx, dy), err = Math.abs(ang(want - this.yaw));
    this.turnTo(want, dt);
    var top = this.walkSpeed * (this.carry && this.items.length > 2 ? 0.95 : 1);
    top *= err > 1.3 ? 0 : err > 0.55 ? 0.45 : 1;
    if (last) top = Math.min(top, Math.max(0.18, Math.sqrt(2 * 1.5 * d)));
    // someone in the way?
    var o = this.blocker(others, tgt.x, tgt.y);
    if (o) {
      this.waitT += dt;
      if (this.avoid(dt, o, others, goal)) { // a way round: carry on along it
        tgt = this.path[this.pi]; dx = tgt.x - this.x; dy = tgt.y - this.y; d = Math.hypot(dx, dy) || 1e-6;
        o = this.blocker(others, tgt.x, tgt.y);
      }
      if (o) { top = 0; this.stuck(o, others, goal); if (!this.path) return 'wait'; }
    } else { this.waitT = Math.max(0, this.waitT - 2 * dt); if (this.excused && this.t - this.excused > 6) this.excused = 0; }
    var acc = top > this.speed ? 2.4 : 5;
    this.speed += Math.sign(top - this.speed) * Math.min(Math.abs(top - this.speed), acc * dt);
    if (this.speed < 0.001) return 'wait';
    var step = Math.min(this.speed * dt, d), hx = Math.sin(this.yaw), hy = Math.cos(this.yaw);
    // along the way I'm facing; if that's too wide round a corner, straight at the point instead
    var to = this.tryStep(hx * step, hy * step, others) || this.tryStep(dx / d * step, dy / d * step, others);
    if (!to) { this.speed = 0; return 'wait'; }
    var nx = to[0], ny = to[1];
    // never step into an aisle someone else is in (they might have just gone in)
    var into = aisleAt(w, nx, ny);
    if (into && into !== aisleAt(w, this.x, this.y) && inAisle(w, into, others)) {
      this.speed = 0;
      if (!this.queue) this.startQueue(into, others);
      return 'wait';
    }
    this.x = nx; this.y = ny; this.moving = true;
    return 'moving';
  };
  // wait by the end of the aisle, to one side of the way out, where whoever's in there can see me
  Bot.prototype.startQueue = function (a, others) {
    var self = this, mx = a.side === 'R' ? a.x0 - 0.95 : a.x1 + 0.95;
    var spots = [{ x: mx, y: a.cy - 0.85 }, { x: mx, y: a.cy + 0.85 }];
    spots.sort(function (p, s) { return Math.hypot(p.x - self.x, p.y - self.y) - Math.hypot(s.x - self.x, s.y - self.y); });
    var spot = spots.filter(function (p) { return self.nav.fits(p.x, p.y, self.r, others); })[0] || { x: this.x, y: this.y };
    this.queue = { aisle: a, spot: spot, t: 0, there: false, said: false, yaw: Math.atan2(a.mouth - spot.x, a.cy - spot.y) };
    this.path = null; this.replanT = 0; this.waitT = 0;
  };
  // someone's in the way in the open: after a moment, go round them if there's room (true: a new way round)
  Bot.prototype.avoid = function (dt, o, others, goal) {
    this.replanT -= dt;
    if (this.waitT < 0.5 || this.replanT > 0) return false;
    this.replanT = 1.2;
    var p = this.nav.find(this.x, this.y, goal.x, goal.y, [{ x: o.x, y: o.y, r: (o.r || BODY) + 0.12 }], this.r);
    var plain = this.path ? pathLength(this.path.slice(this.pi), this.x, this.y) : 0;
    if (!p || p.length < 2 || pathLength(p, this.x, this.y) > plain * 1.7 + 4) return false;
    this.path = p; this.pi = 1;
    return true;
  };
  // still in the way: if they're standing where I'm going, somewhere else does just as well; and say excuse me
  Bot.prototype.stuck = function (o, others, goal) {
    if (this.waitT > 2.2 && !this.queue && Math.hypot(o.x - goal.x, o.y - goal.y) < this.r + (o.r || BODY) + 0.25 && this.nextAlt(others)) { this.waitT = 0; return; }
    if (this.waitT > 1.4 && !this.excused) { this.excused = this.t; this.say(this.pick(SAY.excuse)); }
  };
  // you tried to walk into the aisle I'm in
  Bot.prototype.sayBusy = function () {
    if (this.t - (this.busySaid || -99) < 9) return;
    this.busySaid = this.t; this.say(this.pick(SAY.busy));
  };
  Bot.prototype.walkTo = function* (spot) {
    this.goTo(spot);
    var self = this;
    yield function () { return self.arrived; };
    if (this.faceYaw !== null) yield* this.face(this.faceYaw);
  };
  Bot.prototype.face = function* (yaw) {
    this.faceYaw = yaw;
    var self = this;
    yield function () { return Math.abs(ang(self.faceYaw - self.yaw)) < 0.04; };
  };

  /* ---------- where to stand ---------- */
  // in the aisle in front of a location, facing it: half a metre out, a bit further for the high shelves
  Bot.prototype.standFor = function (loc) {
    var f = loc.face, a = f.aisle, cx = (loc.x0 + loc.x1) / 2, low = loc.z0 < 0.45;
    var out = low ? 0.5 : loc.z0 > 1.9 ? 0.62 : 0.52, lo = a.x0 + 0.32, hi = a.x1 - 0.32;
    var x = Math.max(lo, Math.min(hi, cx)), y = f.front + f.out * out, yaw = f.out > 0 ? Math.PI : 0;
    var alts = [];
    [0.35, -0.35, 0.7, -0.7].forEach(function (dx) { var ax = x + dx; if (ax > lo && ax < hi) alts.push({ x: ax, y: y }); });
    alts.push({ x: x, y: f.front + f.out * (out + 0.18) });
    return { x: x, y: y, yaw: yaw, alts: alts };
  };
  // the label to aim the scanner at: on the shelf edge, or the front of the tray
  function labelAt(loc) {
    var f = loc.face;
    return { x: (loc.x0 + loc.x1) / 2, y: f.front + f.out * 0.012, z: loc.tray >= 0 ? loc.z0 + 0.05 : Math.max(0.04, loc.z0 - 0.035) };
  }
  // the location next to it on the same shelf (for a wrong scan)
  function nextTo(world, loc, r) {
    var sh = loc.shelf, n = sh.tray ? sh.trays : sh.cells;
    var c = loc.cell + ((loc.cell + 1 < n && (loc.cell === 0 || r() < 0.5)) ? 1 : -1);
    return world.locs.byCode[loc.face.area + '-' + pad2(loc.bay.no) + '-' + pad2(sh.no) + '-' + pad2(c * sh.deep + 1)] || null;
  }
  Bot.prototype.holdStand = function (code) {
    var h = this.world.holding, sp = h.spots.find(function (s) { return s.code === code; });
    var y = (sp.y0 + sp.y1) / 2;
    return { spot: sp, at: { x: h.front + 0.5, y: y, yaw: -Math.PI / 2, alts: [{ x: h.front + 0.5, y: y + 0.3 }, { x: h.front + 0.5, y: y - 0.3 }, { x: h.front + 0.75, y: y }] } };
  };

  /* ---------- the shift: whatever needs doing most, one job after another ---------- */
  Bot.prototype.life = function* () {
    for (;;) {
      var job = this.choose();
      if (!job) {
        var standTill = this.emit('standTill'), spot = standTill ? this.post : this.waitSpot;
        if (Math.hypot(this.x - spot.x, this.y - spot.y) >= 0.6) yield* this.walkTo(spot);
        this.atTill = standTill && this.atPost() ? this.till : null;
        if (Math.abs(ang(this.yaw - spot.yaw)) > 0.05) yield* this.face(spot.yaw);
        yield this.T(PACE.look);
        continue;
      }
      if (job.greet) { // say hello from the till: he has to be there first (detailedfoil, 21 Nov 2026)
        if (!this.atPost()) yield* this.walkTo(this.post);
        this.atTill = this.till;
        this.say(this.pick(SAY.greet));
        yield this.T(0.5, 1.1);
        this.emit('greet', job.greet);
        yield this.T(0.3, 0.7);
        continue;
      }
      this.jobs.push(job.serve ? 'serve' : job.putaway ? 'putaway' : job.pick.kind);
      var t0 = this.t;
      if (job.serve) yield* this.serveTill(job.serve);
      else if (job.putaway) yield* this.putawayRun();
      else yield* this.doOrder(job.pick);
      yield this.T(0.5, 1.1);
      if (job.cat) this.busyT[job.cat] = (this.busyT[job.cat] || 0) + this.t - t0; // time spent on each kind of job
      continue;
    }
  };
  Bot.prototype.atPost = function () {
    var p = this.post;
    return Math.hypot(this.x - p.x, this.y - p.y) < 0.6 && !this.walking;
  };
  // The Manager PC supplies enabled jobs in priority order. Greetings and service-bell calls take precedence.
  var PRIO = ['queue', 'cust', 'hold', 'delivery'];
  Bot.prototype.choose = function () {
    var b = this.emit('board') || {}, orders = b.orders || [], queue = b.queue || [], prio = b.prio || PRIO;
    if (b.greet?.length) return { greet: b.greet[0] };
    if (b.bell && b.bell.length) return { serve: b.bell[0], cat: 'queue' };
    for (const job of prio) {
      if (job === 'queue') {
        if (queue.length) return { serve: queue[0], cat: 'queue' };
      } else if (job === 'delivery') {
        if (b.delivery > 0) return { putaway: true, cat: 'delivery' };
      } else {
        const matches = o => job === (o.kind === 'c' ? 'hold' : 'cust');
        const order = orders.find(matches);
        if (order) return { pick: order, cat: job };
        if (b.early?.some(matches)) return null; // Give players first claim before starting a lower priority job.
      }
    }
    return null;
  };

  /* ---------- an order off the list: picked, then to its customer or into the holding area ---------- */
  Bot.prototype.doOrder = function* (o) {
    if (!this.emit('take', o)) return; // someone got there first
    this.order = o;
    var t0 = this.t, s0 = this.slips;
    yield* this.readScanner();
    if (o.kind === 'hold') yield* this.fetchHold(o);
    else {
      yield* this.pickRun(o.lines);
      this.emit('picked', o);
      if (!o.cust) yield* this.putAway(o);
    }
    if (o.status !== 'done') yield* this.handOver(o);
    this.log.push({ t: this.t, done: o.kind, no: o.no, lines: o.lines.length || 1, took: this.t - t0, slips: this.slips - s0 });
    this.order = null;
  };
  // the label on the front of an OC spot: on its tote, or on the shelf edge
  function ocFront(s) { return { x: s.x1 + 0.01, y: (s.y0 + s.y1) / 2, z: s.kind === 'tote' ? s.z0 + 0.2 : s.kind === 'floor' ? 0.1 : s.z0 - 0.035 }; }
  // a bag from the holding area, for a customer at the counter
  Bot.prototype.fetchHold = function* (o) {
    var code = o.hold.code, hs = this.holdStand(code), sp = hs.spot;
    yield* this.walkTo(hs.at);
    var low = sp.z0 < 0.4;
    if (low) yield* this.kneelDown(true);
    yield this.T(PACE.label);
    if (sp.kind === 'tote' && this.slip()) { // the tote next to it first
      var near = this.world.holding.spots.filter(function (s) { return s.kind === 'tote' && s.z0 === sp.z0 && s.code !== code; });
      near.sort(function (a, b) { return Math.abs(a.y0 - sp.y0) - Math.abs(b.y0 - sp.y0); });
      if (near[0]) yield* this.scan(ocFront(near[0]), false);
    }
    yield* this.scan(ocFront(sp), true);
    yield this.T(0.5, 1.0);
    this.bagMesh = this.emit('holdTake', o) || true;
    this.carry = sp.kind === 'tote' ? 'bag' : 'box';
    yield this.T(0.6, 1.1);
    this.aim = null;
    if (low) yield* this.kneelDown(false);
  };
  // a c pick into an empty OC spot, or to the counter if its customer walks in meanwhile
  Bot.prototype.putAway = function* (o) {
    var h = this.world.holding, self = this;
    if (!h) return;
    yield* this.walkTo({ x: h.front + 1.0, y: (h.y0 + h.y1) / 2, yaw: -Math.PI / 2 });
    // the nearest empty spot, a tote rather than the big items bay
    var near = function (s) { return Math.hypot(s.at.x - self.x, s.at.y - self.y) + (s.spot.kind === 'tote' ? 0 : 1.5); };
    var code = null, guard = 0;
    while (!code) {
      if (o.cust) return;
      var free = (this.emit('holdFree') || []).map(function (k) { return self.holdStand(k); });
      free.sort(function (a, b) { return near(a) - near(b); });
      for (var i = 0; i < free.length && !code; i++) if (this.emit('reserve', free[i].spot.code)) code = free[i].spot.code;
      if (!code) { if (++guard > 90) return; yield this.T(2, 4); } // full: wait for someone to collect
    }
    var hs = this.holdStand(code), sp = hs.spot;
    yield* this.walkTo(hs.at);
    if (o.cust) { this.emit('unreserve', code); return; }
    var low = sp.z0 < 0.4;
    if (low) yield* this.kneelDown(true);
    yield this.T(PACE.label);
    yield* this.scan(ocFront(sp), true);
    yield this.T(PACE.put);
    this.aim = null;
    if (o.cust) { this.emit('unreserve', code); if (low) yield* this.kneelDown(false); return; }
    this.emit('putAway', o, code);
    this.carry = null; this.items = []; this.toteDown = false;
    this.stats.orders++;
    yield this.T(0.3, 0.6);
    if (low) yield* this.kneelDown(false);
  };

  /* ---------- the next customer at the till: their order (or kiosk order) paid for, then onto the list ---------- */
  Bot.prototype.serveTill = function* (c) {
    if (!this.atPost()) yield* this.walkTo(this.post);
    this.atTill = this.till;
    yield* this.face(0);
    if (!this.emit('serve', c)) return; // someone else is serving them
    this.cust = c;
    yield function () { return c.ready || c.state !== 'serving'; }; // walking over to this till
    if (c.state === 'serving') {
      yield this.T(0.4, 1.1);
      yield* this.tillOrder(c);
      this.stats.tills++;
    }
    this.cust = null;
  };
  Bot.prototype.typeIn = function* (text) {
    this.typing = true;
    yield String(text).length * this.T(PACE.key) + this.T(0.3, 0.7);
    this.typing = false;
  };
  Bot.prototype.tillOrder = function* (c) {
    var Till = this.Till, cu = c.cust, kiosk = c.kind === 'kiosk', t0 = this.t, s0 = this.slips;
    var lines = kiosk ? c.kiosk.list[c.kiosk.mine].lines : c.lines;
    if (!c.greeter) { this.say(this.pick(SAY.greet)); yield this.T(0.8, 1.5); }
    this.cSay(c.say || this.pick(kiosk ? SAY.kioskHi : SAY.tillHi));
    yield this.T(1.0, 1.8);
    this.cSay("Surname's " + cu.surname + '.');
    yield this.T(0.4, 0.8);
    yield* this.typeIn(cu.surname);
    yield this.T(0.6, 1.2);
    this.cSay("Postcode's " + cu.postcode + '.');
    yield this.T(0.4, 0.8);
    yield* this.typeIn(cu.postcode);
    if (this.slip()) { // didn't catch it
      this.say(this.pick(SAY.again));
      yield this.T(PACE.reply);
      this.cSay("It's " + cu.postcode + '.');
      yield* this.typeIn(cu.postcode);
    }
    yield this.T(0.8, 1.6); // the search, then finding them in the results
    this.cSay(cu.third.say); // the third detail, after the search
    yield this.T(0.8, 1.6);
    yield this.T(0.8, 1.6); // select
    if (kiosk) {
      this.cSay(c.kiosk.say);
      yield this.T(1.6, 2.6);
      this.cSay(c.kiosk.sayName);
      yield this.T(1.0, 2.0);  // Kiosk Orders
      yield this.T(2.0, 5.0);  // finding their name in the list
      if (this.slip()) { yield this.T(0.8, 1.4); this.cSay(this.pick(SAY.notMine) + ' ' + c.kiosk.sayName); yield this.T(2.0, 4.0); }
      this.cSay(this.pick(SAY.mine));
      const floor = lines.find(l => l.floor);
      if (floor) { this.cSay(floor.say); yield 1; this.emit('sfx', 'scan'); yield 1; }
      yield this.T(1.0, 2.0);
    } else {
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i], find = PACE[ln.kind] || PACE.describe;
        if (ln.floor) { this.cSay(ln.say); yield 1; this.emit('sfx', 'scan'); yield 1; continue; }
        if (i) { this.say(this.pick(SAY.more)); yield this.T(PACE.reply); }
        this.cSay({ text: ((ln.next ? ln.next + ' ' : '') + ln.say).trim(), quote: ln.quote, hint: ln.hint, qty: ln.qtySay });
        yield this.T(find); // found on CrashFix, its code copied: the customer says straight away if it's right
        if (this.slip()) { // the wrong one first
          this.cSay(this.pick(SAY.wrong));
          yield this.T(find[0] * 0.6, find[1] * 0.6);
        }
        if (!ln.shortage) this.cSay(this.pick(SAY.right));
        yield this.T(PACE.add); // then into Fusion
        yield this.T(0.3, 0.8);
      }
      if (!lines.some(l => l.shortage)) this.cSay(this.pick(SAY.all));
      yield this.T(1.0, 1.8);
    }
    // Pay & Go
    var shortage = lines.find(l => l.shortage);
    if (shortage) {
      this.say("We've got none of " + shortage.item.code + " today.");
      yield this.T(PACE.reply);
      this.cSay(shortage.reply);
      yield this.T(PACE.add);
    }
    var paidLines = lines.filter(l => l.shortage !== 'decline');
    var total = paidLines.reduce(function (s, l) { return s + Till.price(l.item) * l.qty; }, 0);
    yield this.T(1.0, 2.0);
    this.say(this.pick(SAY.total).replace('{m}', Till.money(total)));
    yield this.T(PACE.reply);
    this.cSay(c.pay.say);
    yield this.T(0.8, 1.5);
    if (c.pay.how === 'card') {
      this.cSay(this.pick(SAY.tap));
      yield this.T(PACE.card);
      this.emit('sfx', 'approved');
      yield this.T(1.5, 3.0);
    } else {
      yield this.T(PACE.cash[0] * 0.5, PACE.cash[1] * 0.5);
      this.cSay(c.pay.exact ? 'Exact money: ' + Till.money(total) + '.' : "There's " + Till.money(Till.tender(total, c.pay)) + '.');
      yield this.T(PACE.cash[0] * 0.5, PACE.cash[1] * 0.5);
      this.emit('sfx', 'drawer');
      yield this.T(1.5, 3.0);
    }
    // paid for: onto the pick list, for whoever gets to it first
    this.emit('tillDone', c, paidLines);
    this.say(this.pick(SAY.going));
    yield this.T(0.6, 1.2);
    this.cSay(this.pick(SAY.wait), c);
    this.log.push({ t: this.t, done: 'till', kind: c.kind, took: this.t - t0, slips: this.slips - s0 });
  };

  /* ---------- picking: each line in location order, into the top tote on the trolley ---------- */
  Bot.prototype.readScanner = function* () {
    this.reading = true;
    yield this.T(PACE.read);
    this.reading = false;
  };
  Bot.prototype.kneelDown = function* (down) {
    if (this.kneeling === down) return;
    this.kneeling = down;
    yield this.T(PACE.kneel);
  };
  Bot.prototype.scan = function* (p, right) {
    this.aim = p;
    yield this.T(PACE.aim);
    this.beam = 0.16; this.beamTo = p;
    this.emit('sfx', right ? 'scan' : 'bad', p);
    yield right ? 0.25 : this.T(1.2, 2.4);
  };
  Bot.prototype.pickRun = function* (lines) {
    var w = this.world, self = this;
    lines = lines.map(function (l) { return { item: l.item, loc: l.item.loc, qty: l.qty }; }).filter(function (l) { return l.loc; });
    lines.sort(function (a, b) { return a.loc.order - b.loc.order; });
    this.items = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i], loc = ln.loc, a = loc.face.aisle;
      if (this.slip()) { // into the aisle next door, then a look round
        var wrong = w.aisles.filter(function (x) { return x.side === a.side && Math.abs(x.no - a.no) === 1; })[0];
        if (wrong && !inAisle(w, wrong, this.others)) {
          yield* this.walkTo({ x: wrong.side === 'R' ? wrong.x0 + 1.6 : wrong.x1 - 1.6, y: wrong.cy });
          this.lookT = this.T(1.2, 2.2);
          yield this.lookT;
        }
      }
      yield* this.walkTo(this.standFor(loc));
      var low = loc.z0 < 0.45, high = loc.z0 > 1.9;
      if (low) yield* this.kneelDown(true);
      yield this.T(PACE.label);
      if (this.slip()) { var n = nextTo(w, loc, this.rand); if (n) yield* this.scan(labelAt(n), false); }
      yield* this.scan(labelAt(loc), true);
      this.emit('open', loc);
      var extra = ln.qty < 6 && this.slip() ? 1 : 0;
      for (var k = 0; k < ln.qty + extra; k++) {
        yield this.T(PACE.item) + (high ? this.T(PACE.high) : 0);
        if (k) { this.beam = 0.12; this.beamTo = labelAt(loc); this.emit('sfx', 'scan', this.beamTo); }
      }
      if (extra) { yield this.T(0.9, 1.6); } // one too many: one goes back
      this.items.push(ln.item.colour);
      this.emit('toteAdd', ln);
      this.stats.lines++; this.stats.units += ln.qty;
      yield this.T(0.3, 0.6);
      this.emit('close', loc);
      this.aim = null;
      if (low) yield* this.kneelDown(false);
    }
    void self;
  };

  /* ---------- the hand over: at their till; the customer comes over from where they're waiting ---------- */
  Bot.prototype.handOver = function* (o) {
    yield* this.walkTo(this.post);
    this.atTill = this.till;
    this.giving = true;
    yield this.T(PACE.give);
    this.emit('handOver', o);
    this.carry = null; this.items = []; this.bagMesh = null; this.toteDown = false;
    this.say(this.pick(SAY.done));
    yield this.T(0.4, 0.8);
    this.giving = false;
    this.stats.orders++;
    yield this.T(0.6, 1.2);
    if (o.cust) this.cSay(this.pick(SAY.thanks), o.cust);
  };

  /* ---------- the delivery: a carton off a roll cage or pallet at goods in, onto its shelf ---------- */
  Bot.prototype.putawayRun = function* () {
    var self = this, w = this.world, srcs = this.emit('paSources') || [];
    if (!srcs.length) return;
    // the nearest cage or pallet with cartons on it
    srcs.sort(function (a, b) { var ga = w.goodsin[a], gb = w.goodsin[b]; return Math.hypot(ga.stand.x - self.x, ga.stand.y - self.y) - Math.hypot(gb.stand.x - self.x, gb.stand.y - self.y); });
    var g = w.goodsin[srcs[0]];
    yield* this.walkTo(g.stand);
    yield this.T(PACE.label);
    var d = this.emit('paTake', g.i);
    if (!d) return; // someone took the last one
    var sl = g.slots[d.slot], low = sl.z0 < 0.4;
    if (low) yield* this.kneelDown(true);
    yield* this.scan({ x: (sl.x0 + sl.x1) / 2, y: sl.y0, z: (sl.z0 + sl.z1) / 2 }, true);
    yield this.T(0.8, 1.4); // lifting it off
    this.aim = null; this.carry = 'box';
    if (low) yield* this.kneelDown(false);
    yield* this.readScanner();
    var loc = d.loc, lowS = loc.z0 < 0.45, high = loc.z0 > 1.9;
    yield* this.walkTo(this.standFor(loc));
    if (lowS) yield* this.kneelDown(true);
    yield this.T(PACE.label);
    if (this.slip()) { var n = nextTo(w, loc, this.rand); if (n) yield* this.scan(labelAt(n), false); }
    yield* this.scan(labelAt(loc), true);
    this.emit('open', loc);
    for (var k = 0; k < d.qty; k++) yield this.T(PACE.stock) + (high ? this.T(PACE.high) : 0);
    this.carry = null;
    this.emit('paPut', d);
    this.stats.putaway++;
    yield this.T(0.4, 0.8); // flattening the empty carton
    this.emit('close', loc);
    this.aim = null;
    if (lowS) yield* this.kneelDown(false);
  };

  function create(o) { return new Bot(o); }

  var api = { Nav: Nav, create: create, Bot: Bot, aisleAt: aisleAt, inAisle: inAisle, PACE: PACE, SLIP: SLIP, BODY: BODY, CELL: CELL, labelAt: labelAt, nextTo: nextTo, ocFront: ocFront, pathLength: pathLength, TROLLEY: TROLLEY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShiftBot = api;
})(typeof window !== 'undefined' ? window : this);
