// Photo Coin Counter's Z report tab: the receipt reader (tools/till-count/zreport.js) on three photos of a real Z report with every
// amount on it changed, the heading blurred (made by .github/z-report/make-fixture.mjs; real Z reports stay off
// GitHub). The made-up receipt's overall end of day total is 712.32 and its Worldline TradeUK total 27.06.
//   a: fingers over the left, pencil circles round both totals     b: blurry close-up of the bottom half
//   c: taken at an angle, so the rows slope and shrink up the photo
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const jpeg = require('jpeg-js');
const HERE = path.dirname(fileURLToPath(import.meta.url));
// loaded straight in rather than in a sandbox (loadModule): reading a photo is about 20 times quicker
const Z = require('../../tools/till-count/zreport.js');
const photo = (f) => jpeg.decode(fs.readFileSync(path.join(HERE, 'fixtures', f)), { useTArray: true, formatAsRGBA: true });
const PHOTOS = ['zreport-a.jpg', 'zreport-b.jpg', 'zreport-c.jpg'];

/* the photo turned by deg degrees (the corners left empty repeat the edge), or a quarter turn exactly */
function turn(img, deg) {
  const W0 = img.width, H0 = img.height, src = img.data;
  if (deg === 90 || deg === 180) {
    const W = deg === 90 ? H0 : W0, H = deg === 90 ? W0 : H0, out = new Uint8Array(W * H * 4);
    for (let y = 0; y < H0; y++) for (let x = 0; x < W0; x++) {
      const d = deg === 90 ? ((x * W) + (W - 1 - y)) * 4 : ((H0 - 1 - y) * W + (W0 - 1 - x)) * 4;
      out.set(src.subarray((y * W0 + x) * 4, (y * W0 + x) * 4 + 4), d);
    }
    return { data: out, width: W, height: H };
  }
  const t = deg * Math.PI / 180, cs = Math.cos(t), sn = Math.sin(t);
  const W = Math.ceil(Math.abs(W0 * cs) + Math.abs(H0 * sn)), H = Math.ceil(Math.abs(W0 * sn) + Math.abs(H0 * cs)), out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - W / 2, dy = y - H / 2;
    const sx = Math.min(W0 - 1.001, Math.max(0, W0 / 2 + cs * dx + sn * dy)), sy = Math.min(H0 - 1.001, Math.max(0, H0 / 2 - sn * dx + cs * dy));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    for (let c = 0; c < 4; c++) {
      const at = (xx, yy) => src[(yy * W0 + xx) * 4 + c];
      out[(y * W + x) * 4 + c] = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    }
  }
  return { data: out, width: W, height: H };
}
/* the photo at k times the size (each new pixel the average of the old ones it covers) */
function shrink(img, k) {
  const W = Math.round(img.width * k), H = Math.round(img.height * k), out = new Uint8Array(W * H * 4), sum = new Float64Array(W * H * 4), n = new Float64Array(W * H);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const i = Math.min(H - 1, Math.floor(y * k)) * W + Math.min(W - 1, Math.floor(x * k));
    for (let c = 0; c < 4; c++) sum[i * 4 + c] += img.data[(y * img.width + x) * 4 + c];
    n[i]++;
  }
  for (let i = 0; i < W * H; i++) for (let c = 0; c < 4; c++) out[i * 4 + c] = sum[i * 4 + c] / n[i];
  return { data: out, width: W, height: H };
}

test('z report: reads the overall end of day total and the TradeUK total, and checks them on the receipt', () => {
  for (const f of PHOTOS) {
    const r = Z.read(photo(f));
    assert.equal(r.overall && r.overall.pence, 71232, f + ': overall end of day total');
    assert.equal(r.trade && r.trade.pence, 2706, f + ': TradeUK total');
    assert.ok(r.overall.sure, f + ': overall total checked (its row adds up, or it matches the current total)');
    assert.equal(r.trade.adds, true, f + ': the TradeUK row adds up (Sale + Cashback - Refund = Total)');
    assert.ok(r.trade.sure, f + ': TradeUK total checked');
    assert.equal(r.same, true, f + ': the current and overall totals read the same');
    assert.equal(r.overall.corners.length, 4, f + ': where it was found, to box it on the photo');
  }
});

test('z report: a photo taken at a slant, from further away or closer still reads', () => {
  const a = photo('zreport-a.jpg'), c = photo('zreport-c.jpg');
  for (const [name, img] of [['a turned 12°', turn(a, 12)], ['c turned -8°', turn(c, -8)], ['a at 0.6 size', shrink(a, 0.6)], ['c at 0.5 size', shrink(c, 0.5)]]) {
    const r = Z.read(img);
    assert.equal(r.overall && r.overall.pence, 71232, name + ': overall');
    assert.equal(r.trade && r.trade.pence, 2706, name + ': TradeUK');
    assert.ok(r.overall.sure && r.trade.sure, name + ': both checked');
  }
});

test('z report: a photo sideways or upside down gives no numbers (the page turns it and reads it again)', () => {
  const b = photo('zreport-b.jpg');
  for (const [name, img] of [['sideways', turn(b, 90)], ['upside down', turn(b, 180)]]) {
    const r = Z.read(img);
    const got = ['overall', 'trade'].filter((k) => r[k] && r[k].pence !== null && r[k].sure);
    assert.deepEqual(got, [], name + ': nothing read as checked');
  }
});

test('z report: a photo with no receipt in it finds nothing', () => {
  const W = 900, H = 1200, data = new Uint8Array(W * H * 4);
  let seed = 7;
  for (let i = 0; i < W * H; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; const v = 150 + (seed % 40); data.set([v, v - 4, v - 10, 255], i * 4); }
  const r = Z.read({ data, width: W, height: H });
  assert.equal(r.overall, null);
  assert.equal(r.trade, null);
  assert.ok(r.warn.length > 0, 'says why');
});

test('z report: the reader knows all ten of the printer\'s digits', () => {
  const src = fs.readFileSync(path.join(HERE, '../../tools/till-count/zreport.js'), 'utf8');
  const font = src.slice(src.indexOf('/* FONT START */'), src.indexOf('/* FONT END */'));
  for (let d = 0; d <= 9; d++) assert.match(font, new RegExp(`'${d}': \\[\\[`), 'digit ' + d);
  assert.match(src, /var GX = 10, GY = 16;/, 'the digit grid the shapes were made at (retrain if it changes)');
  const n = (font.match(/'0': \[\[([^\]]*)\]\]/)[1].split(',')).length;
  assert.equal(n, 160, 'each shape is 10 x 16');
});
