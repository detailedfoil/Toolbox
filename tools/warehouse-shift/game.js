/* Warehouse Shift (Dunstable, LB1 only): a picking game in a made-up Screwfix-style warehouse.

   The day's work is one pick list on the scanner (day.js), shared with Sam (bot.js). The scanner is drawn like the
   Symbol handsets in detailedfoil's photos: Today Picking, ORDER, a > by the order you're on, Select_. Each order is A
   and four numbers, how many locations and items (2:3), then CK (a click and collect customer is at the counter), c
   (nobody's here: it goes in the holding area) or nothing (bought at the till; the customer's waiting). Up and down
   choose, Enter starts it, and there's no backing out ("Finish task"). Walk to each location, look at it and Scan (or
   tap it) once for each item; when they're all scanned, Enter moves you on to the next location. Then the tote goes
   to the counter, where its customer comes over for it, or a c pick goes into any empty OC spot in the holding area
   (scan its label). Customers come to the trade counter: a click and collect goes on the list as a CK (or is fetched
   from the holding area, if it's there); a till customer is served at a till (tillui.js: Fusion and CrashFix), then
   waits by the gap at the end of the counter while anyone picks their order. A day is 20 picks, and ends when they're
   all done and nobody's waiting. Hint makes the location glow; squat for the bottom shelves. Played mainly with the
   phone sideways: left thumb walks, drag to look. On a computer: WASD, mouse look.

   Sam (bot.js) works from the same list, pushing a trolley that blocks the aisle while they pick. On a computer two
   people can play at once: split screen, one above the other, each with their own scanner, till and controls (a
   controller each, or one on the keyboard and mouse).

   world.js makes the warehouse, day.js the day's orders and customers, scene.js draws it, till.js and tillui.js are
   the till, bot.js is Sam. This file is the rest: the shared things (customers walking about, totes going over the
   counter, Sam's part in the world, the sounds) and each player's own (camera, controls, scanner, till). */
(function () {
  'use strict';

  const STORE = 'LB1';
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), canvas = $('view');
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

  function signedInAs() { try { return (localStorage.getItem('toolbox.signedIn.area20') || '').toUpperCase(); } catch (e) { return ''; } }
  function fail(text) { $('loading').hidden = true; $('msgText').textContent = text; $('msg').hidden = false; }
  function progress(frac, text) { $('loadBar').style.width = Math.round(frac * 100) + '%'; if (text) $('loadText').textContent = text; }
  const breathe = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  let booted = false;
  function boot() {
    if (booted) return;
    const me = signedInAs();
    if (!me) return; // the sign-in screen is up; its "toolbox:login" event brings us back here
    booted = true;
    if (me !== STORE) { fail('Warehouse Shift is only for Dunstable (LB1).'); return; }
    if (!window.THREE || !window.ShiftWorld || !window.ShiftScene || !window.ShiftTill || !window.ShiftTillUI || !window.ShiftBot || !window.ShiftDay) { fail("The game didn't load. Check your signal and reload the page."); return; }
    progress(0.1, 'Loading the products…');
    // what till customers ask for: without it every till customer has a kiosk order
    const asks = fetch('warehouse-shift/data/requests.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    fetch('warehouse-shift/data/catalogue.json')
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(async (cat) => {
        progress(0.35, 'Stocking the shelves…'); await breathe();
        const req = await asks;
        try { await start(cat, req); } catch (e) { console.error(e); fail('Something went wrong building the warehouse. Reload the page to try again.'); }
      })
      .catch((e) => { console.error(e); fail("Couldn't load the products. Check your signal and reload the page."); });
  }
  window.addEventListener('toolbox:login', boot);
  boot();

  async function start(cat, requests) {
    const T = THREE, World = window.ShiftWorld, Till = window.ShiftTill, Day = window.ShiftDay, Crew = window.ShiftBot;
    const world = World.build(cat);
    progress(0.5, 'Building the racking…'); await breathe();

    /* ---------- renderer ---------- */
    let renderer;
    try { renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
    catch (e) { fail("This phone or browser can't show 3D graphics (WebGL is switched off)."); return; }
    const MAX_DPR = Math.min(window.devicePixelRatio || 1, touch ? 1.75 : 2);
    let dpr = Math.min(MAX_DPR, touch ? 1.5 : 2);
    renderer.setPixelRatio(dpr);
    let dirty = true;
    const lowMemory = !!(navigator.deviceMemory && navigator.deviceMemory < 4); // a 4096 px photo texture is 64 MB
    const S = window.ShiftScene.build(T, world, renderer, { onChange: () => { dirty = true; }, smallAtlas: lowMemory });
    const scene = S.scene;
    progress(0.8, 'Switching the lights on…'); await breathe();

    const still = matchMedia('(prefers-reduced-motion: reduce)').matches; // no head bob
    const LOOKS = [['Normal', 1], ['Fast', 1.45], ['Slow', 0.7]];
    let lookPick = 0;
    try { lookPick = Math.max(0, LOOKS.findIndex((l) => l[0] === localStorage.getItem('ws-look'))); } catch (e) { /* fine */ }
    const players = [];
    let active = false;

    /* ---------- walking: the walls, racking and everything else that blocks ---------- */
    const BODY = 0.22;
    function blocked(x, y) {
      if (x < BODY || x > world.W - BODY || y < BODY || y > world.D - BODY) return true;
      for (const o of world.obstacles) if (x > o.x0 - BODY && x < o.x1 + BODY && y > o.y0 - BODY && y < o.y1 + BODY) return true;
      return false;
    }

    /* ---------- timers on the game's clock ---------- */
    const timers = [];
    const later = (sec, fn) => { timers.push({ t: sec, fn }); };
    function runTimers(dt) { for (let i = timers.length - 1; i >= 0; i--) if ((timers[i].t -= dt) <= 0) { const f = timers[i].fn; timers.splice(i, 1); f(); } }

    /* ---------- sounds (made on the fly, no files) ---------- */
    const audio = { ctx: null, on: true };
    try { audio.on = localStorage.getItem('ws-sound') !== 'off'; } catch (e) { /* fine */ }
    function initAudio() {
      if (audio.ctx) { if (audio.ctx.state === 'suspended') audio.ctx.resume(); return; }
      try { audio.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio.ctx = null; }
    }
    function tone(freq, at, dur, type, vol, slide) {
      const c = audio.ctx; if (!c || !audio.on) return;
      const t0 = c.currentTime + (at || 0), o = c.createOscillator(), g = c.createGain();
      o.type = type || 'square'; o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.006);
      g.gain.setValueAtTime(vol, t0 + Math.max(0.01, dur - 0.03)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
    }
    function noise(at, dur, vol, freq) {
      const c = audio.ctx; if (!c || !audio.on) return;
      const n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq || 900; f.Q.value = 0.8; g.gain.value = vol;
      src.connect(f).connect(g).connect(c.destination); src.start(c.currentTime + (at || 0));
    }
    const buzz = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* fine */ } };
    const SFX = {
      scan: () => { tone(2730, 0, 0.085, 'square', 0.05); buzz(18); },
      bad: () => { tone(196, 0, 0.13, 'sawtooth', 0.07); tone(156, 0.16, 0.2, 'sawtooth', 0.07); buzz([40, 40, 60]); },
      miss: () => { tone(420, 0, 0.06, 'triangle', 0.04); },
      key: () => tone(1500, 0, 0.022, 'square', 0.018),
      pick: () => { tone(988, 0, 0.09, 'sine', 0.09); tone(1319, 0.08, 0.16, 'sine', 0.09); },
      slide: () => noise(0, 0.12, 0.25, 700),
      order: () => { tone(1800, 0, 0.07, 'square', 0.04); tone(1800, 0.12, 0.07, 'square', 0.04); },
      listed: () => tone(1800, 0, 0.06, 'square', 0.028),
      done: () => { [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.09, 0.22, 'triangle', 0.07)); noise(0.36, 0.25, 0.18, 4200); tone(2637, 0.38, 0.3, 'sine', 0.05); },
      hint: () => { tone(660, 0, 0.12, 'sine', 0.06, 990); },
      talk: () => { tone(540, 0, 0.045, 'triangle', 0.035); tone(690, 0.055, 0.05, 'triangle', 0.03); },
      approved: () => { tone(1568, 0, 0.12, 'sine', 0.07); tone(2093, 0.13, 0.22, 'sine', 0.07); },
      drawer: () => { noise(0, 0.18, 0.3, 500); tone(2400, 0.2, 0.25, 'sine', 0.035); },
      chime: () => { [880, 1109, 1319].forEach((f, i) => tone(f, i * 0.08, 0.2, 'triangle', 0.06)); },
      dayEnd: () => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.12, 0.3, 'triangle', 0.07)); }
    };
    // how far the nearest player is (Sam's sounds get quieter with distance)
    function nearestPlayer(x, y) { let d = Infinity; for (const p of players) d = Math.min(d, Math.hypot(p.me.x - x, p.me.y - y)); return d; }

    /* ---------- the counter: where customers stand ---------- */
    const counter = world.counter;
    const shopRoom = world.rooms.find((r) => r.name === 'Trade counter');
    const ent = world.openings.find((o) => o.type === 'entrance');
    const entX = (ent.from + ent.to) / 2;
    const gond = world.objects.filter((o) => o.kind === 'gondola' && o.x0 >= shopRoom.x0 - 0.01 && o.x1 <= shopRoom.x1 + 0.01).sort((a, b) => a.x0 - b.x0);
    const lanes = (() => { // the gaps between the shop's shelving, left to right
      const r = gond.map((g) => [g.x0, g.x1]).sort((a, b) => a[0] - b[0]), out = [];
      let end = r.length ? r[0][1] : shopRoom.x0;
      for (let i = 1; i < r.length; i++) { if (r[i][0] > end + 0.6) out.push((end + r[i][0]) / 2); end = Math.max(end, r[i][1]); }
      return out.length ? out : [shopRoom.x0 + 1.2];
    })();
    const LANE = lanes[0]; // customers come in and go out down the left-hand lane
    const tills = world.objects.filter((o) => o.kind === 'till' && o.x0 >= counter.x0 - 0.01 && o.x1 <= counter.x1 + 0.01).sort((a, b) => a.x0 - b.x0);
    const ALEX_TILL = tills[tills.length - 1]; // the left-hand one from behind the counter, by the gap
    const tillX = (t) => (t.x0 + t.x1) / 2;
    const CY = counter.y1 + 0.42, MID = counter.y1 + 0.95;
    // places at the counter: the left end, then across from each till (the last is Sam's)
    const SPOTS = [{ x: counter.x0 + 0.34, y: CY }].concat(tills.map((t) => ({ x: tillX(t), y: CY, till: t })));
    // waiting for their order: by the gap at the end of the counter, beside Sam's till (detailedfoil)
    const WAIT = [{ x: counter.x1 + 0.3, y: counter.y1 + 0.47, wait: true }, { x: counter.x1 - 0.15, y: counter.y1 + 0.85, wait: true }, { x: counter.x1 - 0.25, y: counter.y1 + 1.4, wait: true }];
    const IN = [[entX, world.D - 0.5], [LANE - 0.18, world.D - 1.2], [LANE - 0.18, MID]];
    const OUT = [[LANE + 0.22, MID], [LANE + 0.22, world.D - 1.2], [entX, world.D - 0.5], [entX, world.D + 0.6]];
    const taken = new Map(); // spot -> the customer standing there
    const clampX = (x) => Math.min(x, counter.x1 - 0.25); // keeps clear of the shelving by the gap
    // the way from one place in front of the counter to another, round anyone standing at it
    const route = (from, to) => [[clampX(from.x), MID], [clampX(to.x), MID], [to.x, to.y]];

    /* ---------- the customers: walking in, at the counter, waiting by the gap, going ---------- */
    const OUTFITS = [[0xf07a1a, 0x2f3540, 0xdfe3e8], [0xd9e021, 0x23272e, 0xdfe3e8], [0x7b2d3a, 0x3a3f47], [0x5a5f66, 0x22262c], [0x1d1f22, 0x4a3f33], [0xb3261e, 0x2f3540], [0x2e7d32, 0x3b3328], [0x0f5fa8, 0x23272e], [0xe8590c, 0x1f2328, 0xdfe3e8]];
    const SKIN = [0xf1c9a5, 0xe0b394, 0xc68b62, 0x8d5a3b, 0x5c3a25], HAIR = [0x2b1d14, 0x5a3a22, 0x9a6a3a, 0x1a1a1a, 0x7c7c7c, 0xc9a35a];
    const figs = [S.customer];
    S.customer.free = true; S.customer.group.visible = false;
    function dress(f) {
      const o = OUTFITS[Math.floor(Math.random() * OUTFITS.length)];
      f.parts.body.color.setHex(o[0]); f.parts.legsM.color.setHex(o[1]); f.parts.stripe.color.setHex(o[2] || o[0]);
      f.parts.skin.color.setHex(SKIN[Math.floor(Math.random() * SKIN.length)]); f.parts.hair.color.setHex(HAIR[Math.floor(Math.random() * HAIR.length)]);
      f.group.scale.setScalar(0.94 + Math.random() * 0.12);
    }
    function figFor(c) {
      let f = figs.find((x) => x.free);
      if (!f) { f = S.makeCustomer(); figs.push(f); }
      f.free = false; f.c = c; c.fig = f; f.mode = 'standing'; f.carry = false; f.giving = false; f.path = null;
      dress(f); f.group.visible = true;
      return f;
    }
    function freeFig(f) {
      f.free = true; f.group.visible = false; f.mode = 'away'; f.carry = false; f.giving = false;
      if (f.tote) { S.dropTote(f.tote); f.tote = null; }
      speeches.delete(f);
      if (f.c) { f.c.fig = null; f.c = null; }
    }
    function walk(c, pts, then) {
      const f = c.fig;
      if (!f) return;
      const p = f.group.position;
      f.path = [[p.x, p.z]].concat(pts.map((q) => (Array.isArray(q) ? [q[0], q[1]] : [q.x, q.y])));
      f.leg = 0; f.mode = 'walking'; f.then = then || null;
    }
    function faceTo(c, x, y) { const f = c.fig; if (f) f.face = Math.atan2(x - f.group.position.x, y - f.group.position.z); }
    function standAt(c, s) { // c's place: a spot at the counter, a waiting spot, or nowhere
      for (const [k, v] of taken) if (v === c) taken.delete(k);
      if (s) taken.set(s, c);
      c.spot = s || null;
    }
    function freeSpot(near) { // a free place at the counter (not Sam's), the nearest to near
      let best = null, bd = Infinity;
      for (const s of SPOTS) { if (s.till === ALEX_TILL || taken.get(s)) continue; const d = Math.abs(s.x - near); if (d < bd) { bd = d; best = s; } }
      return best;
    }
    // a new customer walks in to the counter (day.js sends them); at the counter they tell day.js
    function comeIn(c) {
      const f = figFor(c), d = day;
      const s = freeSpot(SPOTS[2].x) || SPOTS[1];
      standAt(c, s);
      f.group.position.set(entX, 0, world.D + 0.6); f.group.rotation.y = Math.PI;
      walk(c, IN.concat([[s.x, s.y]]), () => { f.face = Math.PI; d.arrived(c); });
    }
    // what they do next, when day.js says so
    function onStep(c) {
      const f = c.fig;
      if (!f) return;
      if (c.state === 'greet') { for (const p of players) p.queueChanged(); return; } // at the counter, waiting to be said hello to
      if (c.state === 'counter') { // a till customer, waiting to be served
        if (!c.hello) { c.hello = true; speakFig(c, { text: c.say }); }
        for (const p of players) p.queueChanged();
        return;
      }
      if (c.state === 'waiting' && !f.giving) {
        const till = c.order && c.order.kind === 'till';
        if (!till) speakFig(c, { text: c.say }); // what they've come for
        later(till ? 1.6 : 2.8, () => { if (c.state === 'waiting' && c.fig && !c.fig.giving) stepAside(c); });
        return;
      }
      if (c.state === 'leaving' && !f.giving) goOut(c);
    }
    function stepAside(c) {
      const s = WAIT.find((w) => !taken.get(w)) || WAIT[WAIT.length - 1];
      standAt(c, s);
      walk(c, route(c.fig.group.position.x !== undefined ? { x: c.fig.group.position.x } : s, s), () => faceTo(c, counter.x1 - 0.1, counter.y1 - 0.1));
    }
    function goOut(c) {
      const d = day, f = c.fig;
      standAt(c, null);
      walk(c, [[clampX(f.group.position.x), MID]].concat(OUT), () => { freeFig(f); d.gone(c); });
    }
    // called over to a till (yours or Sam's): anyone standing there swaps places
    function callTo(c, till, then) {
      const s = SPOTS.find((x) => x.till === till);
      const other = taken.get(s);
      if (other && other !== c) {
        const back = c.spot && !c.spot.wait ? c.spot : freeSpot(s.x);
        standAt(other, back);
        if (back && other.fig && !other.fig.giving) walk(other, route({ x: other.fig.group.position.x }, back), () => { if (other.fig) other.fig.face = Math.PI; });
      }
      standAt(c, s);
      c.ready = false; c.at = till;
      const f = c.fig, p = f.group.position;
      const pts = Math.abs(p.z - CY) < 0.12 && Math.abs(p.x - s.x) < 0.05 ? [[s.x, s.y]] : route({ x: p.x }, s);
      walk(c, pts, () => { f.face = Math.PI; c.ready = true; if (then) then(); });
    }
    // a tote (or a bag) for customer c, put on the counter at x: they come over for it, it slides across, they go
    function giveTote(c, tote, x) {
      const f = c.fig;
      if (!f) { S.dropTote(tote); return; }
      f.giving = true;
      tote.visible = true;
      tote.position.set(x, 1.0, counter.y0 + 0.22);
      standAt(c, null);
      walk(c, route({ x: f.group.position.x }, { x, y: CY }), () => {
        f.face = Math.PI;
        totes.push({ t: 0, tote, from: tote.position.clone(), to: new T.Vector3(x, 1.0, counter.y1 - 0.2), c });
      });
    }
    // where a hand over happens: the free place at the counter nearest x (not Sam's)
    function handX(x) { const s = freeSpot(x); return s ? s.x : Math.max(counter.x0 + 0.4, Math.min(counter.x1 - 0.4, x)); }
    function updateFigs(dt) {
      let any = false;
      for (const f of figs) {
        if (f.free) continue;
        if (f.mode === 'walking') {
          any = true;
          const tgt = f.path[f.leg + 1];
          if (!tgt) { f.mode = 'standing'; const th = f.then; f.then = null; if (th) th(); continue; }
          const p = f.group.position, dx = tgt[0] - p.x, dz = tgt[1] - p.z, d = Math.hypot(dx, dz), step = 1.25 * dt;
          if (d <= step) { p.x = tgt[0]; p.z = tgt[1]; f.leg++; if (f.leg >= f.path.length - 1) { f.mode = 'standing'; const th = f.then; f.then = null; if (th) th(); } }
          else { p.x += dx / d * step; p.z += dz / d * step; }
          if (d > 1e-4) { let dr = Math.atan2(dx, dz) - f.group.rotation.y; while (dr > Math.PI) dr -= 2 * Math.PI; while (dr < -Math.PI) dr += 2 * Math.PI; f.group.rotation.y += dr * Math.min(1, dt * 8); }
          f.phase = (f.phase || 0) + dt * 7.5;
          const sw = Math.sin(f.phase) * 0.5;
          f.parts.legL.rotation.x = sw; f.parts.legR.rotation.x = -sw; f.parts.armL.rotation.x = -sw * 0.8; f.parts.armR.rotation.x = f.carry ? -1.1 : sw * 0.8;
        } else if (f.mode === 'standing') {
          if (nearestPlayer(f.group.position.x, f.group.position.z) > 9) continue; // too far to see: no need to draw
          if (f.face !== undefined && f.face !== null) {
            let dr = f.face - f.group.rotation.y; while (dr > Math.PI) dr -= 2 * Math.PI; while (dr < -Math.PI) dr += 2 * Math.PI;
            if (Math.abs(dr) > 0.01) f.group.rotation.y += dr * Math.min(1, dt * 6); else f.face = null;
          }
          f.phase = (f.phase || 0) + dt;
          f.parts.legL.rotation.x = f.parts.legR.rotation.x = 0; f.parts.armL.rotation.x = 0; f.parts.armR.rotation.x = f.carry ? -1.1 : 0;
          f.parts.torso.rotation.z = Math.sin(f.phase * 1.3) * 0.02; f.parts.head.rotation.y = Math.sin(f.phase * 0.7) * 0.35;
          any = true;
        }
      }
      return any;
    }

    /* ---------- totes and bags going over the counter ---------- */
    const totes = [];
    function updateTotes(dt) {
      if (!totes.length) return false;
      for (let i = totes.length - 1; i >= 0; i--) {
        const t = totes[i];
        t.t += dt;
        const u = Math.min(1, t.t / 0.6), e = u * u * (3 - 2 * u);
        t.tote.position.lerpVectors(t.from, t.to, e);
        if (t.t > 0.9) {
          totes.splice(i, 1);
          const f = t.c && t.c.fig;
          if (f) { // the customer picks it up and goes
            if (f.tote) S.dropTote(f.tote);
            f.carry = true; f.tote = t.tote; f.group.add(t.tote); t.tote.position.set(0, 0.95, 0.32); t.tote.rotation.set(0, 0, 0); t.tote.scale.setScalar(1 / f.group.scale.x);
            f.giving = false;
            goOut(t.c);
          } else S.dropTote(t.tote);
        }
      }
      return true;
    }

    /* ---------- the tills' screens: the order you finished stays up until its tote goes over ---------- */
    // (detailedfoil: "have the completed order on the till screen when not using it so you know which pick is for
    // the till customer")
    const screens = new Map(); // till -> the order on its screen
    function showScreen(till, o) { if (!till) return; screens.set(till, o); if (S.tillScreen) S.tillScreen(tills.indexOf(till), o ? o.no : null); dirty = true; }
    function screenOf(till) { const o = screens.get(till); return o && o.status !== 'done' ? o : null; }
    function tidyScreens() { for (const [t, o] of screens) if (o && o.status === 'done') showScreen(t, null); }

    /* ---------- what people say: a bubble over their head, drawn by each player who can see them ---------- */
    const speeches = new Map(); // who -> {at(v), line, until, cls, name}
    const lasts = (line) => Math.min(9000, 2600 + ((line.text || '').length + (line.quote || '').length) * 50);
    function speakFig(c, line) {
      const f = c && c.fig;
      if (!f || !line || !line.text) return;
      for (const p of players) if (p.tillCust === c && p.tillOpen()) return; // the one at your till talks on the till's screen
      speeches.set(f, { at: (v) => v.set(f.group.position.x, 1.98 * f.group.scale.y, f.group.position.z), line, until: performance.now() + lasts(line), cls: 'crewcust', fig: f });
    }
    function speakCrew(b, line) {
      speeches.set(b, { at: (v) => b.fig.parts.head.getWorldPosition(v).setY(v.y + 0.25), line, until: performance.now() + lasts(line), cls: 'crew', name: b.name });
    }

    /* ---------- the day (day.js) ---------- */
    const MODES = [['mixed', 'mixed', 'every kind of pick'], ['pick', 'C&C', 'click and collect customers only'], ['hold', 'holding', 'picks for the holding area only'],
      ['till', 'till', 'till orders only'], ['kiosk', 'kiosk', 'kiosk orders only']];
    let mode = 0;
    try { mode = Math.max(0, MODES.findIndex((m) => m[0] === localStorage.getItem('ws-orders'))); } catch (e) { /* fine */ }
    let day = null, dayNo = 0;
    const dayEnv = {
      listed: (o) => { for (const p of players) p.listed(o); },
      changed: (o) => { for (const p of players) p.changed(o); tidyScreens(); },
      customer: (c) => comeIn(c),
      step: (c) => onStep(c),
      opening: () => { for (const p of players) { p.banner('Time to open', 'Go to the front door and unlock it', 6000); p.queueChanged(); } SFX.order(); },
      unlocked: () => { for (const p of players) { p.banner('Doors open', 'Customers will be in shortly', 2600); p.queueChanged(); } },
      closing: () => { for (const p of players) { p.banner('All done', 'Lock the front door', 6000); p.queueChanged(); } SFX.order(); },
      locked: () => { SFX.key(); },
      holdSet: (code, parcel) => { if (S.hold) S.hold.set(code, parcel); dirty = true; },
      over: () => dayOver()
    };
    function newDay() {
      const old = day;
      day = Day.create({ world, World, Till, requests, mode: MODES[mode][0], env: dayEnv, hold: old ? old.hold : null });
      dayNo++;
      if (!old && S.hold) for (const code in day.hold) S.hold.set(code, day.hold[code]);
      for (const p of players) p.newDay();
      if (day.phase === 'unlock') dayEnv.opening();
      dirty = true;
    }

    /* ---------- Sam, a coworker (bot.js) ---------- */
    // detailedfoil, 19 Nov 2026: a coworker doing the same job as you, at a person's pace, from the same pick list:
    // picks a customer is waiting for first, then the next customer at the till, then c picks. They push a trolley
    // (a stack of blue totes on a grey base with wheels) that blocks the aisle while they pick. Sam won't go down an
    // aisle someone's already in.
    const crew = [];
    function crewSound(b, name) {
      const d = nearestPlayer(b.x, b.y), open = players.some((p) => p.tillOpen()), v = Math.max(0, 1 - d / 14) * (open ? 0.35 : 0.6);
      if (v < 0.03) return;
      if (name === 'scan') tone(2730, 0, 0.085, 'square', 0.05 * v);
      else if (name === 'bad') { tone(196, 0, 0.13, 'sawtooth', 0.06 * v); tone(156, 0.16, 0.2, 'sawtooth', 0.06 * v); }
      else if (name === 'approved') { tone(1568, 0, 0.12, 'sine', 0.06 * v); tone(2093, 0.13, 0.22, 'sine', 0.06 * v); }
      else if (name === 'drawer') { noise(0, 0.18, 0.25 * v, 500); tone(2400, 0.2, 0.25, 'sine', 0.03 * v); }
      else if (name === 'slide') noise(0, 0.12, 0.25 * v, 700);
    }
    const pulling = new Set(); // boxes moving forward or back
    const crewEnv = {
      board: () => (day && active ? { orders: day.list(), queue: day.queueLate(), greet: day.ungreeted().filter((c) => day.t - c.here > 10) } : { orders: [], queue: [], greet: [] }),
      greet: (b, c) => { if (day) day.greet(c, b.name); },
      take: (b, o) => !!day && day.take(o, b.name),
      serve(b, c) { if (!day || !day.serve(c, b.name)) return false; showScreen(b.till, null); callTo(c, b.till); return true; },
      picked: (b, o) => day.picked(o),
      holdFree: () => (day ? day.freeSpots() : []),
      reserve: (b, code) => !!day && day.reserve(code, b.name),
      unreserve: (b, code) => { if (day) day.unreserve(code, b.name); },
      putAway(b, o, code) { S.trolleyTop(b.fig.trolley, null); day.putAway(o, code, b.name); dirty = true; },
      holdTake(b, o) {
        const g = S.hold.carry(o.hold.code);
        day.fetch(o);
        if (g) { b.fig.carry.add(g); g.position.set(0, 0, 0); g.rotation.set(0, Math.PI / 2, 0); b.fig.held = g; }
        dirty = true;
        return g || true;
      },
      toteAdd(b, ln) { S.trolleyTop(b.fig.trolley, ln.item.colour); },
      open(b, loc) {
        const tr = S.trayOf(loc);
        if (tr) { tr.target = 1; crewSound(b, 'slide'); }
        else if (loc.item) { loc.item.pullTarget = loc.face.kind === 'BB' ? 0.12 : 0.07; pulling.add(loc.item); }
        dirty = true;
      },
      close(b, loc) { const tr = S.trayOf(loc); if (tr) tr.target = 0; else if (loc.item) loc.item.pullTarget = 0; dirty = true; },
      tillDone(b, c, lines) { const o = day.tillDone(c, lines, { till: b.till }); showScreen(b.till, o); },
      // the top tote off the trolley (or the bag in their hands) goes on the counter; the customer comes for it
      handOver(b, o) {
        const c = o.cust;
        let tote = b.fig.held;
        b.fig.held = null;
        if (tote) scene.attach(tote); else tote = S.trolleyTake(b.fig.trolley);
        tote.rotation.set(0, o.kind === 'hold' ? Math.PI / 2 : 0, 0);
        if (c && c.fig) giveTote(c, tote, tillX(b.till)); else S.dropTote(tote);
        crewSound(b, 'slide');
        day.handOver(o, b.name);
        dirty = true;
      },
      sfx(b, name) { crewSound(b, name); },
      say(b, who, line, c) { if (who === 'me') speakCrew(b, line); else if (c) speakFig(c, line); }
    };
    const staffRoom = world.rooms.find((r) => r.name === 'Staff room');
    function hire(o) {
      const b = Crew.create({ world, World, Till, requests, nav: hire.nav || (hire.nav = new Crew.Nav(world)), env: crewEnv, id: crew.length + 1, name: o.name, till: o.till, start: o.start, rand: Math.random });
      b.fig = S.makeWorker({ name: o.name, skin: o.skin, hair: o.hair, afro: o.afro });
      b.fig.trolley = S.makeTrolley();
      S.poseWorker(b.fig, b, 0.02); S.poseTrolley(b.fig.trolley, b);
      crew.push(b);
      return b;
    }
    // Sam starts the shift coming out of the staff room, and works the till at the end of the counter by the gap
    hire({ name: 'Sam', till: ALEX_TILL, skin: 0xd6a57c, hair: 0x2b1d14, afro: true,
      start: staffRoom ? { x: staffRoom.x1 + 0.6, y: staffRoom.y0 + 0.65, yaw: Math.PI / 2 } : null });
    // Sam and their trolley are in your way like anything else (you can step away from them, never into them)
    function trolleyGap(b, x, y) { // how far a point is from the edge of Sam's trolley
      const t = b.trolley;
      if (!t) return Infinity;
      const dx = x - t.x, dy = y - t.y, s = Math.sin(t.phi), c = Math.cos(t.phi);
      const along = Math.abs(dx * s + dy * c) - Crew.TROLLEY.len / 2, across = Math.abs(dx * c - dy * s) - Crew.TROLLEY.wide / 2;
      return Math.hypot(Math.max(0, along), Math.max(0, across)) + Math.min(0, Math.max(along, across));
    }
    function crewStop(me, x, y) {
      for (const b of crew) {
        const dn = Math.hypot(x - b.x, y - b.y);
        if (dn < BODY + b.r && dn < Math.hypot(me.x - b.x, me.y - b.y) - 1e-4) return true;
        const g = trolleyGap(b, x, y);
        if (g < BODY && g < trolleyGap(b, me.x, me.y) - 1e-4) return true;
      }
      return false;
    }
    // two players: neither walks into the other (two can share an aisle, detailedfoil)
    function peerStop(me, x, y) {
      for (const q of players) {
        if (q.me === me) continue;
        const dn = Math.hypot(x - q.me.x, y - q.me.y);
        if (dn < 2 * BODY && dn < Math.hypot(me.x - q.me.x, me.y - q.me.y) - 1e-4) return true;
      }
      return false;
    }
    const _frus = new T.Frustum(), _fm = new T.Matrix4(), _sph = new T.Sphere(new T.Vector3(), 1.3);
    let crewIdle = 0;
    function updateCrew(dt) { // true when Sam needs drawing again
      if (!crew.length) return false;
      const people = players.map((p, i) => ({ id: -1 - i, x: p.me.x, y: p.me.y, r: BODY, moving: p.me.speed > 0.15, human: true }));
      let seen = false, busy = false;
      for (const b of crew) {
        const others = people.slice();
        for (const o of crew) if (o !== b) others.push({ id: o.id, x: o.x, y: o.y, r: o.r, moving: o.moving });
        b.update(dt, others);
        S.poseWorker(b.fig, b, dt); S.poseTrolley(b.fig.trolley, b);
        _sph.center.set(b.x, 1.0, b.y);
        for (const p of players) {
          p.cam.updateMatrixWorld();
          _frus.setFromProjectionMatrix(_fm.multiplyMatrices(p.cam.projectionMatrix, p.cam.matrixWorldInverse));
          if (Math.hypot(p.me.x - b.x, p.me.y - b.y) < 32 && _frus.intersectsSphere(_sph)) {
            seen = true;
            if (b.moving || b.turning > 0.1 || b.beam > 0 || b.bending || b.giving || b.aim) busy = true;
          }
        }
      }
      if (!seen) return false;
      if (busy) { crewIdle = 0; return true; }
      crewIdle += dt; // standing still: the small movements are redrawn less often
      if (crewIdle > 0.066) { crewIdle = 0; return true; }
      return false;
    }

    /* ---------- trays and pulled boxes moving ---------- */
    function updateMoving(dt) {
      let any = false;
      for (const tr of S.trays.values()) {
        const tgt = tr.target || 0;
        if (Math.abs(tr.slide - tgt) > 0.001) {
          tr.slide += Math.sign(tgt - tr.slide) * Math.min(Math.abs(tgt - tr.slide), dt * 5.5);
          S.placeTray(tr); any = true;
        }
      }
      for (const it of pulling) {
        const tgt = it.pullTarget || 0, now = it.pull || 0;
        if (Math.abs(now - tgt) > 0.0005) { it.pull = now + Math.sign(tgt - now) * Math.min(Math.abs(tgt - now), dt * 0.6); S.placeItem(it); any = true; }
        else if (!tgt) { it.pull = 0; S.placeItem(it); pulling.delete(it); }
      }
      // the open trays' contents get their photos
      const ext = [];
      for (const p of players) { const t = p.openTray(); if (t && t.slide > 0.05) ext.push(...t.items); }
      S.photos.setExtra(ext);
      if (any) S.photos.fill();
      return any;
    }

    /* ---------- the holding area ---------- */
    const HOLD = world.holding, holdBox = new T.Box3(), _hit = new T.Vector3();
    const spotOf = (code) => HOLD.spots.find((sp) => sp.code === code);
    function spotBox(sp) { return { x: (sp.x0 + sp.x1) / 2, y: (sp.y0 + sp.y1) / 2, z0: sp.z0 - (sp.kind === 'tote' ? 0.01 : 0.12), z1: sp.z1 + 0.02, w: sp.x1 - sp.x0 + 0.03, d: sp.y1 - sp.y0 }; }

    /* ---------- a player: their camera, controls, scanner and till ---------- */
    // D: the player's own elements; root: where their layout's sizes go
    function makePlayer(idx, D) {
      const P = { idx, id: 'p' + (idx + 1), D, kb: idx === 0 };
      const me = { x: world.start.x + idx * 0.7, y: world.start.y, yaw: world.start.yaw, pitch: -0.05, vx: 0, vy: 0, eye: 1.62, squat: false, bob: 0, speed: 0 };
      const cam = new T.PerspectiveCamera(60, 1, 0.03, 120);
      cam.rotation.order = 'YXZ';
      cam.layers.enable(1 + idx);
      const view = { x: 0, y: 0, w: 1, h: 1, cx: 0.5, cy: 0.5, landscape: true };
      P.me = me; P.cam = cam; P.view = view;

      /* ---------- layout: the view's centre is the middle of what the scanner doesn't cover ---------- */
      P.layout = function (rect) {
        const vw = Math.max(1, rect.w), vh = Math.max(1, rect.h), land = vw >= vh;
        let sch, scw;
        if (land) { sch = Math.min(vh - 12, 700); scw = sch * 0.53; if (scw > vw * 0.42) { scw = vw * 0.42; sch = scw / 0.53; } }
        else { sch = Math.min(vh * 0.5, 540); scw = sch * 0.53; if (scw > vw * 0.6) { scw = vw * 0.6; sch = scw / 0.53; } }
        D.root.style.setProperty('--sch', Math.round(sch) + 'px'); D.root.style.setProperty('--scw', Math.round(scw) + 'px');
        D.root.classList.toggle('portrait', !land);
        view.x = rect.x; view.y = rect.y; view.w = vw; view.h = vh; view.landscape = land;
        if (land) {
          const cx = Math.max(vw * 0.3, (vw - scw - 12) / 2), FW = 2 * vw - 2 * cx;
          cam.fov = 60; cam.aspect = FW / vh; cam.setViewOffset(FW, vh, vw - 2 * cx, 0, vw, vh);
          view.cx = cx; view.cy = vh / 2;
        } else {
          const cy = Math.max(vh * 0.28, (vh - sch - 12) / 2), FH = 2 * vh - 2 * cy;
          cam.fov = 82; cam.aspect = vw / FH; cam.setViewOffset(vw, FH, 0, vh - 2 * cy, vw, vh);
          view.cx = vw / 2; view.cy = cy;
        }
        cam.updateProjectionMatrix();
        D.root.style.setProperty('--cx', Math.round(view.cx) + 'px'); D.root.style.setProperty('--cy', Math.round(view.cy) + 'px');
        dirty = true;
      };
      function applyCam() {
        me.pitch = Math.max(-1.45, Math.min(1.35, me.pitch));
        cam.position.set(me.x, me.eye + (still ? 0 : Math.sin(me.bob * 2) * 0.012 * Math.min(1, me.speed / 1.7)), me.y);
        cam.rotation.set(me.pitch, me.yaw, 0);
        dirty = true;
      }
      P.applyCam = applyCam;
      applyCam();

      /* ---------- walking ---------- */
      const keys = new Set();
      const stickIn = { x: 0, y: 0 }, lookIn = { x: 0, y: 0 };
      let running = false;
      P.input = { keys, stick: stickIn, look: lookIn, run: (on) => { running = on; } };
      function stepMove(dt) {
        let f = -stickIn.y, s = stickIn.x, turn = 0;
        if (keys.has('f')) f += 1; if (keys.has('b')) f -= 1; if (keys.has('l')) s -= 1; if (keys.has('r')) s += 1;
        if (keys.has('tl')) turn += 1; if (keys.has('tr')) turn -= 1;
        if (turn) me.yaw += turn * 2.0 * dt;
        let moved = !!turn;
        if (lookIn.x || lookIn.y) { const k = 2.6 * LOOKS[lookPick][1] * dt; me.yaw -= lookIn.x * k; me.pitch -= lookIn.y * k * 0.8; moved = true; }
        let len = Math.hypot(f, s);
        if (len > 1) { f /= len; s /= len; len = 1; }
        const jog = running || Math.hypot(stickIn.x, stickIn.y) > 0.93;
        const top = me.squat ? 0.85 : jog ? 3.1 : 1.75;
        const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
        const tx = (-sy * f + cy * s) * top, ty = (-cy * f - sy * s) * top;
        const k = Math.min(1, dt * (len ? 9 : 12));
        me.vx += (tx - me.vx) * k; me.vy += (ty - me.vy) * k;
        me.speed = Math.hypot(me.vx, me.vy);
        if (me.speed > 0.01) {
          const nx = me.x + me.vx * dt, ny = me.y + me.vy * dt;
          if (!blocked(nx, me.y) && !crewStop(me, nx, me.y) && !peerStop(me, nx, me.y)) me.x = nx; else me.vx = 0;
          if (!blocked(me.x, ny) && !crewStop(me, me.x, ny) && !peerStop(me, me.x, ny)) me.y = ny; else me.vy = 0;
          me.bob += me.speed * dt * 2.3;
          moved = true;
        } else { me.vx = me.vy = 0; me.speed = 0; }
        const want = me.squat ? 0.95 : 1.62;
        if (Math.abs(me.eye - want) > 0.002) { me.eye += (want - me.eye) * Math.min(1, dt * 11); moved = true; }
        if (moved) applyCam();
        return moved;
      }

      /* ---------- the scanner screen ---------- */
      const short = (s) => String(s).slice(0, 20).trim();
      const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
      let order = null, cur = 0, state = 'idle', typed = '', full = false, viewLine = -1, viewTimer = 0, msgUntil = 0, msg = null, atCounter = false;
      let sel = 0, selId = null, slips = 0, carry = null;
      const stats = { orders: 0, picks: 0, lines: 0, units: 0, wrong: 0, hints: 0, tills: 0, perfect: 0, since: Date.now() };
      let life = { orders: 0, lines: 0, units: 0 };
      try { life = Object.assign(life, JSON.parse(localStorage.getItem('ws-stats-v1') || '{}')); } catch (e) { /* fine */ }
      P.stats = stats; P.life = life;
      function saveLife() { if (idx) return; try { localStorage.setItem('ws-stats-v1', JSON.stringify(life)); } catch (e) { /* fine */ } } // player 1's, kept on the device
      function lineHtml(text, cls) { const s = document.createElement('span'); s.className = 'sc-line' + (cls ? ' ' + cls : ''); s.textContent = text; return s; }
      function say(text, cls, ms) { msg = { text, cls }; msgUntil = performance.now() + (ms || 1700); renderScanner(); }
      function renderTote() {
        if (!order || state === 'list' || state === 'idle' || state === 'end') { D.toteCount.textContent = '0'; return; }
        if (order.kind === 'hold') { D.toteCount.textContent = (state === 'deliver' ? 1 : 0) + '/1'; return; }
        D.toteCount.textContent = (state === 'deliver' || state === 'put' ? order.lines.length : cur) + '/' + order.lines.length;
      }
      const suffix = (o) => (o.kind === 'c' ? ' c' : o.kind === 'till' ? '' : ' CK');
      function renderList(showMsg) {
        const list = day ? day.list() : [];
        if (selId !== null) { const i = list.findIndex((o) => o.id === selId); if (i >= 0) sel = i; }
        sel = Math.max(0, Math.min(sel, list.length - 1));
        selId = list[sel] ? list[sel].id : null;
        const rows = list.map((o, i) => {
          const li = document.createElement('li'), b = document.createElement('b');
          li.className = i === sel ? 'on' : ''; li.dataset.i = String(i);
          b.textContent = i === sel ? '>' : '';
          li.append(b, document.createTextNode(day.label(o)));
          return li;
        });
        if (!rows.length) { const li = document.createElement('li'); li.className = 'none'; li.textContent = state === 'end' ? 'All picks clear' : 'No picks'; rows.push(li); }
        D.scRows.replaceChildren(...rows);
        let note = '', cls = 'warn';
        if (showMsg) { note = msg.text; cls = msg.cls || 'warn'; }
        else if (state === 'end') { note = 'Day done'; cls = 'ok'; }
        else if (day && day.phase === 'unlock') note = 'Time to open: unlock the front door';
        else if (day && day.phase === 'lock') note = 'All done: lock the front door';
        else if (day && day.ungreeted().length) note = 'Customer waiting: say hello';
        else if (day && day.queue().length && !P.tillCust) note = 'Till customer waiting';
        D.scNote.textContent = note; D.scNote.className = 'sc-note ' + cls; D.scNote.hidden = !note;
      }
      function renderScanner() {
        renderTote();
        const showMsg = msg && performance.now() < msgUntil;
        const listing = state === 'list' || state === 'end' || state === 'idle';
        D.scList.hidden = !listing; D.scSelect.hidden = !listing; D.scText.hidden = listing; D.scHint.hidden = listing;
        D.scPicked.style.visibility = state === 'scan' || state === 'qty' ? '' : 'hidden';
        D.scEnter.classList.toggle('pulse', (state === 'deliver' && atCounter) || (state === 'qty' && full));
        D.scHint.classList.toggle('used', hint.until > performance.now());
        if (listing) { renderList(showMsg); D.scNote.hidden = D.scNote.hidden && !showMsg; return; }
        D.scNote.hidden = true;
        const L = [];
        if (state === 'scan' || state === 'qty') {
          const i = viewLine >= 0 ? viewLine : cur, ln = order.lines[i];
          if (!ln) return;
          L.push(['Today Picking'], [viewLine >= 0 ? 'Line ' + (i + 1) + ' of ' + order.lines.length : 'Pick To Tote/Trolley', viewLine >= 0 ? 'warn' : '']);
          L.push([ln.loc.code, 'big'], [ln.item.code, 'gap'], [short(ln.item.name)], ['Qty: ' + ln.qty, 'gap']);
          if (full && viewLine < 0) L.push(['Press Enter', 'gap ok']);
        } else if (state === 'hold') {
          L.push(['Click & Collect'], ['Holding area', 'warn'], [order.hold.code, 'big'], [order.hold.parcel.surname.toUpperCase(), 'gap'], ['Scan the tote', 'gap dim'], ['by Goods In', 'dim']);
        } else if (state === 'put') {
          L.push(['Today Picking'], ['Pick Complete', 'ok'], [order.no + ' c', 'big'], ['Holding area', 'gap warn'], ['Any empty OC', 'gap'], ['Scan its label', 'dim']);
        } else if (state === 'deliver' && order.kind === 'hold') {
          L.push(['Click & Collect'], ['Bag collected', 'ok'], [order.hold.code, 'big'], [order.hold.parcel.surname.toUpperCase(), 'gap dim']);
          L.push(atCounter ? ['Press Enter to', 'gap warn'] : ['Take it to', 'gap'], atCounter ? ['hand over', 'warn'] : ['Trade Counter']);
        } else if (state === 'deliver') {
          L.push(['Today Picking'], ['Pick Complete', 'ok'], [order.no + suffix(order), 'big'], [plural(order.locs, 'line', 'lines') + ' ' + plural(order.units, 'unit', 'units'), 'gap dim']);
          L.push(atCounter ? ['Press Enter to', 'gap warn'] : ['Take tote to', 'gap'], atCounter ? ['hand over', 'warn'] : ['Trade Counter']);
        }
        D.scText.replaceChildren(...L.map((l) => lineHtml(l[0], l[1])));
        if (showMsg) D.scText.appendChild(lineHtml(msg.text, 'gap ' + (msg.cls || 'warn')));
        D.scQty.textContent = state === 'qty' ? typed : '';
        D.scCur.className = 'sc-cur' + (state === 'qty' && !full ? '' : ' line');
      }
      P.render = renderScanner;
      function flash(bad) { D.scFlash.className = 'sc-flash' + (bad ? ' bad' : ''); void D.scFlash.offsetWidth; D.scFlash.className = 'sc-flash go' + (bad ? ' bad' : ''); }
      let toastT = 0;
      function toast(text, kind) { D.toast.textContent = text; D.toast.className = 'ws-toast show' + (kind ? ' ' + kind : ''); clearTimeout(toastT); toastT = setTimeout(() => { D.toast.className = 'ws-toast'; }, 1300); }
      let bannerT = 0;
      function banner(title, text, ms) { D.bannerTitle.textContent = title; D.bannerText.textContent = text || ''; D.banner.className = 'ws-banner show'; clearTimeout(bannerT); bannerT = setTimeout(() => { D.banner.className = 'ws-banner'; }, ms || 1800); }
      P.toast = toast;

      /* ---------- the list: choosing an order ---------- */
      function startPick() {
        const list = day ? day.list() : [];
        const o = list[sel];
        if (!o) { say('No picks yet', 'dim'); SFX.miss(); return; }
        if (!day.take(o, P.id)) { say('Already taken', 'err'); SFX.bad(); renderScanner(); return; }
        order = o; cur = 0; typed = ''; full = false; viewLine = -1; hint.until = 0; slips = 0; carry = null;
        SFX.order(); flash(false);
        if (o.kind === 'hold') { state = 'hold'; banner(o.no + ' CK', 'Click & collect in the holding area: ' + o.hold.code, 2000); }
        else { state = 'scan'; banner(o.no + suffix(o), (o.kind === 'c' ? 'For the holding area: ' : o.kind === 'ck' ? 'Customer waiting: ' : 'Till order, customer waiting: ') + plural(o.locs, 'location', 'locations') + ', ' + plural(o.units, 'item', 'items'), 2200); }
        renderScanner();
      }
      P.listed = function (o) {
        if (state !== 'list') return;
        SFX.listed();
        toast('New pick: ' + day.label(o));
        renderScanner();
      };
      P.changed = function (o) {
        if (o === order && o.cust && (state === 'put' || ((state === 'scan' || state === 'qty') && o.kind === 'ck' && !o.toldCk))) {
          o.toldCk = true;
          if (state === 'put') { state = 'deliver'; atCounter = false; }
          banner('Customer here for ' + o.no, 'It goes to the trade counter now, not the holding area', 2600);
          SFX.order();
        }
        renderScanner();
      };
      P.queueChanged = function () { if (state === 'list') renderScanner(); callOver(); };
      P.newDay = function () { if (state === 'end' || state === 'idle') { state = 'list'; order = null; } sel = 0; selId = null; renderScanner(); };
      P.dayOver = function () { if (!order) state = 'end'; renderScanner(); };

      /* ---------- aiming and scanning ---------- */
      const ray = new T.Raycaster(), ndc = new T.Vector2();
      const REACH = 2.05, LOW = 0.45;
      function hitAt(nx, ny) { // the location under a point on this player's view (-1..1), if any
        ray.setFromCamera(ndc.set(nx, ny), cam);
        const o = ray.ray.origin, d = ray.ray.direction;
        let best = null;
        for (const f of world.faces) {
          if (Math.abs(d.z) < 1e-6 || (o.z - f.front) * f.out <= 0) continue;
          const t = (f.front - o.z) / d.z;
          if (t <= 0.02 || t > 8) continue;
          const x = o.x + d.x * t, z = o.y + d.y * t;
          if (x < f.x0 || x > f.x1 || z < 0 || z > world.RACK_H) continue;
          if (!best || t < best.t) best = { t, f, x, z };
        }
        if (!best) return null;
        const loc = World.locationAt(world, best.f, best.x, best.z);
        return loc ? { loc, dist: best.t } : null;
      }
      function holdHit(nx, ny) { // the OC spot the line from the view goes through
        if (!HOLD) return null;
        ray.setFromCamera(ndc.set(nx, ny), cam);
        let best = null;
        for (const sp of HOLD.spots) {
          holdBox.min.set(sp.x0, sp.z0 - (sp.kind === 'tote' ? 0 : 0.12), sp.y0); holdBox.max.set(sp.x1 + 0.03, sp.z1 + 0.04, sp.y1);
          if (ray.ray.intersectBox(holdBox, _hit)) { const d = _hit.distanceTo(ray.ray.origin); if (!best || d < best.dist) best = { sp, dist: d }; }
        }
        return best;
      }
      const tillBox = new T.Box3();
      function tillHit(nx, ny) { // the line from the view goes through one of your tills
        ray.setFromCamera(ndc.set(nx, ny), cam);
        for (const t of tills) {
          if (t === ALEX_TILL) continue;
          tillBox.min.set(t.x0 - 0.05, 0.97, t.y0 - 0.08); tillBox.max.set(t.x1 + 0.05, 1.38, t.y1 + 0.02);
          if (ray.ray.intersectBox(tillBox, _hit) && _hit.distanceTo(ray.ray.origin) < 2.6) return true;
        }
        return false;
      }
      const centreNdc = () => [(view.cx / view.w) * 2 - 1, -((view.cy / view.h) * 2 - 1)];
      P.centre = centreNdc;
      let aim = null;
      function updateAim() {
        const c = centreNdc(), h = hitAt(c[0], c[1]);
        aim = h && h.dist <= REACH ? h : null;
        D.cross.classList.toggle('reach', !!aim);
        if (aim && (state === 'scan' || state === 'qty')) { S.setBox(S.aimBox, S.locBox(aim.loc), 0.012); S.aimBox.visible = true; }
        else if (state === 'hold' || state === 'put') {
          const hh = holdHit(c[0], c[1]);
          if (hh && hh.dist <= REACH + 0.4) { S.setBox(S.aimBox, spotBox(hh.sp), 0.012); S.aimBox.visible = true; D.cross.classList.add('reach'); } else S.aimBox.visible = false;
        } else S.aimBox.visible = false;
      }
      // the tray this player has out, or the box pulled forward
      let openTray = null, openTimer = 0, pulled = null;
      P.openTray = () => openTray;
      function slideTray(tr, out) {
        if (openTray && openTray !== tr) openTray.target = 0;
        if (tr) { tr.target = out ? 1 : 0; if (out) { openTray = tr; SFX.slide(); } }
      }
      function shut() { if (openTray) openTray.target = 0; if (pulled) pulled.pullTarget = 0; }
      function scanAt(nx, ny) {
        if (state === 'deliver') { if (atCounter) handOver(); else { say('Take it to the counter', 'warn'); SFX.miss(); } return; }
        if ((doorOn || greetC) && (state === 'list' || state === 'end') && useAction()) return;
        if (nearTill && (state === 'list' || state === 'end' || tillHit(nx, ny))) { openTill(); return; }
        if (state === 'list' || state === 'end') { const n = day ? day.list().length : 0; say(n ? 'Press Enter to start a pick' : 'No picks yet', 'dim'); SFX.miss(); return; }
        if (state === 'hold') { scanHold(nx, ny); return; }
        if (state === 'put') { scanPut(nx, ny); return; }
        if (state !== 'scan' && state !== 'qty') return;
        const h = hitAt(nx, ny);
        if (!h) { say('No barcode there', 'dim'); SFX.miss(); return; }
        if (h.dist > REACH) { say('Too far away', 'warn'); toast('Get closer to scan'); SFX.miss(); return; }
        if (h.loc.z0 < LOW && !me.squat) { say('Squat down to scan it', 'warn'); toast(touch ? 'Too low: squat down' : 'Too low: squat (C)'); SFX.bad(); flash(true); return; }
        const ln = order.lines[cur], tr = S.trayOf(h.loc);
        S.setBox(S.aimBox, S.locBox(h.loc), 0.012); S.aimBox.visible = true;
        if (World.sameSpot(h.loc, ln.loc)) {
          if (state === 'qty' && full) { say('All ' + ln.qty + ' picked: press Enter', 'warn'); SFX.miss(); return; }
          // every scan of the right location is one item picked (detailedfoil: tap it as many times as the gun says)
          if (state === 'qty') { countOne(); return; }
          SFX.scan(); flash(false);
          state = 'qty'; typed = ''; full = false; viewLine = -1;
          openTimer = 0;
          if (tr) slideTray(tr, true); else if (ln.loc.item) { pulled = ln.loc.item; pulled.pullTarget = ln.loc.face.kind === 'BB' ? 0.12 : 0.07; pulling.add(pulled); }
          if (hint.loc === ln.loc) hint.until = 0;
          countOne();
        } else {
          stats.wrong++; slips++;
          SFX.bad(); flash(true);
          if (tr) { slideTray(tr, true); openTimer = 1.1; }
          say('Wrong location', 'err', 2000);
          toast(h.loc.code + '  ✗', 'bad');
        }
      }
      // one more of this line's product; when they're all scanned, Enter moves on to the next location (detailedfoil)
      function countOne() {
        const ln = order.lines[cur];
        const n = (Number(typed) || 0) + 1;
        typed = String(n);
        if (n > 1) SFX.scan();
        flash(false);
        if (n < ln.qty) {
          toast(n + ' of ' + ln.qty, 'good');
          if (n === 1) say('Scan again for each one', 'dim', 2400);
        } else {
          full = true;
          toast(ln.qty > 1 ? 'All ' + ln.qty + ': press Enter' : 'Got it: press Enter', 'good');
        }
        renderScanner();
      }
      function confirmQty() {
        if (state !== 'qty' || !full) return;
        const ln = order.lines[cur];
        SFX.pick(); flash(false);
        stats.lines++; stats.units += ln.qty; life.lines++; life.units += ln.qty; saveLife();
        flyToTote(ln);
        setTimeout(() => { D.toteChip.classList.remove('bump'); void D.toteChip.offsetWidth; D.toteChip.classList.add('bump'); }, 480);
        shut();
        cur++; typed = ''; full = false;
        if (cur < order.lines.length) { state = 'scan'; toast('Next location: ' + (cur + 1) + ' of ' + order.lines.length, 'good'); }
        else {
          hint.until = 0;
          state = order.kind === 'c' && !order.cust ? 'put' : 'deliver';
          if (state === 'put') banner('Pick complete', 'Put it in any empty OC spot in the holding area', 2400);
          else banner('Pick complete', 'Take the tote to the trade counter', 2200);
          day.picked(order);
        }
        renderScanner();
      }
      // no backing out of an order once it's started (detailedfoil): Back only puts the last item back
      function back() {
        if (!D.scMenu.hidden) { menu(false); return; }
        if (state === 'qty' && Number(typed) > 0) {
          SFX.key();
          const n = Number(typed) - 1;
          full = false;
          if (n > 0) typed = String(n);
          else { typed = ''; state = 'scan'; shut(); }
          renderScanner();
          return;
        }
        if (state === 'scan' || state === 'qty' || state === 'hold' || state === 'put' || state === 'deliver') { say('Finish task', 'err', 1800); SFX.bad(); flash(true); }
      }
      function digit() { if (state === 'qty' || state === 'scan') { say('Scan the location for each one', 'warn'); SFX.miss(); } }
      function enter() {
        if (!D.scMenu.hidden) return;
        if (state === 'list') startPick();
        else if (state === 'qty') { if (full) confirmQty(); else { say('Scan the location for each one', 'warn'); SFX.miss(); } }
        else if (state === 'deliver') { if (atCounter) handOver(); else { say('Take it to the counter', 'warn'); SFX.miss(); } }
        else if (state === 'scan') { say('Scan the location first', 'warn'); SFX.miss(); }
        else if (state === 'hold') { say('Scan the tote in the holding area', 'warn'); SFX.miss(); }
        else if (state === 'put') { say('Scan an empty OC label', 'warn'); SFX.miss(); }
      }
      function page(dir) {
        if (state === 'list') {
          const n = day ? day.list().length : 0;
          if (!n) return;
          SFX.key();
          sel = (sel + dir + n) % n; selId = day.list()[sel].id;
          renderScanner();
          return;
        }
        if (!(state === 'scan' || state === 'qty') || !order) return;
        SFX.key();
        const n = order.lines.length, i = (viewLine >= 0 ? viewLine : cur) + dir;
        viewLine = i < 0 || i >= n || i === cur ? -1 : i;
        viewTimer = viewLine >= 0 ? 4 : 0;
        renderScanner();
      }
      function tapRow(i) { if (state !== 'list') return; if (i === sel) { SFX.key(); enter(); return; } const list = day ? day.list() : []; if (!list[i]) return; SFX.key(); sel = i; selId = list[i].id; renderScanner(); }

      /* ---------- the holding area: fetching a bag, putting a c pick away ---------- */
      function scanHold(nx, ny) {
        const h = holdHit(nx, ny);
        if (!h) { say('Scan the tote', 'dim'); SFX.miss(); return; }
        if (h.dist > REACH + 0.4) { say('Too far away', 'warn'); toast('Get closer to scan'); SFX.miss(); return; }
        const sp = h.sp, p = day.hold[sp.code];
        S.setBox(S.aimBox, spotBox(sp), 0.012); S.aimBox.visible = true;
        if (sp.code !== order.hold.code) {
          stats.wrong++; slips++; SFX.bad(); flash(true);
          say(p ? 'Wrong order' : 'Empty', 'err', 2000);
          toast(sp.code + (p ? ': ' + p.surname : ': empty') + '  ✗', 'bad');
          return;
        }
        SFX.pick(); flash(false);
        carry = S.hold.carry(sp.code); if (carry) carry.visible = false;
        day.fetch(order);
        if (hint.spot) hint.until = 0;
        state = 'deliver';
        toast(sp.code + ' ' + order.hold.parcel.surname + '  ✓', 'good');
        say('Bag in hand', 'ok', 1800);
        banner('Order collected', 'Take it to the trade counter', 2000);
        S.aimBox.visible = false;
        renderScanner(); dirty = true;
      }
      function scanPut(nx, ny) {
        const h = holdHit(nx, ny);
        if (!h) { say('Scan an OC label', 'dim'); SFX.miss(); return; }
        if (h.dist > REACH + 0.4) { say('Too far away', 'warn'); toast('Get closer to scan'); SFX.miss(); return; }
        const sp = h.sp;
        S.setBox(S.aimBox, spotBox(sp), 0.012); S.aimBox.visible = true;
        const p = day.putAway(order, sp.code, P.id);
        if (!p) {
          stats.wrong++; slips++; SFX.bad(); flash(true);
          say(sp.code + ' is full', 'err', 2000);
          toast(sp.code + ': ' + (day.hold[sp.code] ? day.hold[sp.code].surname : 'kept for someone') + '  ✗', 'bad');
          return;
        }
        if (hint.spot) hint.until = 0;
        S.aimBox.visible = false;
        finish('Put away in ' + sp.code, 'for ' + p.surname);
      }
      function nearestFree() {
        let best = null, bd = Infinity;
        for (const code of day.freeSpots()) { const sp = spotOf(code), d = Math.hypot(me.x - sp.x1, me.y - (sp.y0 + sp.y1) / 2); if (d < bd) { bd = d; best = sp; } }
        return best;
      }

      /* ---------- hint: the location glows ---------- */
      const hint = { until: 0, loc: null, counter: false, till: null, spot: null, t: 0 };
      function useHint() {
        if (state === 'list' || state === 'end') {
          if (day && day.queue().length && !P.tillCust) {
            const t = tills.filter((x) => x !== ALEX_TILL).reduce((b, x) => (Math.abs(tillX(x) - me.x) < Math.abs(tillX(b) - me.x) ? x : b));
            SFX.hint(); stats.hints++;
            hint.until = performance.now() + 12000; hint.t = 0; hint.loc = null; hint.counter = false; hint.till = t; hint.spot = null;
            toast('A till is glowing: walk up to it behind the counter', '');
            renderScanner(); dirty = true;
          } else toast(day && day.list().length ? 'Choose a pick with the arrows and press Enter' : 'No picks yet: one will come in soon', '');
          return;
        }
        if (!order) return;
        SFX.hint(); stats.hints++; slips++;
        hint.until = performance.now() + 12000; hint.t = 0; hint.till = null;
        hint.spot = state === 'hold' ? spotOf(order.hold.code) : state === 'put' ? nearestFree() : null;
        hint.loc = state === 'scan' || state === 'qty' ? order.lines[cur].loc : null;
        hint.counter = state === 'deliver';
        D.scHint.classList.add('flash'); setTimeout(() => D.scHint.classList.remove('flash'), 200);
        toast(hint.counter ? 'The counter is glowing' : hint.spot ? 'The holding area is by goods in: look for the glow' : hint.loc ? 'Look for the glow: ' + hint.loc.face.area + ' aisle' : 'The holding area is full: wait for a collection', '');
        renderScanner(); dirty = true;
      }
      function updateHint(dt) {
        const on = hint.until > performance.now();
        if (!on) { if (hint.shown) { hint.shown = false; renderScanner(); return true; } return false; }
        hint.t += dt; hint.shown = true;
        return true;
      }
      // the glow in this player's view (the glow and the aim box are one each, shared: set just before each view is drawn)
      function applyHint() {
        S.glow.visible = false; S.signGlow.visible = false;
        if (!(hint.until > performance.now())) return;
        const pulse = 0.5 + 0.5 * Math.sin(hint.t * 6.5);
        S.glowMat.opacity = 0.28 + 0.5 * pulse;
        if (hint.spot) {
          S.setBox(S.glow, spotBox(hint.spot), 0.03); S.glow.visible = true; S.signGlow.visible = false;
        } else if (hint.till) {
          const t = hint.till;
          S.setBox(S.glow, { x: tillX(t), y: (t.y0 + t.y1) / 2, z0: 0.98, z1: 1.36, w: t.x1 - t.x0 + 0.1, d: t.y1 - t.y0 + 0.1 }, 0);
          S.glow.visible = true; S.signGlow.visible = false;
        } else if (hint.counter) {
          const c = counter;
          S.setBox(S.glow, { x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2, z0: 0, z1: 1.08, w: c.x1 - c.x0 + 0.06, d: c.y1 - c.y0 + 0.08 }, 0);
          S.glow.visible = true; S.signGlow.visible = false;
        } else if (hint.loc) {
          S.setBox(S.glow, S.locBox(hint.loc), 0.03); S.glow.visible = true;
          const es = S.endSigns.find((e) => e.face === hint.loc.face);
          if (es) {
            S.signGlow.position.copy(es.mesh.position); S.signGlow.rotation.copy(es.mesh.rotation);
            S.signGlow.translateZ(0.01);
            S.signGlow.scale.set(es.mesh.geometry.parameters.width + 0.14, es.mesh.geometry.parameters.height + 0.14, 1);
            S.signGlow.material.opacity = 0.35 + 0.55 * pulse; S.signGlow.visible = true;
          }
        }
      }

      /* ---------- picked items fly into the tote ---------- */
      const flyers = [];
      const flyGeo = new T.BoxGeometry(1, 1, 1);
      function flyToTote(ln) {
        const it = ln.item, b = it.box, f = it.loc.face;
        const n = Math.min(3, ln.qty);
        for (let k = 0; k < n; k++) {
          const m = new T.Mesh(flyGeo, new T.MeshLambertMaterial({ color: it.colour }));
          const slide = it.trayRef ? 0.32 : (it.pull || 0);
          m.position.set(b.x + (k - (n - 1) / 2) * Math.min(0.04, b.w * 0.3), b.z + b.h / 2, b.y + f.out * slide);
          m.scale.set(Math.max(0.03, b.w * (it.trayRef ? 0.7 : 0.55)), Math.max(0.03, b.h * 0.7), Math.max(0.03, b.d * 0.5));
          m.layers.set(1 + idx); // only this player sees them fly into their tote
          scene.add(m);
          flyers.push({ m, from: m.position.clone(), s0: m.scale.clone(), t: -k * 0.07, dur: 0.55 });
        }
      }
      const _v = new T.Vector3(), _v2 = new T.Vector3();
      function updateFlyers(dt) {
        if (!flyers.length) return false;
        cam.updateMatrixWorld();
        for (let i = flyers.length - 1; i >= 0; i--) {
          const fl = flyers[i];
          fl.t += dt;
          const u = Math.max(0, Math.min(1, fl.t / fl.dur)), e = u * u * (3 - 2 * u);
          _v.set(0.22, -0.42, -0.55).applyMatrix4(cam.matrixWorld); // just under the bottom right of your view: the tote
          _v2.copy(fl.from).lerp(_v, e); _v2.y += Math.sin(u * Math.PI) * 0.25;
          fl.m.position.copy(_v2);
          fl.m.scale.copy(fl.s0).multiplyScalar(1 - 0.75 * e);
          fl.m.rotation.y += dt * 5;
          if (u >= 1) { scene.remove(fl.m); fl.m.material.dispose(); flyers.splice(i, 1); }
        }
        return true;
      }

      /* ---------- finishing an order: over the counter, or into the holding area ---------- */
      function finish(title, text) {
        SFX.done(); flash(false);
        const perfect = !slips;
        stats.orders++; life.orders++;
        if (order.counts) stats.picks++;
        if (perfect) { stats.perfect++; life.perfect = (life.perfect || 0) + 1; }
        saveLife();
        D.doneCount.textContent = String(stats.orders);
        banner(title, (perfect ? 'Perfect pick! ' : '') + text, 2400);
        order = null; state = day && day.over ? 'end' : 'list'; atCounter = false; hint.until = 0; carry = null;
        renderScanner();
      }
      function handOver() {
        if (state !== 'deliver' || !atCounter) return;
        const o = order, c = o.cust;
        let tote;
        if (o.kind === 'hold' && carry) tote = carry;
        else tote = S.makeTote(o.lines.map((l) => l.item.colour));
        if (c && c.fig) giveTote(c, tote, handX(me.x)); else S.dropTote(tote);
        day.handOver(o, P.id);
        finish(o.kind === 'hold' ? o.hold.code + ' handed over' : o.no + ' handed over',
          o.kind === 'hold' ? 'Click & collect for ' + o.hold.parcel.surname : plural(o.locs, 'line', 'lines') + ', ' + plural(o.units, 'unit', 'units'));
      }
      function checkCounter() {
        const h = world.handover, inside = me.x > h.x0 && me.x < h.x1 && me.y > h.y0 && me.y < h.y1 + 0.05;
        if (inside !== atCounter) { atCounter = inside; if (state === 'deliver') { renderScanner(); if (inside) toast('Press Enter to hand over'); } }
      }

      /* ---------- the function menu ---------- */
      function menu(open) {
        if (!open) { D.scMenu.hidden = true; return; }
        const items = [
          ['1', me.squat ? 'Stand up' : 'Squat', () => toggleSquat()],
          ['2', 'Hint', () => useHint()],
          ['3', 'Sound: ' + (audio.on ? 'on' : 'off'), () => { audio.on = !audio.on; try { localStorage.setItem('ws-sound', audio.on ? 'on' : 'off'); } catch (e) { /* fine */ } }],
          ['4', 'Look: ' + LOOKS[lookPick][0].toLowerCase(), () => { lookPick = (lookPick + 1) % LOOKS.length; try { localStorage.setItem('ws-look', LOOKS[lookPick][0]); } catch (e) { /* fine */ } toast('Look speed: ' + LOOKS[lookPick][0].toLowerCase()); }],
          ['5', 'Picks: ' + MODES[mode][1], () => { mode = (mode + 1) % MODES.length; try { localStorage.setItem('ws-orders', MODES[mode][0]); } catch (e) { /* fine */ } if (day) day.setMode(MODES[mode][0]); toast('Picks still to come: ' + MODES[mode][2]); }],
          ['6', 'Help', () => showHelp(true)],
          ['0', 'Close', () => {}]
        ];
        D.scMenu.replaceChildren();
        const h = document.createElement('h3'); h.textContent = 'Functions'; D.scMenu.appendChild(h);
        for (const [k, t, fn] of items) {
          const b = document.createElement('button'); b.type = 'button';
          const kb = document.createElement('b'); kb.textContent = k; b.appendChild(kb); b.appendChild(document.createTextNode(t));
          b.addEventListener('click', (e) => { e.stopPropagation(); SFX.key(); menu(false); fn(); renderScanner(); });
          b.dataset.k = k;
          D.scMenu.appendChild(b);
        }
        D.scMenu.hidden = false;
        menuSel = 0;
        if (P.padIndex !== null) P.menuMove(0);
      }
      P.menu = menu;
      // a controller in the Function menu: up and down move the highlight, A picks
      let menuSel = 0;
      P.menuMove = function (d) {
        const bs = Array.from(D.scMenu.querySelectorAll('button'));
        if (!bs.length) return;
        menuSel = (menuSel + d + bs.length) % bs.length;
        bs.forEach((b, i) => b.classList.toggle('pad-on', i === menuSel));
        if (d) SFX.key();
      };
      P.menuPick = function () { const b = D.scMenu.querySelectorAll('button')[menuSel]; if (b) b.click(); };

      /* ---------- the till ---------- */
      let nearTill = null;
      P.tillCust = null;
      let greetC = null, doorOn = null;
      function checkTill() { // standing behind the counter at one of your tills (the one by the gap is Sam's), or by the door, or by a customer to greet
        let best = null, g = null, dr = null;
        const behind = me.y < counter.y0 + 0.05 && me.y > counter.y0 - 1.75;
        if (behind) {
          let bd = 0.95;
          for (const t of tills) { if (t === ALEX_TILL || players.some((q) => q !== P && q.tillAt() === t)) continue; const d = Math.abs(me.x - tillX(t)); if (d < bd) { bd = d; best = t; } }
        }
        if (day && active && !(till && till.isOpen())) {
          if (behind && me.x > counter.x0 - 0.4 && me.x < counter.x1 + 0.4) {
            let gd = 2.4;
            for (const c of day.ungreeted()) { if (!c.fig) continue; const d = Math.abs(me.x - c.fig.group.position.x); if (d < gd) { gd = d; g = c; } }
          }
          if ((day.phase === 'unlock' || day.phase === 'lock') && Math.hypot(me.x - entX, me.y - (world.D - 0.4)) < 2.0) dr = day.phase;
        }
        const key = (best ? 't' : '') + (g ? 'g' + g.id : '') + (dr || '');
        const old = (nearTill ? 't' : '') + (greetC ? 'g' + greetC.id : '') + (doorOn || '');
        nearTill = best; greetC = g; doorOn = dr;
        if (key === old) return;
        D.tillBtn.hidden = !(nearTill || greetC || doorOn) || !active;
        D.tillBtn.firstChild.nodeValue = doorOn ? (doorOn === 'unlock' ? 'Unlock door' : 'Lock door') : greetC ? 'Greet' : 'Use till';
        renderScanner();
      }
      // the button, or Scan: unlock or lock the door, say hello to the customer, or open the till
      function useAction() {
        if (doorOn && day) {
          const ok = doorOn === 'unlock' ? day.unlock() : day.lock();
          if (ok) { SFX.order(); toast(doorOn === 'unlock' ? 'Door unlocked' : 'Door locked'); nearTill = greetC = doorOn = null; checkTill(); }
          return true;
        }
        if (greetC && day) {
          const c = greetC;
          if (day.greet(c, P.id)) { SFX.key(); toast('Hello!'); say('Hello, how can I help?', 'dim', 1600); }
          greetC = null; checkTill();
          return true;
        }
        return false;
      }
      P.useAction = useAction;
      function openTill() {
        if (!till || till.isOpen() || !nearTill) return;
        if (idx === 0 && locked()) document.exitPointerLock();
        keys.clear(); running = false; stickIn.x = stickIn.y = 0; lookIn.x = lookIn.y = 0;
        if (P.onTill) P.onTill();
        me.vx = me.vy = 0;
        SFX.key();
        till.open();
        callOver();
        D.say.hidden = true;
        dirty = true;
      }
      // the next till customer comes over to the till you're at
      function callOver() {
        if (!till || !till.isOpen() || !nearTill || !day) return;
        const c0 = P.tillCust;
        if (c0) { if (c0.at !== nearTill && c0.fig) callTo(c0, nearTill, () => talkTo(c0)); return; }
        const c = day.queue()[0];
        if (!c) {
          const o = screenOf(nearTill);
          if (o && !till.session()) till.showDone(o.no, o.status === 'listed' ? 'Waiting to be picked: it\'s on the pick list.' : 'Being picked now.');
          return;
        }
        if (!day.serve(c, P.id)) return;
        P.tillCust = c;
        showScreen(nearTill, null);
        callTo(c, nearTill, () => talkTo(c));
      }
      function talkTo(c) {
        if (P.tillCust !== c || !c.fig) return;
        const s = till.session();
        if (s && s.dayCust === c) return; // already talking
        speeches.delete(c.fig);
        till.serve(c.cust, c.lines, '#' + c.fig.parts.body.color.getHexString(), { kind: c.kind, kiosk: c.kiosk, pay: c.pay, hello: c.say, dayCust: c });
      }
      function closeTill() {
        if (!till || !till.isOpen()) return;
        till.close();
        // not talking yet: back in the queue for whoever's free
        const c = P.tillCust;
        if (c && (!till.session() || till.stage() === 'arrived')) { P.tillCust = null; till.clear(); day.unserve(c); }
        if (idx === 0) canvas.focus({ preventScroll: true });
        sayShown = performance.now() - 9000; dirty = true; // their last words stay up a few seconds
        renderScanner();
      }
      function tillComplete(info) {
        const c = P.tillCust;
        if (!c || !day) return null;
        const o = day.tillDone(c, info.lines, { till: c.at || nearTill });
        showScreen(c.at || nearTill, o);
        P.tillCust = null; stats.tills++;
        toast('Order ' + o.no + ' is on the pick list', 'good');
        later(2.2, () => { if (till.isOpen() && (!till.session() || till.stage() === 'done')) callOver(); });
        renderScanner();
        return o.no;
      }
      P.tillOpen = () => !!(till && till.isOpen());
      P.tillAt = () => (till && till.isOpen() ? nearTill : null);

      /* ---------- what your till customer says: a bubble over their head ---------- */
      let sayShown = 0, sayLine = null;
      function speak(line) {
        sayLine = line; sayShown = performance.now();
        D.sayText.replaceChildren();
        const add = (tag, text) => { if (!text) return; const n = document.createElement(tag); n.textContent = text; D.sayText.appendChild(n); D.sayText.appendChild(document.createTextNode(' ')); };
        add('span', line.text); add('q', line.quote); add('span', line.hint); add('b', line.qty);
        if (!till || !till.isOpen()) SFX.talk();
        renderScanner();
      }
      const _head = new T.Vector3();
      function placeSay() {
        const c = P.tillCust || (till && till.session() && till.session().dayCust);
        const on = sayLine && c && c.fig && (!till || !till.isOpen()) && active && performance.now() - sayShown < (sayLine.quote ? 24000 : 14000);
        if (!on) { if (!D.say.hidden) D.say.hidden = true; return; }
        const f = c.fig;
        _head.set(f.group.position.x, 1.98 * f.group.scale.y, f.group.position.z).project(cam);
        const far = Math.hypot(me.x - f.group.position.x, me.y - f.group.position.z);
        if (_head.z > 1 || _head.z < -1 || far > 16) { if (!D.say.hidden) D.say.hidden = true; return; }
        if (D.say.hidden) D.say.hidden = false;
        const w = D.say.offsetWidth, h = D.say.offsetHeight;
        let x = (_head.x + 1) / 2 * view.w - w / 2, y = (1 - _head.y) / 2 * view.h - h - 12;
        x = Math.max(8, Math.min(view.w - w - 8, x)); y = Math.max(52, Math.min(view.h - h - 8, y));
        D.say.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
      }

      const till = window.ShiftTillUI.create({
        el: D.till, world, Till, touch,
        sfx: (n) => { const f = { key: SFX.key, beep: SFX.scan, good: SFX.pick, bad: SFX.bad, talk: SFX.talk, approved: SFX.approved, drawer: SFX.drawer, done: SFX.chime }[n]; if (f) f(); },
        onClose: () => closeTill(),
        onComplete: (info) => tillComplete(info),
        onSpeech: (line) => speak(line),
        onSlip: () => { stats.tillSlips = (stats.tillSlips || 0) + 1; },
        idleText: () => (P.tillCust && !P.tillCust.ready ? 'The customer is coming over to this till.' : day && day.queue().length ? 'A customer is waiting at the counter: they\'re coming over.' : 'No customer is waiting to order at the till. Their orders are on the pick list.')
      });
      P.till = till;

      /* ---------- speech bubbles: Sam and the customers, only when near and nothing tall is in the way ---------- */
      const bubs = new Map(); // who -> {el, p}
      function bubFor(key, cls) {
        let b = bubs.get(key);
        if (!b) {
          const el = document.createElement('div'); el.className = 'ws-bub ' + cls; el.hidden = true;
          const p = document.createElement('p'); el.appendChild(p);
          D.root.insertBefore(el, D.say);
          b = { el, p, line: null }; bubs.set(key, b);
        }
        return b;
      }
      function fillBub(b, sp) {
        if (b.line === sp.line) return;
        b.line = sp.line;
        b.p.replaceChildren();
        const add = (tag, text) => { if (!text) return; const n = document.createElement(tag); n.textContent = text; b.p.appendChild(n); b.p.appendChild(document.createTextNode(' ')); };
        if (sp.name) add('b', sp.name);
        const q = sp.line.quote && sp.line.quote.length > 110 ? sp.line.quote.slice(0, 107).trim() + '…' : sp.line.quote;
        add('span', sp.line.text); add('q', q); add('span', sp.line.hint); add('i', sp.line.qty);
      }
      function crosses(ax, ay, bx, by, r) { // does the line from a to b cross the rectangle?
        let t0 = 0, t1 = 1;
        const dx = bx - ax, dy = by - ay;
        const clip = (p, q) => { if (Math.abs(p) < 1e-9) return q >= 0; const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; } return true; };
        return clip(-dx, ax - r.x0) && clip(dx, r.x1 - ax) && clip(-dy, ay - r.y0) && clip(dy, r.y1 - ay) && t0 <= t1;
      }
      function inSight(x, y) { // no racking or wall between you and there
        for (const r of world.rows) if (crosses(me.x, me.y, x, y, r)) return false;
        for (const w of world.walls) if (crosses(me.x, me.y, x, y, { x0: w[0], y0: w[1], x1: w[2], y1: w[3] })) return false;
        return true;
      }
      const _bp = new T.Vector3(), _bq = new T.Vector3();
      function placeBubs(now) {
        const open = till && till.isOpen(), used = [];
        if (!D.say.hidden) { const r = D.say.getBoundingClientRect(), o = D.root.getBoundingClientRect(); used.push({ x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height }); }
        for (const [key, b] of bubs) if (!speeches.has(key)) { b.el.hidden = true; }
        for (const [key, sp] of speeches) {
          if (now > sp.until) { speeches.delete(key); const b0 = bubs.get(key); if (b0) b0.el.hidden = true; continue; }
          const b = bubFor(key, sp.cls);
          let show = !open && active;
          if (show) {
            sp.at(_bp);
            if (Math.hypot(me.x - _bp.x, me.y - _bp.z) > 11 || !inSight(_bp.x, _bp.z)) show = false;
            else { _bq.copy(_bp).project(cam); if (_bq.z > 1 || _bq.z < -1) show = false; }
          }
          if (!show) { if (!b.el.hidden) b.el.hidden = true; continue; }
          fillBub(b, sp);
          if (b.el.hidden) b.el.hidden = false;
          const w = b.el.offsetWidth, h = b.el.offsetHeight;
          let x = (_bq.x + 1) / 2 * view.w - w / 2, y = (1 - _bq.y) / 2 * view.h - h - 10;
          x = Math.max(8, Math.min(view.w - w - 8, x)); y = Math.max(52, Math.min(view.h - h - 8, y));
          for (const t of used) if (x < t.x + t.w + 4 && x + w + 4 > t.x && y < t.y + t.h + 4 && y + h + 4 > t.y) y = t.y + t.h + 8;
          used.push({ x, y, w, h });
          b.el.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
        }
      }

      /* ---------- squat ---------- */
      function toggleSquat() {
        me.squat = !me.squat;
        D.squatBtn.setAttribute('aria-pressed', String(me.squat));
        D.squatBtn.firstChild.textContent = me.squat ? 'Stand' : 'Squat';
        SFX.key();
      }

      /* ---------- scanner buttons ---------- */
      const press = (el, fn) => {
        el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); initAudio(); fn(e); });
        const up = () => el.classList.remove('down');
        el.addEventListener('pointerup', up); el.addEventListener('pointerleave', up); el.addEventListener('pointercancel', up);
        el.addEventListener('click', (e) => e.preventDefault());
      };
      press(D.scScan, () => { const c = centreNdc(); scanAt(c[0], c[1]); });
      press(D.scEnter, () => { SFX.key(); enter(); });
      press(D.scFn, () => { SFX.key(); menu(D.scMenu.hidden); });
      press(D.scBack, () => back());
      press(D.scLogoff, () => { SFX.key(); endShift(); });
      press(D.scHint, () => useHint());
      press(D.tillBtn, () => { if (!useAction()) openTill(); });
      press(D.scKbd, () => { SFX.key(); toast(state === 'list' ? 'Up and down choose, Enter starts the pick' : 'No typing: scan the location once for each item'); });
      press(D.scUp, () => page(-1)); press(D.scDown, () => page(1));
      press(D.scPrev, () => page(-1)); press(D.scNext, () => page(1));
      D.scPad.querySelectorAll('button').forEach((b) => press(b, () => { const k = b.dataset.k; if (k === 'back') back(); else if (k === 'enter') enter(); else digit(k); }));
      D.scRows.addEventListener('pointerdown', (e) => { const li = e.target.closest('li[data-i]'); if (!li) return; e.preventDefault(); e.stopPropagation(); initAudio(); tapRow(+li.dataset.i); });
      press(D.squatBtn, () => toggleSquat());
      D.scanner.addEventListener('pointerdown', (e) => e.stopPropagation());
      D.scScreen.addEventListener('scroll', (e) => { e.target.scrollTop = 0; e.target.scrollLeft = 0; }); // never scrolled (older browsers without overflow: clip)

      /* ---------- a controller (game.js gives each player theirs: padIndex) ---------- */
      // Left stick walks (right out to jog), right stick looks, RT scans, A is Enter (detailedfoil), B is Back, X squats, Y is
      // Hint, the d-pad goes up and down the pick list (and the lines of a pick), Start opens the Function menu, View is
      // help, LT held jogs. At the till the d-pad (or stick) moves a highlight and tillui.js does the rest.
      P.padIndex = null;
      let padPrev = [], padWalk = false, padRun = false;
      const rep = { dir: null, t: 0 };
      P.dropPad = () => { if (padWalk) { stickIn.x = stickIn.y = 0; } lookIn.x = lookIn.y = 0; if (padRun) running = false; padWalk = padRun = false; till.usePad(false); };
      P.readPad = function (gp, dt) {
        const now = gp.buttons.map((b) => !!(b && (b.pressed || b.value > 0.5)));
        const prev = padPrev, hit = (i) => now[i] && !prev[i];
        padPrev = now;
        const lx = padAxis(gp, 0), ly = padAxis(gp, 1), rx = padAxis(gp, 2), ry = padAxis(gp, 3);
        // a direction: the d-pad, or the left stick pushed well over where it doesn't walk; held, it repeats
        const stickDir = Math.max(Math.abs(lx), Math.abs(ly)) > 0.6 ? (Math.abs(lx) > Math.abs(ly) ? (lx > 0 ? 'right' : 'left') : (ly > 0 ? 'down' : 'up')) : null;
        const dpad = now[12] ? 'up' : now[13] ? 'down' : now[14] ? 'left' : now[15] ? 'right' : null;
        const steer = (stick) => {
          const d = dpad || (stick ? stickDir : null);
          if (!d) { rep.dir = null; return null; }
          if (d !== rep.dir) { rep.dir = d; rep.t = 0.38; return d; }
          rep.t -= dt;
          if (rep.t <= 0) { rep.t = 0.11; return d; }
          return null;
        };
        const still = () => { if (padWalk) { stickIn.x = stickIn.y = 0; padWalk = false; } lookIn.x = lookIn.y = 0; };
        // a cover (start, help, end of shift, end of the day): A goes on, B closes help
        const cover = ['startCover', 'helpCover', 'endCover', 'dayCover'].map($).find((c) => !c.hidden);
        if (cover) {
          still();
          if (hit(0) || hit(9)) { const go = cover.querySelector('.ws-go'); if (go) go.click(); } else if (hit(1) && cover.id === 'helpCover') showHelp(false);
          return;
        }
        if (till.isOpen()) {
          still();
          const d = steer(true);
          if (d) till.pad(d);
          if (hit(0)) till.pad('a'); if (hit(1)) till.pad('b'); if (hit(2)) till.pad('x'); if (hit(3)) till.pad('y');
          if (hit(6)) till.pad('tabL'); if (hit(7)) till.pad('tabR'); if (hit(4)) till.pad('rt'); if (hit(5)) till.pad('rb');
          if (hit(9)) closeTill();
          return;
        }
        if (!D.scMenu.hidden) {
          still();
          const d = steer(true);
          if (d === 'up' || d === 'down') P.menuMove(d === 'up' ? -1 : 1);
          if (hit(0)) P.menuPick(); else if (hit(1) || hit(9)) { SFX.key(); menu(false); }
          return;
        }
        if (!active) return;
        if (lx || ly || padWalk) { stickIn.x = lx; stickIn.y = ly; padWalk = !!(lx || ly); }
        const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.6);
        lookIn.x = curve(rx); lookIn.y = curve(ry);
        if (now[6] !== padRun) { padRun = now[6]; running = padRun; }
        if (hit(7)) { initAudio(); const c = centreNdc(); scanAt(c[0], c[1]); }
        if (hit(1)) back();
        if (hit(2)) toggleSquat();
        if (hit(3)) useHint();
        if (hit(0)) { SFX.key(); enter(); }
        if (hit(9)) { SFX.key(); menu(true); }
        if (hit(8)) showHelp(true);
        const d = steer(false);
        if (d === 'up' || d === 'left') page(-1); else if (d === 'down' || d === 'right') page(1);
      };

      /* ---------- each frame ---------- */
      P.playing = () => active && $('helpCover').hidden && $('endCover').hidden && $('dayCover').hidden && !(till && till.isOpen());
      P.update = function (dt, now) {
        let changed = false;
        if (P.playing()) {
          if (stepMove(dt)) changed = true;
          checkCounter();
          checkTill();
        }
        if (openTimer > 0) { openTimer -= dt; if (openTimer <= 0 && state !== 'qty' && openTray) openTray.target = 0; }
        if (openTray && openTray.slide <= 0.001 && openTray.target === 0) openTray = null;
        if (pulled && !pulling.has(pulled)) pulled = null;
        if (updateFlyers(dt)) changed = true;
        if (updateHint(dt)) changed = true;
        if (viewTimer > 0) { viewTimer -= dt; if (viewTimer <= 0 && viewLine >= 0) { viewLine = -1; renderScanner(); } }
        if (msg && now > msgUntil) { msg = null; renderScanner(); }
        if (!D.say.hidden && sayLine && now - sayShown > (sayLine.quote ? 24000 : 14000)) D.say.hidden = true;
        return changed;
      };
      P.beforeRender = () => { if (active) updateAim(); else S.aimBox.visible = false; applyHint(); };
      P.afterRender = (now) => { placeSay(); placeBubs(now); };
      P.start = () => { if (state === 'idle') state = day && day.over ? 'end' : 'list'; renderScanner(); };
      P.show = () => { D.scanner.hidden = false; D.cross.hidden = false; D.chips.hidden = false; D.squatBtn.hidden = !touch && idx > 0; D.tag.hidden = !split; };
      // things the controls and the tests use
      Object.assign(P, { banner, scanAt, enter, back, page, digit, useHint, toggleSquat, openTill, closeTill, countOne, confirmQty, handOver, hitAt, holdHit, scanHold, scanPut, tapRow,
        state: () => state, order: () => order, full: () => full, sel: () => sel, nearTill: () => nearTill, keysClear: () => { keys.clear(); running = false; stickIn.x = stickIn.y = 0; lookIn.x = lookIn.y = 0; } });
      renderScanner();
      return P;
    }

    /* ---------- controllers (the Gamepad API's standard layout) ---------- */
    const DZ = 0.2; // the middle of a stick that does nothing
    function padAxis(gp, i) { const v = gp.axes[i] || 0, a = Math.abs(v); return a < DZ ? 0 : Math.sign(v) * Math.min(1, (a - DZ) / (1 - DZ)); }
    function padList() { try { return navigator.getGamepads ? Array.from(navigator.getGamepads()) : []; } catch (e) { return []; } }
    const padUsed = (gp) => gp.buttons.some((b, i) => i !== 16 && b && (b.pressed || b.value > 0.5)) || gp.axes.some((v) => Math.abs(v) > 0.5);
    // a controller nobody has yet: the first player without one gets it the moment it's used
    function claimPads(list) {
      for (const gp of list) {
        if (!gp || !gp.connected || players.some((p) => p.padIndex === gp.index) || !padUsed(gp)) continue;
        const p = players.find((x) => x.padIndex === null);
        if (!p) return;
        p.padIndex = gp.index; // the press that claims it counts too
        p.toast('Controller on: RT scans, A is Enter, B is Back');
      }
    }
    const joinPrev = new Map(); // controller -> buttons down last time, on the join screen
    function pollPads(dt) {
      const list = padList();
      if (!list.some(Boolean)) return;
      if (joining) {
        for (const gp of list) {
          if (!gp || !gp.connected) continue;
          const now = gp.buttons.map((b) => !!(b && (b.pressed || b.value > 0.5))), prev = joinPrev.get(gp.index) || [];
          joinPrev.set(gp.index, now);
          const hit = (i) => now[i] && !prev[i];
          const mine = joined.some((j) => j.kind === 'pad' && j.pad === gp.index);
          if (mine && joined.length >= 2 && (hit(0) || hit(9))) { startSplit(); return; }
          if (mine && hit(1)) { leaveJoin(); return; }
          if (!mine && (hit(0) || hit(9))) join({ kind: 'pad', pad: gp.index });
        }
        return;
      }
      if (!split) claimPads(list);
      for (const p of players) {
        if (p.padIndex === null) continue;
        const gp = list[p.padIndex];
        if (gp && gp.connected) p.readPad(gp, dt); else { p.padIndex = null; p.dropPad(); p.toast('Controller disconnected'); }
      }
    }

    /* ---------- player 1: the page's own elements ---------- */
    // a player's elements: everything in their container with a data-el name
    function grab(root) { const D = { root }; root.querySelectorAll('[data-el]').forEach((n) => { D[n.dataset.el] = n; }); return D; }
    let split = false;
    const pvCopy = $('pv1').cloneNode(true); // a clean copy, for player 2
    const me1 = makePlayer(0, grab($('pv1')));
    const D1 = me1.D;
    players.push(me1);
    const me = me1.me;
    function layout() {
      const vw = Math.max(1, window.innerWidth), vh = Math.max(1, window.innerHeight);
      renderer.setSize(vw, vh, false);
      if (split && players[1]) { const h = Math.floor(vh / 2); players[0].layout({ x: 0, y: 0, w: vw, h }); players[1].layout({ x: 0, y: h, w: vw, h: vh - h }); }
      else me1.layout({ x: 0, y: 0, w: vw, h: vh });
    }
    // player 2 (split screen): a copy of player 1's things, in the bottom half
    function addPlayer2() {
      const root = pvCopy.cloneNode(true);
      root.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      root.removeAttribute('id'); root.classList.add('p2');
      root.querySelector('[data-el="tag"]').textContent = 'Player 2';
      $('pv1').after(root);
      const p2 = makePlayer(1, grab(root));
      players.push(p2);
      p2.render();
      return p2;
    }
    // who the keyboard and mouse belong to: player 1, or in split screen whoever joined with them
    const kbPlayer = () => (split ? players.find((p) => p.kb) || null : me1);
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', () => setTimeout(layout, 250));
    layout();

    /* ---------- controls: the stick (left thumb), looking (drag), tapping to scan ---------- */
    const zone = $('stickZone'), stick = $('stick'), knob = $('knob');
    let stickId = null, stickC = null;
    const stickHome = () => { stick.style.left = ''; stick.style.top = ''; stick.classList.remove('live'); knob.style.transform = ''; };
    me1.onTill = () => { stickId = null; stickHome(); looks.clear(); };
    const canvasNdc = (p, e) => { const r = canvas.getBoundingClientRect(), v = p.view; return [((e.clientX - r.left - v.x) / v.w) * 2 - 1, -((e.clientY - r.top - v.y) / v.h) * 2 + 1]; };
    zone.addEventListener('pointerdown', (e) => {
      if (stickId !== null) return;
      e.preventDefault(); initAudio();
      stickId = e.pointerId; try { zone.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
      const r = zone.getBoundingClientRect();
      stickC = { x: e.clientX, y: e.clientY };
      stick.style.left = (e.clientX - r.left) + 'px'; stick.style.top = (e.clientY - r.top) + 'px'; stick.classList.add('live');
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== stickId) return;
      const R = 52;
      let dx = (e.clientX - stickC.x) / R, dy = (e.clientY - stickC.y) / R;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      me1.input.stick.x = dx; me1.input.stick.y = dy;
      knob.style.transform = 'translate(' + (dx * R * 0.85) + 'px,' + (dy * R * 0.85) + 'px)';
    });
    const stickEnd = (e) => { if (e.pointerId !== stickId) return; stickId = null; me1.input.stick.x = me1.input.stick.y = 0; stickHome(); };
    zone.addEventListener('pointerup', stickEnd); zone.addEventListener('pointercancel', stickEnd);

    const looks = new Map();
    const locked = () => document.pointerLockElement === canvas;
    function lockMouse() { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (x) { /* not allowed */ } }
    canvas.addEventListener('pointerdown', (e) => {
      const kp = kbPlayer();
      if (joining) { join({ kind: 'kb' }); e.preventDefault(); return; }
      if (!kp || !kp.playing()) return;
      initAudio();
      if (e.pointerType === 'mouse') {
        if (!locked() && !mouseDrag) { lockMouse(); e.preventDefault(); return; }
        if (locked()) { if (e.button === 0) { const c = kp.centre(); kp.scanAt(c[0], c[1]); } e.preventDefault(); return; }
      }
      if (split) return; // touch is for one player
      try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
      looks.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = looks.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      const k = (e.pointerType === 'mouse' ? 0.005 : 0.0065) * LOOKS[lookPick][1], kp = kbPlayer();
      if (!kp) return;
      kp.me.yaw -= dx * k; kp.me.pitch -= dy * k; kp.applyCam(); dirty = true;
    });
    const lookEnd = (e) => {
      const p = looks.get(e.pointerId);
      if (!p) return;
      looks.delete(e.pointerId);
      if (e.type === 'pointerup' && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 10 && performance.now() - p.t < 450) { // a tap: scan what's there
        const kp = kbPlayer();
        if (kp) { const c = canvasNdc(kp, e); kp.scanAt(c[0], c[1]); }
      }
    };
    canvas.addEventListener('pointerup', lookEnd); canvas.addEventListener('pointercancel', lookEnd);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    let mouseDrag = false; // if the mouse can't be captured, dragging looks round instead
    document.addEventListener('pointerlockerror', () => { mouseDrag = true; const kp = kbPlayer(); if (kp) kp.toast('Drag with the mouse to look round'); });
    document.addEventListener('pointerlockchange', () => { const kp = kbPlayer(); if (locked() && kp) kp.toast('Esc lets go of the mouse'); dirty = true; });
    document.addEventListener('mousemove', (e) => {
      const kp = kbPlayer();
      if (!kp || !locked() || Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
      const k = 0.0022 * LOOKS[lookPick][1];
      kp.me.yaw -= e.movementX * k; kp.me.pitch -= e.movementY * k; kp.applyCam(); dirty = true;
    });

    /* ---------- controls: keyboard ---------- */
    const KEYMAP = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', KeyD: 'r', ArrowLeft: 'tl', ArrowRight: 'tr', KeyQ: 'tl', KeyE: 'tr' };
    window.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (joining) { if (e.key === 'Escape') { leaveJoin(); return; } if (joined.length >= 2 && e.key === 'Enter') { startSplit(); e.preventDefault(); return; } join({ kind: 'kb' }); e.preventDefault(); return; }
      const p = kbPlayer();
      if (!p) return;
      const D = p.D;
      if (p.till.isOpen() && $('helpCover').hidden) { if (e.key === 'Escape') p.closeTill(); return; }
      if (!p.playing()) { if (e.key === 'Escape' && !$('helpCover').hidden) showHelp(false); return; }
      if (!D.scMenu.hidden) {
        const b = D.scMenu.querySelector('button[data-k="' + e.key + '"]');
        if (b) { b.click(); e.preventDefault(); return; }
        if (e.key === 'Escape' || e.key === 'Tab') { p.menu(false); e.preventDefault(); return; }
      }
      // on the pick list the arrow keys choose an order
      if (p.state() === 'list' && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) { if (!e.repeat) p.page(e.code === 'ArrowUp' ? -1 : 1); e.preventDefault(); return; }
      if (KEYMAP[e.code]) { p.input.keys.add(KEYMAP[e.code]); e.preventDefault(); return; }
      if (e.key === 'Shift') { p.input.run(true); return; }
      if (e.repeat) return;
      if (/^[0-9]$/.test(e.key)) { p.digit(e.key); e.preventDefault(); return; }
      switch (e.code) {
        case 'KeyF': case 'Space': { const c = p.centre(); p.scanAt(c[0], c[1]); e.preventDefault(); break; }
        case 'KeyC': p.toggleSquat(); break;
        case 'KeyH': case 'F4': p.useHint(); e.preventDefault(); break;
        case 'Enter': case 'NumpadEnter': SFX.key(); p.enter(); e.preventDefault(); break;
        case 'Backspace': p.back(); e.preventDefault(); break;
        case 'Tab': case 'KeyM': SFX.key(); p.menu(D.scMenu.hidden); e.preventDefault(); break;
        case 'PageUp': case 'BracketLeft': p.page(-1); break;
        case 'PageDown': case 'BracketRight': p.page(1); break;
        default:
      }
    });
    window.addEventListener('keyup', (e) => { const p = kbPlayer(); if (!p) return; if (KEYMAP[e.code]) p.input.keys.delete(KEYMAP[e.code]); if (e.key === 'Shift') p.input.run(false); });
    window.addEventListener('blur', () => { for (const p of players) p.keysClear(); stickId = null; stickHome(); });

    /* ---------- screens: start, help, end of shift, end of the day ---------- */
    function showHelp(on) { $('helpCover').hidden = !on; if (on && locked()) document.exitPointerLock(); }
    $('helpBtn').addEventListener('click', () => showHelp(true));
    $('howBtn').addEventListener('click', () => showHelp(true));
    $('helpClose').addEventListener('click', () => showHelp(false));
    $('helpX').addEventListener('click', () => showHelp(false));
    function statsHtml(el, rows) {
      el.replaceChildren();
      const box = document.createElement('div'); box.className = 'ws-stats';
      for (const [v, l] of rows) { const d = document.createElement('div'), b = document.createElement('b'), s = document.createElement('span'); b.textContent = v; s.textContent = l; d.append(b, s); box.appendChild(d); }
      el.appendChild(box);
    }
    function endShift() {
      if (locked()) document.exitPointerLock();
      const st = me1.stats, mins = Math.max(1, Math.round((Date.now() - st.since) / 60000));
      statsHtml($('endStats'), [[st.orders, 'orders'], [st.lines, 'lines picked'], [st.units, 'units'], [st.perfect, 'perfect picks'], [st.wrong, 'wrong scans'], [mins + ' min', 'on shift']]);
      $('endCover').hidden = false;
    }
    $('keepBtn').addEventListener('click', () => { $('endCover').hidden = true; });
    // all 20 picks done and nobody waiting: your own day, nothing about Sam's (detailedfoil)
    function dayOver() {
      SFX.dayEnd();
      for (const p of players) p.dayOver();
      later(1.2, () => {
        if (locked()) document.exitPointerLock();
        const box = $('dayStats');
        box.replaceChildren();
        for (const p of players) {
          const s = day.summary(p.id), st = p.stats, el = document.createElement('div');
          if (split) { const h = document.createElement('h2'); h.textContent = p.idx ? 'Player 2 (bottom)' : 'Player 1 (top)'; el.appendChild(h); }
          const rows = document.createElement('div'); el.appendChild(rows);
          statsHtml(rows, [[s.picks, 'of the ' + s.total + ' picks'], [st.tills - (st.tillsAtStart || 0), 'till orders served'], [s.fetched, 'bags from holding'], [st.lines - (st.linesAtStart || 0), 'lines picked'], [st.perfect - (st.perfectAtStart || 0), 'perfect picks'], [Math.max(1, Math.round(s.minutes)) + ' min', 'the day took']]);
          box.appendChild(el);
        }
        $('dayTitle').textContent = 'All picks clear';
        $('dayCover').hidden = false;
      });
    }
    $('nextDayBtn').addEventListener('click', () => {
      $('dayCover').hidden = true;
      for (const p of players) { const st = p.stats; st.tillsAtStart = st.tills; st.linesAtStart = st.lines; st.perfectAtStart = st.perfect; }
      newDay();
      for (const p of players) p.start();
    });
    $('fullBtn').hidden = !(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
    function fullScreen(on) {
      const de = document.documentElement;
      try {
        if (on && !document.fullscreenElement) {
          const p = (de.requestFullscreen || de.webkitRequestFullscreen).call(de, { navigationUI: 'hide' });
          if (p && p.then) p.then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* fine */ } }).catch(() => {});
        } else if (!on && document.fullscreenElement) document.exitFullscreen();
      } catch (e) { /* not allowed here */ }
    }
    $('fullBtn').addEventListener('click', () => fullScreen(!document.fullscreenElement));
    const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
    // the rotate prompt (phones held upright)
    const rot = $('rotate');
    let upright = false;
    try { upright = sessionStorage.getItem('ws-upright') === '1'; } catch (e) { /* fine */ }
    rot.classList.toggle('ask', touch && !upright);
    $('portraitBtn').addEventListener('click', () => { upright = true; rot.classList.remove('ask'); try { sessionStorage.setItem('ws-upright', '1'); } catch (e) { /* fine */ } });

    newDay(); // the holding area is stocked behind the start screen; the day's picks start with the shift
    statsHtml($('startStats'), [[me1.life.orders, 'orders done'], [me1.life.lines, 'lines picked'], [world.items.length.toLocaleString('en-GB'), 'products']]);
    function beginShift() {
      initAudio();
      if (touch && !standalone) fullScreen(true);
      $('startCover').hidden = true; $('joinCover').hidden = true;
      $('topBar').hidden = false;
      for (const p of players) p.show();
      $('stickZone').hidden = !touch || split;
      active = true;
      stayAwake();
      layout();
      for (const p of players) p.start();
      for (const p of players) p.till.preload();
      let helped = false;
      try { helped = localStorage.getItem('ws-helped') === '1'; localStorage.setItem('ws-helped', '1'); } catch (e) { /* fine */ }
      if (!helped) showHelp(true);
      else if (!touch) for (const p of players) p.toast(p.kb ? 'Click the view to look round' : 'Your controller: RT scans, A is Enter');
      canvas.focus({ preventScroll: true });
      dirty = true;
    }
    $('startBtn').addEventListener('click', beginShift);

    /* ---------- two players (computers only): split screen, one above the other ---------- */
    // Each joins with a press: A on a controller, or any key or a click for the keyboard and mouse. The first to join
    // plays in the top half. Both share the day's list, Sam and the tills; each has their own scanner and till screen.
    let joining = false;
    const joined = [];
    $('twoBtn').hidden = touch || window.innerWidth < 900; // computers only
    function renderJoin() {
      ['joinTop', 'joinBottom'].forEach((id, i) => {
        const j = joined[i], el = $(id);
        el.classList.toggle('on', !!j);
        el.querySelector('span').textContent = !j ? 'Waiting for a player' : j.kind === 'kb' ? 'Keyboard and mouse' : 'Controller ' + (j.pad + 1);
      });
      $('joinGo').disabled = joined.length < 2;
      $('joinGo').textContent = joined.length < 2 ? 'Start shift' : 'Start shift (A or Enter)';
    }
    function join(dev) {
      if (joined.length >= 2 || joined.some((j) => j.kind === dev.kind && (dev.kind === 'kb' || j.pad === dev.pad))) return;
      initAudio(); SFX.chime();
      joined.push(dev);
      renderJoin();
    }
    function leaveJoin() { joining = false; joined.length = 0; $('joinCover').hidden = true; $('startCover').hidden = false; }
    $('twoBtn').addEventListener('click', (e) => { e.stopPropagation(); joining = true; joined.length = 0; joinPrev.clear(); for (const gp of padList()) if (gp) joinPrev.set(gp.index, gp.buttons.map((b) => !!(b && (b.pressed || b.value > 0.5)))); renderJoin(); $('startCover').hidden = true; $('joinCover').hidden = false; });
    $('joinBack').addEventListener('click', (e) => { e.stopPropagation(); leaveJoin(); });
    $('joinGo').addEventListener('click', (e) => { e.stopPropagation(); if (joined.length >= 2) startSplit(); });
    $('joinCover').addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) join({ kind: 'kb' }); });
    function startSplit() {
      if (split || joined.length < 2) return;
      joining = false; split = true;
      stage.classList.add('split');
      addPlayer2();
      players.forEach((p, i) => { const j = joined[i]; p.padIndex = j.kind === 'pad' ? j.pad : null; p.kb = j.kind === 'kb'; });
      dpr = Math.min(dpr, 1.25); renderer.setPixelRatio(dpr);
      layout();
      beginShift();
    }

    /* ---------- keep the screen awake while picking ---------- */
    let wake = null;
    async function stayAwake() {
      try { if (navigator.wakeLock && !wake && !document.hidden && active) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { wake = null; }
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { stayAwake(); last = performance.now(); } else for (const p of players) p.keysClear(); });

    /* ---------- install (a home screen app that works offline once loaded) ---------- */
    const installBtn = $('installBtn');
    let promptEvent = null;
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); promptEvent = e; installBtn.hidden = standalone; });
    window.addEventListener('appinstalled', () => { installBtn.hidden = true; promptEvent = null; });
    if (!standalone && /iPad|iPhone|iPod/.test(navigator.userAgent)) installBtn.hidden = false;
    installBtn.addEventListener('click', async () => {
      if (promptEvent) { const e = promptEvent; promptEvent = null; await e.prompt(); }
      else alert(/iPad|iPhone|iPod/.test(navigator.userAgent) ? 'In Safari, tap Share, then Add to Home Screen.' : 'Open the browser menu and choose Install app or Add to Home screen.');
    });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('warehouse-shift-sw.js', { scope: 'warehouse-shift' }).catch(() => {});

    /* ---------- the shared world, a step at a time ---------- */
    function worldStep(dt) {
      let changed = false;
      runTimers(dt);
      if (active && day) day.tick(dt);
      if (updateMoving(dt)) changed = true;
      if (updateFigs(dt)) changed = true;
      if (updateTotes(dt)) changed = true;
      if (active && updateCrew(dt)) changed = true;
      return changed;
    }

    function drawViews() {
      if (!split || players.length < 2) { me1.beforeRender(); renderer.setScissorTest(false); renderer.render(scene, me1.cam); return; }
      const vh = Math.max(1, window.innerHeight);
      renderer.setScissorTest(true);
      for (const p of players) {
        const v = p.view, y = vh - v.y - v.h; // the graphics chip counts from the bottom
        renderer.setViewport(v.x, y, v.w, v.h); renderer.setScissor(v.x, y, v.w, v.h);
        p.beforeRender();
        renderer.render(scene, p.cam);
      }
      renderer.setScissorTest(false);
    }

    /* ---------- the frame loop ---------- */
    let last = performance.now(), photoT = 0, photoDirty = true, slow = 0, quick = 0, photoTurn = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      if (document.hidden) return;
      let changed = dirty;
      pollPads(dt);
      for (const p of players) if (p.update(dt, now)) { changed = true; photoDirty = true; }
      if (worldStep(dt)) changed = true;
      if (S.photos.flush()) changed = true;
      photoT -= dt;
      if (photoT <= 0 && (photoDirty || changed)) { photoTurn = (photoTurn + 1) % players.length; S.photos.update(players[photoTurn].cam); photoT = 0.2; photoDirty = false; changed = true; }
      if (!changed) return;
      dirty = false;
      drawViews();
      for (const p of players) p.afterRender(now);
      // a phone that keeps struggling draws fewer pixels; one with room to spare gets them back
      if (dt > 0.03 && me.speed > 0.2) { slow++; quick = 0; } else if (dt < 0.018) { quick++; slow = Math.max(0, slow - 1); }
      if (slow > 45 && dpr > 0.8) { dpr = Math.max(0.8, dpr - 0.25); renderer.setPixelRatio(dpr); layout(); slow = 0; }
      if (quick > 300 && dpr < (split ? 1.25 : MAX_DPR)) { dpr = Math.min(split ? 1.25 : MAX_DPR, dpr + 0.25); renderer.setPixelRatio(dpr); layout(); quick = 0; }
    }

    /* ---------- warm up behind the loading bar, then show the start screen ---------- */
    progress(0.9, 'Nearly there…'); await breathe();
    try { renderer.compile(scene, me1.cam); } catch (e) { /* compiled on first draw instead */ }
    S.photos.update(me1.cam);
    renderer.render(scene, me1.cam);
    progress(1);
    await breathe();
    $('loading').hidden = true;
    $('startCover').hidden = false;
    me1.render();
    requestAnimationFrame(frame);
    window.__shift = { world, S, me, cam: me1.cam, renderer, players, crew, figs, tills, ALEX_TILL, WAIT, SPOTS,
      day: () => day, newDay, scanAt: me1.scanAt, state: me1.state, order: me1.order, full: me1.full, sel: me1.sel, applyCam: me1.applyCam, hitAt: me1.hitAt, holdHit: me1.holdHit,
      scanHold: me1.scanHold, scanPut: me1.scanPut, spotBox, countOne: me1.countOne, confirmQty: me1.confirmQty, enter: me1.enter, back: me1.back, page: me1.page, tapRow: me1.tapRow,
      handOver: me1.handOver, useHint: me1.useHint, toggleSquat: me1.toggleSquat, layout, till: me1.till, openTill: me1.openTill, closeTill: me1.closeTill, nearTill: me1.nearTill,
      pickAll: () => { while (me1.state() === 'qty' && !me1.full()) me1.countOne(); }, pollPads, join, startSplit, split: () => split,
      tick: (sec) => { for (let t = 0; t < sec; t += 0.05) worldStep(0.05); dirty = true; } };
  }
})();
