// Makes a test photo for the Z Report reader from a real photo of a Z report, with every amount on it changed:
//   node .github/z-report/make-fixture.mjs truth.json real.jpg out.jpg
// truth.json is the real receipt's rows, as for train.mjs ({ "rows": [...] } or [{ "rows": [...] }]): it stays on your
// own computer, with the real photo. The repo is public, so real Z reports never go in it. This keeps the real photo's
// look (the angle, the light, the fingers, the printer's own digits) but puts made-up amounts in it (FAKE below, which
// add up just like a real receipt) by copying each digit needed from somewhere else on the same photo, so each real
// amount must have the same number of digits as the made-up one in its place. The heading (terminal number, store,
// date) is blurred, and so is everything else along each row of amounts (a number half under a finger, say).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const jpeg = require('jpeg-js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const Z = require(path.join(REPO, 'tools/z-report/reader.js'));

// the made-up receipt: overall end of day total 712.32, Worldline TradeUK 27.06
export const FAKE = [
  ['317.65', '0.00', '48.20', '269.45'], ['83.07', '0.00', '0.00', '83.07'], ['0.00', '0.00', '0.00', '0.00'],
  ['251.39', '0.00', '0.00', '251.39'], ['0.00', '0.00', '0.00', '0.00'], ['0.00', '0.00', '0.00', '0.00'],
  ['0.00', '0.00', '0.00', '0.00'], ['0.00', '0.00', '0.00', '0.00'], ['117.64', '0.00', '36.29', '81.35'],
  ['0.00', '0.00', '0.00', '0.00'], ['27.06', '0.00', '0.00', '27.06'], ['796.81', '0.00', '84.49', '712.32'],
  ['796.81', '0.00', '84.49', '712.32']];

const [truthFile, src, out] = process.argv.slice(2);
if (!truthFile || !src || !out) { console.error('usage: node .github/z-report/make-fixture.mjs truth.json real.jpg out.jpg'); process.exit(1); }
const tj = JSON.parse(fs.readFileSync(truthFile, 'utf8')), TRUTH = Array.isArray(tj) ? tj[0].rows : tj.rows;
TRUTH.forEach((row, i) => row.forEach((v, c) => {
  if (v.replace(/[^0-9]/g, '').length !== FAKE[i][c].replace(/[^0-9]/g, '').length || v.indexOf('.') !== FAKE[i][c].indexOf('.')) throw new Error(`row ${i} column ${c}: ${v} and the made-up ${FAKE[i][c]} need the same digits either side of the full stop`);
}));
const img = jpeg.decode(fs.readFileSync(src), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
const W = img.width, H = img.height, px = img.data, orig = Uint8Array.from(px);
const r = Z.read(img, { debug: true });
const { A, Lay } = r.debug, h = A.h, s = A.f;
const hpx = h / s;

// every digit cell the reader found on a row of amounts, with what it really is and where it is in the photo
const cells = [], keep = [];
for (const row of Lay.main) {
  if (row.idx === undefined || row.idx < 0 || row.idx > 12) continue;
  row.cols.forEach((t, ci) => {
    if (!t) return;
    const want = TRUTH[row.idx][ci], digits = want.replace('.', ''), fake = FAKE[row.idx][ci].replace('.', '');
    if (t.text !== want) return; // not read exactly as printed: it gets blurred instead
    let i = 0;
    for (let k = t.first; k <= t.last; k++) {
      if (k === t.dotAt || !t.used[k]) continue;
      const x = t.cellX(k), a = A.toImage(x - t.p / 2, t.top(x) - 0.12 * h), b = A.toImage(x + t.p / 2, t.bot(x) + 0.12 * h);
      cells.push({ real: digits[i], fake: fake[i], x0: Math.min(a[0], b[0]), y0: Math.min(a[1], b[1]), x1: Math.max(a[0], b[0]), y1: Math.max(a[1], b[1]) });
      i++;
    }
    const a = A.toImage(t.x0, t.y0), b = A.toImage(t.x1, t.y1);
    keep.push({ x0: Math.min(a[0], b[0]) - 2, y0: Math.min(a[1], b[1]) - 2, x1: Math.max(a[0], b[0]) + 2, y1: Math.max(a[1], b[1]) + 2 });
  });
}
if (!cells.length) throw new Error('no amounts read in ' + src);

const lum = (i) => 0.299 * orig[i] + 0.587 * orig[i + 1] + 0.114 * orig[i + 2];
function sampleOrig(x, y, c) {
  x = Math.max(0, Math.min(W - 1.001, x)); y = Math.max(0, Math.min(H - 1.001, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0, at = (xx, yy) => orig[(yy * W + xx) * 4 + c];
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}
function paper(b) { // the light half of a box's pixels: the paper there
  const v = [];
  for (let y = Math.round(b.y0); y <= Math.round(b.y1); y++) for (let x = Math.round(b.x0); x <= Math.round(b.x1); x++) if (x >= 0 && y >= 0 && x < W && y < H) v.push(lum((y * W + x) * 4));
  v.sort((p, q) => q - p);
  return v.slice(0, Math.max(1, v.length >> 1)).reduce((p, q) => p + q, 0) / Math.max(1, v.length >> 1);
}
// each cell gets the digit it needs, copied from the nearest cell that really is that digit
let missing = 0;
for (const c of cells) {
  if (c.fake === c.real) continue;
  let best = null, bd = Infinity;
  for (const d of cells) if (d.real === c.fake) { const dist = Math.hypot((d.x0 + d.x1) / 2 - (c.x0 + c.x1) / 2, (d.y0 + d.y1) / 2 - (c.y0 + c.y1) / 2); if (dist < bd) { bd = dist; best = d; } }
  if (!best) { missing++; c.blur = true; continue; }
  const k = paper(c) / paper(best);
  for (let y = Math.round(c.y0); y <= Math.round(c.y1); y++) for (let x = Math.round(c.x0); x <= Math.round(c.x1); x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const u = (x - c.x0) / (c.x1 - c.x0), v = (y - c.y0) / (c.y1 - c.y0);
    const sx = best.x0 + u * (best.x1 - best.x0), sy = best.y0 + v * (best.y1 - best.y0), i = (y * W + x) * 4;
    for (let ch = 0; ch < 3; ch++) px[i + ch] = Math.max(0, Math.min(255, Math.round(sampleOrig(sx, sy, ch) * k)));
  }
}

// blur: the heading, and anything on a row of amounts that wasn't changed above
function blurBox(b, rad) {
  const x0 = Math.max(0, Math.floor(b.x0)), y0 = Math.max(0, Math.floor(b.y0)), x1 = Math.min(W - 1, Math.ceil(b.x1)), y1 = Math.min(H - 1, Math.ceil(b.y1));
  const copy = Uint8Array.from(px);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const sum = [0, 0, 0]; let n = 0;
    for (let dy = -rad; dy <= rad; dy += 2) for (let dx = -rad; dx <= rad; dx += 2) {
      const xx = Math.max(0, Math.min(W - 1, x + dx)), yy = Math.max(0, Math.min(H - 1, y + dy)), j = (yy * W + xx) * 4;
      sum[0] += copy[j]; sum[1] += copy[j + 1]; sum[2] += copy[j + 2]; n++;
    }
    const i = (y * W + x) * 4;
    px[i] = sum[0] / n; px[i + 1] = sum[1] / n; px[i + 2] = sum[2] / n;
  }
}
const inKept = (x, y) => keep.some(b => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
const rows = Lay.main.filter(q => q.idx !== undefined && q.idx >= 0 && q.idx <= 12);
const topRow = rows.reduce((m, q) => Math.min(m, ...q.cols.filter(Boolean).map(t => A.toImage(t.x0, t.y0)[1])), H);
// the heading: everything above the column headings over the first row of amounts
const headTo = topRow - (rows[0].idx === 0 ? 3.4 : 1.3 + 2.1 * rows[0].idx) * hpx;
if (headTo > 0) blurBox({ x0: 0, y0: 0, x1: W - 1, y1: headTo }, Math.round(hpx * 0.7));
// every row of amounts, all the way across the receipt, is blurred except the numbers changed above: whatever
// else is there (a number half under a finger, one the reader missed) mustn't show the real amounts
if (A.deg) throw new Error('photo is tilted: use a straighter one');
const snap = Uint8Array.from(px);
let bands = 0;
for (const q of rows) {
  const ts = q.cols.filter(Boolean), mx = ts.reduce((p, t) => p + t.cx, 0) / ts.length, my = ts.reduce((p, t) => p + t.cy, 0) / ts.length;
  const sl = ts.length >= 2 ? (ts[ts.length - 1].cy - ts[0].cy) / Math.max(1, ts[ts.length - 1].cx - ts[0].cx) : r.debug.R.slope(mx, my);
  const p = r.pitch, xR = Lay.tot(q.v) + 1.5 * p, xL = xR - 38 * p;
  for (let x = Math.floor(xL); x <= xR; x += 3) {
    const y = my + sl * (x - mx);
    blurBox({ x0: x / s, y0: (y - 0.8 * h) / s, x1: (x + 3) / s, y1: (y + 0.8 * h) / s }, Math.round(hpx * 0.45));
  }
  bands++;
}
for (const b of keep) for (let y = Math.max(0, Math.floor(b.y0)); y <= Math.min(H - 1, Math.ceil(b.y1)); y++) for (let x = Math.max(0, Math.floor(b.x0)); x <= Math.min(W - 1, Math.ceil(b.x1)); x++) {
  const i = (y * W + x) * 4; px[i] = snap[i]; px[i + 1] = snap[i + 1]; px[i + 2] = snap[i + 2];
}
const smudged = bands;
for (const c of cells) if (c.blur) blurBox(c, Math.round(hpx * 0.45));
fs.writeFileSync(out, jpeg.encode({ data: px, width: W, height: H }, 88).data);
console.log(`${out}: ${cells.length} digits, ${cells.filter(c => c.fake !== c.real && !c.blur).length} changed, ${missing} with no digit to copy (blurred), ${smudged} rows blurred around them`);
