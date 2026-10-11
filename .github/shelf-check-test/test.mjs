// TEMPORARY test, deleted with this branch: can a GitHub Actions runner read Screwfix prices?
// Fetches a handful of product pages strictly one at a time, with a gap between requests,
// and reads each page with the site's own parser (tools/price-tickets/lookup.js).
// Only codes still without a definite answer move on to the next way of fetching:
//   1) a plain HTTPS request from the runner
//   2) headless Google Chrome on the runner
//   3) the public CORS relays the Price Tickets page uses
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'shelf-test-results');
fs.mkdirSync(path.join(OUT, 'pages'), { recursive: true });

// product codes never contain the letter O, it is always a zero
const CODES = (process.env.CODES || '').toUpperCase().replace(/O/g, '0').split(/[\s,]+/).filter(Boolean);
const GAP = Number(process.env.GAP_MS || 5000);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const log = (...a) => console.log(...a);

// The site's own parser, run inside a fake browser window
const dom = new JSDOM('<!doctype html><title>parser</title>', { url: 'https://detailedfoil.github.io/Toolbox/', runScripts: 'outside-only' });
dom.window.eval(fs.readFileSync(path.join(ROOT, 'tools/price-tickets/lookup.js'), 'utf8'));
const SL = dom.window.ScrewfixLookup;

function chromeMajor() {
  try { return (execFileSync('google-chrome', ['--version'], { encoding: 'utf8' }).match(/(\d+)\./) || [])[1] || null; }
  catch (e) { return null; }
}
const MAJOR = chromeMajor() || '140';
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${MAJOR}.0.0.0 Safari/537.36`;
const HEADERS = {
  'User-Agent': UA,
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

const RELAYS = [
  ['codetabs', (u) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u)],
  ['cors.lol', (u) => 'https://api.cors.lol/?url=' + encodeURIComponent(u)],
  ['allorigins', (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u)],
  ['jina', (u) => 'https://r.jina.ai/' + u],
  ['corsproxy', (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u)]
];

function errText(e) {
  return String((e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || e).split('\n')[0].slice(0, 200);
}

// What the page itself says, separate from the parser: helps explain a block or a wrong price
function signals(text, headers) {
  const s = {};
  const title = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  if (title) s.title = title.replace(/\s+/g, ' ').trim().slice(0, 140);
  const json = [...text.matchAll(/"price"\s*:\s*"?(\d+(?:\.\d+)?)/g)].slice(0, 4).map((m) => m[1]);
  if (json.length) s.jsonPrices = json;
  const ip = text.match(/itemprop=["']price["'][^>]*?content=["']([^"']+)/i) || text.match(/content=["']([^"']+)["'][^>]*itemprop=["']price["']/i);
  if (ip) s.itempropPrice = ip[1];
  const marks = text.match(/access denied|reference #[\d.a-f]+|pardon our interruption|captcha|bm-verify|sec-if-cpt|just a moment|cf-chl|too many requests|unusual traffic|bot manager/gi) || [];
  if (marks.length) s.blockMarks = [...new Set(marks.map((m) => m.toLowerCase()))].slice(0, 6);
  if (headers) {
    s.server = headers.get('server');
    const cookies = (headers.getSetCookie ? headers.getSetCookie() : []).map((c) => c.split('=')[0]);
    if (cookies.length) s.cookies = cookies.slice(0, 12);
    for (const h of ['cf-ray', 'akamai-grn', 'x-akamai-transformed', 'x-cache', 'retry-after', 'content-type']) {
      if (headers.get(h)) s[h] = headers.get(h);
    }
  }
  return s;
}

function readPage(http, text, code) {
  const t0 = Date.now();
  let r;
  try { r = JSON.parse(JSON.stringify(SL.interpret({ status: http, text }, code))); }
  catch (e) { r = { status: 'error', why: errText(e) }; }
  delete r.images;
  r.parseMs = Date.now() - t0;
  return r;
}

async function viaDirect(code) {
  const t0 = Date.now();
  try {
    const res = await fetch(SL.productUrl(code), { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    return { method: 'direct', http: res.status, finalUrl: res.url, ms: Date.now() - t0, bytes: text.length, signals: signals(text, res.headers), text };
  } catch (e) {
    return { method: 'direct', http: 0, ms: Date.now() - t0, error: errText(e) };
  }
}

let browser = null, context = null;
async function viaChrome(code) {
  const t0 = Date.now();
  try {
    if (!browser) {
      const { chromium } = require('playwright-core');
      browser = await chromium.launch({ channel: 'chrome', headless: true });
      context = await browser.newContext({ userAgent: UA, locale: 'en-GB', timezoneId: 'Europe/London', viewport: { width: 1280, height: 900 } });
      await context.route('**/*', (route) => (['image', 'media', 'font'].includes(route.request().resourceType()) ? route.abort() : route.continue()));
    }
    const page = await context.newPage();
    try {
      const resp = await page.goto(SL.productUrl(code), { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(2000);
      const text = await page.content();
      return { method: 'chrome', http: resp ? resp.status() : 0, finalUrl: page.url(), ms: Date.now() - t0, bytes: text.length, signals: signals(text, null), text };
    } finally {
      await page.close();
    }
  } catch (e) {
    return { method: 'chrome', http: 0, ms: Date.now() - t0, error: errText(e) };
  }
}

async function viaRelay(code, name, build) {
  const t0 = Date.now();
  try {
    const res = await fetch(build(SL.productUrl(code)), { headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*;q=0.8' }, signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    return { method: 'relay-' + name, http: res.status, ms: Date.now() - t0, bytes: text.length, signals: signals(text, null), text };
  } catch (e) {
    return { method: 'relay-' + name, http: 0, ms: Date.now() - t0, error: errText(e) };
  }
}

// one request at a time, at least GAP ms apart
let lastHit = 0;
async function polite() {
  const wait = lastHit + GAP - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit = Date.now();
}

const RANK = { found: 4, notfound: 3, partial: 2, blocked: 1, error: 0 };
const definite = (r) => !!r && (r.status === 'found' || r.status === 'notfound');

function record(row, a) {
  if (a.text) {
    a.read = readPage(a.http, a.text, row.code);
    const file = `pages/${row.code}-${a.method}.html.gz`;
    fs.writeFileSync(path.join(OUT, file), zlib.gzipSync(a.text));
    a.saved = file;
  }
  delete a.text;
  row.attempts.push(a);
  const r = a.read || { status: 'error', why: a.error };
  if (!row.result || (RANK[r.status] || 0) > (RANK[row.result.status] || 0)) { row.result = r; row.via = a.method; }
  log([row.code, a.method, 'http ' + a.http, a.ms + ' ms', (a.bytes || 0) + ' chars', r.status, r.price || '', r.was ? 'was ' + r.was : '', r.name || r.why || a.error || ''].join(' | '));
  if (a.signals) log('    ' + JSON.stringify(a.signals));
}

const rows = CODES.map((code) => ({ code, attempts: [] }));
log(`Runner: ${process.env.ImageOS || '?'} ${process.env.ImageVersion || ''}, Node ${process.version}, Chrome ${MAJOR}, gap ${GAP} ms, ${rows.length} codes`);

// 1) plain request for every code
let limited = false;
for (const row of rows) {
  if (limited) break;
  await polite();
  const a = await viaDirect(row.code);
  record(row, a);
  if (a.http === 429) { limited = true; log('Got 429 from Screwfix: no more direct requests this run.'); }
}

// 2) headless Chrome, only for codes without a definite answer
for (const row of rows.filter((r) => !definite(r.result))) {
  if (limited) break;
  await polite();
  const a = await viaChrome(row.code);
  record(row, a);
  if (a.http === 429) { limited = true; log('Got 429 in Chrome: stopping.'); }
}
if (browser) await browser.close().catch(() => {});

// 3) relays, only for codes still without a definite answer
for (const row of rows.filter((r) => !definite(r.result))) {
  for (const [name, build] of RELAYS) {
    await polite();
    record(row, await viaRelay(row.code, name, build));
    if (definite(row.result)) break;
  }
}

const summary = rows.map((r) => ({
  code: r.code, via: r.via || '-', status: r.result ? r.result.status : 'not tried',
  price: (r.result && r.result.price) || '', was: (r.result && r.result.was) || '', name: (r.result && r.result.name) || '',
  age: !!(r.result && r.result.age), unsure: !!(r.result && r.result.unsure), why: (r.result && r.result.why) || ''
}));
const report = {
  ranAt: new Date().toISOString(), image: `${process.env.ImageOS || ''} ${process.env.ImageVersion || ''}`.trim(),
  node: process.version, chrome: MAJOR, gapMs: GAP, userAgent: UA, summary, rows
};
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(report, null, 2));

const lines = summary.map((s) => [s.code, s.status, s.price, s.was && 'was ' + s.was, 'via ' + s.via, s.name.slice(0, 60)].filter(Boolean).join('  '));
const tries = rows.flatMap((r) => r.attempts.map((a) => [r.code, a.method, 'http ' + a.http, a.ms + 'ms', (a.bytes || 0) + 'ch', a.read ? a.read.status : 'error ' + (a.error || ''), a.signals && a.signals.title ? '"' + a.signals.title.slice(0, 50) + '"' : '', a.signals && a.signals.blockMarks ? 'marks: ' + a.signals.blockMarks.join(',') : ''].filter(Boolean).join('  ')));
const enc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
log('::notice title=Shelf check test: results::' + enc(lines.join('\n')));
log('::notice title=Shelf check test: attempts::' + enc(tries.join('\n')));
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '### Shelf check test\n\n| Code | Result | Price | Via | Name |\n|---|---|---|---|---|\n' +
    summary.map((s) => `| ${s.code} | ${s.status} | ${s.price}${s.was ? ' (was ' + s.was + ')' : ''} | ${s.via} | ${s.name.replace(/\|/g, '/')} |`).join('\n') + '\n');
}
