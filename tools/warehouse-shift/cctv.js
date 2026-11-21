/* Warehouse Shift: the CCTV monitor (detailedfoil, 21 Nov 2026). It replaces the team notice board: a bigger screen with
   a 2D map of the shop floor seen from above, the counter on the left and the front door on the right (as if you stood
   behind the counter looking at the door). The floor in front of the counter is marked pale red where customers wait to
   be served (on your right as you serve) and pale green where they wait for orders they've paid for (on your left), both
   labelled; every customer is a dot in their own shirt colour, ringed by what they're doing, and staff (players and Sam)
   are navy dots with their initial. A panel on the right counts each kind.
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
    const X0 = room.x0 - 0.35, X1 = room.x1 + 0.35, Y0 = counter.y0 - 1.1, Y1 = world.D + 0.7;
    const HEAD = 46, PAD = 16, mapH = H - HEAD - PAD, k = mapH / (X1 - X0), mapW = (Y1 - Y0) * k;
    const MX = PAD, MY = HEAD;
    const u = (y) => MX + (y - Y0) * k, v = (x) => MY + (X1 - x) * k; // world (x, y) -> the screen
    const rect = (r) => { const a = u(r.y0), b = u(r.y1), c = v(r.x1), d = v(r.x0); return [a, c, b - a, d - c]; };
    const inShop = (x, y) => x > X0 && x < X1 && y > Y0 && y < Y1;
    const panelX = MX + mapW + 22;

    // the still parts, drawn once
    const still = document.createElement('canvas'); still.width = W; still.height = H;
    (function () {
      const s = still.getContext('2d');
      s.fillStyle = '#0d1418'; s.fillRect(0, 0, W, H);
      // the floor
      s.fillStyle = '#1b262c'; s.fillRect(...rect({ x0: room.x0, x1: room.x1, y0: counter.y0 - 1.1, y1: world.D }));
      // the two waiting areas, pale red and pale green, labelled
      const zone = (z, fill, edge, text) => {
        const [a, b, w, h] = rect(z);
        s.fillStyle = fill; s.fillRect(a, b, w, h);
        s.strokeStyle = edge; s.lineWidth = 2; s.setLineDash([7, 5]); s.strokeRect(a + 1, b + 1, w - 2, h - 2); s.setLineDash([]);
        s.save(); s.fillStyle = edge; s.textAlign = 'center'; s.textBaseline = 'middle';
        const lines = text.split('\n'), px = Math.min(15, Math.floor(w / 7.4));
        s.font = '800 ' + px + 'px ' + FONT;
        lines.forEach((t, i) => s.fillText(t, a + w / 2, b + h - 12 - (lines.length - 1 - i) * (px + 3)));
        s.restore();
      };
      zone(zones.queue, 'rgba(255,120,120,.26)', '#ff9b9b', 'WAITING TO\nBE SERVED');
      zone(zones.wait, 'rgba(110,230,150,.24)', '#8ff0b0', 'WAITING FOR\nORDERS');
      // walls
      s.strokeStyle = '#8fa3b0'; s.lineWidth = 4;
      const [ra, rb, rw, rh] = rect(room); s.strokeRect(ra, rb, rw, rh);
      // the front door: a gap in the right-hand wall, labelled
      const ent = world.openings.find((p) => p.type === 'entrance');
      if (ent) {
        const a = v(ent.to), b = v(ent.from), x = u(world.D);
        s.fillStyle = '#1b262c'; s.fillRect(x - 4, a, 8, b - a);
        s.strokeStyle = '#5fe08a'; s.lineWidth = 3; s.beginPath(); s.moveTo(x, a); s.lineTo(x + 14, a + 10); s.moveTo(x, b); s.lineTo(x + 14, b - 10); s.stroke();
        s.save(); s.translate(x + 26, (a + b) / 2); s.rotate(Math.PI / 2); s.fillStyle = '#8fa3b0'; s.font = '700 13px ' + FONT; s.textAlign = 'center'; s.fillText('DOOR', 0, 0); s.restore();
      }
      // glass in the front wall
      s.strokeStyle = '#4f6a7a'; s.lineWidth = 4;
      world.openings.filter((p) => p.type === 'glass' && p.wall === 'front').forEach((p) => { s.beginPath(); s.moveTo(u(world.D), v(p.from)); s.lineTo(u(world.D), v(p.to)); s.stroke(); });
      // shelving in the shop
      world.objects.filter((ob) => ob.kind === 'gondola' && ob.x1 > room.x0 && ob.x0 < room.x1 && ob.y0 >= room.y0 - 0.01).forEach((ob) => {
        s.fillStyle = '#34444e'; s.fillRect(...rect(ob)); s.strokeStyle = '#526670'; s.lineWidth = 1.5; s.strokeRect(...rect(ob));
      });
      // the counter and its tills
      s.fillStyle = '#5b6b78'; s.fillRect(...rect(counter));
      s.fillStyle = '#c8d3dc'; s.font = '800 13px ' + FONT; s.textAlign = 'center'; s.textBaseline = 'middle';
      const cr = rect(counter);
      s.save(); s.translate(cr[0] + cr[2] / 2, cr[1] + cr[3] / 2); s.rotate(-Math.PI / 2); s.fillText('COUNTER', 0, 0); s.restore();
      const tills = world.objects.filter((ob) => ob.kind === 'till' && ob.x0 >= counter.x0 - 0.01 && ob.x1 <= counter.x1 + 0.01).sort((a, b) => b.x0 - a.x0);
      tills.forEach((t, i) => {
        const cx = u(counter.y0) - 9, cy = v((t.x0 + t.x1) / 2);
        s.fillStyle = '#26323a'; s.beginPath(); s.arc(cx, cy, 9, 0, Math.PI * 2); s.fill();
        s.fillStyle = '#c8d3dc'; s.font = '800 11px ' + FONT; s.fillText(String(tills.length - i), cx, cy + 0.5);
      });
      // the panel
      s.fillStyle = '#111b20'; s.fillRect(panelX - 8, HEAD, W - panelX - PAD + 8, mapH);
      s.strokeStyle = '#26343c'; s.lineWidth = 2; s.strokeRect(panelX - 8, HEAD, W - panelX - PAD + 8, mapH);
      // scan lines
      s.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0; y < H; y += 3) s.fillRect(0, y, W, 1);
      const vg = s.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)');
      s.fillStyle = vg; s.fillRect(0, 0, W, H);
    })();

    function draw(data) {
      g.drawImage(still, 0, 0);
      const now = data.now || new Date();
      // the top line
      g.fillStyle = '#e8f1f5'; g.font = '800 22px ' + FONT; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText('CAM 01  SHOP FLOOR', PAD, 24);
      const hh = (n) => String(n).padStart(2, '0');
      g.textAlign = 'right'; g.font = '700 22px ui-monospace,Menlo,Consolas,monospace';
      g.fillText(hh(now.getDate()) + '/' + hh(now.getMonth() + 1) + '  ' + hh(now.getHours()) + ':' + hh(now.getMinutes()) + ':' + hh(now.getSeconds()), W - PAD, 24);
      if (now.getSeconds() % 2 === 0) { g.fillStyle = '#ff3b30'; g.beginPath(); g.arc(W - PAD - 270, 24, 8, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#ff6b6b'; g.font = '800 18px ' + FONT; g.textAlign = 'right'; g.fillText('REC', W - PAD - 228, 25);
      // people: customers first, staff on top
      const people = (data.people || []).filter((p) => inShop(p.x, p.y));
      const counts = { queue: 0, till: 0, wait: 0, staff: 0 };
      people.sort((a, b) => (a.staff ? 1 : 0) - (b.staff ? 1 : 0)).forEach((p) => {
        const x = u(p.y), y = v(p.x);
        if (p.staff) {
          counts.staff++;
          g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#1d2c4f'; g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#f2c400'; g.font = '900 13px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText((p.label || '?').charAt(0).toUpperCase(), x, y + 0.5);
          return;
        }
        const st = p.state || 'walk';
        if (st === 'queue' || st === 'greet') counts.queue++; else if (st === 'till') counts.till++; else if (st === 'wait') counts.wait++;
        g.fillStyle = RING[st] || RING.walk; g.globalAlpha = 0.28; g.beginPath(); g.arc(x, y, 17, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
        g.strokeStyle = RING[st] || RING.walk; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.stroke();
        g.fillStyle = p.colour || '#f07a1a'; g.beginPath(); g.arc(x, y, 8.5, 0, Math.PI * 2); g.fill();
        if (st === 'greet') { g.fillStyle = '#ffffff'; g.font = '900 15px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', x, y - 21); }
      });
      // the counts
      const rows = [['Waiting to be served', counts.queue, '#ff6b6b'], ['At a till', counts.till, '#ffc93c'], ['Waiting for orders', counts.wait, '#5fe08a'], ['Staff on the floor', counts.staff, '#6f8fd6']];
      const top = HEAD + 22, gap = Math.min(96, (mapH - 40) / rows.length);
      rows.forEach((r, i) => {
        const y = top + i * gap;
        g.fillStyle = r[2]; g.fillRect(panelX + 6, y + 4, 16, 16);
        g.fillStyle = '#c8d3dc'; g.font = '700 19px ' + FONT; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(r[0], panelX + 32, y + 2);
        g.fillStyle = r[1] ? '#ffffff' : '#5d6d77'; g.font = '900 46px ' + FONT; g.fillText(String(r[1]), panelX + 30, y + 26);
      });
      const unGreeted = people.filter((p) => p.state === 'greet').length;
      if (unGreeted) {
        g.fillStyle = now.getMilliseconds() < 500 ? '#ff6b6b' : '#c94a4a'; g.font = '900 20px ' + FONT; g.textAlign = 'left'; g.textBaseline = 'bottom';
        g.fillText(unGreeted === 1 ? '! 1 to greet' : '! ' + unGreeted + ' to greet', panelX + 6, HEAD + mapH - 12);
      }
      return counts;
    }
    return { draw, map: { u, v, X0, X1, Y0, Y1 } };
  }

  root.ShiftCCTV = { create };
})(typeof window !== 'undefined' ? window : globalThis);
