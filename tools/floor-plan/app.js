/* 3D Floor Plan (Dunstable, LB1 only). Builds the store from floor-plan/data/layout.json with three.js, which is
   floor-plan/three/three.min.js: a plain script that sets the global THREE (how it was made is noted at its top).

   Plan coordinates are metres: x runs across from the inside of the left wall, y from the inside of the back wall
   towards the shop front, z is height. three.js has y up, so a plan point (x, y, z) is the vector (x, z, y).

   Three views: 3D (turn round the store), Top (a flat plan) and Walk (first person: a stick on phones, WASD or the
   arrow keys on a PC). Tap a bay for its name. Names are temporary until the real location names come: row letter
   + bay number (left to right, or back to front for bays that run that way), plus b / f for the back / front side
   of a back-to-back row. */
(function () {
  'use strict';

  const STORE = 'LB1';
  const $ = (id) => document.getElementById(id);
  const stage = $('stage'), canvas = $('view'), msg = $('msg');

  function signedInAs() {
    try { return (localStorage.getItem('toolbox.signedIn.area20') || '').toUpperCase(); } catch (e) { return ''; }
  }
  function say(text) { msg.textContent = text; msg.hidden = !text; }

  let booted = false;
  function boot() {
    if (booted) return;
    const me = signedInAs();
    if (!me) return; // the sign-in screen is up; its "toolbox:login" event brings us back here
    booted = true;
    if (me !== STORE) { say('The 3D floor plan is only for Dunstable (LB1).'); return; }
    if (!window.THREE || !window.FloorBays) { say("The 3D viewer didn't load. Check your signal and reload the page."); return; }
    fetch('floor-plan/data/layout.json', { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((layout) => {
        try { start(layout); } catch (e) { console.error(e); say('Something went wrong drawing the store. Reload the page to try again.'); }
      })
      .catch((e) => { console.error(e); say("Couldn't load the store layout. Check your signal and reload the page."); });
  }
  window.addEventListener('toolbox:login', boot);
  boot();

  function start(L) {
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

    let dirty = true, last = performance.now(); // redraw only when something changed
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
        for (const z of [0.9, 1.6]) box(M.meshDeck, x0, y0, z - 0.02, x1, y1, z);
        return;
      }
      if (b.kind === 'cabinet') {
        const x0 = b.x0 + 0.03, x1 = b.x1 - 0.03, y0 = b.y0 + 0.02, y1 = b.y1 - 0.02;
        box(M.cabinet, x0, y0, 0.05, x1, y1, h);
        box(M.black, x0 + 0.02, y0 + 0.02, 0, x1 - 0.02, y1 - 0.02, 0.05);
        const fy = b.open.indexOf('N') >= 0 ? y0 - 0.006 : y1 + 0.006;
        box(M.black, (x0 + x1) / 2 - 0.006, fy - 0.004, 0.1, (x0 + x1) / 2 + 0.006, fy + 0.004, h - 0.05);
        const sign = label('FLAMMABLE', { size: 0.12, bg: 'rgba(36,39,44,.95)', fg: '#f2c400', weight: 800 });
        sign.position.copy(V((x0 + x1) / 2, fy + (b.open.indexOf('N') >= 0 ? -0.01 : 0.01), h * 0.72));
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
        for (let k = 0; k < n; k++) level(0.12 + k * (h - 0.2) / (n - 1), M.deck);
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
    for (const b of window.FloorBays.list(L)) {
      b.box = new T.Box3(new T.Vector3(b.x0, 0, b.y0), new T.Vector3(b.x1, b.h, b.y1));
      bays.push(b);
      drawBay(b);
      const tag = label(b.id, { size: 0.3, bg: 'rgba(255,210,0,.97)', fg: '#14171f', weight: 800 });
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
      if (r.along === 'x' && r.n > 2 && r.x1 <= AISLE_X0 + 0.2) { x = r.x1 + 0.3; z = 2.95; }
      else if (r.along === 'x' && r.n > 2 && r.x0 >= AISLE_X1 - 0.2) { x = r.x0 - 0.3; z = 2.95; }
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
      dirty = true;
    }

    /* ---------- picking a bay ---------- */
    const ray = new T.Raycaster(), ndc = new T.Vector2(), hitAt = new T.Vector3();
    const hl = new T.Mesh(unitBox, new T.MeshBasicMaterial({ color: 0xffd200, transparent: true, opacity: 0.32, depthWrite: false }));
    hl.add(new T.LineSegments(new T.EdgesGeometry(unitBox), new T.LineBasicMaterial({ color: 0xff9f00 })));
    hl.visible = false; hl.renderOrder = 4; scene.add(hl);
    let selected = null;
    function bayAt(clientX, clientY) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, cam());
      let best = null, bestD = Infinity;
      for (const b of bays) {
        if (ray.ray.intersectBox(b.box, hitAt)) { const d = hitAt.distanceToSquared(ray.ray.origin); if (d < bestD) { bestD = d; best = b; } }
      }
      return best;
    }

    const card = $('card');
    const ROWNAME = { W: 'Back wall run', P: 'Pallet rack', L: 'Longs bay', V: 'VPU cage' };
    const FACES = { N: 'Faces the back wall', S: 'Faces the shop front', NS: 'Open on both sides', EW: 'Open on both sides', E: 'Faces the right-hand wall', W: 'Faces the left-hand wall' };
    const m2 = (n) => (Math.round(n * 100) / 100).toFixed(2) + ' m';
    function what(b) {
      if (b.kind === 'cage') return 'Mesh cage';
      if (b.kind === 'cabinet') return 'Flammables cabinet';
      if (b.kind === 'pallet') return 'Pallet racking, ' + (Math.max(2, b.levels) - 1) + ' beam levels';
      if (b.kind === 'bulk') return 'Floor space with one shelf on top';
      return 'Shelving, ' + b.levels + ' shelves';
    }
    function showBay(b) {
      selected = b;
      const w = b.x1 - b.x0, d = b.y1 - b.y0;
      hl.position.set((b.x0 + b.x1) / 2, b.h / 2, (b.y0 + b.y1) / 2);
      hl.scale.set(w + 0.05, b.h + 0.05, d + 0.05);
      hl.visible = true;
      hl.material.opacity = mode === 'walk' ? 0.12 : 0.32;
      $('cardTitle').textContent = b.id;
      const sideTxt = b.side === 'b' ? ', back side' : b.side === 'f' ? ', front side' : '';
      $('cardSub').textContent = ROWNAME[b.row] ? ROWNAME[b.row] + ' ' + b.num : 'Row ' + b.row + ', bay ' + b.num + sideTxt;
      const wide = b.along === 'x' ? w : d, deep = b.along === 'x' ? d : w;
      const items = [what(b), m2(wide) + ' wide, ' + m2(deep) + ' deep, about ' + m2(b.h) + ' high', FACES[b.open] || ''];
      if (b.braced) items.push('Drawn with a cross (X) on the plan');
      if (b.plan) items.push('Label on the electrical plan: ' + b.plan);
      $('cardList').innerHTML = '';
      for (const t of items) if (t) { const li = document.createElement('li'); li.textContent = t; $('cardList').appendChild(li); }
      $('cardNote').textContent = 'Temporary name. Send Claude your location names and they will replace these.';
      const btns = $('cardBtns'); btns.innerHTML = '';
      const go = document.createElement('button'); go.type = 'button'; go.textContent = mode === 'walk' ? 'Stand in front of it' : 'Walk here';
      go.addEventListener('click', () => walkTo(b));
      btns.appendChild(go);
      card.hidden = false;
      dirty = true;
    }
    function closeCard() { selected = null; hl.visible = false; card.hidden = true; dirty = true; }
    $('cardClose').addEventListener('click', closeCard);
    function showHelp() {
      selected = null; hl.visible = false;
      $('cardTitle').textContent = 'How to use it';
      $('cardSub').textContent = 'Dunstable, from the fire plan and electrical layout';
      $('cardList').innerHTML = '';
      const touch = matchMedia('(any-pointer: coarse)').matches;
      const items = touch ? [
        '3D: drag to turn, pinch to zoom, two fingers to move.',
        'Top: drag to move, pinch to zoom.',
        'Walk: the stick walks, drag anywhere else to look round. Tap the little map to jump there.',
        'Tap any bay to see its name.',
      ] : [
        '3D: drag to turn, scroll to zoom, right-drag (or Shift + drag) to move.',
        'Top: drag to move, scroll to zoom.',
        'Walk: WASD or the arrow keys walk, drag to look round, hold Shift to go faster. Click the little map to jump there.',
        'Click any bay to see its name.',
      ];
      for (const t of items) { const li = document.createElement('li'); li.textContent = t; $('cardList').appendChild(li); }
      $('cardNote').textContent = 'Sizes come from the plans, so expect them to be out by up to about 30 cm. Heights and shelf counts are typical ones until the real ones are measured.';
      $('cardBtns').innerHTML = '';
      card.hidden = false; dirty = true;
    }
    $('helpBtn').addEventListener('click', () => (card.hidden || selected ? showHelp() : closeCard()));

    function walkTo(b) {
      // stand in the aisle in front of the bay, a step or two along towards the middle aisle, looking at it
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, gap = 0.45, along = 1.4;
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
      walk.pitch = -0.08;
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
      dirty = true;
    }
    canvas.addEventListener('pointerdown', (e) => {
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
        pinch = now; dirty = true;
      }
    });
    function pointerEnd(e) {
      const p = ptrs.get(e.pointerId);
      if (!p) return;
      ptrs.delete(e.pointerId);
      if (e.type === 'pointerup' && tapId === e.pointerId && performance.now() - p.t < 600) {
        const b = bayAt(e.clientX, e.clientY);
        if (b) showBay(b); else if (selected) closeCard();
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
      dirty = true;
    }, { passive: false });

    const keys = new Set();
    const KEYMAP = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', KeyD: 'r', ArrowLeft: 'tl', ArrowRight: 'tr', KeyQ: 'tl', KeyE: 'tr' };
    window.addEventListener('keydown', (e) => {
      if (mode !== 'walk' || e.altKey || e.ctrlKey || e.metaKey) return;
      if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); e.preventDefault(); }
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
      for (const b of bays) R(b, b.kind === 'cabinet' ? '#f2c400' : b.kind === 'cage' ? '#7d858f' : b.kind === 'pallet' ? '#e07020' : '#2d5ea8');
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
      applyWalk(); dirty = true;
      e.preventDefault();
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
      stage.classList.toggle('walking', walking);
      // in Walk the row letters hang above head height and smaller, like aisle signs
      for (const r of rowSigns) { r.sprite.scale.copy(r.scale).multiplyScalar(walking ? 0.55 : 1); r.sprite.position.y = walking ? Math.max(r.z, 3.35) : r.z; }
      stick.hidden = !walking || !matchMedia('(any-pointer: coarse)').matches;
      mini.hidden = !walking;
      if (walking) { sizeMini(); [walk.x, walk.y] = nearestFree(walk.x, walk.y); applyWalk(); canvas.focus({ preventScroll: true }); }
      if (!card.hidden && selected) showBay(selected);
      if (!seenHint[m]) { seenHint[m] = 1; flash(HINTS[m]); }
      dirty = true;
    }
    for (const btn of document.querySelectorAll('.fp-modes button')) btn.addEventListener('click', () => setMode(btn.dataset.mode));
    $('resetBtn').addEventListener('click', () => {
      if (mode === 'orbit') { fitOrbit(); applyOrbit(); }
      else if (mode === 'plan') { fitTop(); applyTop(); }
      else { walk.x = L.start.x; walk.y = L.start.y; walk.yaw = FACING[L.start.facing] || 0; walk.pitch = -0.06; eye.fov = 70; resize(); }
      dirty = true;
    });
    const namesBtn = $('namesBtn');
    function setNames(on) {
      groups.names.visible = on; namesBtn.setAttribute('aria-pressed', String(on));
      try { localStorage.setItem('fp-names-v1', on ? '1' : '0'); } catch (e) { /* private mode */ }
      dirty = true;
    }
    namesBtn.addEventListener('click', () => setNames(!groups.names.visible));
    let namesOn = false;
    try { namesOn = localStorage.getItem('fp-names-v1') === '1'; } catch (e) { /* private mode */ }
    setNames(namesOn);

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); say('The 3D view stopped (the phone needed the memory back). Reload the page to carry on.'); });

    /* ---------- go ---------- */
    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now; // time-based, so slow phones walk at the same speed
      if (mode === 'walk' && stepWalk(dt)) dirty = true;
      if (!dirty) return;
      dirty = false;
      renderer.render(scene, cam());
      if (mode === 'walk') drawMini();
    }
    new ResizeObserver(resize).observe(stage);
    resize();
    renderer.shadowMap.needsUpdate = true; // the one time the shadows are drawn (cut walls showing)
    say('');
    $('side').hidden = false; $('bar').hidden = false;
    setMode('orbit');
    requestAnimationFrame(frame);
    // for testing in a browser console: FloorPlan.bays, FloorPlan.setMode('walk')
    window.FloorPlan = { bays, setMode, showBay, walkTo, scene, renderer, get mode() { return mode; }, walk, orbit, top };
  }
})();
