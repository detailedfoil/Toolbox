// Product Search: collects each product's name as screwfix.com shows it, whether it's age restricted, its description
// and its photo.
// The names let the search match either name (the stock-system names are cut off at 50 characters and
// abbreviated); the photos are kept in the repo so every phone gets them from the Toolbox itself, whether or not
// Screwfix's image server is up.
//
// Run by .github/workflows/product-search-names.yml. Reads tools/product-search/data/products.json and adds to
// tools/product-search/data/web-names.json (one product per line) and tools/product-search/photos/<CODE>.jpg:
//   {"name": "...", "a": 1, "an": "the notice", "d": 1, "at": "2026-10-21"}  name found; a: 1 = age restricted (the Challenge 25 notice under the
//                                                    product heading, found by describe.mjs ageNotice; an = its words), 0 = not; d: 1 = description saved as
//                                                    tools/product-search/descriptions/<CODE>.json ({t: text, b: [bullets]},
//                                                    read from the same page by describe.mjs), 0 = the page had none
//   {"missing": true, "at": "..."}                     Screwfix has no page for that code
//   {"tries": 2, "at": "...", "why": "..."}            name couldn't be read yet (tried again after a week, 3 goes)
//   {"pn": 1, "pat": "..."}                            no photo yet (404 or refused), tried again after a week, 3 goes
//
// Runs around the clock until everything is done (a run every 6 hours, each up to 5.5 hours), then the runs find
// nothing to do and finish in a minute, picking up retries as they fall due. Polite on purpose (Screwfix has blocked a
// nightly check before, and detailedfoil asked for it to look as ordinary as possible):
//   - one product about every 20 s (GAP_MS), never evenly: each gap is anywhere from 14 to 26 s
//   - every 40 to 70 products a longer break of 2 to 6 minutes
//   - the name through jina (r.jina.ai, the same reader the price checks use; a text read only), the photo a few
//     seconds later through the free image relay wsrv.nl (Screwfix's image server turned GitHub away directly)
//   - a product that fails is skipped (tried again after a week, 3 goes at most)
//   - 4 different products failing in a row: pause for an hour (+ up to 10 min), then carry on. If the first 2 after
//     a pause fail too, pause again. After 3 pauses in a row with nothing working it gives up: the run fails (GitHub
//     emails detailedfoil) and the next run first tries a few; if the first 4 of those fail it gives up again at once.
//   - saves its progress every 20 products, so nothing is lost if a run is cut off
// No tricks to dodge Screwfix's blocking: if it's refusing, this backs off and stops.
//
//   PHOTO_SWEEP  'on': fetch every missing photo first, quickly (about one a second), before the slow name reading
//   LIMIT        how many products to try this run (none: no limit)
//   RUN_MINUTES  stop starting new products after this long (default 330, inside GitHub's 6 hour limit)
//   PAUSE_MS     the pause after failures (default an hour; the tests shorten it)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readJSON, londonDate, sleep, log, annotate, MAJOR } from '../lib/price-check.mjs';
import { describe, ageNotice } from './describe.mjs';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
// the page's own search, so the description words are cut up exactly the way the page will look them up
const PS = require(new URL('../../tools/product-search/search.js', import.meta.url).pathname);

const ROOT = process.cwd();
const LIST = 'tools/product-search/data/products.json';
const OUT = 'tools/product-search/data/web-names.json';
const PHOTOS = 'tools/product-search/photos';
const DESCRIPTIONS = 'tools/product-search/descriptions';
const DESC_WORDS = 'tools/product-search/data/desc-words.json';
const MEDIA = 'https://media.screwfix.com/is/image/ae235/';
const JINA = process.env.JINA_URL || 'https://r.jina.ai/';
const GAP = Number(process.env.GAP_MS || 20000);
const PAUSE = Number(process.env.PAUSE_MS || 3600000);
const RUN_MS = Number(process.env.RUN_MINUTES || 330) * 60000;
const STARTED = Date.now();
// PHOTOS=off (set in the workflow) leaves the photos out. Screwfix's image server turned GitHub away on 20 Oct 2026
// (answered the first 5 with something that wasn't a picture), so photos are off there; the code stays for another go.
const PHOTOS_ON = process.env.PHOTOS !== 'off';
// the size photos are kept at: 120 x 120 pixels, JPEG quality 85, about 2 KB each (about 21 MB for the whole list).
// 80 and 60 would make them about 1.3 KB (13 MB) but a little soft on a phone; detailedfoil to decide (21 Oct 2026).
const PHOTO_PX = 120;
const PHOTO_QUALITY = 85;
const SWEEP_GAP = Number(process.env.PHOTO_GAP_MS || Math.round(GAP / 20));   // between photos in the sweep: 1 s with the usual 20 s gap
const FAILS_TO_PAUSE = 4;       // different products failing in a row before an hour's pause
const FAILS_AFTER_PAUSE = 2;    // failing straight after a pause: pause again
const MAX_PAUSES = 3;           // pauses in a row with nothing working: give up

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
fs.mkdirSync(path.join(ROOT, DESCRIPTIONS), { recursive: true });
const descFile = (code) => path.join(ROOT, DESCRIPTIONS, code + '.json');

// a "name" that is really jina's own heading lines: an empty page title once gave "URL Source: https://..." (22 Oct 2026)
const JUNK_NAME = /^(?:url source|title|markdown content|warning|published time)\s*:/i;

/* what each product still needs */
const needsName = (code) => {
  const p = products[code];
  if (!p) return true;
  if (p.name && JUNK_NAME.test(p.name)) return true;       // saved before that was caught: read again
  if (p.name && p.a === 1 && !p.an) return true;               // flagged by the old whole-page age check, which caught promo boxes (23 Oct 2026): read again
  if (p.name) return p.a === undefined || p.d === undefined;   // named before the age check / descriptions were added: read once more
  if (p.missing) return false;
  return (p.tries || 0) < 3 && (!p.tries || daysSince(p.at) >= 7);
};
const needsPhoto = (code) => {
  if (!PHOTOS_ON) return false;
  const p = products[code] || {};
  if (p.p && fs.existsSync(photoFile(code))) return false;
  return (p.pn || 0) < 3 && (!p.pn || daysSince(p.pat) >= 7);
};

/* The words the page searches descriptions by (data/desc-words.json, one product per line): each description's
   words as search.js cuts them up, without the ones already in that product's names (the names are searched first
   anyway), numbers on their own, single letters and filler words. Once 1,000 products have descriptions, words in more
   than 1 in 10 of them are left out too ("suitable", "ideal"...): they'd match half the list. Remade at the start
   of each run and whenever a description is saved. */
const FILLER = new Set(('use used using ideal suitable suit provide provides providing offer offers offering feature features featuring ' +
  'include includes including design designed easy easily also more most other every even any all can will may this that these ' +
  'which from into its it is are be been by an as at or our your you up out over under per range ready quality high great ' +
  'excellent perfect ensure ensures allow allows giving give help helps make makes making well new very').split(' '));
let descDirty = true;
function writeDescWords() {
  if (!descDirty) return;
  descDirty = false;
  const byCode = {}, df = new Map();
  for (const [code, name] of list.items) {
    const p = products[code];
    if (!p || p.d !== 1 || !fs.existsSync(descFile(code))) continue;
    let d;
    try { d = JSON.parse(fs.readFileSync(descFile(code), 'utf8')); } catch (e) { continue; }
    const named = new Set(PS.words(name).concat(PS.words(p.name || '')).filter(Boolean));
    const ws = [...new Set(PS.words((d.t || '') + ' . ' + (d.b || []).join(' . ')).filter((w) => w && w.length > 1 && !/^\d+$/.test(w) && !FILLER.has(w) && !named.has(w)))];
    byCode[code] = ws;
    for (const w of ws) df.set(w, (df.get(w) || 0) + 1);
  }
  const n = Object.keys(byCode).length, cap = n >= 1000 ? n / 10 : Infinity;
  const lines = Object.entries(byCode).map(([code, ws]) => `    ${JSON.stringify(code)}: ${JSON.stringify(ws.filter((w) => df.get(w) <= cap).join(' '))}`);
  const file = path.join(ROOT, DESC_WORDS);
  fs.writeFileSync(file + '.tmp', `{\n  "updated": ${JSON.stringify(new Date().toISOString())},\n  "products": {\n${lines.join(',\n')}\n  }\n}\n`);
  fs.renameSync(file + '.tmp', file);
}

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
  if (r.name && JUNK_NAME.test(r.name)) return { kind: 'fail', why: 'page: no product name (empty page title)' };
  if ((r.status === 'found' || r.status === 'partial') && r.name && !r.unsure) {
    // not r.age: that looks at the whole page, promotional red boxes included. Only Screwfix's own notice under the heading counts.
    return { kind: 'found', name: r.name, age: ageNotice(text, code), desc: describe(text, code) };
  }
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
    // through the free image relay wsrv.nl (it asks Screwfix from its own servers; Screwfix's image server turned
    // GitHub's servers away when asked directly, 20 Oct 2026). PHOTO_VIA=direct asks Screwfix itself.
    const own = MEDIA + code + '_P?wid=' + PHOTO_PX + '&hei=' + PHOTO_PX;
    const url = process.env.PHOTO_VIA === 'direct' ? own : 'https://wsrv.nl/?url=' + encodeURIComponent(own) + '&w=' + PHOTO_PX + '&h=' + PHOTO_PX + '&fit=inside&output=jpg&q=' + PHOTO_QUALITY;
    res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
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
  // written to a side file and renamed, so the workflow can save a copy part-way through a run without catching it half written
  const file = path.join(ROOT, OUT);
  fs.writeFileSync(file + '.tmp', `{\n${top.join(',\n')},\n  "products": {\n${lines.join(',\n')}\n  }\n}\n`);
  fs.renameSync(file + '.tmp', file);
}

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

async function main() {
  const probing = !!(state.lastRun && state.lastRun.stopped);
  const limit = Number(process.env.LIMIT) > 0 ? Number(process.env.LIMIT) : Infinity;
  let todo = queue().slice(0, limit);
  log(`${todo.length} to try${probing ? " (carefully: the last run gave up)" : ''}; about ${GAP / 1000} s apart`);
  const run = { date: today, started: new Date().toISOString(), tried: 0, found: 0, missing: 0, failed: 0, photos: 0, nophoto: 0, pauses: 0, stopped: null, timeUp: false };
  let fails = 0, pausesInARow = 0, worked = false, lastWhy = '', next = Date.now();
  let breakAfter = Math.round(rand(40, 70)), sinceBreak = 0;
  const writeOut = () => {
    const named = Object.values(products).filter((p) => p.name).length;
    const photos = Object.values(products).filter((p) => p.p).length;
    const described = Object.values(products).filter((p) => p.d).length;
    save({ updated: new Date().toISOString(), lastRun: run, named, photos, described, of: list.items.length });
    writeDescWords();
    return { named, photos, described };
  };
  const timeLeft = () => RUN_MS - (Date.now() - STARTED);

  /* Photo sweep (PHOTO_SWEEP=on, set in the workflow). A photo's address only needs the product code, not the page, so
     the photos are fetched first in one quick pass: about one a second (SWEEP_GAP, never evenly) instead of one every
     20 s. Photos are a small request to a different server from the page reads. 3 refusals in a row stop the sweep for
     this run (the names carry on, without photos) and a warning is shown. A product with no photo (404) isn't a refusal. */
  let photosOff = false;
  if (PHOTOS_ON && process.env.PHOTO_SWEEP === 'on') {
    const want = list.items.map((r) => r[0]).filter(needsPhoto).slice(0, limit);
    log(`photo sweep: ${want.length} photos to fetch, about ${SWEEP_GAP / 1000} s apart`);
    let bad = 0, done = 0, why = '';
    for (const code of want) {
      if (timeLeft() <= 0) { run.timeUp = true; log('Time for this run is up during the photo sweep; the next run carries on'); break; }
      await sleep(Math.round(SWEEP_GAP * rand(0.7, 1.5)));
      const got = await photo(code);
      const before = products[code] || {};
      if (got.kind === 'found') {
        fs.writeFileSync(photoFile(code), got.bytes);
        products[code] = { ...before, p: 1 };
        delete products[code].pn; delete products[code].pat;
        run.photos++; bad = 0;
      } else if (got.kind === 'none') {
        products[code] = { ...before, pn: (before.pn || 0) + 1, pat: today };
        run.nophoto++; bad = 0;
      } else {
        products[code] = { ...before, pn: (before.pn || 0) + 1, pat: today };
        bad++; why = got.why;
        log(`  ${code} PHOTO FAILED: ${got.why}`);
        if (bad >= 3) {
          photosOff = true; run.photoSweepStopped = why;
          annotate('warning', 'Product photos turned away', `3 photos in a row failed (${why}). The photo sweep stopped for this run; names carry on without photos.`);
          break;
        }
      }
      if (++done % 50 === 0) writeOut();
    }
    writeOut();
    log(`photo sweep finished: ${done} tried`);
    todo = queue().slice(0, limit);     // the photos are done, so what's left is mostly names
  }
  const wantPhoto = (code) => !photosOff && needsPhoto(code);

  for (const code of todo) {
    if (timeLeft() <= 0) { run.timeUp = true; log('Time for this run is up; the next run carries on'); break; }
    if (!needsName(code) && !wantPhoto(code)) continue;    // only wanted a photo, and the sweep has done it (or stopped)
    await sleep(Math.max(0, next - Date.now()));
    if (++sinceBreak > breakAfter) {
      const rest = Math.round(rand(2, 6) * 60000 * (GAP / 20000));
      log(`  a break of ${Math.round(rest / 1000)} s`);
      await sleep(rest);
      sinceBreak = 0; breakAfter = Math.round(rand(40, 70));
    }
    next = Date.now() + Math.round(GAP * rand(0.7, 1.3));
    run.tried++;
    let failed = false, refused = false, ok = false;

    if (needsName(code)) {
      let got = await read(code);
      if (got.kind === 'limited') { log(`  jina said slow down: waiting ${got.wait / 1000} s`); await sleep(got.wait); got = await read(code); }
      if (got.kind === 'limited') got = { kind: 'fail', why: 'jina kept saying slow down (HTTP 429)', blocked: true };
      const before = products[code] || {};
      if (got.kind === 'found') {
        if (got.desc) { fs.writeFileSync(descFile(code), JSON.stringify(got.desc) + '\n'); descDirty = true; }
        products[code] = { ...before, name: got.name, a: got.age ? 1 : 0, d: got.desc ? 1 : 0, at: today };
        if (got.age) products[code].an = got.age; else delete products[code].an;   // the notice's words, so a wrong one can be seen
        delete products[code].tries; delete products[code].why;
        run.found++; ok = true;
        log(`  ${code} ${got.name}${got.age ? ' (age restricted)' : ''}${got.desc ? '' : ' (no description)'}`);
      } else if (got.kind === 'missing') {
        products[code] = { ...before, missing: true, at: today };
        run.missing++; ok = true;
        log(`  ${code} no page on screwfix.com`);
      } else {
        products[code] = { ...before, tries: (before.tries || 0) + 1, at: today, why: got.why };
        run.failed++; failed = true; refused = !!got.blocked; lastWhy = got.why;
        log(`  ${code} FAILED: ${got.why}`);
      }
      if (!refused && wantPhoto(code) && !(products[code] || {}).missing) await sleep(Math.round(rand(3000, 6000) * (GAP / 20000)));
    }

    if (!refused && wantPhoto(code) && !(products[code] || {}).missing) {
      const got = await photo(code);
      const before = products[code] || {};
      if (got.kind === 'found') {
        fs.writeFileSync(photoFile(code), got.bytes);
        products[code] = { ...before, p: 1 };
        delete products[code].pn; delete products[code].pat;
        run.photos++; ok = true;
        log(`  ${code} photo saved (${got.bytes.length} bytes)`);
      } else if (got.kind === 'none') {
        products[code] = { ...before, pn: (before.pn || 0) + 1, pat: today };
        run.nophoto++; ok = true;
        log(`  ${code} no photo on Screwfix's image server`);
      } else {
        products[code] = { ...before, pn: (before.pn || 0) + 1, pat: today };
        failed = true; lastWhy = got.why;
        log(`  ${code} PHOTO FAILED: ${got.why}`);
      }
    }

    if (failed) fails++;
    else if (ok) { fails = 0; pausesInARow = 0; worked = true; }
    if (run.tried % 20 === 0) writeOut();

    if (fails >= (pausesInARow ? FAILS_AFTER_PAUSE : FAILS_TO_PAUSE)) {
      if (probing && !worked) { run.stopped = `the first ${fails} products failed again (last: ${lastWhy})`; break; }
      if (pausesInARow >= MAX_PAUSES) { run.stopped = `${MAX_PAUSES} pauses of an hour and still failing (last: ${lastWhy})`; break; }
      const wait = Math.round(PAUSE * rand(1, 1.17));
      if (timeLeft() < wait) { run.timeUp = true; log(`${fails} failed in a row and this run is nearly out of time: the next run carries on`); break; }
      pausesInARow++; run.pauses++; fails = 0;
      log(`  ${FAILS_TO_PAUSE} or more failed in a row (last: ${lastWhy}): pausing for ${Math.round(wait / 60000)} minutes`);
      writeOut();
      await sleep(wait);
      next = Date.now();
    }
  }

  const { named, photos, described } = writeOut();
  const summary = `Product names and photos: tried ${run.tried}, names found ${run.found}, no page ${run.missing}, names failed ${run.failed}, photos saved ${run.photos}, no photo ${run.nophoto}, pauses ${run.pauses}. ` +
    `${named} names, ${described} descriptions and ${photos} photos of ${list.items.length} so far.` + (run.stopped ? ` GAVE UP: ${run.stopped}.` : '');
  log(summary);
  if (process.env.RUNNER_TEMP) {
    fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'names-commit.txt'),
      `Product names and photos: ${run.found} names, ${run.photos} photos${run.stopped ? ', gave up' : ''} (${named} names, ${photos} photos of ${list.items.length}) [skip ci]\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
  if (run.stopped) {
    annotate('error', 'Product names and photos gave up', run.stopped + '. The next run tries a few first and gives up again if the first 4 fail.');
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
