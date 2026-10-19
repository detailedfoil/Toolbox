/* Till Count: finds the coins in a photo of one pile of the same coin, on a plain surface.
   No libraries, so it's small and quick on a phone. It looks for each coin's rim:
     1. edges: every point where the picture changes sharply, with the direction it changes in
     2. each edge point "votes" for where the middle of a circle through it would be. A coin's rim makes
        lots of votes land on the coin's middle; the desk and the design inside a coin don't
     3. first pass, any size: finds the usual size of one coin (every coin in the photo is the same coin)
     4. second pass, only that size: every coin, checked by how much of its rim can be seen all the way round
   Coins in green look right. Amber ones are still counted but worth a look: a different size, half hidden
   or overlapping another. Grey dashed ones look a bit like a coin but aren't counted.
   window.CoinCount.detect({data, width, height}) -> {coins, maybe, unit, warn}
   Positions and sizes are in the pixels of the image given. Also loaded by the tests (module.exports). */
(function (root) {
  'use strict';

  var VERSION = '2026-10-19a';
  var WORK = 800; // the photo is looked at no bigger than this (long side), plenty for coins and quick

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

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
    // the desk's own grain sets the bar: the smoothest 15% of the photo (in 16 pixel squares) is desk,
    // however much of the photo the coins fill
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

  /* around a possible middle: the radius whose circle has the most of its rim lined with edges, and how
     much of the way round that rim can be seen (0 to 1). With nudge, the middle moves to the best spot within
     2 pixels. With outer (sizes already narrowed down), the outermost good circle: the rim, not a ring in the
     design. Coverage (edges per length of rim), not a count, so big circles through busy areas don't win. */
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

  /* radius = a + b*x + c*y fitted to the clear coins, dropping any more than 8% off and fitting again.
     Fewer than 8 clear coins: the same size everywhere. */
  function slope(list, r0) {
    var flat = [r0, 0, 0], use = list.slice(), it, f = flat;
    if (use.length < 8) return flat;
    for (it = 0; it < 4; it++) {
      var S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], R = [0, 0, 0];
      use.forEach(function (c) {
        var v = [1, c.x, c.y];
        for (var a = 0; a < 3; a++) { R[a] += v[a] * c.r; for (var b = 0; b < 3; b++) S[a][b] += v[a] * v[b]; }
      });
      var sol = solve3(S, R);
      if (!sol) return flat;
      f = sol;
      var keep = use.filter(function (c) { return Math.abs(c.r / (f[0] + f[1] * c.x + f[2] * c.y) - 1) <= 0.08; });
      if (keep.length === use.length || keep.length < 8) break;
      use = keep;
    }
    return f;
  }
  function solve3(A, b) {
    var m = A.map(function (row, i) { return row.concat([b[i]]); }), i, j, k, p, t;
    for (i = 0; i < 3; i++) {
      p = i; for (j = i + 1; j < 3; j++) if (Math.abs(m[j][i]) > Math.abs(m[p][i])) p = j;
      if (Math.abs(m[p][i]) < 1e-9) return null;
      t = m[i]; m[i] = m[p]; m[p] = t;
      for (j = 0; j < 3; j++) if (j !== i) { t = m[j][i] / m[i][i]; for (k = i; k < 4; k++) m[j][k] -= t * m[i][k]; }
    }
    return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
  }

  /* reading order: rows from the top, left to right along each row */
  function readingOrder(list, r0) {
    var rows = [], row;
    list.slice().sort(function (a, b) { return a.y - b.y; }).forEach(function (c) {
      row = rows[rows.length - 1];
      if (row && Math.abs(c.y - row.y) < r0 * 0.9) { row.items.push(c); row.y = row.items.reduce(function (s, i) { return s + i.y; }, 0) / row.items.length; } else rows.push({ y: c.y, items: [c] });
    });
    var out = [];
    rows.forEach(function (r) { r.items.sort(function (a, b) { return a.x - b.x; }).forEach(function (c) { out.push(c); }); });
    return out;
  }

  function detect(img, opt) {
    opt = opt || {};
    var P = grey(img), W = P.W, H = P.H, L = Math.max(W, H), i, k;
    var E = edgePoints(P.g, W, H, opt);
    var res = { version: VERSION, coins: [], maybe: [], unit: 0, warn: [], width: img.width, height: img.height };
    var dbg = opt.debug ? (res.debug = { edges: E.n, t: E.t, med: E.med, W: W, H: H }) : null;
    if (E.n < 50) { res.warn.push('none'); return res; }

    // first pass, any size up to about a third of the photo across: what size is one coin?
    var r1 = Math.max(6, Math.round(L * 0.012)), r2 = Math.round(L * 0.16);
    var acc = blur(blur(vote(E, W, H, r1, r2), W, H, 1), W, H, 1);
    var first = peaks(acc, W, H, 2, r1, 250).map(function (p) { return rim(E, p.x, p.y, r1, r2, false, false); })
      .filter(function (c) { return c && c.support >= 0.6 && c.r > r1; });
    // a ring in a coin's design sits inside the coin's rim: biggest circles first, drop any circle whose
    // middle is inside one already kept
    first.sort(function (a, b) { return b.r - a.r; });
    var outerOnes = [];
    first.forEach(function (c) {
      for (var j = 0; j < outerOnes.length; j++) if (Math.hypot(outerOnes[j].x - c.x, outerOnes[j].y - c.y) < outerOnes[j].r * 0.85) return;
      outerOnes.push(c);
    });
    first = outerOnes;
    if (dbg) dbg.first = first.length;
    if (!first.length) { res.warn.push('none'); return res; }
    var logs = first.map(function (c) { return Math.log(c.r); }), win = Math.log(1.12), bestI = 0, bestS = -1;
    for (i = 0; i < logs.length; i++) {
      var sc = 0;
      for (k = 0; k < logs.length; k++) if (Math.abs(logs[k] - logs[i]) <= win) sc += first[k].support;
      if (sc > bestS) { bestS = sc; bestI = i; }
    }
    var near = first.filter(function (c, j) { return Math.abs(logs[j] - logs[bestI]) <= win; }).map(function (c) { return c.r; }).sort(function (a, b) { return a - b; });
    var r0 = near[Math.floor(near.length / 2)];
    if (dbg) dbg.r0first = r0;

    // second pass, only sizes near that one: every coin
    var ra = Math.max(4, Math.floor(r0 * 0.78)), rb = Math.ceil(r0 * 1.22), bl = Math.max(1, Math.round(r0 / 14));
    acc = blur(blur(vote(E, W, H, ra, rb), W, H, bl), W, H, bl);
    // a whole rim, smoothed this much, peaks at about 2 * r0 / bl votes in the middle
    var full = 2 * r0 / bl;
    var cands = peaks(acc, W, H, full * 0.4, r0 * 0.45, 3000).map(function (p) {
      var c = rim(E, p.x, p.y, ra, rb, true, true);
      if (c) c.v = p.v / full;
      return c;
    }).filter(function (c) { return c && c.support >= 0.3; });
    cands.sort(function (a, b) { return (b.support + b.v * 0.25) - (a.support + a.v * 0.25); });
    var kept = [], md = r0 * 1.25;
    cands.forEach(function (c) {
      for (var j = 0; j < kept.length; j++) if (Math.hypot(kept[j].x - c.x, kept[j].y - c.y) < md) return;
      kept.push(c);
    });
    // the usual size again, from the best rims of this pass. A photo taken at a slight angle makes the near
    // coins look bigger, so the size is allowed to change steadily across the photo (a flat slope, fitted
    // to the clear coins, leaving out odd ones)
    var good = kept.filter(function (c) { return c.support >= 0.7; });
    if (good.length >= 3) r0 = good.map(function (c) { return c.r; }).sort(function (a, b) { return a - b; })[Math.floor(good.length / 2)];
    var fit = slope(good, r0);
    var expect = function (c) { return clamp(fit[0] + fit[1] * c.x + fit[2] * c.y, r0 * 0.8, r0 * 1.25); };
    res.unit = r0 / P.f;
    if (dbg) { dbg.r0 = r0; dbg.fit = fit; }

    var coins = [], odd = 0, over = 0;
    kept.forEach(function (c) {
      var e = expect(c), size = c.r / e;
      var out = { x: (c.x + 0.5) / P.f, y: (c.y + 0.5) / P.f, r: c.r / P.f, seen: Math.round(c.support * 100) / 100, size: Math.round(size * 100) / 100, v: Math.round(c.v * 100) / 100 };
      // a coin shows most of its rim, or (cut off or partly covered) still has a strong middle. A gap between
      // coins can look like a circle through bits of its neighbours' rims, but has neither.
      var clear = c.support >= 0.7, strong = c.support >= 0.5 && c.v >= 0.9;
      if (!clear && !strong) {
        if (c.support >= 0.4 && c.v >= 0.6 && Math.abs(size - 1) < 0.12) res.maybe.push(out);
        return;
      }
      if (Math.abs(size - 1) > 0.1) out.flag = 'size';
      else if (!clear) out.flag = 'hidden';
      coins.push(out);
    });
    // overlapping coins: both amber
    for (i = 0; i < coins.length; i++) for (k = i + 1; k < coins.length; k++) {
      if (Math.hypot(coins[i].x - coins[k].x, coins[i].y - coins[k].y) < (coins[i].r + coins[k].r) * 0.9) {
        if (!coins[i].flag) coins[i].flag = 'overlap';
        if (!coins[k].flag) coins[k].flag = 'overlap';
      }
    }
    coins.forEach(function (c) { if (c.flag === 'overlap') over++; else if (c.flag) odd++; });
    res.coins = readingOrder(coins, r0 / P.f);
    res.maybe = res.maybe.filter(function (m) { // only ones clear of the counted coins
      return !coins.some(function (c) { return Math.hypot(c.x - m.x, c.y - m.y) < (c.r + m.r) * 0.8; });
    });
    if (!coins.length) res.warn.push('none');
    if (over) res.warn.push('overlap');
    if (odd) res.warn.push('odd');
    if (r0 < L * 0.02) res.warn.push('small');
    return res;
  }

  var api = { detect: detect, VERSION: VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CoinCount = api;
})(typeof window !== 'undefined' ? window : this);
