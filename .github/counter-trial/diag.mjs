// One-off look at why some codes can't be read: fetches each product page directly and through each relay
// the device check uses, runs the same reader on it, and saves what it saw to diag/out.json.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const CODES = (process.env.CODES || '842CF,318FX,480PG,132KH').split(',');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const dom = new JSDOM('<!doctype html><title>parser</title>', { url: 'https://detailedfoil.github.io/Toolbox/', runScripts: 'outside-only' });
dom.window.eval(fs.readFileSync('tools/price-tickets/lookup.js', 'utf8'));
const SL = dom.window.ScrewfixLookup;

const RELAYS = {
  direct: (u) => u,
  codetabs: (u) => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u),
  'cors.lol': (u) => 'https://api.cors.lol/?url=' + encodeURIComponent(u),
  allorigins: (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
  jina: (u) => 'https://r.jina.ai/' + u,
  corsproxy: (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u)
};
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9'
};

function ldBlocks(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) out.push(m[1].trim().slice(0, 4000));
  return out;
}
function around(text, re, n = 400) {
  const m = re.exec(text);
  return m ? text.slice(Math.max(0, m.index - n), m.index + n) : null;
}
function strip(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

const out = { at: new Date().toISOString(), codes: {} };
for (const code of CODES) {
  const url = SL.productUrl(code);
  out.codes[code] = {};
  for (const [via, build] of Object.entries(RELAYS)) {
    const rec = {};
    const t0 = Date.now();
    try {
      const res = await fetch(build(url), { headers: via === 'direct' ? HEADERS : { 'User-Agent': HEADERS['User-Agent'] }, redirect: 'follow', signal: AbortSignal.timeout(40000) });
      const text = await res.text();
      rec.http = res.status;
      rec.finalUrl = res.url;
      rec.len = text.length;
      rec.ms = Date.now() - t0;
      rec.ld = ldBlocks(text);
      const r = JSON.parse(JSON.stringify(SL.interpret({ status: res.status, text }, code)));
      delete r.images;
      rec.result = r;
      const plain = /<html|<body|<div/i.test(text.slice(0, 50000)) ? strip(text) : text;
      rec.title = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || (text.match(/^Title:\s*(.+)$/m) || [])[1] || null;
      rec.h1 = (text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || null;
      rec.nearPrice = around(plain, /(inc\.?\s*vat|0\s*%\s*vat)/i, 300);
      rec.nearCode = around(plain, new RegExp('\\(\\s*' + code + '\\s*\\)', 'i'), 300);
      rec.head = text.slice(0, 600);
      // anything in the HTML that carries a price for this product (data attributes, inline JSON)
      if (via === 'direct' || via === 'codetabs') {
        rec.priceBits = [...text.matchAll(/"(?:price|priceIncVat|sellPrice|currentPrice|unitPrice)"\s*:\s*"?([\d.]+)"?/gi)].slice(0, 12).map((m) => text.slice(Math.max(0, m.index - 120), m.index + 60));
        rec.skuBits = [...text.matchAll(/"sku"\s*:\s*"([^"]+)"/gi)].slice(0, 8).map((m) => m[1]);
      }
    } catch (e) {
      rec.error = String((e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || e).slice(0, 200);
      rec.ms = Date.now() - t0;
    }
    out.codes[code][via] = rec;
    console.log(code, via, rec.http, rec.len, rec.result && rec.result.status, rec.result && rec.result.price, rec.result && rec.result.ld, rec.result && rec.result.ldSure, rec.error || '');
    await sleep(via === 'direct' ? 8000 : 2500);
  }
}
fs.mkdirSync('diag', { recursive: true });
fs.writeFileSync('diag/out.json', JSON.stringify(out, null, 1));
