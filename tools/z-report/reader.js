/* Z Report Calculator: reads the card machine's Z report from a photo and finds two numbers on it, the Total
   of the "Worldline TradeUK" row and the Total of the "OVERALL END OF DAY TOTAL" row (the last row of all).
   No libraries, so it's small, quick and works with no signal. The receipt's printer has its own font (zeros
   with a slash through them) that general text readers get wrong, so this reads only that font:
     1. ink: each pixel compared with the paper around it, so shadows and fingers don't matter
     2. characters: the separate blobs of ink, about the size of one digit
     3. numbers: digits side by side with a full stop before the last two (27.06), and rows of them
     4. which rows: the last row on the receipt is the overall total, two rows up (past the current total)
        is TradeUK. The gaps between those rows are always the same shape, so a cut-off photo is noticed
     5. digits: each one compared with the printer's own digits (samples taken from real Z reports)
     6. checks: on every row Sale + Cashback - Refund = Total, and the current and overall rows are the same
        number twice, so a misread digit nearly always shows up
   window.ZReport.read({data, width, height}) -> {overall, trade, rows, checks, warn, ...}
   Money is in whole pence. Positions are in the pixels of the image given. Also loaded by the tests. */
(function (root) {
  'use strict';

  var VERSION = '2026-10-26a';
  var TARGET = 24;   // digits are read at about this many pixels tall
  var SURVEY = 1100; // first look, long side, to find how big the writing is

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function median(a) { if (!a.length) return 0; var s = a.slice().sort(function (p, q) { return p - q; }); return s[s.length >> 1]; }

  /* grey copy at scale f (each pixel the average of the ones it covers; bilinear when f > 1) */
  function greyAt(img, f) {
    var W0 = img.width, H0 = img.height, src = img.data, x, y, i, j;
    var W = Math.max(1, Math.round(W0 * f)), H = Math.max(1, Math.round(H0 * f)), out = new Float32Array(W * H);
    if (f >= 1) {
      var lum = new Float32Array(W0 * H0);
      for (i = 0, j = 0; i < W0 * H0; i++, j += 4) lum[i] = 0.299 * src[j] + 0.587 * src[j + 1] + 0.114 * src[j + 2];
      for (y = 0; y < H; y++) {
        var sy = clamp((y + 0.5) / f - 0.5, 0, H0 - 1), y0 = Math.floor(sy), y1 = Math.min(H0 - 1, y0 + 1), fy = sy - y0;
        for (x = 0; x < W; x++) {
          var sx = clamp((x + 0.5) / f - 0.5, 0, W0 - 1), x0 = Math.floor(sx), x1 = Math.min(W0 - 1, x0 + 1), fx = sx - x0;
          out[y * W + x] = (lum[y0 * W0 + x0] * (1 - fx) + lum[y0 * W0 + x1] * fx) * (1 - fy) + (lum[y1 * W0 + x0] * (1 - fx) + lum[y1 * W0 + x1] * fx) * fy;
        }
      }
      return { g: out, W: W, H: H, f: f };
    }
    var cnt = new Float32Array(W * H), row;
    for (y = 0; y < H0; y++) {
      row = Math.min(H - 1, Math.floor(y * f)) * W;
      for (x = 0; x < W0; x++) {
        j = (y * W0 + x) * 4; i = row + Math.min(W - 1, Math.floor(x * f));
        out[i] += 0.299 * src[j] + 0.587 * src[j + 1] + 0.114 * src[j + 2]; cnt[i]++;
      }
    }
    for (i = 0; i < W * H; i++) out[i] = cnt[i] ? out[i] / cnt[i] : 0;
    return { g: out, W: W, H: H, f: f };
  }

  /* box blur, radius r, both directions */
  function blur(a, W, H, r) {
    var tmp = new Float32Array(a.length), out = new Float32Array(a.length), d = 2 * r + 1, x, y, k, o, sum;
    for (y = 0; y < H; y++) {
      o = y * W; sum = 0;
      for (k = -r; k <= r; k++) sum += a[o + clamp(k, 0, W - 1)];
      for (x = 0; x < W; x++) { tmp[o + x] = sum / d; sum += a[o + Math.min(x + r + 1, W - 1)] - a[o + Math.max(x - r, 0)]; }
    }
    for (x = 0; x < W; x++) {
      sum = 0;
      for (k = -r; k <= r; k++) sum += tmp[clamp(k, 0, H - 1) * W + x];
      for (y = 0; y < H; y++) { out[y * W + x] = sum / d; sum += tmp[Math.min(y + r + 1, H - 1) * W + x] - tmp[Math.max(y - r, 0) * W + x]; }
    }
    return out;
  }

  /* lightest value within r pixels, both directions (van Herk / Gil-Werman, so any r costs the same) */
  function maxFilter(a, W, H, r) {
    var n = Math.max(W, H) + 2 * r, buf = new Float32Array(n), g = new Float32Array(n), h = new Float32Array(n);
    var tmp = new Float32Array(a.length), out = new Float32Array(a.length), w = 2 * r + 1;
    function pass(src, dst, off, step, len) {
      var i, j, m = len + 2 * r;
      for (i = 0; i < m; i++) { j = clamp(i - r, 0, len - 1); buf[i] = src[off + j * step]; }
      for (i = 0; i < m; i++) g[i] = i % w === 0 ? buf[i] : Math.max(g[i - 1], buf[i]);
      for (i = m - 1; i >= 0; i--) h[i] = (i === m - 1 || (i + 1) % w === 0) ? buf[i] : Math.max(h[i + 1], buf[i]);
      for (i = 0; i < len; i++) dst[off + i * step] = Math.max(h[i], g[Math.min(m - 1, i + 2 * r)]);
    }
    var x, y;
    for (y = 0; y < H; y++) pass(a, tmp, y * W, 1, W);
    for (x = 0; x < W; x++) pass(tmp, out, x, W, H);
    return out;
  }

  /* how dark each pixel is next to the paper around it, 0 (paper) to 1 (black) */
  function darkness(G, r) {
    var W = G.W, H = G.H, bg = blur(maxFilter(G.g, W, H, r), W, H, r), d = new Float32Array(W * H), i;
    for (i = 0; i < W * H; i++) d[i] = clamp(1 - G.g[i] / Math.max(bg[i], 16), 0, 1);
    return { d: d, bg: bg };
  }

  /* the separate blobs of ink: pixels darker than lo, joined up, keeping blobs with a pixel darker than hi */
  function blobs(d, W, H, lo, hi) {
    var lab = new Int32Array(W * H), parent = new Int32Array(1024), next = 1, x, y, i, a, b;
    function find(k) { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; }
    function join(p, q) { p = find(p); q = find(q); if (p !== q) { if (p < q) parent[q] = p; else parent[p] = q; } }
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
      i = y * W + x;
      if (d[i] < lo) continue;
      var nb = 0;
      if (x > 0 && lab[i - 1]) nb = lab[i - 1];
      if (y > 0) {
        if (x > 0 && lab[i - W - 1]) { if (nb) join(nb, lab[i - W - 1]); else nb = lab[i - W - 1]; }
        if (lab[i - W]) { if (nb) join(nb, lab[i - W]); else nb = lab[i - W]; }
        if (x < W - 1 && lab[i - W + 1]) { if (nb) join(nb, lab[i - W + 1]); else nb = lab[i - W + 1]; }
      }
      if (!nb) {
        if (next >= parent.length) { var bigger = new Int32Array(parent.length * 2); bigger.set(parent); parent = bigger; }
        parent[next] = next; nb = next++;
      }
      lab[i] = nb;
    }
    var map = new Int32Array(next), list = [];
    for (a = 1; a < next; a++) {
      b = find(a);
      if (!map[b]) { map[b] = list.length + 1; list.push({ x0: W, x1: -1, y0: H, y1: -1, n: 0, mass: 0, peak: 0, sx: 0, sy: 0 }); }
      map[a] = map[b];
    }
    for (i = 0; i < W * H; i++) {
      if (!lab[i]) continue;
      var c = list[map[lab[i]] - 1]; x = i % W; y = (i - x) / W;
      lab[i] = map[lab[i]];
      if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
      c.n++; c.mass += d[i]; c.sx += x; c.sy += y; if (d[i] > c.peak) c.peak = d[i];
    }
    var out = [];
    list.forEach(function (c, k) {
      if (c.peak < hi) return;
      c.id = k + 1; c.w = c.x1 - c.x0 + 1; c.h = c.y1 - c.y0 + 1; c.cx = (c.x0 + c.x1) / 2; c.cy = (c.y0 + c.y1) / 2;
      c.mx = c.sx / c.n; c.my = c.sy / c.n;
      out.push(c);
    });
    return { list: out, lab: lab };
  }

  /* the usual height of a character: the commonest height among blobs shaped like one */
  function charHeight(list, H) {
    var hist = new Float32Array(Math.max(8, Math.ceil(H / 6))), k, best = 0, bi = 0;
    list.forEach(function (c) {
      if (c.n < 8 || c.h < 5 || c.h >= hist.length) return;
      var asp = c.w / c.h, fill = c.n / (c.w * c.h);
      if (asp < 0.2 || asp > 1.1 || fill < 0.12 || fill > 0.85) return;
      hist[c.h] += 1;
    });
    for (k = 2; k < hist.length - 2; k++) {
      var s = hist[k - 2] + 2 * hist[k - 1] + 3 * hist[k] + 2 * hist[k + 1] + hist[k + 2];
      if (s > best) { best = s; bi = k; }
    }
    if (!bi) return 0;
    var hs = [];
    list.forEach(function (c) { if (Math.abs(c.h - bi) <= Math.max(1, bi * 0.15) && c.n >= 8) hs.push(c.h); });
    return hs.length ? hs.reduce(function (s, v) { return s + v; }, 0) / hs.length : bi;
  }

  /* the grey picture turned by -deg degrees (to undo a photo taken at a tilt); the corners this leaves empty
     repeat the photo's edge, so they don't make an edge of their own */
  function turn(G, deg) {
    var t = deg * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t), W0 = G.W, H0 = G.H, g = G.g;
    var W = Math.ceil(Math.abs(W0 * cs) + Math.abs(H0 * sn)), H = Math.ceil(Math.abs(W0 * sn) + Math.abs(H0 * cs));
    var out = new Float32Array(W * H), x, y, i = 0;
    for (y = 0; y < H; y++) {
      var dy = y - H / 2;
      for (x = 0; x < W; x++, i++) {
        var dx = x - W / 2, sx = W0 / 2 + cs * dx - sn * dy, sy = H0 / 2 + sn * dx + cs * dy;
        sx = clamp(sx, 0, W0 - 1); sy = clamp(sy, 0, H0 - 1);
        var x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(W0 - 1, x0 + 1), y1 = Math.min(H0 - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
        out[i] = (g[y0 * W0 + x0] * (1 - fx) + g[y0 * W0 + x1] * fx) * (1 - fy) + (g[y1 * W0 + x0] * (1 - fx) + g[y1 * W0 + x1] * fx) * fy;
      }
    }
    return { g: out, W: W, H: H, f: G.f, from: { cs: cs, sn: sn, W0: W0, H0: H0 } };
  }

  /* how far the writing is tilted, in degrees: the angle at which the characters' middles line up into the
     sharpest rows (lines down to the right are positive) */
  function tilt(list, h) {
    var pts = list.filter(function (c) { return c.n >= 6 && c.h >= 0.5 * h && c.h <= 1.6 * h && c.w <= 1.4 * h; });
    if (pts.length < 20) return 0;
    var bin = Math.max(1, h * 0.25);
    function sharp(deg) {
      var t = deg * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t), hist = {}, s = 0, k;
      pts.forEach(function (c) { var v = Math.round((cs * c.cy - sn * c.cx) / bin); hist[v] = (hist[v] || 0) + 1; });
      for (k in hist) s += hist[k] * hist[k];
      return s;
    }
    var best = 0, bs = -1, d, v;
    for (d = -40; d <= 40; d += 1) { v = sharp(d); if (v > bs) { bs = v; best = d; } }
    var c = best;
    for (d = c - 1; d <= c + 1.001; d += 0.25) { v = sharp(d); if (v > bs) { bs = v; best = d; } }
    return best;
  }

  function analyse(img, f, deg) {
    var G = greyAt(img, f);
    if (deg) G = turn(G, deg);
    var L = Math.max(G.W, G.H), r = Math.max(3, Math.round(L / 160));
    var D = darkness(G, r);
    var B = blobs(D.d, G.W, G.H, 0.16, 0.3);
    var A = { G: G, d: D.d, list: B.list, lab: B.lab, W: G.W, H: G.H, f: f, deg: deg || 0, h: charHeight(B.list, G.H) };
    // a point in this (shrunk, straightened) picture -> the same point in the photo given
    A.toImage = function (x, y) {
      var fr = G.from;
      if (!fr) return [x / f, y / f];
      var dx = x - G.W / 2, dy = y - G.H / 2;
      return [(fr.W0 / 2 + fr.cs * dx - fr.sn * dy) / f, (fr.H0 / 2 + fr.sn * dx + fr.cs * dy) / f];
    };
    return A;
  }

  /* ---- numbers: digits side by side ----
     The printer's font is fixed width: every character sits in a box ("cell") the same width, so two digits that
     print close enough to join up (00 often does) are split by that width, and a full stop has a cell of its own. */
  /* a character printed in pieces (a faint stroke, the dot gaps of the print head) is joined back up: pieces
     one above the other, overlapping side to side, that together are no taller than a character */
  function joinParts(list, h) {
    var parts = list.filter(function (c) { return c.h >= 0.15 * h && c.h < 0.9 * h && c.w <= 0.9 * h && c.n >= 3; });
    parts.sort(function (a, b) { return a.x0 - b.x0; });
    var parent = parts.map(function (c, i) { return i; });
    function find(k) { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; }
    var i, j, box = parts.map(function (c) { return { x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1 }; });
    for (i = 0; i < parts.length; i++) for (j = i + 1; j < parts.length && parts[j].x0 <= parts[i].x1; j++) {
      var a = box[find(i)], b = box[find(j)];
      var ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1, narrow = Math.min(a.x1 - a.x0, b.x1 - b.x0) + 1;
      var gap = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
      var y0 = Math.min(a.y0, b.y0), y1 = Math.max(a.y1, b.y1), x0 = Math.min(a.x0, b.x0), x1 = Math.max(a.x1, b.x1);
      // (a 5's top bar and its bowl hardly overlap side to side, but they touch and are one character wide together)
      if (ov < 0.5 * narrow && !(ov > 0 && gap <= 1 && x1 - x0 + 1 <= 0.75 * h)) continue;
      if (gap > 0.25 * h || y1 - y0 + 1 > 1.25 * h || x1 - x0 + 1 > 0.95 * h) continue;
      var ra = find(i), rb = find(j);
      parent[rb] = ra; box[ra] = { x0: x0, x1: x1, y0: y0, y1: y1 };
    }
    var groups = {}, out = [];
    parts.forEach(function (c, k) { (groups[find(k)] = groups[find(k)] || []).push(c); });
    var joined = {};
    Object.keys(groups).forEach(function (g) {
      var m = groups[g];
      if (m.length < 2) return;
      var c = { x0: 1e9, x1: -1, y0: 1e9, y1: -1, n: 0, mass: 0, peak: 0, sx: 0, sy: 0, parts: m };
      m.forEach(function (p) {
        c.x0 = Math.min(c.x0, p.x0); c.x1 = Math.max(c.x1, p.x1); c.y0 = Math.min(c.y0, p.y0); c.y1 = Math.max(c.y1, p.y1);
        c.n += p.n; c.mass += p.mass; c.peak = Math.max(c.peak, p.peak); c.sx += p.sx; c.sy += p.sy; joined[p.id] = true;
      });
      c.w = c.x1 - c.x0 + 1; c.h = c.y1 - c.y0 + 1; c.cx = (c.x0 + c.x1) / 2; c.cy = (c.y0 + c.y1) / 2; c.mx = c.sx / c.n; c.my = c.sy / c.n;
      out.push(c);
    });
    return list.filter(function (c) { return !joined[c.id]; }).concat(out);
  }

  var T_ink = null;
  function tokens(A) {
    var h = A.h, list = joinParts(A.list, A.h), i, j;
    var glyphs = list.filter(function (c) {
      var fill = c.n / (c.w * c.h);
      return c.h >= 0.55 * h && c.h <= 1.3 * h && c.w >= 0.12 * h && c.w <= 7 * h && c.n >= 6 && fill > 0.1 && fill < 0.8;
    });
    var dots = list.filter(function (c) { return c.h <= 0.42 * h && c.w <= 0.42 * h && c.h >= 0.08 * h && c.n >= 2; });
    // spatial buckets for quick neighbour lookups
    var C = Math.max(8, Math.round(h * 2)), GW = Math.ceil(A.W / C) + 2;
    function bucket(arr) {
      var cells = {};
      arr.forEach(function (c) { var key = Math.floor(c.cy / C) * GW + Math.floor(c.cx / C) + 1; (cells[key] = cells[key] || []).push(c); });
      return function (x, y, wx) {
        var out = [], gx = Math.floor(x / C) + 1, gy = Math.floor(y / C), dx, dy, b;
        for (dy = -1; dy <= 1; dy++) for (dx = -1; dx <= (wx || 1); dx++) { b = cells[(gy + dy) * GW + gx + dx]; if (b) out.push.apply(out, b); }
        return out;
      };
    }
    var nearG = bucket(glyphs), nearD = bucket(dots);
    glyphs.forEach(function (a) {
      var best = null, bg = 1e9;
      nearG(a.x1, a.cy, 1).forEach(function (b) {
        if (b === a || b.x0 <= a.x0 + 0.3 * Math.min(a.w, b.w)) return;
        var gap = b.x0 - a.x1;
        if (gap < -0.15 * h || gap > 1.15 * h) return;
        if (Math.abs(b.cy - a.cy) > 0.3 * h) return;
        // the same height, or a shorter one (part faded) that sits within the taller one's height
        var tall = a.h >= b.h ? a : b, short = tall === a ? b : a;
        if (tall.h > short.h * 1.33 && !(short.y0 >= tall.y0 - 0.1 * h && short.y1 <= tall.y1 + 0.1 * h)) return;
        if (gap < bg) { bg = gap; best = b; }
      });
      a.right = best;
    });
    glyphs.forEach(function (a) { if (a.right) { if (!a.right.left || a.right.left.x1 < a.x1) a.right.left = a; } });
    glyphs.forEach(function (a) { if (a.right && a.right.left !== a) a.right = null; });
    var toks = [];
    glyphs.forEach(function (a) {
      if (a.left && a.left.right === a) return;
      var chain = [a], c = a;
      while (c.right) { c = c.right; chain.push(c); }
      toks.push({ g: chain });
    });
    // one character's width and the cell width (pitch), from single characters next to each other
    var steps = [], widths = [];
    glyphs.forEach(function (c) { if (c.w >= 0.35 * h && c.w <= 0.8 * h) widths.push(c.w); });
    var cw = median(widths) || 0.6 * h;
    toks.forEach(function (t) {
      for (j = 1; j < t.g.length; j++) {
        var a = t.g[j - 1], b = t.g[j];
        if (a.w <= 0.8 * h && b.w <= 0.8 * h && a.w >= 0.35 * h && b.w >= 0.35 * h && b.x0 - a.x1 < 0.3 * h) steps.push(b.cx - a.cx);
      }
    });
    var pitch = median(steps) || cw * 1.1;
    if (pitch < cw * 0.95 || pitch > cw * 1.6) pitch = cw * 1.1;
    // how much ink is in a box: the share of its pixels that are at least a little dark, and its average darkness
    function inkIn(x0, y0, x1, y1) {
      x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0)); x1 = Math.min(A.W - 1, Math.round(x1)); y1 = Math.min(A.H - 1, Math.round(y1));
      var n = 0, dark = 0, sum = 0, x, y, v;
      for (y = y0; y <= y1; y++) for (x = x0; x <= x1; x++) { v = A.d[y * A.W + x]; n++; sum += v; if (v > 0.1) dark++; }
      return n ? { frac: dark / n, mean: sum / n } : { frac: 0, mean: 0 };
    }
    T_ink = inkIn;
    // which cells a number's characters fill, and whether it's money
    function cellsOf(t) {
      var g = t.g, n = g.length, k, start = g[0].w <= 0.8 * h ? g[0].cx - cw / 2 : g[0].x0;
      t.x0 = g[0].x0; t.x1 = g[n - 1].x1;
      t.y0 = Math.min.apply(null, g.map(function (c) { return c.y0; })); t.y1 = Math.max.apply(null, g.map(function (c) { return c.y1; }));
      t.cx = (t.x0 + t.x1) / 2; t.cy = (t.y0 + t.y1) / 2;
      var used = {}, last = -1, first = 1e9;
      g.forEach(function (c) {
        var left = c.w <= 0.8 * h ? c.cx - cw / 2 : c.x0;
        var k0 = Math.round((left - start) / pitch), cells = Math.max(1, Math.round((c.w + pitch - cw) / pitch));
        c.k0 = k0; c.cells = cells;
        for (k = k0; k < k0 + cells; k++) used[k] = (used[k] || 0) + 1;
        if (k0 + cells - 1 > last) last = k0 + cells - 1; if (k0 < first) first = k0;
      });
      // a digit printed too faintly to count as ink leaves an empty cell (712.3 with a pale 2 after it, or
      // 712.32 with a pale 3): a gap with ink in the upper part of the cell is a faint digit (a full stop or a
      // comma only marks the bottom of its cell)
      var faint = function (k) {
        var x = start + (k + 0.5) * pitch, ink = inkIn(x - 0.35 * pitch, t.y0, x + 0.35 * pitch, t.y0 + 0.65 * (t.y1 - t.y0));
        return ink.frac > 0.12 && ink.mean > 0.04;
      };
      t.faint = [];
      for (k = first + 1; k < last; k++) if (!used[k] && k !== last - 2 && faint(k)) { used[k] = 1; t.faint.push(k); }
      if (used[last] && !used[last - 1] && used[last - 2] && last - first >= 2 && faint(last + 1)) {
        last++; used[last] = 1; t.faint.push(last); t.x1 = Math.round(start + (last + 0.5) * pitch + cw / 2);
      }
      t.first = first; t.last = last; t.used = used; t.start = start;
      // money is digits, a full stop, then two digits: so the third cell from the right is empty (the full stop
      // prints faintly, so it's the gap that counts). Thousands may have a comma: an empty cell every 3 digits.
      t.dotAt = last - 2; t.money = false;
      if (last - first < 3 || used[t.dotAt] || !used[last] || !used[last - 1] || !used[first]) return t;
      var ok = true;
      for (k = first; k < t.dotAt; k++) if (!used[k] && (t.dotAt - k) % 4 !== 0) ok = false;
      for (k = first; k <= last; k++) if (used[k] > 1) ok = false;
      if (!used[t.dotAt - 1]) ok = false;
      // digits are full height (the torn zigzag edge of the paper makes rows of short teeth)
      var hs = g.map(function (c) { return c.h; }).sort(function (p, q) { return p - q; });
      if (hs[hs.length >> 1] < 0.8 * h) ok = false;
      t.money = ok;
      return t;
    }
    toks.forEach(cellsOf);
    // a faint digit can also split a number in two (712 and 2 either side of a pale .3): two pieces on the same line,
    // a character or two apart, that make money together become one
    var joined = true;
    while (joined) {
      joined = false;
      toks.sort(function (a, b) { return a.x0 - b.x0; });
      for (i = 0; i < toks.length && !joined; i++) for (j = i + 1; j < toks.length; j++) {
        var a = toks[i], b = toks[j], gap = b.x0 - a.x1;
        if (gap > 2.8 * pitch) break;
        if (gap < 0.8 * pitch || Math.abs(b.cy - a.cy) > 0.3 * h || (a.money && b.money)) continue;
        var m = cellsOf({ g: a.g.concat(b.g) });
        if (!m.money) { cellsOf(a); continue; }
        toks.splice(j, 1); toks.splice(i, 1, m); joined = true; break;
      }
    }
    return { toks: toks, pitch: pitch, cw: cw, glyphs: glyphs, dots: dots };
  }

  /* solve a 3 x 3 set of equations (least squares fits) */
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

  /* value = a + b*x + c*y, fitted to {x, y, v, w} samples, leaving out ones that don't fit */
  function plane(samples) {
    var use = samples.slice(), f = [median(samples.map(function (q) { return q.v; })), 0, 0], it;
    for (it = 0; it < 4 && use.length >= 6; it++) {
      var S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], R = [0, 0, 0];
      use.forEach(function (q) {
        var v = [1, q.x, q.y];
        for (var i = 0; i < 3; i++) { R[i] += q.w * v[i] * q.v; for (var j = 0; j < 3; j++) S[i][j] += q.w * v[i] * v[j]; }
      });
      var sol = solve3(S, R);
      if (!sol) break;
      f = sol;
      var res = use.map(function (q) { return Math.abs(q.v - (f[0] + f[1] * q.x + f[2] * q.y)); });
      var cut = Math.max(median(res) * 3, 0.004);
      var keep = use.filter(function (q, i) { return res[i] <= cut; });
      if (keep.length === use.length) break;
      use = keep;
    }
    return function (x, y) { return f[0] + f[1] * x + f[2] * y; };
  }

  /* ---- rows: numbers side by side, a column apart ----
     The writing's slope can change across a photo taken at an angle, so it's worked out for each place in the
     photo: first from the numbers themselves, then again from the rows they make. */
  function rows(A, T) {
    var h = A.h, money = T.toks.filter(function (t) { return t.money; }), sl = [];
    T.toks.forEach(function (t) {
      var g = t.g.filter(function (c) { return c.h >= 0.85 * h && c.h <= 1.2 * h; });
      if (g.length < 2) return;
      var a = g[0], b = g[g.length - 1], dx = b.cx - a.cx;
      if (dx < 1.5 * h) return;
      sl.push({ x: (a.cx + b.cx) / 2, y: (a.cy + b.cy) / 2, v: (b.cy - a.cy) / dx, w: dx * dx });
    });
    // first one slope for the whole photo (the middle one, longer numbers counting for more)...
    sl.sort(function (a, b) { return a.v - b.v; });
    var tw = sl.reduce(function (s, q) { return s + q.w; }, 0), acc = 0, s0 = 0;
    for (var i = 0; i < sl.length; i++) { acc += sl[i].w; if (acc >= tw / 2) { s0 = sl[i].v; break; } }
    var slope = function () { return s0; };
    var out;
    for (var pass = 0; pass < 2; pass++) {
      money.forEach(function (t) { t.next = t.prev = null; });
      money.forEach(function (a) {
        var best = null, bd = 1e9;
        money.forEach(function (b) {
          if (b === a || b.x0 <= a.x1) return;
          var gap = b.x0 - a.x1;
          if (gap < 0.9 * h || gap > 9 * h) return;
          var dy = b.cy - (a.cy + slope((a.cx + b.cx) / 2, (a.cy + b.cy) / 2) * (b.cx - a.cx));
          if (Math.abs(dy) > 0.4 * h) return;
          var score = gap + Math.abs(dy) * 4;
          if (score < bd) { bd = score; best = b; }
        });
        a.next = best;
      });
      money.forEach(function (a) { if (a.next) { if (!a.next.prev || a.next.prev.x1 < a.x1) a.next.prev = a; } });
      money.forEach(function (a) { if (a.next && a.next.prev !== a) a.next = null; });
      out = [];
      money.forEach(function (a) {
        if (a.prev && a.prev.next === a) return;
        var r = [a], c = a;
        while (c.next) { c = c.next; r.push(c); }
        out.push({ t: r });
      });
      if (pass === 0) {
        // ...then, from the rows that makes (long, so their slopes are accurate), a slope that can change
        // steadily across the photo, as it does when the photo is taken at an angle
        var rs = [];
        out.forEach(function (r) {
          if (r.t.length < 2) return;
          var a = r.t[0], b = r.t[r.t.length - 1], dx = b.cx - a.cx;
          if (dx < 8 * h) return;
          rs.push({ x: (a.cx + b.cx) / 2, y: (a.cy + b.cy) / 2, v: (b.cy - a.cy) / dx, w: dx * dx });
        });
        if (rs.length >= 6) {
          var pl = plane(rs), W = A.W, H = A.H;
          var corners = [pl(0, 0), pl(W, 0), pl(0, H), pl(W, H)];
          // believable: the slope changes by no more than 0.12 across the photo
          if (Math.max.apply(null, corners) - Math.min.apply(null, corners) < 0.12) slope = pl;
        }
      }
    }
    return { rows: out, slope: slope };
  }

  /* a straight line v = a + b*y through {y, v} points, leaving out ones that don't fit (by more than minCut) */
  function line(pts, minCut) {
    var use = pts.slice(), a = median(pts.map(function (q) { return q.v; })), b = 0, it;
    for (it = 0; it < 5 && use.length >= 3; it++) {
      var n = use.length, sy = 0, sv = 0, syy = 0, syv = 0;
      use.forEach(function (q) { sy += q.y; sv += q.v; syy += q.y * q.y; syv += q.y * q.v; });
      var den = n * syy - sy * sy;
      if (Math.abs(den) < 1e-9) break;
      b = (n * syv - sy * sv) / den; a = (sv - b * sy) / n;
      var res = use.map(function (q) { return Math.abs(q.v - (a + b * q.y)); });
      var cut = Math.max(median(res) * 3, minCut);
      var keep = use.filter(function (q, i) { return res[i] <= cut; });
      if (keep.length === use.length || keep.length < 3) break;
      use = keep;
    }
    return function (y) { return a + b * y; };
  }

  /* where each digit of a number is: the middle of each cell, and the top and bottom of the writing there */
  function geometry(A, T, slope, t) {
    var h = A.h, p = T.pitch, pts = [];
    t.g.forEach(function (c) {
      if (c.cells === 1) pts.push({ k: c.k0 + 0.5, x: c.cx });
      else for (var i = 0; i < c.cells; i++) pts.push({ k: c.k0 + i + 0.5, x: c.x0 + (c.w - (c.cells - 1) * p) / 2 + i * p });
    });
    var n = pts.length, mk = 0, mx = 0, skk = 0, skx = 0;
    pts.forEach(function (q) { mk += q.k; mx += q.x; }); mk /= n; mx /= n;
    pts.forEach(function (q) { skk += (q.k - mk) * (q.k - mk); skx += (q.k - mk) * (q.x - mx); });
    var b = skk > 0.5 ? clamp(skx / skk, 0.85 * p, 1.15 * p) : p, a = mx - b * mk;
    var s = slope(t.cx, t.cy), full = t.g.filter(function (c) { return c.h >= 0.85 * h && c.h <= 1.2 * h; });
    if (!full.length) full = t.g;
    t.p = b; t.slope = s;
    t.cellX = function (k) { return a + b * (k + 0.5); };
    t.top = function (x) { return median(full.map(function (c) { return c.y0 + s * (x - c.cx); })); };
    t.bot = function (x) { return median(full.map(function (c) { return c.y1 + s * (x - c.cx); })); };
  }

  /* ---- which row is which ----
     Rows are put in order down the receipt and matched to its four columns (each 10 characters wide, numbers
     on the right). From the bottom: OVERALL END OF DAY TOTAL, then CURRENT END OF DAY TOTAL, then Worldline
     TradeUK, then the other cards. The two end of day rows each have a heading and a blank line above them, so the
     gaps above them are twice the gap between card rows: that's how a photo missing a row is noticed. */
  function layout(A, T, R) {
    var h = A.h, p = T.pitch, slope = R.slope;
    var rs = R.rows.map(function (r) { return { t: r.t.slice() }; });
    if (!rs.length) return { rows: [], main: [] };
    var Xref = median(rs.map(function (r) { return r.t[r.t.length - 1].x1; }));
    var vOf = function (t) { return t.cy + slope(t.cx, t.cy) * (Xref - t.cx); };
    rs.forEach(function (r) { r.v = median(r.t.map(vOf)); });
    rs.sort(function (a, b) { return a.v - b.v; });
    // a row the joining missed in two pieces becomes one again
    var merged = [];
    rs.forEach(function (r) {
      var m = merged[merged.length - 1];
      var clash = m && m.t.some(function (a) { return r.t.some(function (b) { return a.x0 < b.x1 && b.x0 < a.x1; }); });
      if (m && Math.abs(r.v - m.v) < 0.6 * h && !clash) {
        m.t = m.t.concat(r.t).sort(function (a, b) { return a.x0 - b.x0; }); m.v = median(m.t.map(vOf));
      } else merged.push(r);
    });
    // the Total column: the right-hand ends of the rows make a straight line down the receipt. Rows showing all four
    // numbers (each 10 characters on from the last) certainly end in their Total, so the line goes through those;
    // with fewer than two of them, through the right-most ends (a row missing its Total ends further left)
    var full = merged.filter(function (r) {
      if (r.t.length !== 4) return false;
      for (var i = 1; i < 4; i++) { var g = (r.t[i].x1 - r.t[i - 1].x1) / (10 * p); if (g < 0.8 || g > 1.2) return false; }
      return true;
    });
    var ends = (full.length >= 2 ? full : merged).map(function (r) { return { y: r.v, v: r.t[r.t.length - 1].x1 }; });
    if (full.length < 2) {
      var far = ends.map(function (q) { return q.v; }).sort(function (a, b) { return a - b; })[Math.floor(ends.length * 0.75)];
      ends = ends.filter(function (q) { return q.v > far - 4 * p; });
    }
    var tot = line(ends, 1.5 * p);
    merged.forEach(function (r) {
      r.cols = [null, null, null, null];
      var pr = median(r.t.map(function (t) { return t.p || p; })) || p;
      r.t.forEach(function (t) {
        var back = (tot(r.v) - t.x1) / (10 * pr), c = 3 - Math.round(back);
        if (c < 0 || c > 3 || Math.abs(back - (3 - c)) > 0.3) return;
        if (!r.cols[c]) { r.cols[c] = t; t.col = c; }
      });
    });
    var main = merged.filter(function (r) { return r.cols.some(Boolean); });
    return { rows: merged, main: main, tot: tot, vOf: vOf };
  }

  function identify(main, h) {
    var n = main.length, i, res = { overall: null, current: null, trade: null, why: '' };
    var raw = [];
    for (i = 1; i < n; i++) raw.push((main[i].v - main[i - 1].v) / h);
    var small = raw.filter(function (g) { return g > 2.2 && g < 4.2; }), sig = small.length >= 2 ? median(small) : 3.1;
    res.sig = sig;
    var G = function (i) { return i >= 1 && i < n ? (main[i].v - main[i - 1].v) / h / sig : null; };
    var two = function (g) { return g !== null && g >= 1.6 && g <= 2.5; }, one = function (g) { return g !== null && g >= 0.6 && g <= 1.45; };
    if (!n) { res.why = 'none'; return res; }
    // a row of one number below everything else (a stray mark, the torn edge of the paper) is left out when the
    // rows above it make the right pattern
    var fits = function (L) { return two(G(L)) && two(G(L - 1)); };
    var weak = function (r) { return r.cols.filter(Boolean).length <= 1; };
    var L = n - 1;
    while (L > 0 && n - 1 - L < 2 && !fits(L) && weak(main[L])) L--;
    if (!fits(L)) L = n - 1;
    var g1 = G(L), g2 = G(L - 1), g3 = G(L - 2);
    if (two(g1) && two(g2)) { res.overall = main[L]; res.current = main[L - 1]; res.trade = main[L - 2]; if (g3 !== null && !one(g3)) res.why = 'odd-gaps'; }
    else if (two(g1) && g2 === null) { res.overall = main[L]; res.current = main[L - 1]; res.why = 'no-trade'; }
    else if (two(g1) && one(g2)) { res.current = main[L]; res.trade = main[L - 1]; res.why = 'no-overall'; }
    else if (g1 !== null && g1 >= 3.4 && g1 <= 4.6 && (g2 === null || one(g2))) { res.overall = main[L]; res.trade = main[L - 1]; res.why = 'no-current'; }
    else res.why = n === 1 ? 'one-row' : 'unsure';
    // every row's place on the receipt, counted up from the overall total (12) for the checks
    var at = res.overall ? L : res.current ? L : -1, idx = res.overall ? 12 : 11;
    if (at >= 0) {
      main[at].idx = idx;
      for (i = at - 1; i >= 0; i--) {
        var g = G(i + 1);
        idx -= main[i + 1].idx >= 11 ? Math.max(1, Math.round(g / 2)) : Math.max(1, Math.round(g));
        main[i].idx = idx;
      }
    }
    return res;
  }

  /* ---- reading the digits ---- */
  var GX = 10, GY = 16; // each digit is looked at as a grid of 10 x 16 squares, how dark each one is
  /* FONT START */
  // made by .github/z-report/train.mjs from photos of real Z reports
  var FONT = {
    '0': [[-.112,-.108,-.096,-.077,-.067,-.065,-.073,-.092,-.107,-.112,-.107,-.084,-.050,-.022,-.007,-.003,-.014,-.047,-.087,-.107,-.089,-.027,-.006,-.039,-.044,-.038,-.027,-.004,-.036,-.091,-.059,.042,.021,-.080,-.102,-.098,-.066,.033,.039,-.060,-.032,.084,.039,-.085,-.107,-.089,-.015,.094,.089,-.035,-.011,.108,.052,-.084,-.095,-.030,.073,.126,.113,-.022,.007,.119,.060,-.081,-.067,.023,.074,.127,.122,-.013,.019,.123,.063,-.063,-.013,.031,.011,.117,.124,-.011,.031,.127,.075,-.022,.027,-.007,-.028,.114,.123,-.011,.043,.130,.118,.066,.029,-.069,-.048,.113,.121,-.013,.050,.132,.130,.091,-.018,-.093,-.048,.115,.122,-.014,.040,.129,.120,.014,-.078,-.098,-.038,.117,.117,-.023,-.017,.111,.112,.042,-.019,-.036,.028,.116,.082,-.060,-.085,.025,.106,.110,.096,.087,.096,.082,-.025,-.101,-.109,-.076,.004,.056,.058,.054,.028,-.042,-.096,-.111,-.113,-.109,-.095,-.083,-.083,-.083,-.088,-.103,-.111,-.113]],
    '1': [[-.070,-.068,-.065,-.055,-.038,-.031,-.048,-.064,-.067,-.068,-.066,-.059,-.048,-.008,.048,.049,-.022,-.063,-.067,-.067,-.060,-.031,.013,.084,.138,.113,.003,-.061,-.067,-.066,-.054,.002,.074,.120,.158,.141,.017,-.060,-.068,-.065,-.061,-.029,.013,.072,.157,.157,.026,-.059,-.067,-.063,-.067,-.061,-.053,-.001,.139,.156,.033,-.057,-.069,-.064,-.069,-.066,-.062,-.016,.132,.157,.031,-.058,-.068,-.065,-.070,-.068,-.064,-.014,.135,.153,.026,-.057,-.066,-.062,-.069,-.069,-.063,-.012,.140,.156,.021,-.057,-.067,-.062,-.068,-.068,-.063,-.009,.143,.157,.020,-.058,-.066,-.062,-.068,-.068,-.063,-.009,.139,.152,.012,-.057,-.065,-.061,-.067,-.066,-.060,-.001,.141,.150,.007,-.057,-.063,-.060,-.058,-.041,-.016,.057,.156,.156,.046,-.035,-.050,-.057,-.038,.021,.085,.141,.162,.163,.120,.048,.002,-.044,-.048,.003,.054,.103,.141,.140,.090,.047,.006,-.043,-.065,-.055,-.044,-.029,-.007,-.003,-.026,-.038,-.047,-.059]],
    '2': [[-.089,-.087,-.068,-.038,-.024,-.038,-.048,-.064,-.080,-.089,-.083,-.058,-.007,.034,.030,.005,-.001,-.017,-.053,-.079,-.057,.019,.077,.050,-.013,-.026,.031,.060,.016,-.054,-.018,.094,.091,-.011,-.076,-.078,-.005,.111,.099,-.028,-.003,.090,.045,-.057,-.086,-.087,-.028,.134,.137,-.015,-.052,-.016,-.042,-.078,-.085,-.061,.050,.173,.145,-.018,-.080,-.081,-.082,-.082,-.063,.028,.149,.168,.078,-.054,-.080,-.084,-.078,-.059,.019,.132,.160,.083,-.040,-.086,-.080,-.081,-.051,.015,.120,.146,.063,-.040,-.085,-.090,-.075,-.046,.037,.109,.132,.056,-.043,-.082,-.089,-.092,-.048,.042,.128,.116,.033,-.050,-.079,-.085,-.090,-.092,.001,.130,.134,.037,-.045,-.071,-.074,-.079,-.084,-.087,.020,.155,.128,.024,-.019,-.038,-.046,-.055,-.067,-.080,.038,.162,.162,.125,.105,.075,.061,.048,-.006,-.069,.004,.114,.135,.113,.110,.102,.088,.081,.019,-.064,-.072,-.043,-.033,-.044,-.039,-.040,-.046,-.046,-.062,-.085]],
    '3': [[-.091,-.084,-.061,-.021,-.002,-.010,-.035,-.066,-.085,-.091,-.082,-.052,-.011,.031,.052,.053,.049,.003,-.056,-.083,-.054,.007,.018,-.013,-.019,.009,.078,.096,.027,-.055,-.042,.023,.013,-.052,-.073,-.059,.008,.120,.104,-.016,-.070,-.040,-.040,-.066,-.081,-.075,-.029,.101,.118,.003,-.084,-.081,-.072,-.068,-.073,-.057,.012,.081,.050,-.035,-.083,-.085,-.059,-.020,-.004,.034,.076,.041,-.027,-.067,-.081,-.086,-.041,.037,.089,.143,.143,.026,-.054,-.075,-.081,-.088,-.066,-.018,.025,.097,.167,.101,-.028,-.074,-.078,-.079,-.079,-.073,-.059,-.024,.098,.177,.059,-.056,-.056,-.036,-.057,-.078,-.079,-.074,.023,.193,.153,-.018,-.024,.030,-.009,-.070,-.081,-.064,.046,.215,.192,.006,-.038,.040,.049,-.004,-.022,.018,.147,.224,.156,-.009,-.070,-.009,.078,.113,.118,.154,.192,.163,.046,-.043,-.083,-.061,.010,.075,.100,.133,.119,.034,-.037,-.064,-.088,-.083,-.064,-.043,-.029,-.015,-.020,-.048,-.068,-.081]],
    '4': [[-.088,-.087,-.086,-.084,-.075,-.068,-.056,-.047,-.064,-.083,-.086,-.086,-.082,-.062,-.031,-.014,.014,.024,-.031,-.077,-.086,-.085,-.070,-.011,.039,.047,.089,.079,-.012,-.076,-.086,-.080,-.044,.045,.061,.030,.104,.109,-.002,-.073,-.084,-.064,.008,.069,.014,-.022,.091,.121,.011,-.070,-.077,-.031,.051,.050,-.031,-.041,.093,.132,.017,-.068,-.060,.024,.067,.002,-.059,-.044,.100,.137,.021,-.066,-.034,.080,.083,-.010,-.056,-.025,.116,.145,.037,-.060,-.008,.115,.128,.078,.032,.061,.147,.153,.085,-.036,-.005,.110,.138,.124,.100,.120,.152,.153,.123,-.011,-.049,.012,.050,.049,.035,.081,.145,.152,.105,-.030,-.076,-.067,-.056,-.055,-.059,-.003,.134,.148,.053,-.054,-.083,-.082,-.079,-.077,-.077,-.026,.125,.145,.031,-.061,-.085,-.085,-.084,-.083,-.083,-.038,.111,.137,.013,-.070,-.085,-.086,-.085,-.085,-.084,-.054,.048,.075,-.025,-.074,-.086,-.087,-.087,-.087,-.086,-.078,-.049,-.039,-.064,-.078]],
    '5': [[-.077,-.035,-.022,-.035,-.040,-.042,-.048,-.059,-.083,-.098,-.056,.032,.058,.016,.003,.007,.001,-.020,-.069,-.097,-.031,.094,.087,-.010,-.039,-.033,-.035,-.046,-.076,-.096,-.003,.135,.091,-.047,-.082,-.081,-.080,-.084,-.092,-.098,.010,.145,.114,-.030,-.080,-.081,-.082,-.091,-.097,-.099,.028,.160,.159,.063,-.009,-.013,-.031,-.077,-.098,-.097,.042,.165,.161,.116,.072,.078,.065,-.014,-.079,-.094,.014,.109,.074,.024,.001,.038,.106,.102,-.001,-.078,-.050,-.020,-.043,-.060,-.066,-.044,.054,.147,.094,-.046,-.069,-.052,-.062,-.081,-.084,-.081,-.018,.137,.140,-.017,-.021,.030,-.017,-.073,-.092,-.088,-.024,.137,.159,.007,.010,.100,.069,-.025,-.079,-.066,.032,.156,.157,.011,-.032,.077,.112,.061,-.000,.026,.112,.161,.109,-.026,-.075,-.002,.092,.135,.122,.119,.137,.110,.009,-.064,-.093,-.070,-.011,.047,.051,.047,.045,-.007,-.056,-.081,-.096,-.090,-.075,-.059,-.055,-.054,-.056,-.065,-.078,-.087]],
    '6': [[-.097,-.094,-.084,-.059,-.048,-.049,-.062,-.082,-.094,-.099,-.093,-.079,-.042,.007,.024,.025,.012,-.035,-.082,-.097,-.082,-.026,.047,.059,.017,.005,.038,.022,-.058,-.096,-.062,.042,.087,.028,-.052,-.067,-.025,-.019,-.067,-.093,-.038,.089,.093,-.025,-.080,-.088,-.083,-.084,-.091,-.097,-.024,.117,.104,-.026,-.077,-.084,-.089,-.093,-.095,-.097,-.015,.130,.122,.045,-.016,-.031,-.042,-.073,-.091,-.095,.002,.140,.143,.136,.087,.060,.055,-.017,-.074,-.091,.018,.141,.145,.138,.068,.045,.083,.067,-.014,-.074,.024,.139,.138,.077,-.042,-.056,.018,.092,.059,-.040,.021,.141,.128,-.007,-.083,-.086,-.039,.085,.095,-.015,.024,.137,.129,.020,-.067,-.077,-.021,.098,.104,-.008,-.015,.117,.134,.099,.010,-.006,.066,.119,.084,-.038,-.075,.026,.115,.125,.095,.097,.116,.097,-.005,-.082,-.095,-.067,.019,.083,.069,.067,.062,-.011,-.079,-.097,-.099,-.094,-.080,-.061,-.062,-.060,-.064,-.087,-.098,-.100]],
    '7': [[-.040,-.001,.010,.009,.012,.007,-.008,-.007,-.016,-.036,-.022,.041,.082,.115,.094,.055,.026,.057,.025,-.019,-.050,-.027,-.002,.018,.006,-.026,-.009,.091,.103,.004,-.059,-.056,-.052,-.045,-.053,-.061,-.025,.125,.142,.009,-.059,-.056,-.057,-.053,-.054,-.039,.063,.173,.089,-.024,-.060,-.059,-.059,-.055,-.041,.023,.141,.132,.008,-.048,-.062,-.061,-.060,-.048,.010,.080,.085,.003,-.051,-.058,-.060,-.060,-.058,-.020,.080,.126,.011,-.050,-.059,-.056,-.057,-.056,-.060,-.010,.134,.174,.015,-.053,-.057,-.058,-.059,-.061,-.063,.025,.172,.192,.017,-.048,-.059,-.062,-.059,-.063,-.060,.060,.206,.201,.008,-.055,-.057,-.062,-.060,-.060,-.061,.052,.210,.206,.000,-.056,-.057,-.060,-.058,-.061,-.060,.052,.209,.206,-.008,-.051,-.060,-.060,-.059,-.061,-.059,.074,.210,.205,-.003,-.054,-.053,-.052,-.059,-.062,-.061,.004,.157,.144,-.017,-.056,-.058,-.061,-.062,-.064,-.064,-.061,-.023,-.020,-.050,-.058,-.057,-.059]],
    '8': [[-.108,-.106,-.092,-.067,-.049,-.046,-.057,-.080,-.101,-.108,-.104,-.088,-.046,-.002,.012,.024,.005,-.032,-.075,-.100,-.089,-.029,.015,-.006,-.024,-.015,-.012,.008,-.014,-.070,-.066,.048,.064,-.048,-.088,-.090,-.076,.017,.063,-.027,-.042,.091,.094,-.045,-.096,-.101,-.081,.045,.114,-.001,-.030,.098,.112,.006,-.079,-.082,-.021,.096,.118,-.003,-.060,.023,.093,.076,.003,.010,.083,.102,.052,-.041,-.079,-.010,.100,.128,.106,.106,.139,.105,-.010,-.083,-.046,.074,.118,.067,.038,.040,.080,.116,.053,-.058,-.005,.116,.106,-.046,-.085,-.087,-.041,.099,.110,-.021,.019,.136,.098,-.067,-.103,-.105,-.063,.106,.136,-.004,.027,.151,.094,-.066,-.098,-.102,-.055,.118,.150,-.002,-.021,.114,.102,-.015,-.058,-.059,.001,.131,.122,-.036,-.088,.003,.103,.105,.080,.073,.092,.113,.009,-.087,-.109,-.086,-.003,.060,.067,.071,.058,-.007,-.080,-.104,-.110,-.110,-.097,-.079,-.076,-.074,-.076,-.094,-.106,-.109]],
    '9': [[-.101,-.092,-.074,-.050,-.044,-.041,-.052,-.079,-.093,-.098,-.093,-.061,-.012,.012,-.000,.005,.002,-.038,-.076,-.089,-.069,.010,.053,.016,-.032,-.029,.020,.022,-.020,-.068,-.038,.081,.065,-.031,-.078,-.078,-.023,.057,.057,-.040,-.022,.109,.080,-.041,-.087,-.092,-.057,.075,.103,-.013,-.025,.103,.117,.006,-.068,-.078,-.044,.097,.126,.004,-.063,.046,.111,.075,.016,.005,.042,.144,.149,.011,-.094,-.048,.045,.084,.078,.089,.125,.163,.160,.015,-.097,-.088,-.044,.000,.001,.012,.080,.162,.163,.011,-.095,-.094,-.087,-.080,-.080,-.078,-.002,.157,.162,.009,-.090,-.088,-.091,-.091,-.094,-.092,-.010,.158,.158,.011,-.064,-.049,-.067,-.083,-.089,-.062,.054,.160,.150,.002,-.034,.021,.007,-.021,-.031,.013,.124,.154,.106,-.034,-.043,.053,.084,.072,.073,.102,.137,.111,-.000,-.073,-.083,-.017,.031,.033,.048,.074,.063,-.014,-.073,-.090,-.099,-.086,-.070,-.068,-.066,-.056,-.060,-.079,-.092,-.098]]
  };
  /* FONT END */

  function bil(d, W, H, x, y) {
    if (x < 0 || y < 0 || x > W - 1 || y > H - 1) return 0;
    var x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1), fx = x - x0, fy = y - y0;
    return (d[y0 * W + x0] * (1 - fx) + d[y0 * W + x1] * fx) * (1 - fy) + (d[y1 * W + x0] * (1 - fx) + d[y1 * W + x1] * fx) * fy;
  }
  var INK = 0.45; // darkness that counts as full ink: faint print counts nearly as much as dark
  function sample(A, cx, top, bot, pw) {
    var v = new Float32Array(GX * GY), bw = pw / GX, bh = (bot - top) / GY, i, j, si, sj, k, m = 0, ss = 0;
    for (j = 0; j < GY; j++) for (i = 0; i < GX; i++) {
      var s = 0;
      for (sj = 0; sj < 3; sj++) for (si = 0; si < 3; si++) s += bil(A.d, A.W, A.H, cx - pw / 2 + (i + (si + 0.5) / 3) * bw, top + (j + (sj + 0.5) / 3) * bh);
      v[j * GX + i] = Math.min(1, s / 9 / INK);
    }
    var rows = [0, 0, 0], cnt = 0;
    for (k = 0; k < v.length; k++) { m += v[k]; if (v[k] > 0.5) { cnt++; rows[Math.min(2, Math.floor(Math.floor(k / GX) * 3 / GY))]++; } }
    m /= v.length;
    for (k = 0; k < v.length; k++) { v[k] -= m; ss += v[k] * v[k]; }
    var nrm = Math.sqrt(ss);
    if (nrm > 1e-6) for (k = 0; k < v.length; k++) v[k] /= nrm;
    return { v: v, ink: m, nrm: nrm, cnt: cnt, rows: rows };
  }
  /* the same digit looked at a little to each side, up and down: the cells are only known to a pixel or two */
  var SHIFTS = [[0, 0], [-0.1, 0], [0.1, 0], [0, -0.05], [0, 0.05], [-0.1, -0.05], [0.1, -0.05], [-0.1, 0.05], [0.1, 0.05]];
  function looks(A, b, pw, h) {
    return SHIFTS.map(function (q) { return sample(A, b[0] + q[0] * pw, b[1] + q[1] * h, b[2] + q[1] * h, pw); });
  }
  function score(v, tpls) {
    var top = -2, i, k, s;
    for (i = 0; i < tpls.length; i++) { s = 0; for (k = 0; k < v.length; k++) s += v[k] * tpls[i][k]; if (s > top) top = s; }
    return top;
  }
  function classify(vs) {
    var best = -2, second = -2, bd = null, sd = null, d, j;
    for (d in FONT) {
      var top = -2;
      for (j = 0; j < vs.length; j++) { var sc = score(vs[j].v, FONT[d]); if (sc > top) top = sc; }
      if (top > best) { second = best; sd = bd; best = top; bd = d; } else if (top > second) { second = top; sd = d; }
    }
    return { d: bd, s: best, m: best - second, alt: sd };
  }

  function readToken(A, T, t, keep) {
    var h = A.h, k, digits = [], text = '';
    var box = function (k) { var x = t.cellX(k); return [x, t.top(x) - 0.06 * h, t.bot(x) + 0.06 * h]; };
    for (k = t.first; k <= t.last; k++) {
      if (k === t.dotAt) { text += '.'; continue; }
      if (!t.used[k]) continue; // a thousands comma
      var b = box(k), vs = looks(A, b, t.p, h), sm = vs[0], c = classify(vs);
      var dg = { k: k, d: c.d, s: c.s, m: c.m, alt: c.alt, ink: sm.ink, cnt: sm.cnt };
      if (keep) dg.vs = vs.map(function (q) { return Array.prototype.slice.call(q.v); });
      digits.push(dg); text += c.d === null ? '?' : c.d;
    }
    // ink just left of the first digit: a minus sign, or more of the number hidden or missed
    var lb = box(t.first - 1), left = sample(A, lb[0], lb[1], lb[2], t.p);
    var usual = median(digits.map(function (q) { return q.cnt; }));
    t.minus = false; t.partial = false;
    if (left.cnt > Math.max(3, usual * 0.3)) {
      if (left.rows[1] >= 0.8 * left.cnt && left.cnt < usual * 0.6) t.minus = true; else t.partial = true;
    }
    t.digits = digits;
    value(t);
    t.score = digits.length ? Math.min.apply(null, digits.map(function (q) { return q.s; })) : 0;
    t.margin = digits.length ? Math.min.apply(null, digits.map(function (q) { return q.m; })) : 0;
  }

  /* a number's text and value in pence from its digits */
  function value(t) {
    var text = '', i = 0, k;
    for (k = t.first; k <= t.last; k++) {
      if (k === t.dotAt) { text += '.'; continue; }
      if (!t.used[k]) { text += ','; continue; }
      var d = t.digits[i++].d; text += d === null ? '?' : d;
    }
    t.text = (t.minus ? '-' : '') + text;
    t.pence = /\?/.test(text) ? null : (t.minus ? -1 : 1) * parseInt(text.replace(/[.,]/g, ''), 10);
  }

  /* ---- checks ----
     Every row adds up: Sale + Cashback - Refund = Total. A number with ink just left of it (a finger, a pencil
     mark) may be missing a digit, so it can make a row add up but never make it fail. */
  function adds(r) {
    if (!r) return null;
    var c = r.cols, i;
    for (i = 0; i < 4; i++) if (!c[i] || c[i].pence === null) return null;
    if (c[0].pence + c[1].pence - c[2].pence === c[3].pence) return true;
    return c.some(function (t) { return t.partial; }) ? null : false;
  }
  /* a row that doesn't add up: try the runner-up for its least certain digits. The fewest changes that make the
     row add up win (one digit before two), but only when no other way with that many changes does too */
  function mend(r) {
    if (adds(r) !== false) return false;
    var opts = [];
    r.cols.forEach(function (t, ci) {
      t.digits.forEach(function (d, di) { if (d.alt !== null && d.m < 0.12) opts.push({ ci: ci, di: di, alt: d.alt, cost: d.m }); });
    });
    opts.sort(function (a, b) { return a.cost - b.cost; });
    opts = opts.slice(0, 8);
    var found = [[], [], []];
    function tryWith(chosen) {
      var keep = chosen.map(function (o) { var d = r.cols[o.ci].digits[o.di], was = d.d; d.d = o.alt; return was; });
      r.cols.forEach(value);
      var ok = adds(r) === true;
      chosen.forEach(function (o, i) { r.cols[o.ci].digits[o.di].d = keep[i]; });
      r.cols.forEach(value);
      if (ok) found[chosen.length].push(chosen);
    }
    var i, j, pick = null;
    for (i = 0; i < opts.length; i++) tryWith([opts[i]]);
    if (found[1].length === 1) pick = found[1][0];
    else if (!found[1].length) {
      for (i = 0; i < opts.length; i++) for (j = i + 1; j < opts.length; j++) if (opts[j].ci !== opts[i].ci || opts[j].di !== opts[i].di) tryWith([opts[i], opts[j]]);
      if (found[2].length === 1) pick = found[2][0];
    }
    if (!pick) return false;
    pick.forEach(function (o) { var d = r.cols[o.ci].digits[o.di]; d.d = o.alt; d.mended = true; });
    r.cols.forEach(value);
    return true;
  }

  function read(img, opt) {
    opt = opt || {};
    var L0 = Math.max(img.width, img.height), res = { version: VERSION, warn: [], overall: null, trade: null, current: null };
    var f0 = Math.min(1, SURVEY / L0), A = analyse(img, f0);
    if (A.h && A.h < 7 && f0 < 1) { f0 = Math.min(1, f0 * 2); A = analyse(img, f0); }
    if (!A.h) { res.warn.push('nothing'); return res; }
    var f1 = Math.min(1.5, f0 * TARGET / A.h), deg = tilt(A.list, A.h);
    if (Math.abs(deg) < 3) deg = 0; // a slight tilt is handled as it is (the rows' slope is allowed for)
    if (Math.abs(f1 / f0 - 1) > 0.08 || deg) A = analyse(img, f1, deg);
    var T = tokens(A), R = rows(A, T);
    T.toks.forEach(function (t) { if (t.money) geometry(A, T, R.slope, t); });
    var Lay = layout(A, T, R);
    Lay.main.forEach(function (r) { r.cols.forEach(function (t) { if (t) readToken(A, T, t, opt.samples); }); });
    // a "number" whose digits don't look like this printer's digits (a word in the heading, a mark) is dropped
    Lay.main.forEach(function (r) { r.cols = r.cols.map(function (t) { return t && t.score >= 0.5 ? t : null; }); });
    Lay.main = Lay.main.filter(function (r) { return r.cols.some(Boolean); });
    var I = identify(Lay.main, A.h);
    res.scale = A.f; res.h = A.h; res.pitch = T.pitch; res.tilt = A.deg;
    var mended = [I.overall, I.current, I.trade].map(mend);
    var same = null, im = A.toImage;
    if (I.overall && I.current && I.overall.cols[3] && I.current.cols[3] && I.overall.cols[3].pence !== null) {
      same = I.overall.cols[3].pence === I.current.cols[3].pence;
    }
    function out(r, which) {
      if (!r) return null;
      var t = r.cols[3], o = {
        pence: t ? t.pence : null, text: t ? t.text : '', adds: adds(r), mended: mended[which],
        corners: t ? [[t.x0, t.top(t.x0)], [t.x1 + 1, t.top(t.x1)], [t.x1 + 1, t.bot(t.x1)], [t.x0, t.bot(t.x0)]].map(function (q) { return im(q[0], q[1]); }) : null,
        margin: t ? t.margin : 0,
        cols: r.cols.map(function (c) { return c ? c.text : null; })
      };
      return o;
    }
    res.overall = out(I.overall, 0); res.current = out(I.current, 1); res.trade = out(I.trade, 2);
    // sure: the row adds up, or (the overall total) it's the same as the current total, read separately, which adds up
    if (res.overall && res.overall.pence !== null) {
      res.overall.sure = res.overall.adds === true || (same === true && res.current.adds === true) ||
        (same === true && res.overall.margin > 0.05 && res.current.margin > 0.05);
    }
    if (res.trade && res.trade.pence !== null) res.trade.sure = res.trade.adds === true;
    res.same = same;
    if (I.why) res.warn.push(I.why);
    if (!Lay.main.length) res.warn.push('no-rows');
    res.rows = Lay.main.map(function (r) {
      return { idx: r.idx, cols: r.cols.map(function (c) { return c ? { text: c.text, pence: c.pence, partial: c.partial, score: c.score, margin: c.margin, digits: opt.samples ? c.digits : undefined } : null; }) };
    });
    if (opt.debug) res.debug = { A: A, T: T, R: R, Lay: Lay, I: I };
    return res;
  }

  var api = { read: read, VERSION: VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ZReport = api;
})(typeof window !== 'undefined' ? window : this);
