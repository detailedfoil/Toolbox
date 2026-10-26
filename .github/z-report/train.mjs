// Teaches the Z report reader (tools/till-count/zreport.js, Photo Coin Counter's Z report tab) the card machine printer's digits.
//   node .github/z-report/train.mjs truth.json
// truth.json: [{ "photos": ["a.jpg", "b.jpg"], "rows": [["317.65", "0.00", "48.20", "269.45"], ...] }, ...]
// "rows" are the receipt's 13 rows of numbers from the top (Visa) to the bottom (OVERALL END OF DAY TOTAL),
// each Sale, Cashback, Refund, Total, exactly as printed; every photo listed is a photo of that receipt.
// Photos of real Z reports stay off GitHub (the repo is public): keep them on your own computer.
// It reads every photo with the reader, keeps each digit it found where the receipt says that digit is, makes one
// average shape per digit (each lined up to the others first), and writes them into zreport.js between
// FONT START and FONT END. It also tests itself: each photo read with shapes learnt from the other photos only.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const jpeg = require('jpeg-js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const READER = path.join(REPO, 'tools/till-count/zreport.js');
const Z = require(READER);

const truthFile = process.argv[2];
if (!truthFile) { console.error('usage: node .github/z-report/train.mjs truth.json'); process.exit(1); }
const truth = JSON.parse(fs.readFileSync(truthFile, 'utf8'));
const base = path.dirname(path.resolve(truthFile));

const photos = [];
for (const group of truth) {
  for (const p of group.photos) {
    const file = path.resolve(base, p);
    const img = jpeg.decode(fs.readFileSync(file), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
    const r = Z.read(img, { samples: true });
    const samples = [];
    let skipped = 0;
    for (const row of r.rows) {
      if (row.idx === undefined || row.idx < 0 || row.idx >= group.rows.length) continue;
      row.cols.forEach((c, ci) => {
        if (!c) return;
        const want = group.rows[row.idx][ci], digits = want.replace(/[^0-9]/g, '');
        // only numbers read whole and in the right shape (same digits either side of the full stop)
        if (c.partial || c.digits.length !== digits.length || c.text.split('.')[0].replace(/[^0-9?]/g, '').length !== want.split('.')[0].replace(/[^0-9]/g, '').length) { skipped++; return; }
        c.digits.forEach((d, i) => samples.push({ y: digits[i], vs: d.vs, where: `row ${row.idx} col ${ci}` }));
      });
    }
    photos.push({ name: p, samples, skipped });
    console.log(`${p}: ${samples.length} digits, ${skipped} numbers left out`);
  }
}

const dot = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * b[k]; return s; };
function mean(vs) {
  const v = new Float64Array(vs[0].length);
  vs.forEach(x => x.forEach((a, i) => { v[i] += a; }));
  const m = v.reduce((a, b) => a + b) / v.length, c = Array.from(v, x => x - m), n = Math.hypot(...c);
  return c.map(x => x / n);
}
function learn(samples) {
  const by = {};
  samples.forEach(s => (by[s.y] = by[s.y] || []).push(s));
  const out = {};
  for (const d of Object.keys(by).sort()) {
    let t = mean(by[d].map(s => s.vs[0]));
    // line each one up with the average (the reader looks at each digit a little to each side too)
    for (let it = 0; it < 3; it++) t = mean(by[d].map(s => s.vs.reduce((b, v) => (dot(v, t) > dot(b, t) ? v : b))));
    out[d] = [t];
  }
  return out;
}
function classify(F, vs) {
  let best = -2, second = -2, bd = null;
  for (const d in F) {
    let top = -2;
    for (const t of F[d]) for (const v of vs) { const s = dot(v, t); if (s > top) top = s; }
    if (top > best) { second = best; best = top; bd = d; } else if (top > second) second = top;
  }
  return { d: bd, m: best - second };
}

// each photo read with shapes learnt from the others only
let total = 0, wrong = 0;
const margins = [];
photos.forEach((p, i) => {
  const F = learn(photos.filter((q, j) => j !== i).flatMap(q => q.samples));
  for (const s of p.samples) {
    const c = classify(F, s.vs);
    total++; margins.push(c.m);
    if (c.d !== s.y) { wrong++; console.log(`  misread: ${p.name} ${s.where}: ${s.y} read as ${c.d} (margin ${c.m.toFixed(3)})`); }
  }
});
margins.sort((a, b) => a - b);
console.log(`test: ${total - wrong} of ${total} digits right on photos it hadn't learnt from (smallest margin ${margins[0].toFixed(3)})`);

const all = photos.flatMap(p => p.samples), F = learn(all), counts = {};
all.forEach(s => { counts[s.y] = (counts[s.y] || 0) + 1; });
console.log('digits learnt from:', JSON.stringify(counts));
if (Object.keys(F).length < 10) console.log('warning: not every digit 0 to 9 was in the photos, so some can never be read');
const text = 'var FONT = {\n' + Object.keys(F).map(d => `    '${d}': [[${F[d][0].map(x => x.toFixed(3).replace(/^(-?)0\./, '$1.')).join(',')}]]`).join(',\n') + '\n  };';
const src = fs.readFileSync(READER, 'utf8');
const a = src.indexOf('/* FONT START */'), b = src.indexOf('/* FONT END */');
if (a < 0 || b < 0) throw new Error('FONT markers not found in zreport.js');
fs.writeFileSync(READER, src.slice(0, a) + '/* FONT START */\n  // made by .github/z-report/train.mjs from photos of real Z reports\n  ' + text + '\n  ' + src.slice(b));
console.log('written to tools/till-count/zreport.js');
