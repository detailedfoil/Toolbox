/* Warehouse Shift: the CCTV monitor (detailedfoil, 21 Nov 2026). It replaces the team notice board: a bigger screen with
   a 2D map of the shop floor seen from above, the counter along the bottom and the front door at the top (as
   if you stood behind the counter looking at the door), filling the screen (landscape; no count panel, 21 Nov 2026). The floor in front of the counter is marked pale red where customers wait to
   be served (on your right as you serve) and pale green where they wait for orders they've paid for (on your left), both
   labelled; every customer is a dot in their own shirt colour, ringed by what they're doing, and staff (players and Sam)
   are navy squares with their initial.
   Shared, no three.js: create({ canvas, world, zones }) draws the still parts once; draw(data) draws a frame.
   data = { people: [{ x, y, staff, state: 'queue'|'greet'|'till'|'wait'|'walk', colour: '#rrggbb', label }], now: Date } */
(function (root) {
  'use strict';
  const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
  const RING = { queue: '#ff6b6b', greet: '#ff6b6b', till: '#ffc93c', wait: '#5fe08a', walk: '#cfd8e3' };

  function create(o) {
    const cv = o.canvas, g = cv.getContext('2d'), W = cv.width, H = cv.height, world = o.world, zones = o.zones;
    const room = world.rooms.find((r) => r.name === 'Trade counter'), counter = world.counter;
    // what the camera sees: the shop, the strip behind the counter, a little outside the door
    const X0 = room.x0 - 0.2, X1 = room.x1 + 0.2, Y0 = counter.y0 - 0.65, Y1 = world.D + 0.4;
    const K = W / 1024; // text and marks scale with the canvas (it's 2048 wide on the big wall screen)
    // landscape (detailedfoil, 21 Nov 2026): the counter along the bottom, the front door at the top, the map as
    // big as the screen allows under a slim top line. Right on the screen is still the small-x side (your right hand as you
    // stand behind the counter looking at the door).
    const HEAD = Math.round(52 * K), PAD = Math.round(10 * K);
    const availW = W - 2 * PAD, availH = H - HEAD - PAD;
    const k = Math.min(availW / (X1 - X0), availH / (Y1 - Y0)), mapW = (X1 - X0) * k, mapH = (Y1 - Y0) * k;
    const MX = (W - mapW) / 2, MY = HEAD + (availH - mapH) / 2;
    const u = (x) => MX + (X1 - x) * k, v = (y) => MY + mapH - (y - Y0) * k; // world (x, y) -> the screen
    const rect = (r) => { const a = u(r.x1), b = v(r.y1), c = u(r.x0), d = v(r.y0); return [a, b, c - a, d - b]; };
    const inShop = (x, y) => x > X0 && x < X1 && y > Y0 && y < Y1;
    const R = k / 66; // map marks scale with the map
    const px = (n, w) => (w || 800) + ' ' + Math.round(n * K) + 'px ' + FONT;

    // the still parts, drawn once
    const still = document.createElement('canvas'); still.width = W; still.height = H;
    (function () {
      const s = still.getContext('2d');
      s.fillStyle = '#0d1418'; s.fillRect(0, 0, W, H);
      // the floor
      s.fillStyle = '#1b262c'; s.fillRect(...rect({ x0: room.x0, x1: room.x1, y0: Y0, y1: world.D }));
      // the two waiting areas, pale red and pale green, labelled
      const zone = (z, fill, edge, text) => {
        const [a, b, w, h] = rect(z);
        s.fillStyle = fill; s.fillRect(a, b, w, h);
        s.strokeStyle = edge; s.lineWidth = 2 * K; s.setLineDash([7 * K, 5 * K]); s.strokeRect(a + 1, b + 1, w - 2, h - 2); s.setLineDash([]);
        s.save(); s.fillStyle = edge; s.textAlign = 'center'; s.textBaseline = 'middle';
        const lines = text.split('\n'), fs = Math.min(26 * K, Math.floor(w / 6.6));
        s.font = '800 ' + fs + 'px ' + FONT;
        lines.forEach((t, i) => s.fillText(t, a + w / 2, b + h - 14 * K - (lines.length - 1 - i) * (fs + 4 * K)));
        s.restore();
      };
      zone(zones.queue, 'rgba(255,120,120,.26)', '#ff9b9b', 'WAITING TO\nBE SERVED');
      zone(zones.wait, 'rgba(110,230,150,.24)', '#8ff0b0', 'WAITING FOR\nORDERS');
      // walls
      s.strokeStyle = '#8fa3b0'; s.lineWidth = 4 * K;
      const [ra, rb, rw, rh] = rect(room); s.strokeRect(ra, rb, rw, rh);
      // the front door: a gap in the front wall (the top of the map), labelled
      const ent = world.openings.find((p) => p.type === 'entrance');
      if (ent) {
        const a = u(ent.to), b = u(ent.from), y = v(world.D);
        s.fillStyle = '#1b262c'; s.fillRect(a, y - 4 * K, b - a, 8 * K);
        s.strokeStyle = '#5fe08a'; s.lineWidth = 3 * K; s.beginPath(); s.moveTo(a, y); s.lineTo(a + 10 * K, y + 14 * K); s.moveTo(b, y); s.lineTo(b - 10 * K, y + 14 * K); s.stroke();
        s.fillStyle = '#8fa3b0'; s.font = px(24, 700); s.textAlign = 'center'; s.textBaseline = 'middle'; s.fillText('DOOR', (a + b) / 2, y + 34 * K);
      }
      // glass in the front wall
      s.strokeStyle = '#4f6a7a'; s.lineWidth = 4 * K;
      world.openings.filter((p) => p.type === 'glass' && p.wall === 'front').forEach((p) => { s.beginPath(); s.moveTo(u(p.to), v(world.D)); s.lineTo(u(p.from), v(world.D)); s.stroke(); });
      // shelving in the shop
      world.objects.filter((ob) => ob.kind === 'gondola' && ob.x1 > room.x0 && ob.x0 < room.x1 && ob.y0 >= room.y0 - 0.01).forEach((ob) => {
        s.fillStyle = '#34444e'; s.fillRect(...rect(ob)); s.strokeStyle = '#526670'; s.lineWidth = 1.5 * K; s.strokeRect(...rect(ob));
      });
      // the counter
      s.fillStyle = '#5b6b78'; s.fillRect(...rect(counter));
      const cr = rect(counter);
      s.fillStyle = '#c8d3dc'; s.font = px(26); s.textAlign = 'center'; s.textBaseline = 'middle'; s.fillText('COUNTER', cr[0] + cr[2] * 0.5, cr[1] + cr[3] / 2 + K);
      // scan lines
      s.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0; y < H; y += 3 * K) s.fillRect(0, y, W, K);
      const vg = s.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)');
      s.fillStyle = vg; s.fillRect(0, 0, W, H);
    })();

    function draw(data) {
      g.drawImage(still, 0, 0);
      const now = data.now || new Date();
      // the top line
      const ty = HEAD / 2;
      g.fillStyle = '#e8f1f5'; g.font = px(32); g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText('CAM 01  SHOP FLOOR', PAD, ty);
      const hh = (n) => String(n).padStart(2, '0');
      g.textAlign = 'right'; g.font = '700 ' + Math.round(32 * K) + 'px ui-monospace,Menlo,Consolas,monospace';
      g.fillText(hh(now.getDate()) + '/' + hh(now.getMonth() + 1) + '  ' + hh(now.getHours()) + ':' + hh(now.getMinutes()) + ':' + hh(now.getSeconds()), W - PAD, ty);
      if (now.getSeconds() % 2 === 0) { g.fillStyle = '#ff3b30'; g.fillRect(W - PAD - 407 * K, ty - 7 * K, 14 * K, 14 * K); }
      g.fillStyle = '#ff6b6b'; g.font = px(26); g.textAlign = 'right'; g.fillText('REC', W - PAD - 340 * K, ty + K);
      // people: customers first, staff on top
      const people = (data.people || []).filter((p) => inShop(p.x, p.y));
      const counts = { queue: 0, till: 0, wait: 0, staff: 0 };
      people.sort((a, b) => (a.staff ? 1 : 0) - (b.staff ? 1 : 0)).forEach((p) => {
        const x = u(p.x), y = v(p.y);
        if (p.staff) {
          counts.staff++;
          g.fillStyle = '#ffffff'; g.fillRect(x - 13 * R, y - 13 * R, 26 * R, 26 * R);
          g.fillStyle = '#1d2c4f'; g.fillRect(x - 11 * R, y - 11 * R, 22 * R, 22 * R);
          g.fillStyle = '#f2c400'; g.font = '900 ' + Math.round(14 * R) + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText((p.label || '?').charAt(0).toUpperCase(), x, y + 0.5);
          return;
        }
        const st = p.state || 'walk';
        if (st === 'queue' || st === 'greet') counts.queue++; else if (st === 'till') counts.till++; else if (st === 'wait') counts.wait++;
        g.fillStyle = RING[st] || RING.walk; g.globalAlpha = 0.28; g.beginPath(); g.arc(x, y, 30 * R, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
        g.strokeStyle = RING[st] || RING.walk; g.lineWidth = 3 * R; g.beginPath(); g.arc(x, y, 21 * R, 0, Math.PI * 2); g.stroke();
        g.fillStyle = p.colour || '#f07a1a'; g.beginPath(); g.arc(x, y, 17 * R, 0, Math.PI * 2); g.fill();
        if (st === 'greet') { g.fillStyle = '#ffffff'; g.font = '900 ' + Math.round(20 * R) + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', x, y - 38 * R); }
      });
      return counts;
    }
    return { draw, map: { u, v, X0, X1, Y0, Y1, k } };
  }

  root.ShiftCCTV = { create };
})(typeof window !== 'undefined' ? window : globalThis);
