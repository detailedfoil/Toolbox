// Real coins from the two test photos (tests/fixtures/coins-10p.jpg and coins-20p.jpg) to build the mixed test
// photos from: centre and traced size, and for the 20p coins whether they stand clear of their neighbours (their
// seven-sided outline is cut from the photo). Run from .github:
//   node coin-counter-2/sprites.mjs /tmp/sprites.json
//   python3 coin-counter-2/make-mixes.py tests/fixtures /tmp/sprites.json /tmp/mixes   (needs numpy and Pillow)
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const jpeg = require('jpeg-js');
const MC = require('../../tools/coin-counter-2/mixed.js');
const out = {};
for (const f of ['coins-10p.jpg', 'coins-20p.jpg']) {
  const img = jpeg.decode(fs.readFileSync('tests/fixtures/' + f), { useTArray: true, formatAsRGBA: true });
  const r = MC.read(img);
  out[f] = r.coins.filter(c => c.m.q > 0.6).map(c => ({ x: c.x, y: c.y, r: c.r, clear: r.coins.every(o => o === c || Math.hypot(o.x - c.x, o.y - c.y) > (o.r + c.r) * 1.08) }));
  console.log(f, out[f].length, 'clear', out[f].filter(c => c.clear).length);
}
fs.writeFileSync(process.argv[2], JSON.stringify(out));
