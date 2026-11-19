/* Warehouse Shift (Dunstable, LB1 only): a picking game in a made-up Screwfix-style warehouse.

   A customer orders at the trade counter. The scanner (drawn like the Symbol handsets in detailedfoil's photos)
   shows one pick at a time, in location order, so you walk up the right side and back down the left. Walk to the
   location, look at it and Scan (or tap it on a phone), type the quantity, Enter. When the tote's full, take it to
   the counter and hand it over; the next customer walks in. Hint makes the location glow. Squat for the bottom
   shelves. Played mainly with the phone sideways: left thumb walks, drag to look. On a computer: WASD, mouse look.

   world.js makes the warehouse and the orders, scene.js draws it. This file is the rest: the camera, the controls,
   the scanner, the sounds and the game itself. */
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
    if (!window.THREE || !window.ShiftWorld || !window.ShiftScene) { fail("The game didn't load. Check your signal and reload the page."); return; }
    progress(0.1, 'Loading the products…');
    fetch('warehouse-shift/data/catalogue.json')
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(async (cat) => {
        progress(0.35, 'Stocking the shelves…'); await breathe();
        try { await start(cat); } catch (e) { console.error(e); fail('Something went wrong building the warehouse. Reload the page to try again.'); }
      })
      .catch((e) => { console.error(e); fail("Couldn't load the products. Check your signal and reload the page."); });
  }
  window.addEventListener('toolbox:login', boot);
  boot();

  async function start(cat) {
    const T = THREE, World = window.ShiftWorld;
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
        if (!blocked(nx, me.y)) me.x = nx; else me.vx = 0;
        if (!blocked(me.x, ny)) me.y = ny; else me.vy = 0;
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
      hint: () => { tone(660, 0, 0.12, 'sine', 0.06, 990); }
    };

    /* ---------- the scanner screen ---------- */
    const scText = $('scText'), scQty = $('scQty'), scCur = $('scCur'), scPad = $('scPad'), scMenu = $('scMenu'), scFlash = $('scFlash'), scEnter = $('scEnter'), scHint = $('scHint');
    const short = (s) => String(s).slice(0, 20).trim();
    const four = (n) => String(n).padStart(4, '0');
    let order = null, cur = 0, state = 'idle', typed = '', viewLine = -1, viewTimer = 0, msgUntil = 0, msg = null, orderNo = 0, atCounter = false;
    const stats = { orders: 0, lines: 0, units: 0, wrong: 0, hints: 0, since: Date.now() };
    let life = { orders: 0, lines: 0, units: 0 };
    try { life = Object.assign(life, JSON.parse(localStorage.getItem('ws-stats-v1') || '{}')); } catch (e) { /* fine */ }
    function saveLife() { try { localStorage.setItem('ws-stats-v1', JSON.stringify(life)); } catch (e) { /* fine */ } }
    function lineHtml(text, cls) { const s = document.createElement('span'); s.className = 'sc-line' + (cls ? ' ' + cls : ''); s.textContent = text; return s; }
    function say(text, cls, ms) { msg = { text, cls }; msgUntil = performance.now() + (ms || 1700); renderScanner(); }
    function renderTote() {
      const el = $('toteCount');
      if (!order || state === 'between') { el.textContent = '0'; return; }
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
      } else if (state === 'deliver') {
        L.push(['Today Picking'], ['Pick Complete', 'ok'], ['Order ' + four(order.no), 'big'], [order.lines.length + (order.lines.length > 1 ? ' lines ' : ' line ') + order.units + ' units', 'gap dim']);
        L.push(atCounter ? ['Press Enter to', 'gap warn'] : ['Take tote to', 'gap'], atCounter ? ['hand over', 'warn'] : ['Trade Counter']);
      } else if (state === 'between') {
        L.push(['Today Picking'], ['Order handed over', 'ok'], ['Next customer', 'big'], ['coming in…', 'dim']);
      } else {
        L.push(['Today Picking'], ['Pick To Tote/Trolley'], ['Ready', 'big']);
      }
      scText.replaceChildren(...L.map((l) => lineHtml(l[0], l[1])));
      if (showMsg) scText.appendChild(lineHtml(msg.text, 'gap ' + (msg.cls || 'warn')));
      $('scPicked').style.visibility = state === 'scan' || state === 'qty' ? '' : 'hidden';
      scQty.textContent = state === 'qty' ? typed : '';
      scCur.className = 'sc-cur' + (state === 'qty' ? '' : ' line');
      scEnter.classList.toggle('pulse', state === 'deliver' && atCounter);
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
      else S.aimBox.visible = false;
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
      if (state === 'between' || state === 'idle') return;
      if (state === 'qty') { say('Enter the quantity', 'warn'); SFX.miss(); return; }
      const h = hitAt(nx, ny);
      if (!h) { say('No barcode there', 'dim'); SFX.miss(); return; }
      if (h.dist > REACH) { say('Too far away', 'warn'); toast('Get closer to scan'); SFX.miss(); return; }
      if (h.loc.z0 < LOW && !me.squat) { say('Squat down to scan it', 'warn'); toast(touch ? 'Too low: squat down' : 'Too low: squat (C)'); SFX.bad(); flash(true); return; }
      const ln = order.lines[cur], tr = S.trayOf(h.loc);
      S.setBox(S.aimBox, S.locBox(h.loc), 0.012); S.aimBox.visible = true;
      if (World.sameSpot(h.loc, ln.loc)) {
        SFX.scan(); flash(false);
        state = 'qty'; typed = ''; viewLine = -1;
        openTimer = 0;
        if (tr) slideTray(tr, true); else if (ln.loc.item) { pulled = ln.loc.item; pulled.pullTarget = ln.loc.face.kind === 'BB' ? 0.12 : 0.07; pulling.add(pulled); }
        if (hint.loc === ln.loc) hint.until = 0;
        toast(ln.loc.code + '  ✓', 'good');
        setPad(touch || padWanted);
        if (!touch && !padWanted) say('Type the qty, Enter', 'dim', 2600);
        renderScanner();
      } else {
        stats.wrong++; order.slips = (order.slips || 0) + 1;
        SFX.bad(); flash(true);
        if (tr) { slideTray(tr, true); openTimer = 1.1; }
        say('Wrong location', 'err', 2000);
        toast(h.loc.code + '  ✗', 'bad');
      }
    }
    function confirmQty() {
      if (state !== 'qty') return;
      const ln = order.lines[cur];
      if (!typed) { say('Enter the quantity', 'warn'); SFX.miss(); return; }
      if (Number(typed) !== ln.qty) { order.slips = (order.slips || 0) + 1; say('Qty does not match', 'err'); SFX.bad(); flash(true); typed = ''; renderScanner(); return; }
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
      if (state === 'qty') {
        SFX.key();
        if (typed) typed = typed.slice(0, -1);
        else { state = 'scan'; setPad(false); if (openTray) openTray.target = 0; if (pulled) pulled.pullTarget = 0; }
        renderScanner();
      }
    }
    function digit(k) {
      if (state !== 'qty') { if (state === 'scan') { say('Scan the location first', 'warn'); SFX.miss(); } return; }
      if (typed.length >= 3) return;
      SFX.key(); typed = (typed === '0' ? '' : typed) + k; renderScanner();
    }
    function enter() {
      if (!scMenu.hidden) return;
      if (state === 'qty') confirmQty();
      else if (state === 'deliver') { if (atCounter) handOver(); else { say('Take the tote to the counter', 'warn'); SFX.miss(); } }
      else if (state === 'scan') { say('Scan the location first', 'warn'); SFX.miss(); }
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

    /* ---------- hint: the location glows ---------- */
    const hint = { until: 0, loc: null, counter: false, t: 0 };
    function useHint() {
      if (!order || state === 'between' || state === 'idle') return;
      SFX.hint(); stats.hints++; order.slips = (order.slips || 0) + 1;
      hint.until = performance.now() + 12000; hint.t = 0;
      hint.loc = state === 'deliver' ? null : order.lines[cur].loc;
      hint.counter = state === 'deliver';
      scHint.classList.add('flash'); setTimeout(() => scHint.classList.remove('flash'), 200);
      toast(hint.counter ? 'The counter is glowing' : 'Look for the glow: ' + hint.loc.face.area + ' aisle', '');
      renderScanner(); dirty = true;
    }
    function updateHint(dt) {
      const on = hint.until > performance.now();
      if (!on) { if (S.glow.visible || S.signGlow.visible) { S.glow.visible = S.signGlow.visible = false; renderScanner(); return true; } return false; }
      hint.t += dt;
      const pulse = 0.5 + 0.5 * Math.sin(hint.t * 6.5);
      S.glowMat.opacity = 0.28 + 0.5 * pulse;
      if (hint.counter) {
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
    const lane = gond.length > 1 ? (gond[0].x1 + gond[1].x0) / 2 : shopRoom.x0 + 1.2;
    const spot = world.customer;
    const PATH = [[(ent.from + ent.to) / 2, world.D + 0.6], [(ent.from + ent.to) / 2, world.D - 0.5], [lane, world.D - 1.2], [lane, counter.y1 + 1.0], [spot.x, spot.y]];
    const OUTFITS = [[0xf07a1a, 0x2f3540, 0xdfe3e8], [0xd9e021, 0x23272e, 0xdfe3e8], [0x23395b, 0x3a3f47], [0x5a5f66, 0x22262c], [0x1d1f22, 0x4a3f33], [0xb3261e, 0x2f3540], [0x2e7d32, 0x3b3328], [0x0f5fa8, 0x23272e], [0xe8590c, 0x1f2328, 0xdfe3e8]];
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
    function arrive(c) { dress(c); walk(c, PATH, () => { c.state = 'waiting'; c.group.rotation.y = Math.PI; }); }
    function leave(c) { walk(c, PATH.slice().reverse(), () => { c.state = 'away'; c.group.visible = false; c.carry = false; if (c.tote) { S.dropTote(c.tote); c.tote = null; } }); }
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
    function handOver() {
      if (state !== 'deliver') return;
      state = 'between'; atCounter = false; hint.until = 0;
      SFX.done(); flash(false);
      stats.orders++; life.orders++; saveLife();
      $('doneCount').textContent = String(stats.orders);
      const perfect = !order.slips;
      banner('Order ' + four(order.no) + ' complete', (perfect ? 'Perfect pick! ' : '') + order.lines.length + (order.lines.length > 1 ? ' lines, ' : ' line, ') + order.units + ' units', 2400);
      if (perfect) { stats.perfect = (stats.perfect || 0) + 1; life.perfect = (life.perfect || 0) + 1; saveLife(); }
      // the tote goes on the counter, slides over to the customer, and leaves with them
      const c = waitingCustomer;
      const tote = S.makeTote(order.lines.map((l) => l.item.colour));
      tote.position.set(Math.max(counter.x0 + 0.4, Math.min(counter.x1 - 0.4, me.x)), 1.0, counter.y0 + 0.22);
      totes.push({ t: 0, tote, from: tote.position.clone(), to: new T.Vector3(c ? c.group.position.x : spot.x, 1.0, counter.y1 - 0.2), c });
      renderScanner();
      setTimeout(() => { const next = freeCustomer(c); arrive(next); waitingCustomer = next; }, 1400);
      setTimeout(() => newOrder(), 2600); // after the order complete banner has had its moment
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
    function newOrder() {
      orderNo++;
      const lines = World.order(world, rng);
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
        ['5', 'Skip order', () => { if (state === 'scan' || state === 'qty') { if (openTray) openTray.target = 0; if (pulled) pulled.pullTarget = 0; setPad(false); newOrder(); } }],
        ['6', 'Help', () => showHelp(true)],
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
    press($('scKbd'), () => { SFX.key(); padWanted = !scPad.classList.contains('up'); setPad(padWanted); });
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
    const playing = () => active && $('helpCover').hidden && $('endCover').hidden;
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
      if (!order) {
        waitingCustomer = customers[0]; dress(customers[0]);
        customers[0].group.visible = true; customers[0].state = 'waiting';
        customers[0].group.position.set(spot.x, 0, spot.y); customers[0].group.rotation.y = Math.PI;
        newOrder();
      }
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
      }
      if (updateMoving(dt)) changed = true;
      if (updateFlyers(dt)) changed = true;
      if (updateCustomers(dt)) changed = true;
      if (updateTotes(dt)) changed = true;
      if (updateHint(dt)) changed = true;
      if (viewTimer > 0) { viewTimer -= dt; if (viewTimer <= 0 && viewLine >= 0) { viewLine = -1; renderScanner(); } }
      if (msg && now > msgUntil) { msg = null; renderScanner(); }
      if (S.photos.flush()) changed = true;
      photoT -= dt;
      if (photoT <= 0 && (photoDirty || changed)) { S.photos.update(cam); photoT = 0.2; photoDirty = false; changed = true; }
      if (!changed) return;
      dirty = false;
      if (active) updateAim();
      renderer.render(scene, cam);
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
    window.__shift = { world, S, me, cam, renderer, scanAt, state: () => state, order: () => order, applyCam, hitAt, newOrder, typeQty: (q) => { String(q).split('').forEach(digit); }, enter, handOver, useHint, toggleSquat, layout };
  }
})();
