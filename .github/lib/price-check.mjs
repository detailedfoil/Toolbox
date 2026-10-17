// What the two GitHub price checks share: .github/shelf-check/check.mjs (the Monday shelf check) and
// .github/counter-trial/check.mjs (the A25 counter trial). UK dates, the data files, and reading one
// product's price from screwfix.com. A change to how prices are read goes here, so both checks get it.
//
// Pages are read with the same parser the Price Tickets page uses (tools/price-tickets/lookup.js), and a
// new price is only believed once the product data built into the page (JSON-LD) agrees.
//
// Rules:
//  - pages are read through jina (r.jina.ai), which gets past Screwfix's bot check; straight to screwfix.com
//    only if jina fails (see viaJina below)
//  - a failed lookup is never a price change: the caller keeps the line's last price
//  - "missing" only when Screwfix itself says the product page doesn't exist
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const ROOT = process.cwd();
export const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
export const log = (...a) => console.log(...a);

/* ---------- dates (Europe/London) ---------- */

export function londonDate(d = new Date()) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day}`;
}
export function mondayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}
export function nice(iso) {                             // 2026-10-12 -> Mon 12 Oct
  const [y, m, d] = iso.split('-').map(Number);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${day} ${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
}

/* ---------- files and numbers ---------- */

export function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')); } catch (e) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Couldn't read ${file}: ${e.message}`);
  }
}
// one product per line, so each run's commit shows exactly which prices moved
export function writePrices(file, state) {
  const { products, ...head } = state;
  const lines = Object.keys(products).map((c) => `    ${JSON.stringify(c)}: ${JSON.stringify(products[c])}`);
  const top = Object.keys(head).map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(head[k])}`);
  fs.writeFileSync(path.join(ROOT, file), `{\n${top.join(',\n')},\n  "products": {\n${lines.join(',\n')}\n  }\n}\n`);
}
export const normCode = (c) => String(c || '').trim().toUpperCase().replace(/O/g, '0');   // codes never contain the letter O
const pounds = (s) => (s == null || s === '' ? null : Number(String(s).replace(/[£,\s]/g, '')));
export const money = (v) => '£' + Number(v).toFixed(2);
const same = (a, b) => a != null && b != null && Math.abs(a - b) < 0.005;
function errText(e) {
  return String((e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || e).split('\n')[0].slice(0, 120);
}

/* ---------- what this run does ---------- */

// MODE (auto, full, test or smoke). A push to main (the workflow's push trigger) runs auto when the list itself
// changed, or has codes with no price yet (the push event doesn't always list the files), and otherwise just a
// quick smoke test.
export function runMode(planFile, unpriced) {
  let mode = (process.env.MODE || 'auto').trim().toLowerCase();
  if (process.env.GITHUB_EVENT_NAME === 'push') {
    let files = [];
    try { files = (JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).commits || []).flatMap((c) => [...(c.added || []), ...(c.modified || [])]); } catch (e) { /* no event file */ }
    mode = files.includes(planFile) || unpriced ? 'auto' : 'smoke';
  }
  if (!['auto', 'full', 'test', 'smoke'].includes(mode)) throw new Error('Unknown MODE ' + mode);
  return mode;
}

// a note on the run's page on GitHub: kind is notice, warning or error (no commas in the title)
export function annotate(kind, title, text) {
  log(`::${kind} title=${title}::${String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
}

/* ---------- reading a product page ---------- */

const dom = new JSDOM('<!doctype html><title>parser</title>', { url: 'https://detailedfoil.github.io/Toolbox/', runScripts: 'outside-only' });
dom.window.eval(fs.readFileSync(path.join(ROOT, 'tools/price-tickets/lookup.js'), 'utf8'));
const SL = dom.window.ScrewfixLookup;
if (!SL || !SL.interpret) throw new Error('tools/price-tickets/lookup.js did not load');

function chromeMajor() {
  try { return (execFileSync('google-chrome', ['--version'], { encoding: 'utf8' }).match(/(\d+)\./) || [])[1] || null; } catch (e) { return null; }
}
export const MAJOR = chromeMajor() || '141';
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
 * (r.jina.ai) opens the page in a real browser and sends it back, which gets past that; it's what the pages' own
 * device checks use, and the A25 GitHub check read 69 of 69 this way on 16 Oct. Same order as there: a normal
 * text read first (that renders the page and jina keeps a copy). An unchanged price is fine as it is. A different
 * one is confirmed from the product data in the whole page (X-Return-Format: html), which jina serves from that
 * copy. Never ask for the whole page first or with X-No-Cache: jina then fetches it bare and gets the bot check.
 * jina allows 20 requests a minute without a key. */
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
// on HTTP 429, wait: as long as jina asks (it sends {"retryAfter": 2, ...}), 5 to 60 s
function readOf(got, code) {
  if (got.http === 429) {
    const m = /"retryAfter"\s*:\s*(\d+)/.exec(got.text.slice(0, 600));
    return { limited: true, wait: Math.min(Math.max(m ? Number(m[1]) : 0, 5), 60) * 1000 };
  }
  if (!got.http) return { why: 'jina: no answer (' + got.err + ')' };
  let r;
  try { r = JSON.parse(JSON.stringify(SL.interpret({ status: got.http, text: got.text }, code))); } catch (e) { return { why: 'jina: page could not be read (' + errText(e) + ')' }; }
  return { r };
}

// -> {kind: 'found', name, price, was, via} | {kind: 'missing'} | {kind: 'limited', pause} | {kind: 'fail', why, relay?}
// (relay: jina itself failed, so it's worth trying Screwfix directly)
async function viaJina(code, before) {
  const a = readOf(await jinaGet(code, false), code);
  if (a.limited) return { kind: 'limited', pause: a.wait };
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
  await sleep(3500);
  let b = readOf(await jinaGet(code, true), code);
  if (b.limited) { await sleep(b.wait); b = readOf(await jinaGet(code, true), code); }
  if (b.r && b.r.ld && b.r.ldSure) return found(pounds(b.r.ld), 'confirmed from the whole page');
  return { kind: 'fail', why: `jina showed £${shown.toFixed(2)} but it couldn't be confirmed (whole page: ${b.limited ? 'HTTP 429' : b.why || (b.r.ld ? 'product data for another code' : b.r.status)})` };
}

// straight to screwfix.com (the only way until 17 Oct)
// -> {kind: 'found', name, price, was} | {kind: 'missing'} | {kind: 'fail', why}
async function direct(code) {
  let res, html;
  try {
    res = await fetch(SL.productUrl(code), { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    html = await res.text();
  } catch (e) {
    return { kind: 'fail', why: 'no answer (' + errText(e) + ')' };
  }
  if (res.status === 429) return { kind: 'fail', why: 'Screwfix said slow down (HTTP 429)' };
  if (res.status === 202) return { kind: 'fail', why: "Screwfix's bot check (HTTP 202)" };
  if (res.status === 404 || res.status === 410) {
    // Screwfix's own "404 | Screwfix" page: the product page doesn't exist
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

/* One product's price on screwfix.com now. before: the price it had, so an unchanged one needn't be confirmed.
   -> {kind: 'found', name, price, was, via} | {kind: 'missing'} | {kind: 'limited', pause} (jina said slow down:
   wait `pause` ms and ask again) | {kind: 'fail', why} */
export async function lookup(code, before) {
  const j = await viaJina(code, before);
  if (!j.relay) return j;
  // jina itself failed: try Screwfix directly, though it has been sending GitHub its bot check since 13 Oct
  const d = await direct(code);
  if (d.kind === 'fail') return { kind: 'fail', why: j.why + '; direct: ' + d.why };
  return { ...d, via: 'direct' };
}
