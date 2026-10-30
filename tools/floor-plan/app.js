/* 3D Floor Plan (Dunstable, LB1 only). Builds the store from floor-plan/data/layout.json with three.js, which is
   floor-plan/three/three.min.js: a plain script that sets the global THREE (how it was made is noted at its top).

   Plan coordinates are metres: x runs across from the inside of the left wall, y from the inside of the back wall
   towards the shop front, z is height. three.js has y up, so a plan point (x, y, z) is the vector (x, z, y).

   Three views: 3D (turn round the store), Top (a flat plan) and Walk (first person: a stick on phones, WASD or the
   arrow keys on a PC, mouse look like a game). Bays are named from data/locations.json (AAC 3 ...), or a temporary
   row letter + bay number + b / f where there's no location yet. With the stock list loaded (stock.js reads it; it
   stays on the device): products are boxes on the shelves or in the drawers, the search jumps to one, free spots
   (nothing nailed) show green, and the boxes near you get the Toolbox's own saved product photos. */
(function () {
  'use strict';

  const STORE = 'LB1';
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), canvas = $('view'), msg = $('msg');

  function signedInAs() {
    try { return (localStorage.getItem('toolbox.signedIn.area20') || '').toUpperCase(); } catch (e) { return ''; }
  }
  const loading = $('loading');
  function say(text) { msg.textContent = text; msg.hidden = !text; if (text) loading.hidden = true; }
  function progress(frac, text) { // the loading bar
    const pc = Math.round(frac * 100);
    $('loadBar').style.width = pc + '%'; loading.setAttribute('aria-valuenow', String(pc));
    if (text) $('loadText').textContent = text;
  }
  const breathe = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // lets the bar move before the next step

  let booted = false;
  function boot() {
    if (booted) return;
    const me = signedInAs();
    if (!me) return; // the sign-in screen is up; its "toolbox:login" event brings us back here
    booted = true;
    if (me !== STORE) { say('The 3D floor plan is only for Dunstable (LB1).'); return; }
    if (!window.THREE || !window.FloorBays || !window.FloorStock) { say("The 3D viewer didn't load. Check your signal and reload the page."); return; }
    const get = (f) => fetch('floor-plan/data/' + f, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    progress(0.08, 'Loading the store\u2026');
    // the stock locations are a bonus: without them the bays just keep their temporary names
    Promise.all([get('layout.json'), get('locations.json').catch(() => null)])
      .then(async ([layout, locs]) => {
        progress(0.25, 'Building the racking\u2026'); await breathe();
        try { await start(layout, locs); } catch (e) { console.error(e); say('Something went wrong drawing the store. Reload the page to try again.'); }
      })
      .catch((e) => { console.error(e); say("Couldn't load the store layout. Check your signal and reload the page."); });
  }
  window.addEventListener('toolbox:login', boot);
  boot();

  async function start(L, LOCS) {
    const T = THREE;
    const B = L.building, W = B.w, D = B.d, H = B.h, WT = B.t, CUT = B.cut || 3.2;
    const ROOM_H = 2.85;
    const V = (x, y, z) => new T.Vector3(x, z, y);

    /* ---------- renderer ---------- */
    let renderer;
    try {
      renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      say("This phone or browser can't show 3D graphics (WebGL is switched off)."); return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false; // nothing moves, so the shadows are worked out once
    const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

    let dirty = true, last = performance.now(), scheduled = false; // draw only when something changed; sleep when nothing does
    function wake() { if (!scheduled) { scheduled = true; if (performance.now() - last > 100) last = performance.now(); requestAnimationFrame(frame); } }
    function redraw() { dirty = true; wake(); }
    const scene = new T.Scene();
    const dark = !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    scene.background = new T.Color(dark ? 0x1c2028 : 0xdde3ea);

    /* ---------- textures (drawn on canvases, so there are no image files) ---------- */
    let seed = 20261029;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    function tex(w, h, draw) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      draw(c.getContext('2d'), w, h);
      const t = new T.CanvasTexture(c);
      t.colorSpace = T.SRGBColorSpace; t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = maxAniso;
      return t;
    }
    function speckle(g, w, h, n, a) {
      for (let i = 0; i < n; i++) {
        const v = rnd() < 0.5 ? 0 : 255;
        g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (a * rnd()).toFixed(3) + ')';
        g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
      }
    }
    const repeatOf = (t, rx, ry) => { const c = t.clone(); c.repeat.set(rx, ry); c.needsUpdate = true; return c; };
    // concrete: one tile is 4 m, faint lines every metre to help judge distances
    const TX_CONCRETE = tex(512, 512, (g, w, h) => {
      g.fillStyle = '#bfc2c5'; g.fillRect(0, 0, w, h); speckle(g, w, h, 9000, 0.09);
      g.fillStyle = 'rgba(60,66,74,.08)';
      for (let i = 0; i < 4; i++) { g.fillRect(i * 128, 0, 2, h); g.fillRect(0, i * 128, w, 2); }
    });
    // shop floor tiles: one texture is 1.2 m (four 60 cm tiles)
    const TX_TILE = tex(256, 256, (g, w, h) => {
      g.fillStyle = '#d8dbdf'; g.fillRect(0, 0, w, h); speckle(g, w, h, 1500, 0.05);
      g.fillStyle = '#b9bec5'; for (const p of [0, 128]) { g.fillRect(p, 0, 3, h); g.fillRect(0, p, w, 3); }
    });
    const vinyl = (base) => tex(128, 128, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); speckle(g, w, h, 900, 0.05); });
    const TX_ASPHALT = tex(256, 256, (g, w, h) => { g.fillStyle = '#5f646b'; g.fillRect(0, 0, w, h); speckle(g, w, h, 6000, 0.12); });
    // welded mesh for the cages: 64 px = 20 cm, a wire every 5 cm
    const TX_MESH = tex(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.fillStyle = '#9ba3ad';
      for (let i = 0; i < 4; i++) { g.fillRect(i * 16, 0, 2, h); g.fillRect(0, i * 16, w, 2); }
    });
    // roller shutter slats: 64 px = 40 cm
    const TX_SHUTTER = tex(16, 64, (g, w, h) => {
      for (let y = 0; y < h; y++) { const s = 150 + 50 * Math.sin((y / 8) * Math.PI); g.fillStyle = 'rgb(' + (s | 0) + ',' + ((s + 4) | 0) + ',' + ((s + 10) | 0) + ')'; g.fillRect(0, y, w, 1); }
    });
    // yellow hatching for floor areas
    const TX_HATCH = tex(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(242,196,0,.85)'; g.lineWidth = 9;
      for (let i = -64; i <= 128; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke(); }
    });

    /* ---------- materials ---------- */
    const lam = (color, extra) => new T.MeshLambertMaterial(Object.assign({ color }, extra || {}));
    const M = {
      wall: lam(0xe7e9ec), inner: lam(0xf1f2f4), column: lam(0x8b939d),
      upright: lam(0x2d5ea8), beam: lam(0xf07a1a), deck: lam(0xc9a87c), meshDeck: lam(0xa7aeb7), brace: lam(0x2d5ea8),
      cabinet: lam(0xf2c400), black: lam(0x24272c),
      counter: lam(0x15396b), counterTop: lam(0xeef0f3), till: lam(0x23272e),
      gondola: lam(0xf3f4f6), gshelf: lam(0xd5dae0), plinth: lam(0x8f97a1),
      grey: lam(0xa3aab3), wood: lam(0xb88a5c), seat: lam(0x3a424e), white: lam(0xf8f9fa), steel: lam(0xbac1c9),
      heater: lam(0x4f555e), door: lam(0x3f8f5a), frame: lam(0x3a3f47),
      lamp: new T.MeshBasicMaterial({ color: 0xffffff }),
      lampBox: lam(0x9aa1aa),
      glass: new T.MeshLambertMaterial({ color: 0x9fd0ee, transparent: true, opacity: 0.32, depthWrite: false, side: T.DoubleSide }),
      cage: new T.MeshLambertMaterial({ map: TX_MESH, transparent: true, alphaTest: 0.4, side: T.DoubleSide }),
      hatch: new T.MeshBasicMaterial({ map: TX_HATCH, transparent: true, depthWrite: false }),
      roof: lam(0xd9dce0, { side: T.DoubleSide }), ceiling: lam(0xf2f3f5, { side: T.DoubleSide }),
    };

    /* ---------- building blocks ---------- */
    const groups = {};
    // main: always shown. cut / full: outer walls cut at 3.2 m (3D and Top) or full height (Walk).
    // walk: roof, ceilings and lights (Walk only). signs, names: labels (names = the bay names, switched by a button).
    for (const g of ['main', 'cut', 'full', 'walk', 'signs', 'names']) { groups[g] = new T.Group(); scene.add(groups[g]); }
    groups.full.visible = groups.walk.visible = groups.names.visible = false;

    const unitBox = new T.BoxGeometry(1, 1, 1);
    const batches = new Map();
    const _p = new T.Vector3(), _s = new T.Vector3(), _q = new T.Quaternion();
    // every plain box goes into one InstancedMesh per material and group: a few dozen draw calls for the whole store
    function addMatrix(mat, group, shadow, m) {
      const key = group + '|' + mat.uuid + '|' + shadow;
      let b = batches.get(key);
      if (!b) batches.set(key, (b = { mat, group, shadow, list: [] }));
      b.list.push(m);
    }
    function box(mat, x0, y0, z0, x1, y1, z1, group, shadow) {
      group = group || 'main';
      _p.set((x0 + x1) / 2, (z0 + z1) / 2, (y0 + y1) / 2);
      _s.set(Math.max(Math.abs(x1 - x0), 0.002), Math.max(Math.abs(z1 - z0), 0.002), Math.max(Math.abs(y1 - y0), 0.002));
      addMatrix(mat, group, shadow !== false && group !== 'full' && group !== 'walk', new T.Matrix4().compose(_p, _q.identity(), _s));
    }
    // a thin bar from plan point a to plan point b ([x, y, z])
    function bar(mat, a, b, t, group) {
      const A = V(a[0], a[1], a[2]), Bv = V(b[0], b[1], b[2]);
      const dir = Bv.clone().sub(A), len = dir.length();
      const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(1, 0, 0), dir.normalize());
      addMatrix(mat, group || 'main', true, new T.Matrix4().compose(A.add(Bv).multiplyScalar(0.5), q, new T.Vector3(len, t, t)));
    }
    function flush() {
      for (const b of batches.values()) {
        const im = new T.InstancedMesh(unitBox, b.mat, b.list.length);
        b.list.forEach((m, i) => im.setMatrixAt(i, m));
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = b.shadow; im.receiveShadow = true; im.frustumCulled = false;
        groups[b.group].add(im);
      }
      batches.clear();
    }
    // a box with its own geometry whose texture repeats every `per` metres (cages, shutter)
    function texturedBox(mat, x0, y0, z0, x1, y1, z1, per, group) {
      const sx = x1 - x0, sy = z1 - z0, sz = y1 - y0;
      const g = new T.BoxGeometry(sx, sy, sz);
      const uv = g.attributes.uv;
      const faces = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]]; // +x -x +y -y +z -z
      for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
        const i = f * 4 + k; uv.setXY(i, uv.getX(i) * faces[f][0] / per, uv.getY(i) * faces[f][1] / per);
      }
      const m = new T.Mesh(g, mat);
      m.position.set((x0 + x1) / 2, (z0 + z1) / 2, (y0 + y1) / 2);
      m.castShadow = true; m.receiveShadow = true;
      groups[group || 'main'].add(m);
      return m;
    }
    function plane(mat, x0, y0, x1, y1, z, group, facingDown) {
      const g = new T.PlaneGeometry(x1 - x0, y1 - y0);
      g.rotateX(facingDown ? Math.PI / 2 : -Math.PI / 2);
      const m = new T.Mesh(g, mat);
      m.position.set((x0 + x1) / 2, z, (y0 + y1) / 2);
      m.receiveShadow = true;
      groups[group || 'main'].add(m);
      return m;
    }

    /* ---------- labels: text drawn on a canvas, shown as a sprite that always faces you ---------- */
    function label(text, o) {
      o = o || {};
      const px = 72, pad = 22;
      const c = document.createElement('canvas'), g = c.getContext('2d');
      const font = (o.weight || 750) + ' ' + px + 'px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
      g.font = font;
      const w = Math.ceil(g.measureText(text).width) + pad * 2, h = px + pad * 1.4;
      c.width = w; c.height = h;
      g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = o.bg || 'rgba(21,57,107,.95)';
      const r = Math.min(26, h / 2);
      g.beginPath(); g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r); g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.closePath(); g.fill();
      g.fillStyle = o.fg || '#ffffff';
      g.fillText(text, w / 2, h / 2 + 3);
      const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = maxAniso;
      const s = new T.Sprite(new T.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
      const size = o.size || 0.5;
      s.scale.set(size * w / h, size, 1);
      s.renderOrder = 3;
      return s;
    }
    function putLabel(group, text, x, y, z, o) { const s = label(text, o); s.position.copy(V(x, y, z)); groups[group].add(s); return s; }

    /* ---------- floor, ground and rooms ---------- */
    plane(new T.MeshLambertMaterial({ map: repeatOf(TX_ASPHALT, 30, 30) }), -40, -40, W + 40, D + 40, -0.03);
    plane(new T.MeshLambertMaterial({ map: repeatOf(TX_CONCRETE, W / 4, D / 4) }), 0, 0, W, D, 0);
    const FLOORS = { tile: (w, d) => repeatOf(TX_TILE, w / 1.2, d / 1.2), vinyl: (w, d, name) => repeatOf(vinyl(/staff/i.test(name) ? '#cdbfae' : '#c3cad3'), w, d) };
    for (const r of L.rooms) {
      const w = r.x1 - r.x0, d = r.y1 - r.y0;
      plane(new T.MeshLambertMaterial({ map: (FLOORS[r.floor] || FLOORS.vinyl)(w, d, r.name) }), r.x0, r.y0, r.x1, r.y1, 0.004);
      putLabel('signs', r.name, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, (r.ceiling || ROOM_H) + 0.45,
        { size: r.small ? 0.32 : 0.45, bg: 'rgba(255,255,255,.92)', fg: '#1d232c' });
      if (r.ceiling) {
        plane(M.ceiling, r.x0, r.y0, r.x1, r.y1, r.ceiling, 'walk', true);
        for (let x = r.x0 + 0.9; x < r.x1 - 0.4; x += 1.8) for (let y = r.y0 + 0.9; y < r.y1 - 0.4; y += 1.8) box(M.lamp, x - 0.3, y - 0.3, r.ceiling - 0.02, x + 0.3, y + 0.3, r.ceiling - 0.005, 'walk');
      }
    }
    for (const z of L.zones || []) {
      const m = plane(M.hatch, z.x0, z.y0, z.x1, z.y1, 0.008);
      m.material = M.hatch.clone(); m.material.map = repeatOf(TX_HATCH, (z.x1 - z.x0) / 0.6, (z.y1 - z.y0) / 0.6);
      putLabel('signs', z.name, (z.x0 + z.x1) / 2, (z.y0 + z.y1) / 2, 0.6, { size: 0.32, bg: 'rgba(242,196,0,.95)', fg: '#1d232c' });
    }
    for (const t of L.labels || []) putLabel('signs', t.text, t.x, t.y, t.z || 3.1, { size: 0.45, bg: 'rgba(255,255,255,.92)', fg: '#1d232c' });

    /* ---------- outer walls, doors, shutter, glazing ---------- */
    const SIDES = {
      back: { a0: -WT, a1: W + WT, seg: (a, b, z0, z1, mat, g) => box(mat, a, -WT, z0, b, 0, z1, g), mid: -WT / 2, across: 'y' },
      front: { a0: -WT, a1: W + WT, seg: (a, b, z0, z1, mat, g) => box(mat, a, D, z0, b, D + WT, z1, g), mid: D + WT / 2, across: 'y' },
      left: { a0: 0, a1: D, seg: (a, b, z0, z1, mat, g) => box(mat, -WT, a, z0, 0, b, z1, g), mid: -WT / 2, across: 'x' },
      right: { a0: 0, a1: D, seg: (a, b, z0, z1, mat, g) => box(mat, W, a, z0, W + WT, b, z1, g), mid: W + WT / 2, across: 'x' },
    };
    // a thin panel in the middle of a wall opening, from `from` to `to` along the wall
    function inWall(side, from, to, z0, z1, thick, mat, group) {
      const s = SIDES[side], m0 = s.mid - thick / 2, m1 = s.mid + thick / 2;
      if (s.across === 'y') box(mat, from, m0, z0, to, m1, z1, group); else box(mat, m0, from, z0, m1, to, z1, group);
    }
    function wallsAt(top, group) {
      for (const [side, s] of Object.entries(SIDES)) {
        const ops = L.openings.filter((o) => o.wall === side).sort((p, q) => p.from - q.from);
        let at = s.a0;
        for (const o of ops) {
          if (o.from > at + 0.001) s.seg(at, o.from, 0, top, M.wall, group);
          if (o.h < top) s.seg(o.from, o.to, o.h, top, M.wall, group);
          at = o.to;
        }
        if (at < s.a1) s.seg(at, s.a1, 0, top, M.wall, group);
        // what fills each opening
        for (const o of ops) {
          const h = Math.min(o.h, top);
          if (o.type === 'exit') inWall(side, o.from + 0.02, o.to - 0.02, 0, h, 0.05, M.door, group);
          if (o.type === 'shutter') {
            const s2 = SIDES[side];
            const m = s2.across === 'y'
              ? texturedBox(new T.MeshLambertMaterial({ map: TX_SHUTTER }), o.from, s2.mid - 0.04, 0, o.to, s2.mid + 0.04, h, 0.4, group)
              : texturedBox(new T.MeshLambertMaterial({ map: TX_SHUTTER }), s2.mid - 0.04, o.from, 0, s2.mid + 0.04, o.to, h, 0.4, group);
            m.castShadow = group === 'cut';
          }
          if (o.type === 'glass' || o.type === 'entrance') {
            inWall(side, o.from, o.to, 0.05, h - 0.06, 0.03, M.glass, group);
            inWall(side, o.from, o.from + 0.06, 0, h, 0.09, M.frame, group);
            inWall(side, o.to - 0.06, o.to, 0, h, 0.09, M.frame, group);
            inWall(side, o.from, o.to, h - 0.08, h, 0.09, M.frame, group);
            inWall(side, o.from, o.to, 0, 0.06, 0.09, M.frame, group);
            if (o.type === 'entrance') { const mid = (o.from + o.to) / 2; inWall(side, mid - 0.025, mid + 0.025, 0, h, 0.09, M.frame, group); inWall(side, o.from, o.to, 2.2, 2.27, 0.09, M.frame, group); }
          }
        }
      }
      for (const c of L.columns || []) box(M.column, c[0], c[1], 0, c[2], c[3], top, group);
    }
    wallsAt(CUT, 'cut');
    wallsAt(H, 'full');
    for (const o of L.openings) {
      if (o.type !== 'exit') continue;
      const s = SIDES[o.wall], inward = o.wall === 'back' || o.wall === 'left' ? 0.12 : -0.12, mid = (o.from + o.to) / 2;
      if (s.across === 'y') putLabel('signs', 'Fire exit', mid, (o.wall === 'back' ? 0 : D) + inward, o.h + 0.35, { size: 0.26, bg: 'rgba(31,122,61,.96)' });
      else putLabel('signs', 'Fire exit', (o.wall === 'left' ? 0 : W) + inward, mid, o.h + 0.35, { size: 0.26, bg: 'rgba(31,122,61,.96)' });
    }
    // inside walls (staff room, toilets, shop) go up to the 2.85 m ceiling
    for (const w of L.walls) box(M.inner, w[0], w[1], 0, w[2], w[3], ROOM_H);

    /* ---------- racking ---------- */
    const bays = [];
    const POST = 0.06;
    function drawBay(b) {
      const ax = b.along === 'x';
      const u0 = ax ? b.x0 : b.y0, u1 = ax ? b.x1 : b.y1, v0 = ax ? b.y0 : b.x0, v1 = ax ? b.y1 : b.x1;
      // put(mat, along-from, across-from, z-from, along-to, across-to, z-to): u runs along the row, v across it
      const put = (mat, ua, va, za, ub, vb, zb) => (ax ? box(mat, ua, va, za, ub, vb, zb) : box(mat, va, ua, za, vb, ub, zb));
      const pt = (u, v, z) => (ax ? [u, v, z] : [v, u, z]);
      const h = b.h;
      if (b.kind === 'cage') {
        const x0 = b.x0 + 0.02, x1 = b.x1 - 0.02, y0 = b.y0 + 0.02, y1 = b.y1 - 0.02;
        texturedBox(M.cage, x0, y0, 0, x1, y1, h, 0.2);
        for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) box(M.frame, x - 0.02, y - 0.02, 0, x + 0.02, y + 0.02, h);
        for (const z of b.zs || [0.9, 1.6]) box(M.meshDeck, x0, y0, z - 0.02, x1, y1, z);
        return;
      }
      if (b.kind === 'floor') { // no racking: a taped off patch of floor, the stock sits straight on it
        const x0 = b.x0, x1 = b.x1, y0 = b.y0, y1 = b.y1, t = 0.05, z = 0.012;
        box(M.cabinet, x0, y0, 0, x1, y0 + t, z); box(M.cabinet, x0, y1 - t, 0, x1, y1, z);
        box(M.cabinet, x0, y0, 0, x0 + t, y1, z); box(M.cabinet, x1 - t, y0, 0, x1, y1, z);
        return;
      }
      if (b.kind === 'cabinet') {
        // a yellow flammables cabinet with its doors open, so you can see the shelves and what's on them
        const x0 = b.x0 + 0.03, x1 = b.x1 - 0.03, y0 = b.y0 + 0.02, y1 = b.y1 - 0.02, t = 0.025;
        const north = b.open.indexOf('N') >= 0, fy = north ? y0 : y1, out = north ? -1 : 1;
        box(M.black, x0 + 0.02, y0 + 0.02, 0, x1 - 0.02, y1 - 0.02, 0.05);
        box(M.cabinet, x0, y0, 0.05, x0 + t, y1, h); box(M.cabinet, x1 - t, y0, 0.05, x1, y1, h); // sides
        if (north) box(M.cabinet, x0, y1 - t, 0.05, x1, y1, h); else box(M.cabinet, x0, y0, 0.05, x1, y0 + t, h); // back
        box(M.cabinet, x0, y0, h - t, x1, y1, h); box(M.cabinet, x0, y0, 0.05, x1, y1, 0.05 + t); // top, bottom
        for (const z of b.zs || [0.5, 1.0, 1.5]) if (z > 0.15) box(M.cabinet, x0 + t, y0 + t, z - 0.015, x1 - t, y1 - t, z);
        // the doors, hinged at the front corners and swung open
        const dw = (x1 - x0) / 2, ang = 2.1;
        for (const [hx, sx] of [[x0, 1], [x1, -1]]) {
          const dx = sx * Math.cos(ang), dy = out * Math.sin(ang);
          const m = new T.Matrix4().compose(V(hx + dx * dw / 2, fy + dy * dw / 2, 0.05 + (h - 0.05) / 2), new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.atan2(-dy, dx)), new T.Vector3(dw, h - 0.06, 0.02));
          addMatrix(M.cabinet, 'main', true, m);
        }
        const sign = label('FLAMMABLE', { size: 0.12, bg: 'rgba(36,39,44,.95)', fg: '#f2c400', weight: 800 });
        sign.position.copy(V((x0 + x1) / 2, fy + out * 0.02, h + 0.1));
        groups.main.add(sign);
        return;
      }
      // uprights: a frame at the start of every bay and one more at the end of the row
      const frameAt = (u, where) => {
        const a = where === 'start' ? u : where === 'end' ? u - POST : u - POST / 2;
        put(M.upright, a, v0, 0, a + POST, v0 + POST, h);
        put(M.upright, a, v1 - POST, 0, a + POST, v1, h);
        for (const z of [0.12, h - 0.06]) put(M.upright, a + POST * 0.2, v0, z, a + POST * 0.8, v1, z + 0.035);
      };
      frameAt(u0, b.firstInRow ? 'start' : 'mid');
      if (b.lastInRow) frameAt(u1, 'end');
      const uA = u0 + (b.firstInRow ? POST : POST / 2), uB = u1 - (b.lastInRow ? POST : POST / 2);
      const level = (z, deckMat) => {
        put(M.beam, uA, v0, z - 0.07, uB, v0 + 0.045, z - 0.01);
        put(M.beam, uA, v1 - 0.045, z - 0.07, uB, v1, z - 0.01);
        if (deckMat) put(deckMat, uA, v0 + 0.01, z - 0.01, uB, v1 - 0.01, z + 0.012);
      };
      const n = Math.max(2, b.levels);
      if (b.kind === 'pallet') {
        for (let k = 1; k < n; k++) level(0.15 + k * (h - 0.25) / (n - 1), M.meshDeck);
      } else if (b.kind === 'bulk') {
        level(h - 0.08, M.deck);
      } else {
        for (let k = 0; k < n; k++) level(b.zs ? b.zs[k] : 0.12 + k * (h - 0.2) / (n - 1), M.deck);
      }
      if (b.braced) {
        // X bracing on the back of the bay (or down the middle when it's open both sides)
        const open = b.open;
        let vb = (v0 + v1) / 2;
        if (open === 'N' || open === 'W') vb = v1 - 0.03;
        if (open === 'S' || open === 'E') vb = v0 + 0.03;
        bar(M.brace, pt(uA, vb, 0.15), pt(uB, vb, h - 0.1), 0.028);
        bar(M.brace, pt(uA, vb, h - 0.1), pt(uB, vb, 0.15), 0.028);
      }
    }
    const allBays = window.FloorBays.attach(window.FloorBays.list(L), LOCS);
    if (LOCS) window.FloorStock.levelBays(allBays, LOCS);
    for (const b of allBays) {
      b.box = new T.Box3(new T.Vector3(b.x0, 0, b.y0), new T.Vector3(b.x1, b.h, b.y1));
      bays.push(b);
      drawBay(b);
      const tag = label(b.where || b.id, { size: 0.3, bg: 'rgba(255,210,0,.97)', fg: '#14171f', weight: 800 });
      tag.position.copy(V((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.h + 0.24));
      groups.names.add(tag);
    }
    // row signs: over the end of the row that meets the middle aisle, or over the middle for the rest
    const rows = {};
    for (const b of bays) {
      const r = rows[b.row] || (rows[b.row] = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9, h: 0, along: b.along, n: 0 });
      r.x0 = Math.min(r.x0, b.x0); r.y0 = Math.min(r.y0, b.y0); r.x1 = Math.max(r.x1, b.x1); r.y1 = Math.max(r.y1, b.y1); r.h = Math.max(r.h, b.h); r.n++;
    }
    const AISLE_X0 = 10.3, AISLE_X1 = 11.95;
    const rowSigns = []; // the middle aisle between the left and right blocks
    for (const [row, r] of Object.entries(rows)) {
      const cy = (r.y0 + r.y1) / 2;
      let x = (r.x0 + r.x1) / 2, y = cy, z = r.h + 0.75;
      if (r.along === 'x' && r.n > 2 && r.x1 <= AISLE_X0 + 0.2) { x = r.x1 + 0.3; z = 3.9; }
      else if (r.along === 'x' && r.n > 2 && r.x0 >= AISLE_X1 - 0.2) { x = r.x0 - 0.3; z = 3.9; }
      const sprite = putLabel('signs', row, x, y, z, { size: 0.7, weight: 800 });
      rowSigns.push({ sprite, z, scale: sprite.scale.clone() });
    }

    /* ---------- everything else: counters, shop shelving, furniture ---------- */
    const BLOCKS = { counter: 1, cupboard: 1, cage: 1, panel: 1, gondola: 1, table: 1, worktop: 1, desk: 1, wc: 1 };
    function gondola(o) {
      const ax = o.along === 'x', h = o.z1 || 1.8;
      const u0 = ax ? o.x0 : o.y0, u1 = ax ? o.x1 : o.y1, v0 = ax ? o.y0 : o.x0, v1 = ax ? o.y1 : o.x1;
      const put = (mat, ua, va, za, ub, vb, zb) => (ax ? box(mat, ua, va, za, ub, vb, zb) : box(mat, va, ua, za, vb, ub, zb));
      const both = o.open.length > 1;
      // the open side faces +v for S / E, -v for N / W
      const toPlus = o.open === 'S' || o.open === 'E';
      const back = both ? [(v0 + v1) / 2 - 0.02, (v0 + v1) / 2 + 0.02] : toPlus ? [v0, v0 + 0.04] : [v1 - 0.04, v1];
      put(M.gondola, u0, back[0], 0, u1, back[1], h);
      put(M.plinth, u0, v0, 0, u1, v1, 0.1);
      const edges = o.edges || [u0, u1];
      for (const e of edges) put(M.gondola, e - 0.02, v0, 0, e + 0.02, v1, h);
      for (let k = 1; k <= 4; k++) {
        const z = 0.1 + k * (h - 0.25) / 4;
        if (z > h - 0.1) break;
        if (both) { put(M.gshelf, u0, v0, z - 0.02, u1, back[0], z); put(M.gshelf, u0, back[1], z - 0.02, u1, v1, z); }
        else if (toPlus) put(M.gshelf, u0, back[1], z - 0.02, u1, v1, z);
        else put(M.gshelf, u0, v0, z - 0.02, u1, back[0], z);
      }
    }
    function legs(mat, o, top, t) {
      for (const [x, y] of [[o.x0, o.y0], [o.x1 - t, o.y0], [o.x0, o.y1 - t], [o.x1 - t, o.y1 - t]]) box(mat, x, y, 0, x + t, y + t, top);
    }
    function chair(o) {
      box(M.seat, o.x0, o.y0, 0.42, o.x1, o.y1, 0.47);
      legs(M.frame, o, 0.42, 0.03);
      const f = o.face || 'N';
      if (f === 'W') box(M.seat, o.x1 - 0.05, o.y0, 0.47, o.x1, o.y1, 0.9);
      if (f === 'E') box(M.seat, o.x0, o.y0, 0.47, o.x0 + 0.05, o.y1, 0.9);
      if (f === 'N') box(M.seat, o.x0, o.y1 - 0.05, 0.47, o.x1, o.y1, 0.9);
      if (f === 'S') box(M.seat, o.x0, o.y0, 0.47, o.x1, o.y0 + 0.05, 0.9);
    }
    for (const o of L.objects) {
      const z1 = o.z1 || 1;
      switch (o.kind) {
        case 'heater': box(M.heater, o.x0, o.y0, o.z0, o.x1, o.y1, o.z1, 'walk'); break; // above the 3.2 m cut, so Walk only
        case 'counter':
          box(M.counter, o.x0, o.y0, 0, o.x1, o.y1 - 0.03, 0.95);
          box(M.counterTop, o.x0, o.y0, 0.95, o.x1, o.y1 + 0.03, 1.0);
          break;
        case 'till':
          box(M.till, o.x0, o.y0, 1.0, o.x1, o.y1 - 0.12, 1.06);
          bar(M.till, [(o.x0 + o.x1) / 2, o.y1 - 0.05, 1.04], [(o.x0 + o.x1) / 2, o.y1 - 0.02, 1.32], 0.3);
          break;
        case 'cupboard': box(M.grey, o.x0, o.y0, 0, o.x1, o.y1, z1); break;
        case 'cage':
          texturedBox(M.cage, o.x0, o.y0, 0, o.x1, o.y1, z1, 0.2);
          for (const [x, y] of [[o.x0, o.y0], [o.x1, o.y0], [o.x0, o.y1], [o.x1, o.y1]]) box(M.frame, x - 0.015, y - 0.015, 0, x + 0.015, y + 0.015, z1);
          break;
        case 'panel': box(M.grey, o.x0, o.y0, 0, o.x1, o.y1, z1); break;
        case 'gondola': gondola(o); break;
        case 'table': case 'desk':
          box(M.wood, o.x0, o.y0, z1 - 0.04, o.x1, o.y1, z1);
          legs(M.frame, o, z1 - 0.04, 0.05);
          break;
        case 'chair': chair(o); break;
        case 'worktop':
          box(M.white, o.x0, o.y0, 0, o.x1, o.y1 - 0.02, z1 - 0.04);
          box(M.wood, o.x0, o.y0, z1 - 0.04, o.x1, o.y1, z1);
          break;
        case 'sink': box(M.steel, o.x0, o.y0, 0.9, o.x1, o.y1, 0.915); break;
        case 'wc': {
          const f = o.face || 'N';
          const cis = f === 'E' ? [o.x0, o.y0, o.x0 + 0.18, o.y1] : f === 'W' ? [o.x1 - 0.18, o.y0, o.x1, o.y1] : f === 'N' ? [o.x0, o.y1 - 0.18, o.x1, o.y1] : [o.x0, o.y0, o.x1, o.y0 + 0.18];
          box(M.white, o.x0 + 0.03, o.y0 + 0.03, 0, o.x1 - 0.03, o.y1 - 0.03, 0.42);
          box(M.white, cis[0], cis[1], 0.42, cis[2], cis[3], 0.8);
          break;
        }
        case 'basin': box(M.white, o.x0, o.y0, 0.72, o.x1, o.y1, 0.86); break;
        default: box(M.grey, o.x0, o.y0, o.z0 || 0, o.x1, o.y1, z1);
      }
    }

    /* ---------- roof and lights (Walk only) ---------- */
    plane(M.roof, -WT, -WT, W + WT, D + WT, H, 'walk', true);
    const LAMP_Z = 4.4;
    function lampAt(x, y, alongX) {
      if (alongX) { box(M.lampBox, x - 0.75, y - 0.08, LAMP_Z, x + 0.75, y + 0.08, LAMP_Z + 0.07, 'walk'); box(M.lamp, x - 0.72, y - 0.06, LAMP_Z - 0.012, x + 0.72, y + 0.06, LAMP_Z, 'walk'); }
      else { box(M.lampBox, x - 0.08, y - 0.75, LAMP_Z, x + 0.08, y + 0.75, LAMP_Z + 0.07, 'walk'); box(M.lamp, x - 0.06, y - 0.72, LAMP_Z - 0.012, x + 0.06, y + 0.72, LAMP_Z, 'walk'); }
    }
    for (const l of L.lights || []) {
      if (l.y0 !== undefined) { for (let y = l.y0; y <= l.y1 + 0.01; y += 3) lampAt(l.x0, y, false); }
      else { const n = Math.max(1, Math.round((l.x1 - l.x0) / 3)); for (let i = 0; i <= n; i++) lampAt(l.x0 + (l.x1 - l.x0) * i / n, l.y, true); }
    }
    flush();

    /* ---------- light ---------- */
    scene.add(new T.HemisphereLight(0xffffff, 0x8a8f96, 1.9));
    const sun = new T.DirectionalLight(0xffffff, 1.9);
    sun.position.set(W / 2 - 6, 34, D / 2 + 9);
    sun.target.position.set(W / 2, 0, D / 2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 2, far: 70 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);

    /* ---------- where you can walk ---------- */
    const obstacles = [];
    for (const w of L.walls) obstacles.push({ x0: w[0], y0: w[1], x1: w[2], y1: w[3] });
    for (const c of L.columns || []) obstacles.push({ x0: c[0], y0: c[1], x1: c[2], y1: c[3] });
    for (const b of bays) obstacles.push(b);
    for (const o of L.objects) if (BLOCKS[o.kind]) obstacles.push(o);
    const BODY = 0.2;
    function blocked(x, y) {
      if (x < BODY || x > W - BODY || y < BODY || y > D - BODY) return true;
      for (const o of obstacles) if (x > o.x0 - BODY && x < o.x1 + BODY && y > o.y0 - BODY && y < o.y1 + BODY) return true;
      return false;
    }
    function nearestFree(x, y) {
      if (!blocked(x, y)) return [x, y];
      for (let r = 0.1; r < 4; r += 0.1) for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (!blocked(px, py)) return [px, py];
      }
      return [L.start.x, L.start.y];
    }

    /* ---------- cameras ---------- */
    const view = { w: 1, h: 1 };
    const persp = new T.PerspectiveCamera(45, 1, 0.1, 500);
    const ortho = new T.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
    const eye = new T.PerspectiveCamera(70, 1, 0.05, 200);
    eye.rotation.order = 'YXZ';
    const FACING = { N: 0, S: Math.PI, E: -Math.PI / 2, W: Math.PI / 2 };
    const orbit = { tx: W / 2, ty: D / 2, r: 40, theta: 0.42, phi: 0.92 };
    const top = { cx: W / 2, cy: D / 2, ppm: 20 };
    const walk = { x: L.start.x, y: L.start.y, yaw: FACING[L.start.facing] || 0, pitch: -0.06, fwd: 0, side: 0, turn: 0, run: false };
    let mode = 'orbit';
    const cam = () => (mode === 'orbit' ? persp : mode === 'plan' ? ortho : eye);
    const BAR_PX = 70; // the view buttons cover the bottom of the screen

    function applyOrbit() {
      orbit.phi = Math.min(1.53, Math.max(0.12, orbit.phi));
      orbit.r = Math.min(160, Math.max(3, orbit.r));
      orbit.tx = Math.min(W + 6, Math.max(-6, orbit.tx)); orbit.ty = Math.min(D + 6, Math.max(-6, orbit.ty));
      const c = Math.cos(orbit.phi);
      persp.position.set(orbit.tx + orbit.r * Math.sin(orbit.theta) * c, orbit.r * Math.sin(orbit.phi), orbit.ty + orbit.r * Math.cos(orbit.theta) * c);
      persp.lookAt(orbit.tx, 0.6, orbit.ty);
    }
    function fitOrbit() {
      const R = Math.hypot(W / 2, D / 2) + 1;
      const vf = T.MathUtils.degToRad(persp.fov) / 2, hf = Math.atan(Math.tan(vf) * persp.aspect);
      orbit.r = (R / Math.sin(Math.min(vf, hf))) * 0.84;
      orbit.tx = W / 2; orbit.ty = D / 2 + 2; orbit.theta = 0.42; orbit.phi = 0.92;
    }
    function applyTop() {
      top.ppm = Math.min(400, Math.max(4, top.ppm));
      top.cx = Math.min(W + 6, Math.max(-6, top.cx)); top.cy = Math.min(D + 6, Math.max(-6, top.cy));
      const hw = view.w / 2 / top.ppm, hh = view.h / 2 / top.ppm;
      Object.assign(ortho, { left: -hw, right: hw, top: hh, bottom: -hh });
      ortho.updateProjectionMatrix();
      ortho.position.set(top.cx, 60, top.cy);
      ortho.up.set(0, 0, -1); // back wall at the top of the screen, like the drawings
      ortho.lookAt(top.cx, 0, top.cy);
    }
    function fitTop() {
      top.ppm = Math.min(view.w / (W + 1.4), (view.h - BAR_PX) / (D + 1.4));
      top.cx = W / 2; top.cy = D / 2 + BAR_PX / 2 / top.ppm;
    }
    function applyWalk() {
      walk.pitch = Math.min(1.35, Math.max(-1.35, walk.pitch));
      eye.position.set(walk.x, 1.62, walk.y);
      eye.rotation.set(walk.pitch, walk.yaw, 0);
    }
    function resize() {
      const r = stage.getBoundingClientRect();
      const first = view.w === 1;
      view.w = Math.max(1, Math.round(r.width)); view.h = Math.max(1, Math.round(r.height));
      renderer.setSize(view.w, view.h, false);
      persp.aspect = eye.aspect = view.w / view.h;
      // phones held upright get a wider view when walking
      eye.fov = Math.min(95, Math.max(60, T.MathUtils.radToDeg(2 * Math.atan(Math.tan(T.MathUtils.degToRad(37.5)) / eye.aspect))));
      persp.updateProjectionMatrix(); eye.updateProjectionMatrix();
      if (first) { fitOrbit(); fitTop(); }
      applyOrbit(); applyTop(); applyWalk();
      if (!mini.hidden) sizeMini();
      redraw();
    }

    /* ---------- picking a bay ---------- */
    const ray = new T.Raycaster(), ndc = new T.Vector2(), hitAt = new T.Vector3();
    const hl = new T.Mesh(unitBox, new T.MeshBasicMaterial({ color: 0xffd200, transparent: true, opacity: 0.32, depthWrite: false }));
    hl.add(new T.LineSegments(new T.EdgesGeometry(unitBox), new T.LineBasicMaterial({ color: 0xff9f00 })));
    hl.visible = false; hl.renderOrder = 4; scene.add(hl);
    let selected = null, shown = null; // shown: what the card is about (a bay, a drawer, a product or a free spot)
    let openIndex = -1, pin = null, pinAt = null; // the pulled-out drawer; the pin over what you're looking for
    const bayInfo = new Map(); // bay -> {items, free, shelves} once stock is loaded
    function bayAt(clientX, clientY, centre) {
      const r = canvas.getBoundingClientRect();
      if (centre) ndc.set(0, 0); else ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, cam());
      let best = null, bestD = Infinity;
      for (const b of bays) {
        if (ray.ray.intersectBox(b.box, hitAt)) { const d = hitAt.distanceToSquared(ray.ray.origin); if (d < bestD) { bestD = d; best = b; } }
      }
      return best;
    }

    const card = $('card');
    new MutationObserver(() => stage.classList.toggle('carded', !card.hidden)).observe(card, { attributes: true, attributeFilter: ['hidden'] });
    const FACES = { N: 'Faces the back wall', S: 'Faces the shop front', NS: 'Open on both sides', EW: 'Open on both sides', E: 'Faces the right-hand wall', W: 'Faces the left-hand wall' };
    const m2 = (n) => (Math.round(n * 100) / 100).toFixed(2) + ' m';
    function what(b) {
      if (b.kind === 'cage') return 'Mesh cage';
      if (b.kind === 'cabinet') return 'Flammables cabinet';
      if (b.kind === 'pallet') return 'Pallet racking, ' + (Math.max(2, b.levels) - 1) + ' beam levels';
      if (b.kind === 'bulk') return 'Floor space with one shelf on top';
      if (b.kind === 'floor') return 'Floor space, no racking';
      return 'Shelving, ' + b.levels + ' shelves';
    }
    function showBay(b) {
      if (openIndex >= 0) closeDrawer(true);
      clearPin(); showShelfTags(b);
      selected = b; shown = { kind: 'bay', ref: b };
      const w = b.x1 - b.x0, d = b.y1 - b.y0;
      hl.position.set((b.x0 + b.x1) / 2, b.h / 2, (b.y0 + b.y1) / 2);
      hl.scale.set(w + 0.05, b.h + 0.05, d + 0.05);
      hl.visible = true;
      hl.material.opacity = mode === 'walk' ? 0.12 : 0.32;
      $('cardTitle').textContent = b.where || (b.holding ? 'Holding area' : b.id);
      $('cardSub').textContent = what(b) + (FACES[b.open] ? ', ' + FACES[b.open].toLowerCase() : '');
      const wide = b.along === 'x' ? w : d, deep = b.along === 'x' ? d : w, lines = [];
      const info = stock && b.codes ? bayInfo.get(b) || { items: 0, free: 0, shelves: 0 } : null;
      if (info) lines.push(nf(info.items) + ' products nailed here, ' + nf(info.free) + ' free position' + (info.free === 1 ? '' : 's') + (info.shelves ? ' and ' + info.shelves + (info.shelves > 1 ? ' empty shelves' : ' empty shelf') : ''));
      if (b.unsure) lines.push({ text: 'Location to be confirmed', more: true });
      if (b.note) lines.push({ text: b.note, more: true });
      lines.push({ text: m2(wide) + ' wide, ' + m2(deep) + ' deep, about ' + m2(b.h) + ' high', more: true });
      cardLines(lines);
      cardPhoto(null);
      $('cardNote').textContent = b.where || b.holding ? '' : 'No stock location here yet: tell Claude what is in it and it will go on the plan.';
      const btns = [[mode === 'walk' ? 'Stand in front of it' : 'Walk here', () => walkTo(b)]];
      if (info && info.items) btns.push(["What's here", () => setSheet(true, 'find', b.codes.join(', ')), true]);
      if (info && (info.free || info.shelves)) btns.push(['Free spots', () => { setFree(true); setSheet(true, 'free', b.codes.join(', ')); }, true, true]);
      cardButtons(btns);
      card.hidden = false;
      redraw();
    }
    function closeCard() { selected = null; shown = null; hl.visible = false; card.hidden = true; if (openIndex >= 0) closeDrawer(); clearPin(); clearShelfTags(); redraw(); }
    $('cardClose').addEventListener('click', closeCard);
    function showHelp() {
      if (openIndex >= 0) closeDrawer(true);
      clearPin(); clearShelfTags();
      selected = null; shown = null; hl.visible = false;
      $('cardTitle').textContent = 'How to use it';
      $('cardSub').textContent = 'Dunstable, from the fire plan and electrical layout';
      const touch = matchMedia('(any-pointer: coarse)').matches, tap = touch ? 'Tap' : 'Click';
      const items = (touch ? [
        '3D: drag to turn, pinch to zoom, two fingers to move.',
        'Top: drag to move, pinch to zoom.',
        'Walk: the stick walks, drag anywhere else to look round. Tap the little map to jump there.',
      ] : [
        '3D: drag to turn, scroll to zoom, right-drag (or Shift + drag) to move.',
        'Top: drag to move, scroll to zoom.',
        'Walk: WASD or the arrow keys walk, hold Shift to go faster. With Mouse look on, click once and move the mouse to look round (Esc lets go). Click the little map to jump there.',
      ]).concat([
        tap + ' a bay for its locations, a box for its product, or a drawer to pull it out and see what is in it.',
        'Stock: upload or paste the SKU List report, then find a product by code, name or location and go straight to it.',
        'Shelf labels are red for odd bay numbers and blue for even; drawer labels list their positions with the back one on top. Free spots (green): locations with nothing nailed to them. The Stock panel lists them by area, and has a switch to show sharps and liquids in red.',
        'A card shows the main things first: More shows the rest.',
        'Photos on the boxes near you are the Toolbox\'s own saved copies (the Product Search ones), loaded a few at a time.',
      ]);
      if (!touch) items.push('Keys: / opens the search, Esc closes a card.');
      cardLines(items);
      cardPhoto(null);
      $('cardNote').textContent = 'Sizes come from the plans, so expect them to be out by up to about 30 cm. Heights and shelf counts are typical ones until the real ones are measured.';
      cardButtons([], true);
      card.hidden = false; redraw();
    }
    $('helpBtn').addEventListener('click', () => (card.hidden || selected ? showHelp() : closeCard()));

    function walkTo(b) {
      // stand in the aisle in front of the bay, a step or two along towards the middle aisle, looking at it
      const cab = b.kind === 'cabinet', flat = b.kind === 'floor'; // straight in front of a cabinet (its open doors) or a floor spot, not off to one side
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, gap = cab ? 1.15 : flat ? 1.3 : 0.45, along = cab || flat ? 0 : 1.4;
      const o = b.open || 'S';
      let x = cx, y = cy;
      if (o.indexOf('S') >= 0) y = b.y1 + gap;
      else if (o.indexOf('N') >= 0) y = b.y0 - gap;
      else if (o.indexOf('E') >= 0) x = b.x1 + gap;
      else if (o.indexOf('W') >= 0) x = b.x0 - gap;
      if (b.along === 'x') x += cx > (AISLE_X0 + AISLE_X1) / 2 ? -along : along;
      else y -= along;
      [walk.x, walk.y] = nearestFree(x, y);
      walk.yaw = Math.atan2(-(cx - walk.x), -(cy - walk.y));
      walk.pitch = cab ? Math.atan2(b.h / 2 - 1.62, Math.hypot(cx - walk.x, cy - walk.y) || 1) : -0.08;
      setMode('walk');
      showBay(b);
    }

    /* ---------- touch, mouse and keys ---------- */
    const ptrs = new Map();
    let tapId = null, pinch = null;
    function pinchState() {
      const [a, b] = [...ptrs.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    function zoomTopAt(px, py, f) {
      const r = canvas.getBoundingClientRect(), sx = px - r.left - view.w / 2, sy = py - r.top - view.h / 2;
      const wx = top.cx + sx / top.ppm, wy = top.cy + sy / top.ppm;
      top.ppm *= f; top.ppm = Math.min(400, Math.max(4, top.ppm));
      top.cx = wx - sx / top.ppm; top.cy = wy - sy / top.ppm;
      applyTop();
    }
    function panOrbit(dx, dy) {
      const k = (2 * orbit.r * Math.tan(T.MathUtils.degToRad(persp.fov / 2))) / view.h;
      const s = Math.sin(orbit.theta), c = Math.cos(orbit.theta), lift = 1 / Math.max(0.35, Math.sin(orbit.phi));
      orbit.tx += (-dx * c - dy * s * lift) * k;
      orbit.ty += (dx * s - dy * c * lift) * k;
      applyOrbit();
    }
    function drag(dx, dy, p) {
      if (mode === 'orbit') {
        if (p.button === 2 || p.shift) panOrbit(dx, dy);
        else { orbit.theta -= dx * 0.0085; orbit.phi += dy * 0.006; applyOrbit(); }
      } else if (mode === 'plan') {
        top.cx -= dx / top.ppm; top.cy -= dy / top.ppm; applyTop();
      } else {
        walk.yaw += dx * 0.0055; walk.pitch += dy * 0.0055; applyWalk();
      }
      redraw();
    }
    canvas.addEventListener('pointerdown', (e) => {
      // mouse look, like a game: the first click captures the mouse, after that a click picks what's under the crosshair
      if (mode === 'walk' && mouseLook && hasMouse && e.pointerType === 'mouse') {
        if (!locked()) lockMouse(); else if (e.button === 0) tapAt(0, 0, true);
        e.preventDefault(); return;
      }
      try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), button: e.button, shift: e.shiftKey });
      tapId = ptrs.size === 1 ? e.pointerId : null;
      pinch = ptrs.size === 2 ? pinchState() : null;
      if (mode === 'walk') canvas.focus({ preventScroll: true });
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (tapId === e.pointerId && Math.hypot(p.x - p.sx, p.y - p.sy) > 8) tapId = null;
      if (ptrs.size === 1) { if (tapId === null) drag(dx, dy, p); return; }
      if (ptrs.size === 2 && pinch) {
        const now = pinchState(), f = now.d / pinch.d, mx = now.x - pinch.x, my = now.y - pinch.y;
        if (mode === 'orbit') { orbit.r /= f; applyOrbit(); panOrbit(mx, my); }
        else if (mode === 'plan') { zoomTopAt(now.x, now.y, f); top.cx -= mx / top.ppm; top.cy -= my / top.ppm; applyTop(); }
        else { walk.yaw += mx * 0.0055; applyWalk(); }
        pinch = now; redraw();
      }
    });
    function pointerEnd(e) {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      ptrs.delete(e.pointerId);
      if (e.type === 'pointerup' && tapId === e.pointerId && performance.now() - p.t < 600) {
        tapAt(e.clientX, e.clientY);
      }
      tapId = null;
      pinch = ptrs.size === 2 ? pinchState() : null;
    }
    canvas.addEventListener('pointerup', pointerEnd);
    canvas.addEventListener('pointercancel', pointerEnd);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
      if (mode === 'orbit') { orbit.r /= f; applyOrbit(); }
      else if (mode === 'plan') zoomTopAt(e.clientX, e.clientY, f);
      else { eye.fov = Math.min(95, Math.max(35, eye.fov / f)); eye.updateProjectionMatrix(); }
      redraw();
    }, { passive: false });

    const keys = new Set();
    const KEYMAP = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', KeyD: 'r', ArrowLeft: 'tl', ArrowRight: 'tr', KeyQ: 'tl', KeyE: 'tr' };
    window.addEventListener('keydown', (e) => {
      const typing = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.key === 'Escape' && !locked()) {
        if (!sheet.hidden) { setSheet(false); e.preventDefault(); return; }
        if (!card.hidden) { closeCard(); e.preventDefault(); return; }
      }
      if (typing || e.altKey || e.ctrlKey || e.metaKey) return; // typing in the stock box
      if (e.key === '/' && sidx) { e.preventDefault(); setSheet(true, stock ? 'find' : undefined); return; }
      if (mode !== 'walk') return;
      if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); e.preventDefault(); wake(); }
      walk.run = e.shiftKey;
    });
    window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]); walk.run = e.shiftKey; });
    window.addEventListener('blur', () => keys.clear());

    // the walking stick (phones)
    const stick = $('stick'), knob = $('knob');
    let stickId = null;
    function stickMove(e) {
      const r = stick.getBoundingClientRect(), R = r.width / 2;
      let dx = (e.clientX - (r.left + R)) / R, dy = (e.clientY - (r.top + R)) / R;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      knob.style.transform = 'translate(' + (dx * R * 0.62) + 'px,' + (dy * R * 0.62) + 'px)';
      walk.fwd = -dy; walk.side = dx;
      wake();
    }
    stick.addEventListener('pointerdown', (e) => { stickId = e.pointerId; try { stick.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } stickMove(e); e.preventDefault(); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) stickMove(e); });
    const stickEnd = (e) => { if (e.pointerId !== stickId) return; stickId = null; walk.fwd = walk.side = 0; knob.style.transform = ''; };
    stick.addEventListener('pointerup', stickEnd);
    stick.addEventListener('pointercancel', stickEnd);

    function stepWalk(dt) {
      let f = walk.fwd, s = walk.side, turn = 0;
      if (keys.has('f')) f += 1;
      if (keys.has('b')) f -= 1;
      if (keys.has('l')) s -= 1;
      if (keys.has('r')) s += 1;
      if (keys.has('tl')) turn += 1;
      if (keys.has('tr')) turn -= 1;
      if (!f && !s && !turn) return false;
      walk.yaw += turn * 1.9 * dt;
      const len = Math.hypot(f, s);
      if (len > 1) { f /= len; s /= len; }
      const speed = (walk.run ? 3.2 : 1.6) * dt;
      const sy = Math.sin(walk.yaw), cy = Math.cos(walk.yaw);
      const nx = walk.x + (-sy * f + cy * s) * speed, ny = walk.y + (-cy * f - sy * s) * speed;
      if (!blocked(nx, walk.y)) walk.x = nx;
      if (!blocked(walk.x, ny)) walk.y = ny;
      applyWalk();
      return true;
    }

    /* ---------- the little map (Walk) ---------- */
    const mini = $('mini');
    const mctx = mini.getContext('2d');
    let mScale = 6, mPad = 6, mBase = null;
    function sizeMini() {
      const cssW = Math.min(150, Math.max(110, view.w * 0.3));
      mScale = (cssW - mPad * 2) / W;
      const cssH = D * mScale + mPad * 2;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      mini.style.width = cssW + 'px'; mini.style.height = cssH + 'px';
      mini.width = Math.round(cssW * dpr); mini.height = Math.round(cssH * dpr);
      mBase = document.createElement('canvas'); mBase.width = mini.width; mBase.height = mini.height;
      const g = mBase.getContext('2d');
      g.scale(dpr, dpr);
      const R = (o, fill) => { g.fillStyle = fill; g.fillRect(mPad + o.x0 * mScale, mPad + o.y0 * mScale, (o.x1 - o.x0) * mScale, (o.y1 - o.y0) * mScale); };
      R({ x0: 0, y0: 0, x1: W, y1: D }, '#c4c8cd');
      for (const r of L.rooms) R(r, r.floor === 'tile' ? '#e4e7ea' : '#d5cdc2');
      for (const o of L.objects) if (BLOCKS[o.kind]) R(o, o.kind === 'counter' ? '#15396b' : '#8f97a1');
      for (const b of bays) R(b, b.kind === 'cabinet' ? '#f2c400' : b.kind === 'cage' ? '#7d858f' : b.kind === 'floor' ? '#d9b300' : b.kind === 'pallet' ? '#e07020' : '#2d5ea8');
      for (const w of L.walls) R({ x0: w[0], y0: w[1], x1: w[2], y1: w[3] }, '#2b3038');
      for (const c of L.columns || []) R({ x0: c[0], y0: c[1], x1: c[2], y1: c[3] }, '#2b3038');
      g.strokeStyle = '#2b3038'; g.lineWidth = 2; g.strokeRect(mPad - 1, mPad - 1, W * mScale + 2, D * mScale + 2);
    }
    function drawMini() {
      if (mini.hidden || !mBase) return;
      const dpr = mini.width / parseFloat(mini.style.width);
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.clearRect(0, 0, mini.width, mini.height);
      mctx.drawImage(mBase, 0, 0);
      mctx.scale(dpr, dpr);
      if (pinAt) { // what you're looking for
        const qx = mPad + pinAt.x * mScale, qy = mPad + pinAt.y * mScale;
        mctx.fillStyle = pinAt.green ? '#1f8a46' : '#ffb000'; mctx.strokeStyle = '#14171f'; mctx.lineWidth = 1.2;
        mctx.beginPath(); mctx.moveTo(qx, qy); mctx.lineTo(qx - 5, qy - 9); mctx.lineTo(qx + 5, qy - 9); mctx.closePath(); mctx.fill(); mctx.stroke();
      }
      const px = mPad + walk.x * mScale, py = mPad + walk.y * mScale;
      const a = Math.atan2(-Math.cos(walk.yaw), -Math.sin(walk.yaw)); // screen angle of where you're looking
      mctx.fillStyle = 'rgba(255,210,0,.45)';
      mctx.beginPath(); mctx.moveTo(px, py); mctx.arc(px, py, 22, a - 0.6, a + 0.6); mctx.closePath(); mctx.fill();
      mctx.fillStyle = '#e53935'; mctx.strokeStyle = '#fff'; mctx.lineWidth = 1.5;
      mctx.beginPath(); mctx.arc(px, py, 4.5, 0, Math.PI * 2); mctx.fill(); mctx.stroke();
    }
    mini.addEventListener('pointerdown', (e) => {
      const r = mini.getBoundingClientRect();
      const x = (e.clientX - r.left - mPad) / mScale, y = (e.clientY - r.top - mPad) / mScale;
      [walk.x, walk.y] = nearestFree(Math.min(W, Math.max(0, x)), Math.min(D, Math.max(0, y)));
      applyWalk(); redraw();
      e.preventDefault();
    });

    /* ---------- stock on the shelves ---------- */
    const FS = window.FloorStock, pad2 = FS.pad2;
    const sidx = LOCS ? FS.index(allBays, LOCS) : null;
    const BOARD = new T.Color(0xb98a58), BOARD_EMPTY = new T.Color(0xe4d6bb), FREE_ALL = new T.Color(0x34b85a), FREE_SOME = new T.Color(0xa3d683);
    const boardMat = new T.MeshLambertMaterial({ color: 0xffffff });
    const trayMat = new T.MeshLambertMaterial({ color: 0xcaa06a });
    const freeMat = new T.MeshBasicMaterial({ color: 0x2ccf5a, transparent: true, opacity: 0.5, depthWrite: false });
    const HIDE = new T.Matrix4().makeScale(1e-6, 1e-6, 1e-6);
    const FRONT = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] }; // which way a face looks (plan x, plan y)
    const boxM = (r, z0, h, sw, sd) => new T.Matrix4().compose(
      new T.Vector3((r.x0 + r.x1) / 2, z0 + h / 2, (r.y0 + r.y1) / 2), new T.Quaternion(),
      new T.Vector3((r.x1 - r.x0) * sw, h, (r.y1 - r.y0) * sd));
    const areaColour = (a) => { let h = 0; for (const ch of a) h = (h * 31 + ch.charCodeAt(0)) % 360; return new T.Color().setHSL((175 + (h % 360) * 160 / 360) / 360, 0.5, h % 2 ? 0.62 : 0.72); }; // blues to pinks: never green (free spots) or red (sharps and liquids)
    // pull a cell in from the uprights at the ends of its bay slice (they're 6 cm square), so boxes never poke into the frame
    const fit = (seg, r) => {
      const ax = seg.along === 'x', W = seg.u1 - seg.u0, k = Math.max(0.5, (W - 0.07) / W), mid = (seg.u0 + seg.u1) / 2;
      const f = (a, b) => [mid + (a - mid) * k, mid + (b - mid) * k];
      if (ax) { const [x0, x1] = f(r.x0, r.x1); return { x0, x1, y0: r.y0, y1: r.y1 }; }
      const [y0, y1] = f(r.y0, r.y1); return { x0: r.x0, x1: r.x1, y0, y1 };
    };
    const nf = (n) => n.toLocaleString('en-GB');
    const side = (j, deep) => (j === 0 ? 'front' : j === deep - 1 ? 'back' : 'middle');

    // the drawers: shelves 1 to 10 of the AA_ areas, there whether or not any stock has been loaded
    let drawerList = [], drawerMesh = null;
    const drawerAt = new Map();
    if (sidx) {
      drawerList = FS.drawers(sidx);
      if (drawerList.length) {
        drawerMesh = new T.InstancedMesh(unitBox, boardMat, drawerList.length);
        drawerList.forEach((d, i) => {
          d.rect = fit(d.seg, FS.cellRect(d.seg, d.box, d.boxes, 0, 1));
          d.z0 = FS.shelfZ(d.seg.bay, d.shelf) + 0.012;
          d.h = (d.seg.bay.pitch || 0.153) * 0.88;
          d.matrix = boxM(d.rect, d.z0, d.h, 0.99, 0.94);
          drawerMesh.setMatrixAt(i, d.matrix); drawerMesh.setColorAt(i, BOARD);
          drawerAt.set(d.key, i);
        });
        drawerMesh.instanceMatrix.needsUpdate = true; drawerMesh.instanceColor.needsUpdate = true;
        drawerMesh.castShadow = true; drawerMesh.receiveShadow = true; drawerMesh.frustumCulled = false;
        groups.main.add(drawerMesh);
      }
    }
    const trayLoc = (d, j) => d.seg.area + '-' + pad2(d.seg.no || 0) + '-' + pad2(d.shelf) + '-' + pad2(d.box * d.deep + j + 1);
    const drawerOfPos = (seg, shelf, pos) => drawerAt.get(FS.drawerKey(seg.area, seg.no, shelf, Math.floor((pos - 1) / FS.drawerShape(sidx, seg).deep)));

    // the list: items on ordinary shelves become boxes; items in drawers are in the drawer
    // Sharps and liquids in red: a switch in the Stock panel, off to start with (detailedfoil, 30 Oct 2026). The flag
    // (8, "Sharp or liquid") comes from Product Search's own list of the store's products, fetched only once it's on.
    const RED = new T.Color(0xd8323a), flagOf = new Map();
    let redOn = false, flagsAsked = false;
    try { redOn = localStorage.getItem('fp-red-v1') === '1'; } catch (e) { /* private mode */ }
    const isRed = (it) => ((flagOf.get(it.code) || 0) & 8) !== 0;
    const colourFor = (it) => (redOn && isRed(it) ? RED : areaColour(it.pl.area).offsetHSL(0, 0, it.pl.pos % 2 ? -0.035 : 0.035));
    function recolour() {
      if (productMesh) { products.forEach((it, i) => productMesh.setColorAt(i, colourFor(it))); productMesh.instanceColor.needsUpdate = true; }
      if (tray) tray.traverse((o) => { if (o.userData.item) o.material.color.copy(colourFor(o.userData.item)); });
      redraw();
    }
    function loadFlags() {
      if (flagsAsked) return;
      flagsAsked = true;
      fetch('product-search/data/products.json').then((r) => r.json()).then((j) => {
        for (const x of j.items) flagOf.set(x[0], x[2] || 0);
        recolour(); if (shown && shown.kind === 'product') refreshCard();
      }).catch(() => { flagsAsked = false; });
    }
    function setRed(on) {
      redOn = !!on; $('redShow').checked = redOn;
      try { localStorage.setItem('fp-red-v1', redOn ? '1' : '0'); } catch (e) { /* private mode */ }
      if (redOn) loadFlags();
      recolour();
    }
    $('redShow').checked = redOn;
    $('redShow').addEventListener('change', (e) => setRed(e.target.checked));
    if (redOn) loadFlags();
    let stock = null, products = [], productMesh = null, byLoc = [];
    const itemAt = new Map(), productOf = new Map();
    function clearProducts() {
      if (productMesh) { groups.main.remove(productMesh); productMesh.dispose(); productMesh = null; }
      products = []; productOf.clear(); itemAt.clear(); byLoc = []; bayInfo.clear();
      clearPhotoPlanes();
      free = null; buildFree();
      colourDrawers();
    }
    function applyStock(items) {
      if (!sidx) return null;
      closeCard(); clearProducts();
      const arr = FS.arrange(items, sidx);
      for (const it of arr.placed) {
        const pl = it.pl;
        itemAt.set(it.loc, it);
        if (pl.drawer) it.drawerKey = FS.drawerKey(pl.area, pl.seg.no, pl.shelf, pl.drawer.box); else products.push(it);
        const o = bayInfo.get(pl.seg.bay) || { items: 0, free: 0, shelves: 0 };
        o.items++; bayInfo.set(pl.seg.bay, o);
      }
      if (products.length) {
        productMesh = new T.InstancedMesh(unitBox, boardMat, products.length);
        products.forEach((it, i) => {
          const pl = it.pl, bay = pl.seg.bay;
          it.rect = fit(pl.seg, FS.cellRect(pl.seg, pl.slot, pl.slots, 0, 1));
          it.z0 = FS.shelfZ(bay, pl.shelf) + 0.012;
          it.h = Math.max(0.05, FS.shelfGap(bay, pl.shelf) - 0.1); // right up to the beam above
          productMesh.setMatrixAt(i, boxM(it.rect, it.z0, it.h, 1, 0.94)); // fills its slot: no gaps
          productMesh.setColorAt(i, colourFor(it));
          productOf.set(it, i);
        });
        productMesh.instanceMatrix.needsUpdate = true; productMesh.instanceColor.needsUpdate = true;
        productMesh.castShadow = true; productMesh.receiveShadow = true; productMesh.frustumCulled = false;
        groups.main.add(productMesh);
      }
      shelfCells.clear(); for (const k in arr.shelves) if (!arr.shelves[k].drawer) shelfCells.set(k, arr.shelves[k].cells);
      if (labelMesh) buildLabels();
      free = FS.freeSpots(arr, sidx);
      for (const r of free.runs) {
        const o = bayInfo.get(r.seg.bay) || { items: 0, free: 0, shelves: 0 };
        if (r.kind === 'shelf') o.shelves++; else o.free += r.n;
        bayInfo.set(r.seg.bay, o);
      }
      byLoc = arr.placed.slice().sort((a, b) => (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0));
      stock = { items: arr.placed, total: items.length, unplaced: arr.unplaced, all: items, cut: stockCut, free };
      buildFree();
      $('freeBtn').hidden = false;
      renderer.shadowMap.needsUpdate = true; redraw(); photoSig = ''; photoDue = performance.now();
      return stock;
    }

    /* ---------- free spots: locations with nothing nailed to them ---------- */
    // Green boxes on ordinary shelves (one a free position, or a slab for a whole empty shelf); drawers with free
    // positions turn green (light green: some free, green: all of it). Shown with the Free spots button.
    let free = null, freeMesh = null, freeOn = false;
    const freeCells = [], freeCellAt = new Map(), drawerFree = new Map();
    function buildFree() {
      if (freeMesh) { groups.main.remove(freeMesh); freeMesh.dispose(); freeMesh = null; }
      freeCells.length = 0; freeCellAt.clear(); drawerFree.clear();
      if (free) {
        for (const r of free.runs) {
          const bay = r.seg.bay, z0 = FS.shelfZ(bay, r.shelf) + 0.012, gap = FS.shelfGap(bay, r.shelf);
          if (r.kind === 'drawer') {
            for (let p = r.from; p <= r.to; p++) { const i = drawerOfPos(r.seg, r.shelf, p); if (i !== undefined) drawerFree.set(i, (drawerFree.get(i) || 0) + 1); }
            continue;
          }
          if (r.kind === 'shelf') { freeCellAt.set(r.loc, freeCells.length); freeCells.push({ run: r, pos: 0, rect: fit(r.seg, FS.cellRect(r.seg, 0, 1, 0, 1)), z0, h: Math.min(0.08, gap * 0.3), sw: 0.97 }); continue; }
          for (let p = r.from; p <= r.to; p++) {
            freeCellAt.set(r.key + '-' + pad2(p), freeCells.length);
            freeCells.push({ run: r, pos: p, rect: fit(r.seg, FS.cellRect(r.seg, p - 1, r.cells, 0, 1)), z0, h: Math.max(0.05, Math.min(0.25, gap * 0.5)), sw: 1 });
          }
        }
        if (freeCells.length) {
          freeMesh = new T.InstancedMesh(unitBox, freeMat, freeCells.length);
          freeCells.forEach((c, i) => freeMesh.setMatrixAt(i, boxM(c.rect, c.z0, c.h, c.sw, 0.86)));
          freeMesh.instanceMatrix.needsUpdate = true; freeMesh.frustumCulled = false; freeMesh.renderOrder = 2;
          freeMesh.visible = freeOn;
          groups.main.add(freeMesh);
        }
      }
      colourDrawers();
    }
    function colourDrawers() {
      if (!drawerMesh) return;
      drawerList.forEach((d, i) => {
        let c = BOARD;
        if (stock && freeOn && drawerFree.has(i)) c = drawerFree.get(i) >= Math.min(d.deep, d.positions - d.box * d.deep) ? FREE_ALL : FREE_SOME;
        else if (stock && drawerFree.get(i) >= Math.min(d.deep, d.positions - d.box * d.deep)) c = BOARD_EMPTY;
        drawerMesh.setColorAt(i, c);
      });
      drawerMesh.instanceColor.needsUpdate = true; redraw();
    }
    function setFree(on) {
      freeOn = !!on && !!stock;
      if (freeMesh) freeMesh.visible = freeOn;
      $('freeBtn').setAttribute('aria-pressed', String(freeOn)); $('freeShow').checked = freeOn;
      colourDrawers();
      try { localStorage.setItem('fp-free-v1', freeOn ? '1' : '0'); } catch (e) { /* private mode */ }
      if (freeOn && free && !seenHint.free) { seenHint.free = 1; flash(nf(free.positions) + ' free spots are green. Tap one to see where it is.'); }
    }
    $('freeBtn').addEventListener('click', () => setFree(!freeOn));
    $('freeShow').addEventListener('change', (e) => setFree(e.target.checked));
    function runTitle(r) {
      if (r.kind === 'shelf') return r.loc + ', whole shelf';
      return r.loc + (r.n > 1 ? ' to ' + pad2(r.to) : '');
    }
    function runNote(r) {
      if (r.kind === 'shelf') return 'Nothing nailed on the whole shelf (if the shelf is there)';
      const n = r.n > 1 ? r.n + ' free next to each other' : '1 free';
      if (r.kind === 'drawer') {
        const sh = FS.drawerShape(sidx, r.seg), a = Math.floor((r.from - 1) / sh.deep) + 1, b = Math.floor((r.to - 1) / sh.deep) + 1;
        return n + ', ' + (a === b ? 'drawer ' + a + (r.n === 1 ? ' ' + side((r.from - 1) % sh.deep, sh.deep) : '') : 'drawers ' + a + ' to ' + b);
      }
      return n + (r.from === 1 ? ', before ' + pad2(r.to + 1) : ', in the gap between ' + pad2(r.from - 1) + ' and ' + pad2(r.to + 1));
    }

    /* ---------- a pin over what you're looking for, seen through everything ---------- */
    function pinSprite(text, bg, fg) {
      const px = 64, pad = 18, tip = 20, c = document.createElement('canvas'), g = c.getContext('2d');
      const font = '800 ' + px + 'px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
      g.font = font;
      const w = Math.ceil(g.measureText(text).width) + pad * 2, bh = Math.round(px + pad * 1.3), h = bh + tip, r = 20;
      c.width = w; c.height = h;
      g.fillStyle = bg;
      g.beginPath(); g.moveTo(r, 0); g.arcTo(w, 0, w, bh, r); g.arcTo(w, bh, 0, bh, r); g.arcTo(0, bh, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(w / 2 - tip, bh - 1); g.lineTo(w / 2 + tip, bh - 1); g.lineTo(w / 2, h); g.closePath(); g.fill();
      g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = fg || '#14171f';
      g.fillText(text, w / 2, bh / 2 + 3);
      const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
      const s = new T.Sprite(new T.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
      s.center.set(0.5, 0); s.renderOrder = 10; s.userData.aspect = w / h;
      return s;
    }
    function setPin(text, x, y, z, green) {
      clearPin();
      pin = pinSprite(text, green ? 'rgba(31,138,70,.97)' : 'rgba(255,210,0,.97)', green ? '#ffffff' : '#14171f');
      pin.position.copy(V(x, y, z)); scene.add(pin); pinAt = { x, y, green };
      sizePin(); redraw();
    }
    function clearPin() { if (pin) { scene.remove(pin); pin.material.map.dispose(); pin.material.dispose(); pin = null; } pinAt = null; redraw(); }
    function sizePin() { // about 30 px tall whatever the view
      if (!pin) return;
      const hgt = mode === 'plan' ? 30 / top.ppm : (30 / view.h) * 2 * Math.tan(T.MathUtils.degToRad(cam().fov / 2));
      pin.scale.set(hgt * pin.userData.aspect, hgt, 1);
    }

    /* ---------- photos and labels drawn many to a draw ---------- */
    function atlasSlots(x0, y0, w, h, sw, sh) {
      const out = [];
      for (let y = y0; y + sh <= y0 + h; y += sh) for (let x = x0; x + sw <= x0 + w; x += sw) out.push({ x, y, key: null, used: 0 });
      return out;
    }
    function atlasMesh(mat, tex, cap) { // an InstancedMesh whose instances each show their own part (slot) of one texture
      const geo = new T.PlaneGeometry(1, 1);
      geo.setAttribute('aUv', new T.InstancedBufferAttribute(new Float32Array(cap * 4), 4));
      mat.map = tex;
      mat.onBeforeCompile = (sh) => { // images go in top row first, so v is flipped inside the slot
        sh.vertexShader = 'attribute vec4 aUv;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvMapUv = aUv.xy + vec2(vMapUv.x, 1.0 - vMapUv.y) * aUv.zw;');
      };
      const m = new T.InstancedMesh(geo, mat, cap);
      m.count = 0; m.frustumCulled = false;
      groups.main.add(m);
      return m;
    }
    const _src = new T.Texture(), _at = new T.Vector2(), _im = new T.Matrix4(), _iq = new T.Quaternion(), _ip = new T.Vector3(), _is = new T.Vector3(), _up = new T.Vector3(0, 1, 0);
    function takeSlot(slots, keep) { // an empty slot, or the one unused for longest that isn't on screen
      let best = null;
      for (const s of slots) {
        if (!s.key) return s;
        if (!keep.has(s.key) && (!best || s.used < best.used)) best = s;
      }
      return best;
    }
    const faceTurn = (f) => (f[1] > 0 ? 0 : f[1] < 0 ? Math.PI : f[0] > 0 ? Math.PI / 2 : -Math.PI / 2);
    function putInstance(mesh, i, x, y, z, turn, w, h, uv) { // x, y: plan point; z: height; uv: [u, v, du, dv]
      _iq.setFromAxisAngle(_up, turn);
      mesh.setMatrixAt(i, _im.compose(_ip.set(x, z, y), _iq, _is.set(w, h, 1)));
      mesh.geometry.attributes.aUv.setXYZW(i, uv[0], uv[1], uv[2], uv[3]);
    }
    function showInstances(mesh, n) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true; mesh.geometry.attributes.aUv.needsUpdate = true;
    }

    /* ---------- product photos ---------- */
    // The Toolbox's own saved copies, the ones Product Search shows (product-search/photos/CODE.jpg, 120 px, about
    // 2 KB each), loaded a few at a time and only for boxes near you, an open drawer and the cards. Screwfix's own image
    // server is never asked (detailedfoil, 30 Oct 2026: don't send it everything at once): no saved copy, no photo.
    // They go straight into one 2048 px texture with room for 256 (no smaller copies to make, so each costs one quick
    // copy), and the 80 nearest are drawn in one go.
    const photoUrl = (code) => 'product-search/photos/' + encodeURIComponent(code) + '.jpg';
    const photos = new Map(); // code -> { state: 'loading' | 'ok' | 'none', slot }
    const PHOTO_AT_ONCE = 4, PHOTO_NEAR = 5, PHOTO_MAX = 80, PS = 128, PI = 120;
    const photoTex = new T.DataTexture(null, 2048, 2048);
    photoTex.source.dataReady = false; // room on the graphics chip, nothing sent yet: the slots are filled one at a time
    photoTex.colorSpace = T.SRGBColorSpace; photoTex.magFilter = photoTex.minFilter = T.LinearFilter; photoTex.generateMipmaps = false; photoTex.needsUpdate = true;
    const photoSlots = atlasSlots(0, 0, 2048, 2048, PS, PS);
    const photoMesh = atlasMesh(new T.MeshLambertMaterial({ color: 0xffffff }), photoTex, PHOTO_MAX);
    const photoGeo = new T.PlaneGeometry(1, 1); // for the photos in an open drawer
    const photoCanvas = document.createElement('canvas'); photoCanvas.width = photoCanvas.height = PI;
    let photoQueue = [], photoBusy = 0, photoDue = 0, photoSig = '', photoNear = [];
    const photoInbox = []; // photos that have arrived, waiting for the next frame
    function loadPhotos() {
      while (photoBusy < PHOTO_AT_ONCE && photoQueue.length) {
        const code = photoQueue.shift();
        if (photos.has(code)) continue;
        const p = { state: 'loading', slot: null };
        photos.set(code, p); photoBusy++;
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => { photoBusy--; photoInbox.push([code, img]); redraw(); loadPhotos(); };
        img.onerror = () => { photoBusy--; p.state = 'none'; loadPhotos(); };
        img.src = photoUrl(code);
      }
    }
    function wantPhotos(codes) { photoQueue = codes.filter((c) => !photos.has(c)); loadPhotos(); }
    function flushPhotos() { // called by the frame loop: everything that arrived since the last frame
      const list = photoInbox.splice(0), keep = new Set(photoNear.map((i) => products[i] && products[i].code)), now = performance.now();
      for (const [code, img] of list) {
        const p = photos.get(code);
        if (!p) continue;
        const s = takeSlot(photoSlots, keep);
        if (!s) { photos.delete(code); continue; }
        if (s.key) photos.delete(s.key); // its old photo comes again (from the browser's copy) if it's wanted later
        let from = img;
        if (img.naturalWidth !== PI || img.naturalHeight !== PI) { const g = photoCanvas.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, PI, PI); g.drawImage(img, 0, 0, PI, PI); from = photoCanvas; }
        _src.image = from;
        renderer.copyTextureToTexture(_src, photoTex, null, _at.set(s.x, s.y));
        s.key = code; s.used = now; p.state = 'ok'; p.slot = s;
      }
      fillPhotos();
    }
    function fillPhotos() { // the photo instances: the near boxes whose photo is in the texture
      let n = 0;
      const now = performance.now();
      for (const i of photoNear) {
        const it = products[i], p = it && photos.get(it.code);
        if (!p || p.state !== 'ok') continue;
        const r = it.rect, f = FRONT[it.pl.seg.face];
        const across = f[0] ? r.y1 - r.y0 : r.x1 - r.x0, deep = f[0] ? r.x1 - r.x0 : r.y1 - r.y0, s = Math.min(across, it.h) * 0.9;
        p.slot.used = now;
        putInstance(photoMesh, n++, (r.x0 + r.x1) / 2 + f[0] * (deep * 0.47 + 0.003), (r.y0 + r.y1) / 2 + f[1] * (deep * 0.47 + 0.003), it.z0 + it.h / 2, faceTurn(f), s, s,
          [(p.slot.x + 0.5) / 2048, (p.slot.y + 0.5) / 2048, (PI - 1) / 2048, (PI - 1) / 2048]);
      }
      showInstances(photoMesh, n);
      redraw();
    }
    function clearPhotoPlanes() { photoNear = []; showInstances(photoMesh, 0); }
    const _frustum = new T.Frustum(), _pm = new T.Matrix4(), _pv = new T.Vector3();
    function updatePhotos() { // a photo on the front of the boxes close to you that you can see
      const near = [];
      const c = cam();
      if (products.length && (mode === 'walk' || (mode === 'orbit' && orbit.r < 10))) {
        c.updateMatrixWorld(); _pm.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse); _frustum.setFromProjectionMatrix(_pm);
        const ex = c.position.x, ey = c.position.z, ez = c.position.y, R = mode === 'walk' ? PHOTO_NEAR : Math.max(3, orbit.r * 0.7);
        for (let i = 0; i < products.length; i++) {
          const it = products[i], r = it.rect, f = FRONT[it.pl.seg.face];
          const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2, cz = it.z0 + it.h / 2, dx = cx - ex, dy = cy - ey;
          if (dx > R || dx < -R || dy > R || dy < -R) continue;
          const d2 = dx * dx + dy * dy + (cz - ez) * (cz - ez);
          if (d2 > R * R || dx * f[0] + dy * f[1] > 0) continue; // too far, or you're behind it
          if (!_frustum.containsPoint(_pv.set(cx, cz, cy))) continue;
          near.push([d2, i]);
        }
        near.sort((a, b) => a[0] - b[0]);
        if (near.length > PHOTO_MAX) near.length = PHOTO_MAX;
      }
      photoNear = near.map((n) => n[1]);
      wantPhotos(photoNear.map((i) => products[i].code).filter((code) => !photos.has(code)));
      fillPhotos();
    }

    /* ---------- location labels: every one in the store, made once while the page loads ---------- */
    // Red (odd bay numbers) and blue (even) labels on the shelf edges, and white ones on the drawer fronts (a line per
    // position, the back one on top), like the real ones. Making them as you walked round was laggy, so now all of them
    // (about 15,000 with the full list) are one InstancedMesh made behind the loading bar: each instance carries its
    // location as numbers (4 characters to a number, 6 bits each) and the graphics chip draws the letters from one small
    // font texture. Walking round costs nothing extra; only the ones within 6 m are drawn.
    const GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-'; // 62 = a gap, 63 = the arrow
    const glyphTex = (() => { // 16 x 4 cells of 32 x 64 px, white letters
      const c = document.createElement('canvas'); c.width = 512; c.height = 256;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '800 52px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
      for (let i = 0; i < GLYPHS.length; i++) {
        const s = Math.min(1, 29 / g.measureText(GLYPHS[i]).width); // wide letters are squeezed into the cell
        g.save(); g.translate((i % 16) * 32 + 16, ((i / 16) | 0) * 64 + 33); g.scale(s, 1); g.fillText(GLYPHS[i], 0, 0); g.restore();
      }
      g.save(); g.translate(15 * 32 + 16, 3 * 64); // the arrow, cell 63
      g.beginPath(); g.moveTo(0, 9); g.lineTo(-13, 31); g.lineTo(13, 31); g.closePath(); g.fill(); g.fillRect(-4.5, 29, 9, 26);
      g.restore();
      const t = new T.CanvasTexture(c); t.colorSpace = T.NoColorSpace; t.anisotropy = maxAniso;
      return t;
    })();
    const labelMat = new T.ShaderMaterial({
      uniforms: {
        uGlyphs: { value: glyphTex }, uFar: { value: 6 },
        uRed: { value: new T.Color('#c3222b') }, uBlue: { value: new T.Color('#1f4fa8') }, uPaper: { value: new T.Color('#f2f2f0') }, uInk: { value: new T.Color('#15171c') }, uEdge: { value: new T.Color('#b9b9b5') },
      },
      vertexShader: [
        'attribute vec4 aLab;', 'uniform float uFar;', 'varying vec2 vUv;', 'flat varying vec4 vLab;',
        'void main() {',
        '  vUv = uv; vLab = aLab;',
        '  vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
        '  if (distance(c.xyz, cameraPosition) > uFar) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }', // too far: not drawn
        '  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);',
        '}'].join('\n'),
      fragmentShader: [
        'uniform sampler2D uGlyphs;', 'uniform vec3 uRed, uBlue, uPaper, uInk, uEdge;', 'varying vec2 vUv;', 'flat varying vec4 vLab;',
        'float charAt(float i) {', // character i (0 to 11) of the location
        '  float f = i < 3.5 ? vLab.x : (i < 7.5 ? vLab.y : vLab.z);',
        '  return mod(floor(f / exp2(6.0 * mod(i, 4.0))), 64.0);',
        '}',
        'void main() {',
        '  float style = vLab.w;', // 0 to 3: a line of a drawer label (1 top, 2 bottom, 3 the only one), 4: red, 5: blue
        '  bool shelf = style > 3.5;',
        '  vec3 bg = shelf ? (style < 4.5 ? uRed : uBlue) : uPaper;',
        '  vec3 ink = shelf ? vec3(1.0) : uInk;',
        '  float cells = shelf ? 13.0 : 12.0;', // the shelf-edge labels have the arrow as a 13th character
        '  vec2 pad = shelf ? vec2(0.035, 0.16) : vec2(0.05, 0.12);',
        '  vec2 p = (vUv - pad) / (1.0 - 2.0 * pad);',
        '  vec2 q = vec2(p.x * cells, p.y);',
        '  vec2 qdx = dFdx(q), qdy = dFdy(q), sc = vec2(1.0 / 16.0, 1.0 / 4.0);',
        '  float a = 0.0;',
        '  if (p.x > 0.0 && p.x < 1.0 && p.y > 0.0 && p.y < 1.0) {',
        '    float i = floor(q.x);',
        '    float code = i > 11.5 ? 63.0 : charAt(i);',
        '    vec2 cell = vec2(mod(code, 16.0), floor(code / 16.0));',
        '    vec2 g = vec2((cell.x + fract(q.x)) / 16.0, 1.0 - (cell.y + 1.0 - p.y) / 4.0);',
        '    a = textureGrad(uGlyphs, g, qdx * sc, qdy * sc).a;',
        '  }',
        '  vec3 col = mix(bg, ink, a);',
        '  if (!shelf) {', // a thin grey edge round each drawer label
        '    float e = min(vUv.x, 1.0 - vUv.x) < 0.012 ? 1.0 : 0.0;',
        '    if ((abs(style - 1.0) < 0.5 || abs(style - 3.0) < 0.5) && vUv.y > 0.93) e = 1.0;',
        '    if ((abs(style - 2.0) < 0.5 || abs(style - 3.0) < 0.5) && vUv.y < 0.07) e = 1.0;',
        '    col = mix(col, uEdge, e);',
        '  }',
        '  gl_FragColor = vec4(col, 1.0);',
        '  #include <colorspace_fragment>',
        '}'].join('\n'),
    });
    let labelMesh = null, labelBase = null;
    const shelfCells = new Map(); // area-bay-shelf -> how many positions its labels need (from the list)
    const labelRange = new Map(); // drawer index -> [first instance, how many] (hidden while it's pulled out)
    const labelsWanted = () => mode === 'walk' || (mode === 'orbit' && orbit.r < 9);
    function packCode(t) { // 12 characters, 4 to a number: exact in the graphics chip's 32-bit numbers
      const out = [0, 0, 0];
      for (let i = 0; i < 12; i++) { const k = i < t.length ? GLYPHS.indexOf(t[i]) : -1; out[(i / 4) | 0] += (k < 0 ? 62 : k) * Math.pow(64, i % 4); }
      return out;
    }
    function buildLabels() {
      if (!sidx) return;
      const rows = []; // 10 numbers a label: x, y, z, turn, width, height, the location (3), style
      const add = (x, y, z, f, w, h, text, style) => { const p = packCode(text); rows.push(x, y, z, faceTurn(f), w, h, p[0], p[1], p[2], style); };
      for (const seg of sidx.list) { // the shelf edges: a label per position
        const b = seg.bay;
        if (b.kind === 'bulk' || b.kind === 'cage' || b.kind === 'cabinet' || b.kind === 'floor') continue;
        const cfg = FS.bayCfg(sidx, seg.area, seg.no), no = seg.no || 1, f = FRONT[seg.face], style = no % 2 === 1 ? 4 : 5;
        const per = cfg.positions || Math.max(1, Math.round((seg.u1 - seg.u0) / FS.BOX_W));
        for (let sh = b.kind === 'pallet' ? 2 : 1; sh <= b.levels; sh++) {
          if (cfg.drawers && sh <= cfg.drawers) continue;
          const z = FS.shelfZ(b, sh) - 0.04, cells = shelfCells.get(seg.area + '-' + pad2(no) + '-' + pad2(sh)) || per;
          const w = Math.min(0.115, (seg.u1 - seg.u0) / cells * 0.92);
          for (let i = 0; i < cells; i++) {
            const r = FS.cellRect(seg, i, cells, 0, 1);
            const x = f[0] ? (f[0] > 0 ? r.x1 : r.x0) + f[0] * 0.004 : (r.x0 + r.x1) / 2, y = f[1] ? (f[1] > 0 ? r.y1 : r.y0) + f[1] * 0.004 : (r.y0 + r.y1) / 2;
            add(x, y, z, f, w, w * 0.208, seg.area + '-' + pad2(no) + '-' + pad2(sh) + '-' + pad2(i + 1), style);
          }
        }
      }
      labelRange.clear();
      drawerList.forEach((d, i) => { // the drawer fronts: a line per position, the back one on top
        const r = d.rect, f = FRONT[d.seg.face], deep = f[0] ? r.x1 - r.x0 : r.y1 - r.y0;
        const x = (r.x0 + r.x1) / 2 + f[0] * (deep * 0.47 + 0.003), y = (r.y0 + r.y1) / 2 + f[1] * (deep * 0.47 + 0.003);
        const first = d.box * d.deep + 1, last = Math.min(d.positions, first + d.deep - 1), n = last - first + 1;
        const w = Math.min(0.105, (f[0] ? r.y1 - r.y0 : r.x1 - r.x0) * 0.85), lh = Math.min(0.0185, d.h * 0.8 / n), top = d.z0 + d.h * 0.45 + lh * n / 2;
        labelRange.set(i, [rows.length / 10, n]);
        for (let k = 0; k < n; k++) {
          add(x, y, top - lh * (k + 0.5), f, w, lh, d.seg.area + '-' + pad2(d.seg.no || 1) + '-' + pad2(d.shelf) + '-' + pad2(last - k), n === 1 ? 3 : k === 0 ? 1 : k === n - 1 ? 2 : 0);
        }
      });
      const n = rows.length / 10, lab = new Float32Array(Math.max(1, n) * 4);
      if (labelMesh) { groups.main.remove(labelMesh); labelMesh.geometry.dispose(); labelMesh.dispose(); }
      const geo = new T.PlaneGeometry(1, 1);
      geo.setAttribute('aLab', new T.InstancedBufferAttribute(lab, 4));
      labelMesh = new T.InstancedMesh(geo, labelMat, Math.max(1, n));
      for (let i = 0; i < n; i++) {
        const o = i * 10;
        _iq.setFromAxisAngle(_up, rows[o + 3]);
        labelMesh.setMatrixAt(i, _im.compose(_ip.set(rows[o], rows[o + 2], rows[o + 1]), _iq, _is.set(rows[o + 4], rows[o + 5], 1)));
        lab.set([rows[o + 6], rows[o + 7], rows[o + 8], rows[o + 9]], i * 4);
      }
      labelMesh.count = n; labelMesh.frustumCulled = false; labelMesh.visible = labelsWanted();
      labelBase = labelMesh.instanceMatrix.array.slice(); // to put a drawer's label back when it's pushed in
      groups.main.add(labelMesh);
      if (openIndex >= 0) drawerLabel(openIndex, false);
      redraw();
    }
    function drawerLabel(i, show) { // a pulled-out drawer leaves its label behind otherwise
      const r = labelMesh && labelRange.get(i);
      if (!r) return;
      const a = labelMesh.instanceMatrix.array;
      for (let k = r[0]; k < r[0] + r[1]; k++) {
        if (show) a.set(labelBase.subarray(k * 16, k * 16 + 16), k * 16); else labelMesh.setMatrixAt(k, HIDE);
      }
      labelMesh.instanceMatrix.needsUpdate = true;
    }

    function thumb(code) { // a small photo for the lists and cards (the browser loads it when it's in view)
      const img = document.createElement('img');
      img.className = 'fp-thumb'; img.alt = ''; img.width = 40; img.height = 40; img.loading = 'lazy'; img.decoding = 'async';
      const p = photos.get(code);
      if (p && p.state === 'none') img.classList.add('none');
      else { img.onerror = () => { img.classList.add('none'); if (!photos.has(code)) photos.set(code, { state: 'none' }); }; img.src = photoUrl(code); }
      return img;
    }

    // pulling a drawer out: it slides towards you and you can see what is in it
    function trayPhoto(m, code) { // a photo on top of something in the open drawer (its own small texture)
      const p = photos.get(code);
      if (p && p.state === 'none') return;
      const img = new Image();
      img.onload = () => {
        if (!tray || m.parent !== tray) return; // pushed back in before it came
        const t = new T.Texture(img); t.colorSpace = T.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = T.LinearFilter; t.needsUpdate = true;
        m.material.map = t; m.material.needsUpdate = true; m.visible = true; redraw();
      };
      img.src = photoUrl(code);
    }
    let tray = null, trayInfo = null, slide = null, trayV = 0;
    function moveTray() { const t = trayInfo; tray.position.set(t.base[0] + t.f[0] * t.dist * trayV, t.z, t.base[1] + t.f[1] * t.dist * trayV); }
    function removeTray() {
      if (tray) {
        scene.remove(tray);
        tray.traverse((o) => {
          if (o.isSprite) { o.material.map.dispose(); o.material.dispose(); }
          else if (o.material && o.material !== trayMat && o.material !== freeMat) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
        });
        tray = null;
      }
      if (openIndex >= 0 && drawerMesh) { drawerMesh.setMatrixAt(openIndex, drawerList[openIndex].matrix); drawerMesh.instanceMatrix.needsUpdate = true; drawerLabel(openIndex, true); }
      openIndex = -1; slide = null; trayV = 0; redraw();
    }
    function openDrawer(i) {
      if (openIndex === i) return;
      if (openIndex >= 0) removeTray();
      const d = drawerList[i], r = d.rect, h = d.h, t = 0.012;
      const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2, w = (r.x1 - r.x0) * 0.99, dd = (r.y1 - r.y0) * 0.99, f = FRONT[d.seg.face];
      openIndex = i;
      drawerMesh.setMatrixAt(i, HIDE); drawerMesh.instanceMatrix.needsUpdate = true; drawerLabel(i, false);
      const g = new T.Group();
      g.userData.drawer = i;
      const part = (x, y, z, sx, sy, sz, mat) => { const m = new T.Mesh(unitBox, mat || trayMat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.receiveShadow = true; g.add(m); return m; };
      part(0, t / 2, 0, w, t, dd);
      for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const wh = sx === f[0] && sz === f[1] ? h * 0.35 : h * 0.9;
        if (sx) part(sx * (w / 2 - t / 2), wh / 2, 0, t, wh, dd); else part(0, wh / 2, sz * (dd / 2 - t / 2), w, wh, t);
      }
      for (let j = 0; j < d.deep && d.box * d.deep + j < d.positions; j++) {
        const it = itemAt.get(trayLoc(d, j)), c = FS.cellRect(d.seg, d.box, d.boxes, j, d.deep);
        const px = (c.x0 + c.x1) / 2 - cx, pz = (c.y0 + c.y1) / 2 - cy, cw = (c.x1 - c.x0) * 0.8, cd = (c.y1 - c.y0) * 0.8;
        if (!it) {
          if (stock) part(px, t + 0.004, pz, cw, 0.008, cd, freeMat); // a free position: green
          continue;
        }
        part(px, t + h * 0.3, pz, cw, h * 0.55, cd, new T.MeshLambertMaterial({ color: colourFor(it) })).userData.item = it;
        const ph = new T.Mesh(photoGeo, new T.MeshLambertMaterial({ color: 0xffffff }));
        const s = Math.min(cw, cd) * 0.92;
        ph.rotation.x = -Math.PI / 2; ph.position.set(px, t + h * 0.575 + 0.002, pz); ph.scale.set(s, s, 1); ph.visible = false;
        g.add(ph); trayPhoto(ph, it.code);
        const lab = label(it.code, { size: 0.035, bg: 'rgba(255,255,255,.95)', fg: '#14171f', weight: 800 });
        lab.position.set(px, h * 0.95, pz); g.add(lab);
      }
      tray = g; scene.add(g);
      trayInfo = { base: [cx, cy], f, z: d.z0, dist: (f[0] ? r.x1 - r.x0 : r.y1 - r.y0) * 0.8 };
      trayV = 0; moveTray();
      slide = { from: 0, to: 1, t0: performance.now(), dur: 280, closing: false };
      redraw();
    }
    function closeDrawer(instant) {
      if (openIndex < 0) return;
      if (instant) removeTray(); else slide = { from: trayV, to: 0, t0: performance.now(), dur: 240, closing: true };
      redraw();
    }

    // shelf numbers down the left-hand upright (positions count from that end) of the bay you're looking at
    const shelfTags = new T.Group();
    scene.add(shelfTags);
    function clearShelfTags() { for (const t of shelfTags.children) { t.material.map.dispose(); t.material.dispose(); } shelfTags.clear(); redraw(); }
    function showShelfTags(b, face) {
      clearShelfTags();
      if (!b || b.kind === 'bulk' || b.kind === 'cage' || b.kind === 'floor') return;
      const faces = new Set(face ? [face] : []);
      if (!face) { if (sidx) for (const seg of sidx.list) if (seg.bay === b) faces.add(seg.face); if (!faces.size) for (const f of b.open) faces.add(f); }
      const n = Math.max(2, b.levels), ax = b.along === 'x';
      for (const f of faces) {
        const F = FRONT[f], left = f === 'S' || f === 'W'; // positions run +x / +y from the left as you face S / W
        const u = left ? (ax ? b.x0 : b.y0) + 0.07 : (ax ? b.x1 : b.y1) - 0.07;
        const v = (f === 'S' ? b.y1 : f === 'N' ? b.y0 : f === 'E' ? b.x1 : b.x0) + (F[0] + F[1]) * 0.03;
        for (let k = 1; k <= n; k++) {
          const t = label(String(k), { size: 0.055, bg: 'rgba(255,255,255,.94)', fg: '#14171f', weight: 800 });
          t.position.copy(V(ax ? u : v, ax ? v : u, FS.shelfZ(b, k) + 0.06));
          shelfTags.add(t);
        }
      }
      redraw();
    }

    // putting yourself in front of something and looking at it
    function standAt(seg, r, z) {
      const f = FRONT[seg.face], tx = (r.x0 + r.x1) / 2, ty = (r.y0 + r.y1) / 2;
      [walk.x, walk.y] = nearestFree(tx + f[0] * 1.05, ty + f[1] * 1.05);
      walk.yaw = Math.atan2(-(tx - walk.x), -(ty - walk.y));
      setMode('walk');
      // on a phone the card covers the top of the screen, so look a little higher and the thing sits lower down
      const lift = view.w < 700 ? Math.atan(0.36 * Math.tan(T.MathUtils.degToRad(eye.fov / 2))) : 0;
      walk.pitch = Math.max(-1.2, Math.min(1.2, Math.atan2(z - 1.62, Math.hypot(tx - walk.x, ty - walk.y) || 1) + lift));
      applyWalk(); redraw();
    }
    // card lines: plain text, or {text, code (a photo), cls, more}. `more` lines, buttons and the note only show once
    // the card is opened up with More (detailedfoil, 30 Oct 2026: the pop-up was too big); it stays open until Less.
    let cardFull = false;
    function cardLines(lines, items) {
      const list = $('cardList');
      list.innerHTML = ''; list.classList.toggle('items', !!items);
      for (const l of lines) {
        if (!l) continue;
        const li = document.createElement('li');
        if (typeof l === 'string') li.textContent = l;
        else {
          if (items) li.appendChild(l.code ? thumb(l.code) : Object.assign(document.createElement('span'), { className: 'fp-thumb none' }));
          const s = document.createElement('span'); s.textContent = l.text; if (l.cls) s.className = l.cls; li.appendChild(s);
          if (l.more) li.classList.add('more');
        }
        list.appendChild(li);
      }
    }
    // buttons: [text, fn, alt, more]; all = always the whole card (the help)
    function cardButtons(list, all) {
      const btns = $('cardBtns'); btns.innerHTML = '';
      for (const [text, fn, alt, more] of list) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
        if (alt) b.className = 'alt';
        if (more) b.classList.add('more');
        b.addEventListener('click', fn); btns.appendChild(b);
      }
      const extra = !all && !!($('cardList').querySelector('.more') || btns.querySelector('.more') || $('cardNote').textContent);
      card.classList.toggle('compact', extra && !cardFull);
      if (!extra) return;
      const t = document.createElement('button'); t.type = 'button'; t.className = 'alt fp-more';
      const set = () => { t.textContent = cardFull ? 'Less' : 'More'; t.setAttribute('aria-expanded', String(cardFull)); card.classList.toggle('compact', !cardFull); };
      t.addEventListener('click', () => { cardFull = !cardFull; set(); });
      set(); btns.appendChild(t);
    }
    function cardPhoto(code) {
      const img = $('cardPhoto'), p = code && photos.get(code);
      img.hidden = true; img.onload = null; img.onerror = null; img.removeAttribute('src');
      if (!code || (p && p.state === 'none')) return;
      img.onload = () => { img.hidden = false; };
      img.onerror = () => { if (!photos.has(code)) photos.set(code, { state: 'none' }); };
      img.src = photoUrl(code);
    }
    function copy(text) {
      const ok = () => flash('Copied ' + text), no = () => flash("Couldn't copy: " + text);
      try { navigator.clipboard.writeText(text).then(ok, no); } catch (e) { no(); }
    }
    const lookHere = () => (mode === 'walk' ? 'Stand in front of it' : 'Walk here');
    function itemLine(pos, sideTxt, it) {
      return it ? { text: pos + ' ' + sideTxt + ': ' + it.code + ' ' + it.name + ' (' + it.qty + ' available)', code: it.code }
        : { text: pos + ' ' + sideTxt + ': free (nothing nailed)', cls: 'free' };
    }
    function showDrawer(i, at) {
      const d = drawerList[i];
      if (openIndex !== i) openDrawer(i);
      shown = { kind: 'drawer', ref: i, at }; selected = null; hl.visible = false;
      const first = d.box * d.deep + 1, last = Math.min(d.positions, first + d.deep - 1);
      const loc = d.seg.area + '-' + pad2(d.seg.no || 0) + '-' + pad2(d.shelf);
      $('cardTitle').textContent = loc;
      $('cardSub').textContent = 'Drawer ' + (d.box + 1) + ' of ' + d.boxes + ', shelf ' + d.shelf;
      const lines = [];
      for (let j = 0; first + j <= last; j++) {
        const it = itemAt.get(trayLoc(d, j));
        lines.push(stock ? itemLine(pad2(first + j), side(j, d.deep), it) : { text: pad2(first + j) + ' ' + side(j, d.deep) + ': load the stock list to see what is in it' });
      }
      cardLines(lines, true);
      cardPhoto(at && itemAt.get(at) ? itemAt.get(at).code : null);
      $('cardNote').textContent = '';
      cardButtons([[lookHere(), () => standAt(d.seg, d.rect, d.z0 + d.h / 2)], ['Copy ' + (at || loc), () => copy(at || loc), true, true], ['Push it in', () => closeCard(), true, true]]);
      const top = FS.cellRect(d.seg, d.box, d.boxes, 0, 1);
      setPin(at || loc + ' drawer ' + (d.box + 1), (top.x0 + top.x1) / 2, (top.y0 + top.y1) / 2, d.z0 + d.h + 0.05, !!(at && !itemAt.get(at)));
      showShelfTags(d.seg.bay, d.seg.face);
      card.hidden = false; redraw();
    }
    function showProduct(i) {
      const it = products[i], pl = it.pl, b = pl.seg.bay, r = it.rect;
      closeDrawer(true);
      shown = { kind: 'product', ref: i }; selected = null;
      hl.position.set((r.x0 + r.x1) / 2, it.z0 + it.h / 2, (r.y0 + r.y1) / 2);
      hl.scale.set(r.x1 - r.x0 + 0.04, it.h + 0.04, r.y1 - r.y0 + 0.04);
      hl.material.opacity = 0.5; hl.visible = true;
      $('cardTitle').textContent = it.code;
      $('cardSub').textContent = it.name;
      cardLines([it.loc + ', ' + it.qty + ' available', { text: 'Shelf ' + pl.shelf + ', position ' + pl.pos, more: true }, redOn && isRed(it) ? { text: 'Sharp or liquid', more: true } : '']);
      cardPhoto(it.code);
      $('cardNote').textContent = '';
      cardButtons([[lookHere(), () => standAt(pl.seg, r, it.z0 + it.h / 2)], ['Copy location', () => copy(it.loc), true, true], ['Product Search', () => window.open('product-search.html#q=' + encodeURIComponent(it.code), '_blank'), true, true]]);
      setPin(it.loc, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, it.z0 + it.h + 0.04);
      showShelfTags(b, pl.seg.face);
      card.hidden = false; redraw();
    }
    function showFree(ci) {
      const c = freeCells[ci], r = c.run, rc = c.rect, bay = r.seg.bay;
      closeDrawer(true);
      shown = { kind: 'free', ref: ci }; selected = null;
      hl.position.set((rc.x0 + rc.x1) / 2, c.z0 + c.h / 2, (rc.y0 + rc.y1) / 2);
      hl.scale.set(rc.x1 - rc.x0 + 0.03, c.h + 0.04, rc.y1 - rc.y0 + 0.03);
      hl.material.opacity = 0.35; hl.visible = true;
      const loc = r.kind === 'shelf' ? r.loc : r.key + '-' + pad2(c.pos);
      $('cardTitle').textContent = loc;
      $('cardSub').textContent = r.kind === 'shelf' ? 'Free: nothing nailed on this whole shelf' : 'Free: nothing nailed here';
      const lines = [];
      if (r.kind === 'shelf') lines.push({ text: 'No product in the list is on shelf ' + r.shelf + ' of ' + r.area + '-' + pad2(r.bay) + ', but there is stock on a shelf above it. Check the shelf is there.' });
      else {
        lines.push({ text: runNote(r) + (r.n > 1 ? ' (' + runTitle(r) + ')' : ''), cls: 'free' });
        const before = itemAt.get(r.key + '-' + pad2(c.pos - 1)), after = itemAt.get(r.key + '-' + pad2(c.pos + 1));
        if (r.prev) lines.push({ text: 'Before it: ' + pad2(r.from - 1) + ' ' + r.prev.code + ' ' + r.prev.name, code: r.prev.code, more: true });
        if (r.next) lines.push({ text: 'After it: ' + pad2(r.to + 1) + ' ' + r.next.code + ' ' + r.next.name, code: r.next.code, more: true });
        if (!before && !after && !r.prev && !r.next) lines.push({ text: 'Shelf ' + r.shelf + ', position ' + c.pos, more: true });
      }
      cardLines(lines, true);
      cardPhoto(null);
      $('cardNote').textContent = 'Free means nothing in your list is nailed here. On ordinary shelves only gaps between products count: the list doesn\'t say how many labels a shelf has after its last product.';
      cardButtons([[lookHere(), () => standAt(r.seg, rc, c.z0 + c.h / 2)], ['Copy location', () => copy(loc), true, true]]);
      setPin(loc, (rc.x0 + rc.x1) / 2, (rc.y0 + rc.y1) / 2, c.z0 + c.h + 0.04, true);
      showShelfTags(bay, r.seg.face);
      card.hidden = false; redraw();
    }
    function showNowhere(it) { // a product whose location has no bay on the plan
      closeCard();
      shown = { kind: 'nowhere', ref: it };
      const area = it.loc.slice(0, 3), ignored = leftOff(it.loc);
      const known = Object.keys(sidx.segs).some((k) => k.indexOf(area + '-') === 0); // other bays of this area are on the plan
      $('cardTitle').textContent = it.code;
      $('cardSub').textContent = it.name;
      cardLines(['Location ' + it.loc, it.qty + ' available', ignored ? (skipped.has(area) ? area : it.loc.slice(0, 6)) + ' is left off the plan (your say).'
        : "I don't know where " + (known ? area + ' bay ' + +it.loc.slice(4, 6) : area) + ' is in the store yet. Tell Claude and it will go on the plan.']);
      cardPhoto(it.code);
      $('cardNote').textContent = '';
      cardButtons([['Copy location', () => copy(it.loc)], ['Product Search', () => window.open('product-search.html#q=' + encodeURIComponent(it.code), '_blank'), true, true]]);
      card.hidden = false; redraw();
    }
    function refreshCard() {
      if (!shown) return;
      if (shown.kind === 'bay') showBay(shown.ref); else if (shown.kind === 'drawer') showDrawer(shown.ref, shown.at); else if (shown.kind === 'free') showFree(shown.ref);
      else if (shown.kind === 'nowhere') showNowhere(shown.ref); else showProduct(shown.ref);
    }
    function goTo(it) {
      const pl = it.pl;
      if (!pl) return;
      closeCard();
      if (pl.drawer) { const i = drawerAt.get(it.drawerKey), d = drawerList[i]; standAt(d.seg, d.rect, d.z0 + d.h / 2); showDrawer(i, it.loc); }
      else { const i = productOf.get(it); standAt(pl.seg, it.rect, it.z0 + it.h / 2); showProduct(i); }
    }
    function goToFree(r) {
      closeCard();
      if (!freeOn) setFree(true);
      if (r.kind === 'drawer') {
        const i = drawerOfPos(r.seg, r.shelf, r.from), d = drawerList[i];
        standAt(d.seg, d.rect, d.z0 + d.h / 2); showDrawer(i, r.key + '-' + pad2(r.from));
        return;
      }
      const ci = freeCellAt.get(r.kind === 'shelf' ? r.loc : r.key + '-' + pad2(r.from)), c = freeCells[ci];
      standAt(r.seg, c.rect, c.z0 + c.h / 2); showFree(ci);
    }

    // what a tap or click lands on: a drawer, a product, a free spot, or else the bay
    function pickAt(cx, cy, centre) {
      const r = canvas.getBoundingClientRect();
      if (centre) ndc.set(0, 0); else ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, cam());
      const objs = [];
      if (drawerMesh) objs.push(drawerMesh);
      if (productMesh) objs.push(productMesh);
      if (freeMesh && freeOn) objs.push(freeMesh);
      if (tray) objs.push(tray);
      if (objs.length) {
        for (const hit of ray.intersectObjects(objs, true)) {
          if (hit.object === drawerMesh) return { kind: 'drawer', i: hit.instanceId };
          if (hit.object === productMesh) return { kind: 'product', i: hit.instanceId };
          if (hit.object === freeMesh) return { kind: 'free', i: hit.instanceId };
          let o = hit.object;
          while (o && o.userData.drawer === undefined) o = o.parent;
          if (o) return { kind: 'drawer', i: o.userData.drawer };
        }
      }
      const b = bayAt(cx, cy, centre);
      return b ? { kind: 'bay', b } : null;
    }
    function tapAt(cx, cy, centre) {
      const k = pickAt(cx, cy, centre);
      if (!k) { if (shown) closeCard(); return; }
      if (k.kind === 'drawer') showDrawer(k.i); else if (k.kind === 'product') showProduct(k.i); else if (k.kind === 'free') showFree(k.i); else showBay(k.b);
    }

    /* ---------- the Stock panel: load the report, find a product, list the free spots ---------- */
    const sheet = $('sheet');
    let pasting = false, adding = false, stockCut = false, tab = 'find'; // adding: the next paste is added to the list instead of replacing it
    const locQuery = FS.locQuery;
    const skipped = new Set((LOCS && LOCS.ignore) || []); // areas (HAD) or bays (LAC-05) left off the plan, detailedfoil's say
    const leftOff = (loc) => skipped.has(loc.slice(0, 3)) || skipped.has(loc.slice(0, 6));
    function sheetState() {
      const have = !!stock && !pasting;
      $('sheetPaste').hidden = have; $('sheetFind').hidden = !have;
      if (!stock) return;
      const left = {};
      for (const it of stock.all) if (!it.pl && !leftOff(it.loc)) left[it.loc.slice(0, 3)] = (left[it.loc.slice(0, 3)] || 0) + 1;
      const un = Object.keys(left).sort((a, b) => left[b] - left[a]);
      let info = nf(stock.items.length) + ' products are on the shelves.';
      if (un.length) info += ' ' + un.reduce((n, a) => n + left[a], 0) + ' more have a location I have no bay for: ' + un.map((a) => a + ' (' + left[a] + ')').join(', ') + '.';
      if (stock.cut) info += ' It looks cut off part way through a row (copy and paste have size limits), so there are more products than this. Press Add more and paste the rest, or upload the report as a file.';
      $('stockInfo').textContent = info;
      setTab(tab);
    }
    function setTab(t) {
      tab = t;
      for (const [id, pane, name] of [['tabFind', 'paneFind', 'find'], ['tabFree', 'paneFree', 'free']]) { $(id).setAttribute('aria-selected', String(t === name)); $(pane).hidden = t !== name; }
      if (t === 'free') runFree(); else runFind();
    }
    $('tabFind').addEventListener('click', () => { setTab('find'); $('findBox').focus(); });
    $('tabFree').addEventListener('click', () => setTab('free'));
    function listButton(main, sub, code, onClick, cls) {
      const li = document.createElement('li'), b = document.createElement('button'), txt = document.createElement('span');
      b.type = 'button'; txt.className = 'txt';
      const t = document.createElement('b'); t.textContent = main;
      const s = document.createElement('small'); s.textContent = sub;
      txt.append(t, document.createElement('br'), s);
      if (code !== undefined) b.appendChild(code ? thumb(code) : Object.assign(document.createElement('span'), { className: 'fp-thumb none' }));
      b.appendChild(txt);
      if (cls) li.className = cls;
      b.addEventListener('click', onClick);
      li.appendChild(b);
      return li;
    }
    function count(id, text) { $(id).textContent = text; $(id).hidden = !text; }
    function runFind() {
      const q = $('findBox').value.trim(), list = $('findList');
      list.innerHTML = ''; count('findCount', '');
      if (!stock || q.length < 2) return;
      const qc = q.toUpperCase().replace(/O/g, '0'), words = q.toLowerCase().split(/\s+/).filter(Boolean), lq = locQuery(q);
      const out = [], seen = new Set(), MAX = lq ? 600 : 200; // a whole bay can hold nearly 500
      const add = (it) => { if (!seen.has(it)) { seen.add(it); out.push(it); } };
      // codes, then locations, then names; each time the ones on the plan first, then any with no bay on the plan yet
      const each = (list, ok) => { for (const it of list) if (ok(it)) add(it); for (const it of stock.all) if (!it.pl && ok(it)) add(it); };
      if (/^[0-9][0-9A-Z]{0,4}$/.test(qc)) each(stock.items, (it) => it.code.indexOf(qc) === 0);
      if (lq) each(byLoc, (it) => lq.some((p) => it.loc.indexOf(p) === 0));
      each(stock.items, (it) => words.every((w) => it.name.toLowerCase().indexOf(w) >= 0));
      for (const it of out.slice(0, MAX)) {
        if (it.pl) list.appendChild(listButton(it.code + ' ' + it.name, it.loc + ', ' + it.qty + ' available', it.code, () => { sheet.hidden = true; goTo(it); }));
        else list.appendChild(listButton(it.code + ' ' + it.name, it.loc + ', ' + it.qty + ' available (' + (leftOff(it.loc) ? 'left off the plan' : 'no bay for ' + it.loc.slice(0, 3) + ' on the plan') + ')', it.code, () => { sheet.hidden = true; showNowhere(it); }));
      }
      if (!out.length) { const li = document.createElement('li'); li.className = 'none'; li.textContent = 'Nothing found'; list.appendChild(li); }
      else count('findCount', out.length > MAX ? nf(out.length) + ' found: the first ' + MAX + ' are here, type more to narrow it down' : out.length === 1 ? '1 found' : nf(out.length) + ' found');
    }
    function runFree() {
      const list = $('freeList'), chips = $('freeAreas');
      list.innerHTML = ''; chips.innerHTML = ''; count('freeCount', '');
      if (!stock || !free) return;
      $('freeShow').checked = freeOn;
      $('freeInfo').textContent = nf(free.positions) + ' free positions' + (free.shelves ? ' and ' + free.shelves + ' empty shelves' : '') + ' with nothing nailed to them.';
      const q = $('freeBox').value.trim(), lq = q ? locQuery(q) : null;
      for (const a of Object.keys(free.byArea).sort()) {
        const o = free.byArea[a], b = document.createElement('button');
        b.type = 'button'; b.textContent = a + ' ' + nf(o.positions) + (o.shelves ? ' + ' + o.shelves + (o.shelves > 1 ? ' shelves' : ' shelf') : '');
        if (lq && lq.length === 1 && lq[0] === a) b.className = 'on';
        b.addEventListener('click', () => { $('freeBox').value = b.className === 'on' ? '' : a; runFree(); });
        chips.appendChild(b);
      }
      if (q && !lq) { const li = document.createElement('li'); li.className = 'none'; li.textContent = 'Type an area, bay or shelf, like AAC, AAC-03 or AAC-03-12'; list.appendChild(li); return; }
      const match = (r) => !lq || lq.some((p) => {
        const parts = p.split('-');
        if (parts.length === 4) { const pos = +parts[3]; return r.key === parts.slice(0, 3).join('-') && (r.kind === 'shelf' || (pos >= r.from && pos <= r.to)); }
        return r.key.indexOf(p) === 0;
      });
      let runs = free.runs.filter(match);
      if ($('freeSort').value === 'big') runs = runs.slice().sort((a, b) => (b.kind === 'shelf') - (a.kind === 'shelf') || b.n - a.n);
      const MAX = 150;
      for (const r of runs.slice(0, MAX)) list.appendChild(listButton(runTitle(r), runNote(r), undefined, () => { sheet.hidden = true; goToFree(r); }, 'free'));
      const n = runs.reduce((s, r) => s + r.n, 0), sh = runs.filter((r) => r.kind === 'shelf').length;
      if (!runs.length) {
        const li = document.createElement('li'), it = lq && lq.length === 1 ? itemAt.get(lq[0]) : null;
        li.className = 'none'; li.textContent = it ? lq[0] + ' is not free: ' + it.code + ' ' + it.name + ' is nailed there' : 'No free spots there';
        list.appendChild(li);
      }
      else count('freeCount', (lq ? lq.join(', ') + ': ' : '') + nf(n) + ' free' + (sh ? ' and ' + sh + (sh > 1 ? ' empty shelves' : ' empty shelf') : '') + (runs.length > MAX ? '. The first ' + MAX + ' are here: pick an area or type a bay to see the rest' : ''));
    }
    function setSheet(open, which, query) {
      if (open && locked()) document.exitPointerLock();
      sheet.hidden = !open;
      if (!open) return;
      if (which === 'find') { tab = 'find'; $('findBox').value = query || ''; }
      if (which === 'free') { tab = 'free'; $('freeBox').value = query || ''; }
      sheetState();
      if (stock && !pasting && tab === 'find' && matchMedia('(any-hover: hover)').matches) $('findBox').focus();
    }
    $('stockBtn').hidden = !sidx;
    $('stockBtn').addEventListener('click', () => setSheet(sheet.hidden));
    $('sheetClose').addEventListener('click', () => setSheet(false));
    $('findBox').addEventListener('input', runFind);
    $('findBox').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = $('findList').querySelector('button'); if (b) b.click(); } });
    $('freeBox').addEventListener('input', runFree);
    $('freeSort').addEventListener('change', runFree);
    // a paste or an uploaded file: the same report either way
    function submitStock(raw) {
      const msg = $('stockMsg');
      let r = FS.parse(raw);
      if (!r) { msg.textContent = "I couldn't find any products with a location in that. Check it is the SKU List report with the Nailed Location column."; msg.hidden = false; return false; }
      msg.hidden = true; $('stockText').value = '';
      stockCut = !!r.cut; // stops part way through a row
      if (adding && stock) {
        const seen = new Set(stock.all.map((x) => x.code + x.loc));
        r = { items: stock.all.concat(r.items.filter((x) => !seen.has(x.code + x.loc))) };
        stockCut = stockCut || stock.cut;
      }
      if (!FS.storage.save(r)) flash("This device wouldn't keep the list, so you'll need to load it again next time.");
      pasting = false; adding = false;
      applyStock(r.items); $('findBox').value = ''; $('freeBox').value = ''; tab = 'find'; sheetState();
      if (!sheet.hidden && !$('sheetFind').hidden && matchMedia('(any-hover: hover)').matches) $('findBox').focus();
      return true;
    }
    $('stockGo').addEventListener('click', () => submitStock($('stockText').value));
    function readFile(file) {
      if (!file) return;
      const msg = $('stockMsg');
      msg.textContent = 'Reading ' + file.name + '...'; msg.hidden = false;
      const rd = new FileReader();
      rd.onload = () => { msg.hidden = true; if (!submitStock(String(rd.result || ''))) { pasting = true; sheetState(); } };
      rd.onerror = () => { msg.textContent = "I couldn't read that file."; msg.hidden = false; };
      rd.readAsText(file);
    }
    $('stockFile').addEventListener('change', (e) => { readFile(e.target.files && e.target.files[0]); e.target.value = ''; });
    sheet.addEventListener('dragover', (e) => { e.preventDefault(); });
    sheet.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) readFile(e.dataTransfer.files[0]); });
    $('stockAdd').addEventListener('click', () => { pasting = true; adding = true; sheetState(); $('stockText').focus(); });
    $('stockNew').addEventListener('click', () => { pasting = true; adding = false; sheetState(); $('stockText').focus(); });
    $('stockClear').addEventListener('click', () => {
      FS.storage.clear(); stock = null; pasting = false; closeCard(); clearProducts(); setFree(false); $('freeBtn').hidden = true;
      shelfCells.clear(); buildLabels();
      sheetState(); $('findList').innerHTML = ''; redraw();
    });
    if (navigator.clipboard && navigator.clipboard.readText) {
      $('stockClip').hidden = false;
      $('stockClip').addEventListener('click', () => { navigator.clipboard.readText().then((t) => { $('stockText').value = t; }).catch(() => { $('stockMsg').textContent = "The browser wouldn't let me read the clipboard. Paste into the box with Ctrl+V."; $('stockMsg').hidden = false; }); });
    }


    /* ---------- mouse look (PC) ---------- */
    const hasMouse = matchMedia('(any-hover: hover)').matches && matchMedia('(any-pointer: fine)').matches;
    let mouseLook = hasMouse;
    try { if (localStorage.getItem('fp-mouselook-v1') === '0') mouseLook = false; } catch (e) { /* private mode */ }
    const mouseBtn = $('mouseBtn'), cross = $('cross');
    const locked = () => document.pointerLockElement === canvas;
    function lockMouse() { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (x) { /* not allowed */ } }
    function setMouseLook(on) {
      mouseLook = on; mouseBtn.setAttribute('aria-pressed', String(on));
      try { localStorage.setItem('fp-mouselook-v1', on ? '1' : '0'); } catch (e) { /* private mode */ }
      if (!on && locked()) document.exitPointerLock();
      if (on && mode === 'walk') flash(MOUSE_HINT);
    }
    const MOUSE_HINT = 'Click the view to look round with the mouse (Esc lets go). WASD to walk, Shift to run.';
    mouseBtn.hidden = !hasMouse;
    mouseBtn.setAttribute('aria-pressed', String(mouseLook));
    mouseBtn.addEventListener('click', () => setMouseLook(!mouseLook));
    document.addEventListener('pointerlockchange', () => { cross.hidden = !locked(); redraw(); if (locked()) flash('Mouse captured: move it to look, click to pick. Esc lets go.'); });
    document.addEventListener('mousemove', (e) => {
      if (!locked() || Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return; // some browsers send one huge jump as the mouse is captured
      walk.yaw -= e.movementX * 0.0022; walk.pitch -= e.movementY * 0.0022;
      applyWalk(); redraw();
    });

    /* ---------- views ---------- */
    const hint = $('hint');
    let hintTimer = 0;
    const seenHint = {};
    function flash(text) {
      clearTimeout(hintTimer);
      hint.textContent = text; hint.hidden = false; hint.classList.remove('fade');
      hintTimer = setTimeout(() => { hint.classList.add('fade'); hintTimer = setTimeout(() => (hint.hidden = true), 450); }, 3600);
    }
    const HINTS = matchMedia('(any-pointer: coarse)').matches
      ? { orbit: 'Drag to turn, pinch to zoom, two fingers to move. Tap a bay for its name.', plan: 'Drag to move, pinch to zoom. Tap a bay for its name.', walk: 'Use the stick to walk and drag to look round. Tap the map to jump.' }
      : { orbit: 'Drag to turn, scroll to zoom, right-drag to move. Click a bay for its name.', plan: 'Drag to move, scroll to zoom. Click a bay for its name.', walk: 'WASD or arrow keys to walk, drag to look round. Click the map to jump.' };
    function setMode(m) {
      mode = m;
      for (const btn of document.querySelectorAll('.fp-modes button')) { const on = btn.dataset.mode === m; btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', String(on)); }
      const walking = m === 'walk';
      groups.cut.visible = !walking; groups.full.visible = walking; groups.walk.visible = walking;
      shelfTags.visible = m !== 'plan'; // seen from above they'd sit in a pile
      stage.classList.toggle('walking', walking);
      // in Walk the row letters hang above head height and smaller, like aisle signs
      for (const r of rowSigns) { r.sprite.scale.copy(r.scale).multiplyScalar(walking ? 0.55 : 1); r.sprite.position.y = walking ? Math.max(r.z, 3.35) : r.z; }
      stick.hidden = !walking || !matchMedia('(any-pointer: coarse)').matches;
      mini.hidden = !walking;
      if (walking) { sizeMini(); [walk.x, walk.y] = nearestFree(walk.x, walk.y); applyWalk(); canvas.focus({ preventScroll: true }); }
      if (!walking && locked()) document.exitPointerLock();
      if (!card.hidden) refreshCard();
      if (!seenHint[m]) { seenHint[m] = 1; flash(walking && hasMouse && mouseLook ? MOUSE_HINT : HINTS[m]); }
      redraw();
    }
    for (const btn of document.querySelectorAll('.fp-modes button')) btn.addEventListener('click', () => setMode(btn.dataset.mode));
    $('resetBtn').addEventListener('click', () => {
      if (mode === 'orbit') { fitOrbit(); applyOrbit(); }
      else if (mode === 'plan') { fitTop(); applyTop(); }
      else { walk.x = L.start.x; walk.y = L.start.y; walk.yaw = FACING[L.start.facing] || 0; walk.pitch = -0.06; eye.fov = 70; resize(); }
      redraw();
    });
    const namesBtn = $('namesBtn');
    function setNames(on) {
      groups.names.visible = on; namesBtn.setAttribute('aria-pressed', String(on));
      try { localStorage.setItem('fp-names-v1', on ? '1' : '0'); } catch (e) { /* private mode */ }
      redraw();
    }
    namesBtn.addEventListener('click', () => setNames(!groups.names.visible));
    let namesOn = false;
    try { namesOn = localStorage.getItem('fp-names-v1') === '1'; } catch (e) { /* private mode */ }
    setNames(namesOn);

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); say('The 3D view stopped (the phone needed the memory back). Reload the page to carry on.'); });

    /* ---------- go ---------- */
    // A slow phone (frames over 34 ms while you keep moving) draws fewer pixels: down from 2 per screen pixel to 1.
    let ratio = Math.min(window.devicePixelRatio || 1, 2), slowRun = 0, lastShown = 0;
    let frames = 0;
    function frame(now) {
      scheduled = false; frames++;
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now; // time-based, so slow phones walk at the same speed
      let busy = false;
      if (mode === 'walk' && (keys.size || walk.fwd || walk.side)) { busy = true; if (stepWalk(dt)) dirty = true; }
      if (slide) {
        const k = Math.min(1, Math.max(0, (performance.now() - slide.t0) / slide.dur)), e = 1 - Math.pow(1 - k, 3);
        trayV = slide.from + (slide.to - slide.from) * e;
        if (tray) moveTray();
        dirty = true; busy = true;
        if (k >= 1) { const closing = slide.closing; slide = null; if (closing) removeTray(); }
      }
      if (photoInbox.length) flushPhotos();
      if (dirty) { // photos and labels follow the camera: at most every 0.3 s while it moves, and once more when it stops
        const c = cam(), q = c.quaternion, p = c.position;
        const sig = mode + ((p.x * 40) | 0) + ',' + ((p.y * 40) | 0) + ',' + ((p.z * 40) | 0) + ',' + ((q.x * 300) | 0) + ',' + ((q.y * 300) | 0) + ',' + ((q.z * 300) | 0) + ',' + (orbit.r | 0);
        if (sig !== photoSig) { photoSig = sig; if (!photoDue) photoDue = now + 300; }
      }
      if (photoDue && now >= photoDue) { photoDue = 0; updatePhotos(); }
      if (photoDue) busy = true;
      if (dirty) {
        dirty = false;
        if (busy && lastShown && now - lastShown < 250) {
          slowRun = now - lastShown > 34 ? slowRun + 1 : Math.max(0, slowRun - 2);
          if (slowRun > 45 && ratio > 1) { ratio = Math.max(1, ratio - 0.5); slowRun = 0; renderer.setPixelRatio(ratio); resize(); }
        }
        lastShown = now;
        sizePin();
        if (labelMesh) { labelMesh.visible = labelsWanted(); labelMat.uniforms.uFar.value = mode === 'walk' ? 6 : Math.max(2.5, orbit.r * 0.55); }
        renderer.render(scene, cam());
        if (mode === 'walk') drawMini();
      }
      if (busy || dirty) wake();
    }
    // Everything that would otherwise be made the first time you need it is made here, behind the loading bar
    // (detailedfoil, 30 Oct 2026: "when the site opens there is a loading bar and it pre loads stuff").
    async function warmUp() {
      // every shader the three views use, and the ones for a pin and for photos in an open drawer, compiled now
      const seen = new Map(), extra = [new T.Mesh(photoGeo, new T.MeshLambertMaterial({ map: photoTex })), pinSprite('0', '#fff')];
      for (const k in groups) { seen.set(groups[k], groups[k].visible); groups[k].visible = true; }
      for (const o of [hl, freeMesh, labelMesh]) if (o) { seen.set(o, o.visible); o.visible = true; }
      for (const o of extra) scene.add(o);
      try { if (renderer.compileAsync && renderer.extensions.has('KHR_parallel_shader_compile')) await renderer.compileAsync(scene, eye); else renderer.compile(scene, eye); } catch (e) { /* compiled when first used instead */ }
      for (const o of extra) { scene.remove(o); if (o.material.map && o.isSprite) o.material.map.dispose(); o.material.dispose(); }
      for (const [o, v] of seen) o.visible = v;
      // and one frame from where the walk starts (under the loading screen), so its buffers are on the graphics chip
      const was = mode;
      mode = 'walk'; groups.cut.visible = false; groups.full.visible = groups.walk.visible = true; if (labelMesh) labelMesh.visible = true;
      applyWalk(); renderer.render(scene, eye);
      mode = was;
    }
    new ResizeObserver(resize).observe(stage);
    resize();
    renderer.shadowMap.needsUpdate = true; // the one time the shadows are drawn (cut walls showing)
    progress(0.45, 'Putting your stock on the shelves\u2026'); await breathe();
    if (sidx) { const saved = FS.storage.load(); if (saved) applyStock(saved.items); }
    progress(0.6, 'Making the location labels\u2026'); await breathe();
    buildLabels();
    progress(0.75, 'Getting the graphics ready\u2026'); await breathe();
    await warmUp();
    progress(1, 'Ready'); await breathe();
    say('');
    $('side').hidden = false; $('bar').hidden = false;
    setMode('orbit');
    try { if (stock && localStorage.getItem('fp-free-v1') === '1') { seenHint.free = 1; setFree(true); } } catch (e) { /* private mode */ }
    loading.classList.add('done'); setTimeout(() => { loading.hidden = true; }, 400);
    redraw();
    // for testing in a browser console: FloorPlan.bays, FloorPlan.setMode('walk')
    window.FloorPlan = { bays, setMode, showBay, showDrawer, showProduct, showFree, goTo, goToFree, applyStock, walkTo, setFree, scene, renderer, get mode() { return mode; }, get stock() { return stock; }, get drawers() { return drawerList; }, get products() { return products; }, get tray() { return tray; }, get free() { return free; }, get freeCells() { return freeCells; }, get photoMesh() { return photoMesh; }, get labelMesh() { return labelMesh; }, get photos() { return photos; }, get ratio() { return ratio; }, get frames() { return frames; }, get scheduled() { return scheduled; }, get camera() { return cam(); }, walk, orbit, top, tapAt, setSheet };
  }
})();
