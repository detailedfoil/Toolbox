/* Screwfix A4 price posters -> print-ready PDF, in the browser.
 *
 * Layout measured from the official InDesign posters (UK-<CODE>-A4-DD_MM_YY.pdf): big blue price top left,
 * product name under it, "Code: XXXXX", the product photo filling the space below, and a small reference
 * line up the right-hand edge. The Screwfix fonts aren't free to use, so the closest Barlow cuts stand in
 * (sized so widths and heights match the originals): Barlow Semi Condensed ExtraBold for the price and
 * the reference line, Barlow Semi Condensed Medium for the name and code.
 *
 * Text shaping, font embedding and the PDF writer follow price-tickets/ticket-engine.js; the 18+ badge
 * is the ticket one, scaled up to the poster's code line.
 */
(function (root) {
  'use strict';

  var MM = 72 / 25.4;                                    // points per mm
  var PAGE_W = 210 * MM, PAGE_H = 297 * MM;              // A4 portrait, 595.28 x 841.89 pt
  var MARGIN = 10 * MM;

  // Colours as InDesign wrote them: Screwfix blue C100 M72 Y0 K6, and process black for the reference line
  var BLUE = [1, 0.72, 0, 0.06];
  var BLACK = [0, 0, 0, 1];
  var RED = [0, 1, 1, 0];                                // sale flash, "Was" price and the 18+ badge
  var WHITE = [0, 0, 0, 0];
  var SCREEN_BLUE = '#1f4ea1';                           // the same blue on screen (preview)
  var SCREEN_RED = '#ed1c24';

  /* Everything in points, measured from the top-left corner of the page. */
  var L = {
    price: { size: 116.8, baseline: 130.69, inkLeft: 31.44, right: PAGE_W - MARGIN },
    name: { size: 36, x: MARGIN, baseline: 265.11, leading: 38.99, width: 400, maxWidth: 490 },
    code: { size: 25, x: MARGIN, below: 56.51 },                 // code baseline sits this far under the last name line
    photo: { left: MARGIN, right: PAGE_W - MARGIN, gap: 26, bottom: PAGE_H - MARGIN },   // fills the page inside 10 mm margins
    ref: { size: 5.25, hscale: 0.95, x: 571.119, y: PAGE_H - 28.3666 },  // reads bottom to top, baseline x
    // on offer: a red "SAVE OVER 30%" flash under the price (corners cut off at 45°) and "Was £29.99" in red after it
    sale: { x: MARGIN, top: 144.567, height: 49.89, corner: 2 * MM, padL: 6.88, padR: 7.16, size: 26.5, baseline: 179.26, gap: 13.43 }
  };
  var DASHES = '-–—';        // hyphen, en dash, em dash: a line may break after these

  /* The Challenge 25 "18+" badge from the ticket engine (official Screwfix ticket artwork), drawn at
   * BADGE_SCALE so it keeps the same size next to the poster's 25 pt code as it has next to the ticket's 9 pt one. */
  var BADGE = {
    gap: 3.959, size: 18.744,
    circle: { cx: 9.372, cy: 3.3719, r: 8.901, w: 0.942 },
    ops: parsePath(
      'm 6.2219 -0.381 l 6.2219 7.2704 l 4.9102 7.2704 c 4.3065 6.7186 3.6506 6.1252 2.7033 5.5423 l 3.5257 4.2619 ' +
      'c 3.8588 4.4388 4.1919 4.7095 4.4938 4.9593 l 4.4938 -0.381 h m 10.6878 3.6268 c 11.1979 4.0432 11.6559 4.4596 ' +
      '11.6559 5.5527 c 11.6559 6.8852 10.8752 7.4681 9.4802 7.4681 c 8.0749 7.4681 7.367 6.8435 7.367 5.4174 c 7.367 ' +
      '4.5221 7.6897 4.0016 8.179 3.6164 c 7.5231 3.2 7.0547 2.5963 7.0547 1.5865 c 7.0547 0.254 7.9083 -0.5059 9.4594 ' +
      '-0.5059 c 11.1562 -0.5059 11.8017 0.3685 11.8017 1.6698 c 11.8017 2.6171 11.302 3.2105 10.6878 3.6268 h m 9.3761 ' +
      '2.8253 c 9.7925 2.565 10.1361 2.3048 10.1361 1.753 c 10.1361 1.2638 9.9591 0.9307 9.4282 0.9307 c 9.0326 0.9307 ' +
      '8.7203 1.1284 8.7203 1.6698 c 8.7203 2.2319 8.9493 2.513 9.3761 2.8253 h m 9.449 4.3764 c 9.1263 4.6158 8.8452 ' +
      '4.8865 8.8452 5.4486 c 8.8452 5.9587 9.1367 6.1252 9.5219 6.1252 c 9.8966 6.1252 10.1777 5.9483 10.1777 5.459 ' +
      'c 10.1777 4.9801 9.8862 4.6783 9.449 4.3764 h m 14.9559 1.3471 l 14.9559 3.0751 l 16.5278 3.0751 l 16.5278 ' +
      '4.3243 l 14.9559 4.3243 l 14.9559 6.0316 l 13.7067 6.0316 l 13.7067 4.3243 l 12.1764 4.3243 l 12.1764 3.0751 ' +
      'l 13.7067 3.0751 l 13.7067 1.3471 h')
  };
  var BADGE_SCALE = 25 / 9;

  function parsePath(s) {
    var out = [];
    s.trim().split(/\s+/).forEach(function (tok) {
      if (/^[mlch]$/.test(tok)) out.push([tok]);
      else out[out.length - 1].push(parseFloat(tok));
    });
    return out;
  }

  function PosterError(message, kind, extra) {
    var e = new Error(message);
    e.kind = kind;
    if (extra) for (var k in extra) e[k] = extra[k];
    return e;
  }

  /* ---------- font shaping (cmap, advances, GPOS kerning) ---------- */

  function Face(d, key) {
    this.key = key;
    this.d = d;
    this.upm = d.upm;
    this.cmap = new Map();
    for (var u in d.cmap) this.cmap.set(+u, d.cmap[u]);
    this.adv = d.adv;
    this.kern = d.kern.map(function (subs) {
      return subs.map(function (st) {
        if (!st) return null;
        return st.f === 1 ? { f: 1, cov: new Set(st.cov), p: st.p }
                          : { f: 2, cov: new Set(st.cov), c1: st.c1, c2: st.c2, m: st.m };
      });
    });
    this.spaceGid = this.cmap.get(32);
  }

  Face.prototype.kernPair = function (a, b) {
    var total = 0;
    for (var i = 0; i < this.kern.length; i++) {        // each lookup applies once; first matching subtable wins
      var subs = this.kern[i];
      for (var j = 0; j < subs.length; j++) {
        var sub = subs[j];
        if (!sub || !sub.cov.has(a)) continue;
        if (sub.f === 1) {
          var row = sub.p[a];
          if (!row || !Object.prototype.hasOwnProperty.call(row, b)) continue;
          total += row[b];
        } else {
          total += sub.m[sub.c1[a] || 0][sub.c2[b] || 0];
        }
        break;
      }
    }
    return total;
  };

  Face.prototype.missing = function (text) {
    var self = this, seen = {};
    Array.from(text).forEach(function (c) {
      if (c !== '\n' && !self.cmap.has(c.codePointAt(0))) seen[c] = true;
    });
    return Object.keys(seen).sort();
  };

  /* One glyph per character (no ligatures), so the preview can place every character exactly where the PDF does. */
  Face.prototype.glyphs = function (text) {
    var self = this, missing = this.missing(text);
    if (missing.length) {
      throw PosterError('The poster font has no ' + missing.map(function (c) { return '"' + c + '"'; }).join(', ') +
                        ' (in "' + text + '")', 'chars', { chars: missing });
    }
    return Array.from(text).map(function (c) { return self.cmap.get(c.codePointAt(0)); });
  };

  /* {items: [[x, gid]], width} in the same units as size */
  Face.prototype.layout = function (text, size) {
    var gl = this.glyphs(text), x = 0, out = [];
    for (var i = 0; i < gl.length; i++) {
      out.push([x, gl[i]]);
      var a = this.adv[gl[i]] + (i + 1 < gl.length ? this.kernPair(gl[i], gl[i + 1]) : 0);
      x += a * size / this.upm;
    }
    return { items: out, width: x };
  };

  Face.prototype.width = function (text, size) { return this.layout(text, size).width; };

  Face.prototype.lsb = function (text, size) {
    var gl = this.glyphs(text.charAt(0) || ' ');
    return (this.d.lsb[gl[0]] || 0) * size / this.upm;
  };

  function squash(s) { return String(s).split(/\s+/).filter(Boolean).join(' '); }
  function rstripSpace(s) { return s.replace(/ +$/, ''); }

  /* Pieces a line may break after: spaces, and a hyphen or dash inside a word (as the ticket engine does). */
  function segments(text) {
    var cps = Array.from(squash(text)), segs = [], cur = '';
    for (var i = 0; i < cps.length; i++) {
      var ch = cps[i];
      cur += ch;
      var nxt = i + 1 < cps.length ? cps[i + 1] : '';
      if (ch === ' ' || (DASHES.indexOf(ch) >= 0 && i > 0 && cps[i - 1] !== ' ' && nxt !== '' && nxt !== ' ')) {
        segs.push(cur); cur = '';
      }
    }
    if (cur) segs.push(cur);
    return segs;
  }

  /* Greedy line breaking like the ticket engine, with one extra rule: the last line never holds a single
   * word on its own when the word before it can come down too ("... Folding / Work Platform", not
   * "... Folding Work / Platform"). With the 400 pt measure this reproduces the breaks on the official posters. */
  function wrap(face, text, size, maxW) {
    var segs = segments(text), lines = [], line = [];
    function str(parts) { return rstripSpace(parts.join('')); }
    function fits(parts) { return face.width(str(parts), size) <= maxW + 1e-6; }
    segs.forEach(function (s) {
      if (line.length && !fits(line.concat(s))) { lines.push(line); line = [s]; }
      else line.push(s);
    });
    if (line.length) lines.push(line);
    var n = lines.length;
    if (n >= 2 && lines[n - 1].length === 1 && lines[n - 2].length >= 2) {
      var moved = [lines[n - 2][lines[n - 2].length - 1]].concat(lines[n - 1]);
      if (fits(moved)) { lines[n - 2] = lines[n - 2].slice(0, -1); lines[n - 1] = moved; }
    }
    return lines.map(str).filter(Boolean);
  }

  /* Does a line (other than the last) end by splitting a hyphenated word ("Double- / Countersunk")? */
  function splitsWord(lines) {
    return lines.slice(0, -1).some(function (l) { return DASHES.indexOf(l.slice(-1)) >= 0 && l.length > 1 && l.slice(-2, -1) !== ' '; });
  }

  /* One paragraph of the name: the usual 400 pt measure, but rather than split a hyphenated word the line may
     run longer, up to 490 pt, as the official posters do ("TurboGold PZ Double-Countersunk / Woodscrews ..."). */
  function fitName(face, text) {
    var base = wrap(face, text, L.name.size, L.name.width);
    if (!splitsWord(base)) return base;
    for (var w = L.name.width + 10; w <= L.name.maxWidth; w += 10) {
      var lines = wrap(face, text, L.name.size, w);
      if (!splitsWord(lines) && lines.length <= base.length) return lines;
    }
    return base;
  }

  /* The name as poster lines: the user's own line breaks first (Enter in the name box), then wrapped to fit. */
  function nameLines(face, product) {
    var out = [];
    String(product || '').split(/\r?\n/).forEach(function (part) {
      if (squash(part)) out = out.concat(fitName(face, part));
    });
    return out;
  }

  /* ---------- tidy + check ---------- */

  var PRICE_RE = /^£\d{1,3}(,\d{3})*\.\d{2}$/;
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function pence(price) { return Math.round(parseFloat(String(price).replace(/[£,]/g, '')) * 100); }
  function money(p) {
    return '£' + (p / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /* What the sale flash says. "Save over" rounds the real saving down to a multiple of 5 and stays under it,
     so it's always true: 33.3% -> SAVE OVER 30%, 46% -> SAVE OVER 45%, exactly 35% -> SAVE OVER 30%.
     Savings of 5% or less show the money instead: SAVE £1.00. -> null when it isn't cheaper than the was price. */
  function saleOf(price, was) {
    if (!was || !PRICE_RE.test(price) || !PRICE_RE.test(was)) return null;
    var now = pence(price), before = pence(was);
    if (!(before > now) || now <= 0) return null;
    var off = before - now;
    var step = Math.floor((off * 100 - 1) / (5 * before)) * 5;     // largest multiple of 5 below the real %
    return {
      pct: off * 100 / before,
      over: step,
      flash: step >= 5 ? 'SAVE OVER ' + step + '%' : 'SAVE ' + money(off),
      was: 'Was ' + money(before)
    };
  }

  function clean(p) {
    var code = String(p.code || '').trim().toUpperCase().replace(/O/g, '0');
    var price = String(p.price || '').trim().replace(/ /g, '');
    if (price.charAt(0) !== '£') price = '£' + price;
    if (!PRICE_RE.test(price)) throw PosterError('Bad price "' + (p.price || '') + '" for ' + code + ': use £12.34', 'price');
    var was = String(p.was || '').trim().replace(/ /g, '');
    if (was && was.charAt(0) !== '£') was = '£' + was;
    if (!PRICE_RE.test(was)) was = '';
    var lines = String(p.product || '').split(/\r?\n/).map(squash).filter(Boolean);
    if (lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(new RegExp('\\s*\\(' + escapeRe(code) + '\\)\\s*$', 'i'), '');
    var pos = p.pos === 'top' || p.pos === 'bottom' ? p.pos : 'middle';
    var scale = Math.min(1, Math.max(0.3, +p.scale || 1));
    return { code: code, price: price, was: was, product: lines.filter(Boolean).join('\n'), age: !!p.age, pos: pos, scale: scale };
  }

  /* ---------- layout (shared by the PDF and the on-screen preview) ---------- */

  function layout(fonts, p, img, refDate) {
    var t = clean(p);
    // price: as big as the originals, made smaller only if a long price would run off the page
    var size = L.price.size;
    var avail = L.price.right - L.price.inkLeft;
    var inkW = fonts.bold.width(t.price, size) - fonts.bold.lsb(t.price, size);
    if (inkW > avail) size = size * avail / inkW;
    var price = { text: t.price, size: size, x: L.price.inkLeft - fonts.bold.lsb(t.price, size), y: L.price.baseline,
                  run: fonts.bold.layout(t.price, size) };

    var names = nameLines(fonts.text, t.product).map(function (text, i) {
      return { text: text, x: L.name.x, y: L.name.baseline + i * L.name.leading, run: fonts.text.layout(text, L.name.size) };
    });
    var lastY = names.length ? names[names.length - 1].y : L.name.baseline;
    var codeText = 'Code: ' + t.code;
    var code = { text: codeText, x: L.code.x, y: lastY + L.code.below, run: fonts.text.layout(codeText, L.code.size) };
    var badge = t.age ? { x: code.x + code.run.width + BADGE.gap * BADGE_SCALE, y: code.y, scale: BADGE_SCALE } : null;

    var top = code.y + L.photo.gap;
    var area = { x: L.photo.left, y: top, w: L.photo.right - L.photo.left, h: Math.max(0, L.photo.bottom - top) };
    var photo = null;
    if (img && img.w > 0 && img.h > 0 && area.h > 0) {
      var k = Math.min(area.w / img.w, area.h / img.h) * t.scale;
      var w = img.w * k, h = img.h * k;
      var y = t.pos === 'top' ? area.y : t.pos === 'bottom' ? area.y + area.h - h : area.y + (area.h - h) / 2;
      photo = { x: area.x + (area.w - w) / 2, y: y, w: w, h: h };
    }

    var refText = 'UK-' + t.code + '-A4-' + (refDate || ukDate().ref);
    var ref = { text: refText, x: L.ref.x, y: L.ref.y, size: L.ref.size, hscale: L.ref.hscale, run: fonts.bold.layout(refText, L.ref.size) };

    var sale = null, s = saleOf(t.price, t.was);
    if (s) {
      var S = L.sale, flashRun = fonts.bold.layout(s.flash, S.size), wasRun = fonts.bold.layout(s.was, S.size);
      var boxW = S.padL + flashRun.width + S.padR;
      sale = {
        info: s,
        box: { x: S.x, y: S.top, w: boxW, h: S.height, corner: S.corner },
        flash: { text: s.flash, x: S.x + S.padL, y: S.baseline, size: S.size, run: flashRun },
        was: { text: s.was, x: S.x + boxW + S.gap, y: S.baseline, size: S.size, run: wasRun }
      };
    }

    return { poster: t, price: price, sale: sale, names: names, code: code, badge: badge, area: area, photo: photo, ref: ref,
             page: { w: PAGE_W, h: PAGE_H } };
  }

  /* The flash outline: a rectangle with its corners cut off at 45°, as [x, y] points (top-left page coords) */
  function flashOutline(b) {
    var c = b.corner, x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
    return [[x0 + c, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1 - c], [x1 - c, y1], [x0 + c, y1], [x0, y1 - c], [x0, y0 + c]];
  }

  /* ---------- PDF content ---------- */

  var FP_FMT = [0, 1, 2, 3, 4, 5, 6];
  function fp1(v) {                       // reportlab-style number formatting
    var sa = Math.abs(v);
    if (sa <= 1e-7) return '0';
    var l = sa <= 1 ? 6 : Math.min(Math.max(0, 6 - Math.trunc(Math.log10(sa))), 6);
    var n = v.toFixed(FP_FMT[l]);
    if (l) n = n.replace(/0+$/, '').replace(/\.$/, '');
    return (n[0] !== '0' || n.length === 1) ? n : n.slice(1);
  }
  function fp() { return Array.prototype.map.call(arguments, fp1).join(' '); }
  function hex4(g) { return ('0000' + g.toString(16).toUpperCase()).slice(-4); }

  function glyphs(c, face, size, items) {
    c.push('BT /' + face.key + ' ' + fp(size) + ' Tf');
    items.forEach(function (it) {
      if (it[1] === face.spaceGid) return;
      c.used[face.key].add(it[1]);
      c.push('1 0 0 1 ' + fp(it[0]) + ' 0 Tm <' + hex4(it[1]) + '> Tj');
    });
    c.push('ET');
  }

  function drawRun(c, face, size, run, x, y, cmyk) {
    c.push('q');
    c.push(fp(cmyk[0], cmyk[1], cmyk[2], cmyk[3]) + ' k');
    c.push('1 0 0 1 ' + fp(x, PAGE_H - y) + ' cm');
    glyphs(c, face, size, run.items);
    c.push('Q');
  }

  function drawBadge(c, b) {
    var C = BADGE.circle, k = C.r * 0.5522847498, cx = C.cx, cy = C.cy, r = C.r;
    c.push('q');
    c.push(fp(b.scale, 0, 0, b.scale, b.x, PAGE_H - b.y) + ' cm');
    c.push('0 0 0 0 k ' + fp(RED[0], RED[1], RED[2], RED[3]) + ' K ' + fp(C.w) + ' w');
    c.push(fp(cx, cy - r) + ' m');
    c.push(fp(cx + k, cy - r, cx + r, cy - k, cx + r, cy) + ' c');
    c.push(fp(cx + r, cy + k, cx + k, cy + r, cx, cy + r) + ' c');
    c.push(fp(cx - k, cy + r, cx - r, cy + k, cx - r, cy) + ' c');
    c.push(fp(cx - r, cy - k, cx - k, cy - r, cx, cy - r) + ' c');
    c.push('b');
    c.push(fp(RED[0], RED[1], RED[2], RED[3]) + ' k');
    BADGE.ops.forEach(function (op) { c.push(op.length > 1 ? fp.apply(null, op.slice(1)) + ' ' + op[0] : op[0]); });
    c.push('f');
    c.push('Q');
  }

  function drawPoster(c, fonts, lay, imgName) {
    if (lay.photo && imgName) {
      var ph = lay.photo;
      c.push('q ' + fp(ph.w, 0, 0, ph.h, ph.x, PAGE_H - ph.y - ph.h) + ' cm /' + imgName + ' Do Q');
    }
    drawRun(c, fonts.bold, lay.price.size, lay.price.run, lay.price.x, lay.price.y, BLUE);
    if (lay.sale) {
      var pts = flashOutline(lay.sale.box);
      c.push('q ' + fp(RED[0], RED[1], RED[2], RED[3]) + ' k');
      pts.forEach(function (pt, i) { c.push(fp(pt[0], PAGE_H - pt[1]) + (i ? ' l' : ' m')); });
      c.push('h f Q');
      drawRun(c, fonts.bold, lay.sale.flash.size, lay.sale.flash.run, lay.sale.flash.x, lay.sale.flash.y, WHITE);
      drawRun(c, fonts.bold, lay.sale.was.size, lay.sale.was.run, lay.sale.was.x, lay.sale.was.y, RED);
    }
    lay.names.forEach(function (n) { drawRun(c, fonts.text, L.name.size, n.run, n.x, n.y, BLUE); });
    drawRun(c, fonts.text, L.code.size, lay.code.run, lay.code.x, lay.code.y, BLUE);
    if (lay.badge) drawBadge(c, lay.badge);
    // reference line: reads bottom to top up the right-hand edge, 95% width, like the originals
    c.push('q');
    c.push(fp(BLACK[0], BLACK[1], BLACK[2], BLACK[3]) + ' k');
    c.push('1 0 0 1 ' + fp(lay.ref.x, PAGE_H - lay.ref.y) + ' cm');
    c.push('0 1 -1 0 0 0 cm');
    c.push(fp(lay.ref.hscale) + ' 0 0 1 0 0 cm');
    glyphs(c, fonts.bold, lay.ref.size, lay.ref.run.items);
    c.push('Q');
  }

  /* ---------- minimal PDF writer: CID TrueType fonts (Identity-H), JPEG photos, Flate streams ---------- */

  function latin1(s) {
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF;
    return b;
  }

  function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
    try {
      var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); }, function () { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function toUnicodeCMap(face, used) {
    var entries = Array.from(used).sort(function (a, b) { return a - b; }).filter(function (g) { return face.d.uni[g]; });
    var out = ['/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap',
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
      '/CMapName /Adobe-Identity-UCS def', '/CMapType 2 def',
      '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange'];
    for (var i = 0; i < entries.length; i += 100) {
      var chunk = entries.slice(i, i + 100);
      out.push(chunk.length + ' beginbfchar');
      chunk.forEach(function (g) {
        var s = face.d.uni[g], h = '';
        for (var k = 0; k < s.length; k++) h += ('0000' + s.charCodeAt(k).toString(16).toUpperCase()).slice(-4);
        out.push('<' + hex4(g) + '> <' + h + '>');
      });
      out.push('endbfchar');
    }
    out.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');
    return out.join('\n');
  }

  function pdfDate(d) {
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return 'D:' + d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) +
           p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + 'Z';
  }

  function pdfString(s) { return '(' + String(s).replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '') + ')'; }

  function isJpeg(b) { return b && b.length > 3 && b[0] === 0xFF && b[1] === 0xD8; }

  function Engine(fontData, boldTtf, textTtf) {
    this.fonts = { bold: new Face(fontData.bold, 'F1'), text: new Face(fontData.text, 'F2') };
    this.ttf = { F1: new Uint8Array(boldTtf), F2: new Uint8Array(textTtf) };
    this._packed = {};
  }

  Engine.prototype._fontFile = function (key) {
    var self = this;
    if (!this._packed[key]) {
      this._packed[key] = deflate(this.ttf[key]).then(function (z) {
        return z ? { bytes: z, filter: true } : { bytes: self.ttf[key], filter: false };
      });
    }
    return this._packed[key];
  };

  /* Problems that would stop a poster printing, or null when it is fine. */
  Engine.prototype.check = function (p) {
    var c;
    try { c = clean(p); } catch (e) { return e; }
    if (!/^[0-9A-Z]+$/.test(c.code)) return PosterError('Codes are letters and numbers only', 'code');
    if (!c.product) return PosterError('Add the product name', 'product');
    var miss = this.fonts.text.missing(c.product + 'Code: ' + c.code);
    if (miss.length) return PosterError('The poster font has no ' + miss.map(function (ch) { return '"' + ch + '"'; }).join(', '), 'chars', { chars: miss });
    return null;
  };

  Engine.prototype.clean = clean;

  /* img: {w, h} of the photo, or null */
  Engine.prototype.layout = function (p, img, refDate) { return layout(this.fonts, p, img, refDate); };

  /* posters: [{code, price, product, age, pos, scale, image: {bytes: JPEG Uint8Array, w, h} | null}]
     -> Promise<Uint8Array>, one A4 page per poster, in order */
  Engine.prototype.render = function (posters, opts) {
    opts = opts || {};
    var self = this, refDate = opts.date || ukDate().ref;
    if (!posters.length) throw PosterError('No posters to print', 'empty');
    var used = { F1: new Set(), F2: new Set() };
    var pages = posters.map(function (p) {
      var img = p.image && isJpeg(p.image.bytes) ? p.image : null;
      var lay = layout(self.fonts, p, img, refDate);
      var c = [];
      c.used = used;
      drawPoster(c, self.fonts, lay, img ? 'Im1' : null);
      return { content: c.join('\n') + '\n', img: lay.photo ? img : null, ref: lay.ref.text };
    });

    return Promise.all([this._fontFile('F1'), this._fontFile('F2'),
                        Promise.all(pages.map(function (p) { return deflate(latin1(p.content)); }))])
      .then(function (res) {
        var files = { F1: res[0], F2: res[1] }, packed = res[2];
        var chunks = [], len = 0, offsets = [];
        function w(x) { var b = typeof x === 'string' ? latin1(x) : x; chunks.push(b); len += b.length; }
        function obj(num, dict, stream) {
          offsets[num] = len;
          w(num + ' 0 obj\n' + dict);
          if (stream) { w('\nstream\n'); w(stream); w('\nendstream'); }
          w('\nendobj\n');
        }
        w('%PDF-1.4\n%âãÏÓ\n');

        // 1 catalog, 2 pages, 3 info, 4-8 bold font, 9-13 text font, then per page: page, content, photo
        var fontObj = { F1: 4, F2: 9 }, next = 14;
        var nums = pages.map(function (p) {
          var n = { page: next++, content: next++ };
          if (p.img) n.img = next++;
          return n;
        });
        var title = pages.length === 1 ? pages[0].ref : 'A4 posters';
        obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
        obj(2, '<< /Type /Pages /Kids [' + nums.map(function (n) { return n.page + ' 0 R'; }).join(' ') + '] /Count ' + pages.length + ' >>');
        obj(3, '<< /Title ' + pdfString(title) + ' /Producer (Toolbox A4 posters) /CreationDate (' + pdfDate(new Date()) + ') >>');

        ['F1', 'F2'].forEach(function (key) {
          var face = key === 'F1' ? self.fonts.bold : self.fonts.text, d = face.d, n = fontObj[key];
          var s = 1000 / d.upm;
          var widths = d.adv.map(function (a) { return Math.round(a * s); }).join(' ');
          var file = files[key];
          var cmap = latin1(toUnicodeCMap(face, used[key]));
          obj(n, '<< /Type /Font /Subtype /Type0 /BaseFont /' + d.psName + ' /Encoding /Identity-H' +
                 ' /DescendantFonts [' + (n + 1) + ' 0 R] /ToUnicode ' + (n + 4) + ' 0 R >>');
          obj(n + 1, '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /' + d.psName +
                     ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>' +
                     ' /FontDescriptor ' + (n + 2) + ' 0 R /CIDToGIDMap /Identity /DW 1000 /W [0 [' + widths + ']] >>');
          obj(n + 2, '<< /Type /FontDescriptor /FontName /' + d.psName + ' /Flags 32' +
                     ' /FontBBox [' + d.bbox.map(function (v) { return Math.round(v * s); }).join(' ') + ']' +
                     ' /ItalicAngle ' + d.italicAngle + ' /Ascent ' + Math.round(d.ascent * s) +
                     ' /Descent ' + Math.round(d.descent * s) + ' /CapHeight ' + Math.round(d.capHeight * s) +
                     ' /StemV 80 /FontFile2 ' + (n + 3) + ' 0 R >>');
          obj(n + 3, '<< /Length ' + file.bytes.length + ' /Length1 ' + self.ttf[key].length +
                     (file.filter ? ' /Filter /FlateDecode' : '') + ' >>', file.bytes);
          obj(n + 4, '<< /Length ' + cmap.length + ' >>', cmap);
        });

        pages.forEach(function (p, i) {
          var n = nums[i], z = packed[i], body = z || latin1(p.content);
          obj(n.page, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + fp(PAGE_W, PAGE_H) + ']' +
                      ' /Resources << /Font << /F1 4 0 R /F2 9 0 R >>' + (n.img ? ' /XObject << /Im1 ' + n.img + ' 0 R >>' : '') +
                      ' /ProcSet [/PDF /Text' + (n.img ? ' /ImageC' : '') + '] >> /Contents ' + n.content + ' 0 R >>');
          obj(n.content, '<< /Length ' + body.length + (z ? ' /Filter /FlateDecode' : '') + ' >>', body);
          if (n.img) {
            obj(n.img, '<< /Type /XObject /Subtype /Image /Width ' + p.img.w + ' /Height ' + p.img.h +
                       ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.img.bytes.length + ' >>', p.img.bytes);
          }
        });

        var count = next;
        var xref = len;
        var x = 'xref\n0 ' + count + '\n0000000000 65535 f \n';
        for (var k = 1; k < count; k++) x += ('0000000000' + offsets[k]).slice(-10) + ' 00000 n \n';
        w(x + 'trailer\n<< /Size ' + count + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');

        var out = new Uint8Array(len), at = 0;
        chunks.forEach(function (b) { out.set(b, at); at += b.length; });
        return out;
      });
  };

  /* Today's UK date: ref 'DD_MM_YY' for the side line, iso 'YYYY-MM-DD' for file names */
  function ukDate(d) {
    d = d || new Date();
    var parts = {};
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
    } catch (e) {
      parts = { year: String(d.getFullYear()), month: ('0' + (d.getMonth() + 1)).slice(-2), day: ('0' + d.getDate()).slice(-2) };
    }
    return { ref: parts.day + '_' + parts.month + '_' + parts.year.slice(-2), iso: parts.year + '-' + parts.month + '-' + parts.day };
  }

  var api = { Engine: Engine, clean: clean, saleOf: saleOf, flashOutline: flashOutline, ukDate: ukDate, PRICE_RE: PRICE_RE,
              BADGE: BADGE, LAYOUT: L, PAGE_W: PAGE_W, PAGE_H: PAGE_H, SCREEN_BLUE: SCREEN_BLUE, SCREEN_RED: SCREEN_RED };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.PosterEngine = api;
})(this);
