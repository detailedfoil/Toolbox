// One-off: does what the device check now sends to jina work the way a real browser sends it?
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const dom = new JSDOM('<!doctype html><title>p</title>', { url: 'https://detailedfoil.github.io/Toolbox/', runScripts: 'outside-only' });
dom.window.eval(fs.readFileSync('tools/price-tickets/lookup.js', 'utf8'));
const SL = dom.window.ScrewfixLookup;
const ORIGIN = 'https://detailedfoil.github.io';
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const out = { at: new Date().toISOString(), preflight: {}, runs: [] };

for (const hdrs of ['x-no-cache,x-return-format', 'x-return-format', 'x-no-cache']) {
  const t0 = Date.now();
  try {
    const r = await fetch('https://r.jina.ai/' + SL.productUrl('480PG'), { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': hdrs, 'User-Agent': UA } });
    out.preflight[hdrs] = { http: r.status, allowHeaders: r.headers.get('access-control-allow-headers'), allowOrigin: r.headers.get('access-control-allow-origin'), ms: Date.now() - t0 };
  } catch (e) { out.preflight[hdrs] = { error: String(e.message) }; }
  await sleep(1500);
}

const codes = ['842CF', '318FX', '480PG', '132KH', '843PG', '872RE', '100AB', '200CD'];
for (const [label, headers] of [['full (what the device check sends now)', { 'X-Return-Format': 'html', 'X-No-Cache': 'true' }], ['plain (what Price Tickets sends)', {}]]) {
  for (const code of codes) {
    const t0 = Date.now(); const rec = { label, code };
    try {
      const res = await fetch('https://r.jina.ai/' + SL.productUrl(code), { headers: { Origin: ORIGIN, 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(30000) });
      const text = await res.text();
      rec.http = res.status; rec.len = text.length; rec.ms = Date.now() - t0;
      rec.remaining = res.headers.get('x-ratelimit-remaining');
      const r = JSON.parse(JSON.stringify(SL.interpret({ status: res.status, text }, code)));
      rec.status = r.status; rec.why = r.why; rec.price = r.price; rec.ld = r.ld; rec.ldSure = r.ldSure; rec.unsure = r.unsure;
      if (r.status !== 'found') rec.head = text.slice(0, 200);
    } catch (e) { rec.error = String(e.message).slice(0, 120); rec.ms = Date.now() - t0; }
    out.runs.push(rec);
    console.log(label.slice(0, 5), code, rec.http, rec.ms, rec.status, rec.price, rec.ldSure, rec.error || '');
    await sleep(3000);
  }
}
fs.writeFileSync('diag/out3.json', JSON.stringify(out, null, 1));
