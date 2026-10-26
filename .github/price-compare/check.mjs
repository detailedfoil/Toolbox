// Price Compare check for the Toolbox "Price Compare" page (price-compare.yml runs it twice a day).
//
// Reads every store's page for every product in tools/price-compare/data/compare.json and saves what it found to
// tools/price-compare/data/prices.json, keeping each price's last few moves so the page can show what changed.
// Each page is read through jina (r.jina.ai), which opens it in a real browser: the text first, then the whole page
// only when the text has no price (or to confirm a big change), and straight from the store only if jina can't get
// it. tools/price-compare/read.js reads the price out of it, the same file the page uses for "Check now".
//
// Rules:
//  - a failed read is never a price change: the row keeps its last price and notes since when it couldn't be read
//  - a new price more than 25% away from the last one is only believed once the page's product data agrees, or the
//    next run sees the same price again
//  - polite: one request every 6 seconds or so (jina allows 20 a minute without a key), and a store's two pages are
//    never read back to back
//  - the run only fails (a red cross and an email) when no page at all could be read
//
// MODE: all = every row (the schedule), new = only rows never read or whose address changed (a push; when there's
// nothing new it's a 3 page smoke test that saves nothing), test = 3 pages, saves nothing, raw = every page with an
// address saved as it came back (to RAW_DIR, for working out a new store's layout), plus RAW_EXTRA addresses.
// JINA_TOLERANCE: how old a copy of a page jina may hand back, in seconds (default 1800).
// Test hooks: JINA_URL (the jina relay), DIRECT_VIA (put in front of a store address when going direct), GAP_MS,
// PC_DIR (the data folder), PC_NOW (pretend time), RAW_DIR, RAW_STORES.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'tools/price-compare/read.js'), 'utf8'), { filename: 'tools/price-compare/read.js' });
const R = globalThis.PriceRead;

const DIR = process.env.PC_DIR || path.join(process.cwd(), 'tools/price-compare/data');
const LIST = path.join(DIR, 'compare.json'), FILE = path.join(DIR, 'prices.json');
const JINA = process.env.JINA_URL || 'https://r.jina.ai/';
const DIRECT = process.env.DIRECT_VIA || '';
const GAP = Number(process.env.GAP_MS || 6000);
// how old a copy of a page jina may hand back (seconds). jina keeps copies of pages it has opened for anyone; a store's
// price can change overnight, so an older copy means opening the page again (a normal first read, not X-No-Cache).
// The whole page is asked for straight after its text read, so it comes from that fresh copy.
const TOLERANCE = String(process.env.JINA_TOLERANCE || '1800');
const TEMP = process.env.RUNNER_TEMP || '';
const RAW = process.env.RAW_DIR || (TEMP ? path.join(TEMP, 'raw') : path.join(process.cwd(), 'price-compare-raw'));
const BIG = 0.25;
const now = () => (process.env.PC_NOW ? new Date(process.env.PC_NOW) : new Date());
const NOW = now().toISOString();
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const money = (v) => '£' + Number(v).toFixed(2);
const errText = (e) => String((e && e.cause && (e.cause.code || e.cause.message)) || (e && (e.name === 'TimeoutError' ? 'no answer in time' : e.message)) || e).split('\n')[0].slice(0, 100);
/* a failure in plain words (jina's errors come as JSON: {"code":422,"readableMessage":"... net::ERR_CERT_DATE_INVALID ..."}) */
function plainWhy(text, fallback) {
  let msg = String(text || '');
  try { const j = JSON.parse(msg); msg = String(j.readableMessage || j.message || j.name || msg); } catch { /* not JSON */ }
  if (/ERR_CERT|CERT_HAS_EXPIRED|CERT_|certificate/i.test(msg)) return "their website's security certificate has run out";
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND/i.test(msg)) return "their website's address doesn't work";
  if (/ERR_CONNECTION|ECONNREFUSED|ECONNRESET|socket hang up/i.test(msg)) return "their website didn't answer";
  if (/timeout|timed out|no answer in time/i.test(msg)) return 'their page took too long to open';
  return fallback;
}

const list = JSON.parse(fs.readFileSync(LIST, 'utf8'));
let saved = { items: {} };
try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* first run */ }
if (!saved.items) saved.items = {};

let mode = (process.env.MODE || '').trim().toLowerCase() || (process.env.GITHUB_EVENT_NAME === 'push' ? 'new' : 'all');
if (!['all', 'new', 'test', 'raw'].includes(mode)) throw new Error('Unknown MODE ' + mode);

/* ---------- reading pages, politely ---------- */

let nextAt = 0;
async function pace() {
  const wait = nextAt - Date.now();
  if (wait > 0) await sleep(wait);
  nextAt = Date.now() + Math.round(GAP * (0.8 + Math.random() * 0.5));
}
const retryAfter = (body) => Math.min(Number((/"retryAfter"\s*:\s*(\d+(?:\.\d+)?)/.exec(String(body).slice(0, 600)) || [])[1] || 0), 60);

/* through jina -> {http, body} or {err}; whole: the whole page (asked only after a text read of the same page) */
async function jina(url, whole) {
  let last = '';
  for (let go = 0; go < 4; go++) {
    await pace();
    try {
      const headers = { 'X-Cache-Tolerance': TOLERANCE };
      if (whole) headers['X-Return-Format'] = 'html';
      const res = await fetch(JINA + url, { headers, signal: AbortSignal.timeout(90000) });
      const body = await res.text();
      if (res.status === 429) { last = 'jina said too many requests'; await sleep((retryAfter(body) || 20) * 1000 + 3000); continue; }
      if (!res.ok && !/Target URL returned error/i.test(body.slice(0, 2000))) return { err: plainWhy(body, "jina couldn't open the page (HTTP " + res.status + ')') };
      return { http: res.status, body };
    } catch (e) {
      last = plainWhy(errText(e), 'jina: ' + errText(e));
      if (go >= 1) break;
    }
  }
  return { err: last };
}

/* straight from the store, the way a browser asks (GitHub only: a phone can't read another site directly) */
async function direct(url) {
  await pace();
  try {
    const res = await fetch(DIRECT + url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9'
      },
      redirect: 'follow', signal: AbortSignal.timeout(45000)
    });
    const body = await res.text();
    if (res.status === 404 || res.status === 410) return { http: res.status, body: 'Warning: Target URL returned error ' + res.status + '\n' + body.slice(0, 500) };
    if (!res.ok) return { err: res.status === 403 || res.status === 429 ? "the store's bot check (error " + res.status + ')' : 'HTTP ' + res.status };
    return { http: res.status, body };
  } catch (e) {
    return { err: plainWhy(errText(e), errText(e)) };
  }
}

/* one store's price for one product -> {ok, price, was, name, url, how} or {ok: false, why, direct, seen}
   (why: through jina, the main reason; direct: what the store itself said, for working out what's wrong) */
async function readJob(job) {
  const whys = [], directs = [];
  let seen = null;
  for (const url of job.urls) {
    const t = await jina(url, false);
    let r = t.err ? { ok: false, why: t.err } : R.text(t.body, job);
    if (r.ok) return { ...r, url };
    if (r.seen != null) seen = r.seen;
    if (r.gone) { whys.push(r.why); continue; }
    if (!t.err && !/bot check/.test(r.why)) {
      const h = await jina(url, true);
      const r2 = h.err ? { ok: false, why: h.err } : R.html(h.body, job);
      if (r2.ok) return { ...r2, url };
      if (r2.gone) { whys.push(r2.why); continue; }
    }
    const d = await direct(url);
    const r3 = d.err ? { ok: false, why: d.err } : R.html(d.body, job);
    if (r3.ok) return { ...r3, url, how: r3.how + ' (direct)' };
    whys.push(r.why);
    if (r3.why) directs.push(r3.why);
    if (r3.seen != null) seen = r3.seen;
  }
  return { ok: false, why: [...new Set(whys)].join('; ') || 'no address to read', direct: [...new Set(directs)].join('; '), seen };
}

/* a big jump is believed if the page's own product data says the same (with or without VAT) */
async function confirm(job, r) {
  if (r.how !== 'text') return true;
  const h = await jina(r.url, true);
  return R.agrees(h.err ? null : R.html(h.body, job), r.price);
}

/* ---------- what to read ---------- */

const all = R.jobs(list);
const rowOf = (j) => (saved.items[j.item.id] || {})[j.store.id];
// a store's two pages apart: every store for the first product, then every store for the next
const readable = all.filter((j) => j.urls.length && !j.none);
let todo;
// raw mode: RAW_STORES (store ids, comma separated) narrows it to those stores
const only = String(process.env.RAW_STORES || '').split(/[\s,]+/).filter(Boolean);
if (mode === 'raw') todo = all.filter((j) => j.urls.length && (!only.length || only.includes(j.store.id)));
else if (mode === 'test') todo = readable.slice(0, 3);
else if (mode === 'new') {
  todo = readable.filter((j) => { const r = rowOf(j); return !r || r.price == null || !j.urls.includes(r.url); });
  if (!todo.length) { mode = 'test'; todo = readable.slice(0, 3); }
} else todo = readable;
const saving = mode === 'all' || mode === 'new';

function summary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}

/* ---------- raw mode: save the pages as they came back ---------- */

if (mode === 'raw') {
  fs.mkdirSync(RAW, { recursive: true });
  const trim = (html) => String(html).replace(/<script\b(?![^>]*(?:ld\+json|x-magento-init))[^>]*>[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '<style></style>').replace(/<svg\b[\s\S]*?<\/svg>/gi, '<svg></svg>');
  const index = ['# Raw pages ' + NOW, '', '| file | answer | size | reader |', '|---|---|---|---|'];
  const extra = String(process.env.RAW_EXTRA || '').split(/[\s,]+/).filter((u) => /^https?:\/\//.test(u));
  const pages = [...todo.flatMap((j) => j.urls.map((url, n) => ({ job: j, url, name: j.store.id + '-' + j.item.id + (n ? '-' + (n + 1) : '') }))),
    ...extra.map((url, n) => ({ job: null, url, name: 'extra-' + (n + 1) }))];
  for (const p of pages) {
    const save = (suffix, got, read) => {
      fs.writeFileSync(path.join(RAW, p.name + suffix), got.err ? got.err + '\n' : (suffix.endsWith('html') ? trim(got.body) : got.body));
      index.push(`| ${p.name}${suffix} | ${got.err ? got.err : 'HTTP ' + got.http} | ${got.err ? 0 : got.body.length} | ${read ? (read.ok ? money(read.price) + ' ' + read.how + ' "' + read.name + '"' : read.why) : ''} |`);
    };
    const t = await jina(p.url, false);
    save('.txt', t, p.job && !t.err ? R.text(t.body, p.job) : null);
    const h = await jina(p.url, true);
    save('.html', h, p.job && !h.err ? R.html(h.body, p.job) : null);
    const d = await direct(p.url);
    save('.direct.html', d, p.job && !d.err ? R.html(d.body, p.job) : null);
    console.log(p.name, p.url);
  }
  fs.writeFileSync(path.join(RAW, 'index.md'), index.join('\n') + '\n' + pages.map((p) => `- ${p.name}: ${p.url}`).join('\n') + '\n');
  summary(index);
  console.log(`Saved ${pages.length} pages to ${RAW}`);
  process.exit(0);
}

/* ---------- read them ---------- */

const started = Date.now(), startedAt = process.env.PC_NOW ? NOW : new Date(started).toISOString();
const changes = [], fresh = [], fails = [], results = {};
const items = JSON.parse(JSON.stringify(saved.items));
// a read that failed for a reason that may pass (a bot check, no answer, an error page) gets one more go at the end,
// a couple of minutes later. One that found another product, an unbelievable price or a missing page doesn't.
const RETRY_PAUSE = Number(process.env.RETRY_PAUSE_MS || 120000);
const lasting = (r) => r.ok || r.pending != null || /different (?:product|length)|doesn't look like|has gone/.test(r.why || '');
async function readAll(jobs) {
  const got = new Map();
  for (const job of jobs) got.set(job, await readOne(job));
  const again = jobs.filter((j) => !lasting(got.get(j)));
  if (again.length && mode !== 'test') {
    console.log(`Trying ${again.length} again in ${Math.round(RETRY_PAUSE / 1000)} s: ${again.map((j) => j.key).join(', ')}`);
    await sleep(RETRY_PAUSE);
    for (const job of again) {
      const r = await readOne(job);
      if (r.ok || r.pending != null) got.set(job, r);
    }
  }
  return got;
}
async function readOne(job) {
  const r = await readJob(job), old = rowOf(job);
  if (r.ok && old && old.price != null && Math.abs(r.price - old.price) / old.price > BIG) {
    const again = old.pending && Math.abs(old.pending.price - r.price) < 0.011;
    if (!again && !(await confirm(job, r))) return { ok: false, why: `new price ${money(r.price)} (was ${money(old.price)}) not confirmed yet`, pending: r.price };
  }
  return r;
}

const order = [...todo].sort((a, b) => list.items.indexOf(a.item) - list.items.indexOf(b.item));
const got = await readAll(order);
for (const job of order) {
  const label = `${job.store.name} ${job.item.short || job.item.name}`;
  const r = got.get(job);
  const old = rowOf(job);
  const row = { ...(old || {}) };
  results[job.key] = r;
  if (r.ok) {
    if (row.price == null) { row.since = NOW; fresh.push(`${label} ${money(r.price)}`); }
    else if (Math.abs(r.price - row.price) >= 0.005) {
      row.moves = [...(row.moves || []), { on: NOW, from: row.price, to: r.price }].slice(-6);
      row.since = NOW;
      changes.push(`${label} ${money(r.price)} (was ${money(row.price)})`);
    }
    row.price = r.price;
    row.name = r.name;
    row.url = r.url;
    if (r.was) row.was = r.was; else delete row.was;
    delete row.fail;
    delete row.pending;
  } else {
    row.fail = { since: (old && old.fail && old.fail.since) || NOW, why: r.why, n: ((old && old.fail && old.fail.n) || 0) + 1 };
    if (r.direct && r.direct !== r.why) row.fail.direct = r.direct;
    if (r.pending != null) row.pending = { price: r.pending, on: (old && old.pending && Math.abs(old.pending.price - r.pending) < 0.011 && old.pending.on) || NOW };
    else delete row.pending;
    fails.push(`${label}: ${r.why}${r.direct && r.direct !== r.why ? ' (straight from the store: ' + r.direct + ')' : ''}`);
  }
  (items[job.item.id] ||= {})[job.store.id] = row;
  console.log(`${label}: ${r.ok ? money(r.price) + ' (' + r.how + ')' : 'not read, ' + r.why}`);
}

/* ---------- save ---------- */

// rows for stores or products no longer on the list (or now marked none) go
const keep = {};
for (const j of readable) {
  const row = (items[j.item.id] || {})[j.store.id];
  if (row) (keep[j.item.id] ||= {})[j.store.id] = row;
}
const tried = todo.length, read = tried - fails.length;
const thisRun = { mode, started: startedAt, took: Math.round((Date.now() - started) / 1000), tried, read, failed: fails.length };
// checked: when every row was last read (a run that only reads new rows leaves it, and the rows it read are newer still)
const out = mode === 'all' ? { checked: NOW, run: thisRun, items: keep }
  : { checked: saved.checked || NOW, run: saved.run || thisRun, last: thisRun, items: keep };

// each row's fields in the same order every time, so a commit's diff only shows what really changed
const ORDER = ['price', 'was', 'name', 'url', 'since', 'moves', 'pending', 'fail'];
const tidy = (r) => Object.fromEntries([...ORDER.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]), ...Object.entries(r).filter(([k]) => !ORDER.includes(k))]);
function write(file, data) {
  const { items: its, ...head } = data;
  const lines = Object.keys(its).map((id) => `  ${JSON.stringify(id)}: {\n` +
    Object.keys(its[id]).map((s) => `   ${JSON.stringify(s)}: ${JSON.stringify(tidy(its[id][s]))}`).join(',\n') + '\n  }');
  fs.writeFileSync(file, `{\n${Object.keys(head).map((k) => ` ${JSON.stringify(k)}: ${JSON.stringify(head[k])}`).join(',\n')},\n "items": {\n${lines.join(',\n')}\n }\n}\n`);
}

// the step summary: each product cheapest first
const lines = [`### Price compare (${mode})`, '', `${read} of ${tried} pages read in ${Math.round((Date.now() - started) / 60000)} min.`];
for (const item of list.items) {
  const rows = Object.entries(keep[item.id] || {}).filter(([, r]) => r.price != null)
    .map(([sid, r]) => ({ store: list.stores.find((s) => s.id === sid), r })).sort((a, b) => a.r.price - b.r.price);
  if (!rows.length) continue;
  lines.push('', `**${item.name}**`, '', '| | Store | Price | How | |', '|---|---|---|---|---|');
  rows.forEach(({ store, r }, i) => {
    const res = results[item.id + '/' + store.id];
    lines.push(`| ${i + 1} | ${store.name} | ${money(r.price)} | ${res ? (res.ok ? res.how + (res.sure === false ? ', VAT assumed' : '') : 'not read today') : ''} | ${r.fail ? 'last read before ' + r.fail.since.slice(0, 10) : ''} |`);
  });
}
if (changes.length) lines.push('', 'Changed: ' + changes.join('; '));
if (fresh.length) lines.push('', 'First prices: ' + fresh.join('; '));
if (fails.length) lines.push('', 'Not read:', ...fails.map((f) => '- ' + f));
summary(lines);
for (const f of fails) console.log(`::warning title=Not read::${f.replace(/%/g, '%25').replace(/\n/g, ' ')}`);

if (saving) {
  fs.mkdirSync(DIR, { recursive: true });
  write(FILE, out);
  const bits = [...changes, ...fresh.map((f) => f + ' (first price)')];
  const title = bits.length ? 'Price compare: ' + bits.slice(0, 3).join(', ') + (bits.length > 3 ? ' and ' + (bits.length - 3) + ' more' : '')
    : `Price compare checked, no changes (${read} of ${tried} read)`;
  if (TEMP) fs.writeFileSync(path.join(TEMP, 'compare-commit.txt'), title + '\n');
  console.log('Saved: ' + title);
} else {
  console.log(`${mode === 'test' ? 'Smoke test' : 'Run'}: nothing saved.`);
}

if (tried && !read) {
  console.log(`::error title=Price compare::Couldn't read any of the ${tried} pages (${fails[0] || ''})`);
  process.exit(1);
}
