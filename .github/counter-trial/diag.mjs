// One-off look at why some codes can't be read (round 2): can the one relay that works send the page's
// product data, does it allow that from the browser, what does its text look like around the price,
// and do any other free relays work. Saves to diag/out2.json.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const dom = new JSDOM('<!doctype html><title>parser</title>', { url: 'https://detailedfoil.github.io/Toolbox/', runScripts: 'outside-only' });
dom.window.eval(fs.readFileSync('tools/price-tickets/lookup.js', 'utf8'));
const SL = dom.window.ScrewfixLookup;
const ORIGIN = 'https://detailedfoil.github.io';
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

function ldBlocks(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) out.push(m[1].trim().slice(0, 600));
  return out;
}
const pick = (h) => Object.fromEntries([...h.entries()].filter(([k]) => /^access-control|^content-type|^x-|^retry|^cf-/i.test(k)));

async function get(url, headers = {}, method = 'GET') {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method, headers: { 'User-Agent': UA, Origin: ORIGIN, ...headers }, redirect: 'follow', signal: AbortSignal.timeout(45000) });
    const text = method === 'OPTIONS' ? '' : await res.text();
    return { http: res.status, ms: Date.now() - t0, len: text.length, headers: pick(res.headers), text };
  } catch (e) {
    return { error: String((e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || e).slice(0, 200), ms: Date.now() - t0 };
  }
}
function judge(r, code) {
  if (!r.text) return r;
  const out = { ...r, ld: ldBlocks(r.text).length };
  try { const x = JSON.parse(JSON.stringify(SL.interpret({ status: r.http, text: r.text }, code))); delete x.images; out.result = x; } catch (e) { out.result = 'threw ' + e.message; }
  out.head = r.text.slice(0, 300);
  delete out.text;
  return out;
}

const out = { at: new Date().toISOString(), jinaText: {}, jinaHtml: {}, preflight: {}, relays: {} };
const page = (c) => SL.productUrl(c);

// 1. the text the working relay sends, from the heading to well past the price
for (const code of ['480PG', '842CF', '318FX', '132KH']) {
  const r = await get('https://r.jina.ai/' + page(code));
  const t = r.text || '';
  const at = t.search(new RegExp('^#\\s.*\\(' + code + '\\)', 'mi'));
  out.jinaText[code] = { http: r.http, headers: r.headers, len: t.length, fromHeading: at >= 0 ? t.slice(at, at + 2500) : null, error: r.error };
  await sleep(3500);
}

// 2. the same relay asked for the page itself (with its product data)
for (const [label, h] of [['X-Return-Format: html', { 'X-Return-Format': 'html' }], ['X-Respond-With: html', { 'X-Respond-With': 'html' }],
                          ['X-Return-Format: html + X-No-Cache', { 'X-Return-Format': 'html', 'X-No-Cache': 'true' }]]) {
  out.jinaHtml[label] = judge(await get('https://r.jina.ai/' + page('480PG'), h), '480PG');
  await sleep(3500);
}
out.jinaHtml['842CF X-Return-Format: html'] = judge(await get('https://r.jina.ai/' + page('842CF'), { 'X-Return-Format': 'html' }), '842CF');
await sleep(3500);

// 3. would a browser be allowed to send that header? (CORS preflight)
for (const hdr of ['x-return-format', 'x-respond-with']) {
  out.preflight[hdr] = await get('https://r.jina.ai/' + page('480PG'), { 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': hdr }, 'OPTIONS');
  await sleep(1500);
}

// 4. other free relays
const enc = encodeURIComponent;
const RELAYS = {
  'codetabs': (u) => 'https://api.codetabs.com/v1/proxy?quest=' + enc(u),
  'cors.lol': (u) => 'https://api.cors.lol/?url=' + enc(u),
  'allorigins raw': (u) => 'https://api.allorigins.win/raw?url=' + enc(u),
  'allorigins get': (u) => 'https://api.allorigins.win/get?url=' + enc(u),
  'corsproxy.io': (u) => 'https://corsproxy.io/?url=' + enc(u),
  'corsfix': (u) => 'https://proxy.corsfix.com/?' + u,
  'everyorigin': (u) => 'https://everyorigin.jwvbremen.nl/get?url=' + enc(u),
  'whateverorigin': (u) => 'https://whateverorigin.org/get?url=' + enc(u),
  'thingproxy': (u) => 'https://thingproxy.freeboard.io/fetch/' + u,
  'cors.eu.org': (u) => 'https://cors.eu.org/' + u,
  'cors.x2u.in': (u) => 'https://cors.x2u.in/' + u,
  'corsproxy.org': (u) => 'https://corsproxy.org/?' + enc(u),
  'htmldriven': (u) => 'https://cors-proxy.htmldriven.com/?url=' + enc(u),
  'cors-anywhere': (u) => 'https://cors-anywhere.herokuapp.com/' + u,
  'gobetween': (u) => 'https://gobetween.oklabs.org/' + u,
  'crossorigin.me': (u) => 'https://crossorigin.me/' + u,
  'cloudflare-cors-anywhere': (u) => 'https://test.cors.workers.dev/?' + u
};
for (const [id, build] of Object.entries(RELAYS)) {
  const r = judge(await get(build(page('842CF'))), '842CF');
  out.relays[id] = r;
  console.log(id, r.http, r.len, r.ld, r.result && r.result.status, r.result && r.result.price, r.result && r.result.ldSure, r.error || '');
  await sleep(2500);
}

fs.mkdirSync('diag', { recursive: true });
fs.writeFileSync('diag/out2.json', JSON.stringify(out, null, 1));
