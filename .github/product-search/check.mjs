// Product Search: collects each product's name as screwfix.com shows it, and its photo, a few hundred a night.
// The names let the search match either name (the stock-system names are cut off at 50 characters and
// abbreviated); the photos are kept in the repo so every phone gets them from the Toolbox itself, whether or not
// Screwfix's image server is up.
//
// Run by .github/workflows/product-search-names.yml. Reads tools/product-search/data/products.json and adds to
// tools/product-search/data/web-names.json (one product per line) and tools/product-search/photos/<CODE>.jpg:
//   {"name": "...", "at": "2026-10-21", "p": 1}       name found; p: 1 = its photo is saved
//   {"missing": true, "at": "..."}                     Screwfix has no page for that code
//   {"tries": 2, "at": "...", "why": "..."}            name couldn't be read yet (tried again after a week, 3 goes)
//   {"pn": 1, "pat": "..."}                            no photo yet (404 or refused), tried again after a week, 3 goes
//
// Gentle on purpose: one product every GAP_MS (12 s) or so. The name comes through jina (r.jina.ai, the same reader the
// price checks use; a text read only, never the whole page), the photo straight from media.screwfix.com a few seconds
// later (a 120 x 120 picture, about 4 KB). If Screwfix or jina starts turning us away (5 in a row turned away or
// unanswered, pages or photos), it stops, says why at the top of the file and on the run's page, and the run fails so
// GitHub emails detailedfoil. After a stop, the next night only tries 10 products; if those work it carries on.
//
//   LIMIT   how many products to try this run (default 300)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readJSON, londonDate, sleep, log, annotate, MAJOR } from '../lib/price-check.mjs';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const ROOT = process.cwd();
const LIST = 'tools/product-search/data/products.json';
const OUT = 'tools/product-search/data/web-names.json';
const PHOTOS = 'tools/product-search/photos';
const MEDIA = 'https://media.screwfix.com/is/image/ae235/';
const JINA = process.env.JINA_URL || 'https://r.jina.ai/';
const GAP = Number(process.env.GAP_MS || 12000);
// PHOTOS=off (set in the workflow) leaves the photos out. Screwfix's image server turned GitHub away on 20 Oct 2026
// (answered the first 5 with something that wasn't a picture), so photos are off there; the code stays for another go.
const PHOTOS_ON = process.env.PHOTOS !== 'off';
const STOP_AFTER = 5;           // failures in a row that count as being turned away
const PROBE = 10;               // products to try after a stop

const dom = new JSDOM('<!doctype html><title>parser</title>', { url: 'https://detailedfoil.github.io/Toolbox/', runScripts: 'outside-only' });
dom.window.eval(fs.readFileSync(path.join(ROOT, 'tools/price-tickets/lookup.js'), 'utf8'));
const SL = dom.window.ScrewfixLookup;

const today = londonDate();
const list = readJSON(LIST);
const state = readJSON(OUT, { products: {} });
const products = state.products || {};
const daysSince = (iso) => (Date.parse(today) - Date.parse(iso || '2000-01-01')) / 864e5;
fs.mkdirSync(path.join(ROOT, PHOTOS), { recursive: true });
const photoFile = (code) => path.join(ROOT, PHOTOS, code + '.jpg');

/* what each product still needs */
const needsName = (code) => {
  const p = products[code];
  if (!p) return true;
  if (p.name || p.missing) return false;
  return (p.tries || 0) < 3 && (!p.tries || daysSince(p.at) >= 7);
};
const needsPhoto = (code) => {
  if (!PHOTOS_ON) return false;
  const p = products[code] || {};
  if (p.p && fs.existsSync(photoFile(code))) return false;
  return (p.pn || 0) < 3 && (!p.pn || daysSince(p.pat) >= 7);
};

/* which products to try, in order: names cut short at 50 characters first, they gain most */
function queue() {
  const todo = list.items.filter(([sku]) => needsName(sku) || needsPhoto(sku));
  const short = (name) => (name.length >= 48 ? 0 : 1);
  return todo.sort((a, b) => short(a[1]) - short(b[1]) || (a[0] < b[0] ? -1 : 1)).map((x) => x[0]);
}

/* one product's name -> {kind: 'found', name} | {kind: 'missing'} | {kind: 'limited', wait} | {kind: 'fail', why, blocked?} */
async function read(code) {
  let res, text;
  try {
    res = await fetch(JINA + SL.productUrl(code), { signal: AbortSignal.timeout(60000) });
    text = await res.text();
  } catch (e) {
    return { kind: 'fail', why: 'jina: no answer (' + String((e.cause && e.cause.code) || e.message).slice(0, 80) + ')', blocked: true };
  }
  if (res.status === 429) {
    const m = /"retryAfter"\s*:\s*(\d+)/.exec(text.slice(0, 600));
    return { kind: 'limited', wait: Math.min(Math.max(m ? Number(m[1]) : 0, 10), 90) * 1000 };
  }
  let r;
  try { r = JSON.parse(JSON.stringify(SL.interpret({ status: res.status, text }, code))); } catch (e) {
    return { kind: 'fail', why: 'page could not be read' };
  }
  if (r.status === 'notfound') return { kind: 'missing' };
  if (r.status === 'blocked') return { kind: 'fail', why: 'turned away (' + (r.why || 'blocked') + ', HTTP ' + res.status + ')', blocked: true };
  if ((r.status === 'found' || r.status === 'partial') && r.name && !r.unsure) return { kind: 'found', name: r.name };
  return { kind: 'fail', why: 'page: ' + r.status + (r.unsure ? ", doesn't mention the code" : r.name ? '' : ', no name') };
}

const isPicture = (b) => b.length > 300 && ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) ||
  (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45));
const HEADERS = { 'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${MAJOR}.0.0.0 Safari/537.36`,
                  'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', 'Accept-Language': 'en-GB,en;q=0.9' };

/* one product's photo, straight from Screwfix's image server -> {kind: 'found', bytes} | {kind: 'none'} | {kind: 'fail', why, blocked} */
async function photo(code) {
  let res, bytes;
  try {
    res = await fetch(MEDIA + code + '_P?wid=120&hei=120', { headers: HEADERS, signal: AbortSignal.timeout(30000) });
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return { kind: 'fail', why: 'image server: no answer (' + String((e.cause && e.cause.code) || e.message).slice(0, 80) + ')', blocked: true };
  }
  if (res.status === 404 || res.status === 410) return { kind: 'none' };
  if (res.status !== 200) return { kind: 'fail', why: `image server: HTTP ${res.status}`, blocked: true };
  if (!isPicture(bytes)) return { kind: 'fail', why: "image server: answered with something that isn't a picture", blocked: true };
  return { kind: 'found', bytes };
}

function save(head) {
  const keys = Object.keys(products).sort();
  const lines = keys.map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(products[k])}`);
  const top = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  fs.writeFileSync(path.join(ROOT, OUT), `{\n${top.join(',\n')},\n  "products": {\n${lines.join(',\n')}\n  }\n}\n`);
}

async function main() {
  const probing = !!(state.lastRun && state.lastRun.stopped);
  const limit = probing ? Math.min(PROBE, Number(process.env.LIMIT || 300)) : Number(process.env.LIMIT || 300);
  const todo = queue().slice(0, limit);
  log(`${todo.length} to try${probing ? ' (a small try after last time\'s stop)' : ''}; ${GAP / 1000} s apart`);
  const run = { date: today, tried: 0, found: 0, missing: 0, failed: 0, photos: 0, nophoto: 0, stopped: null };
  let inARow = 0, lastWhy = '', next = Date.now();
  const turnedAway = (why) => { lastWhy = why; inARow++; return inARow >= STOP_AFTER; };

  for (const code of todo) {
    await sleep(Math.max(0, next - Date.now()));
    next = Date.now() + GAP + Math.round(Math.random() * GAP * 0.3);
    run.tried++;
    let stop = false, refused = false;

    if (needsName(code)) {
      let got = await read(code);
      if (got.kind === 'limited') { log(`  jina said slow down: waiting ${got.wait / 1000} s`); await sleep(got.wait); got = await read(code); }
      if (got.kind === 'limited') got = { kind: 'fail', why: 'jina kept saying slow down (HTTP 429)', blocked: true };
      const before = products[code] || {};
      if (got.kind === 'found') {
        products[code] = { ...before, name: got.name, at: today };
        delete products[code].tries; delete products[code].why;
        run.found++; inARow = 0;
        log(`  ${code} ${got.name}`);
      } else if (got.kind === 'missing') {
        products[code] = { ...before, missing: true, at: today };
        run.missing++; inARow = 0;
        log(`  ${code} no page on screwfix.com`);
      } else {
        products[code] = { ...before, tries: (before.tries || 0) + 1, at: today, why: got.why };
        run.failed++;
        log(`  ${code} FAILED: ${got.why}`);
        if (got.blocked) { refused = true; stop = turnedAway(got.why); } else inARow = 0;
      }
      if (!stop && !refused && needsPhoto(code)) await sleep(3000 + Math.round(Math.random() * 2000));
    }

    if (!stop && !refused && needsPhoto(code) && !(products[code] || {}).missing) {
      const got = await photo(code);
      const before = products[code] || {};
      if (got.kind === 'found') {
        fs.writeFileSync(photoFile(code), got.bytes);
        products[code] = { ...before, p: 1 };
        delete products[code].pn; delete products[code].pat;
        run.photos++; inARow = 0;
        log(`  ${code} photo saved (${got.bytes.length} bytes)`);
      } else if (got.kind === 'none') {
        products[code] = { ...before, pn: (before.pn || 0) + 1, pat: today };
        run.nophoto++; inARow = 0;
        log(`  ${code} no photo on Screwfix's image server`);
      } else {
        products[code] = { ...before, pn: (before.pn || 0) + 1, pat: today };
        log(`  ${code} PHOTO FAILED: ${got.why}`);
        stop = turnedAway(got.why);
      }
    }
    if (stop) { run.stopped = `${STOP_AFTER} in a row couldn't be read (last: ${lastWhy})`; break; }
  }

  const named = Object.values(products).filter((p) => p.name).length;
  const photos = Object.values(products).filter((p) => p.p).length;
  save({ updated: new Date().toISOString(), lastRun: run, named, photos, of: list.items.length });
  const summary = `Product names and photos: tried ${run.tried}, names found ${run.found}, no page ${run.missing}, names failed ${run.failed}, photos saved ${run.photos}, no photo ${run.nophoto}. ` +
    `${named} names and ${photos} photos of ${list.items.length} so far.` + (run.stopped ? ` STOPPED: ${run.stopped}.` : '');
  log(summary);
  if (process.env.RUNNER_TEMP) {
    fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'names-commit.txt'),
      `Product names and photos: ${run.found} names, ${run.photos} photos${run.stopped ? ', stopped early' : ''} (${named} names, ${photos} photos of ${list.items.length}) [skip ci]\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  if (run.stopped) {
    annotate('error', 'Product names and photos stopped', run.stopped + '. The next run only tries ' + PROBE + ' products.');
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
