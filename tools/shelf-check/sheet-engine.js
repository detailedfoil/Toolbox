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
  /* what the newest brief added and took away (plan.changes), limited to the bays on the sheet */
  function planChanges(data) {
    var ch = data && data.plan && data.plan.changes;
    if (!ch) return null;
    var have = {};
    ((data && data.bays) || []).forEach(function (b) { have[b.name] = 1; });
    var mine = function (l) { return (l || []).filter(function (x) { return !x.bay || have[x.bay]; }); };
    var out = { brief: ch.brief, since: ch.since, added: mine(ch.added), removed: mine(ch.removed), check: ch.check || [] };
    var P = data.products || {};
    out.added = out.added.map(function (a) {
      var p = P[a.code];
      return { code: a.code, bay: a.bay, where: a.where, note: a.note, name: (p && p.name) || a.name || null, price: p && p.price != null ? p.price : null };
    });
    return out.added.length || out.removed.length ? out : null;
  }

  function where(s) { return s ? [s.bay, s.shelf, s.pos].filter(Boolean).join(', ') : ''; }

  /* ---------- the full list: two narrow columns, SKU and price only, folds in half down the middle ---------- */

  var CW = 86 * MM, CGAP = 10 * MM;                       // column width, and the gap the fold runs down
  var RH = { item: 6.4 * MM, chg: 10.4 * MM, shelf: 5 * MM, head: 4.6 * MM };
  var NSZ = 6.4, NLEAD = 7.2;                              // product names: small, cut off to fit

  /* wrap a name onto at most `lines` lines of `maxW` points (first line starts `indent` in), cutting the rest off with ... */
  function fitName(text, maxW, lines, indent) {
    var words = win(text).split(/ +/).filter(Boolean), out = [], cur = '', n = 0;
    function w(t) { return width('H', NSZ, t); }
    for (var i = 0; i < words.length; i++) {
      var lim = maxW - (out.length === 0 ? indent : 0), t = cur ? cur + ' ' + words[i] : words[i];
      if (w(t) <= lim) { cur = t; continue; }
      if (out.length === lines - 1) {                                  // last line: fill it, then cut
        var rest = words.slice(i).join(' '), full = cur ? cur + ' ' + rest : rest;
        while (full.length > 1 && w(full + '...') > lim) full = full.slice(0, -1);
        return out.concat([full.replace(/ +$/, '') + (full.length < (cur ? cur.length + 1 : 0) + rest.length ? '...' : '')]);
      }
      out.push(cur); cur = words[i];
    }
    if (cur) out.push(cur);
    return out;
  }

  function colText(g, font, size, gray, x, y, s) { g.text(font, size, gray, x, y, win(s)); }
  function colRight(g, font, size, gray, xr, y, s) { s = win(s); g.text(font, size, gray, xr - width(font, size, s), y, s); }

  /* a run of rows in one column, drawn the way the tables are: fills, then text, then rules */
  function drawSeg(g, x, top, rows, ends) {
    var tops = [], y = top, x1 = x + CW;
    rows.forEach(function (r) { tops.push(y); y -= r.h; });
    rows.forEach(function (r, i) {
      var bg = r.kind === 'title' ? BLACK : r.changed ? CHG : r.zebra ? ZEB : null;
      if (bg != null) g.rect(x, tops[i] - r.h, CW, r.h, bg);
    });
    rows.forEach(function (r, i) {
      var bottom = tops[i] - r.h, mid = bottom + r.h / 2;
      if (r.kind === 'title') {
        r.name.drawOn(g, x + 5, bottom + (r.h - r.name.h) / 2);
        colRight(g, 'H', 8, WHITE, x1 - 5, mid - 2.6, r.right);
      } else if (r.kind === 'head') {
        colText(g, 'HB', 7.5, 0, x + 5, mid - 2.6, 'SKU');
        colRight(g, 'HB', 7.5, 0, x + 72 * MM, mid - 2.6, 'PRICE');
        colRight(g, 'HB', 7.5, 0, x1 - 2.2 * MM, mid - 2.6, 'TICK');
      } else if (r.kind === 'shelf') {
        colText(g, 'HB', 7.5, 0, x + 5, mid - 2.6, r.label.toUpperCase());
      } else {
        var chg = r.changed, bx = x + (chg ? 7 : 5), nm = r.name || '', ps = r.pos ? win(r.pos) : '';
        if (chg) mid = bottom + r.h * 0.62;
        colText(g, 'CB', 10.5, 0, bx, mid - 3.5, r.code);
        if (chg) {
          // one line of name under the main line, across the row
          var ind = ps ? width('HB', NSZ, ps) + 4 : 0, ln = fitName(nm, 65 * MM - ind, 1, 0)[0] || '';
          if (ps) g.text('HB', NSZ, 0, bx, bottom + 4.3, ps);
          if (ln) g.text('H', NSZ, 0.15, bx + ind, bottom + 4.3, ln);
        } else {
          // up to two small lines between the SKU and the price
          var nx = x + 19.5 * MM, lim = (r.na ? 49 : 55) * MM - (nx - x), pin = ps ? width('HB', NSZ, ps) + 4 : 0;
          var lines = fitName(nm, lim, 2, pin);
          var y0 = mid + lines.length * NLEAD / 2 - 5;
          lines.forEach(function (t, i) {
            if (i === 0 && ps) g.text('HB', NSZ, GREY, nx, y0, ps);
            g.text('H', NSZ, 0.15, nx + (i === 0 ? pin : 0), y0 - i * NLEAD, t);
          });
          if (!lines.length && ps) g.text('HB', NSZ, GREY, nx, mid - 2.2, ps);
        }
        if (chg) {
          var bd = new Badge(r.up); bd.w = 16.5 * MM;
          bd.drawOn(g, x + 19 * MM, mid - 2.75 * MM);
          var was = win('was ' + money(r.was)), wx = x + 38 * MM;
          g.text('H', 7.5, 0, wx, mid - 2.6, was);
          g.line(wx + width('H', 7.5, 'was '), mid - 0.8, wx + width('H', 7.5, was), mid - 0.8, 0.8, BLACK);
          colRight(g, 'HB', 12, 0, x + 72 * MM, mid - 4.2, money(r.price));
        } else if (r.na) {
          colRight(g, 'HO', 8, GREY, x + 72 * MM, mid - 2.8, r.na);
        } else {
          colRight(g, 'HB', 11, 0, x + 72 * MM, mid - 3.9, money(r.price) + (r.star ? '*' : ''));
        }
        g.raw('1.2 w 0 G ' + num(x1 - 2.2 * MM - 4.5 * MM) + ' ' + num(mid - 2.25 * MM) + ' ' + num(4.5 * MM) + ' ' + num(4.5 * MM) + ' re S');
      }
    });
    g.raw('q 1 J 1 j');
    var end = rows.length - 1, bot = function (i) { return tops[i] - rows[i].h; };
    for (var i = 0; i <= end; i++) if (rows[i].kind !== 'title') g.line(x, bot(i), x1, bot(i), rows[i].kind === 'head' ? 1.2 : 0.3, rows[i].kind === 'head' ? BLACK : GRID);
    g.line(x, top, x1, top, 0.8, BLACK);
    g.line(x, bot(end), x1, bot(end), 0.8, BLACK);
    g.line(x, bot(end), x, top, 0.8, BLACK);
    g.line(x1, bot(end), x1, top, 0.8, BLACK);
    rows.forEach(function (r, i) {
      if (!r.changed) return;
      var t = tops[i], b = bot(i);
      g.line(x, t, x1, t, 2, BLACK); g.line(x, b, x1, b, 2, BLACK); g.line(x, b, x, t, 2, BLACK); g.line(x1, b, x1, t, 2, BLACK);
      g.line(x, b, x, t, 6, BLACK);
    });
    g.raw('Q');
    return y;
  }

  /* lays the bays out column by column: down the left half of the page, then the right half, then the next page */
  function columns(flow, groups) {
    var top = flow.y, ci = 0, y = top, seg = null, tops = [top];
    var LEFT = FRAME_X, RIGHT = FRAME_X + CW + CGAP;
    function colX() { return ci ? RIGHT : LEFT; }
    function flush() {
      if (seg && seg.rows.length) drawSeg(flow.g, colX(), seg.top, seg.rows);
      seg = null;
    }
    function advance() {
      flush();
      if (ci === 0) { ci = 1; y = tops[tops.length - 1]; return; }
      flow.newPage(); ci = 0; y = FRAME_TOP; tops.push(FRAME_TOP);
    }
    function room() { return y - FRAME_Y; }
    function need(h) { return room() - h >= -FUZZ; }
    function put(r) { if (!seg) seg = { top: y, rows: [] }; seg.rows.push(r); y -= r.h; }
    function titleRow(g, cont) {
      var nm = new Para(S('HB', cont ? 8.5 : 9.5, cont ? 10 : 11.5, WHITE), g.name + (cont ? ' (cont.)' : ''));
      nm.wrap(CW - 10 - 18 * MM);
      return { kind: 'title', name: nm, right: cont ? '' : g.count + ' lines', h: nm.h + (cont ? 6 : 9) };
    }
    groups.forEach(function (g) {
      var heads = function (cont) { var t = titleRow(g, cont), h = { kind: 'head', h: RH.head }; return [t, h]; };
      var start = function (cont) {
        var hs = heads(cont), hh = hs[0].h + hs[1].h;
        var firstRows = g.rows.slice(0, 3).reduce(function (t, r) { return t + r.h; }, 0);
        if (!need(hh + firstRows)) advance();
        hs.forEach(put);
      };
      start(false);
      g.rows.forEach(function (r, i) {
        var keep = r.h;                                                // a shelf divider travels with its first two lines
        if (r.kind === 'shelf') keep += (g.rows[i + 1] ? g.rows[i + 1].h : 0) + (g.rows[i + 2] && g.rows[i + 2].kind !== 'shelf' ? g.rows[i + 2].h : 0);
        if (!need(keep)) { advance(); start(true); }
        put(r);
      });
      flush();
      y -= 5 * MM;
      if (y - FRAME_Y < 25 * MM) advance();
    });
    flush();
    flow.colTops = tops;
  }

  /* ---------- the sheet itself (make_pdf.py) ---------- */

  function layout(data, opts) {
    var ONLY = !!(opts && opts.changesOnly);
    if (!ONLY) return planogram(data);                  // the full list is drawn like the brief's planograms
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
    flow.para(new Para(ST.meta, ONLY ? (plan.brief || planName) + '  |  Prices correct as of ' + (checked ? nice(checked) : nice(ukToday()))
      : planName + '  |  screwfix.com prices inc VAT, ' + when +
      (prevc ? '  |  compared with ' + nice(prevc) : '') + '  |  ' + done + ' of ' + codes.length + ' lines checked'));
    if (!ONLY) {
      flow.spacer(3 * MM);
      flow.strip([
      [{ t: String(changed.length), b: 1 }, { t: ' price change' + (changed.length === 1 ? '' : 's') }],
      [{ t: String(up), b: 1 }, { t: ' up  |  ' }, { t: String(changed.length - up), b: 1 }, { t: ' down' }],
      [{ t: String(notFound), b: 1 }, { t: ' not found online  |  ' }, { t: String(notChecked), b: 1 }, { t: ' not checked yet' }]
    ]);
    flow.spacer(3 * MM);
    if (ONLY) flow.spacer(0); else flow.para(new Para(ST.info, [
      { t: 'Fold down the middle (portrait). Names are small and cut off to fit. Each bay runs top shelf first, left to right along each shelf, down the left half then the right. Check the shelf ticket matches the ' }, { t: 'Price', b: 1 }, { t: ', and tick the box. Rows with a ' },
      { t: 'thick black edge', b: 1 }, { t: ' and an ' }, { t: 'UP', b: 1 }, { t: ' or ' }, { t: 'DOWN', b: 1 },
      { t: ' tag have a new price: swap the ticket.' + (notChecked ? ' A * after a price means it was not rechecked this week.' : '') }]));
    }
    flow.spacer(ONLY ? 3 * MM : 4 * MM);

    var pc = planChanges(data), newCodes = {};
    if (pc) {
      pc.added.forEach(function (a) { newCodes[a.code] = 1; });
      var prow = function (kind, x) {
        var name = [{ t: x.name || '(name not found yet)' }, { br: 1 }, { t: (kind === 'add' ? 'Now at: ' : 'Was at: ') + x.where + (x.note ? ' (' + x.note + ')' : ''), size: 8, color: BAYS }];
        var priceCell = kind === 'add'
          ? (x.price != null ? { p: new Para(ST.pr, money(x.price)) } : { p: new Para(ST.na, 'price next check') })
          : { list: [new Para(ST.pr, money(x.price)), new Para(ST.was, 'last price')] };
        return { cells: [{ p: new Para(ST.nm, name) }, { p: new Para(ST.sku, x.code) }, priceCell,
          { p: new Para(ST.chc, kind === 'add' ? 'ADDED' : 'REMOVED') }, { flow: new Box() }] };
      };
      var prows = pc.added.map(function (x) { return prow('add', x); }).concat(pc.removed.map(function (x) { return prow('rm', x); }));
      flow.table(table(header('Shelf plan changes: new brief ' + pc.brief, pc.added.length + ' added, ' + pc.removed.length + ' removed'), prows));
      flow.spacer(2 * MM);
      if (pc.check.length) {
        flow.spacer(1.5 * MM);
        flow.para(new Para(ST.info, [{ t: 'Not sure about: ', b: 1 }].concat(pc.check.map(function (c, i) { return [{ t: (i ? '; ' : '') }, { t: c.code, b: 1 }, { t: ' ' + c.why }]; }).reduce(function (a, b) { return a.concat(b); }, []))));
      }
      flow.spacer(6 * MM);
    }

    if (ONLY && !changed.length) flow.para(new Para(ST.nm, [{ t: 'No price changes this week.', b: 1 }]));
    if (ONLY && changed.length) {
      flow.table(table(header('Price changes: tickets to replace', swaps.length + ' ticket' + (swaps.length === 1 ? '' : 's')),
        swaps.map(function (s) { return row(s.code, s, true); })));
      flow.spacer(7 * MM);
    }
    if (!ONLY) {
      var groups = bays.map(function (b, bi) {
        var mine = spots.filter(function (s) { return s.bi === bi; }), rows = [], last = -1, k = 0;
        var named = shelvesOf(b).length > 1 || (shelvesOf(b)[0] || {}).label;
        mine.forEach(function (s) {
          if (named && s.si !== last) { rows.push({ kind: 'shelf', label: s.shelf || 'Shelf ' + (s.si + 1), h: RH.shelf }); last = s.si; k = 0; }
          var p = prod(s.code), chg = isChange(s.code), r = { kind: 'item', code: s.code, pos: (newCodes[s.code] ? 'NEW' + (s.pos ? ' ' + s.pos : '') : s.pos), name: p.name || '', h: chg ? RH.chg : RH.item, price: p.price };
          if (chg) { r.changed = true; r.up = p.price > p.prev; r.was = p.prev; }
          else {
            if (p.status === 'not_found') r.na = 'not found online';
            else if (p.price == null) r.na = 'not checked yet';
            else if (p.status !== 'ok') r.star = true;
            r.zebra = k % 2 === 1;
          }
          k++;
          rows.push(r);
        });
        return { name: b.name, count: mine.length, rows: rows };
      });
      columns(flow, groups);
      // the fold: a faint dashed line down the middle of every page, below the page 1 summary
      flow.pages.forEach(function (g, i) {
        var t = (flow.colTops && flow.colTops[i]) || FRAME_TOP, fx = FRAME_X + CW + CGAP / 2;
        g.raw('q 0.6 w 0.7 G [3 3] 0 d ' + num(fx) + ' ' + num(FRAME_Y - 4) + ' m ' + num(fx) + ' ' + num(t + 2) + ' l S Q');
      });
    }
    return { pages: flow.pages, changes: changed.length };
  }

  /* ---------- the full list drawn like the brief's planograms: A4 landscape, each bay as shelves of slots,
   * each slot just the SKU and its price. Bays sit side by side in brief order; a tall bay carries on in the
   * next column. Changed prices: grey slot, heavy border, arrow and the old price struck through. ---------- */

  var LW = 297 * MM, LH = 210 * MM, LM = 8 * MM;
  var PG = { cellMin: 13.5 * MM, cellMax: 18 * MM, gap: 3 * MM, cellH: 12 * MM, strip: 4.2 * MM, title: 7.5 * MM, maxCols: 8 };

  /* shrink to fit, then cut off with ... */
  function fitText(font, size, min, maxW, s) {
    s = win(s);
    var sz = size;
    while (sz > min && width(font, sz, s) > maxW) sz -= 0.25;
    if (width(font, sz, s) <= maxW) return { s: s, size: sz };
    while (s.length > 1 && width(font, sz, s + '...') > maxW) s = s.slice(0, -1);
    return { s: s.replace(/\s+$/, '') + '...', size: sz };
  }
  function tri(g, cx, cy, up, r, gray) {
    var p = up ? [cx - r, cy - r * 0.8, cx + r, cy - r * 0.8, cx, cy + r * 0.9] : [cx - r, cy + r * 0.8, cx + r, cy + r * 0.8, cx, cy - r * 0.9];
    g.raw(num(gray) + ' g ' + num(p[0]) + ' ' + num(p[1]) + ' m ' + num(p[2]) + ' ' + num(p[3]) + ' l ' + num(p[4]) + ' ' + num(p[5]) + ' l h f');
  }

  function planogram(data) {
    var P = data.products || {}, bays = data.bays || [], plan = data.plan || {};
    function prod(c) { return P[c] || { name: null, price: null, prev: null, status: 'unchecked' }; }
    function isChange(c) { var p = prod(c); return p.status === 'changed' && p.price != null && p.prev != null; }
    var spots = places(bays), codes = [], seen = {};
    spots.forEach(function (s) { if (!seen[s.code]) { seen[s.code] = 1; codes.push(s.code); } });
    var checked = data.checked;
    var when = checked ? (data.complete === false ? 'partial check, ' : '') + nice(checked) : 'partial check, ' + nice(ukToday());
    var changed = codes.filter(isChange), up = changed.filter(function (c) { return prod(c).price > prod(c).prev; }).length;
    var notFound = codes.filter(function (c) { return prod(c).status === 'not_found'; }).length;
    var notChecked = codes.filter(function (c) { var s = prod(c).status; return s !== 'ok' && s !== 'changed' && s !== 'not_found'; }).length;
    var store = plan.store || 'Screwfix', planName = plan.name || 'Shop plan', shortName = plan.short || planName;
    var pc = planChanges(data), isNew = {};
    if (pc) pc.added.forEach(function (a) { isNew[a.code] = 1; });

    var W = LW - 2 * LM, TOP = LH - LM, BOTTOM = LM + 5 * MM, HEAD = 8 * MM;

    // page 1 summary: counts, key, and what the newest brief changed
    var intro = [];                                     // no summary text on the full list (detailedfoil, 16 Oct)
    var introH = 0;

    // each bay -> segments no taller than a page
    var avail1 = TOP - HEAD - introH - BOTTOM, avail = TOP - HEAD - BOTTOM;
    var segs = [];
    // displays that aren't shelving bays are listed at the end instead of drawn (detailedfoil, 15 Oct)
    var LISTED = /^(dump stacks|till points|behind the counter|weather reactive|contingencies)/i;
    bays.forEach(function (b, bi) {
      if (LISTED.test(b.name)) return;
      var mine = spots.filter(function (s) { return s.bi === bi; });
      var shelves = [], hidden = {};
      shelvesOf(b).forEach(function (sh, si) { if (sh.hide) hidden[si] = 1; });         // e.g. the other glove sizes: checked, not drawn
      mine.forEach(function (s) {
        if (hidden[s.si]) return;
        var sh = shelves[shelves.length - 1];
        if (!sh || sh.si !== s.si) shelves.push(sh = { si: s.si, label: s.shelf, spots: [] });
        sh.spots.push(s);
      });
      var cols = Math.max(2, Math.min(PG.maxCols, shelves.reduce(function (m, sh) { return Math.max(m, sh.spots.length); }, 0)));
      // a long shelf of equal-sized slot groups (e.g. four glove sizes per slot) breaks line by group
      shelves.forEach(function (sh) {
        if (sh.spots.length <= PG.maxCols) return;
        var runs = [], run = 0;
        sh.spots.forEach(function (x, i) { if (i && x.pos === sh.spots[i - 1].pos && x.pos) run++; else { if (run) runs.push(run); run = 1; } });
        runs.push(run);
        if (runs.length > 1 && runs.every(function (r) { return r === runs[0]; }) && runs[0] >= 2 && runs[0] <= PG.maxCols) cols = runs[0];
      });
      var lim = Math.min(avail1, avail), cur = null;
      shelves.forEach(function (sh) {
        var lines = Math.ceil(sh.spots.length / cols), h = PG.strip + lines * PG.cellH;
        if (!cur || (cur.h + h > lim && cur.shelves.length)) {
          cur = { bay: b, cont: !!cur, cols: cols, h: PG.title, shelves: [], page: b.page };
          segs.push(cur);
        }
        cur.shelves.push(sh); cur.h += h;
      });
    });

    // pack segments onto pages: down a column while there's room, then the next column across, then the next page
    var widthOf = function (cols, n, cell) { return cols * cell + Math.max(0, n - 1) * PG.gap; };
    var pages = [], page = null, col = null;
    function pageCols(pg, extra, n) { return { cols: pg.cols.reduce(function (t, c) { return t + c.cols; }, 0) + extra, n: pg.cols.length + n }; }
    segs.forEach(function (sg) {
      if (page) {
        var room = (pages.length === 1 ? avail1 : avail) - col.h - PG.gap;
        if (sg.h <= room + FUZZ) {
          var grow = Math.max(0, sg.cols - col.cols), t = pageCols(page, grow, 0);
          if (widthOf(t.cols, t.n, PG.cellMin) <= W + FUZZ) { col.segs.push(sg); col.cols += grow; col.h += PG.gap + sg.h; return; }
        }
        var t2 = pageCols(page, sg.cols, 1);
        if (widthOf(t2.cols, t2.n, PG.cellMin) <= W + FUZZ) { col = { segs: [sg], cols: sg.cols, h: sg.h }; page.cols.push(col); return; }
      }
      page = { cols: [] }; pages.push(page);
      col = { segs: [sg], cols: sg.cols, h: sg.h }; page.cols.push(col);
    });

    function frame() {
      var g = new Page();
      g.w = LW; g.h = LH;
      g.text('HB', 15, 0, LM, TOP - 13, win('Shelf Price Check'));
      var hx = LM + width('HB', 15, 'Shelf Price Check') + 8;
      g.text('H', 9.5, GREY, hx, TOP - 13, win((plan.brief || planName) + '  |  Prices correct as of ' + (checked ? nice(checked) : nice(ukToday()))));
      g.line(LM, TOP - HEAD + 3, LM + W, TOP - HEAD + 3, 1.2, BLACK);
      return g;
    }
    var out = pages.map(function (pgObj, pi) {
      var g = new Page();
      g.w = LW; g.h = LH;
      // header and footer
      g.text('HB', 15, 0, LM, TOP - 13, win('Shelf Price Check'));
      var hx = LM + width('HB', 15, 'Shelf Price Check') + 8;
      g.text('H', 9.5, GREY, hx, TOP - 13, win((plan.brief || planName) + '  |  Prices correct as of ' + (checked ? nice(checked) : nice(ukToday()))));
      g.line(LM, TOP - HEAD + 3, LM + W, TOP - HEAD + 3, 1.2, BLACK);
      var y0 = TOP - HEAD;
      if (pi === 0) intro.forEach(function (p) { y0 -= 1 * MM; p.drawOn(g, LM, y0 - p.h); y0 -= p.h + 0.5 * MM; });
      y0 -= 1 * MM;

      var tc = pageCols(pgObj, 0, 0);
      var cell = Math.min(PG.cellMax, (W - (tc.n - 1) * PG.gap) / tc.cols);
      var x = LM;
      pgObj.cols.forEach(function (cl) {
        var y = y0;
        cl.segs.forEach(function (sg) { y = drawSeg2(g, x, y, sg, cell) - PG.gap; });
        x += cl.cols * cell + PG.gap;
      });
      return g;
    });

    function drawSeg2(g, bx, top, sg, cell) {
      var bw = sg.cols * cell;
      // bay title band
      g.rect(bx, top - PG.title, bw, PG.title, BLACK);
      var name = sg.bay.name + (sg.cont ? ' (cont.)' : '');
      var tag = 'p' + sg.bay.page, tagW = width('H', 7, tag) + 6;
      var ft = fitText('HB', 9.5, 6, bw - 8 - tagW, name.toUpperCase());
      g.text('HB', ft.size, WHITE, bx + 4, top - PG.title / 2 - ft.size * 0.35, ft.s);
      g.text('H', 7, WHITE, bx + bw - tagW + 2, top - PG.title / 2 - 2.4, tag);
      var cy = top - PG.title;
      sg.shelves.forEach(function (sh) {
        // shelf strip, like the brief's ticket strips
        g.rect(bx, cy - PG.strip, bw, PG.strip, 0.3);
        if (sh.label) { var fl = fitText('HB', 6.5, 5, bw - 6, sh.label.toUpperCase()); g.text('HB', fl.size, WHITE, bx + 3, cy - PG.strip / 2 - 2.3, fl.s); }
        cy -= PG.strip;
        var lines = Math.ceil(sh.spots.length / sg.cols);
        for (var ln = 0; ln < lines; ln++) {
          var row = sh.spots.slice(ln * sg.cols, (ln + 1) * sg.cols);
          var cw = bw / row.length;                         // the slots share the shelf, like the brief
          row.forEach(function (s, k) { drawSlot(g, bx + k * cw, cy - PG.cellH, cw, PG.cellH, s); });
          cy -= PG.cellH;
        }
      });
      g.raw('q 1 J 1 j');
      g.line(bx, top, bx + bw, top, 0.8, BLACK); g.line(bx, cy, bx + bw, cy, 0.8, BLACK);
      g.line(bx, cy, bx, top, 0.8, BLACK); g.line(bx + bw, cy, bx + bw, top, 0.8, BLACK);
      g.raw('Q');
      return cy;
    }

    function drawSlot(g, x, y, w, h, s) {
      var p = prod(s.code), chg = isChange(s.code), cx = x + w / 2, inner = w - (chg ? 7 : 3);
      if (chg) g.rect(x, y, w, h, CHG);
      // SKU
      var sku = fitText('CB', 9.5, 6.5, inner - (isNew[s.code] ? 0 : 0), s.code);
      var skuY = y + h - 3.2 - sku.size * 0.75;
      g.text('CB', sku.size, 0, cx - width('CB', sku.size, sku.s) / 2, skuY, sku.s);
      // price
      var priceY = y + h * 0.36, small = [];
      if (p.status === 'not_found') {
        var nf = fitText('HO', 7.5, 5.5, inner, 'not online');
        g.text('HO', nf.size, GREY, cx - width('HO', nf.size, nf.s) / 2, priceY + 1, nf.s);
      } else if (p.price == null) {
        var nc = fitText('HO', 7.5, 5.5, inner, 'not checked');
        g.text('HO', nc.size, GREY, cx - width('HO', nc.size, nc.s) / 2, priceY + 1, nc.s);
      } else {
        var star = p.status !== 'ok' && !chg ? '*' : '';
        var pr = fitText('HB', chg ? 11 : 10.5, 6.5, inner - (chg ? 9 : 0), money(p.price) + star);
        var pw = width('HB', pr.size, pr.s), px = cx - (pw + (chg ? 8 : 0)) / 2;
        g.text('HB', pr.size, 0, px, priceY, pr.s);
        if (chg) tri(g, px + pw + 4.5, priceY + pr.size * 0.35, p.price > p.prev, 2.6, 0);
      }
      // bottom line: old price struck through, and the hook/peg position
      var bits = [];
      if (s.pos) bits.push(s.pos);
      var by = y + 2.6;
      if (chg) {
        var was = win(money(p.prev)), lead = s.pos ? win(s.pos + '  ') : '';
        var full = fitText('H', 6.5, 5, inner, lead + was);
        var tw = width('H', full.size, full.s), tx = cx - tw / 2;
        g.text('H', full.size, 0, tx, by, full.s);
        var sx = tx + width('H', full.size, lead);
        g.line(sx, by + full.size * 0.33, tx + tw, by + full.size * 0.33, 0.6, BLACK);
      } else if (bits.length) {
        var b2 = fitText('H', 6, 4.5, inner, bits.join('  '));
        g.text('H', b2.size, GREY, cx - width('H', b2.size, b2.s) / 2, by, b2.s);
      }
      if (isNew[s.code]) {
        var nw = width('HB', 5.5, 'NEW') + 3;
        g.rect(x + 1.5, y + 1.5, nw, 6.5, BLACK);
        g.text('HB', 5.5, WHITE, x + 3, y + 3.4, 'NEW');
      }
      // slot border: heavy for a changed price
      g.raw('q 1 J 1 j');
      if (chg) { g.raw('2 w 0 G ' + num(x + 1) + ' ' + num(y + 1) + ' ' + num(w - 2) + ' ' + num(h - 2) + ' re S'); }
      else g.raw('0.4 w ' + num(GRID) + ' G ' + num(x) + ' ' + num(y) + ' ' + num(w) + ' ' + num(h) + ' re S');
      g.raw('Q');
    }


    /* ---------- the end list: dump bins, AOVs, till points, behind the counter, weather, contingencies ---------- */
    var LC = 4, LCG = 4 * MM, LCW = (W - (LC - 1) * LCG) / LC;
    var LR = { row: 5.6 * MM, chg: 8.4 * MM, head: 6.5 * MM, sub: 4.2 * MM };
    var items = [];
    bays.forEach(function (b, bi) {
      if (!LISTED.test(b.name)) return;
      var mine = spots.filter(function (s) { return s.bi === bi; });
      if (!mine.length) return;
      items.push({ kind: 'head', bay: b, h: LR.head });
      var named = shelvesOf(b).length > 1, last = -1;
      mine.forEach(function (s) {
        if (named && s.si !== last && s.shelf && s.shelf.toLowerCase() !== b.name.toLowerCase()) items.push({ kind: 'sub', label: s.shelf, bay: b, h: LR.sub });
        last = s.si;
        items.push({ kind: 'row', spot: s, bay: b, h: isChange(s.code) ? LR.chg : LR.row });
      });
    });
    if (items.length) {
      var lg = null, ci = LC, ly = 0, curBay = null, curSub = null, firstLg = null;
      var listTop = function () { return TOP - HEAD - 2 * MM - (lg === firstLg ? 7 * MM : 0); };
      var nextCol = function () {
        ci++;
        if (ci >= LC) { lg = frame(); out.push(lg); ci = 0; if (!firstLg) firstLg = lg; }
        ly = listTop();
      };
      var lx = function () { return LM + ci * (LCW + LCG); };
      nextCol();
      // the heading on the first list page
      lg.text('HB', 12, 0, LM, TOP - HEAD - 2 * MM - 11, win('Other displays'));
      items.forEach(function (it, k) {
        // keep a heading with its next two lines, and a shelf label with its first line
        var need = it.h + (it.kind === 'head' ? (items[k + 1] ? items[k + 1].h : 0) + (items[k + 2] ? items[k + 2].h : 0) : it.kind === 'sub' ? (items[k + 1] ? items[k + 1].h : 0) : 0);
        if (ly - need < BOTTOM) {
          nextCol();
          if (it.kind !== 'head' && curBay) { drawHead(curBay, true); if (it.kind === 'row' && curSub) drawSub(curSub, true); }
        }
        if (it.kind === 'head') { curBay = it.bay; curSub = null; drawHead(it.bay, false); }
        else if (it.kind === 'sub') { curSub = it.label; drawSub(it.label, false); }
        else drawRow(it.spot);
      });
    }
    function drawHead(b, cont) {
      var x = lx();
      ly -= cont || ly >= listTop() - 0.5 ? 0 : 1.5 * MM;
      lg.rect(x, ly - LR.head, LCW, LR.head, BLACK);
      var tag = 'p' + b.page, tagW = width('H', 7, tag) + 6;
      var ft = fitText('HB', 8.5, 6, LCW - 8 - tagW, (b.name + (cont ? ' (cont.)' : '')).toUpperCase());
      lg.text('HB', ft.size, WHITE, x + 3, ly - LR.head / 2 - ft.size * 0.35, ft.s);
      lg.text('H', 7, WHITE, x + LCW - tagW + 2, ly - LR.head / 2 - 2.4, tag);
      ly -= LR.head;
    }
    function drawSub(label, cont) {
      var x = lx();
      lg.rect(x, ly - LR.sub, LCW, LR.sub, 0.3);
      var fl = fitText('HB', 6.5, 5, LCW - 6, (label + (cont ? ' (cont.)' : '')).toUpperCase());
      lg.text('HB', fl.size, WHITE, x + 3, ly - LR.sub / 2 - 2.3, fl.s);
      ly -= LR.sub;
    }
    function drawRow(s) {
      var x = lx(), p = prod(s.code), chg = isChange(s.code), h = chg ? LR.chg : LR.row, bot = ly - h;
      if (chg) lg.rect(x, bot, LCW, h, CHG);
      var base = chg ? bot + h - 3.3 * MM : bot + h / 2 - 3;
      lg.text('CB', 8.5, 0, x + (chg ? 5 : 2.5), base, win(s.code));
      var nx = x + (chg ? 5 : 2.5) + width('CB', 8.5, s.code) + 4;
      if (s.pos) {                                           // the brief's slot label, e.g. 1A_2
        var ps = win(s.pos);
        lg.text('HB', 6, 0.35, nx, base + 0.5, ps);
        nx += width('HB', 6, ps) + 4;
      }
      if (isNew[s.code]) {
        var nw = width('HB', 5.5, 'NEW') + 3;
        lg.rect(nx, base - 1.2, nw, 6.5, BLACK);
        lg.text('HB', 5.5, WHITE, nx + 1.5, base + 0.7, 'NEW');
        nx += nw + 3;
      }
      // price on the right
      var pr, prFont = 'HB', prSize = chg ? 10 : 9.5, prGray = 0;
      if (p.status === 'not_found') { pr = 'not online'; prFont = 'HO'; prSize = 7.5; prGray = GREY; }
      else if (p.price == null) { pr = 'not checked'; prFont = 'HO'; prSize = 7.5; prGray = GREY; }
      else pr = money(p.price) + (p.status !== 'ok' && !chg ? '*' : '');
      pr = win(pr);
      var pw = width(prFont, prSize, pr), prx = x + LCW - 2.5 - pw;
      lg.text(prFont, prSize, prGray, prx, base, pr);
      var nameRight = prx - 4;
      if (chg) { tri(lg, prx - 5, base + prSize * 0.35, p.price > p.prev, 2.5, 0); nameRight = prx - 10; }
      var nm = fitText('H', 7, 7, Math.max(10, nameRight - nx), p.name || '');
      if (nm.s && nm.s !== '...') lg.text('H', nm.size, 0.15, nx, base + 0.4, nm.s);
      if (chg) {
        var was = win('was ' + money(p.prev)), ww = width('H', 6.5, was), wx = x + LCW - 2.5 - ww, wy = bot + 2.2;
        lg.text('H', 6.5, 0, wx, wy, was);
        lg.line(wx + width('H', 6.5, 'was '), wy + 2.2, wx + ww, wy + 2.2, 0.6, BLACK);
        lg.raw('q 1 J 1 j'); lg.line(x + 1.5, bot + 0.5, x + 1.5, ly - 0.5, 3, BLACK); lg.raw('Q');
      }
      lg.line(x, bot, x + LCW, bot, 0.3, GRID);
      ly = bot;
    }

    // page numbers on every page
    out.forEach(function (g, i) {
      var pg = 'Page ' + (i + 1) + ' of ' + out.length;
      g.text('H', 8, GREY, LM + W - width('H', 8, pg), LM, pg);
    });

    return { pages: out, changes: changed.length };
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
        obj(n, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + num(res.pages[i].w || PAGE_W) + ' ' + num(res.pages[i].h || PAGE_H) + ']' +
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

  var api = { build: build, nice: nice, money: money, places: places, where: where, planChanges: planChanges };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ShelfSheet = api;
})(this);
