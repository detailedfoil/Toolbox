/* Photo Coin Counter 2: reads a photo of MIXED coins and works out which coin each one is.
   Finding the coins is the same rim-voting reader as Photo Coin Counter (till-count/coins.js), copied here
   and widened so coins of different sizes are all found. Then for every coin it measures three things:
     metal  copper (1p, 2p), silver (5p, 10p, 20p, 50p) or two-tone, a gold ring round a silver middle (£1, £2)
     shape  round, seven-sided (20p, 50p) or twelve-sided (£1), from the outline traced all the way round
     size   next to the other coins. A photo has no ruler, so it tries every scale and keeps the one where the
            coins come out the right size for their metal and shape. Coins further from the camera look
            smaller, so the scale may change steadily across the photo.
   If the coins could be read two ways (a pile of only 5p-or-10p sized coins, say), it says so and asks.
   window.MixedCoins.read({data, width, height}) -> {coins, maybe, ask, warn, scale}
   window.MixedCoins.solve(coins) works the coins out again, keeping any you've set yourself (coin.set).
   Positions and sizes are in the pixels of the image given. Also loaded by the tests (module.exports). */
(function (root) {
  'use strict';

  var VERSION = '2026-10-22a';
  var WORK = 1000; // finding the coins: the photo is looked at no bigger than this (long side)
  var RAYS = 144;  // tracing a coin's outline: one look every 2.5 degrees

  /* every UK coin in use. mm: the size a coin's outline averages out at (the width for round coins) */
  var COINS = [
    { id: 'c200', p: 200, label: '£2', mm: 28.4, metal: 'two', sides: 0 },
    { id: 'c100', p: 100, label: '£1', mm: 23.43, metal: 'two', sides: 12 },
    { id: 'c50', p: 50, label: '50p', mm: 27.3, metal: 'silver', sides: 7 },
    { id: 'c20', p: 20, label: '20p', mm: 21.4, metal: 'silver', sides: 7 },
    { id: 'c10', p: 10, label: '10p', mm: 24.5, metal: 'silver', sides: 0 },
    { id: 'c5', p: 5, label: '5p', mm: 18.0, metal: 'silver', sides: 0 },
    { id: 'c2', p: 2, label: '2p', mm: 25.9, metal: 'copper', sides: 0 },
    { id: 'c1', p: 1, label: '1p', mm: 20.3, metal: 'copper', sides: 0 }
  ];
  var BY = {};
  COINS.forEach(function (d) { BY[d.id] = d; });

  /* the outline of a 20p or 50p (a Reuleaux heptagon: seven arcs, the same width every way) and of the £1
     (twelve sides), as distance from the middle at each angle, for a coin 1 wide. Gives the average distance
     (so a traced outline can be compared) and how strongly the 7 or 12 bumps show (shape test). */
  function heptagon(t) {
    var R = 1 / (2 * Math.cos(Math.PI / 14)), seg = 2 * Math.PI / 7;
    var b = ((t % seg) + seg) % seg - seg / 2; // angle from the middle of an arc
    var beta = Math.PI + b;
    return R * Math.cos(beta) + Math.sqrt(1 - R * R * Math.sin(beta) * Math.sin(beta));
  }
  function dodecagon(t) { // 1 across the corners
    var seg = Math.PI / 6, b = ((t % seg) + seg) % seg - seg / 2;
    return 0.5 * Math.cos(Math.PI / 12) / Math.cos(b);
  }
  function profile(fn, k) {
    var n = 3600, sum = 0, re = 0, im = 0, i, t, v;
    for (i = 0; i < n; i++) { t = 2 * Math.PI * i / n; v = fn(t); sum += v; re += v * Math.cos(k * t); im += v * Math.sin(k * t); }
    var mean = sum / n;
    return { mean: mean, amp: 2 * Math.sqrt(re * re + im * im) / n / mean };
  }
  var HEPT = profile(heptagon, 7), DODE = profile(dodecagon, 12);
  COINS.forEach(function (d) {
    d.eff = d.sides === 7 ? d.mm * 2 * HEPT.mean : d.sides === 12 ? d.mm * 2 * DODE.mean : d.mm;
  });

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function sig(z) { return 1 / (1 + Math.exp(-z)); }
  function median(a) {
    if (!a.length) return NaN;
    var s = Array.prototype.slice.call(a).sort(function (p, q) { return p - q; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* ---------- finding the coins (from coins.js) ---------- */

  /* grey copy, shrunk so the long side is at most WORK (each pixel the average of the ones it covers) */
  function grey(img) {
    var W0 = img.width, H0 = img.height, src = img.data, L0 = Math.max(W0, H0);
    var f = L0 > WORK ? WORK / L0 : 1, W = Math.max(1, Math.round(W0 * f)), H = Math.max(1, Math.round(H0 * f));
    var sum = new Float32Array(W * H), cnt = new Float32Array(W * H), x, y, i, j, row;
    for (y = 0; y < H0; y++) {
      row = Math.min(H - 1, Math.floor(y * f)) * W;
      for (x = 0; x < W0; x++) {
        j = (y * W0 + x) * 4; i = row + Math.min(W - 1, Math.floor(x * f));
        sum[i] += 0.299 * src[j] + 0.587 * src[j + 1] + 0.114 * src[j + 2]; cnt[i]++;
      }
    }
    for (i = 0; i < W * H; i++) sum[i] = cnt[i] ? sum[i] / cnt[i] : 0;
    return { g: sum, W: W, H: H, f: f };
  }

  /* box blur, radius r, both directions */
  function blur(a, W, H, r) {
    var tmp = new Float32Array(a.length), out = new Float32Array(a.length), d = 2 * r + 1, x, y, k, o, sum;
    for (y = 0; y < H; y++) {
      o = y * W; sum = 0;
      for (k = -r; k <= r; k++) sum += a[o + clamp(k, 0, W - 1)];
      for (x = 0; x < W; x++) {
        tmp[o + x] = sum / d;
        sum += a[o + Math.min(x + r + 1, W - 1)] - a[o + Math.max(x - r, 0)];
      }
    }
    for (x = 0; x < W; x++) {
      sum = 0;
      for (k = -r; k <= r; k++) sum += tmp[clamp(k, 0, H - 1) * W + x];
      for (y = 0; y < H; y++) {
        out[y * W + x] = sum / d;
        sum += tmp[Math.min(y + r + 1, H - 1) * W + x] - tmp[Math.max(y - r, 0) * W + x];
      }
    }
    return out;
  }

  /* thin edges (the strongest point across each edge), with their direction, kept in a grid for quick lookups */
  function edgePoints(g, W, H, opt) {
    var s = blur(blur(g, W, H, 1), W, H, 1), n = W * H;
    var gx = new Float32Array(n), gy = new Float32Array(n), mag = new Float32Array(n), x, y, i, a, b, ax, ay, m;
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) {
      i = y * W + x;
      a = s[i - W + 1] + 2 * s[i + 1] + s[i + W + 1] - s[i - W - 1] - 2 * s[i - 1] - s[i + W - 1];
      b = s[i + W - 1] + 2 * s[i + W] + s[i + W + 1] - s[i - W - 1] - 2 * s[i - W] - s[i - W + 1];
      gx[i] = a; gy[i] = b; mag[i] = Math.sqrt(a * a + b * b);
    }
    // the desk's own grain sets the bar: the smoothest 15% of the photo (in 16 pixel squares) is desk
    var B = 16, BW = Math.floor(W / B), BH = Math.floor(H / B), blocks = [], bx, by, sum;
    for (by = 0; by < BH; by++) for (bx = 0; bx < BW; bx++) {
      sum = 0;
      for (y = by * B; y < by * B + B; y++) for (x = bx * B; x < bx * B + B; x++) sum += mag[y * W + x];
      blocks.push(sum / (B * B));
    }
    blocks.sort(function (p, q) { return p - q; });
    var med = blocks.length ? blocks[Math.floor(blocks.length * 0.15)] : 5;
    var t = opt.edge || clamp(med * 5, 24, 60);
    var X = [], Y = [], UX = [], UY = [];
    for (y = 2; y < H - 2; y++) for (x = 2; x < W - 2; x++) {
      i = y * W + x; m = mag[i];
      if (m <= t) continue;
      ax = Math.abs(gx[i]); ay = Math.abs(gy[i]);
      if (ay <= ax * 0.4142) { a = mag[i - 1]; b = mag[i + 1]; }
      else if (ax <= ay * 0.4142) { a = mag[i - W]; b = mag[i + W]; }
      else if (gx[i] * gy[i] > 0) { a = mag[i - W - 1]; b = mag[i + W + 1]; }
      else { a = mag[i - W + 1]; b = mag[i + W - 1]; }
      if (m < a || m < b) continue;
      X.push(x); Y.push(y); UX.push(gx[i] / m); UY.push(gy[i] / m);
    }
    var C = 16, GW = Math.ceil(W / C), GH = Math.ceil(H / C), start = new Int32Array(GW * GH + 1), k, cell;
    var cellOf = new Int32Array(X.length);
    for (k = 0; k < X.length; k++) { cell = Math.floor(Y[k] / C) * GW + Math.floor(X[k] / C); cellOf[k] = cell; start[cell + 1]++; }
    for (k = 0; k < GW * GH; k++) start[k + 1] += start[k];
    var fillAt = start.slice(0, GW * GH), order = new Int32Array(X.length);
    for (k = 0; k < X.length; k++) order[fillAt[cellOf[k]]++] = k;
    return { n: X.length, x: Float32Array.from(X), y: Float32Array.from(Y), ux: Float32Array.from(UX), uy: Float32Array.from(UY),
      C: C, GW: GW, GH: GH, start: start, order: order, t: t, med: med };
  }

  /* every edge point votes for the middle of a circle of radius r1..r2 through it, both sides of the edge */
  function vote(E, W, H, r1, r2) {
    var acc = new Float32Array(W * H), k, d, x, y, ux, uy, px, py;
    for (k = 0; k < E.n; k++) {
      x = E.x[k] + 0.5; y = E.y[k] + 0.5; ux = E.ux[k]; uy = E.uy[k];
      for (d = r1; d <= r2; d++) {
        px = Math.floor(x + ux * d); py = Math.floor(y + uy * d);
        if (px >= 0 && px < W && py >= 0 && py < H) acc[py * W + px]++;
        px = Math.floor(x - ux * d); py = Math.floor(y - uy * d);
        if (px >= 0 && px < W && py >= 0 && py < H) acc[py * W + px]++;
      }
    }
    return acc;
  }

  /* the strongest spots, at least minDist apart */
  function peaks(acc, W, H, minVal, minDist, maxN) {
    var cand = [], x, y, i, v;
    for (y = 1; y < H - 1; y++) for (x = 1; x < W - 1; x++) {
      i = y * W + x; v = acc[i];
      if (v < minVal) continue;
      if (v < acc[i - 1] || v < acc[i + 1] || v < acc[i - W] || v < acc[i + W] || v < acc[i - W - 1] || v < acc[i - W + 1] || v < acc[i + W - 1] || v < acc[i + W + 1]) continue;
      if (v === acc[i - 1] || v === acc[i - W]) continue; // flat top: keep one
      cand.push({ x: x, y: y, v: v });
    }
    cand.sort(function (a, b) { return b.v - a.v; });
    var out = [], d2 = minDist * minDist, k, ok;
    for (i = 0; i < cand.length && out.length < maxN; i++) {
      ok = true;
      for (k = 0; k < out.length; k++) if ((out[k].x - cand[i].x) * (out[k].x - cand[i].x) + (out[k].y - cand[i].y) * (out[k].y - cand[i].y) < d2) { ok = false; break; }
      if (ok) out.push(cand[i]);
    }
    return out;
  }

  /* around a possible middle: the radius whose circle has the most of its rim lined with edges, and how much
     of the way round that rim can be seen (0 to 1). nudge: the middle may move up to 2 pixels. outer: the
     outermost good circle (the rim, not a ring in the design, or a £2's silver middle) */
  function rim(E, cx, cy, r1, r2, nudge, outer) {
    var C = E.C, gx0 = Math.max(0, Math.floor((cx - r2 - 4) / C)), gx1 = Math.min(E.GW - 1, Math.floor((cx + r2 + 4) / C));
    var gy0 = Math.max(0, Math.floor((cy - r2 - 4) / C)), gy1 = Math.min(E.GH - 1, Math.floor((cy + r2 + 4) / C));
    var nx = [], ny = [], nux = [], nuy = [], gxx, gyy, cell, p, k, dx, dy, d, c, i, j;
    for (gyy = gy0; gyy <= gy1; gyy++) for (gxx = gx0; gxx <= gx1; gxx++) {
      cell = gyy * E.GW + gxx;
      for (p = E.start[cell]; p < E.start[cell + 1]; p++) {
        k = E.order[p]; dx = E.x[k] - cx; dy = E.y[k] - cy; d = dx * dx + dy * dy;
        if (d < (r1 - 4) * (r1 - 4) || d > (r2 + 4) * (r2 + 4)) continue;
        nx.push(E.x[k]); ny.push(E.y[k]); nux.push(E.ux[k]); nuy.push(E.uy[k]);
      }
    }
    var best = null, ox, oy, span = nudge ? 2 : 0, nb = r2 - r1 + 3;
    for (oy = -span; oy <= span; oy++) for (ox = -span; ox <= span; ox++) {
      var x0 = cx + ox, y0 = cy + oy, bins = new Float32Array(nb);
      for (j = 0; j < nx.length; j++) {
        dx = nx[j] - x0; dy = ny[j] - y0; d = Math.sqrt(dx * dx + dy * dy);
        if (d < r1 - 1 || d > r2 + 1 || d < 1) continue;
        c = Math.abs(dx * nux[j] + dy * nuy[j]) / d;
        if (c < 0.85) continue;
        i = Math.round(d) - r1 + 1; if (i >= 0 && i < nb) bins[i]++;
      }
      var cov = new Float32Array(nb), bv = 0, bi = -1;
      for (i = 1; i < nb - 1; i++) { cov[i] = (bins[i - 1] + bins[i] + bins[i + 1]) / (i + r1 - 1); if (cov[i] > bv) bv = cov[i]; }
      for (i = nb - 2; i >= 1; i--) if (cov[i] >= bv * (outer ? 0.62 : 1) && cov[i] >= cov[i - 1] && cov[i] >= cov[i + 1]) { bi = i; break; }
      if (bi < 0) continue;
      var r = bi + r1 - 1, tol = Math.max(1.5, r * 0.045), na = Math.max(24, Math.round(2 * Math.PI * r / 2.5)), seen = new Uint8Array(na), got = 0, a;
      for (j = 0; j < nx.length; j++) {
        dx = nx[j] - x0; dy = ny[j] - y0; d = Math.sqrt(dx * dx + dy * dy);
        if (Math.abs(d - r) > tol) continue;
        c = Math.abs(dx * nux[j] + dy * nuy[j]) / d;
        if (c < 0.8) continue;
        a = Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * na) % na;
        if (!seen[a]) { seen[a] = 1; got++; }
      }
      var res = { x: x0, y: y0, r: r, support: got / na };
      if (!best || res.support > best.support) best = res;
    }
    return best;
  }

  /* every coin in the photo, whatever its size. -> {found: [...], maybe: [...], r0, warn} in image pixels */
  function findCoins(img, opt) {
    var P = grey(img), W = P.W, H = P.H, L = Math.max(W, H), i, k;
    var E = edgePoints(P.g, W, H, opt);
    var out = { found: [], maybe: [], r0: 0, warn: [] };
    if (E.n < 50) { out.warn.push('none'); return out; }

    // first pass, any size: the usual size of a coin in this photo
    var r1 = Math.max(6, Math.round(L * 0.012)), r2 = Math.round(L * 0.16);
    var acc = blur(blur(vote(E, W, H, r1, r2), W, H, 1), W, H, 1);
    var first = peaks(acc, W, H, 2, r1, 250).map(function (p) { return rim(E, p.x, p.y, r1, r2, false, false); })
      .filter(function (c) { return c && c.support >= 0.6 && c.r > r1; });
    first.sort(function (a, b) { return b.r - a.r; });
    var outerOnes = [];
    first.forEach(function (c) {
      for (var j = 0; j < outerOnes.length; j++) if (Math.hypot(outerOnes[j].x - c.x, outerOnes[j].y - c.y) < outerOnes[j].r * 0.85) return;
      outerOnes.push(c);
    });
    first = outerOnes;
    if (!first.length) { out.warn.push('none'); return out; }
    var logs = first.map(function (c) { return Math.log(c.r); }), win = Math.log(1.12), bestI = 0, bestS = -1;
    for (i = 0; i < logs.length; i++) {
      var sc = 0;
      for (k = 0; k < logs.length; k++) if (Math.abs(logs[k] - logs[i]) <= win) sc += first[k].support;
      if (sc > bestS) { bestS = sc; bestI = i; }
    }
    var near = first.filter(function (c, j) { return Math.abs(logs[j] - logs[bestI]) <= win; }).map(function (c) { return c.r; }).sort(function (a, b) { return a - b; });
    var r0 = near[Math.floor(near.length / 2)];

    // second pass, in five overlapping bands of size round that one: every coin, whatever it is. The smallest
    // coin (5p, 18 mm) is 0.63 of the biggest (£2, 28.4 mm), so 0.5 to 1.9 times it covers them all.
    // Narrow bands keep each coin's middle sharp (one wide band blurs neighbours together)
    var cands = [];
    [0.62, 0.78, 1, 1.25, 1.55].forEach(function (m) {
      var rc = r0 * m, ra = Math.max(4, Math.floor(rc * 0.8)), rb = Math.min(Math.ceil(rc * 1.25), Math.round(L * 0.2)), bl = Math.max(1, Math.round(rc / 14));
      if (rb - ra < 3) return;
      var acc2 = blur(blur(vote(E, W, H, ra, rb), W, H, bl), W, H, bl);
      peaks(acc2, W, H, (2 * ra / bl) * 0.4, ra * 0.8, 3000).forEach(function (p) {
        var c = rim(E, p.x, p.y, ra, rb, true, true);
        if (!c || c.support < 0.3) return;
        c.v = p.v / (2 * c.r / bl); // a whole rim, smoothed this much, peaks at about 2r/bl votes
        cands.push(c);
      });
    });
    // clearest rims first
    cands.sort(function (a, b) { return (b.support + b.v * 0.1) - (a.support + a.v * 0.1); });
    var kept = [];
    cands.forEach(function (c) {
      for (var j = 0; j < kept.length; j++) {
        var k = kept[j], d = Math.hypot(k.x - c.x, k.y - c.y);
        var nested = d + Math.min(k.r, c.r) < Math.max(k.r, c.r) * 1.1 || d < Math.min(k.r, c.r) * 0.5;
        if (nested) return; // the same coin found twice (or a ring in its design): the clearer one stays

      }
      kept.push(c);
    });
    // a circle lying across clearer ones (a gap between coins, or a ring through bits of several) isn't a coin
    kept = kept.filter(function (c, i) {
      var deep = 0, half = false;
      for (var j = 0; j < i; j++) {
        var k = kept[j], o = (c.r + k.r - Math.hypot(k.x - c.x, k.y - c.y)) / c.r;
        if (o > 0.5) half = true; else if (o > 0.25) deep++;
      }
      return !half && deep < 2;
    });
    kept.forEach(function (c) {
      var o = { x: (c.x + 0.5) / P.f, y: (c.y + 0.5) / P.f, r: c.r / P.f, seen: Math.round(c.support * 100) / 100, v: Math.round(c.v * 100) / 100 };
      var clear = c.support >= 0.7, strong = c.support >= 0.5 && c.v >= 0.9;
      if (clear || strong) { o.hidden = !clear; out.found.push(o); }
      else if (c.support >= 0.4 && c.v >= 0.6) out.maybe.push(o);
    });
    out.r0 = r0 / P.f;
    if (r0 < L * 0.02) out.warn.push('small');
    return out;
  }

  /* ---------- measuring each coin on the full photo ---------- */

  /* the surface the coins sit on: its usual colour, how much it varies, and the gains that make it grey
     (to take out the photo's colour cast) */
  function deskOf(img, circles) {
    var W = img.width, H = img.height, d = img.data, step = Math.max(3, Math.round(Math.max(W, H) / 120));
    var R = [], G = [], B = [], x, y, i, j, ok;
    for (y = step >> 1; y < H; y += step) for (x = step >> 1; x < W; x += step) {
      ok = true;
      for (j = 0; j < circles.length; j++) {
        var dx = x - circles[j].x, dy = y - circles[j].y, rr = circles[j].r * 1.3;
        if (dx * dx + dy * dy < rr * rr) { ok = false; break; }
      }
      if (!ok) continue;
      i = (y * W + x) * 4;
      R.push(d[i]); G.push(d[i + 1]); B.push(d[i + 2]);
    }
    if (R.length < 30) return { rgb: [200, 200, 200], noise: 6, gains: [1, 1, 1], none: true };
    var c = [median(R), median(G), median(B)], dist = [], k;
    for (k = 0; k < R.length; k++) dist.push(Math.hypot(R[k] - c[0], G[k] - c[1], B[k] - c[2]));
    var m = (c[0] + c[1] + c[2]) / 3;
    var gains = m < 25 ? [1, 1, 1] : c.map(function (v) { return clamp(m / Math.max(1, v), 0.8, 1.25); });
    return { rgb: c, noise: Math.max(2, median(dist)), gains: gains };
  }

  /* the desk just round one coin (photos are often lighter at one end, and coins can sit near the edge of a
     counter): its colour and how much it varies. Not enough desk showing (coins all round): null */
  function localDesk(img, c, circles) {
    var W = img.width, H = img.height, d = img.data, R = [], G = [], B = [], f, a, na, x, y, i, j, ok, steps = [], prev;
    for (f = 1.2; f <= 1.66; f += 0.15) {
      na = Math.max(24, Math.round(2 * Math.PI * f * c.r / 4));
      prev = null;
      for (a = 0; a < na; a++) {
        x = Math.round(c.x + Math.cos(2 * Math.PI * a / na) * f * c.r); y = Math.round(c.y + Math.sin(2 * Math.PI * a / na) * f * c.r);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        ok = true;
        for (j = 0; j < circles.length; j++) {
          if (circles[j] === c) continue;
          var dx = x - circles[j].x, dy = y - circles[j].y, rr = circles[j].r * 1.12;
          if (dx * dx + dy * dy < rr * rr) { ok = false; break; }
        }
        if (!ok) { prev = null; continue; }
        i = (y * W + x) * 4;
        R.push(d[i]); G.push(d[i + 1]); B.push(d[i + 2]);
        var lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (prev != null) steps.push(Math.abs(lum - prev));
        prev = lum;
      }
    }
    if (R.length < 24) return null;
    var rgb = [median(R), median(G), median(B)], dist = [];
    for (j = 0; j < R.length; j++) dist.push(Math.hypot(R[j] - rgb[0], G[j] - rgb[1], B[j] - rgb[2]));
    return { rgb: rgb, noise: Math.max(2, median(dist)), busy: steps.length ? Math.max(1, median(steps)) : 2 };
  }

  /* how far a point of the photo is from the desk's colour (blended between pixels) */
  function farAt(img, x, y, desk) {
    var W = img.width, H = img.height;
    if (x < 0 || y < 0 || x > W - 1.001 || y > H - 1.001) return NaN;
    var d = img.data, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, i = (y0 * W + x0) * 4, j = i + W * 4;
    var w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    var r = d[i] * w00 + d[i + 4] * w10 + d[j] * w01 + d[j + 4] * w11 - desk[0];
    var g = d[i + 1] * w00 + d[i + 5] * w10 + d[j + 1] * w01 + d[j + 5] * w11 - desk[1];
    var b = d[i + 2] * w00 + d[i + 6] * w10 + d[j + 2] * w01 + d[j + 6] * w11 - desk[2];
    return Math.sqrt(r * r + g * g + b * b);
  }

  /* along one line out from inside the coin: where the coin ends and the desk begins (the first place it
     stays desk-coloured for a good stretch: a shiny line in the design is thinner than that). Used for a rough size: a circle found on a ring in a coin's
     design still reaches the rim this way, and a neighbour beyond the desk can't be reached first */
  function walkOut(img, desk, T, cx, cy, ux, uy, a, b, step, need) {
    var n = Math.ceil((b - a) / step), run = 0, firstLow = -1, k, p, vals = [];
    for (k = 0; k <= n; k++) {
      p = farAt(img, cx + ux * (a + k * step), cy + uy * (a + k * step), desk);
      if (p !== p) return null; // off the photo
      vals.push(p);
      if (p < T) { run++; if (run === 1) firstLow = k; if (run >= need) break; } else run = 0;
    }
    if (run < need || firstLow < 1) return null;
    var hi = vals[firstLow - 1], lo = vals[firstLow], t = clamp((hi - T) / Math.max(1e-6, hi - lo), 0, 1);
    return a + (firstLow - 1 + t) * step;
  }

  /* along one line in from the desk towards the middle: where the desk ends and the coin begins (the first
     place that isn't desk-coloured for three looks running). Starting off the desk (a neighbour touching, a
     shadow) or never meeting the coin: no answer. Coming in from the desk side means a shine on the coin's
     face can't stop it early */
  function walk(img, desk, T, cx, cy, ux, uy, a, b, step) {
    var n = Math.ceil((b - a) / step), run = 0, firstHigh = -1, k, p, vals = [];
    for (k = 0; k <= n; k++) {
      p = farAt(img, cx + ux * (b - k * step), cy + uy * (b - k * step), desk);
      if (p !== p) return null; // off the photo
      vals.push(p);
      if (k < 3 && p >= T) return null; // not starting on the desk
      if (p >= T) { run++; if (run === 1) firstHigh = k; if (run >= 3) break; } else run = 0;
    }
    if (run < 3) return null;
    var lo = vals[firstHigh - 1], hi = vals[firstHigh], t = clamp((T - lo) / Math.max(1e-6, hi - lo), 0, 1);
    return b - (firstHigh - 1 + t) * step;
  }

  /* how different a coin's middle is from the desk, in colour (far) and in how busy it is (the design on a
     coin's face, against the smooth desk). A gap between coins is desk all through */
  function inside(img, c, rgb) {
    var v = [], steps = [], f, a, na, W = img.width, d = img.data;
    for (f = 0.15; f <= 0.76; f += 0.15) {
      na = Math.max(8, Math.round(2 * Math.PI * f * c.r / 3));
      var prev = null;
      for (a = 0; a < na; a++) {
        var x = c.x + Math.cos(2 * Math.PI * a / na) * f * c.r, y = c.y + Math.sin(2 * Math.PI * a / na) * f * c.r;
        var p = farAt(img, x, y, rgb);
        if (p !== p) { prev = null; continue; }
        v.push(p);
        var i = (Math.round(y) * W + Math.round(x)) * 4, lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (prev != null) steps.push(Math.abs(lum - prev));
        prev = lum;
      }
    }
    return { far: median(v), busy: steps.length ? median(steps) : 0 };
  }

  /* least squares: r(angle) = c0 + sum over the harmonics k of (a_k cos k.angle + b_k sin k.angle) */
  function fourier(th, rho, use, HARM) {
    var P = 1 + 2 * HARM.length, N = [], R = [], i, j, k, row = new Float64Array(P), n = 0;
    for (i = 0; i < P; i++) { N.push(new Float64Array(P)); R.push(0); }
    for (j = 0; j < th.length; j++) {
      if (!use[j]) continue;
      n++; row[0] = 1;
      for (k = 0; k < HARM.length; k++) { row[1 + 2 * k] = Math.cos(HARM[k] * th[j]); row[2 + 2 * k] = Math.sin(HARM[k] * th[j]); }
      for (i = 0; i < P; i++) { R[i] += row[i] * rho[j]; for (k = 0; k < P; k++) N[i][k] += row[i] * row[k]; }
    }
    if (n < P + 8) return null;
    var sol = solveN(N, R);
    if (!sol) return null;
    var fit = new Float64Array(th.length);
    for (j = 0; j < th.length; j++) {
      var v = sol[0];
      for (k = 0; k < HARM.length; k++) v += sol[1 + 2 * k] * Math.cos(HARM[k] * th[j]) + sol[2 + 2 * k] * Math.sin(HARM[k] * th[j]);
      fit[j] = v;
    }
    return { c: sol, fit: fit };
  }
  function solveN(A, b) {
    var n = b.length, m = A.map(function (row, i) { var r = Array.prototype.slice.call(row); r.push(b[i]); return r; }), i, j, k, p, t;
    for (i = 0; i < n; i++) {
      p = i; for (j = i + 1; j < n; j++) if (Math.abs(m[j][i]) > Math.abs(m[p][i])) p = j;
      if (Math.abs(m[p][i]) < 1e-9) return null;
      t = m[i]; m[i] = m[p]; m[p] = t;
      for (j = 0; j < n; j++) if (j !== i) { t = m[j][i] / m[i][i]; if (t) for (k = i; k <= n; k++) m[j][k] -= t * m[i][k]; }
    }
    return m.map(function (row, i) { return row[n] / row[i]; });
  }

  /* trace a coin's outline all the way round, where it meets the desk: its true middle and size, and how
     seven- or twelve-sided it is */
  function trace(img, desk, c, inside) {
    var th = new Float64Array(RAYS), rho = new Float64Array(RAYS), use = new Uint8Array(RAYS);
    // desk-coloured: within the desk's own variation, or half way to the coin's colour if the coin is faint
    var T = Math.min(Math.max(desk.noise * 3 + 10, inside * 0.25), inside * 0.5);
    if (inside < desk.noise * 2 + 4) return null; // the coin hardly stands out from the desk
    var cx = c.x, cy = c.y, r = c.r, j, e, pass, res = null, rm;
    for (j = 0; j < RAYS; j++) th[j] = 2 * Math.PI * j / RAYS;
    // roughly first, out from well inside the circle found to well outside it, and a circle fitted to where
    // the desk starts (the circle found may be a ring in the design, off to one side). Twice, from the new middle
    var step = Math.max(0.5, r / 90), round, fit, it;
    for (round = 0; round < 2; round++) {
      var got = 0;
      for (j = 0; j < RAYS; j++) {
        e = walkOut(img, desk.rgb, T, cx, cy, Math.cos(th[j]), Math.sin(th[j]), r * 0.5, r * 1.8, step, Math.max(3, Math.ceil(r * 0.12 / step)));
        use[j] = e != null ? 1 : 0; rho[j] = e != null ? e : 0; got += use[j];
      }
      if (got < RAYS * 0.3) return null;
      for (it = 0; it < 5; it++) {
        fit = fourier(th, rho, use, [1]);
        if (!fit) return null;
        var dev = [];
        for (j = 0; j < RAYS; j++) if (use[j]) dev.push(Math.abs(rho[j] - fit.fit[j]));
        var cut = Math.max(1.5, median(dev) * 1.4826 * 3), out = 0;
        for (j = 0; j < RAYS; j++) if (use[j] && Math.abs(rho[j] - fit.fit[j]) > cut) { use[j] = 0; out++; }
        if (!out) break;
      }
      fit = fourier(th, rho, use, [1]);
      if (!fit || fit.c[0] < r * 0.45) return null;
      cx += fit.c[1]; cy += fit.c[2]; r = fit.c[0];
    }
    rm = r;
    for (pass = 0; pass < 2; pass++) {
      for (j = 0; j < RAYS; j++) {
        e = walk(img, desk.rgb, T, cx, cy, Math.cos(th[j]), Math.sin(th[j]), rm * 0.8, rm * 1.2, 0.25);
        use[j] = e != null ? 1 : 0; rho[j] = e != null ? e : 0;
      }
      // a circle, allowed to be a little off-centre and squashed (a photo at an angle): fit, drop the looks
      // that miss by far (a highlight, a shadow), fit again
      var fit = null, it, resid, mad, n = 0;
      for (it = 0; it < 4; it++) {
        fit = fourier(th, rho, use, [1, 2]);
        if (!fit) return null;
        resid = [];
        for (j = 0; j < RAYS; j++) if (use[j]) resid.push(Math.abs(rho[j] - fit.fit[j]));
        mad = median(resid) * 1.4826;
        var lim = Math.max(0.5, mad * 3.5, fit.c[0] * 0.012), dropped = 0;
        for (j = 0; j < RAYS; j++) if (use[j] && Math.abs(rho[j] - fit.fit[j]) > lim) { use[j] = 0; dropped++; }
        if (!dropped) break;
      }
      fit = fourier(th, rho, use, [1, 2]);
      if (!fit) return null;
      for (j = 0; j < RAYS; j++) n += use[j];
      res = { x: cx + fit.c[1], y: cy + fit.c[2], r: fit.c[0], q: n / RAYS, c: fit.c, fit: fit.fit };
      // move to the middle the outline says (the first harmonic is how far off it was) and look again
      if (pass === 0) { cx = res.x; cy = res.y; rm = res.r; }
    }
    if (res.q < 0.3) return null;
    // what's left over once the circle is taken away: how strongly does it go up and down 7 times round
    // (20p, 50p), or 12 times (£1)? Each measured on its own, so a hidden stretch of rim can't throw it out.
    // Other counts (5, 6, 8...) give how bumpy this coin's outline is anyway
    var left = new Float64Array(RAYS), amp = {};
    for (j = 0; j < RAYS; j++) left[j] = rho[j] - res.fit[j];
    [5, 6, 7, 8, 9, 11, 12, 13].forEach(function (k) {
      var f = fourier(th, left, use, [k]);
      amp[k] = f ? Math.hypot(f.c[1], f.c[2]) / res.r : 0;
    });
    res.a7 = amp[7]; res.a12 = amp[12];
    res.noise = median([amp[5], amp[6], amp[8], amp[9], amp[11], amp[13]]);
    return res;
  }

  /* the middle's colour and the outer ring's colour: rg = red against green, yb = yellow against blue,
     both shares of the brightness, so light and shade cancel out */
  function colours(img, c, gains) {
    var W = img.width, H = img.height, d = img.data;
    var bands = { mid: [0.06, 0.42], ring: [0.8, 0.92] }, out = {};
    Object.keys(bands).forEach(function (k) {
      var rg = [], yb = [], lum = [], f, a, x, y, i, R, G, B, s;
      for (f = bands[k][0]; f <= bands[k][1] + 1e-9; f += (bands[k][1] - bands[k][0]) / (k === 'mid' ? 6 : 3)) {
        var na = Math.max(12, Math.round(2 * Math.PI * f * c.r / 2));
        for (a = 0; a < na; a++) {
          x = Math.round(c.x + Math.cos(2 * Math.PI * a / na) * f * c.r); y = Math.round(c.y + Math.sin(2 * Math.PI * a / na) * f * c.r);
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          i = (y * W + x) * 4;
          R = d[i] * gains[0]; G = d[i + 1] * gains[1]; B = d[i + 2] * gains[2]; s = R + G + B;
          if (s < 45 || Math.max(d[i], d[i + 1], d[i + 2]) > 247) continue; // too dark to tell, or a shine
          rg.push((R - G) / s); yb.push(((R + G) / 2 - B) / s); lum.push(s / 3);
        }
      }
      out[k] = { rg: median(rg), yb: median(yb), lum: median(lum), n: rg.length };
    });
    return out;
  }

  /* how likely each metal is, from the two colours. ref: the colour of this photo's silver coins (the light can
     make silver look warm), so copper is judged against that. Set on the Royal Mint's photo of every coin: copper
     shows 0.07 to 0.13 redder than silver (the newer coins are paler), a £1 or £2 ring 0.04 to 0.06 yellower than
     its middle */
  function metals(col, ref) {
    var mid = col.mid, ring = col.ring;
    if (!(mid.n >= 8) || !(ring.n >= 8)) return { copper: 0.25, silver: 0.5, two: 0.25 };
    ref = ref || [0, 0];
    var lift = (ring.yb - mid.yb) + 0.5 * (ring.rg - mid.rg); // a gold ring round a silver middle
    var red = Math.max(mid.rg, (mid.rg + ring.rg) / 2) - ref[0];
    var two = sig((lift - 0.035) / 0.009) * (1 - sig((mid.rg - ref[0] - 0.05) / 0.012));
    var copper = sig((red - 0.045) / 0.011) * (1 - two);
    var silver = Math.max(0, 1 - two - copper);
    return { copper: copper, silver: silver, two: two };
  }

  /* how likely the outline is seven-sided and twelve-sided, from how strongly it goes up and down 7 (or 12)
     times round against how bumpy it is anyway. Set on the real photos: 10p coins measure about 0.003 for 7
     bumps, 20p coins about 0.012 (the corners are rounded, and blurred in a photo). Too small or too hidden
     to tell: 0.5 */
  function shapes(t) {
    if (!t || t.q < 0.35 || t.r < 14) return { p7: 0.5, p12: 0.5 };
    var n = t.noise;
    return {
      p7: sig((t.a7 - Math.max(0.006, 1.8 * n)) / (0.0015 + 0.4 * n)),
      p12: sig((t.a12 - Math.max(0.005, 1.8 * n)) / (0.0015 + 0.4 * n))
    };
  }

  /* ---------- which coin is which ---------- */
  var SIG = 0.035, CAP = 14;

  /* cost of calling coin f each coin at scale s (pixels per mm): lower is likelier */
  function costs(f, s) {
    var out = new Float64Array(COINS.length), k, d, z, c;
    for (k = 0; k < COINS.length; k++) {
      d = COINS[k];
      z = (f.lr - Math.log(s * d.eff / 2)) / SIG;
      c = 0.5 * z * z - Math.log(Math.max(0.02, f.pm[d.metal]));
      c -= Math.log(Math.max(0.03, d.sides === 7 ? f.p7 : 1 - f.p7));
      c -= Math.log(Math.max(0.15, d.sides === 12 ? f.p12 : 1 - f.p12));
      out[k] = c;
    }
    return out;
  }
  function idx(id) { for (var k = 0; k < COINS.length; k++) if (COINS[k].id === id) return k; return -1; }

  /* total cost of the whole photo at log-scale a + gx*u + gy*v. Each kind of coin used costs a little extra,
     so when two readings fit equally well the one with fewer kinds of coin wins (a pile of 10p photographed at
     an angle is 10p near and far, not 10p and 50p) */
  var KIND = 4;
  function total(list, a, gx, gy) {
    var sum = 0, asg = [], kinds = {};
    list.forEach(function (o) {
      var cs = costs(o.f, Math.exp(a + gx * o.f.u + gy * o.f.v)), best = 0, k;
      if (o.set) { best = idx(o.set); sum += Math.min(CAP * 3, cs[best] * 3); }
      else { for (k = 1; k < cs.length; k++) if (cs[k] < cs[best]) best = k; sum += Math.min(CAP, cs[best]); kinds[best] = 1; }
      asg.push(best);
    });
    return { cost: sum + KIND * Object.keys(kinds).length, fit: sum, asg: asg };
  }

  /* weighted least squares of y = a + gx*u + gy*v */
  function plane(rows) {
    var S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], R = [0, 0, 0];
    rows.forEach(function (o) {
      var v = [1, o.u, o.v], p, q;
      for (p = 0; p < 3; p++) { R[p] += o.w * v[p] * o.y; for (q = 0; q < 3; q++) S[p][q] += o.w * v[p] * v[q]; }
    });
    return solveN(S, R);
  }

  /* each coin's best match at one scale. How common each coin is in this photo is worked out as it goes
     (a coin that could be a 10p or a 50p, in a photo of forty 10p coins, is a 10p). -> asg, alt, margin per
     coin, and the photo's cost leaving out its worst-fitting tenth (trim) */
  function assign(list, a, gx, gy) {
    var n = list.length, K = COINS.length, C = [], pi = [], i, k, it, out = { asg: [], alt: [], margin: [] };
    for (k = 0; k < K; k++) pi.push(1 / K);
    list.forEach(function (o) { C.push(o.set ? null : costs(o.f, Math.exp(a + gx * o.f.u + gy * o.f.v))); });
    for (it = 0; it < 10; it++) {
      var acc = [];
      for (k = 0; k < K; k++) acc.push(0.1);
      C.forEach(function (c, j) {
        if (!c) { acc[idx(list[j].set)] += 1; return; }
        var m = Infinity, w = [], z = 0;
        for (k = 0; k < K; k++) { w.push(c[k] - Math.log(pi[k])); m = Math.min(m, w[k]); }
        for (k = 0; k < K; k++) { w[k] = Math.exp(m - w[k]); z += w[k]; }
        for (k = 0; k < K; k++) acc[k] += w[k] / z;
      });
      var tot = acc.reduce(function (p, q) { return p + q; }, 0);
      pi = acc.map(function (v) { return v / tot; });
    }
    var per = [];
    C.forEach(function (c, j) {
      if (!c) { var f = idx(list[j].set); out.asg.push(f); out.alt.push(f); out.margin.push(99); per.push(0); return; }
      var b1 = -1, b2 = -1, v1 = Infinity, v2 = Infinity, v;
      for (k = 0; k < K; k++) {
        v = c[k] - Math.log(pi[k]);
        if (v < v1) { b2 = b1; v2 = v1; b1 = k; v1 = v; } else if (v < v2) { b2 = k; v2 = v; }
      }
      out.asg.push(b1); out.alt.push(b2); out.margin.push(v2 - v1); per.push(Math.min(CAP, c[b1]));
    });
    per.sort(function (p, q) { return p - q; });
    var keep = n <= 3 ? n : Math.ceil(n * 0.9);
    out.trim = 0;
    for (i = 0; i < keep; i++) out.trim += per[i];
    out.pi = pi;
    return out;
  }

  /* the best overall scale for a given slope, then the slope again from the coins that match */
  function fitFrom(list, gx, gy, spread) {
    var lo = Infinity, hi = -Infinity, a, t, best = null, it;
    list.forEach(function (o) {
      var base = o.f.lr - gx * o.f.u - gy * o.f.v;
      lo = Math.min(lo, base - Math.log(28.4 / 2)); hi = Math.max(hi, base - Math.log(18 / 2));
    });
    for (a = lo - 0.15; a <= hi + 0.15; a += 0.004) { t = total(list, a, gx, gy); if (!best || t.cost < best.cost) best = { a: a, cost: t.cost }; }
    var A = best.a;
    for (it = 0; it < 5 && spread > 0.15 && list.length >= 8; it++) {
      var tt = total(list, A, gx, gy), rows = [];
      list.forEach(function (o, i) {
        var y = o.f.lr - Math.log(COINS[tt.asg[i]].eff / 2);
        if (Math.abs(y - (A + gx * o.f.u + gy * o.f.v)) > SIG * 2.5) return;
        rows.push({ y: y, u: o.f.u, v: o.f.v, w: o.set ? 3 : Math.max(0.2, o.f.q) });
      });
      if (rows.length < 8) break;
      var sol = plane(rows);
      if (!sol) break;
      A = sol[0]; gx = clamp(sol[1], -0.6, 0.6); gy = clamp(sol[2], -0.6, 0.6);
    }
    return { a: A, gx: gx, gy: gy, cost: total(list, A, gx, gy).cost };
  }

  /* works out every coin: the scale (and its slope across the photo) that fits best, then each coin's best
     match at that scale. Coins you've set (coin.set) stay as they are and pin the scale. Updates each coin's
     coin, alt, margin, sizeOff and unsure; returns {ask, scale} */
  function solve(coins) {
    var list = coins.filter(function (c) { return c.f && c.state !== 'off' && c.state !== 'maybe'; });
    var res = { ask: null, scale: null };
    if (!list.length) return res;
    var spread = Math.max.apply(null, list.map(function (o) { return Math.hypot(o.f.u, o.f.v); }));
    // two starts: no slope, and the slope of the coins' sizes across the photo taken as they are
    var starts = [[0, 0]];
    if (list.length >= 8 && spread > 0.15) {
      var rows = list.filter(function (o) { return o.f.q >= 0.5; }).map(function (o) { return { y: o.f.lr, u: o.f.u, v: o.f.v, w: 1 }; }), sol, k;
      for (k = 0; k < 3 && rows.length >= 8; k++) {
        sol = plane(rows);
        if (!sol) break;
        var res0 = rows.map(function (o) { return Math.abs(o.y - (sol[0] + sol[1] * o.u + sol[2] * o.v)); });
        var lim = Math.max(0.03, median(res0) * 1.4826 * 2.5);
        rows = rows.filter(function (o, i) { return res0[i] <= lim; });
      }
      if (sol) starts.push([clamp(sol[1], -0.6, 0.6), clamp(sol[2], -0.6, 0.6)]);
    }
    var fit = null;
    starts.forEach(function (st) { var f = fitFrom(list, st[0], st[1], spread); if (!fit || f.cost < fit.cost) fit = f; });
    var A = fit.a, gx = fit.gx, gy = fit.gy;
    var fin = assign(list, A, gx, gy), alt = null, dA, t;
    // the same slope, every other overall scale: is there another way to read the coins that fits nearly as
    // well? (a pile of only 5p-or-10p sized coins, say). Compared leaving out the worst-fitting few, so one
    // misread coin can't hide it
    for (dA = -0.6; dA <= 0.6; dA += 0.008) {
      if (Math.abs(dA) < 0.08) continue;
      t = assign(list, A + dA, gx, gy);
      if (!alt || t.trim < alt.trim) alt = t;
    }
    list.forEach(function (o, i) {
      var d = COINS[fin.asg[i]], s = Math.exp(A + gx * o.f.u + gy * o.f.v);
      o.auto = d.id;
      if (!o.set) o.coin = d.id;
      o.alt = COINS[fin.alt[i]].id;
      o.margin = Math.round(fin.margin[i] * 10) / 10;
      o.sizeOff = Math.round((o.f.lr - Math.log(s * d.eff / 2)) * 1000) / 10; // % bigger (+) or smaller (-) than it should be
      o.unsure = false;
    });
    var anchored = list.some(function (o) { return o.set; });
    var differ = alt ? list.filter(function (o, i) { return alt.asg[i] !== fin.asg[i]; }).length : 0;
    if (!anchored && alt && alt.trim - fin.trim < 2.5 && differ >= list.length * 0.5) {
      // two readings fit about as well: ask about the clearest coin that differs between them
      var ref = -1;
      list.forEach(function (o, i) { if (alt.asg[i] !== fin.asg[i] && (ref < 0 || o.f.q > list[ref].f.q)) ref = i; });
      var a1 = COINS[fin.asg[ref]].id, a2 = COINS[alt.asg[ref]].id;
      var same = list.every(function (o, i) { return fin.asg[i] === fin.asg[ref]; });
      res.ask = { coin: coins.indexOf(list[ref]), options: [a1, a2], all: same };
      list.forEach(function (o, i) { if (alt.asg[i] !== fin.asg[i]) o.unsure = true; });
    }
    res.scale = { a: A, gx: gx, gy: gy };
    return res;
  }

  /* how big a coin should look at a spot in the photo, from the scale worked out (for coins added by hand) */
  function radiusFor(res, id, x, y) {
    var d = BY[id], L = Math.max(res.width, res.height), s = res.scale;
    if (!d || !s) return res.unit || L * 0.03;
    return Math.exp(s.a + s.gx * (x - res.width / 2) / L + s.gy * (y - res.height / 2) / L) * d.eff / 2;
  }

  /* ---------- the whole photo ---------- */
  function read(img, opt) {
    opt = opt || {};
    var t0 = Date.now(), W = img.width, H = img.height, L = Math.max(W, H), i, k;
    var F = findCoins(img, opt);
    var res = { version: VERSION, coins: [], maybe: [], warn: F.warn.slice(), ask: null, scale: null, width: W, height: H, unit: F.r0 };
    var circles = F.found.concat(F.maybe), locals = circles.map(function (c) { return localDesk(img, c, circles); });
    var got = locals.filter(Boolean), desk;
    if (got.length >= 3) { // the desk near the coins: the middle of the local ones
      desk = { rgb: [0, 1, 2].map(function (q) { return median(got.map(function (o) { return o.rgb[q]; })); }), noise: median(got.map(function (o) { return o.noise; })), busy: median(got.map(function (o) { return o.busy; })) };
      var m = (desk.rgb[0] + desk.rgb[1] + desk.rgb[2]) / 3;
      desk.gains = m < 25 ? [1, 1, 1] : desk.rgb.map(function (v) { return clamp(m / Math.max(1, v), 0.8, 1.25); });
    } else desk = deskOf(img, circles);
    // the desk round one coin, unless what's round it isn't desk-like (a circle found on a ring in a coin's
    // design has the coin itself round it)
    var deskFor = function (j) { var l = locals[j]; return l && l.noise <= Math.max(12, desk.noise * 3) ? l : desk; };
    // a gap between coins can look like a circle through bits of its neighbours' rims, but inside it's desk
    if (desk.busy == null) desk.busy = got.length ? median(got.map(function (o) { return o.busy; })) : 2;
    var insd = circles.map(function (c, j) { return inside(img, c, deskFor(j).rgb); });
    var ins = insd.map(function (o) { return o.far; });
    var nF = F.found.length, typical = median(ins.slice(0, nF));
    var keepIn = function (j) {
      var dk = deskFor(j), busy = dk.busy || desk.busy || 2;
      return ins[j] >= Math.max(dk.noise * 3 + 6, typical * 0.15) || insd[j].busy >= Math.max(busy * 2.5, busy + 4);
    };
    var traced = [];
    F.found.forEach(function (c, j) {
      if (!keepIn(j)) return;
      var t = trace(img, deskFor(j), c, ins[j]);
      if (t && t.q >= 0.3 && t.r / c.r > 0.8 && t.r / c.r < 1.75 && Math.hypot(t.x - c.x, t.y - c.y) < Math.max(c.r, t.r) * 0.45) traced.push({ c: c, t: t, x: t.x, y: t.y, r: t.r });
      else traced.push({ c: c, t: null, x: c.x, y: c.y, r: c.r });
    });
    // two circles that turn out to be the same coin (a ring in the design and the rim): keep the better traced
    traced.sort(function (a, b) { return (b.t ? b.t.q : 0) - (a.t ? a.t.q : 0); });
    var kept = [];
    traced.forEach(function (o) {
      for (var j = 0; j < kept.length; j++) if (Math.hypot(kept[j].x - o.x, kept[j].y - o.y) < Math.max(kept[j].r, o.r) * 0.6) return;
      kept.push(o);
    });
    res.gains = desk.gains.map(function (v) { return Math.round(v * 1000) / 1000; });
    // the photo's silver: the middles of the coins that look silver at first sight
    var cols = kept.map(function (o) { return colours(img, o, desk.gains); });
    var firstSilver = cols.filter(function (col) { return metals(col).silver > 0.6; });
    var ref = firstSilver.length >= 3 ? [median(firstSilver.map(function (c) { return c.mid.rg; })), median(firstSilver.map(function (c) { return c.mid.yb; }))] : [0, 0];
    res.silver = ref.map(round3);
    kept.forEach(function (o, k) {
      var col = cols[k], pm = metals(col, ref), sh = shapes(o.t);
      res.coins.push({
        x: o.x, y: o.y, r: o.r, state: 'on', hidden: !o.t || o.t.q < 0.4, seen: o.c.seen,
        f: { lr: Math.log(o.r), u: (o.x - W / 2) / L, v: (o.y - H / 2) / L, pm: pm, p7: sh.p7, p12: sh.p12, q: o.t ? o.t.q : 0.3 },
        m: { // the measurements, for the tests and for working out what went wrong
          mid: [round3(col.mid.rg), round3(col.mid.yb)], ring: [round3(col.ring.rg), round3(col.ring.yb)],
          a7: o.t ? round3(o.t.a7) : null, a12: o.t ? round3(o.t.a12) : null, noise: o.t ? round3(o.t.noise) : null, q: o.t ? round3(o.t.q) : null
        }
      });
    });
    // reading order: rows from the top, left to right along each row
    var cs = res.coins, rowsY = [];
    cs.sort(function (a, b) { return a.y - b.y; }).forEach(function (c) {
      var row = rowsY[rowsY.length - 1];
      if (row && Math.abs(c.y - row.y) < c.r * 0.9) { row.items.push(c); row.y = row.items.reduce(function (s, q) { return s + q.y; }, 0) / row.items.length; }
      else rowsY.push({ y: c.y, items: [c] });
    });
    res.coins = cs = [];
    rowsY.forEach(function (row) { row.items.sort(function (a, b) { return a.x - b.x; }).forEach(function (c) { cs.push(c); }); });
    // overlapping coins: worth a look
    for (i = 0; i < cs.length; i++) for (k = i + 1; k < cs.length; k++) {
      if (Math.hypot(cs[i].x - cs[k].x, cs[i].y - cs[k].y) < (cs[i].r + cs[k].r) * 0.9) { cs[i].overlap = true; cs[k].overlap = true; }
    }
    res.maybe = F.maybe.filter(function (m, j) {
      return keepIn(nF + j) && !cs.some(function (c) { return Math.hypot(c.x - m.x, c.y - m.y) < (c.r + m.r) * 0.8; });
    });
    var s = solve(cs);
    res.ask = s.ask; res.scale = s.scale;
    if (!cs.length) res.warn.push('none');
    if (cs.some(function (c) { return c.overlap; })) res.warn.push('overlap');
    res.ms = Date.now() - t0;
    return res;
  }
  function round3(v) { return v == null || v !== v ? null : Math.round(v * 1000) / 1000; }

  /* is a coin worth a second look? (amber on the photo) */
  function unsure(c) {
    if (c.set) return false;
    return !!(c.unsure || c.overlap || c.hidden || c.margin < 2 || Math.abs(c.sizeOff) > 9);
  }

  var api = { read: read, solve: solve, unsure: unsure, radiusFor: radiusFor, COINS: COINS, BY: BY, VERSION: VERSION, _shapes: { hept: HEPT, dode: DODE } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MixedCoins = api;
})(typeof window !== 'undefined' ? window : this);
