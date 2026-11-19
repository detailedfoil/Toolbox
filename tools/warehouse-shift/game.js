/* Warehouse Shift (Dunstable, LB1 only): a picking game in a made-up Screwfix-style warehouse.

   A customer comes to the trade counter with one of four things, a quarter each (detailedfoil, 19 Nov 2026): a
   single item click and collect (the pick is on the scanner already), a bagged click and collect waiting in the
   holding area by goods in (they give the OC location and surname: scan that tote, bring the bag), an order at the
   till (tillui.js: Fusion and CrashFix tabs; find what they ask for, take the payment, then the pick list goes to the
   scanner) or a kiosk order (found on Fusion's Kiosk Orders, then paid for and picked the same way). The scanner (drawn like the Symbol handsets in detailedfoil's
   photos) shows one pick at a time, in location order, so you walk up the right side and back down the left. Walk to the
   location, look at it and Scan (or tap it on a phone) once for each item the scanner asks for. When the tote's full, take it to
   the counter and hand it over; the next customer walks in. Hint makes the location glow. Squat for the bottom
   shelves. Played mainly with the phone sideways: left thumb walks, drag to look. On a computer: WASD, mouse look.

   Alex (bot.js) works the shift with you: their own customers at the right-hand till, the same four jobs, at a
   person's pace. One person to a pick aisle: whoever's in first has it, so you can't walk into an aisle Alex is in.

   world.js makes the warehouse and the orders, scene.js draws it, till.js and tillui.js are the till, bot.js is
   Alex. This file is the rest: the camera, the controls, the scanner, the customers, the sounds and the game itself. */
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
    if (!window.THREE || !window.ShiftWorld || !window.ShiftScene || !window.ShiftTill || !window.ShiftTillUI || !window.ShiftBot) { fail("The game didn't load. Check your signal and reload the page."); return; }
    progress(0.1, 'Loading the products…');
    // what till customers ask for: without it every customer is a click and collect
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
    const T = THREE, World = window.ShiftWorld, Till = window.ShiftTill;
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

    /* ---------- camera and layout ---------- */
    const cam = new T.PerspectiveCamera(60, 1, 0.03, 120);
    cam.rotation.order = 'YXZ';
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches; // no head bob
    const LOOKS = [['Normal', 1], ['Fast', 1.45], ['Slow', 0.7]];
    let lookPick = 0;
    try { lookPick = Math.max(0, LOOKS.findIndex((l) => l[0] === localStorage.getItem('ws-look'))); } catch (e) { /* fine */ }
    const me = { x: world.start.x, y: world.start.y, yaw: world.start.yaw, pitch: -0.05, vx: 0, vy: 0, eye: 1.62, squat: false, bob: 0, speed: 0 };
    const view = { w: 1, h: 1, cx: 0.5, cy: 0.5, landscape: true };
    const scanner = $('scanner');
    function layout() {
      const vw = Math.max(1, window.innerWidth), vh = Math.max(1, window.innerHeight), land = vw >= vh;
      let sch, scw;
      if (land) { sch = Math.min(vh - 12, 700); scw = sch * 0.53; if (scw > vw * 0.42) { scw = vw * 0.42; sch = scw / 0.53; } }
      else { sch = Math.min(vh * 0.5, 540); scw = sch * 0.53; if (scw > vw * 0.6) { scw = vw * 0.6; sch = scw / 0.53; } }
      stage.style.setProperty('--sch', Math.round(sch) + 'px'); stage.style.setProperty('--scw', Math.round(scw) + 'px');
      stage.classList.toggle('portrait', !land);
      view.w = vw; view.h = vh; view.landscape = land;
      renderer.setSize(vw, vh, false);
      // the view's centre is the middle of what the scanner doesn't cover
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
      stage.style.setProperty('--cx', Math.round(view.cx) + 'px'); stage.style.setProperty('--cy', Math.round(view.cy) + 'px');
      dirty = true;
    }
    window.addEventListener('resize', layout);
    window.addEventListener('orientationchange', () => setTimeout(layout, 250));
    layout();
    function applyCam() {
      me.pitch = Math.max(-1.45, Math.min(1.35, me.pitch));
      cam.position.set(me.x, me.eye + (still ? 0 : Math.sin(me.bob * 2) * 0.012 * Math.min(1, me.speed / 1.7)), me.y);
      cam.rotation.set(me.pitch, me.yaw, 0);
      dirty = true;
    }
    applyCam();

    /* ---------- walking ---------- */
    const BODY = 0.22;
    function blocked(x, y) {
      if (x < BODY || x > world.W - BODY || y < BODY || y > world.D - BODY) return true;
      for (const o of world.obstacles) if (x > o.x0 - BODY && x < o.x1 + BODY && y > o.y0 - BODY && y < o.y1 + BODY) return true;
      return false;
    }
    const keys = new Set();
    const stickIn = { x: 0, y: 0 };
    let running = false;
    function stepMove(dt) {
      let f = -stickIn.y, s = stickIn.x, turn = 0;
      if (keys.has('f')) f += 1; if (keys.has('b')) f -= 1; if (keys.has('l')) s -= 1; if (keys.has('r')) s += 1;
      if (keys.has('tl')) turn += 1; if (keys.has('tr')) turn -= 1;
      if (turn) me.yaw += turn * 2.0 * dt;
      let len = Math.hypot(f, s);
      if (len > 1) { f /= len; s /= len; len = 1; }
      const jog = running || Math.hypot(stickIn.x, stickIn.y) > 0.93;
      const top = me.squat ? 0.85 : jog ? 3.1 : 1.75;
      const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
      const tx = (-sy * f + cy * s) * top, ty = (-cy * f - sy * s) * top;
      const k = Math.min(1, dt * (len ? 9 : 12));
      me.vx += (tx - me.vx) * k; me.vy += (ty - me.vy) * k;
      me.speed = Math.hypot(me.vx, me.vy);
      let moved = !!turn;
      if (me.speed > 0.01) {
        const nx = me.x + me.vx * dt, ny = me.y + me.vy * dt;
        if (!blocked(nx, me.y) && !crewStop(nx, me.y)) me.x = nx; else me.vx = 0;
        if (!blocked(me.x, ny) && !crewStop(me.x, ny)) me.y = ny; else me.vy = 0;
        me.bob += me.speed * dt * 2.3;
        moved = true;
      } else { me.vx = me.vy = 0; me.speed = 0; }
      const want = me.squat ? 0.95 : 1.62;
      if (Math.abs(me.eye - want) > 0.002) { me.eye += (want - me.eye) * Math.min(1, dt * 11); moved = true; }
      if (moved) applyCam();
      return moved;
    }

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
      done: () => { [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.09, 0.22, 'triangle', 0.07)); noise(0.36, 0.25, 0.18, 4200); tone(2637, 0.38, 0.3, 'sine', 0.05); },
      hint: () => { tone(660, 0, 0.12, 'sine', 0.06, 990); },
      talk: () => { tone(540, 0, 0.045, 'triangle', 0.035); tone(690, 0.055, 0.05, 'triangle', 0.03); },
      approved: () => { tone(1568, 0, 0.12, 'sine', 0.07); tone(2093, 0.13, 0.22, 'sine', 0.07); },
      drawer: () => { noise(0, 0.18, 0.3, 500); tone(2400, 0.2, 0.25, 'sine', 0.035); },
      chime: () => { [880, 1109, 1319].forEach((f, i) => tone(f, i * 0.08, 0.2, 'triangle', 0.06)); }
    };

    /* ---------- the scanner screen ---------- */
    const scText = $('scText'), scQty = $('scQty'), scCur = $('scCur'), scPad = $('scPad'), scMenu = $('scMenu'), scFlash = $('scFlash'), scEnter = $('scEnter'), scHint = $('scHint');
    const short = (s) => String(s).slice(0, 20).trim();
    const four = (n) => String(n).padStart(4, '0');
    let order = null, cur = 0, state = 'idle', typed = '', viewLine = -1, viewTimer = 0, msgUntil = 0, msg = null, orderNo = 0, atCounter = false;
    let till = null; // the till screen, made further down
    const stats = { orders: 0, lines: 0, units: 0, wrong: 0, hints: 0, since: Date.now() };
    let life = { orders: 0, lines: 0, units: 0 };
    try { life = Object.assign(life, JSON.parse(localStorage.getItem('ws-stats-v1') || '{}')); } catch (e) { /* fine */ }
    function saveLife() { try { localStorage.setItem('ws-stats-v1', JSON.stringify(life)); } catch (e) { /* fine */ } }
    function lineHtml(text, cls) { const s = document.createElement('span'); s.className = 'sc-line' + (cls ? ' ' + cls : ''); s.textContent = text; return s; }
    function say(text, cls, ms) { msg = { text, cls }; msgUntil = performance.now() + (ms || 1700); renderScanner(); }
    function renderTote() {
      const el = $('toteCount');
      if (!order || state === 'between') { el.textContent = '0'; return; }
      if (order.hold) { el.textContent = (state === 'deliver' ? 1 : 0) + '/1'; return; }
      el.textContent = (state === 'deliver' ? order.lines.length : cur) + '/' + order.lines.length;
    }
    function renderScanner() {
      renderTote();
      const L = [];
      const showMsg = msg && performance.now() < msgUntil;
      if (state === 'scan' || state === 'qty') {
        const i = viewLine >= 0 ? viewLine : cur, ln = order.lines[i];
        L.push(['Today Picking'], [viewLine >= 0 ? 'Line ' + (i + 1) + ' of ' + order.lines.length : 'Pick To Tote/Trolley', viewLine >= 0 ? 'warn' : '']);
        L.push([ln.loc.code, 'big'], [ln.item.code, 'gap'], [short(ln.item.name)], ['Qty: ' + ln.qty, 'gap']);
      } else if (state === 'hold') {
        L.push(['Click & Collect'], ['Holding area', 'warn'], [order.hold.code, 'big'], [order.hold.parcel.surname.toUpperCase(), 'gap'], ['Scan the tote', 'gap dim'], ['by Goods In', 'dim']);
      } else if (state === 'deliver' && order.hold) {
        L.push(['Click & Collect'], ['Bag collected', 'ok'], [order.hold.code, 'big'], [order.hold.parcel.surname.toUpperCase(), 'gap dim']);
        L.push(atCounter ? ['Press Enter to', 'gap warn'] : ['Take it to', 'gap'], atCounter ? ['hand over', 'warn'] : ['Trade Counter']);
      } else if (state === 'deliver') {
        L.push(['Today Picking'], ['Pick Complete', 'ok'], ['Order ' + four(order.no), 'big'], [order.lines.length + (order.lines.length > 1 ? ' lines ' : ' line ') + order.units + ' units', 'gap dim']);
        L.push(atCounter ? ['Press Enter to', 'gap warn'] : ['Take tote to', 'gap'], atCounter ? ['hand over', 'warn'] : ['Trade Counter']);
      } else if (state === 'between') {
        L.push(['Today Picking'], ['Order handed over', 'ok'], ['Next customer', 'big'], ['coming in…', 'dim']);
      } else if (state === 'till') {
        const st = till ? till.stage() : 'none';
        L.push(['Today Picking'], ['No picks yet', 'dim'], ['Till order', 'big']);
        if (st === 'none') L.push(['Customer coming', 'gap'], ['to the counter', '']);
        else if (st === 'done') L.push(['Paid', 'gap ok'], ['Pick list coming', 'ok']);
        else L.push([nearTill ? 'Press Scan to' : 'Serve them at', 'gap warn'], [nearTill ? 'use the till' : 'the till', 'warn']);
      } else {
        L.push(['Today Picking'], ['Pick To Tote/Trolley'], ['Ready', 'big']);
      }
      scText.replaceChildren(...L.map((l) => lineHtml(l[0], l[1])));
      if (showMsg) scText.appendChild(lineHtml(msg.text, 'gap ' + (msg.cls || 'warn')));
      $('scPicked').style.visibility = state === 'scan' || state === 'qty' ? '' : 'hidden';
      scQty.textContent = state === 'qty' ? typed : '';
      scCur.className = 'sc-cur' + (state === 'qty' ? '' : ' line');
      scEnter.classList.toggle('pulse', state === 'deliver' && atCounter);
      $('scScan').classList.toggle('pulse', state === 'till' && !!nearTill);
      scHint.classList.toggle('used', hint.until > performance.now());
    }
    function flash(bad) { scFlash.className = 'sc-flash' + (bad ? ' bad' : ''); void scFlash.offsetWidth; scFlash.className = 'sc-flash go' + (bad ? ' bad' : ''); }
    function clock() { const d = new Date(); $('scTime').textContent = ((d.getHours() + 11) % 12 + 1) + ':' + String(d.getMinutes()).padStart(2, '0'); }
    clock(); setInterval(() => { clock(); S.clockTick(); dirty = true; }, 15000);
    const toastEl = $('toast');
    let toastT = 0;
    function toast(text, kind) { toastEl.textContent = text; toastEl.className = 'ws-toast show' + (kind ? ' ' + kind : ''); clearTimeout(toastT); toastT = setTimeout(() => { toastEl.className = 'ws-toast'; }, 1300); }
    let bannerT = 0;
    function banner(title, text, ms) { $('bannerTitle').textContent = title; $('bannerText').textContent = text || ''; $('banner').className = 'ws-banner show'; clearTimeout(bannerT); bannerT = setTimeout(() => { $('banner').className = 'ws-banner'; }, ms || 1800); }

    /* ---------- aiming and scanning ---------- */
    const ray = new T.Raycaster(), ndc = new T.Vector2();
    const REACH = 2.05, LOW = 0.45;
    function hitAt(nx, ny) { // the location under a point on the screen (-1..1), if any
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
    const centreNdc = () => [(view.cx / view.w) * 2 - 1, -((view.cy / view.h) * 2 - 1)];
    let aim = null;
    function updateAim() {
      const c = centreNdc(), h = hitAt(c[0], c[1]);
      aim = h && h.dist <= REACH ? h : null;
      const cross = $('cross');
      cross.classList.toggle('reach', !!aim);
      if (aim && (state === 'scan' || state === 'qty')) { S.setBox(S.aimBox, S.locBox(aim.loc), 0.012); S.aimBox.visible = true; }
      else if (state === 'hold') {
        const hh = holdHit(c[0], c[1]);
        if (hh && hh.dist <= REACH + 0.4) { S.setBox(S.aimBox, spotBox(hh.sp), 0.012); S.aimBox.visible = true; cross.classList.add('reach'); } else S.aimBox.visible = false;
      } else S.aimBox.visible = false;
    }
    // the tray that's out, or the box pulled forward, and where they're heading
    let openTray = null, openTimer = 0, pulled = null;
    const pulling = new Set(); // boxes moving forward or back
    function slideTray(tr, out) {
      if (openTray && openTray !== tr) openTray.target = 0;
      if (tr) { tr.target = out ? 1 : 0; if (out) { openTray = tr; SFX.slide(); } }
    }
    function scanAt(nx, ny) {
      if (state === 'deliver') { if (atCounter) handOver(); else { say('Take the tote to the counter', 'warn'); SFX.miss(); } return; }
      if (nearTill && (state === 'till' || state === 'between' || state === 'idle' || tillHit(nx, ny))) { openTill(); return; }
      if (state === 'till') { say('Serve them at the till', 'warn'); toast('Walk up to a till behind the counter'); SFX.miss(); return; }
      if (state === 'between' || state === 'idle') return;
      if (state === 'hold') { scanHold(nx, ny); return; }
      const h = hitAt(nx, ny);
      if (!h) { say('No barcode there', 'dim'); SFX.miss(); return; }
      if (h.dist > REACH) { say('Too far away', 'warn'); toast('Get closer to scan'); SFX.miss(); return; }
      if (h.loc.z0 < LOW && !me.squat) { say('Squat down to scan it', 'warn'); toast(touch ? 'Too low: squat down' : 'Too low: squat (C)'); SFX.bad(); flash(true); return; }
      const ln = order.lines[cur], tr = S.trayOf(h.loc);
      S.setBox(S.aimBox, S.locBox(h.loc), 0.012); S.aimBox.visible = true;
      // every scan of the right location is one item picked (detailedfoil: tap it as many times as the gun says)
      if (state === 'qty' && World.sameSpot(h.loc, ln.loc)) { countOne(); return; }
      if (World.sameSpot(h.loc, ln.loc)) {
        SFX.scan(); flash(false);
        state = 'qty'; typed = ''; viewLine = -1;
        openTimer = 0;
        if (tr) slideTray(tr, true); else if (ln.loc.item) { pulled = ln.loc.item; pulled.pullTarget = ln.loc.face.kind === 'BB' ? 0.12 : 0.07; pulling.add(pulled); }
        if (hint.loc === ln.loc) hint.until = 0;
        countOne();
      } else {
        stats.wrong++; order.slips = (order.slips || 0) + 1;
        SFX.bad(); flash(true);
        if (tr) { slideTray(tr, true); openTimer = 1.1; }
        say('Wrong location', 'err', 2000);
        toast(h.loc.code + '  ✗', 'bad');
      }
    }
    // one more of this line's product into the tote; the line's done when the count reaches its quantity
    function countOne() {
      const ln = order.lines[cur];
      const n = (Number(typed) || 0) + 1;
      typed = String(n);
      if (n < ln.qty) {
        if (n > 1) SFX.scan();
        flash(false);
        toast(n + ' of ' + ln.qty, 'good');
        if (n === 1) say('Scan again for each one', 'dim', 2400);
        renderScanner();
        return;
      }
      confirmQty();
    }
    function confirmQty() {
      if (state !== 'qty') return;
      const ln = order.lines[cur];
      if (Number(typed) !== ln.qty) return;
      SFX.pick(); flash(false);
      stats.lines++; stats.units += ln.qty; life.lines++; life.units += ln.qty; saveLife();
      flyToTote(ln);
      setTimeout(() => { const chip = $('toteChip'); chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump'); }, 480);
      if (openTray) openTray.target = 0;
      if (pulled) pulled.pullTarget = 0;
      setPad(false);
      cur++; typed = '';
      if (cur < order.lines.length) { state = 'scan'; toast('Line ' + cur + ' of ' + order.lines.length + ' picked', 'good'); }
      else { state = 'deliver'; banner('Pick complete', 'Take the tote to the trade counter', 2200); hint.until = 0; }
      renderScanner();
    }
    function back() {
      if (!scMenu.hidden) { menu(false); return; }
      if (state === 'qty') { // put the last one back
        SFX.key();
        const n = (Number(typed) || 0) - 1;
        if (n > 0) typed = String(n);
        else { typed = ''; state = 'scan'; if (openTray) openTray.target = 0; if (pulled) pulled.pullTarget = 0; }
        renderScanner();
      }
    }
    function digit() {
      if (state === 'qty' || state === 'scan') { say('Scan the location for each one', 'warn'); SFX.miss(); }
    }
    function enter() {
      if (!scMenu.hidden) return;
      if (state === 'qty') { say('Scan the location for each one', 'warn'); SFX.miss(); }
      else if (state === 'deliver') { if (atCounter) handOver(); else { say('Take the tote to the counter', 'warn'); SFX.miss(); } }
      else if (state === 'scan') { say('Scan the location first', 'warn'); SFX.miss(); }
      else if (state === 'hold') { say('Scan the tote in the holding area', 'warn'); SFX.miss(); }
      else if (state === 'till') { if (nearTill) openTill(); else { say('Serve them at the till', 'warn'); SFX.miss(); } }
    }
    let padWanted = false;
    function setPad(up) { scPad.classList.toggle('up', !!up); $('scScreen').classList.toggle('padup', !!up); }
    function page(dir) {
      if (!(state === 'scan' || state === 'qty') || !order) return;
      SFX.key();
      const n = order.lines.length, i = (viewLine >= 0 ? viewLine : cur) + dir;
      viewLine = i < 0 || i >= n || i === cur ? -1 : i;
      viewTimer = viewLine >= 0 ? 4 : 0;
      renderScanner();
    }

    /* ---------- the holding area: bagged click and collects ---------- */
    // Every OC spot holds a parcel or is empty; every surname there is different (detailedfoil). A holding area
    // customer gives the OC location and their surname; scan that tote (or the big item's spot) to take the order.
    const HOLD = world.holding, holdBox = new T.Box3();
    const parcels = {}; // code -> {surname, num, collection, despatch}
    const reserved = new Set(); // OC locations a customer (yours or Alex's) has come for: nobody else gets sent there
    function holdUsed() { const u = {}; for (const k in parcels) if (parcels[k]) u[parcels[k].surname] = 1; return u; }
    function holdFill(code) { const p = Till.holdParcel(Math.random, holdUsed()); parcels[code] = p; S.hold.set(code, p); }
    if (HOLD && S.hold) HOLD.spots.forEach((sp, i) => { if (i < 2 ? Math.random() < 0.7 : Math.random() < 0.85) holdFill(sp.code); else parcels[sp.code] = null; });
    function spotOf(code) { return HOLD.spots.find((sp) => sp.code === code); }
    function holdHit(nx, ny) { // the OC spot the line from the screen point goes through
      if (!HOLD) return null;
      ray.setFromCamera(ndc.set(nx, ny), cam);
      let best = null;
      for (const sp of HOLD.spots) {
        holdBox.min.set(sp.x0, sp.z0 - (sp.kind === 'tote' ? 0 : 0.12), sp.y0); holdBox.max.set(sp.x1 + 0.03, sp.z1 + 0.04, sp.y1);
        if (ray.ray.intersectBox(holdBox, _hit)) { const d = _hit.distanceTo(ray.ray.origin); if (!best || d < best.dist) best = { sp, dist: d }; }
      }
      return best;
    }
    function scanHold(nx, ny) {
      const h = holdHit(nx, ny);
      if (!h) { say('Scan the tote', 'dim'); SFX.miss(); return; }
      if (h.dist > REACH + 0.4) { say('Too far away', 'warn'); toast('Get closer to scan'); SFX.miss(); return; }
      const sp = h.sp, p = parcels[sp.code];
      S.setBox(S.aimBox, spotBox(sp), 0.012); S.aimBox.visible = true;
      if (sp.code !== order.hold.code) {
        stats.wrong++; order.slips = (order.slips || 0) + 1; SFX.bad(); flash(true);
        say(p ? 'Wrong order' : 'Empty', 'err', 2000);
        toast(sp.code + (p ? ': ' + p.surname : ': empty') + '  ✗', 'bad');
        return;
      }
      SFX.pick(); flash(false);
      order.carry = S.hold.carry(sp.code); if (order.carry) order.carry.visible = false;
      S.hold.set(sp.code, null); parcels[sp.code] = null;
      if (hint.spot) hint.until = 0;
      state = 'deliver';
      toast(sp.code + ' ' + order.hold.parcel.surname + '  ✓', 'good');
      say('Bag in hand', 'ok', 1800);
      banner('Order collected', 'Take it to the trade counter', 2000);
      S.aimBox.visible = false;
      renderScanner(); dirty = true;
    }
    function spotBox(sp) { return { x: (sp.x0 + sp.x1) / 2, y: (sp.y0 + sp.y1) / 2, z0: sp.z0 - (sp.kind === 'tote' ? 0.01 : 0.12), z1: sp.z1 + 0.02, w: sp.x1 - sp.x0 + 0.03, d: sp.y1 - sp.y0 }; }
    function holdOrder(c) { // a holding area customer is at the counter: their order is on the scanner
      orderNo++;
      order = { no: orderNo, lines: [], units: 1, hold: c.hold, slips: 0 };
      state = 'hold'; hint.until = 0;
      SFX.order(); flash(false);
      banner('Click & Collect', 'Holding area: ' + c.hold.code, 1800);
      renderScanner();
    }

    /* ---------- hint: the location glows ---------- */
    const hint = { until: 0, loc: null, counter: false, till: false, spot: null, t: 0 };
    function useHint() {
      if (state === 'till') {
        SFX.hint(); stats.hints++;
        hint.until = performance.now() + 12000; hint.t = 0; hint.loc = null; hint.counter = false; hint.till = true; hint.spot = null;
        scHint.classList.add('flash'); setTimeout(() => scHint.classList.remove('flash'), 200);
        toast('The till is glowing: walk up to it behind the counter', '');
        renderScanner(); dirty = true;
        return;
      }
      if (!order || state === 'between' || state === 'idle') return;
      SFX.hint(); stats.hints++; order.slips = (order.slips || 0) + 1;
      hint.until = performance.now() + 12000; hint.t = 0; hint.till = false;
      hint.spot = state === 'hold' ? spotOf(order.hold.code) : null;
      hint.loc = state === 'deliver' || state === 'hold' ? null : order.lines[cur].loc;
      hint.counter = state === 'deliver';
      scHint.classList.add('flash'); setTimeout(() => scHint.classList.remove('flash'), 200);
      toast(hint.counter ? 'The counter is glowing' : hint.spot ? 'The holding area is by goods in: look for the glow' : 'Look for the glow: ' + hint.loc.face.area + ' aisle', '');
      renderScanner(); dirty = true;
    }
    function updateHint(dt) {
      const on = hint.until > performance.now();
      if (!on) { if (S.glow.visible || S.signGlow.visible) { S.glow.visible = S.signGlow.visible = false; renderScanner(); return true; } return false; }
      hint.t += dt;
      const pulse = 0.5 + 0.5 * Math.sin(hint.t * 6.5);
      S.glowMat.opacity = 0.28 + 0.5 * pulse;
      if (hint.spot) {
        S.setBox(S.glow, spotBox(hint.spot), 0.03); S.glow.visible = true; S.signGlow.visible = false;
      } else if (hint.till) {
        const t = tillForCustomer();
        S.setBox(S.glow, { x: (t.x0 + t.x1) / 2, y: (t.y0 + t.y1) / 2, z0: 0.98, z1: 1.36, w: t.x1 - t.x0 + 0.1, d: t.y1 - t.y0 + 0.1 }, 0);
        S.glow.visible = true; S.signGlow.visible = false;
      } else if (hint.counter) {
        const c = world.counter;
        S.setBox(S.glow, { x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2, z0: 0, z1: 1.08, w: c.x1 - c.x0 + 0.06, d: c.y1 - c.y0 + 0.08 }, 0);
        S.glow.visible = true; S.signGlow.visible = false;
      } else {
        S.setBox(S.glow, S.locBox(hint.loc), 0.03); S.glow.visible = true;
        const es = S.endSigns.find((e) => e.face === hint.loc.face);
        if (es) {
          S.signGlow.position.copy(es.mesh.position); S.signGlow.rotation.copy(es.mesh.rotation);
          S.signGlow.translateZ(0.01);
          S.signGlow.scale.set(es.mesh.geometry.parameters.width + 0.14, es.mesh.geometry.parameters.height + 0.14, 1);
          S.signGlow.material.opacity = 0.35 + 0.55 * pulse; S.signGlow.visible = true;
        }
      }
      return true;
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

    /* ---------- trays and pulled boxes moving ---------- */
    function updateMoving(dt) {
      let any = false;
      for (const tr of S.trays.values()) {
        const tgt = tr.target || 0;
        if (Math.abs(tr.slide - tgt) > 0.001) {
          tr.slide += Math.sign(tgt - tr.slide) * Math.min(Math.abs(tgt - tr.slide), dt * 5.5);
          S.placeTray(tr); any = true;
          if (tr.slide <= 0.001 && tgt === 0 && openTray === tr) openTray = null;
        }
      }
      if (openTimer > 0) { openTimer -= dt; if (openTimer <= 0 && state !== 'qty' && openTray) openTray.target = 0; }
      for (const it of pulling) {
        const tgt = it.pullTarget || 0, now = it.pull || 0;
        if (Math.abs(now - tgt) > 0.0005) { it.pull = now + Math.sign(tgt - now) * Math.min(Math.abs(tgt - now), dt * 0.6); S.placeItem(it); any = true; }
        else if (!tgt) { it.pull = 0; S.placeItem(it); pulling.delete(it); if (it === pulled) pulled = null; }
      }
      // the open tray's contents get their photos
      const ext = openTray && openTray.slide > 0.05 ? openTray.items : [];
      S.photos.setExtra(ext);
      if (any) S.photos.fill();
      return any;
    }

    /* ---------- the customers ---------- */
    const counter = world.counter;
    const shopRoom = world.rooms.find((r) => r.name === 'Trade counter');
    const ent = world.openings.find((o) => o.type === 'entrance');
    const gond = world.objects.filter((o) => o.kind === 'gondola' && o.x0 >= shopRoom.x0 - 0.01 && o.x1 <= shopRoom.x1 + 0.01).sort((a, b) => a.x0 - b.x0);
    const lanes = (() => { // the gaps between the shop's shelving, left to right
      const r = gond.map((g) => [g.x0, g.x1]).sort((a, b) => a[0] - b[0]), out = [];
      let end = r.length ? r[0][1] : shopRoom.x0;
      for (let i = 1; i < r.length; i++) { if (r[i][0] > end + 0.6) out.push((end + r[i][0]) / 2); end = Math.max(end, r[i][1]); }
      return out.length ? out : [shopRoom.x0 + 1.2];
    })();
    const lane = lanes[0];
    const spot = world.customer;
    const PATH = [[(ent.from + ent.to) / 2, world.D + 0.6], [(ent.from + ent.to) / 2, world.D - 0.5], [lane, world.D - 1.2], [lane, counter.y1 + 1.0], [spot.x, spot.y]];
    const OUTFITS = [[0xf07a1a, 0x2f3540, 0xdfe3e8], [0xd9e021, 0x23272e, 0xdfe3e8], [0x7b2d3a, 0x3a3f47], [0x5a5f66, 0x22262c], [0x1d1f22, 0x4a3f33], [0xb3261e, 0x2f3540], [0x2e7d32, 0x3b3328], [0x0f5fa8, 0x23272e], [0xe8590c, 0x1f2328, 0xdfe3e8]];
    const SKIN = [0xf1c9a5, 0xe0b394, 0xc68b62, 0x8d5a3b, 0x5c3a25], HAIR = [0x2b1d14, 0x5a3a22, 0x9a6a3a, 0x1a1a1a, 0x7c7c7c, 0xc9a35a];
    const customers = [S.customer, S.makeCustomer()];
    customers.forEach((c) => { c.state = 'away'; c.group.visible = false; });
    function dress(c) {
      const o = OUTFITS[Math.floor(Math.random() * OUTFITS.length)];
      c.parts.body.color.setHex(o[0]); c.parts.legsM.color.setHex(o[1]); c.parts.stripe.color.setHex(o[2] || o[0]);
      c.parts.skin.color.setHex(SKIN[Math.floor(Math.random() * SKIN.length)]); c.parts.hair.color.setHex(HAIR[Math.floor(Math.random() * HAIR.length)]);
      c.group.scale.setScalar(0.94 + Math.random() * 0.12);
    }
    function freeCustomer(not) { // someone not busy, or a new face if everyone is
      const c = customers.find((x) => x !== not && x.state === 'away');
      if (c) return c;
      const n = S.makeCustomer(); n.state = 'away'; n.group.visible = false; customers.push(n);
      return n;
    }
    function walk(c, path, then) { c.path = path.map((p) => p.slice()); c.leg = 0; c.state = 'walking'; c.then = then; c.group.visible = true; c.group.position.set(path[0][0], 0, path[0][1]); }
    function arrive(c) { dress(c); c.route = PATH; walk(c, PATH, () => { c.state = 'waiting'; c.group.rotation.y = Math.PI; served(c); }); }
    function leave(c) { walk(c, (c.route || PATH).slice().reverse(), () => { c.state = 'away'; c.group.visible = false; c.carry = false; c.route = null; c.crew = null; if (c.tote) { S.dropTote(c.tote); c.tote = null; } }); }
    function updateCustomers(dt) {
      let any = false;
      for (const c of customers) {
        if (c.state === 'walking') {
          any = true;
          const tgt = c.path[c.leg + 1];
          if (!tgt) { c.state = 'waiting'; if (c.then) c.then(); continue; }
          const p = c.group.position, dx = tgt[0] - p.x, dz = tgt[1] - p.z, d = Math.hypot(dx, dz), step = 1.25 * dt;
          if (d <= step) { p.x = tgt[0]; p.z = tgt[1]; c.leg++; if (c.leg >= c.path.length - 1) { c.state = 'done'; if (c.then) c.then(); } }
          else { p.x += dx / d * step; p.z += dz / d * step; }
          const want = Math.atan2(dx, dz);
          let dr = want - c.group.rotation.y; while (dr > Math.PI) dr -= 2 * Math.PI; while (dr < -Math.PI) dr += 2 * Math.PI;
          c.group.rotation.y += dr * Math.min(1, dt * 8);
          c.phase = (c.phase || 0) + dt * 7.5;
          const sw = Math.sin(c.phase) * 0.5;
          c.parts.legL.rotation.x = sw; c.parts.legR.rotation.x = -sw; c.parts.armL.rotation.x = -sw * 0.8; c.parts.armR.rotation.x = c.carry ? -1.1 : sw * 0.8;
        } else if (c.state === 'waiting') {
          if (Math.hypot(me.x - c.group.position.x, me.y - c.group.position.z) > 9) continue; // too far to see: no need to draw
          c.phase = (c.phase || 0) + dt;
          c.parts.legL.rotation.x = c.parts.legR.rotation.x = 0; c.parts.armL.rotation.x = 0; c.parts.armR.rotation.x = 0;
          c.parts.torso.rotation.z = Math.sin(c.phase * 1.3) * 0.02; c.parts.head.rotation.y = Math.sin(c.phase * 0.7) * 0.35;
          any = any || true;
        }
      }
      return any;
    }
    let waitingCustomer = null;

    /* ---------- click and collect, or an order at the till ---------- */
    const MODES = [['mixed', 'mixed', 'mixed'], ['pick', 'C&C pick', 'single item click & collect only'], ['hold', 'holding', 'holding area click & collect only'],
      ['till', 'till', 'till search orders only'], ['kiosk', 'kiosk', 'kiosk orders only']];
    let mode = 0;
    try { mode = Math.max(0, MODES.findIndex((m) => m[0] === localStorage.getItem('ws-orders'))); } catch (e) { /* fine */ }
    const kinds = [];
    // half click and collect (half of those a single item to pick, half bagged in the holding area), half at the till
    // (half searched for on CrashFix, half sent from the kiosk): a quarter each
    const KINDS = ['pick', 'hold', 'till', 'kiosk'];
    function pickKind() {
      const m = MODES[mode][0];
      let k = m !== 'mixed' ? m : KINDS[Math.floor(Math.random() * 4)];
      if (m === 'mixed' && kinds.length >= 2 && kinds[kinds.length - 1] === k && kinds[kinds.length - 2] === k) k = KINDS[(KINDS.indexOf(k) + 1 + Math.floor(Math.random() * 3)) % 4]; // never three the same in a row
      if (k === 'till' && (!requests || !requests.need)) k = 'kiosk'; // no request list: nothing to search for
      if (k === 'hold' && (!HOLD || !Object.keys(parcels).some((c) => parcels[c] && !reserved.has(c)))) k = 'pick';
      kinds.push(k); if (kinds.length > 4) kinds.shift();
      return k;
    }
    const tillKind = (k) => k === 'till' || k === 'kiosk';
    const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
    function prepare(c) { // what this customer has come for
      c.kind = pickKind(); c.cust = null; c.lines = null; c.hold = null; c.kiosk = null;
      if (tillKind(c.kind)) {
        c.cust = Till.makeCustomer(Math.random); c.pay = Till.payment(Math.random);
        c.kiosk = Till.makeKiosk(world, Math.random, c.cust);
        if (c.kind === 'till') { // the kiosk list is everyone else's
          c.kiosk.list.splice(c.kiosk.mine, 1); c.kiosk.mine = -1;
          c.lines = Till.makeOrder(world, requests, rng); if (!c.lines.length) c.kind = 'kiosk';
        }
        if (c.kind === 'kiosk' && c.kiosk.mine < 0) c.kiosk = Till.makeKiosk(world, Math.random, c.cust);
      }
      if (c.kind === 'hold') {
        const full = HOLD.spots.filter((sp) => parcels[sp.code] && !reserved.has(sp.code));
        const sp = full[Math.floor(Math.random() * full.length)];
        c.hold = { code: sp.code, parcel: parcels[sp.code] }; reserved.add(sp.code);
      }
      c.name = c.cust ? c.cust.surname : c.hold ? c.hold.parcel.surname : pickOne(Till.SURNAMES);
    }
    function served(c) { // they've walked up to the counter
      if (c !== waitingCustomer) return;
      if (tillKind(c.kind)) { till.serve(c.cust, c.lines, '#' + c.parts.body.color.getHexString(), { kind: c.kind, kiosk: c.kiosk, pay: c.pay }); renderScanner(); }
      else if (c.kind === 'hold') speak({ text: Till.holdSay(Math.random, c.hold.code, c.hold.parcel.surname) });
      else speak({ text: pickOne(['Click and collect for ' + c.name + ', please.', "Hiya, I've got a click and collect. Name's " + c.name + '.', 'Got an order to collect, under ' + c.name + '.']) });
    }
    function startOrderFor(c) { // what goes on the scanner when they arrive
      if (tillKind(c.kind)) { state = 'till'; hint.until = 0; renderScanner(); }
      else if (c.kind === 'hold') holdOrder(c);
      else newOrder(1);
    }
    function nextCustomer(prev) {
      setTimeout(() => {
        const next = freeCustomer(prev); prepare(next); arrive(next); waitingCustomer = next;
        if (tillKind(next.kind)) { state = 'till'; hint.until = 0; renderScanner(); }
      }, 1400);
      setTimeout(() => { const c = waitingCustomer; if (state === 'between' && c && !tillKind(c.kind)) startOrderFor(c); }, 2600); // after the order complete banner has had its moment
    }
    function skipCustomer() { // the customer goes without their order; the next one comes in
      if (openTray) openTray.target = 0; if (pulled) pulled.pullTarget = 0; setPad(false);
      const c = waitingCustomer;
      if (c && c.state === 'waiting') { speak({ text: "Never mind, I'll come back later." }); leave(c); }
      else if (c && c.state === 'walking') { // turn round where they are
        const p = c.group.position, back = PATH.slice(0, c.leg + 1).reverse();
        walk(c, [[p.x, p.z]].concat(back), () => { c.state = 'away'; c.group.visible = false; });
      }
      till.clear(); if (till.isOpen()) closeTill();
      if (order && order.hold && order.carry) { // the bag goes back in its tote
        S.dropTote(order.carry); parcels[order.hold.code] = order.hold.parcel; S.hold.set(order.hold.code, order.hold.parcel);
      }
      if (c && c.hold) reserved.delete(c.hold.code);
      order = null; state = 'between'; hint.until = 0; atCounter = false;
      renderScanner();
      nextCustomer(c);
    }
    // the order paid for at the till: its pick list goes to the scanner
    function tillOrder(info) {
      orderNo++;
      const lines = info.lines.map((l) => ({ item: l.item, loc: l.item.loc, qty: l.qty })).sort((a, b) => a.loc.order - b.loc.order);
      order = { no: orderNo, lines, units: lines.reduce((t, l) => t + l.qty, 0), slips: info.slips || 0, till: info.orderNo, fresh: true };
      cur = 0; state = 'scan'; typed = ''; viewLine = -1; hint.until = 0;
      stats.tills = (stats.tills || 0) + 1;
      SFX.order(); flash(false);
      renderScanner();
    }

    function handOver() {
      if (state !== 'deliver') return;
      state = 'between'; atCounter = false; hint.until = 0;
      SFX.done(); flash(false);
      stats.orders++; life.orders++; saveLife();
      $('doneCount').textContent = String(stats.orders);
      const perfect = !order.slips;
      if (order.hold) banner(order.hold.code + ' handed over', (perfect ? 'Perfect pick! ' : '') + 'Click & collect for ' + order.hold.parcel.surname, 2400);
      else banner('Order ' + four(order.no) + ' complete', (perfect ? 'Perfect pick! ' : '') + order.lines.length + (order.lines.length > 1 ? ' lines, ' : ' line, ') + order.units + ' units', 2400);
      if (perfect) { stats.perfect = (stats.perfect || 0) + 1; life.perfect = (life.perfect || 0) + 1; saveLife(); }
      // the tote goes on the counter, slides over to the customer, and leaves with them
      const c = waitingCustomer;
      let tote;
      if (order.hold && order.carry) { // the bag (or the big box) goes over; a new order fills its place
        tote = order.carry; tote.visible = true;
        const code = order.hold.code;
        setTimeout(() => { if (!parcels[code]) holdFill(code); reserved.delete(code); dirty = true; }, 4000);
      } else tote = S.makeTote(order.lines.map((l) => l.item.colour));
      tote.position.set(Math.max(counter.x0 + 0.4, Math.min(counter.x1 - 0.4, me.x)), 1.0, counter.y0 + 0.22);
      totes.push({ t: 0, tote, from: tote.position.clone(), to: new T.Vector3(c ? c.group.position.x : spot.x, 1.0, counter.y1 - 0.2), c });
      renderScanner();
      till.clear();
      nextCustomer(c);
    }
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
          if (t.c) { // the customer picks it up and goes
            if (t.c.tote) S.dropTote(t.c.tote);
            t.c.carry = true; t.c.tote = t.tote; t.c.group.add(t.tote); t.tote.position.set(0, 0.95, 0.32); t.tote.scale.setScalar(1 / t.c.group.scale.x);
            leave(t.c);
          } else S.dropTote(t.tote);
        }
      }
      return true;
    }

    /* ---------- orders ---------- */
    const rng = World.rng((Date.now() ^ 0x5bd1e995) >>> 0);
    function newOrder(n) {
      orderNo++;
      const lines = World.order(world, rng, n);
      order = { no: orderNo, lines, units: lines.reduce((s, l) => s + l.qty, 0) };
      cur = 0; state = 'scan'; typed = ''; viewLine = -1; hint.until = 0;
      SFX.order(); flash(false);
      banner('New order ' + four(order.no), lines.length + (lines.length > 1 ? ' lines to pick' : ' line to pick'), 1800);
      renderScanner();
    }
    function checkCounter() {
      const h = world.handover, inside = me.x > h.x0 && me.x < h.x1 && me.y > h.y0 && me.y < h.y1 + 0.05;
      if (inside !== atCounter) { atCounter = inside; if (state === 'deliver') { renderScanner(); if (inside) toast('Press Enter to hand over'); } }
    }

    /* ---------- the function menu ---------- */
    function menu(open) {
      if (!open) { scMenu.hidden = true; return; }
      const items = [
        ['1', me.squat ? 'Stand up' : 'Squat', () => toggleSquat()],
        ['2', 'Hint', () => useHint()],
        ['3', 'Sound: ' + (audio.on ? 'on' : 'off'), () => { audio.on = !audio.on; try { localStorage.setItem('ws-sound', audio.on ? 'on' : 'off'); } catch (e) { /* fine */ } }],
        ['4', 'Look: ' + LOOKS[lookPick][0].toLowerCase(), () => { lookPick = (lookPick + 1) % LOOKS.length; try { localStorage.setItem('ws-look', LOOKS[lookPick][0]); } catch (e) { /* fine */ } toast('Look speed: ' + LOOKS[lookPick][0].toLowerCase()); }],
        ['5', 'Skip order', () => { if (state === 'scan' || state === 'qty' || state === 'till' || state === 'hold' || (state === 'deliver' && order && order.hold)) skipCustomer(); }],
        ['6', 'Orders: ' + MODES[mode][1], () => { mode = (mode + 1) % MODES.length; try { localStorage.setItem('ws-orders', MODES[mode][0]); } catch (e) { /* fine */ } toast('Next customers: ' + MODES[mode][2]); }],
        ['7', 'Help', () => showHelp(true)],
        ['0', 'Close', () => {}]
      ];
      scMenu.replaceChildren();
      const h = document.createElement('h3'); h.textContent = 'Functions'; scMenu.appendChild(h);
      for (const [k, t, fn] of items) {
        const b = document.createElement('button'); b.type = 'button';
        const kb = document.createElement('b'); kb.textContent = k; b.appendChild(kb); b.appendChild(document.createTextNode(t));
        b.addEventListener('click', (e) => { e.stopPropagation(); SFX.key(); menu(false); fn(); renderScanner(); });
        b.dataset.k = k;
        scMenu.appendChild(b);
      }
      scMenu.hidden = false;
    }

    /* ---------- the till ---------- */
    const tills = world.objects.filter((o) => o.kind === 'till' && o.x0 >= counter.x0 - 0.01 && o.x1 <= counter.x1 + 0.01);
    const tillForCustomer = () => tills.reduce((b, t) => (Math.abs((t.x0 + t.x1) / 2 - spot.x) < Math.abs((b.x0 + b.x1) / 2 - spot.x) ? t : b), tills[0]);
    let nearTill = null;
    const tillBtn = $('tillBtn');
    function checkTill() { // standing behind the counter, at one of its tills
      let best = null;
      if (me.y < counter.y0 + 0.05 && me.y > counter.y0 - 1.75) {
        let bd = 0.95;
        for (const t of tills) { if (crew.some((b) => b.atTill === t)) continue; const d = Math.abs(me.x - (t.x0 + t.x1) / 2); if (d < bd) { bd = d; best = t; } }
      }
      if (best === nearTill) return;
      nearTill = best;
      tillBtn.hidden = !nearTill || !active;
      renderScanner();
    }
    const tillBox = new T.Box3(), _hit = new T.Vector3();
    function tillHit(nx, ny) { // the line from the screen point goes through a till
      ray.setFromCamera(ndc.set(nx, ny), cam);
      for (const t of tills) {
        tillBox.min.set(t.x0 - 0.05, 0.97, t.y0 - 0.08); tillBox.max.set(t.x1 + 0.05, 1.38, t.y1 + 0.02);
        if (ray.ray.intersectBox(tillBox, _hit) && _hit.distanceTo(ray.ray.origin) < 2.6) return true;
      }
      return false;
    }
    function openTill() {
      if (!till || till.isOpen()) return;
      if (locked()) document.exitPointerLock();
      keys.clear(); running = false; stickIn.x = stickIn.y = 0; stickId = null; stickHome(); looks.clear();
      me.vx = me.vy = 0;
      SFX.key();
      till.open();
      sayEl.hidden = true;
      dirty = true;
    }
    function closeTill() {
      if (!till || !till.isOpen()) return;
      till.close();
      canvas.focus({ preventScroll: true });
      if (order && order.fresh) { order.fresh = false; banner('New order ' + four(order.no), 'From the till: ' + order.lines.length + (order.lines.length > 1 ? ' lines to pick' : ' line to pick'), 2200); }
      sayShown = performance.now() - 9000; dirty = true; // their last words stay up a few seconds
      renderScanner();
    }

    /* ---------- what the customer says: a bubble over their head ---------- */
    const sayEl = $('say'), sayText = $('sayText');
    let sayShown = 0, sayLine = null;
    function speak(line) {
      sayLine = line; sayShown = performance.now();
      sayText.replaceChildren();
      const add = (tag, text) => { if (!text) return; const n = document.createElement(tag); n.textContent = text; sayText.appendChild(n); sayText.appendChild(document.createTextNode(' ')); };
      add('span', line.text); add('q', line.quote); add('span', line.hint); add('b', line.qty);
      if (!till || !till.isOpen()) SFX.talk();
      renderScanner();
    }
    const _head = new T.Vector3();
    function placeSay() {
      const c = waitingCustomer;
      const on = sayLine && c && c.state === 'waiting' && (!till || !till.isOpen()) && active && performance.now() - sayShown < (sayLine.quote ? 24000 : 14000);
      if (!on) { if (!sayEl.hidden) sayEl.hidden = true; return; }
      _head.set(c.group.position.x, 1.98 * c.group.scale.y, c.group.position.z).project(cam);
      const far = Math.hypot(me.x - c.group.position.x, me.y - c.group.position.z);
      if (_head.z > 1 || _head.z < -1 || far > 16) { if (!sayEl.hidden) sayEl.hidden = true; return; }
      if (sayEl.hidden) sayEl.hidden = false;
      const w = sayEl.offsetWidth, h = sayEl.offsetHeight;
      let x = (_head.x + 1) / 2 * view.w - w / 2, y = (1 - _head.y) / 2 * view.h - h - 12;
      x = Math.max(8, Math.min(view.w - w - 8, x)); y = Math.max(52, Math.min(view.h - h - 8, y));
      sayEl.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
    }

    till = window.ShiftTillUI.create({
      el: $('till'), world, Till, touch,
      sfx: (n) => { const f = { key: SFX.key, beep: SFX.scan, good: SFX.pick, bad: SFX.bad, talk: SFX.talk, approved: SFX.approved, drawer: SFX.drawer, done: SFX.chime }[n]; if (f) f(); },
      onClose: () => closeTill(),
      onComplete: (info) => tillOrder(info),
      onSpeech: (line) => speak(line),
      onSlip: () => { stats.tillSlips = (stats.tillSlips || 0) + 1; },
      idleText: () => (waitingCustomer && !tillKind(waitingCustomer.kind) && waitingCustomer.state === 'waiting' ? 'This customer has a click and collect: it\'s on your scanner.' : state === 'scan' || state === 'qty' || state === 'deliver' ? 'Nobody waiting to order. Finish the pick on your scanner.' : 'No customer is waiting to order at the till.')
    });

    /* ---------- Alex, a coworker (bot.js) ---------- */
    // detailedfoil, 19 Nov 2026: a coworker doing the same job as you, at a person's pace. Alex serves their own
    // customers at the right-hand till (they come in down the right-hand side of the shop), picks from the same
    // shelves and the same holding area, and walks round you. One person to a pick aisle: whoever's in first has it, so
    // you can't walk into an aisle Alex is in, and Alex waits by the end of one you're in.
    const Crew = window.ShiftBot;
    const crew = [];
    const timers = []; // things that happen after a while, on the game's clock
    const later = (sec, fn) => { timers.push({ t: sec, fn }); };
    function runTimers(dt) { for (let i = timers.length - 1; i >= 0; i--) if ((timers[i].t -= dt) <= 0) { const f = timers[i].fn; timers.splice(i, 1); f(); } }
    // Alex's sounds: quieter the further away they are, and none from across the warehouse
    function crewSound(b, name) {
      const d = Math.hypot(me.x - b.x, me.y - b.y), v = Math.max(0, 1 - d / 14) * (till && till.isOpen() ? 0.35 : 0.6);
      if (v < 0.03) return;
      if (name === 'scan') tone(2730, 0, 0.085, 'square', 0.05 * v);
      else if (name === 'bad') { tone(196, 0, 0.13, 'sawtooth', 0.06 * v); tone(156, 0.16, 0.2, 'sawtooth', 0.06 * v); }
      else if (name === 'approved') { tone(1568, 0, 0.12, 'sine', 0.06 * v); tone(2093, 0.13, 0.22, 'sine', 0.06 * v); }
      else if (name === 'drawer') { noise(0, 0.18, 0.25 * v, 500); tone(2400, 0.2, 0.25, 'sine', 0.03 * v); }
      else if (name === 'slide') noise(0, 0.12, 0.25 * v, 700);
    }
    // speech bubbles for Alex and Alex's customer: only when they're near and nothing tall is in the way
    function makeBub(cls) {
      const el = document.createElement('div'); el.className = 'ws-bub ' + cls; el.hidden = true;
      const p = document.createElement('p'); el.appendChild(p);
      stage.insertBefore(el, sayEl);
      return { el, p, until: 0, at: null };
    }
    function bubSay(bub, line, at, name) {
      bub.p.replaceChildren();
      const add = (tag, text) => { if (!text) return; const n = document.createElement(tag); n.textContent = text; bub.p.appendChild(n); bub.p.appendChild(document.createTextNode(' ')); };
      if (name) add('b', name);
      const q = line.quote && line.quote.length > 110 ? line.quote.slice(0, 107).trim() + '…' : line.quote;
      add('span', line.text); add('q', q); add('span', line.hint); add('i', line.qty);
      bub.until = performance.now() + Math.min(9000, 2600 + ((line.text || '').length + (q || '').length) * 50);
      bub.at = at;
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
      const open = till && till.isOpen(), taken = [];
      if (!sayEl.hidden) { const r = sayEl.getBoundingClientRect(), o = stage.getBoundingClientRect(); taken.push({ x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height }); }
      for (const b of crew) for (const bub of [b.bub, b.cbub]) {
        const at = bub.at && now < bub.until && !open && active ? bub.at() : null;
        let show = !!at;
        if (show) {
          _bp.copy(at);
          if (Math.hypot(me.x - _bp.x, me.y - _bp.z) > 11 || !inSight(_bp.x, _bp.z)) show = false;
          else { _bq.copy(_bp).project(cam); if (_bq.z > 1 || _bq.z < -1) show = false; }
        }
        if (!show) { if (!bub.el.hidden) bub.el.hidden = true; continue; }
        if (bub.el.hidden) bub.el.hidden = false;
        const w = bub.el.offsetWidth, h = bub.el.offsetHeight;
        let x = (_bq.x + 1) / 2 * view.w - w / 2, y = (1 - _bq.y) / 2 * view.h - h - 10;
        x = Math.max(8, Math.min(view.w - w - 8, x)); y = Math.max(52, Math.min(view.h - h - 8, y));
        for (const t of taken) if (x < t.x + t.w + 4 && x + w + 4 > t.x && y < t.y + t.h + 4 && y + h + 4 > t.y) y = t.y + t.h + 8;
        taken.push({ x, y, w, h });
        bub.el.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
      }
    }
    // what Alex's job does to the shared world (bot.js calls these)
    const _crewHead = new T.Vector3();
    const crewEnv = {
      // a customer for Alex walks in down the right-hand side of the shop
      customer(b, c, delay, done) {
        later(delay, () => {
          const f = freeCustomer(waitingCustomer);
          f.route = b.route; f.crew = b; c.fig = f;
          dress(f);
          walk(f, b.route, () => { f.state = 'waiting'; f.group.rotation.y = Math.PI; done(); });
        });
      },
      // the holding area is shared: a bag Alex's customer has come for is kept for them
      holdReserve() {
        const full = HOLD ? HOLD.spots.filter((sp) => parcels[sp.code] && !reserved.has(sp.code)) : [];
        if (!full.length) return null;
        const sp = full[Math.floor(Math.random() * full.length)];
        reserved.add(sp.code);
        return { code: sp.code, parcel: parcels[sp.code] };
      },
      holdTake(b, code) {
        const g = S.hold.carry(code);
        S.hold.set(code, null); parcels[code] = null;
        if (g) { b.fig.carry.add(g); g.position.set(0, 0, 0); g.rotation.set(0, Math.PI / 2, 0); b.fig.held = g; }
        dirty = true;
        return g || true;
      },
      tote(b) { const t = S.makeTote([]); b.fig.carry.add(t); t.position.set(0, 0, 0); t.rotation.set(0, 0, 0); b.fig.held = t; },
      toteAdd(b, ln) { if (b.fig.held) S.toteBox(b.fig.held, ln.item.colour, b.items.length - 1); },
      open(b, loc) {
        const tr = S.trayOf(loc);
        if (tr) { tr.target = 1; crewSound(b, 'slide'); }
        else if (loc.item) { loc.item.pullTarget = loc.face.kind === 'BB' ? 0.12 : 0.07; pulling.add(loc.item); }
        dirty = true;
      },
      close(b, loc) { const tr = S.trayOf(loc); if (tr) tr.target = 0; else if (loc.item) loc.item.pullTarget = 0; dirty = true; },
      // the tote (or bag) goes on the counter, slides over, and the customer leaves with it
      handOver(b, c) {
        const held = b.fig.held, f = c.fig;
        b.fig.held = null;
        if (held) {
          scene.attach(held);
          held.rotation.set(0, c.hold ? Math.PI / 2 : 0, 0);
          held.position.set((b.till.x0 + b.till.x1) / 2, 1.0, counter.y0 + 0.22);
          totes.push({ t: 0, tote: held, from: held.position.clone(), to: new T.Vector3(f ? f.group.position.x : b.custSpot.x, 1.0, counter.y1 - 0.2), c: f || null });
          crewSound(b, 'slide');
        } else if (f) leave(f);
        if (c.hold) { const code = c.hold.code; later(4, () => { if (!parcels[code]) holdFill(code); reserved.delete(code); dirty = true; }); }
        dirty = true;
      },
      sfx(b, name) { crewSound(b, name); },
      say(b, who, line) {
        if (who === 'me') bubSay(b.bub, line, () => b.fig.parts.head.getWorldPosition(_crewHead).setY(_crewHead.y + 0.25), b.name);
        else {
          const f = b.cust && b.cust.fig;
          if (f) bubSay(b.cbub, line, () => _crewHead.set(f.group.position.x, 1.98 * f.group.scale.y, f.group.position.z));
        }
      }
    };
    const entX = (ent.from + ent.to) / 2, staffRoom = world.rooms.find((r) => r.name === 'Staff room');
    function hire(o) {
      const b = Crew.create({ world, World, Till, requests, nav: hire.nav || (hire.nav = new Crew.Nav(world)), env: crewEnv, id: crew.length + 1, name: o.name, till: o.till, start: o.start, rand: Math.random });
      b.fig = S.makeWorker({ name: o.name, skin: o.skin, hair: o.hair });
      b.route = [[entX, world.D + 0.6], [entX, world.D - 0.5], [o.lane, world.D - 1.2], [o.lane, counter.y1 + 1.0], [b.custSpot.x, b.custSpot.y]];
      b.bub = makeBub('crew'); b.cbub = makeBub('crewcust');
      S.poseWorker(b.fig, b, 0.02);
      crew.push(b);
      return b;
    }
    // Alex starts the shift coming out of the staff room, and works the till at the right-hand end of the counter
    hire({ name: 'Alex', till: tills[tills.length - 1], lane: lanes[lanes.length - 1], skin: 0xd6a57c, hair: 0x2b1d14,
      start: staffRoom ? { x: staffRoom.x1 + 0.6, y: staffRoom.y0 + 0.65, yaw: Math.PI / 2 } : null });
    // you: Alex is in the way like anyone, and you can't walk into a pick aisle Alex is in
    let aisleToldT = 0;
    function crewStop(x, y) {
      for (const b of crew) {
        const dn = Math.hypot(x - b.x, y - b.y);
        if (dn < BODY + b.r && dn < Math.hypot(me.x - b.x, me.y - b.y) - 1e-4) return true;
      }
      const into = Crew.aisleAt(world, x, y);
      if (!into || into === Crew.aisleAt(world, me.x, me.y)) return false;
      const b = crew.find((w) => Crew.aisleAt(world, w.x, w.y) === into);
      if (!b) return false;
      const now = performance.now();
      if (now - aisleToldT > 2500) { aisleToldT = now; toast(b.name + ' is down this aisle: wait for them to come out'); b.sayBusy(); }
      return true;
    }
    const _frus = new T.Frustum(), _fm = new T.Matrix4(), _sph = new T.Sphere(new T.Vector3(), 1.3);
    let crewIdle = 0;
    function updateCrew(dt) { // true when Alex needs drawing again
      runTimers(dt);
      if (!crew.length) return false;
      cam.updateMatrixWorld();
      _frus.setFromProjectionMatrix(_fm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      const you = { id: 0, x: me.x, y: me.y, r: BODY, moving: me.speed > 0.15 };
      let seen = false, busy = false;
      for (const b of crew) {
        const others = [you];
        for (const o of crew) if (o !== b) others.push({ id: o.id, x: o.x, y: o.y, r: o.r, moving: o.moving });
        b.update(dt, others);
        S.poseWorker(b.fig, b, dt);
        _sph.center.set(b.x, 1.0, b.y);
        if (Math.hypot(me.x - b.x, me.y - b.y) < 32 && _frus.intersectsSphere(_sph)) {
          seen = true;
          if (b.moving || b.turning > 0.1 || b.beam > 0 || b.bending || b.giving || b.aim) busy = true;
        }
      }
      if (!seen) return false;
      if (busy) { crewIdle = 0; return true; }
      crewIdle += dt; // standing still: the small movements are redrawn less often
      if (crewIdle > 0.066) { crewIdle = 0; return true; }
      return false;
    }

    /* ---------- controls: scanner buttons ---------- */
    const press = (el, fn) => {
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); initAudio(); fn(e); });
      const up = () => el.classList.remove('down');
      el.addEventListener('pointerup', up); el.addEventListener('pointerleave', up); el.addEventListener('pointercancel', up);
      el.addEventListener('click', (e) => e.preventDefault());
    };
    press($('scScan'), () => { const c = centreNdc(); scanAt(c[0], c[1]); });
    press($('scEnter'), () => { SFX.key(); enter(); });
    press($('scFn'), () => { SFX.key(); menu(scMenu.hidden); });
    press($('scBack'), () => back());
    press($('scLogoff'), () => { SFX.key(); endShift(); });
    press($('scHint'), () => useHint());
    press(tillBtn, () => openTill());
    press($('scKbd'), () => { SFX.key(); toast('No typing: scan the location once for each item'); });
    press($('scUp'), () => page(-1)); press($('scDown'), () => page(1));
    press($('scPrev'), () => page(-1)); press($('scNext'), () => page(1));
    scPad.querySelectorAll('button').forEach((b) => press(b, () => { const k = b.dataset.k; if (k === 'back') back(); else if (k === 'enter') enter(); else digit(k); }));
    scanner.addEventListener('pointerdown', (e) => e.stopPropagation());
    $('scScreen').addEventListener('scroll', (e) => { e.target.scrollTop = 0; e.target.scrollLeft = 0; }); // never scrolled (older browsers without overflow: clip)

    /* ---------- controls: squat ---------- */
    const squatBtn = $('squatBtn');
    function toggleSquat() {
      me.squat = !me.squat;
      squatBtn.setAttribute('aria-pressed', String(me.squat));
      squatBtn.firstChild.textContent = me.squat ? 'Stand' : 'Squat';
      SFX.key();
    }
    press(squatBtn, () => toggleSquat());

    /* ---------- controls: the stick (left thumb), looking (drag), tapping to scan ---------- */
    const zone = $('stickZone'), stick = $('stick'), knob = $('knob');
    let stickId = null, stickC = null;
    const stickHome = () => { stick.style.left = ''; stick.style.top = ''; stick.classList.remove('live'); knob.style.transform = ''; };
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
      stickIn.x = dx; stickIn.y = dy;
      knob.style.transform = 'translate(' + (dx * R * 0.85) + 'px,' + (dy * R * 0.85) + 'px)';
    });
    const stickEnd = (e) => { if (e.pointerId !== stickId) return; stickId = null; stickIn.x = stickIn.y = 0; stickHome(); };
    zone.addEventListener('pointerup', stickEnd); zone.addEventListener('pointercancel', stickEnd);

    const looks = new Map();
    const locked = () => document.pointerLockElement === canvas;
    function lockMouse() { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (x) { /* not allowed */ } }
    canvas.addEventListener('pointerdown', (e) => {
      if (!playing()) return;
      initAudio();
      if (e.pointerType === 'mouse') {
        if (!locked() && !mouseDrag) { lockMouse(); e.preventDefault(); return; }
        if (locked()) { if (e.button === 0) { const c = centreNdc(); scanAt(c[0], c[1]); } e.preventDefault(); return; }
      }
      try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
      looks.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = looks.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      const k = (e.pointerType === 'mouse' ? 0.005 : 0.0065) * LOOKS[lookPick][1];
      me.yaw -= dx * k; me.pitch -= dy * k; applyCam(); dirty = true;
    });
    const lookEnd = (e) => {
      const p = looks.get(e.pointerId);
      if (!p) return;
      looks.delete(e.pointerId);
      if (e.type === 'pointerup' && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 10 && performance.now() - p.t < 450) { // a tap: scan what's there
        const r = canvas.getBoundingClientRect();
        scanAt(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      }
    };
    canvas.addEventListener('pointerup', lookEnd); canvas.addEventListener('pointercancel', lookEnd);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    let mouseDrag = false; // if the mouse can't be captured, dragging looks round instead
    document.addEventListener('pointerlockerror', () => { mouseDrag = true; toast('Drag with the mouse to look round'); });
    document.addEventListener('pointerlockchange', () => { if (locked()) toast('Esc lets go of the mouse'); dirty = true; });
    document.addEventListener('mousemove', (e) => {
      if (!locked() || Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
      const k = 0.0022 * LOOKS[lookPick][1];
      me.yaw -= e.movementX * k; me.pitch -= e.movementY * k; applyCam(); dirty = true;
    });

    /* ---------- controls: keyboard ---------- */
    const KEYMAP = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', KeyD: 'r', ArrowLeft: 'tl', ArrowRight: 'tr', KeyQ: 'tl', KeyE: 'tr' };
    window.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (till && till.isOpen() && $('helpCover').hidden) { if (e.key === 'Escape') closeTill(); return; }
      if (!playing()) { if (e.key === 'Escape' && !$('helpCover').hidden) showHelp(false); return; }
      if (!scMenu.hidden) {
        const b = scMenu.querySelector('button[data-k="' + e.key + '"]');
        if (b) { b.click(); e.preventDefault(); return; }
        if (e.key === 'Escape' || e.key === 'Tab') { menu(false); e.preventDefault(); return; }
      }
      if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); e.preventDefault(); return; }
      if (e.key === 'Shift') { running = true; return; }
      if (e.repeat) return;
      if (/^[0-9]$/.test(e.key)) { digit(e.key); e.preventDefault(); return; }
      switch (e.code) {
        case 'KeyF': case 'Space': { const c = centreNdc(); scanAt(c[0], c[1]); e.preventDefault(); break; }
        case 'KeyC': toggleSquat(); break;
        case 'KeyH': case 'F4': useHint(); e.preventDefault(); break;
        case 'Enter': case 'NumpadEnter': SFX.key(); enter(); e.preventDefault(); break;
        case 'Backspace': back(); e.preventDefault(); break;
        case 'Tab': case 'KeyM': SFX.key(); menu(scMenu.hidden); e.preventDefault(); break;
        case 'PageUp': case 'BracketLeft': page(-1); break;
        case 'PageDown': case 'BracketRight': page(1); break;
        default:
      }
    });
    window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]); if (e.key === 'Shift') running = false; });
    window.addEventListener('blur', () => { keys.clear(); running = false; stickIn.x = stickIn.y = 0; stickId = null; stickHome(); });

    /* ---------- screens: start, help, end of shift ---------- */
    let active = false;
    const playing = () => active && $('helpCover').hidden && $('endCover').hidden && !(till && till.isOpen());
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
      const mins = Math.max(1, Math.round((Date.now() - stats.since) / 60000));
      statsHtml($('endStats'), [[stats.orders, 'orders'], [stats.lines, 'lines picked'], [stats.units, 'units'], [stats.perfect || 0, 'perfect picks'], [stats.wrong, 'wrong scans'], [mins + ' min', 'on shift']]);
      $('endCover').hidden = false;
    }
    $('keepBtn').addEventListener('click', () => { $('endCover').hidden = true; });
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

    statsHtml($('startStats'), [[life.orders, 'orders done'], [life.lines, 'lines picked'], [world.items.length.toLocaleString('en-GB'), 'products']]);
    $('startBtn').addEventListener('click', () => {
      initAudio();
      if (touch && !standalone) fullScreen(true);
      $('startCover').hidden = true;
      ['topBar', 'scanner', 'cross', 'squatBtn'].forEach((id) => { $(id).hidden = false; });
      $('stickZone').hidden = !touch;
      active = true;
      stayAwake();
      layout();
      if (!order && state === 'idle') {
        const c = customers[0];
        waitingCustomer = c; dress(c); prepare(c);
        c.group.visible = true; c.state = 'waiting';
        c.group.position.set(spot.x, 0, spot.y); c.group.rotation.y = Math.PI;
        startOrderFor(c); setTimeout(() => served(c), tillKind(c.kind) ? 900 : 1200);
      }
      if (till) till.preload();
      let helped = false;
      try { helped = localStorage.getItem('ws-helped') === '1'; localStorage.setItem('ws-helped', '1'); } catch (e) { /* fine */ }
      if (!helped) showHelp(true);
      else if (!touch) toast('Click the view to look round');
      canvas.focus({ preventScroll: true });
      dirty = true;
    });

    /* ---------- keep the screen awake while picking ---------- */
    let wake = null;
    async function stayAwake() {
      try { if (navigator.wakeLock && !wake && !document.hidden && active) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { wake = null; }
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { stayAwake(); last = performance.now(); } else { keys.clear(); stickIn.x = stickIn.y = 0; } });

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

    /* ---------- the frame loop ---------- */
    let last = performance.now(), photoT = 0, photoDirty = true, slow = 0, quick = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      if (document.hidden) return;
      let changed = dirty;
      if (playing()) {
        if (stepMove(dt)) { changed = true; photoDirty = true; }
        checkCounter();
        checkTill();
      }
      if (updateMoving(dt)) changed = true;
      if (updateFlyers(dt)) changed = true;
      if (updateCustomers(dt)) changed = true;
      if (updateTotes(dt)) changed = true;
      if (active && updateCrew(dt)) changed = true;
      if (updateHint(dt)) changed = true;
      if (viewTimer > 0) { viewTimer -= dt; if (viewTimer <= 0 && viewLine >= 0) { viewLine = -1; renderScanner(); } }
      if (msg && now > msgUntil) { msg = null; renderScanner(); }
      if (!sayEl.hidden && sayLine && now - sayShown > (sayLine.quote ? 24000 : 14000)) sayEl.hidden = true;
      for (const b of crew) for (const bub of [b.bub, b.cbub]) if (!bub.el.hidden && now > bub.until) bub.el.hidden = true;
      if (S.photos.flush()) changed = true;
      photoT -= dt;
      if (photoT <= 0 && (photoDirty || changed)) { S.photos.update(cam); photoT = 0.2; photoDirty = false; changed = true; }
      if (!changed) return;
      dirty = false;
      if (active) updateAim();
      renderer.render(scene, cam);
      placeSay();
      placeBubs(now);
      // a phone that keeps struggling draws fewer pixels; one with room to spare gets them back
      if (dt > 0.03 && me.speed > 0.2) { slow++; quick = 0; } else if (dt < 0.018) { quick++; slow = Math.max(0, slow - 1); }
      if (slow > 45 && dpr > 0.8) { dpr = Math.max(0.8, dpr - 0.25); renderer.setPixelRatio(dpr); layout(); slow = 0; }
      if (quick > 300 && dpr < MAX_DPR) { dpr = Math.min(MAX_DPR, dpr + 0.25); renderer.setPixelRatio(dpr); layout(); quick = 0; }
    }

    /* ---------- warm up behind the loading bar, then show the start screen ---------- */
    progress(0.9, 'Nearly there…'); await breathe();
    try { renderer.compile(scene, cam); } catch (e) { /* compiled on first draw instead */ }
    S.photos.update(cam);
    renderer.render(scene, cam);
    progress(1);
    await breathe();
    $('loading').hidden = true;
    $('startCover').hidden = false;
    renderScanner();
    requestAnimationFrame(frame);
    window.__shift = { world, S, me, cam, renderer, scanAt, state: () => state, order: () => order, applyCam, hitAt, newOrder, pickAll: () => { while (state === 'qty' && order && order.lines[cur]) countOne(); }, countOne, enter, handOver, useHint, toggleSquat, layout,
      till, openTill, closeTill, skipCustomer, customer: () => waitingCustomer, tills, nearTill: () => nearTill, parcels, holdHit, scanHold, spotBox,
      crew, reserved, customers,
      tick: (sec) => { for (let t = 0; t < sec; t += 0.05) { updateMoving(0.05); updateCustomers(0.05); updateTotes(0.05); if (active) updateCrew(0.05); } dirty = true; } };
  }
})();
