// Photo Coin Counter 2: the mixed-coin reader (tools/coin-counter-2/mixed.js) on the two real photos (50 10p and
// 48 20p, also used by till-count.test.mjs) and on two mixed photos made from them by
// .github/coin-counter-2/make-mixes.py (real 10p and 20p coins; 5p and 50p resized, 1p and 2p recoloured copper,
// £1 and £2 given a gold ring, the £1 cut twelve-sided). The .json beside each mixed photo says what's where.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { REPO } from './load.mjs';

const require = createRequire(import.meta.url);
const jpeg = require('jpeg-js');
const HERE = path.dirname(fileURLToPath(import.meta.url));
// loaded as a module (not in a vm sandbox like the other page scripts: there it runs ten times slower)
const MC = require(path.join(REPO, 'tools/coin-counter-2/mixed.js'));
const photo = (f) => jpeg.decode(fs.readFileSync(path.join(HERE, 'fixtures', f)), { useTArray: true, formatAsRGBA: true });
const pence = Object.fromEntries(MC.COINS.map((c) => [c.id, c.p]));
const tally = (coins) => coins.reduce((t, c) => ((t[c.coin] = (t[c.coin] || 0) + 1), t), {});

test('coin counter 2: every UK coin, with the seven-sided and twelve-sided outlines worked out', () => {
  assert.deepEqual([...MC.COINS.map((c) => c.id)].sort(), ['c1', 'c10', 'c100', 'c2', 'c20', 'c200', 'c5', 'c50']);
  assert.ok(Math.abs(MC._shapes.hept.mean - 0.4956) < 0.001, 'a 20p outline averages just under half its width');
  assert.ok(MC._shapes.hept.amp > 0.015 && MC._shapes.dode.amp > 0.01);
});

test('coin counter 2: a photo of one kind of coin finds them all and asks which they are', () => {
  for (const [f, n, mine, other] of [['coins-10p.jpg', 50, 'c10', 'c5'], ['coins-20p.jpg', 48, 'c20', 'c50']]) {
    const r = MC.read(photo(f));
    assert.equal(r.coins.length, n, f + ': found ' + r.coins.length);
    assert.ok(r.ask, f + ': should ask, as a 10p and a 5p (or a 20p and a 50p) look alike with nothing to compare');
    assert.deepEqual([...r.ask.options].sort(), [mine, other].sort(), f + ': asks ' + r.ask.options);
    // answering pins the size: then (nearly) every coin follows
    r.coins[r.ask.coin].set = mine;
    const s = MC.solve(r.coins);
    assert.equal(s.ask, null);
    const t = tally(r.coins);
    assert.ok((t[mine] || 0) >= n - 2, f + ': ' + JSON.stringify(t));
  }
});

test('coin counter 2: real 20p coins read as seven-sided and real 10p coins as round', () => {
  const ten = MC.read(photo('coins-10p.jpg')).coins, twenty = MC.read(photo('coins-20p.jpg')).coins;
  // of the coins whose outline could be traced all the way round (in a tight pile some can't)
  const share = (list, f) => { const t = list.filter((c) => c.m.q != null); return t.filter(f).length / t.length; };
  assert.ok(share(ten, (c) => c.f.p7 < 0.5) >= 0.75, 'most 10p round: ' + share(ten, (c) => c.f.p7 < 0.5));
  assert.ok(share(twenty, (c) => c.f.p7 > 0.5) >= 0.8, 'most 20p seven-sided: ' + share(twenty, (c) => c.f.p7 > 0.5));
  // all silver, not copper or two-tone
  assert.ok([...ten, ...twenty].every((c) => c.f.pm.silver > 0.5));
});

test('coin counter 2: mixed photos (every coin, a warm light, a tilt): finds every coin and gets nearly all right', () => {
  for (const f of ['coins-mixed-tray', 'coins-mixed-warm']) {
    const truth = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', f + '.json'), 'utf8')).coins;
    const r = MC.read(photo(f + '.jpg'));
    assert.equal(r.coins.length, truth.length, f + ': found ' + r.coins.length + ' of ' + truth.length);
    assert.equal(r.ask, null, f + ': a mix needs no question');
    let right = 0;
    for (const t of truth) {
      const c = r.coins.find((o) => Math.hypot(o.x - t.x, o.y - t.y) < 25);
      assert.ok(c, f + ': missed the ' + t.coin + ' at ' + t.x + ',' + t.y);
      if (c.coin === t.coin) right++;
    }
    assert.ok(right >= truth.length - 1, f + ': ' + right + ' of ' + truth.length + ' right');
    const want = truth.reduce((s, t) => s + pence[t.coin], 0), got = r.coins.reduce((s, c) => s + pence[c.coin], 0);
    assert.ok(Math.abs(got - want) <= 50, f + ': £' + got / 100 + ' for £' + want / 100);
  }
});

test('coin counter 2: a coin you set stays set, and a bare desk has no coins', () => {
  const r = MC.read(photo('coins-mixed-warm.jpg'));
  const c = r.coins[0], was = c.coin, other = was === 'c200' ? 'c1' : 'c200';
  c.set = other; c.coin = other;
  MC.solve(r.coins);
  assert.equal(c.coin, other);
  assert.equal(MC.unsure(c), false);
  const ten = photo('coins-10p.jpg'), w = 300, h = 240, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) data.set(ten.data.subarray(((40 + y) * ten.width) * 4, ((40 + y) * ten.width + w) * 4), y * w * 4);
  const desk = MC.read({ data, width: w, height: h });
  assert.equal(desk.coins.length, 0);
});
