// Daily price check for the Toolbox "A25 Behind counter trial" page, run by
// .github/workflows/counter-trial.yml.
//
// Reads the trial's ticket list (tools/counter-trial/data/plan.json, with the price printed on each
// ticket) and the last results (tools/counter-trial/data/prices.json), looks up every code on
// screwfix.com strictly one at a time with a gap between requests, and saves the latest online price
// for each. The page compares that with the price on the shelf ticket, so a change stays listed until
// it's ticked off there, however many days that takes.
//
// Pages are read with the same parser the Price Tickets page uses (tools/price-tickets/lookup.js),
// and the price is cross-checked against the product data built into the page, as Shelf Check does.
//
// Rules:
//  - pages are read through jina (r.jina.ai), which gets past Screwfix's bot check; straight to screwfix.com only
//    if jina fails (see viaJina below)
//  - never more than one product at a time, GAP_MS between them; on HTTP 429 from jina wait a minute and go slower
//  - a failed lookup never changes a price: the line keeps its last price, marked "unchecked"
//  - "not_found" only when Screwfix itself answers 404 / 410 for the product page
//
// MODE: auto (default) | full | test | smoke
//   auto  - the daily run: checks every line if today hasn't been checked yet, otherwise only
//           finishes off lines that couldn't be checked and codes new to the list
//   full  - checks every line now
//   test  - checks every line but saves nothing (results go in the run summary)
//   smoke - five lines, saves nothing: proves the lookup still works after a code change
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const ROOT = process.cwd();
const PLAN_FILE = 'tools/counter-trial/data/plan.json';
const PRICES_FILE = 'tools/counter-trial/data/prices.json';
const GAP = Number(process.env.GAP_MS || 6000);
const BUDGET_MS = Number(process.env.BUDGET_MIN || 165) * 60000;
const MOVES_KEPT = 6;
const started = Date.now();
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const log = (...a) => console.log(...a);

/* ---------- dates (Europe/London) ---------- */

function londonDate(d = new Date()) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day}`;
}
function nice(iso) {                                    // 2026-10-13 -> Tue 13 Oct
  const [y, m, d] = iso.split('-').map(Number);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${day} ${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
}

/* ---------- files ---------- */

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')); } catch (e) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Couldn't read ${file}: ${e.message}`);
  }
}
// one product per line, so each day's commit shows exactly which prices moved
function writePrices(state) {
  const { products, ...head } = state;
  const lines = Object.keys(products).map((c) => `    ${JSON.stringify(c)}: ${JSON.stringify(products[c])}`);
  const top = Object.keys(head).map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(head[k])}`);
  fs.writeFileSync(path.join(ROOT, PRICES_FILE), `{\n${top.join(',\n')},\n  "products": {\n${lines.join(',\n')}\n  }\n}\n`);
}
const normCode = (c) => String(c || '').trim().toUpperCase().replace(/O/g, '0');   // codes never contain the letter O

/* ---------- reading a product page (same as Shelf Check) ---------- */

const dom = new JSDOM('<!doctype html><title>parser</title>', { url: 'https://detailedfoil.github.io/Toolbox/', runScripts: 'outside-only' });
dom.window.eval(fs.readFileSync(path.join(ROOT, 'tools/price-tickets/lookup.js'), 'utf8'));
const SL = dom.window.ScrewfixLookup;
if (!SL || !SL.interpret) throw new Error('tools/price-tickets/lookup.js did not load');

function chromeMajor() {
  try { return (execFileSync('google-chrome', ['--version'], { encoding: 'utf8' }).match(/(\d+)\./) || [])[1] || null; } catch (e) { return null; }
}
const MAJOR = chromeMajor() || '141';
const HEADERS = {
  'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${MAJOR}.0.0.0 Safari/537.36`,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'sec-ch-ua': `"Chromium";v="${MAJOR}", "Google Chrome";v="${MAJOR}", "Not.A/Brand";v="99"`,
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"'
};

const pounds = (s) => (s == null || s === '' ? null : Number(String(s).replace(/[£,\s]/g, '')));
function errText(e) {
  return String((e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || e).split('\n')[0].slice(0, 120);
}

// the price in the product data (JSON-LD) built into the page, for the product with this code
function dataPrice(html, code) {
  const found = [];
  const walk = (n, depth) => {
    if (!n || typeof n !== 'object' || depth > 8) return;
    if (Array.isArray(n)) { n.forEach((x) => walk(x, depth + 1)); return; }
    if (/Product/i.test([].concat(n['@type'] || []).join(' '))) {
      for (const o of [].concat(n.offers || [])) {
        const p = o && (o.price != null ? o.price : o.lowPrice != null ? o.lowPrice : o.priceSpecification && o.priceSpecification.price);
        if (p != null && isFinite(Number(p))) found.push({ sku: normCode(n.sku || n.productID || ''), price: Number(p) });
      }
    }
    for (const k in n) if (n[k] && typeof n[k] === 'object') walk(n[k], depth + 1);
  };
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1]), 0); } catch (e) { /* not valid JSON */ }
  }
  const mine = found.find((x) => x.sku === code);
  return mine ? { price: mine.price, sure: true } : found[0] ? { price: found[0].price, sure: false } : null;
}

/* ---------- reading through jina (since 17 Oct 2026) ----------
 * Since 13 Oct Screwfix answers GitHub's servers with its bot check (HTTP 202) instead of the product page. jina
 * (r.jina.ai) opens the page in a real browser and sends it back, which gets past that: it's what the page's
 * "Check on this device" uses. Same order as there: a normal text read first (that renders the page and jina keeps
 * a copy). An unchanged price is fine as it is. A different one is confirmed from the product data in the whole page
 * (X-Return-Format: html), which jina serves from that copy. Never ask for the whole page first or with X-No-Cache:
 * jina then fetches it bare and gets the bot check. jina allows 20 requests a minute without a key. */
const JINA = process.env.JINA_URL || 'https://r.jina.ai/';
async function jinaGet(code, whole) {
  const headers = whole ? { 'X-Return-Format': 'html' } : {};
  try {
    const res = await fetch(JINA + SL.productUrl(code), { headers, signal: AbortSignal.timeout(60000) });
    return { http: res.status, text: await res.text() };
  } catch (e) {
    return { http: 0, text: '', err: errText(e) };
  }
}
function readOf(got, code) {
  if (got.http === 429) return { limited: true };
  if (!got.http) return { why: 'jina: no answer (' + got.err + ')' };
  let r;
  try { r = JSON.parse(JSON.stringify(SL.interpret({ status: got.http, text: got.text }, code))); } catch (e) { return { why: 'jina: page could not be read (' + errText(e) + ')' }; }
  return { r };
}
const same = (a, b) => a != null && b != null && Math.abs(a - b) < 0.005;

// -> {kind: 'found', name, price, was, via} | {kind: 'missing'} | {kind: 'limited', pause} | {kind: 'fail', why, relay?}
async function viaJina(code, before) {
  const a = readOf(await jinaGet(code, false), code);
  if (a.limited) return { kind: 'limited', pause: 60000, code: 429 };
  if (a.why) return { kind: 'fail', why: a.why, relay: true };
  const r = a.r;
  if (r.status === 'notfound') return { kind: 'missing' };
  const shown = pounds(r.price);
  if (!(r.status === 'found' || r.status === 'partial') || r.unsure || shown == null || !(shown > 0)) {
    return { kind: 'fail', why: 'jina: ' + (r.unsure ? "page doesn't mention the code" : 'page: ' + r.status + (r.why ? ' (' + r.why + ')' : '')), relay: r.status === 'blocked' };
  }
  const found = (price, how) => ({ kind: 'found', name: r.name || null, price: Math.round(price * 100) / 100, was: same(price, shown) ? pounds(r.was) : null, via: 'jina ' + how });
  if (r.ld && r.ldSure) return found(pounds(r.ld), 'text + product data');
  if (same(shown, before)) return found(shown, 'text, unchanged');
  // a new price (or the first reading): confirm it from the product data in the whole page
  await sleep(3000);
  const b = readOf(await jinaGet(code, true), code);
  if (b.r && b.r.ld && b.r.ldSure) return found(pounds(b.r.ld), 'confirmed from the whole page');
  return { kind: 'fail', why: `jina showed £${shown.toFixed(2)} but it couldn't be confirmed (whole page: ${b.limited ? 'HTTP 429' : b.why || (b.r.ld ? 'product data for another code' : b.r.status)})` };
}

async function lookup(code, before) {
  const j = await viaJina(code, before);
  if (!j.relay) return j;
  // jina itself failed: try Screwfix directly, though it has been sending GitHub its bot check since 13 Oct
  const d = await direct(code);
  if (d.kind === 'limited') return { kind: 'fail', why: j.why + `; direct: Screwfix bot check (HTTP ${d.code})` };
  if (d.kind === 'fail') return { kind: 'fail', why: j.why + '; direct: ' + d.why };
  return { ...d, via: 'direct' };
}

// straight to screwfix.com (the only way until 17 Oct)
// -> {kind: 'found', name, price, was} | {kind: 'missing'} | {kind: 'limited', retryAfter} | {kind: 'fail', why}
async function direct(code) {
  let res, html;
  try {
    res = await fetch(SL.productUrl(code), { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    html = await res.text();
  } catch (e) {
    return { kind: 'fail', why: 'no answer (' + errText(e) + ')' };
  }
  if (res.status === 429) return { kind: 'limited', retryAfter: Number(res.headers.get('retry-after')) || 0, code: 429 };
  // 202 is Screwfix's bot check page, not the product: back off the same way as a 429
  if (res.status === 202) return { kind: 'limited', retryAfter: 0, code: 202 };
  if (res.status === 404 || res.status === 410) {
    return /screwfix/i.test(html) ? { kind: 'missing' } : { kind: 'fail', why: `HTTP ${res.status} that isn't a Screwfix page` };
  }
  if (res.status !== 200) return { kind: 'fail', why: `HTTP ${res.status}` };

  let r;
  try { r = JSON.parse(JSON.stringify(SL.interpret({ status: res.status, text: html }, code))); } catch (e) {
    return { kind: 'fail', why: 'page could not be read (' + errText(e) + ')' };
  }
  const shown = pounds(r.price), data = dataPrice(html, code);
  if (r.status !== 'found' && !(r.status === 'partial' && shown != null)) return { kind: 'fail', why: 'page: ' + r.status + (r.why ? ' (' + r.why + ')' : '') };
  if (r.unsure && !(data && data.sure)) return { kind: 'fail', why: "page doesn't mention the code" };
  if (shown == null || !(shown > 0)) return { kind: 'fail', why: 'no price on the page' };
  if (data && Math.abs(data.price - shown) > 0.005) {
    return { kind: 'fail', why: `prices disagree: page shows £${shown.toFixed(2)}, product data says £${data.price.toFixed(2)}` };
  }
  return { kind: 'found', name: r.name || null, price: Math.round(shown * 100) / 100, was: pounds(r.was) };
}

/* ---------- the run ---------- */

const plan = readJSON(PLAN_FILE);
const old = readJSON(PRICES_FILE, { checked: null, run: null, products: {} });
const codes = [...new Set(plan.lines.map((l) => normCode(l.code)))];
const shelf = Object.fromEntries(plan.lines.map((l) => [normCode(l.code), l.shelf]));
const today = londonDate();

let mode = (process.env.MODE || 'auto').trim().toLowerCase();
if (process.env.GITHUB_EVENT_NAME === 'push') {
  // pushed changes: a new ticket list gets checked, anything else just gets a quick smoke test
  let files = [];
  try { files = (JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).commits || []).flatMap((c) => [...(c.added || []), ...(c.modified || [])]); } catch (e) { /* no event file */ }
  const unpriced = codes.some((c) => !old.products[c] || old.products[c].price == null);
  mode = files.includes(PLAN_FILE) || unpriced ? 'auto' : 'smoke';
}
if (!['auto', 'full', 'test', 'smoke'].includes(mode)) throw new Error('Unknown MODE ' + mode);

const fresh = mode === 'full' || mode === 'test' || (mode === 'auto' && (!old.run || old.run.date !== today));
const saving = mode === 'auto' || mode === 'full';
const trigger = process.env.GITHUB_EVENT_NAME === 'schedule' ? 'schedule' : process.env.GITHUB_EVENT_NAME === 'push' ? 'list change' : 'manual';

// the new state: one entry per code on the list, in list order
const state = {
  trial: plan.name,
  checked: fresh ? today : old.checked,
  run: fresh ? { date: today, started: new Date().toISOString(), finished: null, trigger, complete: false }
             : { ...(old.run || {}), date: today, started: (old.run && old.run.started) || new Date().toISOString() },
  products: {}
};
for (const c of codes) {
  const p = old.products[c] || {};
  state.products[c] = {
    name: p.name || null,
    price: p.price != null ? p.price : null,
    since: p.since || null,                       // the day the online price last moved
    status: fresh ? 'unchecked' : (p.status || 'unchecked'),
    was: p.was != null ? p.was : null,
    on: p.on || null,                             // the day it was last read
    moves: Array.isArray(p.moves) ? p.moves : []
  };
}

const targets = mode === 'smoke' ? codes.slice(0, 5)
  : fresh ? codes
  : codes.filter((c) => { const p = state.products[c]; return p.price == null || p.status === 'unchecked'; });

const label = { auto: fresh ? 'daily check' : 'catch-up', full: 'full check', test: 'test run (saves nothing)', smoke: 'smoke test (saves nothing)' }[mode];
log(`Counter trial check ${today}: ${label}, ${targets.length} of ${codes.length} lines to check, one every ${GAP / 1000}s. Chrome ${MAJOR} headers.`);
if (!targets.length) { log("Nothing to check: today's check is done."); process.exit(0); }

const moved = [];
function apply(code, r) {
  const p = state.products[code];
  if (r.kind === 'found') {
    if (r.name) p.name = r.name;
    p.was = r.was != null && r.was > r.price ? r.was : null;
    p.on = today;
    p.status = 'ok';
    if (p.price != null && Math.abs(r.price - p.price) > 0.001) {
      moved.push({ code, name: p.name, from: p.price, to: r.price });
      p.moves = [...p.moves, { on: today, from: p.price, to: r.price }].slice(-MOVES_KEPT);
      p.since = today;
      p.price = r.price;
      return true;
    }
    if (p.price == null) p.since = today;          // first reading
    p.price = r.price;
  } else if (r.kind === 'missing') {
    p.status = 'not_found'; p.on = today;
  }
  return false;
}

function tally() {
  const all = Object.entries(state.products);
  const n = (s) => all.filter(([, p]) => p.status === s).length;
  const off = all.filter(([c, p]) => p.price != null && shelf[c] != null && Math.abs(p.price - shelf[c]) > 0.001).length;
  return { total: all.length, checked: n('ok') + n('not_found'), not_found: n('not_found'), unchecked: n('unchecked'), moved: moved.length, off_printed: off };
}
function finishRun(stop) {
  const t = tally();
  Object.assign(state.run, { finished: new Date().toISOString(), complete: t.unchecked === 0 }, t);
  if (stop) state.run.stopped = stop; else delete state.run.stopped;
}

const fails = {};
let gap = GAP, last = 0, limited = 0, stop = null, done = 0, found = 0, missing = 0;
async function polite() {
  const wait = last + gap * (0.8 + Math.random() * 0.4) - Date.now();   // a little uneven, like a person browsing
  if (wait > 0) await sleep(wait);
  last = Date.now();
}

let queue = [...targets];
for (let pass = 1; pass <= 3 && queue.length && !stop; pass++) {
  if (pass > 1) {
    log(`\nPass ${pass}: trying ${queue.length} line${queue.length === 1 ? '' : 's'} again after a pause.`);
    await sleep(pass === 2 ? 60000 : 180000);
  }
  const todo = queue;
  queue = [];
  for (let i = 0; i < todo.length; i++) {
    const code = todo[i];
    if (Date.now() - started > BUDGET_MS) { stop = 'out of time'; queue.push(...todo.slice(i)); break; }
    await polite();
    const p0 = state.products[code];
    const r = await lookup(code, p0.price != null ? p0.price : shelf[code]);
    if (r.kind === 'limited') {
      // jina's limit (20 a minute): wait a minute, go a bit slower, and stop if it keeps happening
      limited++;
      if (limited >= 4) { stop = `jina kept saying slow down (HTTP ${r.code})`; queue.push(...todo.slice(i)); log(`HTTP ${r.code} again: stopping, the rest are left for the next run.`); break; }
      gap = Math.min(gap * 1.5, 30000);
      log(`HTTP ${r.code} from jina: pausing ${Math.round(r.pause / 1000)} s, then one every ${Math.round(gap / 1000)}s.`);
      await sleep(r.pause);
      i--;
      continue;
    }
    done++;
    let mv = false;
    if (r.kind === 'fail') { fails[code] = r.why; queue.push(code); }
    else {
      delete fails[code];
      if (r.kind === 'found') found++; else missing++;
      if (mode !== 'smoke') mv = apply(code, r);
    }
    const p = state.products[code];
    log(`[${String(done).padStart(2)}] ${code}  ${r.kind === 'found' ? '£' + r.price.toFixed(2) + (mv ? `  MOVED from £${p.moves[p.moves.length - 1].from.toFixed(2)}` : '') + `  (${r.via})` : r.kind === 'missing' ? 'not found (404)' : 'could not check: ' + r.why}`);
    if (saving && done % 10 === 0) { finishRun('still running'); writePrices(state); }   // keep progress if the run gets cut short
  }
}

/* ---------- results ---------- */

const left = Object.keys(fails);
if (mode === 'smoke') {
  log(`\nSmoke test: ${found} found, ${missing} not found, ${left.length} could not be checked.`);
  if (found < 3) { console.log(`::error title=Counter trial smoke test failed::Only ${found} of ${targets.length} prices could be read. ${left.map((c) => c + ': ' + fails[c]).join('; ')}`); process.exit(1); }
  process.exit(0);
}

finishRun(stop || (left.length ? `${left.length} line${left.length === 1 ? '' : 's'} could not be checked` : null));
const t = state.run;
const money = (v) => '£' + Number(v).toFixed(2);
const moveLines = moved.map((c) => `${c.code}  ${c.to > c.from ? 'UP  ' : 'DOWN'}  ${money(c.from)} -> ${money(c.to)}  ${c.name || ''}`);
const headline = `${nice(today)}: ${t.checked} of ${t.total} checked, ${t.moved} moved online today, ${t.off_printed} differ from the printed ticket list, ${t.not_found} not found online` +
  (t.unchecked ? `, ${t.unchecked} not checked yet` : '') + (stop ? ` (stopped: ${stop})` : '');
log('\n' + headline);
moveLines.forEach((l) => log('  ' + l));

const enc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
log(`::notice title=${mode === 'test' ? 'Counter trial test run (not saved)' : 'Counter trial check'}::${enc(headline)}`);
if (moveLines.length) log(`::notice title=Moved today::${enc(moveLines.join('\n'))}`);
if (left.length) log(`::warning title=Could not check::${enc(left.map((c) => c + ': ' + fails[c]).join('\n'))}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = moved.map((c) => `| ${c.code} | ${(c.name || '').replace(/\|/g, '/')} | ${money(c.from)} | ${money(c.to)} | ${c.to > c.from ? 'UP' : 'DOWN'} |`);
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### A25 Behind counter trial${mode === 'test' ? ' (test run, nothing saved)' : ''}\n\n${headline}\n\n` +
    (rows.length ? `| Code | Product | Was | Now | |\n|---|---|---|---|---|\n${rows.join('\n')}\n\n` : '') +
    (left.length ? `**Could not check:** ${left.map((c) => `${c} (${fails[c]})`).join(', ')}\n` : ''));
}

if (saving) {
  writePrices(state);
  const msg = `Counter trial ${nice(today)}: ${t.checked} of ${t.total} checked, ${t.moved} moved` +
    (t.not_found ? `, ${t.not_found} not found` : '') + (t.unchecked ? `, ${t.unchecked} still to check` : '');
  if (process.env.RUNNER_TEMP) fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'counter-commit.txt'), msg + '\n');
}

// nothing at all got through: fail the run so GitHub emails about it
if (targets.length >= 5 && found + missing === 0) {
  console.log(`::error title=Counter trial check blocked::None of ${targets.length} lines could be checked. ${stop || ''}`);
  process.exit(1);
}
