/* Warehouse Shift: the 3D warehouse, drawn with three.js (the global THREE from floor-plan/three/three.min.js).

   Plan points (x across, y towards the front, z up: see world.js) become three.js vectors (x, z, y).
   Nothing floats (detailedfoil): every label is fixed to something, the location labels to the shelf edges and the
   tray fronts, the area names to the ends of the racking, the signs to walls. Products are boxes in their product's
   colour; the ones near you get the Toolbox's own saved photo (product-search/photos/CODE.jpg) on the front, loaded
   a dozen at a time into one big texture. Tray contents show when a tray slides out. Most things are drawn as a few
   InstancedMeshes, so the whole warehouse is a hundred or so draws. */
(function (root) {
  'use strict';

  function build(T, world, renderer, opts) {
    opts = opts || {};
    const V = (x, y, z) => new T.Vector3(x, z, y);
    const W = world.W, D = world.D, H = world.H, WT = world.WT, RH = world.RACK_H;
    const scene = new T.Scene();
    const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const SKY = 0xc3cad2;
    scene.background = new T.Color(SKY);
    scene.fog = new T.Fog(SKY, 16, 44);

    /* ---------- textures drawn on canvases (there are no image files) ---------- */
    let seed = 20261119;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
    function tex(w, h, draw, repeat) {
      const c = canvas(w, h); draw(c.getContext('2d'), w, h);
      const t = new T.CanvasTexture(c);
      t.colorSpace = T.SRGBColorSpace; t.anisotropy = maxAniso;
      if (repeat !== false) t.wrapS = t.wrapT = T.RepeatWrapping;
      return t;
    }
    function speckle(g, w, h, n, a) {
      for (let i = 0; i < n; i++) {
        const v = rnd() < 0.5 ? 0 : 255;
        g.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',' + (a * rnd()).toFixed(3) + ')';
        g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
      }
    }
    const rep = (t, rx, ry) => { const c = t.clone(); c.repeat.set(rx, ry); c.needsUpdate = true; return c; };
    // polished concrete, one tile = 4 m, with saw cuts every 4 m
    const TX_CONCRETE = tex(512, 512, (g, w, h) => {
      g.fillStyle = '#c4c6c8'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 40; i++) { // soft blotches
        const x = rnd() * w, y = rnd() * h, r = 30 + rnd() * 90, gr = g.createRadialGradient(x, y, 0, x, y, r);
        const v = rnd() < 0.5 ? '90,94,98' : '235,236,238';
        gr.addColorStop(0, 'rgba(' + v + ',0.10)'); gr.addColorStop(1, 'rgba(' + v + ',0)');
        g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
      speckle(g, w, h, 9000, 0.07);
      g.fillStyle = 'rgba(70,74,80,.28)'; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h);
    });
    // the shadows under and round the racking, baked into one texture over the whole floor
    const AO_PPM = 24;
    const TX_AO = (() => {
      const c = canvas(Math.ceil(W * AO_PPM), Math.ceil(D * AO_PPM)), g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      const soft = (r, pad, alpha) => {
        for (let k = 6; k >= 1; k--) {
          const p = pad * k / 6;
          g.fillStyle = 'rgba(0,0,0,' + (alpha / 6).toFixed(3) + ')';
          g.fillRect((r.x0 - p) * AO_PPM, (r.y0 - p) * AO_PPM, (r.x1 - r.x0 + 2 * p) * AO_PPM, (r.y1 - r.y0 + 2 * p) * AO_PPM);
        }
      };
      world.rows.forEach((r) => soft(r, 0.55, 0.55));
      world.walls.forEach((w2) => soft({ x0: w2[0], y0: w2[1], x1: w2[2], y1: w2[3] }, 0.25, 0.3));
      world.objects.forEach((o) => { if (/counter|gondola|cupboard|pallet|rollcage|worktop|holding/.test(o.kind)) soft(o, 0.3, 0.35); });
      // the edges of the building
      g.fillStyle = 'rgba(0,0,0,.18)';
      g.fillRect(0, 0, c.width, 6); g.fillRect(0, 0, 6, c.height); g.fillRect(c.width - 6, 0, 6, c.height); g.fillRect(0, c.height - 6, c.width, 6);
      const t = new T.CanvasTexture(c); t.colorSpace = T.NoColorSpace;
      return t;
    })();
    const TX_TILE = tex(256, 256, (g, w, h) => {
      g.fillStyle = '#d9dcdf'; g.fillRect(0, 0, w, h); speckle(g, w, h, 1600, 0.05);
      g.fillStyle = '#b6bbc2'; for (const p of [0, 128]) { g.fillRect(p, 0, 3, h); g.fillRect(0, p, w, 3); }
    });
    const vinyl = (base) => tex(128, 128, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); speckle(g, w, h, 900, 0.05); });
    // welded mesh: 64 px = 20 cm, a wire every 5 cm
    const TX_MESH = tex(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.fillStyle = '#8f98a3';
      for (let i = 0; i < 4; i++) { g.fillRect(i * 16, 0, 2, h); g.fillRect(0, i * 16, w, 2); }
    });
    const TX_SHUTTER = tex(16, 64, (g, w, h) => {
      for (let y = 0; y < h; y++) { const s = 150 + 50 * Math.sin((y / 8) * Math.PI); g.fillStyle = 'rgb(' + (s | 0) + ',' + ((s + 4) | 0) + ',' + ((s + 10) | 0) + ')'; g.fillRect(0, y, w, 1); }
    });
    const TX_HATCH = tex(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.strokeStyle = 'rgba(242,196,0,.9)'; g.lineWidth = 9;
      for (let i = -64; i <= 128; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke(); }
    });
    const TX_HAZARD = tex(64, 64, (g, w, h) => {
      g.fillStyle = '#f2c400'; g.fillRect(0, 0, w, h); g.strokeStyle = '#1c1d20'; g.lineWidth = 14;
      for (let i = -64; i <= 128; i += 40) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke(); }
    });
    // blockwork up to 2.4 m (one texture = 1.8 m wide, 3 courses), cladding panels above
    const TX_BLOCK = tex(256, 128, (g, w, h) => {
      g.fillStyle = '#d6d8d9'; g.fillRect(0, 0, w, h); speckle(g, w, h, 2400, 0.06);
      g.fillStyle = 'rgba(120,124,130,.45)';
      for (let r = 0; r < 3; r++) { g.fillRect(0, r * (h / 3), w, 2); const off = r % 2 ? w / 4 : 0; for (let x = off; x < w + 1; x += w / 2) g.fillRect(x, r * (h / 3), 2, h / 3); }
    });
    const TX_CLAD = tex(64, 256, (g, w, h) => {
      g.fillStyle = '#eef0f2'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 32) { g.fillStyle = 'rgba(150,156,164,.35)'; g.fillRect(0, y, w, 2); g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(0, y + 2, w, 2); }
    });
    const TX_ROOF = tex(64, 64, (g, w, h) => {
      g.fillStyle = '#dfe2e6'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 16) { g.fillStyle = 'rgba(120,126,134,.35)'; g.fillRect(x, 0, 3, h); g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(x + 3, 0, 2, h); }
    });
    // kraft card for the trays
    const TX_CARD = tex(64, 64, (g, w, h) => { g.fillStyle = '#c4a374'; g.fillRect(0, 0, w, h); speckle(g, w, h, 500, 0.08); });

    /* ---------- materials ---------- */
    const lam = (color, extra) => new T.MeshLambertMaterial(Object.assign({ color }, extra || {}));
    const M = {
      wallBlock: lam(0xffffff, { map: TX_BLOCK }), wallClad: lam(0xffffff, { map: TX_CLAD }), inner: lam(0xf1f2f4), column: lam(0x7f8893),
      upright: lam(0x2b5fae), beam: lam(0xb9bfc6), deck: lam(0xc9a87c), steel: lam(0xcfd4d9), lip: lam(0xaeb5bd), brace: lam(0x2b5fae),
      endPanel: lam(0x2b5fae), backPanel: lam(0xd3d8de), counter: lam(0x15396b), counterTop: lam(0xeef0f3), till: lam(0x23272e), screen: lam(0x0d1a33),
      gondola: lam(0xf3f4f6), gshelf: lam(0xd5dae0), plinth: lam(0x8f97a1), grey: lam(0xa3aab3), wood: lam(0xb88a5c), seat: lam(0x3a424e),
      white: lam(0xf8f9fa), chrome: lam(0xbac1c9), heater: lam(0x4f555e), door: lam(0x3f8f5a), frame: lam(0x3a3f47), black: lam(0x24272c),
      lamp: new T.MeshBasicMaterial({ color: 0xffffff }), lampBox: lam(0x9aa1aa), rafter: lam(0x7d8792), cable: lam(0x5d646d),
      glass: new T.MeshLambertMaterial({ color: 0x9fd0ee, transparent: true, opacity: 0.32, depthWrite: false, side: T.DoubleSide }),
      mesh: new T.MeshLambertMaterial({ map: TX_MESH, transparent: true, alphaTest: 0.4, side: T.DoubleSide }),
      hatch: new T.MeshBasicMaterial({ map: TX_HATCH, transparent: true, depthWrite: false }),
      hazard: lam(0xffffff, { map: TX_HAZARD }), yellow: lam(0xf2c400), pallet: lam(0xb08a57), wrap: new T.MeshLambertMaterial({ color: 0xeef3f8, transparent: true, opacity: 0.35, depthWrite: false }),
      roof: lam(0xffffff, { map: TX_ROOF, side: T.DoubleSide }), ceiling: lam(0xf2f3f5, { side: T.DoubleSide }), panelLight: new T.MeshBasicMaterial({ color: 0xfbfcff }),
      line: new T.MeshBasicMaterial({ color: 0xe8c300 }), lineWhite: new T.MeshBasicMaterial({ color: 0xf2f2f2 }),
      tote: lam(0x2e66b5), skin: lam(0xe0b394), hair: lam(0x3a2a20), boot: lam(0x2d2a26)
    };

    /* ---------- boxes, batched: one InstancedMesh per material and group ---------- */
    const groups = {};
    for (const g of ['main', 'walls', 'shop']) { groups[g] = new T.Group(); scene.add(groups[g]); }
    const unitBox = new T.BoxGeometry(1, 1, 1);
    const batches = new Map();
    const _p = new T.Vector3(), _s = new T.Vector3(), _q = new T.Quaternion(), _e = new T.Euler(), _m = new T.Matrix4();
    function addMatrix(mat, group, m) {
      const key = group + '|' + mat.uuid;
      let b = batches.get(key);
      if (!b) batches.set(key, (b = { mat, group, list: [] }));
      b.list.push(m);
    }
    function box(mat, x0, y0, z0, x1, y1, z1, group) {
      _p.set((x0 + x1) / 2, (z0 + z1) / 2, (y0 + y1) / 2);
      _s.set(Math.max(Math.abs(x1 - x0), 0.002), Math.max(Math.abs(z1 - z0), 0.002), Math.max(Math.abs(y1 - y0), 0.002));
      addMatrix(mat, group || 'main', new T.Matrix4().compose(_p, _q.identity(), _s));
    }
    function bar(mat, a, b, t, group) { // a thin bar between plan points a and b ([x, y, z])
      const A = V(a[0], a[1], a[2]), Bv = V(b[0], b[1], b[2]);
      const dir = Bv.clone().sub(A), len = dir.length();
      const q = new T.Quaternion().setFromUnitVectors(new T.Vector3(1, 0, 0), dir.normalize());
      addMatrix(mat, group || 'main', new T.Matrix4().compose(A.add(Bv).multiplyScalar(0.5), q, new T.Vector3(len, t, t)));
    }
    function flush() {
      for (const b of batches.values()) {
        const im = new T.InstancedMesh(unitBox, b.mat, b.list.length);
        b.list.forEach((m, i) => im.setMatrixAt(i, m));
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        groups[b.group].add(im);
      }
      batches.clear();
    }
    function texturedBox(mat, x0, y0, z0, x1, y1, z1, per, group) {
      const sx = x1 - x0, sy = z1 - z0, sz = y1 - y0, g = new T.BoxGeometry(sx, sy, sz), uv = g.attributes.uv;
      const faces = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
      for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * faces[f][0] / per, uv.getY(i) * faces[f][1] / per); }
      const m = new T.Mesh(g, mat); m.position.set((x0 + x1) / 2, (z0 + z1) / 2, (y0 + y1) / 2);
      groups[group || 'main'].add(m);
      return m;
    }
    function plane(mat, x0, y0, x1, y1, z, group, down) {
      const g = new T.PlaneGeometry(x1 - x0, y1 - y0); g.rotateX(down ? Math.PI / 2 : -Math.PI / 2);
      const m = new T.Mesh(g, mat); m.position.set((x0 + x1) / 2, z, (y0 + y1) / 2);
      groups[group || 'main'].add(m);
      return m;
    }
    // a flat sign facing out from a surface: `turn` 0 faces the shop front (+y), PI the back wall, PI/2 the right
    // wall (+x), -PI/2 the left wall
    function flat(texture, x, y, z, w, h, turn, group) {
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshLambertMaterial({ map: texture, transparent: false }));
      m.position.copy(V(x, y, z)); m.rotation.y = turn;
      groups[group || 'main'].add(m);
      return m;
    }
    const TURN = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 };

    /* ---------- signs: drawn on canvases, fixed flat to walls and racking ---------- */
    const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    function signTex(w, h, draw) {
      const c = canvas(w, h), g = c.getContext('2d'); draw(g, w, h);
      const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = maxAniso;
      return t;
    }
    function fit(g, text, weight, px, maxW) {
      let s = px;
      g.font = weight + ' ' + s + 'px ' + FONT;
      while (g.measureText(text).width > maxW && s > 8) { s -= 2; g.font = weight + ' ' + s + 'px ' + FONT; }
      return s;
    }
    function arrow(g, x, y, s, dir, fill) { // a chunky arrow pointing left (-1) or right (1)
      g.save(); g.translate(x, y); g.scale(dir, 1); g.fillStyle = fill;
      g.beginPath(); g.moveTo(s * 0.5, 0); g.lineTo(-s * 0.05, -s * 0.42); g.lineTo(-s * 0.05, -s * 0.16); g.lineTo(-s * 0.5, -s * 0.16);
      g.lineTo(-s * 0.5, s * 0.16); g.lineTo(-s * 0.05, s * 0.16); g.lineTo(-s * 0.05, s * 0.42); g.closePath(); g.fill(); g.restore();
    }
    // the end of a row of racking: the area, its bays and an arrow to its aisle
    function endSign(code, bays, dir, kind) {
      return signTex(320, 400, (g, w, h) => {
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
        g.fillStyle = kind === 'BB' ? '#c3222b' : '#15396b'; g.fillRect(10, 10, w - 20, h - 20);
        g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
        fit(g, code, 900, 150, w - 46); g.fillText(code, w / 2, 142);
        g.font = '700 38px ' + FONT; g.fillText('BAYS ' + bays, w / 2, 248);
        arrow(g, w / 2, 330, 96, dir, '#ffd200');
      });
    }
    function wallSign(text, bg, fg, w, h, icon) {
      return signTex(w, h, (g, cw, ch) => {
        g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
        g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
        let x = cw / 2;
        if (icon === 'exit') { // a running figure, like the real green signs
          const s = ch * 0.62, ox = ch * 0.55, oy = ch / 2;
          g.save(); g.translate(ox, oy); g.strokeStyle = fg; g.lineCap = 'round'; g.lineWidth = s * 0.12;
          g.beginPath(); g.arc(s * 0.12, -s * 0.36, s * 0.09, 0, Math.PI * 2); g.fill();
          g.beginPath(); g.moveTo(0, -s * 0.22); g.lineTo(-s * 0.08, s * 0.08); g.lineTo(s * 0.12, s * 0.38); g.moveTo(-s * 0.08, s * 0.08); g.lineTo(-s * 0.3, s * 0.32);
          g.moveTo(0, -s * 0.18); g.lineTo(s * 0.24, -s * 0.02); g.moveTo(0, -s * 0.18); g.lineTo(-s * 0.26, -s * 0.06); g.stroke(); g.restore();
          x = cw / 2 + ch * 0.35;
        }
        fit(g, text, 800, ch * 0.5, cw - (icon ? ch * 1.3 : ch * 0.4)); g.fillText(text, x, ch / 2 + 2);
      });
    }

    /* ---------- floor ---------- */
    const floorMat = new T.MeshLambertMaterial({ map: rep(TX_CONCRETE, W / 4, D / 4), aoMap: TX_AO, aoMapIntensity: 1 });
    const floor = plane(floorMat, 0, 0, W, D, 0, 'walls');
    floor.geometry.setAttribute('uv1', floor.geometry.attributes.uv); TX_AO.channel = 0;
    plane(lam(0x5f646b), -30, -30, W + 30, D + 30, -0.04, 'walls');
    const FLOORS = { tile: (w, d) => rep(TX_TILE, w / 1.2, d / 1.2), vinyl: (w, d, name) => rep(vinyl(/staff/i.test(name) ? '#cdbfae' : '#c3cad3'), w, d) };
    for (const r of world.rooms) {
      const w = r.x1 - r.x0, d = r.y1 - r.y0;
      plane(new T.MeshLambertMaterial({ map: (FLOORS[r.floor] || FLOORS.vinyl)(w, d, r.name) }), r.x0, r.y0, r.x1, r.y1, 0.004, 'shop');
      if (r.ceiling) {
        plane(M.ceiling, r.x0, r.y0, r.x1, r.y1, r.ceiling, 'shop', true);
        for (let x = r.x0 + 0.9; x < r.x1 - 0.4; x += 1.8) for (let y = r.y0 + 0.9; y < r.y1 - 0.4; y += 1.8) box(M.panelLight, x - 0.3, y - 0.3, r.ceiling - 0.02, x + 0.3, y + 0.3, r.ceiling - 0.005, 'shop');
        // the top of the room, seen from the warehouse
        box(M.inner, r.x0, r.y0, r.ceiling, r.x1, r.y1, r.ceiling + 0.04, 'shop');
      }
    }
    // yellow lines: the centre aisle's edges, the walkway across the front, round goods in
    const lineAt = (x0, y0, x1, y1, mat) => box(mat || M.line, x0, y0, 0.001, x1, y1, 0.006, 'walls');
    const cx0 = world.centre.x0, cx1 = world.centre.x1, LW = 0.08;
    lineAt(cx0 + 0.06, 0.25, cx0 + 0.06 + LW, Math.max(world.RF, world.LF) + 0.3);
    lineAt(cx1 - 0.06 - LW, 0.25, cx1 - 0.06, Math.max(world.RF, world.LF) + 0.3);
    lineAt(3.4, world.D - 6.6, W - 0.2, world.D - 6.6 + LW);
    for (const z of world.zones) {
      const m = plane(M.hatch, z.x0, z.y0, z.x1, z.y1, 0.007, 'walls');
      m.material = M.hatch.clone(); m.material.map = rep(TX_HATCH, (z.x1 - z.x0) / 0.6, (z.y1 - z.y0) / 0.6);
    }
    // keep-clear hatching in front of the fire exits
    for (const o of world.openings) {
      if (o.type !== 'exit') continue;
      let r;
      if (o.wall === 'back') r = [o.from - 0.2, 0, o.to + 0.2, 1.0];
      else if (o.wall === 'front') r = [o.from - 0.2, D - 1.0, o.to + 0.2, D];
      else if (o.wall === 'right') r = [W - 0.9, o.from - 0.2, W, o.to + 0.2];
      if (!r) continue;
      const m = plane(M.hatch, r[0], r[1], r[2], r[3], 0.007, 'walls');
      m.material = M.hatch.clone(); m.material.map = rep(TX_HATCH, (r[2] - r[0]) / 0.6, (r[3] - r[1]) / 0.6);
    }

    /* ---------- outer walls, doors, shutter, glazing ---------- */
    const SIDES = {
      back: { a0: -WT, a1: W + WT, seg: (a, b, z0, z1, mat) => box(mat, a, -WT, z0, b, 0, z1, 'walls'), mid: -WT / 2, across: 'y', inward: 0 },
      front: { a0: -WT, a1: W + WT, seg: (a, b, z0, z1, mat) => box(mat, a, D, z0, b, D + WT, z1, 'walls'), mid: D + WT / 2, across: 'y', inward: Math.PI },
      left: { a0: 0, a1: D, seg: (a, b, z0, z1, mat) => box(mat, -WT, a, z0, 0, b, z1, 'walls'), mid: -WT / 2, across: 'x', inward: Math.PI / 2 },
      right: { a0: 0, a1: D, seg: (a, b, z0, z1, mat) => box(mat, W, a, z0, W + WT, b, z1, 'walls'), mid: W + WT / 2, across: 'x', inward: -Math.PI / 2 }
    };
    function inWall(side, from, to, z0, z1, thick, mat) {
      const s = SIDES[side], m0 = s.mid - thick / 2, m1 = s.mid + thick / 2;
      if (s.across === 'y') box(mat, from, m0, z0, to, m1, z1, 'walls'); else box(mat, m0, from, z0, m1, to, z1, 'walls');
    }
    const BLOCK_H = 2.4;
    for (const [side, s] of Object.entries(SIDES)) {
      const ops = world.openings.filter((o) => o.wall === side).sort((p, q) => p.from - q.from);
      const run = (a, b, z0, z1) => { // blockwork below 2.4 m, cladding above
        if (b - a < 0.001) return;
        if (z0 < BLOCK_H) s.seg(a, b, z0, Math.min(z1, BLOCK_H), M.wallBlock);
        if (z1 > BLOCK_H) s.seg(a, b, Math.max(z0, BLOCK_H), z1, M.wallClad);
      };
      let at = s.a0;
      for (const o of ops) { run(at, o.from, 0, H); run(o.from, o.to, o.h, H); at = o.to; }
      run(at, s.a1, 0, H);
      for (const o of ops) {
        const h = o.h;
        if (o.type === 'exit') {
          inWall(side, o.from + 0.02, o.to - 0.02, 0, h, 0.05, M.door);
          inWall(side, o.from + 0.1, o.to - 0.1, 0.95, 1.0, 0.09, M.chrome); // the push bar
        }
        if (o.type === 'shutter') {
          const m = s.across === 'y' ? texturedBox(new T.MeshLambertMaterial({ map: TX_SHUTTER }), o.from, s.mid - 0.04, 0, o.to, s.mid + 0.04, h, 0.4, 'walls')
            : texturedBox(new T.MeshLambertMaterial({ map: TX_SHUTTER }), s.mid - 0.04, o.from, 0, s.mid + 0.04, o.to, h, 0.4, 'walls');
          m.userData.shutter = true;
          inWall(side, o.from - 0.12, o.from, 0, h + 0.2, 0.3, M.hazard); inWall(side, o.to, o.to + 0.12, 0, h + 0.2, 0.3, M.hazard);
        }
        if (o.type === 'glass' || o.type === 'entrance') {
          inWall(side, o.from, o.to, 0.05, h - 0.06, 0.03, M.glass);
          inWall(side, o.from, o.from + 0.06, 0, h, 0.09, M.frame); inWall(side, o.to - 0.06, o.to, 0, h, 0.09, M.frame);
          inWall(side, o.from, o.to, h - 0.08, h, 0.09, M.frame); inWall(side, o.from, o.to, 0, 0.06, 0.09, M.frame);
          if (o.type === 'entrance') { const mid = (o.from + o.to) / 2; inWall(side, mid - 0.025, mid + 0.025, 0, h, 0.09, M.frame); inWall(side, o.from, o.to, 2.2, 2.27, 0.09, M.frame); }
        }
      }
    }
    // fire exit signs above the doors, flat on the wall
    const exitTex = wallSign('FIRE EXIT', '#1f8a43', '#ffffff', 512, 160, 'exit');
    for (const o of world.openings) {
      if (o.type !== 'exit') continue;
      const s = SIDES[o.wall], mid = (o.from + o.to) / 2, off = 0.012, z = o.h + 0.25;
      if (o.wall === 'back') flat(exitTex, mid, off, z, 0.6, 0.19, 0, 'walls');
      else if (o.wall === 'front') flat(exitTex, mid, D - off, z, 0.6, 0.19, Math.PI, 'walls');
      else if (o.wall === 'right') flat(exitTex, W - off, mid, z, 0.6, 0.19, -Math.PI / 2, 'walls');
      void s;
    }
    const goodsIn = world.openings.find((o) => o.type === 'shutter');
    if (goodsIn) flat(wallSign('GOODS IN', '#f2c400', '#1c1d20', 512, 128), (goodsIn.from + goodsIn.to) / 2, D - 0.012, goodsIn.h + 0.45, 1.6, 0.4, Math.PI, 'walls');
    for (const c of world.columns) box(M.column, c[0], c[1], 0, c[2], c[3], H, 'walls');
    // inside walls go up to the room ceilings (2.85 m)
    for (const w of world.walls) box(M.inner, w[0], w[1], 0, w[2], w[3], 2.85, 'shop');

    /* ---------- roof: portal frames, purlins and lights ---------- */
    plane(M.roof, -WT, -WT, W + WT, D + WT, H, 'walls', true);
    for (let y = 0.15; y < D; y += 6) {
      box(M.rafter, 0, y - 0.1, H - 0.45, W, y + 0.1, H - 0.05, 'walls'); // rafter
      box(M.rafter, -0.05, y - 0.15, 0, 0.25, y + 0.15, H, 'walls'); box(M.rafter, W - 0.25, y - 0.15, 0, W + 0.05, y + 0.15, H, 'walls');
    }
    for (let x = 1.5; x < W; x += 2.5) box(M.rafter, x - 0.04, 0, H - 0.2, x + 0.04, D, H - 0.06, 'walls'); // purlins
    const LAMP_Z = 4.6;
    const lamps = [];
    const lamp = (x, y, alongX) => { // an LED batten hung on two wires
      const hl = 0.75;
      if (alongX) { box(M.lampBox, x - hl, y - 0.07, LAMP_Z, x + hl, y + 0.07, LAMP_Z + 0.06, 'walls'); box(M.lamp, x - hl + 0.03, y - 0.05, LAMP_Z - 0.008, x + hl - 0.03, y + 0.05, LAMP_Z, 'walls'); }
      else { box(M.lampBox, x - 0.07, y - hl, LAMP_Z, x + 0.07, y + hl, LAMP_Z + 0.06, 'walls'); box(M.lamp, x - 0.05, y - hl + 0.03, LAMP_Z - 0.008, x + 0.05, y + hl - 0.03, LAMP_Z, 'walls'); }
      for (const k of [-0.6, 0.6]) { const px = alongX ? x + k : x, py = alongX ? y : y + k; box(M.cable, px - 0.004, py - 0.004, LAMP_Z + 0.06, px + 0.004, py + 0.004, H - 0.2, 'walls'); }
      lamps.push([x, y]);
    };
    for (const a of world.aisles) { const n = 3; for (let i = 0; i < n; i++) lamp(a.x0 + (a.x1 - a.x0) * (i + 0.5) / n, a.cy, true); }
    for (let y = 1.2; y < D - 6.5; y += 2.6) lamp((cx0 + cx1) / 2, y, false);
    lamp(W / 2 - 4, 0.85, true); lamp(W / 2 + 4, 0.85, true);
    for (let x = 4.2; x < W - 2; x += 3.2) lamp(x, world.D - 7.2, true);

    /* ---------- racking ---------- */
    const POST = world.POST;
    const tags = []; // {x, y, z, turn, w, h, text, style}: the location labels, drawn by the label shader
    const endSigns = []; // per face: the sign on the end of its row (it glows for a hint)
    const backs = []; // the backs of one-sided rows (somewhere to put a notice)
    function drawRow(row) {
      const fs = [row.s && world.faceOf[row.s], row.n && world.faceOf[row.n]].filter(Boolean);
      const k = row.kind, nb = Math.round((row.x1 - row.x0) / world.BAY);
      for (const f of fs) {
        const yF = f.front, yB = f.back, out = f.out;
        // upright frames at every bay end: a post at the front and back of the face, braced between
        for (let i = 0; i <= nb; i++) {
          const x = row.x0 + i * world.BAY, x0 = x - POST / 2, x1 = x + POST / 2;
          const pf0 = Math.min(yF, yF - out * 0.07), pf1 = Math.max(yF, yF - out * 0.07), pb0 = Math.min(yB, yB + out * 0.07), pb1 = Math.max(yB, yB + out * 0.07);
          box(M.upright, x0, pf0, 0, x1, pf1, RH); box(M.upright, x0, pb0, 0, x1, pb1, RH);
          box(M.upright, x0 - 0.02, Math.min(yF, yB) - 0.02, 0, x1 + 0.02, Math.max(yF, yB) + 0.02, 0.012); // base plates
          const ya = yF - out * 0.035, yb = yB + out * 0.035;
          for (let z = 0.15; z < RH - 0.3; z += 0.62) bar(M.brace, [x, ya, z], [x, yb, z + 0.62], 0.022);
          bar(M.brace, [x, ya, 0.12], [x, yb, 0.12], 0.026); bar(M.brace, [x, ya, RH - 0.05], [x, yb, RH - 0.05], 0.026);
        }
        // shelves: a deck on two beams, per bay
        for (let i = 0; i < nb; i++) {
          const xa = row.x0 + i * world.BAY + POST / 2, xb = row.x0 + (i + 1) * world.BAY - POST / 2;
          for (const sh of f.shelves) {
            const z = sh.z, y0 = Math.min(yF, yB), y1 = Math.max(yF, yB);
            if (k === 'BB') {
              box(M.beam, xa, yF - (out > 0 ? 0.05 : 0), z - 0.1, xb, yF + (out > 0 ? 0 : 0.05), z);
              box(M.beam, xa, yB - (out > 0 ? 0 : 0.05), z - 0.1, xb, yB + (out > 0 ? 0.05 : 0), z);
              box(M.deck, xa, y0 + 0.02, z - 0.018, xb, y1 - 0.02, z);
            } else {
              box(M.steel, xa, y0 + 0.01, z - 0.012, xb, y1 - 0.01, z);
              const lipH = sh.tray ? 0.03 : 0.065;
              box(M.lip, xa, yF - (out > 0 ? 0.02 : 0), z - lipH, xb, yF + (out > 0 ? 0 : 0.02), z); // the front edge, where the labels go
              box(M.lip, xa, yB - (out > 0 ? 0 : 0.02), z - 0.03, xb, yB + (out > 0 ? 0.02 : 0), z);
            }
          }
        }
        // the ends of the row: the centre-aisle end gets a panel with the area's sign
        const endX = row.side === 'R' ? row.x0 - POST / 2 : row.x1 + POST / 2, endOut = row.side === 'R' ? -1 : 1;
        const ya = Math.min(f.y0, f.y1), yb = Math.max(f.y0, f.y1);
        box(M.endPanel, endX + (endOut < 0 ? -0.025 : 0), ya - 0.03, 0.02, endX + (endOut < 0 ? 0 : 0.025), yb + 0.03, RH);
        // the end protector at the bottom: yellow and black, like the real ones
        box(M.hazard, endX + endOut * 0.06 - 0.03, ya + 0.02, 0, endX + endOut * 0.06 + 0.03, yb - 0.02, 0.4);
        const toAisle = f.arrow; // world.js: points to the face's own aisle
        const sw = Math.min(0.5, (yb - ya) * 0.86), sh2 = sw * 1.25;
        const sign = flat(endSign(f.area, '01-' + String(f.bays.length).padStart(2, '0'), toAisle, f.kind), endX + endOut * 0.03, (ya + yb) / 2, 1.78, sw, sh2, row.side === 'R' ? -Math.PI / 2 : Math.PI / 2);
        endSigns.push({ face: f, mesh: sign });
      }
      // a one-sided row has a steel sheet across its back
      if (!(row.s && row.n)) {
        const my = row.s ? row.y0 + 0.02 : row.y1 - 0.02;
        box(M.backPanel, row.x0 - POST / 2, my - 0.008, 0.02, row.x1 + POST / 2, my + 0.008, RH);
        backs.push({ row, y: row.s ? row.y0 : row.y1, out: row.s ? -1 : 1 });
      }
    }
    world.rows.forEach(drawRow);
    // notices on the back of the first row, facing the counter: the pick path and the PPE sign
    (function () {
      const b = backs.find((k) => k.row.side === 'R' && k.out > 0);
      if (!b) return;
      const y = b.y - 0.009, x0 = b.row.x0; // on the steel back (its face is 12 mm inside the row)
      const path = signTex(512, 640, (g, w, h) => {
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#15396b'; g.fillRect(0, 0, w, 110);
        g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 58px ' + FONT; g.fillText('PICK PATH', w / 2, 58);
        // the warehouse from above: the centre aisle, the right side going up, the left side coming down
        g.fillStyle = '#e6e9ee'; g.fillRect(40, 140, w - 80, 380);
        g.fillStyle = '#c3cad3'; g.fillRect(w / 2 - 30, 150, 60, 360);
        for (let i = 0; i < 6; i++) { g.fillStyle = i < 3 ? '#3f78c8' : '#8a5cc0'; g.fillRect(w / 2 + 44, 470 - i * 58, w / 2 - 94, 22); }
        for (let i = 0; i < 5; i++) { g.fillStyle = '#e07b22'; g.fillRect(50, 175 + i * 66, w / 2 - 94, 26); }
        g.strokeStyle = '#c3222b'; g.lineWidth = 14; g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(w / 2 + 14, 505); g.lineTo(w / 2 + 14, 170); g.lineTo(w / 2 - 14, 170); g.lineTo(w / 2 - 14, 490); g.stroke();
        g.fillStyle = '#c3222b';
        g.beginPath(); g.moveTo(w / 2 - 14, 515); g.lineTo(w / 2 - 34, 482); g.lineTo(w / 2 + 6, 482); g.closePath(); g.fill();
        g.fillStyle = '#1d232c'; g.font = '800 30px ' + FONT;
        g.fillText('Up the right: AAA to BAG', w / 2, 560); g.fillText('Down the left: BBJ to BBA', w / 2, 604);
      });
      flat(path, x0 + 1.6, y, 1.55, 0.5, 0.625, 0);
      const ppe = signTex(512, 640, (g, w, h) => {
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#1f4fa8'; g.beginPath(); g.arc(w / 2, 230, 170, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.moveTo(w / 2 - 90, 160); g.lineTo(w / 2 + 90, 160); g.lineTo(w / 2 + 70, 330); g.lineTo(w / 2 - 70, 330); g.closePath(); g.fill(); // a vest
        g.fillStyle = '#1f4fa8'; g.beginPath(); g.moveTo(w / 2 - 30, 160); g.lineTo(w / 2, 220); g.lineTo(w / 2 + 30, 160); g.closePath(); g.fill();
        g.fillRect(w / 2 - 80, 245, 160, 16); g.fillRect(w / 2 - 74, 290, 148, 16);
        g.fillStyle = '#1d232c'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 46px ' + FONT;
        g.fillText('HI-VIS AND', w / 2, 470); g.fillText('SAFETY BOOTS', w / 2, 524); g.font = '700 30px ' + FONT; g.fillText('must be worn', w / 2, 580);
      });
      flat(ppe, x0 + 2.4, y, 1.55, 0.4, 0.5, 0);
      // and on the back of the bulk run by the staff room: lifting and keep clear
      const bb = backs.find((k) => k.row.side === 'L' && k.out > 0);
      if (!bb) return;
      const lift = signTex(512, 640, (g, w, h) => {
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#1f8a43'; g.fillRect(0, 0, w, 110);
        g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 54px ' + FONT; g.fillText('LIFT SAFELY', w / 2, 58);
        g.strokeStyle = '#1d232c'; g.lineWidth = 16; g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); g.arc(w / 2 - 10, 190, 34, 0, Math.PI * 2); g.stroke(); // head
        g.beginPath(); g.moveTo(w / 2 - 10, 226); g.lineTo(w / 2 - 20, 340); g.lineTo(w / 2 - 80, 400); g.lineTo(w / 2 - 40, 470); // back straight, knees bent
        g.moveTo(w / 2 - 20, 340); g.lineTo(w / 2 + 50, 390); g.lineTo(w / 2 + 40, 470); g.moveTo(w / 2 - 14, 270); g.lineTo(w / 2 + 60, 330); g.stroke();
        g.fillStyle = '#c49a64'; g.fillRect(w / 2 + 40, 300, 110, 90); g.strokeStyle = '#8a6a40'; g.lineWidth = 6; g.strokeRect(w / 2 + 40, 300, 110, 90);
        g.fillStyle = '#1d232c'; g.font = '800 34px ' + FONT; g.fillText('Bend your knees,', w / 2, 540); g.fillText('not your back', w / 2, 586);
      });
      flat(lift, bb.row.x0 + 1.4, bb.y - 0.009, 1.55, 0.5, 0.625, 0);
      const clear = signTex(512, 256, (g, w, h) => {
        g.fillStyle = '#f2c400'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d232c'; g.fillRect(14, 14, w - 28, h - 28); g.fillStyle = '#f2c400'; g.fillRect(24, 24, w - 48, h - 48);
        g.fillStyle = '#1d232c'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 64px ' + FONT; g.fillText('KEEP AISLES', w / 2, 100); g.fillText('CLEAR', w / 2, 170);
      });
      flat(clear, bb.row.x0 + 2.4, bb.y - 0.009, 1.65, 0.6, 0.3, 0);
    })();

    /* ---------- the trays (drawers) of the AA areas ---------- */
    // An open-topped card tray: base, sides, back and a front panel that carries the label, as one geometry.
    function trayGeometry() {
      const parts = [], add = (x0, y0, z0, x1, y1, z1) => { const g = new T.BoxGeometry(x1 - x0, y1 - y0, z1 - z0); g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); parts.push(g); };
      const t = 0.03; // unit tray: x -0.5..0.5 wide, y 0..1 high, z -0.5 (back) .. 0.5 (front)
      add(-0.5, 0, -0.5, 0.5, t * 0.4, 0.5); // base
      add(-0.5, 0, -0.5, -0.5 + t, 1, 0.5); add(0.5 - t, 0, -0.5, 0.5, 1, 0.5); // sides
      add(-0.5, 0, -0.5, 0.5, 1, -0.5 + t * 0.4); // back
      add(-0.5, 0, 0.5 - t * 0.4, 0.5, 1, 0.5); // front
      const pos = [], nor = [], uv = [], idx = [];
      let off = 0;
      for (const g of parts) {
        const ni = g.index.array;
        pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); uv.push(...g.attributes.uv.array);
        for (let i = 0; i < ni.length; i++) idx.push(ni[i] + off);
        off += g.attributes.position.count;
      }
      const out = new T.BufferGeometry();
      out.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new T.Float32BufferAttribute(nor, 3)); out.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
      out.setIndex(idx);
      return out;
    }
    const trayGeo = trayGeometry();
    const trayMat = lam(0xffffff, { map: TX_CARD });
    const trays = new Map(); // 'AAB-03-07-2' -> {face, bay, shelf, index, mesh, i, base: Matrix4, x, y, z, w, d, h, out, slide}
    const trayKey = (loc) => loc.face.area + '-' + loc.bay.no + '-' + loc.shelf.no + '-' + loc.tray;
    const faceMeshes = []; // per face: {face, products, trays, labels}
    const _c = new T.Color();

    /* ---------- products ---------- */
    // Each product is a box in its photo's colour, sized to its place: small packs in the trays, boxes on the shelves,
    // bigger boxes in the bulky aisles (sizes vary a little, from the product code, so the shelves look stocked).
    const itemsByFace = new Map();
    for (const it of world.items) { const f = it.loc.face; if (!itemsByFace.has(f)) itemsByFace.set(f, []); itemsByFace.get(f).push(it); }
    const h01 = (s, k) => ((root.ShiftWorld.hash(s + k) % 10000) / 10000);
    function itemBox(it) { // plan-space box: centre x, y, z (bottom), and w (along x), d (along y), h
      const l = it.loc, f = l.face, dp = world.DEEP[f.kind], out = f.out, cw = l.x1 - l.x0;
      if (l.tray >= 0) {
        const cd = (dp - 0.03) / l.shelf.deep, w = cw * (0.62 + 0.18 * h01(it.code, 'w')), d = cd * (0.62 + 0.2 * h01(it.code, 'd')), h = 0.022 + 0.04 * h01(it.code, 'h');
        const dmid = 0.015 + (l.slot + 0.5) * cd; // from the front of the tray
        return { x: (l.x0 + l.x1) / 2, y: f.front - out * (0.012 + dmid), z: l.z0 + 0.006, w, d, h };
      }
      const gap = l.z1 - l.z0 - (f.kind === 'BB' ? 0.13 : 0.08);
      const wk = f.kind === 'BB' ? 0.78 + 0.16 * h01(it.code, 'w') : 0.74 + 0.2 * h01(it.code, 'w');
      const w = cw * wk, d = Math.min(dp - 0.06, (f.kind === 'BB' ? 0.42 : 0.26) + (f.kind === 'BB' ? 0.18 : 0.2) * h01(it.code, 'd'));
      const h = Math.max(0.05, gap * (f.kind === 'BB' ? 0.55 + 0.4 * h01(it.code, 'h') : 0.42 + 0.48 * h01(it.code, 'h')));
      return { x: (l.x0 + l.x1) / 2, y: f.front - out * (0.035 + d / 2), z: l.z0 + 0.002, w, d, h };
    }
    const productMat = lam(0xffffff);
    const HIDE = new T.Matrix4().makeScale(0, 0, 0);
    function boxMatrix(b, dy) { return _m.compose(_p.set(b.x, b.z + b.h / 2, b.y + (dy || 0)), _q.identity(), _s.set(b.w, b.h, b.d)); }
    for (const f of world.faces) {
      const list = itemsByFace.get(f) || [];
      const pm = new T.InstancedMesh(unitBox, productMat, Math.max(1, list.length));
      list.forEach((it, i) => {
        it.box = itemBox(it); it.mesh = pm; it.i = i;
        pm.setMatrixAt(i, boxMatrix(it.box));
        // packaging is a touch paler and greyer than the photo's colour
        _c.setHex(it.colour); const hsl = {}; _c.getHSL(hsl);
        _c.setHSL(hsl.h, Math.min(0.75, hsl.s * 0.85), Math.min(0.86, Math.max(0.2, hsl.l * 0.92 + 0.04)));
        pm.setColorAt(i, _c);
      });
      pm.count = list.length; pm.instanceMatrix.needsUpdate = true; if (pm.instanceColor) pm.instanceColor.needsUpdate = true;
      pm.computeBoundingSphere();
      groups.main.add(pm);
      // trays
      let nt = 0;
      const tlist = [];
      if (f.kind === 'AA') {
        for (const b of f.bays) for (const sh of f.shelves) if (sh.tray) for (let t = 0; t < sh.trays; t++) tlist.push({ b, sh, t });
      }
      const tm = tlist.length ? new T.InstancedMesh(trayGeo, trayMat, tlist.length) : null;
      if (tm) {
        const dp = world.DEEP.AA;
        for (const e of tlist) {
          const uw = e.b.ux1 - e.b.ux0, tw = uw / e.sh.trays, x0 = f.psign > 0 ? e.b.ux0 + e.t * tw : e.b.ux1 - (e.t + 1) * tw;
          const tr = { face: f, bay: e.b, shelf: e.sh, index: e.t, mesh: tm, i: nt, x: x0 + tw / 2, y: f.front - f.out * (0.005 + (dp - 0.01) / 2), z: e.sh.z, w: tw - 0.006, d: dp - 0.01, h: world.TRAY_H, out: f.out, slide: 0, items: [] };
          tr.base = new T.Matrix4().compose(_p.set(tr.x, tr.z, tr.y), _q.setFromAxisAngle(new T.Vector3(0, 1, 0), f.out > 0 ? 0 : Math.PI), _s.set(tr.w, tr.h, tr.d));
          tm.setMatrixAt(nt, tr.base);
          const v = 0.9 + 0.12 * h01(f.area + e.b.no + e.sh.no + e.t, 'c'); _c.setRGB(v, v * 0.98, v * 0.95); tm.setColorAt(nt, _c);
          trays.set(f.area + '-' + e.b.no + '-' + e.sh.no + '-' + e.t, tr);
          nt++;
        }
        tm.instanceMatrix.needsUpdate = true; if (tm.instanceColor) tm.instanceColor.needsUpdate = true;
        tm.computeBoundingSphere();
        groups.main.add(tm);
      }
      faceMeshes.push({ face: f, products: pm, trays: tm });
    }
    for (const it of world.items) if (it.loc.tray >= 0) { const tr = trays.get(trayKey(it.loc)); if (tr) { tr.items.push(it); it.trayRef = tr; } }

    /* ---------- location labels ---------- */
    // Every location's label, fixed to its shelf edge (red for odd bays, blue for even, the location over a barcode,
    // like the real ones) or its tray front (white, a line per position, the back one on top). All of them are one
    // InstancedMesh; the graphics chip draws the letters from one font texture. Drawn out to 18 m.
    for (const f of world.faces) {
      for (const b of f.bays) {
        for (const sh of f.shelves) {
          if (sh.tray) continue;
          const n = sh.cells, cw = (b.ux1 - b.ux0) / n, lw = Math.min(f.kind === 'BB' ? 0.24 : 0.14, cw - 0.012), lh = lw * (f.kind === 'BB' ? 0.34 : 0.38);
          for (let c = 0; c < n; c++) {
            const x0 = f.psign > 0 ? b.ux0 + c * cw : b.ux1 - (c + 1) * cw;
            const zc = sh.z - (f.kind === 'BB' ? 0.05 : 0.034);
            // stuck on the front of the beam
            tags.push({ x: x0 + cw / 2, y: f.front + f.out * 0.003, z: zc, turn: TURN[f.facing], w: lw, h: Math.min(lh, f.kind === 'BB' ? 0.088 : 0.06),
              text: f.area + '-' + world.pad2(b.no) + '-' + world.pad2(sh.no) + '-' + world.pad2(c + 1), style: b.no % 2 ? 4 : 5 });
          }
        }
      }
    }
    for (const tr of trays.values()) {
      const f = tr.face, deep = tr.shelf.deep, first = tr.index * deep + 1;
      const lw = Math.min(0.17, tr.w * 0.9), lh = Math.min(0.03, (tr.h * 0.8) / deep);
      tr.labels = [];
      for (let k = 0; k < deep; k++) {
        const pos = first + deep - 1 - k; // the back position on top
        tr.labels.push(tags.length);
        // stuck on the tray front (the tray sits 5 mm back from the shelf edge)
        tags.push({ x: tr.x, y: f.front - f.out * 0.0028, z: tr.z + tr.h * 0.5 + lh * deep / 2 - lh * (k + 0.5), turn: TURN[f.facing], w: lw, h: lh,
          text: f.area + '-' + world.pad2(tr.bay.no) + '-' + world.pad2(tr.shelf.no) + '-' + world.pad2(pos), style: deep === 1 ? 3 : k === 0 ? 1 : k === deep - 1 ? 2 : 0, tray: tr });
      }
    }
    const GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-';
    const glyphTex = (() => { // 16 x 4 cells of 64 x 128 px, white letters
      const c = canvas(1024, 512), g = c.getContext('2d');
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '800 104px ' + FONT;
      for (let i = 0; i < GLYPHS.length; i++) {
        const s = Math.min(1, 58 / g.measureText(GLYPHS[i]).width);
        g.save(); g.translate((i % 16) * 64 + 32, ((i / 16) | 0) * 128 + 68); g.scale(s, 1); g.fillText(GLYPHS[i], 0, 0); g.restore();
      }
      const t = new T.CanvasTexture(c); t.colorSpace = T.NoColorSpace; t.anisotropy = maxAniso;
      return t;
    })();
    const labelMat = new T.ShaderMaterial({
      uniforms: {
        uGlyphs: { value: glyphTex }, uFar: { value: 18 },
        uRed: { value: new T.Color('#c3222b') }, uBlue: { value: new T.Color('#1f4fa8') }, uPaper: { value: new T.Color('#f4f4f1') }, uInk: { value: new T.Color('#121418') },
        uEdge: { value: new T.Color('#b9b9b5') }, fogColor: { value: scene.fog.color }, fogNear: { value: scene.fog.near }, fogFar: { value: scene.fog.far }
      },
      vertexShader: [
        'attribute vec4 aLab;', 'uniform float uFar;', 'varying vec2 vUv;', 'flat varying vec4 vLab;', 'varying float vDepth;',
        'void main() {',
        '  vUv = uv; vLab = aLab;',
        '  vec4 c = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
        '  if (distance(c.xyz, cameraPosition) > uFar) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }',
        '  vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);',
        '  vDepth = -mv.z;',
        '  gl_Position = projectionMatrix * mv;',
        '}'].join('\n'),
      fragmentShader: [
        'uniform sampler2D uGlyphs;', 'uniform vec3 uRed, uBlue, uPaper, uInk, uEdge, fogColor;', 'uniform float fogNear, fogFar;',
        'varying vec2 vUv;', 'flat varying vec4 vLab;', 'varying float vDepth;',
        'float charAt(float i) {',
        '  float f = i < 3.5 ? vLab.x : (i < 7.5 ? vLab.y : vLab.z);',
        '  return mod(floor(f / exp2(6.0 * mod(i, 4.0))), 64.0);',
        '}',
        'float hash1(float n) { return fract(sin(n) * 43758.5453); }',
        'void main() {',
        '  float style = vLab.w;', // 0 to 3: a line of a tray label (1 top, 2 bottom, 3 the only one); 4 red, 5 blue shelf labels
        '  bool shelf = style > 3.5;',
        '  vec3 bg = shelf ? (style < 4.5 ? uRed : uBlue) : uPaper;',
        '  vec3 ink = shelf ? vec3(1.0) : uInk;',
        '  float split = shelf ? 0.4 : 0.0;', // shelf labels: the location over a white strip with the barcode
        '  vec2 tp = vec2((vUv.x - 0.045) / 0.91, ((vUv.y - split) / (1.0 - split) - 0.12) / 0.76);',
        '  vec2 q = vec2(tp.x * 12.0, tp.y);',
        '  vec2 qdx = dFdx(q), qdy = dFdy(q), sc = vec2(1.0 / 16.0, 0.25);',
        '  float bw = fwidth(vUv.x * 76.0);',
        '  float a = 0.0;',
        '  if (tp.x > 0.0 && tp.x < 1.0 && tp.y > 0.0 && tp.y < 1.0) {',
        '    float i = floor(q.x), code = charAt(i);',
        '    if (code < 61.5) {',
        '      vec2 cell = vec2(mod(code, 16.0), floor(code / 16.0));',
        '      vec2 g = vec2((cell.x + fract(q.x)) / 16.0, 1.0 - (cell.y + 1.0 - tp.y) / 4.0);',
        '      a = textureGrad(uGlyphs, g, qdx * sc, qdy * sc).a;',
        '    }',
        '  }',
        '  vec3 col = mix(bg, ink, a);',
        '  if (shelf && vUv.y < split) {',
        '    col = vec3(0.96);',
        '    vec2 bp = vec2((vUv.x - 0.12) / 0.76, (vUv.y - 0.07) / (split - 0.13));',
        '    if (bp.x > 0.0 && bp.x < 1.0 && bp.y > 0.0 && bp.y < 1.0) {',
        '      float k = floor(bp.x * 58.0);',
        '      float bar = step(0.5, hash1(k * 1.618 + vLab.x * 0.0013 + vLab.y * 0.0007 + vLab.z * 0.0003));',
        '      if (k < 1.0 || k > 56.0) bar = 1.0;',
        '      bar = mix(bar, 0.55, clamp(bw * 1.6 - 0.8, 0.0, 1.0));',
        '      col = mix(col, vec3(0.06), bar);',
        '    }',
        '  }',
        '  if (!shelf) {', // a thin grey edge round each tray label
        '    float e = min(vUv.x, 1.0 - vUv.x) < 0.012 ? 1.0 : 0.0;',
        '    if ((abs(style - 1.0) < 0.5 || abs(style - 3.0) < 0.5) && vUv.y > 0.93) e = 1.0;',
        '    if ((abs(style - 2.0) < 0.5 || abs(style - 3.0) < 0.5) && vUv.y < 0.07) e = 1.0;',
        '    col = mix(col, uEdge, e);',
        '  }',
        '  col = mix(col, fogColor, smoothstep(fogNear, fogFar, vDepth));',
        '  gl_FragColor = vec4(col, 1.0);',
        '  #include <colorspace_fragment>',
        '}'].join('\n')
    });
    function packCode(t) { // 12 characters, 4 to a number (6 bits each): exact in the graphics chip's 32-bit numbers
      const out = [0, 0, 0];
      for (let i = 0; i < 12; i++) { const k = i < t.length ? GLYPHS.indexOf(t[i]) : -1; out[(i / 4) | 0] += (k < 0 ? 62 : k) * Math.pow(64, i % 4); }
      return out;
    }
    const labelGeo = new T.PlaneGeometry(1, 1);
    const labAttr = new Float32Array(tags.length * 4);
    labelGeo.setAttribute('aLab', new T.InstancedBufferAttribute(labAttr, 4));
    const labelMesh = new T.InstancedMesh(labelGeo, labelMat, tags.length);
    const _up = new T.Vector3(0, 1, 0);
    tags.forEach((t, i) => {
      _q.setFromAxisAngle(_up, t.turn);
      labelMesh.setMatrixAt(i, _m.compose(_p.set(t.x, t.z, t.y), _q, _s.set(t.w, t.h, 1)));
      const p = packCode(t.text); labAttr.set([p[0], p[1], p[2], t.style], i * 4);
    });
    labelMesh.instanceMatrix.needsUpdate = true; labelMesh.computeBoundingSphere();
    labelMesh.frustumCulled = false;
    groups.main.add(labelMesh);
    const labelBase = labelMesh.instanceMatrix.array.slice();

    /* ---------- product photos ---------- */
    // The Toolbox's own saved copies (product-search/photos/CODE.jpg, 120 px, about 2 KB each), never Screwfix's
    // server. They go straight into one big texture (4096 px: room for 1,024; 2048 on smaller phones), and the boxes
    // near you that you can see get theirs on the front (detailedfoil: load more than the floor plan does).
    const big = renderer.capabilities.maxTextureSize >= 4096 && !opts.smallAtlas;
    const AT = big ? 4096 : 2048, PS = 128, PI2 = 120, SLOTS = (AT / PS) * (AT / PS);
    const photoTex = new T.DataTexture(null, AT, AT);
    photoTex.source.dataReady = false;
    photoTex.colorSpace = T.SRGBColorSpace; photoTex.magFilter = photoTex.minFilter = T.LinearFilter; photoTex.generateMipmaps = false; photoTex.needsUpdate = true;
    const slots = [];
    for (let y = 0; y < AT; y += PS) for (let x = 0; x < AT; x += PS) slots.push({ x, y, key: null, used: 0 });
    const photoGeo = new T.PlaneGeometry(1, 1);
    const PHOTO_MAX = Math.min(SLOTS, big ? 1000 : 250);
    photoGeo.setAttribute('aUv', new T.InstancedBufferAttribute(new Float32Array(PHOTO_MAX * 4), 4));
    const photoMat = new T.MeshLambertMaterial({ color: 0xffffff, map: photoTex });
    photoMat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute vec4 aUv;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvMapUv = aUv.xy + vec2(vMapUv.x, 1.0 - vMapUv.y) * aUv.zw;');
    };
    const photoMesh = new T.InstancedMesh(photoGeo, photoMat, PHOTO_MAX);
    photoMesh.count = 0; photoMesh.frustumCulled = false; photoMesh.renderOrder = 1;
    groups.main.add(photoMesh);
    const photos = new Map(); // code -> {state, slot}
    const photoUrl = (code) => 'product-search/photos/' + encodeURIComponent(code) + '.jpg';
    const photoCanvas = canvas(PI2, PI2);
    const _src = new T.Texture(), _at = new T.Vector2();
    let queue = [], busy = 0, near = [], inbox = [];
    const AT_ONCE = 12;
    function loadPhotos() {
      while (busy < AT_ONCE && queue.length) {
        const code = queue.shift();
        if (photos.has(code)) continue;
        const p = { state: 'loading', slot: null };
        photos.set(code, p); busy++;
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => { busy--; inbox.push([code, img]); loadPhotos(); if (opts.onChange) opts.onChange(); };
        img.onerror = () => { busy--; p.state = 'none'; loadPhotos(); };
        img.src = photoUrl(code);
      }
    }
    function takeSlot(keep) {
      let best = null;
      for (const s of slots) { if (!s.key) return s; if (!keep.has(s.key) && (!best || s.used < best.used)) best = s; }
      return best;
    }
    // called by the frame loop: puts every photo that arrived into the big texture
    function flushPhotos() {
      if (!inbox.length) return false;
      const list = inbox.splice(0), keep = new Set(near.map((it) => it.code)), now = performance.now();
      for (const [code, img] of list) {
        const p = photos.get(code);
        if (!p) continue;
        const s = takeSlot(keep);
        if (!s) { photos.delete(code); continue; }
        if (s.key) { const old = photos.get(s.key); if (old) photos.delete(s.key); }
        let from = img;
        if (img.naturalWidth !== PI2 || img.naturalHeight !== PI2) { const g = photoCanvas.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, PI2, PI2); g.drawImage(img, 0, 0, PI2, PI2); from = photoCanvas; }
        _src.image = from;
        try { renderer.copyTextureToTexture(_src, photoTex, null, _at.set(s.x, s.y)); } catch (e) { p.state = 'none'; continue; }
        s.key = code; s.used = now; p.state = 'ok'; p.slot = s;
      }
      fillPhotos();
      return true;
    }
    const _ip = new T.Vector3(), _is = new T.Vector3(), _iq = new T.Quaternion(), _im = new T.Matrix4(), _ie = new T.Euler();
    function putPhoto(i, x, y, z, turn, tilt, size, s) {
      _ie.set(tilt, turn, 0, 'YXZ'); _iq.setFromEuler(_ie);
      photoMesh.setMatrixAt(i, _im.compose(_ip.set(x, z, y), _iq, _is.set(size, size, 1)));
      photoGeo.attributes.aUv.setXYZW(i, (s.x + 0.5) / AT, (s.y + 0.5) / AT, (PI2 - 1) / AT, (PI2 - 1) / AT);
    }
    function fillPhotos() {
      let n = 0;
      const now = performance.now();
      for (const it of near) {
        if (n >= PHOTO_MAX) break;
        const p = photos.get(it.code);
        if (!it.loc || !p || p.state !== 'ok') continue;
        p.slot.used = now;
        const b = it.box, f = it.loc.face, slide = it.trayRef ? it.trayRef.slide * 0.32 : (it.pull || 0);
        if (it.loc.tray >= 0) { // on top of the pack in the tray
          const s = Math.min(b.w, b.d) * 0.92;
          putPhoto(n++, b.x, b.y + f.out * slide, b.z + b.h + 0.0015, 0, -Math.PI / 2, s, p.slot);
        } else { // on the front of the box
          const s = Math.min(b.w, b.h) * 0.9;
          putPhoto(n++, b.x, b.y + f.out * (b.d / 2 + 0.0015 + slide), b.z + b.h / 2, TURN[f.facing], 0, s, p.slot);
        }
      }
      photoMesh.count = n;
      photoMesh.instanceMatrix.needsUpdate = true; photoGeo.attributes.aUv.needsUpdate = true;
    }
    const _frustum = new T.Frustum(), _pm = new T.Matrix4(), _pv = new T.Vector3();
    const PHOTO_NEAR = big ? 14 : 9;
    let extra = []; // products that must have their photo (an open tray)
    function photosInView(cam) {
      cam.updateMatrixWorld(); _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _frustum.setFromProjectionMatrix(_pm);
      const ex = cam.position.x, ey = cam.position.z, ez = cam.position.y, R = PHOTO_NEAR, cand = [];
      for (const it of world.items) {
        if (!it.loc || !it.photo) continue; // nothing to show for this product
        if (it.loc.tray >= 0 && !(it.trayRef && it.trayRef.slide > 0.05)) continue; // tray contents only show when it's out
        const b = it.box, f = it.loc.face, dx = b.x - ex, dy = b.y - ey;
        if (dx > R || dx < -R || dy > R || dy < -R) continue;
        if ((ey - f.front) * f.out < -0.02) continue; // behind the shelf face
        const dz = b.z + b.h / 2 - ez, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > R * R) continue;
        if (!_frustum.containsPoint(_pv.set(b.x, b.z + b.h / 2, b.y + f.out * b.d / 2))) continue;
        cand.push([d2, it]);
      }
      cand.sort((a, b) => a[0] - b[0]);
      return cand.slice(0, PHOTO_MAX).map(([, item]) => item);
    }
    function updatePhotos(...cameras) {
      // Both views draw the same photo mesh. Share its budget between their closest products.
      const views = cameras.map(photosInView);
      const selected = new Set(extra);
      for (let rank = 0; rank < PHOTO_MAX && selected.size < PHOTO_MAX; rank++) {
        for (const view of views) {
          if (view[rank]) selected.add(view[rank]);
          if (selected.size >= PHOTO_MAX) break;
        }
      }
      near = [...selected].slice(0, PHOTO_MAX);
      queue = near.filter((it) => it.photo && !photos.has(it.code)).map((it) => it.code);
      loadPhotos();
      fillPhotos();
    }

    /* ---------- the shop floor and the rest ---------- */
    function gondola(o) {
      const ax = o.along === 'x', h = o.z1 || 1.8;
      const u0 = ax ? o.x0 : o.y0, u1 = ax ? o.x1 : o.y1, v0 = ax ? o.y0 : o.x0, v1 = ax ? o.y1 : o.x1;
      const put = (mat, ua, va, za, ub, vb, zb) => (ax ? box(mat, ua, va, za, ub, vb, zb, 'shop') : box(mat, va, ua, za, vb, ub, zb, 'shop'));
      const both = o.open.length > 1, toPlus = o.open === 'S' || o.open === 'E';
      const back = both ? [(v0 + v1) / 2 - 0.02, (v0 + v1) / 2 + 0.02] : toPlus ? [v0, v0 + 0.04] : [v1 - 0.04, v1];
      put(M.gondola, u0, back[0], 0, u1, back[1], h); put(M.plinth, u0, v0, 0, u1, v1, 0.1);
      for (const e of o.edges || [u0, u1]) put(M.gondola, e - 0.02, v0, 0, e + 0.02, v1, h);
      const levels = [];
      for (let k = 1; k <= 4; k++) { const z = 0.1 + k * (h - 0.25) / 4; if (z > h - 0.1) break; levels.push(z); }
      for (const z of [0.1].concat(levels)) {
        const sides = both ? [[v0, back[0]], [back[1], v1]] : toPlus ? [[back[1], v1]] : [[v0, back[0]]];
        for (const [a, b] of sides) {
          if (z > 0.1) put(M.gshelf, u0, a, z - 0.02, u1, b, z);
          // display stock: a row of boxes on every shelf, in shop colours
          const n = Math.max(1, Math.floor((u1 - u0) / 0.16));
          for (let i = 0; i < n; i++) {
            const it = world.items[(root.ShiftWorld.hash(o.x0 + ':' + z + ':' + a + ':' + i) % world.items.length)];
            const cw = (u1 - u0) / n, bw = cw * 0.8, bh = Math.min(0.28, (levels[0] - 0.12) * 0.75) * (0.6 + 0.4 * h01(it.code, 'h')), bd = (b - a) * 0.6;
            _c.setHex(it.colour);
            const mat = displayMat(_c.getHex());
            put(mat, u0 + i * cw + (cw - bw) / 2, (a + b) / 2 - bd / 2, z, u0 + i * cw + (cw + bw) / 2, (a + b) / 2 + bd / 2, z + bh);
          }
        }
      }
    }
    const displayMats = new Map();
    function displayMat(hex) { // a few dozen materials shared by the display stock
      const k = ((hex >> 20) & 0xf) * 256 + ((hex >> 12) & 0xf) * 16 + ((hex >> 4) & 0xf);
      if (!displayMats.has(k)) displayMats.set(k, lam(hex));
      return displayMats.get(k);
    }
    function legs(mat, o, top, t) { for (const [x, y] of [[o.x0, o.y0], [o.x1 - t, o.y0], [o.x0, o.y1 - t], [o.x1 - t, o.y1 - t]]) box(mat, x, y, 0, x + t, y + t, top, 'shop'); }
    function chair(o) {
      box(M.seat, o.x0, o.y0, 0.42, o.x1, o.y1, 0.47, 'shop'); legs(M.frame, o, 0.42, 0.03);
      const f = o.face || 'N';
      if (f === 'W') box(M.seat, o.x1 - 0.05, o.y0, 0.47, o.x1, o.y1, 0.9, 'shop');
      if (f === 'E') box(M.seat, o.x0, o.y0, 0.47, o.x0 + 0.05, o.y1, 0.9, 'shop');
      if (f === 'N') box(M.seat, o.x0, o.y1 - 0.05, 0.47, o.x1, o.y1, 0.9, 'shop');
      if (f === 'S') box(M.seat, o.x0, o.y0, 0.47, o.x1, o.y0 + 0.05, 0.9, 'shop');
    }
    const geoProp = {
      stool: new T.CylinderGeometry(0.15, 0.21, 0.42, 24), stoolTop: new T.CylinderGeometry(0.155, 0.155, 0.012, 24),
      kick: new T.CylinderGeometry(0.22, 0.32, 0.7, 28), kickTop: new T.CylinderGeometry(0.235, 0.235, 0.016, 28),
      ext: new T.CylinderGeometry(0.075, 0.075, 0.5, 16), extTop: new T.CylinderGeometry(0.03, 0.05, 0.08, 10)
    };
    Object.assign(M, { carton: lam(0xc49a64), carton2: lam(0xb88d58), stool: lam(0xc3222b), truck: lam(0xf07a1a), toteRim: lam(0x24508f), red: lam(0xc8191f) });
    // the kick stools at the end of every row (they can be carried into an aisle: game.js moves them with setStool)
    const stoolMeshes = new Map();
    for (const st of world.stools || []) {
      const g = new T.Group();
      const m = new T.Mesh(geoProp.kick, M.stool); m.position.y = 0.35; g.add(m); // a big red elephant's foot (detailedfoil, 21 Nov 2026: bigger)
      const t = new T.Mesh(geoProp.kickTop, M.black); t.position.y = 0.705; g.add(t);
      g.position.set(st.x, 0, st.y); groups.shop.add(g); stoolMeshes.set(st.id, g);
    }
    function setStool(id, x, y) { const g = stoolMeshes.get(id); if (g) g.position.set(x, 0, y); }
    const firePoint = wallSign('FIRE POINT', '#c3222b', '#ffffff', 300, 200);
    let cctv = null;
    // a pale floor graphic in front of the counter, labelled, the words read walking up to the counter (detailedfoil, 21 Nov 2026)
    function floorZone(r, fill, edge, text) {
      const w = r.x1 - r.x0, d = r.y1 - r.y0, px = 220;
      const t = signTex(Math.round(w * px), Math.round(d * px), (g, cw, ch) => {
        g.fillStyle = fill; g.fillRect(0, 0, cw, ch);
        g.strokeStyle = edge; g.lineWidth = 14; g.setLineDash([46, 26]); g.strokeRect(10, 10, cw - 20, ch - 20); g.setLineDash([]);
        g.fillStyle = edge; g.textAlign = 'center'; g.textBaseline = 'middle';
        const lines = text.split('\n'), s = fit(g, lines.reduce((a, b) => (a.length > b.length ? a : b)), 900, Math.round(ch / 7), cw - 70);
        lines.forEach((ln, k) => g.fillText(ln, cw / 2, ch / 2 + (k - (lines.length - 1) / 2) * s * 1.15));
      });
      const m = new T.Mesh(new T.PlaneGeometry(w, d), new T.MeshLambertMaterial({ map: t, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      m.rotation.x = -Math.PI / 2; m.position.copy(V((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 0.006)); m.renderOrder = 1;
      groups.shop.add(m);
      return m;
    }
    const clockCanvas = canvas(256, 256), clockTex = new T.CanvasTexture(clockCanvas); clockTex.colorSpace = T.SRGBColorSpace;
    let clockMesh = null;
    let clockMinute = -1;
    function clockTick(minute) {
      if (minute === clockMinute) return false;
      clockMinute = minute;
      const g = clockCanvas.getContext('2d'), c = 128;
      g.fillStyle = '#fbfbf8'; g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#1d232c';
      for (let i = 0; i < 60; i++) { const a = i * Math.PI / 30, r0 = i % 5 ? 112 : 100; g.save(); g.translate(c, c); g.rotate(a); g.fillRect(-(i % 5 ? 1.5 : 4), -122, i % 5 ? 3 : 8, 122 - r0); g.restore(); }
      const hand = (a, len, w) => { g.save(); g.translate(c, c); g.rotate(a); g.fillRect(-w / 2, -len, w, len + 14); g.restore(); };
      const m = minute % 60, hh = (minute / 60) % 12;
      hand(hh * Math.PI / 6, 62, 10); hand(m * Math.PI / 30, 96, 6);
      g.fillStyle = '#c3222b'; g.beginPath(); g.arc(c, c, 7, 0, Math.PI * 2); g.fill();
      clockTex.needsUpdate = true;
      return true;
    }
    clockTick(7 * 60);
    for (const o of world.objects) {
      const z1 = o.z1 || 1;
      switch (o.kind) {
        case 'heater': box(M.heater, o.x0, o.y0, o.z0, o.x1, o.y1, o.z1, 'shop'); break;
        case 'counter':
          box(M.counter, o.x0, o.y0, 0, o.x1, o.y1 - 0.03, 0.95, 'shop');
          box(M.counterTop, o.x0 - 0.02, o.y0 - 0.04, 0.95, o.x1 + 0.02, o.y1 + 0.03, 1.0, 'shop');
          break;
        case 'till':
          box(M.till, o.x0, o.y0 - 0.02, 1.0, o.x1, o.y1 - 0.08, 1.05, 'shop');
          box(M.till, (o.x0 + o.x1) / 2 - 0.02, o.y0 + 0.02, 1.05, (o.x0 + o.x1) / 2 + 0.02, o.y0 + 0.05, 1.2, 'shop');
          box(M.screen, o.x0 - 0.01, o.y0 + 0.01, 1.16, o.x1 + 0.01, o.y0 + 0.035, 1.33, 'shop');
          break;
        case 'cupboard': box(M.grey, o.x0, o.y0, 0, o.x1, o.y1, z1, 'shop'); break;
        case 'cage':
          texturedBox(M.mesh, o.x0, o.y0, 0, o.x1, o.y1, z1, 0.2, 'shop');
          for (const [x, y] of [[o.x0, o.y0], [o.x1, o.y0], [o.x0, o.y1], [o.x1, o.y1]]) box(M.frame, x - 0.015, y - 0.015, 0, x + 0.015, y + 0.015, z1, 'shop');
          break;
        case 'rollcage': {
          texturedBox(M.mesh, o.x0, o.y0, 0.15, o.x1, o.y1, z1, 0.2, 'shop');
          box(M.frame, o.x0, o.y0, 0.08, o.x1, o.y1, 0.15, 'shop');
          for (const [x, y] of [[o.x0 + 0.06, o.y0 + 0.06], [o.x1 - 0.06, o.y0 + 0.06], [o.x0 + 0.06, o.y1 - 0.06], [o.x1 - 0.06, o.y1 - 0.06]]) box(M.black, x - 0.035, y - 0.035, 0, x + 0.035, y + 0.035, 0.08, 'shop');
          // its cartons are the day's delivery (deliveryBoxes below)
          for (let k = 1; k < 3; k++) box(M.frame, o.x0 + 0.05, o.y0 + 0.05, 0.14 + k * 0.52 - 0.02, o.x1 - 0.05, o.y1 - 0.05, 0.14 + k * 0.52, 'shop');
          break;
        }
        case 'pallet': { // a delivery pallet: the cartons on it are drawn by deliveryBoxes
          box(M.pallet, o.x0, o.y0, 0.1, o.x1, o.y1, 0.14, 'shop');
          for (const [a, b] of [[0, 0.12], [0.44, 0.56], [0.88, 1]]) box(M.pallet, o.x0, o.y0 + (o.y1 - o.y0) * a, 0, o.x1, o.y0 + (o.y1 - o.y0) * b, 0.1, 'shop');
          // its cartons are the day's delivery (deliveryBoxes below)
          break;
        }
        case 'kickstool': break; // (the red kick stools move: stoolMeshes below)
        case 'stool': { // an elephant foot kick stool
          const m = new T.Mesh(geoProp.stool, M.stool); m.position.copy(V((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, 0.21)); groups.shop.add(m);
          const t = new T.Mesh(geoProp.stoolTop, M.black); t.position.copy(V((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, 0.425)); groups.shop.add(t);
          break;
        }
        case 'pallettruck': {
          const cx = (o.x0 + o.x1) / 2, w2 = o.x1 - o.x0;
          box(M.truck, o.x0 + 0.02, o.y0, 0.04, o.x0 + 0.17, o.y1 - 0.35, 0.12, 'shop'); box(M.truck, o.x1 - 0.17, o.y0, 0.04, o.x1 - 0.02, o.y1 - 0.35, 0.12, 'shop');
          box(M.truck, o.x0, o.y1 - 0.38, 0.04, o.x1, o.y1 - 0.12, 0.34, 'shop');
          bar(M.black, [cx, o.y1 - 0.25, 0.34], [cx, o.y1 + 0.05, 1.15], 0.035, 'shop'); bar(M.black, [cx - 0.12, o.y1 + 0.05, 1.15], [cx + 0.12, o.y1 + 0.05, 1.15], 0.03, 'shop');
          void w2;
          break;
        }
        case 'totes': { // empty totes stacked on a dolly, ready to pick into
          box(M.black, o.x0, o.y0, 0.04, o.x1, o.y1, 0.1, 'shop');
          for (const [x, y] of [[o.x0 + 0.05, o.y0 + 0.05], [o.x1 - 0.05, o.y0 + 0.05], [o.x0 + 0.05, o.y1 - 0.05], [o.x1 - 0.05, o.y1 - 0.05]]) box(M.black, x - 0.03, y - 0.03, 0, x + 0.03, y + 0.03, 0.04, 'shop');
          for (let k = 0; k < 6; k++) { const z = 0.1 + k * 0.2; box(M.tote, o.x0, o.y0, z, o.x1, o.y1, z + 0.2, 'shop'); box(M.toteRim, o.x0 - 0.008, o.y0 - 0.008, z + 0.185, o.x1 + 0.008, o.y1 + 0.008, z + 0.2, 'shop'); }
          break;
        }
        case 'bucket': {
          box(M.yellow, o.x0, o.y0, 0.06, o.x1, o.y1, 0.36, 'shop'); box(M.black, o.x0 + 0.03, o.y0 + 0.03, 0, o.x0 + 0.08, o.y0 + 0.08, 0.06, 'shop');
          box(M.yellow, o.x0 + 0.05, o.y1 - 0.15, 0.36, o.x1 - 0.05, o.y1, 0.5, 'shop');
          bar(M.chrome, [o.x0 + 0.2, o.y0 + 0.15, 0.2], [o.x0 + 0.16, o.y0 + 0.08, 1.35], 0.025, 'shop');
          break;
        }
        case 'extinguisher': { // on a wall bracket, a fire point sign over it
          const f = o.face, cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2;
          const off = { S: [0, 0.09], N: [0, -0.09], E: [0.09, 0], W: [-0.09, 0] }[f], wx = f === 'W' ? o.x1 : f === 'E' ? o.x0 : cx, wy = f === 'S' ? o.y0 : f === 'N' ? o.y1 : cy;
          const m = new T.Mesh(geoProp.ext, M.red); m.position.copy(V(wx + off[0], wy + off[1], 0.82)); groups.shop.add(m);
          const t = new T.Mesh(geoProp.extTop, M.black); t.position.copy(V(wx + off[0], wy + off[1], 1.1)); groups.shop.add(t);
          flat(firePoint, wx + off[0] * 0.13, wy + off[1] * 0.13, 1.42, 0.3, 0.2, TURN[f], 'shop');
          break;
        }
        case 'cctv': { // the CCTV monitor: a black screen in a thin bezel on the wall, the map drawn by cctv.js
          const B = 0.035, tw = o.y1 - o.y0 - 2 * B, th = o.z1 - o.z0 - 2 * B;
          box(M.black, o.x0 + 0.01, o.y0, o.z0, o.x1, o.y1, o.z1, 'shop');
          box(M.frame, o.x1 - 0.01, (o.y0 + o.y1) / 2 - 0.12, o.z0 + 0.3, o.x1, (o.y0 + o.y1) / 2 + 0.12, o.z1 - 0.3, 'shop'); // the wall bracket
          const cv = canvas(2048, Math.round(2048 * th / tw)); // big on purpose: the screen is most of the wall
          const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; tex.anisotropy = maxAniso;
          const m = new T.Mesh(new T.PlaneGeometry(tw, th), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
          m.position.copy(V(o.x0 + 0.008, (o.y0 + o.y1) / 2, (o.z0 + o.z1) / 2)); m.rotation.y = -Math.PI / 2; groups.shop.add(m);
          cctv = { canvas: cv, tex, mesh: m, obj: o };
          break;
        }
        case 'clock': {
          clockMesh = new T.Mesh(new T.CircleGeometry(0.19, 40), new T.MeshBasicMaterial({ map: clockTex }));
          clockMesh.position.copy(V(o.x0 - 0.002, (o.y0 + o.y1) / 2, (o.z0 + o.z1) / 2)); clockMesh.rotation.y = -Math.PI / 2; groups.shop.add(clockMesh);
          const rim = new T.Mesh(new T.TorusGeometry(0.195, 0.014, 8, 40), M.black); rim.position.copy(clockMesh.position); rim.rotation.y = -Math.PI / 2; groups.shop.add(rim);
          break;
        }
        case 'panel': box(M.grey, o.x0, o.y0, 0, o.x1, o.y1, z1, 'shop'); break;
        case 'holding': break; // drawn below
        case 'gondola': gondola(o); break;
        case 'table': case 'desk': box(M.wood, o.x0, o.y0, z1 - 0.04, o.x1, o.y1, z1, 'shop'); legs(M.frame, o, z1 - 0.04, 0.05); break;
        case 'chair': chair(o); break;
        case 'worktop': box(M.white, o.x0, o.y0, 0, o.x1, o.y1 - 0.02, z1 - 0.04, 'shop'); box(M.wood, o.x0, o.y0, z1 - 0.04, o.x1, o.y1, z1, 'shop'); break;
        case 'sink': box(M.chrome, o.x0, o.y0, 0.9, o.x1, o.y1, 0.915, 'shop'); break;
        case 'wc': {
          const f = o.face || 'N';
          const cis = f === 'E' ? [o.x0, o.y0, o.x0 + 0.18, o.y1] : f === 'W' ? [o.x1 - 0.18, o.y0, o.x1, o.y1] : f === 'N' ? [o.x0, o.y1 - 0.18, o.x1, o.y1] : [o.x0, o.y0, o.x1, o.y0 + 0.18];
          box(M.white, o.x0 + 0.03, o.y0 + 0.03, 0, o.x1 - 0.03, o.y1 - 0.03, 0.42, 'shop'); box(M.white, cis[0], cis[1], 0.42, cis[2], cis[3], 0.8, 'shop');
          break;
        }
        case 'basin': box(M.white, o.x0, o.y0, 0.72, o.x1, o.y1, 0.86, 'shop'); break;
        default: box(M.grey, o.x0, o.y0, o.z0 || 0, o.x1, o.y1, z1, 'shop');
      }
    }
    // the board over the counter, on the warehouse side
    const counter = world.counter;
    const tcRoom = world.rooms.find((r) => r.name === 'Trade counter');
    box(M.inner, tcRoom.x0, tcRoom.y0 - 0.06, 2.85, tcRoom.x1, tcRoom.y0, 3.35, 'shop');
    flat(wallSign('TRADE COUNTER', '#15396b', '#ffffff', 1024, 160), (counter.x0 + counter.x1) / 2, tcRoom.y0 - 0.065, 3.1, 2.6, 0.4, Math.PI, 'shop');
    // the service bell: a big red button and its sign, fixed to the counter on the staff side
    let bellButton;
    {
      const bl = world.bell;
      box(M.counterTop, bl.x - 0.25, bl.y - 0.025, 0.46, bl.x + 0.25, bl.y, 0.8, 'shop');
      const btn = new T.Mesh(new T.CylinderGeometry(0.1, 0.12, 0.07, 28), M.red); btn.rotation.x = Math.PI / 2;
      btn.position.copy(V(bl.x, bl.y - 0.06, bl.z + 0.08)); groups.shop.add(btn); bellButton = btn;
      flat(wallSign('SERVICE BELL', '#c8191f', '#ffffff', 512, 96), bl.x, bl.y - 0.028, 0.5, 0.46, 0.086, Math.PI, 'shop');
    }
    // the manager's PC on the office desk (detailedfoil, 20 Nov 2026): it sets what Sam does first
    {
      const pc = world.pc;
      box(M.till, pc.x - 0.12, pc.y - 0.08, 0.75, pc.x + 0.12, pc.y + 0.08, 0.77, 'shop');
      box(M.till, pc.x - 0.02, pc.y + 0.01, 0.77, pc.x + 0.02, pc.y + 0.05, 0.92, 'shop');
      box(M.till, pc.x - 0.27, pc.y - 0.02, 0.88, pc.x + 0.27, pc.y + 0.02, 1.22, 'shop');
      flat(signTex(512, 300, (g, w, h) => {
        g.fillStyle = '#0f2f63'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff'; g.font = '800 40px ' + FONT; g.textAlign = 'left'; g.textBaseline = 'top';
        g.fillText("SAM'S JOBS", 24, 22); g.font = '600 30px ' + FONT;
        g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText('Manager PC', 24, 80);
        for (let k = 0; k < 4; k++) { g.fillStyle = '#ffd400'; g.fillRect(24, 140 + k * 38, 22, 22); g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(60, 146 + k * 38, 220 + ((k * 73) % 140), 10); }
      }), pc.x, pc.y - 0.025, 1.05, 0.5, 0.3, Math.PI, 'shop');
      box(M.till, pc.x - 0.3, pc.y - 0.3, 0.75, pc.x + 0.05, pc.y - 0.17, 0.765, 'shop'); // keyboard
    }
    // door plates on the walls
    const plate = (text, x, y, z, turn) => flat(wallSign(text, '#ffffff', '#1d232c', 512, 128), x, y, z, 0.42, 0.105, turn, 'shop');
    const staffRoom = world.rooms.find((r) => r.name === 'Staff room'), office = world.rooms.find((r) => r.name === 'Office');
    if (staffRoom) plate('STAFF ROOM', staffRoom.x1 + 0.155, staffRoom.y0 + 0.75, 1.75, Math.PI / 2);
    if (office) plate('OFFICE', office.x0 + 1.6, office.y0 - 0.16, 2.05, Math.PI);
    const hold = holdingArea();
    flush();

    /* ---------- the tills' screens: an order finished at the till stays up until its tote goes over ---------- */
    const tillScreens = world.objects.filter((o) => o.kind === 'till' && o.x0 >= counter.x0 - 0.01 && o.x1 <= counter.x1 + 0.01).sort((a, b) => a.x0 - b.x0).map((o) => {
      const c = canvas(256, 128), tex = new T.CanvasTexture(c);
      tex.colorSpace = T.SRGBColorSpace;
      const m = new T.Mesh(new T.PlaneGeometry(o.x1 - o.x0 + 0.02, 0.17), new T.MeshBasicMaterial({ map: tex }));
      m.position.copy(V((o.x0 + o.x1) / 2, o.y0 + 0.007, 1.245)); m.rotation.y = TURN.N; m.visible = false;
      groups.shop.add(m);
      return { m, c, tex };
    });
    function tillScreen(i, no) {
      const s = tillScreens[i];
      if (!s) return;
      if (!no) { s.m.visible = false; return; }
      const g = s.c.getContext('2d'), w = 256, h = 128;
      g.fillStyle = '#0d2a5c'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '700 22px ' + FONT; g.fillText('Order Complete', w / 2, 22);
      g.fillStyle = '#ffd34d'; fit(g, no, 900, 60, w - 20); g.fillText(no, w / 2, 68);
      g.fillStyle = '#c9d6ea'; g.font = '600 17px ' + FONT; g.fillText('Customer waiting', w / 2, 110);
      s.tex.needsUpdate = true; s.m.visible = true;
    }

    /* ---------- the holding area: bagged click and collects (world.js holding) ---------- */
    // Long-span shelving like the real one in detailedfoil's floor plan: blue uprights, orange beams, chipboard decks.
    // Blue totes with a big green OC label on the front hold the yellow bags; the big items bay holds loose boxes.
    // Each order has a despatch note (made up: CrashFix, the surname, a collection number, an A9 number one digit
    // short of a real one) with no highlighting or Challenge 25 line: its top strip is left blank (detailedfoil).
    function ocLabel(code) {
      return signTex(320, 120, (g, w, h) => {
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#12893a'; g.textAlign = 'center'; g.textBaseline = 'middle';
        fit(g, code, 900, 96, w - 20); g.fillText(code, w / 2, h / 2 + 4);
      });
    }
    function noteTex(p) {
      return signTex(512, 352, (g, w, h) => {
        g.fillStyle = '#fbfbf9'; g.fillRect(0, 0, w, h);
        // the top strip stays blank; then a barcode, the name and number, the collection box
        g.fillStyle = '#1a1a1a';
        let x = 26; for (let i = 0; i < 40; i++) { const bw = 1 + ((i * 7 + p.num.charCodeAt(i % 4)) % 3); g.fillRect(x, 62, bw, 40); x += bw + 1 + (i % 4 === 0 ? 1 : 0); }
        g.textAlign = 'left'; g.textBaseline = 'alphabetic';
        g.font = '900 28px ' + FONT; g.fillText('CRASHFIX', 26, 138);
        g.strokeStyle = '#1a1a1a'; g.lineWidth = 3; g.strokeRect(220, 62, 270, 40);
        g.font = '400 26px ' + FONT; g.fillText('Collection No. ' + p.collection, 232, 92);
        // the number and the surname, big, as on the real ones
        g.font = '400 50px ' + FONT; g.fillText(p.num, 220, 162);
        const nx = 220 + g.measureText(p.num).width + 18;
        fit(g, p.surname, 400, 60, w - nx - 16); g.fillText(p.surname, nx, 164);
        g.font = '400 22px ' + FONT; g.fillText('Despatch Note ' + p.despatch, 220, 200);
        g.fillStyle = '#9a9a9a';
        for (let i = 0; i < 6; i++) g.fillRect(300, 216 + i * 14, 120 + (i * 37) % 70, 5);
        for (let i = 0; i < 4; i++) g.fillRect(26, 250 + i * 14, 90 + (i * 23) % 40, 5);
        g.strokeStyle = '#b5b5b5'; g.lineWidth = 2; g.strokeRect(20, 304, w - 40, 34);
      });
    }
    function holdingArea() {
      const hd = world.holding;
      if (!hd) return null;
      const beam = lam(0xd5661c), P = hd.post, fx = hd.front, bx = hd.x0;
      const ends = [hd.y0, hd.split, hd.y1];
      for (const y of ends) for (const x of [bx, fx - P]) box(M.upright, x, y - P / 2, 0, x + P, y + P / 2, hd.top, 'shop');
      const bays = [[hd.y0 + P / 2, hd.split - P / 2, true], [hd.split + P / 2, hd.y1 - P / 2, false]];
      for (const [a, b, totes] of bays) {
        const levels = (totes ? [hd.low] : []).concat(hd.decks, [hd.top]);
        for (const z of levels) {
          box(beam, fx - 0.05, a, z - 0.08, fx, b, z, 'shop'); box(beam, bx, a, z - 0.08, bx + 0.05, b, z, 'shop');
          box(M.deck, bx + 0.02, a, z - 0.018, fx - 0.02, b, z, 'shop');
        }
        if (!totes) box(beam, fx - 0.05, a, 0.04, fx, b, 0.12, 'shop'); // a low rail for OC-001's label
      }
      const spots = [];
      for (const sp of hd.spots) {
        const cy = (sp.y0 + sp.y1) / 2, w = sp.y1 - sp.y0;
        if (sp.kind === 'tote') { // an open blue tote, its label on the front
          const t = 0.014, x0 = sp.x0 + 0.02, x1 = sp.x1, z0 = sp.z0, z1 = sp.z1;
          box(M.tote, x0, sp.y0, z0, x1, sp.y1, z0 + t, 'shop');
          box(M.tote, x0, sp.y0, z0, x1, sp.y0 + t, z1, 'shop'); box(M.tote, x0, sp.y1 - t, z0, x1, sp.y1, z1, 'shop');
          box(M.tote, x0, sp.y0, z0, x0 + t, sp.y1, z1, 'shop'); box(M.tote, x1 - t, sp.y0, z0, x1, sp.y1, z1 - 0.06, 'shop');
          const r = 0.02, rz = z1 - 0.014; // the rim: four strips round an open top
          box(M.toteRim, x0 - 0.006, sp.y0 - 0.006, rz, x1 + 0.006, sp.y0 + r, z1, 'shop'); box(M.toteRim, x0 - 0.006, sp.y1 - r, rz, x1 + 0.006, sp.y1 + 0.006, z1, 'shop');
          box(M.toteRim, x0 - 0.006, sp.y0, rz, x0 + r, sp.y1, z1, 'shop'); box(M.toteRim, x1 - r, sp.y0, z1 - 0.074, x1 + 0.006, sp.y1, z1 - 0.06, 'shop');
          flat(ocLabel(sp.code), x1 + 0.002, cy, z0 + 0.15, Math.min(0.32, w - 0.06), 0.12, TURN.E, 'shop');
        } else flat(ocLabel(sp.code), fx + 0.003, cy, sp.label.z - 0.04 + (sp.kind === 'floor' ? 0.04 : 0), 0.32, 0.12, TURN.E, 'shop');
        spots.push({ sp, group: null, parcel: null });
      }
      const sign = wallSign('HOLDING AREA', '#12893a', '#ffffff', 768, 150);
      flat(sign, bx + 0.004, (hd.y0 + hd.split) / 2, 2.63, 1.5, 0.29, TURN.E, 'shop');
      return { hd, spots };
    }
    // a bagged order (a yellow sack, note on top, tipped towards you) or a big loose box with the note on its front
    const _rx = new T.Vector3(), _ux = new T.Vector3(), _nx = new T.Vector3(), _mb = new T.Matrix4();
    function parcelMesh(p, kind, w) {
      const g = new T.Group(), note = new T.MeshBasicMaterial({ map: noteTex(p) });
      note.userData = {}; g.userData.note = note;
      const add = (geo, mat, x, y, z, own) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); if (own) m.userData.own = true; g.add(m); return m; };
      if (kind === 'tote') {
        const bw = w - 0.07, bag = lam(0xf2d21b); bag.userData = {};
        const b = add(unitBox, bag, 0, 0.12, 0, true); b.scale.set(0.5, 0.2, bw); b.rotation.z = 0.12;
        const n = add(new T.PlaneGeometry(0.27, 0.18), note, 0.06, 0.255, 0, true);
        _nx.set(0.42, 0.91, 0).normalize(); _rx.set(0, 0, -1); _ux.crossVectors(_nx, _rx);
        n.quaternion.setFromRotationMatrix(_mb.makeBasis(_rx, _ux, _nx));
      } else {
        const h = kind === 'floor' ? 0.5 : 0.44, bw = Math.min(1.05, w - 0.15), c = lam(0xc49a64); c.userData = {};
        const b = add(unitBox, c, 0, h / 2, 0, true); b.scale.set(0.5, h, bw);
        add(unitBox, lam(0xa98455), 0, h - 0.004, 0, true).scale.set(0.06, 0.01, bw + 0.002); // the tape
        const n = add(new T.PlaneGeometry(0.27, 0.18), note, 0.252, h * 0.55, 0, true); n.rotation.y = Math.PI / 2;
      }
      return g;
    }
    function setParcel(code, p) {
      const s = hold && hold.spots.find((x) => x.sp.code === code);
      if (!s) return;
      if (s.group) { dropTote(s.group); s.group = null; }
      s.parcel = p || null;
      if (!p) return;
      const sp = s.sp, g = parcelMesh(p, sp.kind, sp.y1 - sp.y0);
      g.position.set((sp.x0 + sp.x1) / 2, sp.z0 + (sp.kind === 'tote' ? 0.016 : 0), (sp.y0 + sp.y1) / 2);
      scene.add(g); s.group = g;
    }
    // what the customer carries out: a copy of the parcel
    function carryParcel(code, parcel) {
      const s = hold && hold.spots.find((x) => x.sp.code === code);
      if (!s || !(parcel || s.parcel)) return null;
      const g = parcelMesh(parcel || s.parcel, s.sp.kind === 'tote' ? 'tote' : 'shelf', s.sp.kind === 'tote' ? 0.45 : 0.9);
      g.rotation.y = Math.PI / 2;
      scene.add(g);
      return g;
    }

    /* ---------- customers at the counter ---------- */
    // A simple figure: legs that swing from the hip, a body, arms, a head with hair. Each has its own colours.
    const geoC = {
      leg: new T.CapsuleGeometry(0.068, 0.7, 4, 10).translate(0, -0.42, 0), boot: new T.BoxGeometry(0.14, 0.09, 0.28),
      hips: new T.BoxGeometry(0.34, 0.16, 0.2), torso: new T.CapsuleGeometry(0.17, 0.36, 4, 12), neck: new T.CylinderGeometry(0.05, 0.055, 0.08, 10),
      arm: new T.CapsuleGeometry(0.048, 0.5, 4, 8).translate(0, -0.3, 0), hand: new T.SphereGeometry(0.05, 10, 8),
      head: new T.SphereGeometry(0.105, 18, 14), hair: new T.SphereGeometry(0.11, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), nose: new T.BoxGeometry(0.03, 0.04, 0.03), eye: new T.SphereGeometry(0.013, 8, 6),
      stripe: new T.BoxGeometry(0.36, 0.035, 0.25)
    };
    function makeCustomer() {
      const group = new T.Group(), parts = {};
      parts.body = lam(0xf07a1a); parts.legsM = lam(0x2f3540); parts.skin = lam(0xe0b394); parts.hair = lam(0x3a2a20); parts.stripe = lam(0xd9dde2);
      const add = (geo, mat, x, y, z, parent) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); (parent || group).add(m); return m; };
      parts.legL = add(geoC.leg, parts.legsM, -0.085, 0.9, 0); parts.legR = add(geoC.leg, parts.legsM, 0.085, 0.9, 0);
      add(geoC.boot, M.boot, 0, -0.86, 0.05, parts.legL); add(geoC.boot, M.boot, 0, -0.86, 0.05, parts.legR);
      add(geoC.hips, parts.legsM, 0, 0.95, 0);
      parts.torso = add(geoC.torso, parts.body, 0, 1.24, 0); parts.torso.scale.set(1.12, 1, 0.66);
      add(geoC.stripe, parts.stripe, 0, -0.02, 0, parts.torso).scale.set(0.9, 1, 1.2); add(geoC.stripe, parts.stripe, 0, 0.12, 0, parts.torso).scale.set(0.93, 1, 1.25);
      add(geoC.neck, parts.skin, 0, 1.54, 0);
      parts.armL = add(geoC.arm, parts.body, -0.235, 1.46, 0); parts.armR = add(geoC.arm, parts.body, 0.235, 1.46, 0);
      add(geoC.hand, parts.skin, 0, -0.62, 0, parts.armL); add(geoC.hand, parts.skin, 0, -0.62, 0, parts.armR);
      parts.armL.rotation.z = 0.08; parts.armR.rotation.z = -0.08;
      // the receipt they hold while they wait for their order (shown by game.js)
      parts.receipt = new T.Mesh(unitBox, lam(0xfafafa)); parts.receipt.scale.set(0.085, 0.15, 0.006); parts.receipt.position.set(0.0, -0.64, 0.055); parts.receipt.rotation.x = 0.35; parts.receipt.visible = false; parts.armR.add(parts.receipt);
      parts.head = add(geoC.head, parts.skin, 0, 1.67, 0); parts.head.scale.set(0.92, 1.05, 1);
      add(geoC.hair, parts.hair, 0, 0.012, -0.008, parts.head);
      add(geoC.nose, parts.skin, 0, -0.005, 0.1, parts.head);
      add(geoC.eye, M.black, -0.036, 0.02, 0.093, parts.head); add(geoC.eye, M.black, 0.036, 0.02, 0.093, parts.head);
      scene.add(group);
      return { group, parts };
    }
    const customer = makeCustomer();
    customer.group.position.copy(V(world.customer.x, world.customer.y, 0)); customer.group.rotation.y = Math.PI; // facing the counter (north)
    // the tote that goes over the counter, with what was picked in it
    const tote = new T.Group();
    (function () {
      const m = M.tote, t = 0.012;
      const add = (x0, y0, z0, x1, y1, z1) => { const g = new T.Mesh(unitBox, m); g.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); g.scale.set(x1 - x0, y1 - y0, z1 - z0); tote.add(g); };
      add(-0.3, 0, -0.2, 0.3, t, 0.2); add(-0.3, 0, -0.2, -0.3 + t, 0.22, 0.2); add(0.3 - t, 0, -0.2, 0.3, 0.22, 0.2); add(-0.3, 0, -0.2, 0.3, 0.22, -0.2 + t); add(-0.3, 0, 0.2 - t, 0.3, 0.22, 0.2);
    })();
    /* ---------- the delivery: cartons on the roll cages and pallets at goods in, one per product to put away ---------- */
    const dSlots = (world.goodsin || []).reduce((n, g) => n + g.slots.length, 0);
    const dMesh = new T.InstancedMesh(unitBox, lam(0xffffff), Math.max(1, dSlots));
    dMesh.instanceColor = new T.InstancedBufferAttribute(new Float32Array(Math.max(1, dSlots) * 3), 3);
    dMesh.frustumCulled = false; groups.shop.add(dMesh);
    const dIndex = new Map(); let dOff = []; { let n = 0; (world.goodsin || []).forEach((g) => { dOff.push(n); n += g.slots.length; }); }
    const _dm = new T.Matrix4(), _dc = new T.Color();
    function slotBox(d) { const g = world.goodsin[d.src], sl = g.slots[d.slot]; return { x: (sl.x0 + sl.x1) / 2, y: (sl.y0 + sl.y1) / 2, z0: sl.z0, z1: sl.z1, w: sl.x1 - sl.x0, d: sl.y1 - sl.y0 }; }
    function deliverySet(list) {
      for (let i = 0; i < dSlots; i++) dMesh.setMatrixAt(i, HIDE);
      dIndex.clear();
      list.forEach((d) => {
        const i = dOff[d.src] + d.slot, b = slotBox(d);
        dIndex.set(d, i);
        _dm.makeScale(b.w, b.z1 - b.z0, b.d).setPosition(b.x, (b.z0 + b.z1) / 2, b.y);
        dMesh.setMatrixAt(i, d.by || d.done ? HIDE : _dm);
        _dc.setHex(h01(d.item.code, 'c') < 0.5 ? 0xc49a64 : 0xb88d58); dMesh.setColorAt(i, _dc);
      });
      dMesh.instanceMatrix.needsUpdate = true; dMesh.instanceColor.needsUpdate = true;
    }
    function deliveryShow(d) {
      const i = dIndex.get(d); if (i === undefined) return;
      const b = slotBox(d);
      _dm.makeScale(b.w, b.z1 - b.z0, b.d).setPosition(b.x, (b.z0 + b.z1) / 2, b.y);
      dMesh.setMatrixAt(i, d.by || d.done ? HIDE : _dm); dMesh.instanceMatrix.needsUpdate = true;
    }
    // every hand over gets its own tote, with boxes in the colours of what was picked
    function makeTote(colours) {
      const t = tote.clone();
      colours.slice(0, 6).forEach((hex, i) => {
        const m = new T.Mesh(unitBox, lam(hex)), w = 0.14 + 0.06 * ((i * 37) % 5) / 5, h = 0.06 + 0.08 * ((i * 53) % 7) / 7;
        m.scale.set(w, h, 0.12 + 0.05 * (i % 3)); m.position.set(-0.19 + (i % 3) * 0.19, 0.013 + h / 2 + (i > 2 ? 0.05 : 0), i > 2 ? 0.08 : -0.08); m.rotation.y = (i % 2 ? 0.15 : -0.1);
        m.userData.own = true; t.add(m);
      });
      scene.add(t);
      return t;
    }
    function dropTote(t) {
      if (t.parent) t.parent.remove(t);
      for (const m of t.children) if (m.userData.own) { if (m.material.map) m.material.map.dispose(); m.material.dispose(); }
    }
    // one more picked line into a tote that's being carried round (box i, in the product's colour)
    function toteBox(t, hex, i) {
      const m = new T.Mesh(unitBox, lam(hex)), w = 0.14 + 0.06 * ((i * 37) % 5) / 5, h = 0.06 + 0.08 * ((i * 53) % 7) / 7, k = i % 6;
      m.scale.set(w, h, 0.12 + 0.05 * (k % 3)); m.position.set(-0.19 + (k % 3) * 0.19, 0.013 + h / 2 + (k > 2 ? 0.05 : 0), k > 2 ? 0.08 : -0.08); m.rotation.y = (k % 2 ? 0.15 : -0.1);
      m.userData.own = true; t.add(m);
    }

    /* ---------- Sam's trolley: a stack of blue totes on a grey base with wheels (detailedfoil) ---------- */
    // Long side along its local z; Sam pushes at the -z end (no handle: detailedfoil, 19 Nov 2026). Picks go in the top tote.
    const M_TBASE = lam(0x8d939b), M_WHEEL = lam(0x1f2226), M_HANDLE = lam(0xa7adb5);
    const geoT = { wheel: new T.CylinderGeometry(0.05, 0.05, 0.035, 14).rotateZ(Math.PI / 2), bar: new T.CylinderGeometry(0.012, 0.012, 1, 8) };
    function trolleyTote(t, y) { const g = tote.clone(); g.rotation.y = Math.PI / 2; g.position.set(0, y, 0.04); t.group.add(g); return g; }
    function makeTrolley() {
      const group = new T.Group(), t = { group, top: null, n: 0 };
      const add = (geo, mat, x, y, z, sx, sy, sz) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); if (sx) m.scale.set(sx, sy, sz); group.add(m); return m; };
      add(unitBox, M_TBASE, 0, 0.11, 0, 0.5, 0.05, 0.78);                                   // the base
      for (const [x, z] of [[-0.2, -0.31], [0.2, -0.31], [-0.2, 0.31], [0.2, 0.31]]) { add(geoT.wheel, M_WHEEL, x, 0.05, z); add(unitBox, M_TBASE, x, 0.075, z, 0.03, 0.05, 0.05); }
      for (let i = 0; i < 3; i++) trolleyTote(t, 0.14 + i * 0.17);                               // the stack
      t.top = trolleyTote(t, 0.14 + 3 * 0.17);                                                  // what's being picked
      scene.add(group);
      return t;
    }
    function poseTrolley(t, b) { if (!t || !b.trolley) return; t.group.position.set(b.trolley.x, 0, b.trolley.y); t.group.rotation.y = b.trolley.phi; }
    // a picked line into the top tote (hex), or the tote emptied (null: the order went in the holding area)
    function trolleyTop(t, hex) {
      if (hex === null || hex === undefined) { for (const m of t.top.children.slice()) if (m.userData.own) { t.top.remove(m); m.material.dispose(); } t.n = 0; return; }
      toteBox(t.top, hex, t.n++);
    }
    // the top tote off the trolley, for the counter; an empty one takes its place
    function trolleyTake(t) {
      const g = t.top;
      scene.attach(g);
      t.top = trolleyTote(t, 0.14 + 3 * 0.17); t.n = 0;
      return g;
    }

    /* ---------- coworkers (bot.js): Sam, in uniform ---------- */
    // A figure with knees and elbows, so they can kneel at the bottom shelves, carry a tote and type at the till.
    // Screwfix staff wear navy with a yellow logo: the patch carries the Toolbox's own made-up brand (CrashFix, as on
    // the despatch notes) and a white badge has their name. Nothing floats: the name is on the badge, not over their head.
    const geoW = {
      thigh: new T.CapsuleGeometry(0.07, 0.3, 4, 10).translate(0, -0.22, 0), shin: new T.CapsuleGeometry(0.06, 0.3, 4, 10).translate(0, -0.21, 0),
      boot: new T.BoxGeometry(0.13, 0.085, 0.27), upper: new T.CapsuleGeometry(0.052, 0.2, 4, 8).translate(0, -0.15, 0),
      fore: new T.CapsuleGeometry(0.046, 0.19, 4, 8).translate(0, -0.14, 0), collar: new T.CylinderGeometry(0.078, 0.095, 0.05, 14),
      scanner: new T.BoxGeometry(0.062, 0.17, 0.036), plate: new T.PlaneGeometry(1, 1)
    };
    const M_UNI = lam(0x1d2c4f), M_TROUSER = lam(0x2a2e35), M_SCAN = lam(0x2b2e33);
    const beamMat = new T.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.85, depthWrite: false });
    function makeWorker(o) {
      o = o || {};
      const group = new T.Group(), P = {};
      const skin = lam(o.skin || 0xe0b394), hair = lam(o.hair || 0x3a2a20);
      const add = (geo, mat, x, y, z, parent) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
      const joint = (x, y, z, parent) => { const g = new T.Group(); g.position.set(x, y, z); parent.add(g); return g; };
      P.hips = joint(0, 0.95, 0, group);
      add(geoC.hips, M_TROUSER, 0, 0, 0, P.hips);
      for (const side of [1, -1]) { // +x is their left
        const leg = joint(0.085 * side, 0, 0, P.hips), knee = joint(0, -0.44, 0, leg);
        add(geoW.thigh, M_TROUSER, 0, 0, 0, leg); add(geoW.shin, M_TROUSER, 0, 0, 0, knee); add(geoW.boot, M.boot, 0, -0.46, 0.05, knee);
        P[side > 0 ? 'legL' : 'legR'] = leg; P[side > 0 ? 'kneeL' : 'kneeR'] = knee;
      }
      P.torso = joint(0, 0.05, 0, P.hips);
      const body = add(geoC.torso, M_UNI, 0, 0.24, 0, P.torso); body.scale.set(1.12, 1, 0.66);
      add(geoW.collar, M_UNI, 0, 0.52, 0, P.torso);
      add(geoC.neck, skin, 0, 0.55, 0, P.torso);
      const plate = (map, x, y, w, h) => { const m = new T.Mesh(geoW.plate, new T.MeshBasicMaterial({ map })); m.position.set(x, y, 0.117); m.scale.set(w, h, 1); P.torso.add(m); return m; };
      const badge = signTex(256, 128, (g, w, h) => drawBadge(g, w, h, o.name || 'Sam'));
      plate(badge, 0.075, 0.36, 0.085, 0.043);
      plate(signTex(256, 128, (g, w, h) => { // the logo patch
        g.fillStyle = '#f2c400'; g.fillRect(0, 0, w, h); g.fillStyle = '#15396b'; g.textAlign = 'center'; g.textBaseline = 'middle';
        fit(g, 'CrashFix', 900, 70, w - 20); g.fillText('CrashFix', w / 2, h / 2 + 3);
      }), -0.075, 0.37, 0.085, 0.043);
      P.head = joint(0, 0.67, 0, P.torso);
      const head = add(geoC.head, skin, 0, 0, 0, P.head); head.scale.set(0.92, 1.05, 1);
      if (o.afro) { // an afro: a big round puff of hair round the top and back of the head (detailedfoil, 19 Nov 2026)
        if (!geoC.afro) geoC.afro = new T.SphereGeometry(0.15, 20, 16);
        const puff = add(geoC.afro, hair, 0, 0.09, -0.06, P.head); puff.scale.set(1, 0.95, 1);
      } else add(geoC.hair, hair, 0, 0.012, -0.008, P.head);
      add(geoC.nose, skin, 0, -0.005, 0.1, P.head);
      add(geoC.eye, M.black, -0.036, 0.02, 0.093, P.head); add(geoC.eye, M.black, 0.036, 0.02, 0.093, P.head);
      for (const side of [1, -1]) {
        const sh = joint(0.235 * side, 0.46, 0, P.torso), el = joint(0, -0.3, 0, sh);
        add(geoW.upper, M_UNI, 0, 0, 0, sh); add(geoW.fore, M_UNI, 0, 0, 0, el); add(geoC.hand, skin, 0, -0.31, 0, el);
        P[side > 0 ? 'shL' : 'shR'] = sh; P[side > 0 ? 'elL' : 'elR'] = el;
      }
      P.scanner = add(geoW.scanner, M_SCAN, 0, -0.33, 0.035, P.elR); // the handset, along the arm
      const screen = new T.Mesh(geoW.plate, new T.MeshBasicMaterial({ color: 0x6f9fd6 })); screen.scale.set(0.04, 0.05, 1); screen.position.set(0, 0.03, 0.019); P.scanner.add(screen);
      const carry = joint(0, 0.95, 0.42, group); // what they're carrying hangs off this
      const beam = new T.Mesh(unitBox, beamMat); beam.visible = false; beam.renderOrder = 4; scene.add(beam);
      scene.add(group);
      return { group, parts: P, carry, beam, phase: 0, t: 0, held: null, badge };
    }
    // the white name badge: navy strip along the top, the name in capitals
    function drawBadge(g, w, h, name) {
      const n = String(name || '').toUpperCase().slice(0, 14) || 'TRAINEE';
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); g.fillStyle = '#15396b'; g.fillRect(0, 0, w, 26);
      g.textAlign = 'center'; g.textBaseline = 'middle'; fit(g, n, 900, 74, w - 24); g.fillText(n, w / 2, 80);
    }
    function setBadge(w, name) { const c = w.badge.image; drawBadge(c.getContext('2d'), c.width, c.height, name); w.badge.needsUpdate = true; }
    // Sam's pose from what the worker (bot.js) is doing: walking, kneeling, carrying, typing, scanning, handing over
    const _wq = new T.Quaternion(), _we = new T.Euler(), _wv = new T.Vector3(), _wv2 = new T.Vector3(), DOWN = new T.Vector3(0, -1, 0);
    function poseWorker(w, b, dt) {
      const P = w.parts, k = Math.min(1, dt * 10), kb = Math.min(1, dt * 6.5);
      w.t += dt;
      w.group.position.set(b.x, 0, b.y); w.group.rotation.y = b.yaw;
      const steps = b.kneeling ? 0 : Math.min(1, Math.max(b.speed / 1.1, b.turning > 0.6 ? 0.35 : 0));
      w.phase += dt * (b.speed * 5.4 + (b.turning > 0.6 && b.speed < 0.2 ? 5 : 0));
      const sw = Math.sin(w.phase);
      let hipY = 0.95, lean = 0, headX = 0, headY = 0;
      let thL = sw * 0.42 * steps, thR = -sw * 0.42 * steps;
      let knL = Math.max(0, -Math.sin(w.phase - 0.9)) * 0.8 * steps, knR = Math.max(0, Math.sin(w.phase - 0.9)) * 0.8 * steps;
      let sL = -sw * 0.3 * steps, sR = sw * 0.3 * steps, zL = 0.07, zR = -0.07, eL = -0.15 - 0.2 * steps, eR = -0.15 - 0.2 * steps;
      const holding = b.carry && !b.toteDown;
      if (holding) { sL = sR = -0.45; zL = 0.14; zR = -0.14; eL = eR = -1.05; }
      if (b.atTill && !b.giving && !holding) { sL = sR = -0.42; zL = 0.1; zR = -0.1; eL = eR = -1.1; headX = 0.22; lean = 0.05; }
      if (b.walking && !b.carry && !(b.queue && b.queue.there) && b.trolley) { sL = sR = -0.75; zL = 0.1; zR = -0.1; eL = eR = -0.55; lean = 0.08; }
      if (b.typing) { eL += Math.sin(w.t * 23) * 0.07; eR += Math.sin(w.t * 19 + 1) * 0.07; headX = 0.3; }
      if (b.reading) { sR = -0.55; zR = -0.05; eR = -1.6; headX = 0.4; }
      if (b.kneeling) { hipY = 0.5; lean = 0.32; thL = -1.5; knL = 1.5; thR = 0.12; knR = 1.62; headX = 0.25; if (!holding) { sL = -0.5; eL = -0.7; } }
      if (b.bending) { lean = 0.6; hipY = 0.87; thL = thR = -0.36; knL = knR = 0.58; sL = sR = -0.95; zL = 0.12; zR = -0.12; eL = eR = -0.25; headX = 0.2; }
      if (b.giving) { sL = sR = -1.15; zL = 0.12; zR = -0.12; eL = eR = -0.3; lean = 0.12; headX = 0.1; }
      if (b.lookT > 0) headY = Math.sin(w.t * 2.6) * 0.8;
      P.hips.position.y += (hipY - P.hips.position.y) * kb;
      P.torso.rotation.x += (lean - P.torso.rotation.x) * kb;
      P.legL.rotation.x += (thL - P.legL.rotation.x) * kb; P.legR.rotation.x += (thR - P.legR.rotation.x) * kb;
      P.kneeL.rotation.x += (knL - P.kneeL.rotation.x) * kb; P.kneeR.rotation.x += (knR - P.kneeR.rotation.x) * kb;
      P.elL.rotation.x += (eL - P.elL.rotation.x) * k;
      P.head.rotation.x += (headX - P.head.rotation.x) * k; P.head.rotation.y += (headY - P.head.rotation.y) * Math.min(1, dt * 4);
      P.shL.quaternion.slerp(_wq.setFromEuler(_we.set(sL, 0, zL)), k);
      // the scanner arm points at what they're scanning
      if (b.aim) {
        w.group.updateMatrixWorld(true);
        _wv.set(b.aim.x, b.aim.z, b.aim.y); P.torso.worldToLocal(_wv); _wv.sub(P.shR.position).normalize();
        _wq.setFromUnitVectors(DOWN, _wv); P.shR.quaternion.slerp(_wq, Math.min(1, dt * 9));
        P.elR.rotation.x += (-0.05 - P.elR.rotation.x) * k;
      } else {
        P.shR.quaternion.slerp(_wq.setFromEuler(_we.set(sR, 0, zR)), k);
        P.elR.rotation.x += (eR - P.elR.rotation.x) * k;
      }
      // the tote in their hands, or down on the floor beside them while they pick; a bag or a box in front
      const c = w.carry, down = b.toteDown && b.carry === 'tote';
      const tx = down ? -0.55 : 0, ty = down ? 0 : b.carry === 'box' ? 1.0 : b.carry === 'bag' ? 0.96 : 0.95, tz = down ? 0.08 : b.carry === 'tote' ? 0.42 : 0.36;
      c.position.x += (tx - c.position.x) * kb; c.position.y += (ty - c.position.y) * kb; c.position.z += (tz - c.position.z) * kb;
      c.rotation.y += ((down ? Math.PI / 2 : 0) - c.rotation.y) * kb;
      // the scanner's red line, for a moment after each scan
      if (b.beam > 0 && b.beamTo) {
        w.group.updateMatrixWorld(true);
        P.scanner.localToWorld(_wv.set(0, -0.085, 0)); _wv2.set(b.beamTo.x, b.beamTo.z, b.beamTo.y);
        const L = _wv.distanceTo(_wv2);
        w.beam.position.copy(_wv).lerp(_wv2, 0.5); w.beam.lookAt(_wv2); w.beam.scale.set(0.007, 0.007, L); w.beam.visible = true;
      } else if (w.beam.visible) w.beam.visible = false;
    }

    /* ---------- light ---------- */
    const hemi = new T.HemisphereLight(0xffffff, 0x8d9096, 2.15);
    scene.add(hemi);
    const sun = new T.DirectionalLight(0xffffff, 0.85); sun.position.set(W * 0.3, 30, D * 0.8); sun.target.position.set(W / 2, 0, D / 2);
    scene.add(sun, sun.target);
    const fill = new T.DirectionalLight(0xffffff, 0.35); fill.position.set(W, 12, -10); fill.target.position.set(W / 2, 0, D / 2);
    scene.add(fill, fill.target);

    /* ---------- highlights: what you're aiming at, the hint glow ---------- */
    const aimBox = new T.LineSegments(new T.EdgesGeometry(unitBox), new T.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: true }));
    aimBox.visible = false; aimBox.renderOrder = 5; scene.add(aimBox);
    const glowMat = new T.MeshBasicMaterial({ color: 0xffb400, transparent: true, opacity: 0.5, depthWrite: false, blending: T.AdditiveBlending });
    const glow = new T.Mesh(unitBox, glowMat); glow.visible = false; glow.renderOrder = 6; scene.add(glow);
    const glowEdges = new T.LineSegments(new T.EdgesGeometry(unitBox), new T.LineBasicMaterial({ color: 0xffd34d, transparent: true }));
    glow.add(glowEdges);
    const signGlow = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ color: 0xffd000, transparent: true, opacity: 0.6, depthWrite: false, blending: T.AdditiveBlending }));
    signGlow.visible = false; signGlow.renderOrder = 6; scene.add(signGlow);

    // the box round a location: its tray, or the space for its product on the shelf (with its label)
    function locBox(loc) {
      const f = loc.face, dp = world.DEEP[f.kind];
      if (loc.tray >= 0) {
        const tr = trays.get(trayKey(loc));
        const s = tr ? tr.slide * 0.32 : 0;
        return { x: tr.x, y: f.front - f.out * (dp / 2) + f.out * s, z0: tr.z - 0.012, z1: tr.z + tr.h + 0.006, w: tr.w + 0.012, d: dp + 0.02 };
      }
      const it = loc.item, top = it ? it.box.z + it.box.h + 0.02 : loc.z0 + Math.min(0.25, (loc.z1 - loc.z0) * 0.6);
      const pull = it ? (it.pull || 0) : 0;
      return { x: (loc.x0 + loc.x1) / 2, y: f.front - f.out * (dp / 2 - pull / 2), z0: loc.z0 - (f.kind === 'BB' ? 0.1 : 0.07), z1: top, w: loc.x1 - loc.x0, d: dp + 0.02 + pull };
    }
    function setBox(obj, b, grow) {
      obj.position.set(b.x, (b.z0 + b.z1) / 2, b.y);
      obj.scale.set(b.w + (grow || 0), b.z1 - b.z0 + (grow || 0), b.d + (grow || 0));
    }

    /* ---------- moving things: trays sliding out, boxes pulled forward ---------- */
    function placeTray(tr) {
      const s = tr.slide * 0.32 * tr.out;
      _m.copy(tr.base); _m.elements[14] += s;
      tr.mesh.setMatrixAt(tr.i, _m); tr.mesh.instanceMatrix.needsUpdate = true;
      for (const it of tr.items) { it.mesh.setMatrixAt(it.i, boxMatrix(it.box, s)); it.mesh.instanceMatrix.needsUpdate = true; }
      const a = labelMesh.instanceMatrix.array;
      for (const li of tr.labels) { for (let k = 0; k < 16; k++) a[li * 16 + k] = labelBase[li * 16 + k]; a[li * 16 + 14] += s; }
      labelMesh.instanceMatrix.needsUpdate = true;
    }
    function placeItem(it) { // a box pulled forward off its shelf, or hidden while it's in the air
      it.mesh.setMatrixAt(it.i, it.hidden ? HIDE : boxMatrix(it.box, it.loc.face.out * (it.pull || 0)));
      it.mesh.instanceMatrix.needsUpdate = true;
    }
    function trayOf(loc) { return loc.tray >= 0 ? trays.get(trayKey(loc)) : null; }
    // a product left its place (out of stock) or was put into an empty one (World.vacate / World.place)
    function stockChange(it) {
      if (it.trayRef) { const k = it.trayRef.items.indexOf(it); if (k >= 0) it.trayRef.items.splice(k, 1); it.trayRef = null; }
      it.pull = 0; it.pullTarget = 0;
      if (!it.loc) { it.hidden = true; it.mesh.setMatrixAt(it.i, HIDE); it.mesh.instanceMatrix.needsUpdate = true; return; }
      it.hidden = false; it.box = itemBox(it);
      const tr = trays.get(trayKey(it.loc));
      if (it.loc.tray >= 0 && tr) { tr.items.push(it); it.trayRef = tr; placeTray(tr); } else placeItem(it);
    }

    return {
      scene, groups, photos: { update: updatePhotos, flush: flushPhotos, fill: fillPhotos, setExtra: (list) => { extra = list; }, slots: SLOTS, big },
      labelMesh, labelMat, trays, trayOf, placeTray, placeItem, stockChange, setStool, locBox, setBox, aimBox, glow, glowMat, signGlow, endSigns, customer, makeCustomer, makeTote, dropTote, toteBox, makeWorker, poseWorker, lamps, M,
      makeTrolley, poseTrolley, trolleyTop, trolleyTake, tillScreen, delivery: { set: deliverySet, show: deliveryShow, box: slotBox },
      hold: hold ? { spots: hold.spots, set: setParcel, carry: carryParcel } : null,
      cctv: () => cctv, setBadge, floorZone,
      clockTick, pressBell(down) { bellButton.position.z = world.bell.y - (down ? 0.032 : 0.06); }, counts: { tags: tags.length, trays: trays.size, items: world.items.length }
    };
  }

  root.ShiftScene = { build };
})(window);
