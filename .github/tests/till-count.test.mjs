// Till Count: the sums (money.js) and the coin reader (coins.js) on two real photos taken on 19 Oct 2026 in
// fixtures/ (50 10p coins and 48 20p coins on a desk, with a keyboard, pen and till receipt in shot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadModule } from './load.mjs';

const require = createRequire(import.meta.url);
const jpeg = require('jpeg-js');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const M = loadModule('tools/till-count/money.js');
const CC = loadModule('tools/till-count/coins.js');
const photo = (f) => jpeg.decode(fs.readFileSync(path.join(HERE, 'fixtures', f)), { useTArray: true, formatAsRGBA: true });

/* part of a photo, as a new image */
function crop(img, x, y, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) out.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4);
  return { data: out, width: w, height: h };
}

test('till count: typed amounts and coin counts', () => {
  assert.equal(M.parseMoney('9.60'), 960);
  assert.equal(M.parseMoney('£9.6'), 960);
  assert.equal(M.parseMoney('9'), 900);
  assert.equal(M.parseMoney(' 1,250.00 '), 125000);
  assert.equal(M.parseMoney('960p'), 960);
  assert.equal(M.parseMoney('.5'), 50);
  assert.equal(M.parseMoney(''), null);
  assert.ok(Number.isNaN(M.parseMoney('9.605')));
  assert.ok(Number.isNaN(M.parseMoney('abc')));
  assert.equal(M.parseCount('48'), 48);
  assert.equal(M.parseCount(''), null);
  assert.ok(Number.isNaN(M.parseCount('5.5')));
  assert.ok(Number.isNaN(M.parseCount('-2')));
  assert.equal(M.plain(960), '9.60');
  assert.equal(M.plain(5), '0.05');
  assert.equal(M.money(123456), '£1,234.56');
  assert.equal(M.money(-3500), '−£35.00');
  assert.deepEqual({ ...M.countOf(120, 20) }, { count: 6, whole: true });
  assert.deepEqual({ ...M.countOf(110, 20) }, { count: 5.5, whole: false });
  // 0.1 + 0.2 trouble can't happen: everything is whole pence
  const t = M.totals({ n2000: 12000, c20: 960, c10: 500, c1: 37, c2: null, c50: NaN }, 7500);
  assert.deepEqual({ ...t }, { notes: 12000, coins: 1497, gross: 13497, net: 5997 });
  assert.equal(M.totals({}, 5000).net, -5000);
});

test('till count: counts every coin in the 10p and 20p photos, and nothing else in shot', () => {
  for (const [f, n] of [['coins-10p.jpg', 50], ['coins-20p.jpg', 48]]) {
    const img = photo(f);
    const r = CC.detect(img);
    assert.equal(r.coins.length, n, f + ': found ' + r.coins.length);
    assert.equal(r.maybe.length, 0, f + ': nothing grey dashed');
    assert.ok(r.coins.filter((c) => c.flag).length <= 2, f + ': at most a couple in amber');
    assert.equal(r.warn.filter((w) => w !== 'odd').length, 0, f + ': no warnings (' + r.warn.join(', ') + ')');
    // the same photo turned round counts the same
    const turned = { data: new Uint8Array(img.data.length), width: img.height, height: img.width };
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4, d = (x * img.height + (img.height - 1 - y)) * 4;
      turned.data.set(img.data.subarray(s, s + 4), d);
    }
    assert.equal(CC.detect(turned).coins.length, n, f + ' turned sideways');
  }
});

test('till count: a bare patch of desk has no coins, and a close-up still finds them', () => {
  const ten = photo('coins-10p.jpg'); // 900 x 1200
  const desk = CC.detect(crop(ten, 0, 40, 300, 240));
  assert.equal(desk.coins.length, 0);
  assert.ok(desk.warn.includes('none'));
  // part of the pile, as it is and blown up to twice the size (as if taken closer). Coins cut off at the edges
  // may or may not count, so it should find at least the coins wholly inside and at most those centred inside.
  const all = CC.detect(ten).coins, box = [200, 380, 400, 400];
  const wholly = all.filter((c) => c.x - c.r >= box[0] && c.x + c.r <= box[0] + box[2] && c.y - c.r >= box[1] && c.y + c.r <= box[1] + box[3]).length;
  const centred = all.filter((c) => c.x >= box[0] && c.x <= box[0] + box[2] && c.y >= box[1] && c.y <= box[1] + box[3]).length;
  const part = crop(ten, ...box), big = { data: new Uint8Array(part.data.length * 4), width: part.width * 2, height: part.height * 2 };
  for (let y = 0; y < big.height; y++) for (let x = 0; x < big.width; x++) {
    const s = ((y >> 1) * part.width + (x >> 1)) * 4;
    big.data.set(part.data.subarray(s, s + 4), (y * big.width + x) * 4);
  }
  for (const [name, img] of [['part', part], ['close-up', big]]) {
    const n = CC.detect(img).coins.length;
    assert.ok(n >= wholly && n <= centred, `${name}: ${n} found, expected ${wholly} to ${centred}`);
  }
});
