/* Shelf price check sheets -> A4 PDF, in the browser (and in Node, for testing).
 *
 * A port of make_pdf.py from the old Monday shelf price check, which made these sheets with
 * reportlab: same page frame, fonts, sizes, table rules, padding, row heights, line breaking,
 * page breaks and footer, so the printouts look the same as before. It uses the PDF base fonts
 * (Helvetica and Courier), so nothing needs embedding.
 * Changed prices: grey row, heavy black frame, thick black bar on the left edge, a black UP or
 * DOWN tag, the new price, and the old price struck through.
 *
 * Additions: a line the latest run couldn't check keeps its last price with a "not rechecked"
 * note, a product that's gone from screwfix.com always reads "not found online" (the old sheet
 * showed its last price), and the lines run in shelf order: each bay top shelf first, left to
 * right, with a divider for each shelf. The changes table lists every ticket to swap in the same
 * walking order, one row per place the product sits.
 *
 * ShelfSheet.build(data, {changesOnly}) -> Promise<Uint8Array>
 *   data: {checked, previous_checked, complete, plan: {name, short, store},
 *          bays: [{page, name, shelves: [{label, codes, pos?}], codes}],
 *          products: {CODE: {name, price, prev, status}}}
 *   status: ok | changed | not_found | unchecked
 */
(function (root) {
  'use strict';

  var MM = 72 / 25.4;
  var PAGE_W = 210 * MM, PAGE_H = 297 * MM;
  var FRAME_X = 14 * MM, FRAME_Y = 15 * MM, FRAME_W = 182 * MM, FRAME_TOP = FRAME_Y + 268 * MM;
  var FUZZ = 1e-6;
  var COLS = [102 * MM, 22 * MM, 24 * MM, 20 * MM, 14 * MM];   // product, sku, price, change, tick
  var BLACK = 0, WHITE = 1, ZEB = 0.93, GRID = 0.55, GREY = 0.3, CHG = 0.8, BAYS = 0x44 / 255;

  /* Adobe font metrics for WinAnsi codes 32-255 (the numbers reportlab uses) */
  var W_H = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,
    278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,
    667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,
    333,500,278,556,500,722,500,500,500,334,260,334,584,350,556,350,222,556,333,1000,556,556,333,1000,667,333,1000,
    350,611,350,350,222,222,333,333,350,556,1000,333,1000,500,333,944,350,500,667,278,333,556,556,556,556,260,556,
    333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,
    667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,
    556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,
    556,500,556,500];
  var W_HB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,
    333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,
    667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,
    389,556,333,611,556,778,556,556,500,389,280,389,584,350,556,350,278,556,500,1000,556,556,333,1000,667,333,1000,
    350,611,350,350,278,278,500,500,350,556,1000,333,1000,556,333,944,350,500,667,278,333,556,556,556,556,280,556,
    333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,
    722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,
    556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,
    611,556,611,556];
  var FONTS = {
    H:  { id: 'F1', base: 'Helvetica', w: W_H },
    HB: { id: 'F2', base: 'Helvetica-Bold', w: W_HB },
    HO: { id: 'F3', base: 'Helvetica-Oblique', w: W_H },
    CB: { id: 'F4', base: 'Courier-Bold', w: null }            // monospaced: 600 for every character
  };
  var FONT_ORDER = ['H', 'HB', 'HO', 'CB'];
  var BOLD = { H: 'HB', HB: 'HB', HO: 'HB', CB: 'CB' };       // <b> inside a paragraph

  /* Unicode -> WinAnsi (cp1252) bytes, the encoding the base fonts are set up with */
  var CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
    0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
    0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A,
    0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  function win(s) {
    s = String(s == null ? '' : s);
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF) { out += '?'; i++; continue; }
      if (c === 9 || c === 10 || c === 13 || c === 0xA0) out += ' ';
      else if ((c >= 32 && c < 127) || (c >= 0xA1 && c <= 0xFF)) out += String.fromCharCode(c);
      else if (CP1252[c]) out += String.fromCharCode(CP1252[c]);
      else if (c === 0x2212 || c === 0x2010 || c === 0x2011) out += '-';
      else out += '?';
    }
    return out;
  }

  /* width in points of a WinAnsi string */
  function width(font, size, s) {
    var w = FONTS[font].w, t = 0;
    for (var i = 0; i < s.length; i++) t += w ? (w[s.charCodeAt(i) - 32] || 0) : 600;
    return t * size * 0.001;
  }

  function num(v) {
    var s = (Math.round(v * 1000) / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  }
  function pdfStr(s) { return s.replace(/[\\()]/g, function (c) { return '\\' + c; }); }

  /* ---------- page drawing ---------- */

  function Page() { this.ops = []; }
  Page.prototype.raw = function (s) { this.ops.push(s); };
  Page.prototype.text = function (font, size, gray, x, y, s, tw) {
    this.ops.push('BT /' + FONTS[font].id + ' ' + num(size) + ' Tf ' + num(gray) + ' g ' + (tw ? num(tw) + ' Tw ' : '') +
                  num(x) + ' ' + num(y) + ' Td (' + pdfStr(s) + ') Tj ' + (tw ? '0 Tw ' : '') + 'ET');
  };
  Page.prototype.rect = function (x, y, w, h, gray) {
    this.ops.push(num(gray) + ' g ' + num(x) + ' ' + num(y) + ' ' + num(w) + ' ' + num(h) + ' re f');
  };
  Page.prototype.line = function (x1, y1, x2, y2, lw, gray) {
    this.ops.push(num(lw) + ' w ' + num(gray) + ' G ' + num(x1) + ' ' + num(y1) + ' m ' + num(x2) + ' ' + num(y2) + ' l S');
  };

  /* ---------- paragraphs (reportlab Paragraph: greedy breaks, 5% space shrink, first baseline at top - size) ---------- */

  function S(font, size, leading, color, align) { return { font: font, size: size, leading: leading, color: color || 0, align: align || 'left' }; }
  var ST = {
    nm: S('H', 10, 12), nmb: S('HB', 10, 12), na: S('HO', 9, 11, GREY, 'right'),
    pr: S('HB', 11, 13, 0, 'right'), prc: S('HB', 12.5, 14, 0, 'right'), was: S('H', 8, 10, 0, 'right'),
    sku: S('CB', 10.5, 12), bh: S('HB', 11.5, 14, WHITE), bs: S('H', 9, 14, WHITE, 'right'),
    ch: S('HB', 8, 10), chr: S('HB', 8, 10, 0, 'right'), chc: S('HB', 8, 10, 0, 'center'),
    title: S('HB', 20, 24), meta: S('H', 9.5, 12, GREY), info: S('H', 9.5, 12),
    note: S('HO', 7.5, 9, GREY, 'center'), shelf: S('HB', 8.5, 10)
  };

  /* runs: a string, or a list of {t, b, size, color, strike} and {br: 1} */
  function Para(style, runs) {
    this.s = style;
    this.runs = typeof runs === 'string' ? [{ t: runs }] : runs;
  }
  Para.prototype.wrap = function (availW) {
    var st = this.s, words = [], word = null;
    function end(space) { if (word) { word.space = space; words.push(word); word = null; } }
    this.runs.forEach(function (r) {
      if (r.br) { end(false); words.push({ br: true }); return; }
      var font = r.b ? BOLD[st.font] : st.font, size = r.size || st.size, color = r.color != null ? r.color : st.color;
      win(r.t).split(/( +)/).forEach(function (seg) {
        if (!seg) return;
        if (seg.charAt(0) === ' ') { end(true); return; }
        if (!word) word = { parts: [], w: 0 };
        var w = width(font, size, seg);
        word.parts.push({ font: font, size: size, color: color, strike: !!r.strike, t: seg, w: w });
        word.w += w;
      });
    });
    end(false);

    var lines = [], line = null;
    function open() { line = { words: [], w: 0, spaces: 0, size: 0 }; lines.push(line); }
    words.forEach(function (wd) {
      if (wd.br) { open(); return; }
      if (!line) open();
      var n = line.words.length, sp = n ? line.words[n - 1].sp : 0;
      if (n && line.w + sp + wd.w > availW + 0.05 * (line.spaces + sp)) { open(); n = 0; sp = 0; }
      var last = wd.parts[wd.parts.length - 1];
      wd.sp = width(last.font, last.size, ' ');                  // the space after a word, in its last font
      line.spaces += sp;
      line.w += sp + wd.w;
      line.words.push(wd);
      wd.parts.forEach(function (p) { if (p.size > line.size) line.size = p.size; });
    });
    this.lines = lines.filter(function (l) { return l.words.length; }).length ? lines : [];
    this.w = availW;
    this.h = this.lines.length * st.leading;
    return this.h;
  };
  /* (x, y) is the bottom-left corner, like reportlab's drawOn */
  Para.prototype.drawOn = function (g, x, y) {
    var st = this.s, aw = this.w;
    if (!this.lines.length) return;
    var base = y + this.h - (this.lines[0].size || st.size);
    this.lines.forEach(function (ln) {
      var extra = aw - ln.w, gaps = ln.words.length - 1, tw = 0, cx;
      if (extra < -1e-8 && gaps > 0) { tw = extra / gaps; cx = x; }
      else cx = x + (st.align === 'right' ? extra : st.align === 'center' ? extra / 2 : 0);
      // runs of the same look go out as one piece of text (spaces included), struck text on its own
      var segs = [], seg = null;
      ln.words.forEach(function (wd, wi) {
        if (wi > 0) cx += ln.words[wi - 1].sp + tw;
        wd.parts.forEach(function (p, pi) {
          var gap = wi > 0 && pi === 0;
          if (seg && !p.strike && !seg.strike && seg.font === p.font && seg.size === p.size && seg.color === p.color && (gap || pi > 0)) {
            seg.t += (gap ? ' ' : '') + p.t;
            if (gap) seg.gaps++;
          } else {
            seg = { font: p.font, size: p.size, color: p.color, strike: p.strike, t: p.t, x: cx, w: p.w, gaps: 0 };
            segs.push(seg);
          }
          cx += p.w;
        });
      });
      segs.forEach(function (s) {
        g.text(s.font, s.size, s.color, s.x, base, s.t, s.gaps ? tw : 0);
        if (s.strike) g.line(s.x, base + 0.25 * s.size, s.x + s.w, base + 0.25 * s.size, 1, s.color);
      });
      base -= st.leading;
    });
  };

  /* ---------- the two little drawings ---------- */

  function Box() { this.w = this.h = 5 * MM; }
  Box.prototype.drawOn = function (g, x, y) {
    g.raw('1.2 w 0 G ' + num(x) + ' ' + num(y) + ' ' + num(this.w) + ' ' + num(this.h) + ' re S');
  };

  /* Solid black pill with a white arrow and UP / DOWN */
  function Badge(up) { this.up = up; this.w = 17 * MM; this.h = 5.5 * MM; }
  Badge.prototype.drawOn = function (g, x, y) {
    var w = this.w, h = this.h, r = 2.5, t = 0.4472 * r;
    var xl = x, xh = x + w, yl = y, yh = y + h;
    g.raw('0 g ' + [num(xl + r), num(yl), 'm', num(xh - r), num(yl), 'l',
      num(xh - t), num(yl), num(xh), num(yl + t), num(xh), num(yl + r), 'c', num(xh), num(yh - r), 'l',
      num(xh), num(yh - t), num(xh - t), num(yh), num(xh - r), num(yh), 'c', num(xl + r), num(yh), 'l',
      num(xl + t), num(yh), num(xl), num(yh - t), num(xl), num(yh - r), 'c', num(xl), num(yl + r), 'l',
      num(xl), num(yl + t), num(xl + t), num(yl), num(xl + r), num(yl), 'c', 'h f'].join(' '));
    var ax = x + 3.2 * MM, ay = y + h / 2, d = 1.6 * MM, k = 1.2 * MM, tip = 1.4 * MM;
    var pts = this.up ? [ax - d, ay - k, ax + d, ay - k, ax, ay + tip] : [ax - d, ay + k, ax + d, ay + k, ax, ay - tip];
    g.raw('1 g ' + num(pts[0]) + ' ' + num(pts[1]) + ' m ' + num(pts[2]) + ' ' + num(pts[3]) + ' l ' + num(pts[4]) + ' ' + num(pts[5]) + ' l h f');
    g.text('HB', 8.5, WHITE, x + 6 * MM, y + h / 2 - 3, this.up ? 'UP' : 'DOWN');
  };

  /* ---------- tables (reportlab Table, repeatRows=2, split between rows) ---------- */

  function cellPad(col) { return { l: 5, r: col === 2 ? 8 : 5, t: 4, b: 4 }; }

  /* rows: [title row, column heads, ...data]; cells: {p: Para} | {list: [Para]} | {flow} | null (empty) */
  function Table(rows) {
    this.rows = rows;
    rows.forEach(function (row) {
      var h = 0;
      if (row.kind === 'shelf') {
        h = row.cells[0].p.wrap(FRAME_W - 10) + 7;
      } else if (row.kind === 'title') {
        var spans = [[0, 3], [3, 5]];
        spans.forEach(function (sp) {
          var cw = 0;
          for (var c = sp[0]; c < sp[1]; c++) cw += COLS[c];
          var pad = cellPad(sp[0]);
          h = Math.max(h, contentH(row.cells[sp[0]], cw - pad.l - pad.r) + pad.t + pad.b);
        });
      } else {
        row.cells.forEach(function (cell, c) {
          var pad = cellPad(c);
          h = Math.max(h, contentH(cell, COLS[c] - pad.l - pad.r) + pad.t + pad.b);
        });
      }
      row.h = h;
    });
  }
  function contentH(cell, aw) {
    if (!cell) return 12;                                       // an empty string cell: one 12 pt line
    if (cell.p) return cell.p.wrap(aw);
    if (cell.list) return cell.list.reduce(function (t, p) { return t + p.wrap(aw); }, 0);
    return cell.flow.h;
  }
  function drawCell(g, cell, colX, colW, bottom, rowH, pad, center) {
    if (!cell) return;
    var items = cell.p ? [cell.p] : cell.list ? cell.list : [cell.flow];
    var h = items.reduce(function (t, it) { return t + it.h; }, 0);
    var y = bottom + (rowH + pad.b - pad.t + h) / 2;          // VALIGN MIDDLE
    items.forEach(function (it) {
      var x = center ? colX + (colW + pad.l - pad.r - it.w) / 2 : colX + pad.l;
      y -= it.h;
      it.drawOn(g, x, y);
    });
  }
  /* first / last: whether this part starts / ends the table. A table split over pages is drawn the way
     reportlab draws one: no heavy rule under a part that carries on over the page, and a thin grey rule
     over the heading rule on the pages it carries on to. */
  function drawTable(g, x, top, rows, first, last) {
    var x1 = x + FRAME_W, tops = [], y = top;
    rows.forEach(function (r) { tops.push(y); y -= r.h; });
    rows.forEach(function (r, i) {
      var bg = r.kind === 'title' ? BLACK : r.kind === 'shelf' ? null : r.changed ? CHG : r.zebra ? ZEB : null;
      if (bg != null) g.rect(x, tops[i] - r.h, FRAME_W, r.h, bg);
    });
    rows.forEach(function (r, i) {
      var bottom = tops[i] - r.h;
      if (r.kind === 'shelf') { r.cells[0].p.drawOn(g, x + 5, bottom + 3); return; }
      if (r.kind === 'title') {
        drawCell(g, r.cells[0], x, COLS[0] + COLS[1] + COLS[2], bottom, r.h, cellPad(0), false);
        drawCell(g, r.cells[3], x + COLS[0] + COLS[1] + COLS[2], COLS[3] + COLS[4], bottom, r.h, cellPad(3), false);
        return;
      }
      var cx = x;
      r.cells.forEach(function (cell, c) {
        drawCell(g, cell, cx, COLS[c], bottom, r.h, cellPad(c), r.kind !== 'head' && c >= 3);
        cx += COLS[c];
      });
    });
    // rules: round caps and joins, as reportlab draws table lines
    var end = rows.length - 1, bot = function (i) { return tops[i] - rows[i].h; };
    function box(t, b, lw) { g.line(x, t, x1, t, lw, BLACK); g.line(x, b, x1, b, lw, BLACK); g.line(x, b, x, t, lw, BLACK); g.line(x1, b, x1, t, lw, BLACK); }
    g.raw('q 1 J 1 j');
    g.line(x, bot(1), x1, bot(1), 1.2, BLACK);
    if (!first) g.line(x, bot(1), x1, bot(1), 0.3, GRID);
    for (var i = 2; i <= end; i++) g.line(x, bot(i), x1, bot(i), 0.3, GRID);
    for (i = 2; i <= end; i++) if (rows[i].kind === 'shelf' && i > 2) g.line(x, tops[i], x1, tops[i], 0.8, BLACK);
    if (first && last) box(tops[1], bot(end), 0.8);
    else {
      g.line(x, tops[1], x1, tops[1], 0.8, BLACK);
      g.line(x, bot(end), x, tops[1], 0.8, BLACK);
      g.line(x1, bot(end), x1, tops[1], 0.8, BLACK);
      if (last) g.line(x, bot(end), x1, bot(end), 0.8, BLACK);
    }
    for (i = 2; i <= end; i++) {
      if (!rows[i].changed) continue;
      box(tops[i], bot(i), 2);
      g.line(x, bot(i), x, tops[i], 6, BLACK);
    }
    g.raw('Q');
  }

  /* ---------- the page flow (reportlab frame: 14 mm in, 15 mm up, 182 x 268 mm) ---------- */

  function Flow(footer) { this.pages = []; this.footer = footer; this.newPage(); }
  Flow.prototype.newPage = function () {
    this.g = new Page();
    this.pages.push(this.g);
    this.y = FRAME_TOP;
    this.atTop = true;
    this.footer(this.g, this.pages.length);
  };
  Flow.prototype.fits = function (h) { return this.y - h >= FRAME_Y - FUZZ; };
  Flow.prototype.take = function (h) { this.y -= h; if (h) this.atTop = false; };
  Flow.prototype.spacer = function (h) { if (!this.fits(h)) this.newPage(); this.take(h); };
  Flow.prototype.para = function (p) {
    p.wrap(FRAME_W);
    if (!this.fits(p.h) && !this.atTop) this.newPage();
    p.drawOn(this.g, FRAME_X, this.y - p.h);
    this.take(p.h);
  };
  Flow.prototype.condBreak = function (h) {
    var room = this.y - FRAME_Y;
    if ((room <= 0 || room < h) && !this.atTop) this.newPage();
  };
  Flow.prototype.table = function (t) {
    var rows = t.rows, first = true;
    for (;;) {
      var total = rows.reduce(function (s, r) { return s + r.h; }, 0);
      if (this.fits(total)) {
        drawTable(this.g, FRAME_X, this.y, rows, first, true);
        this.take(total);
        return;
      }
      var room = this.y - FRAME_Y, acc = 0, n = 0;
      for (var i = 0; i < rows.length; i++) { if (acc + rows[i].h > room) break; acc += rows[i].h; n++; }
      while (n > 3 && rows[n - 1].kind === 'shelf') { acc -= rows[n - 1].h; n--; }   // a shelf divider goes with its lines
      if (n <= 2 && !this.atTop) { this.newPage(); continue; } // not even one line fits under the headings
      if (n <= 2) { n = Math.min(3, rows.length); acc = rows.slice(0, n).reduce(function (s, r) { return s + r.h; }, 0); }
      drawTable(this.g, FRAME_X, this.y, rows.slice(0, n), first, n >= rows.length);
      this.take(acc);
      if (n >= rows.length) return;
      rows = rows.slice(0, 2).concat(rows.slice(n));
      first = false;
      this.newPage();
    }
  };
  /* the summary strip: one row, three cells, bottom-aligned, rules above and below */
  Flow.prototype.strip = function (cells) {
    var widths = [50 * MM, 50 * MM, 82 * MM], pad = { l: 0, r: 6, t: 5, b: 5 }, rh = 0;
    var paras = cells.map(function (runs, i) {
      var p = new Para(ST.nm, runs);
      rh = Math.max(rh, p.wrap(widths[i] - pad.l - pad.r) + pad.t + pad.b);
      return p;
    });
    if (!this.fits(rh) && !this.atTop) this.newPage();
    var top = this.y, bottom = top - rh, x = FRAME_X, g = this.g;
    paras.forEach(function (p, i) { p.drawOn(g, x + pad.l, bottom + pad.b); x += widths[i]; });
    g.raw('q 1 J 1 j');
    g.line(FRAME_X, top, FRAME_X + FRAME_W, top, 1.5, BLACK);
    g.line(FRAME_X, bottom, FRAME_X + FRAME_W, bottom, 1.5, BLACK);
    g.raw('Q');
    this.take(rh);
  };

  /* ---------- dates and money ---------- */

  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function nice(iso) {                                             // 2026-10-05 -> Mon 5 Oct 2026
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return String(iso || '');
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return DAYS[d.getUTCDay()] + ' ' + (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1];
  }
  function ukToday() {
    var parts = {};
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value; });
      return parts.year + '-' + parts.month + '-' + parts.day;
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }
  function money(v) { return '£' + Number(v).toFixed(2); }

  /* ---------- where each line sits: bay by bay, top shelf first, left to right ---------- */

  function shelvesOf(b) { return b.shelves && b.shelves.length ? b.shelves : [{ label: '', codes: b.codes || [] }]; }
  function places(bays) {
    var out = [];
    (bays || []).forEach(function (b, bi) {
      var seen = {};
      shelvesOf(b).forEach(function (sh, si) {
        (sh.codes || []).forEach(function (c, i) {
          if (seen[c]) return;                                   // the same line twice in one bay: once is enough
          seen[c] = 1;
          out.push({ code: c, bi: bi, si: si, bay: b.name, shelf: sh.label || '', pos: (sh.pos && sh.pos[i]) || '' });
        });
      });
    });
    return out;
  }
  function where(s) { return s ? [s.bay, s.shelf, s.pos].filter(Boolean).join(', ') : ''; }

  /* ---------- the sheet itself (make_pdf.py) ---------- */

  function layout(data, opts) {
    var ONLY = !!(opts && opts.changesOnly);
    var P = data.products || {}, bays = data.bays || [], plan = data.plan || {};
    var spots = places(bays), codes = [], seen = {};
    spots.forEach(function (s) { if (!seen[s.code]) { seen[s.code] = 1; codes.push(s.code); } });
    function prod(c) { return P[c] || { name: null, price: null, prev: null, status: 'unchecked' }; }
    function isChange(c) { var p = prod(c); return p.status === 'changed' && p.price != null && p.prev != null; }

    var checked = data.checked, prevc = data.previous_checked;
    var when = checked ? (data.complete === false ? 'partial check, ' : '') + nice(checked) : 'partial check, ' + nice(ukToday());
    var changed = codes.filter(isChange);
    var swaps = spots.filter(function (s) { return isChange(s.code); });
    var up = changed.filter(function (c) { return prod(c).price > prod(c).prev; }).length;
    var notFound = codes.filter(function (c) { return prod(c).status === 'not_found'; }).length;
    var notChecked = codes.filter(function (c) { var s = prod(c).status; return s !== 'ok' && s !== 'changed' && s !== 'not_found'; }).length;
    var done = codes.length - notChecked;
    var store = plan.store || 'Screwfix', planName = plan.name || 'Shop plan', shortName = plan.short || planName;

    var flow = new Flow(function (g, pageNo) {
      g.text('H', 8, GREY, 14 * MM, 9 * MM, win(store + '  |  ' + shortName + ' shelf price check  |  screwfix.com prices inc VAT, ' + when));
      var pg = 'Page ' + pageNo;
      g.text('H', 8, GREY, 196 * MM - width('H', 8, pg), 9 * MM, pg);
    });

    function header(title, right) {
      return [
        { kind: 'title', cells: [{ p: new Para(ST.bh, title) }, null, null, { p: new Para(ST.bs, right) }, null] },
        { kind: 'head', cells: [{ p: new Para(ST.ch, 'PRODUCT') }, { p: new Para(ST.ch, 'SKU') }, { p: new Para(ST.chr, 'PRICE') },
                                { p: new Para(ST.chc, 'CHANGE') }, { p: new Para(ST.chc, 'TICK') }] }
      ];
    }
    function row(c, spot, withBay) {
      var p = prod(c), name = [];
      if (spot && spot.pos && !withBay) name.push({ t: spot.pos + '  ', b: 1, size: 8.5 });
      name.push({ t: p.name || '(name not found yet)' });
      if (withBay) name.push({ br: 1 }, { t: where(spot), size: 8, color: BAYS });
      if (isChange(c)) {
        return { changed: true, cells: [{ p: new Para(ST.nmb, name) }, { p: new Para(ST.sku, c) },
          { list: [new Para(ST.prc, money(p.price)), new Para(ST.was, [{ t: 'was ' }, { t: money(p.prev), strike: 1 }])] },
          { flow: new Badge(p.price > p.prev) }, { flow: new Box() }] };
      }
      var price, note = null;
      if (p.status === 'not_found') price = new Para(ST.na, 'not found online');
      else if (p.price == null) price = new Para(ST.na, 'not checked yet');
      else {
        price = new Para(ST.pr, money(p.price));
        if (p.status !== 'ok') note = { p: new Para(ST.note, 'not rechecked') };
      }
      return { cells: [{ p: new Para(ST.nm, name) }, { p: new Para(ST.sku, c) }, { p: price }, note, { flow: new Box() }] };
    }
    function table(head, rows) {
      var k = 0;
      rows.forEach(function (r) { if (r.kind === 'shelf') { k = 0; return; } r.zebra = !r.changed && k++ % 2 === 1; });
      return new Table(head.concat(rows));
    }
    function shelfRow(label) { return { kind: 'shelf', cells: [{ p: new Para(ST.shelf, label.toUpperCase()) }] }; }

    flow.para(new Para(ST.title, ONLY ? 'Price Changes' : 'Shelf Price Check'));
    flow.spacer(1.5 * MM);
    flow.para(new Para(ST.meta, planName + '  |  screwfix.com prices inc VAT, ' + when +
      (prevc ? '  |  compared with ' + nice(prevc) : '') + '  |  ' + done + ' of ' + codes.length + ' lines checked'));
    flow.spacer(3 * MM);
    flow.strip([
      [{ t: String(changed.length), b: 1 }, { t: ' price change' + (changed.length === 1 ? '' : 's') }],
      [{ t: String(up), b: 1 }, { t: ' up  |  ' }, { t: String(changed.length - up), b: 1 }, { t: ' down' }],
      [{ t: String(notFound), b: 1 }, { t: ' not found online  |  ' }, { t: String(notChecked), b: 1 }, { t: ' not checked yet' }]
    ]);
    flow.spacer(3 * MM);
    flow.para(new Para(ST.info, ONLY ? 'Only lines whose price changed are listed, in shelf order: each bay top shelf first, left to right. A product on more than one shelf has a row for each. Swap each ticket to the new price, then tick the box.' : [
      { t: 'Each bay runs top shelf first, left to right along each shelf. Check the shelf ticket matches the ' }, { t: 'Price', b: 1 }, { t: ', and tick the box. Rows with a ' },
      { t: 'thick black edge', b: 1 }, { t: ' and an ' }, { t: 'UP', b: 1 }, { t: ' or ' }, { t: 'DOWN', b: 1 },
      { t: ' tag have a new price: swap the ticket. They are also listed together on the first page so you can print the new tickets in one go.' }]));
    flow.spacer(5 * MM);

    if (ONLY && !changed.length) flow.para(new Para(ST.nm, [{ t: 'No price changes this week.', b: 1 }]));
    if (changed.length) {
      flow.table(table(header('Price changes: tickets to replace', swaps.length + ' ticket' + (swaps.length === 1 ? '' : 's')),
        swaps.map(function (s) { return row(s.code, s, true); })));
      flow.spacer(7 * MM);
    }
    if (!ONLY) {
      bays.forEach(function (b, bi) {
        var mine = spots.filter(function (s) { return s.bi === bi; }), rows = [], last = -1;
        var named = shelvesOf(b).length > 1 || (shelvesOf(b)[0] || {}).label;
        mine.forEach(function (s) {
          if (named && s.si !== last) { rows.push(shelfRow(s.shelf || 'Shelf ' + (s.si + 1))); last = s.si; }
          rows.push(row(s.code, s, false));
        });
        flow.condBreak(45 * MM);
        flow.table(table(header(b.name, 'p.' + b.page + '  |  ' + mine.length + ' lines'), rows));
        flow.spacer(6 * MM);
      });
    }
    return { pages: flow.pages, changes: changed.length };
  }

  /* ---------- PDF file ---------- */

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
  function pdfDate(d) {
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return 'D:' + d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + 'Z';
  }

  function build(data, opts) {
    var res;
    try { res = layout(data, opts); } catch (e) { return Promise.reject(e); }
    var streams = res.pages.map(function (p) { return latin1(p.ops.join('\n') + '\n'); });
    return Promise.all(streams.map(deflate)).then(function (packed) {
      var chunks = [], len = 0, offsets = [];
      function w(x) { var b = typeof x === 'string' ? latin1(x) : x; chunks.push(b); len += b.length; }
      function obj(n, dict, stream) {
        offsets[n] = len;
        w(n + ' 0 obj\n' + dict);
        if (stream) { w('\nstream\n'); w(stream); w('\nendstream'); }
        w('\nendobj\n');
      }
      w('%PDF-1.4\n%âãÏÓ\n');
      // 1 catalog, 2 page tree, 3 info, 4-7 fonts, then a page and its contents for each page
      var first = 8, kids = res.pages.map(function (_, i) { return (first + 2 * i) + ' 0 R'; }).join(' ');
      obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
      obj(2, '<< /Type /Pages /Kids [' + kids + '] /Count ' + res.pages.length + ' >>');
      obj(3, '<< /Title (Screwfix Shelf Price Check) /Author (detailedfoil) /Producer (Toolbox shelf check) /CreationDate (' + pdfDate(new Date()) + ') >>');
      FONT_ORDER.forEach(function (k, i) {
        obj(4 + i, '<< /Type /Font /Subtype /Type1 /BaseFont /' + FONTS[k].base + ' /Encoding /WinAnsiEncoding >>');
      });
      var fontRes = FONT_ORDER.map(function (k, i) { return '/' + FONTS[k].id + ' ' + (4 + i) + ' 0 R'; }).join(' ');
      res.pages.forEach(function (_, i) {
        var n = first + 2 * i, z = packed[i], body = z || streams[i];
        obj(n, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + num(PAGE_W) + ' ' + num(PAGE_H) + ']' +
               ' /Resources << /Font << ' + fontRes + ' >> /ProcSet [/PDF /Text] >> /Contents ' + (n + 1) + ' 0 R >>');
        obj(n + 1, '<< /Length ' + body.length + (z ? ' /Filter /FlateDecode' : '') + ' >>', body);
      });
      var count = first + 2 * res.pages.length, xref = len;
      var x = 'xref\n0 ' + count + '\n0000000000 65535 f \n';
      for (var k = 1; k < count; k++) x += ('0000000000' + offsets[k]).slice(-10) + ' 00000 n \n';
      w(x + 'trailer\n<< /Size ' + count + ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
      var out = new Uint8Array(len), at = 0;
      chunks.forEach(function (b) { out.set(b, at); at += b.length; });
      return out;
    });
  }

  var api = { build: build, nice: nice, money: money, places: places, where: where };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ShelfSheet = api;
})(this);
