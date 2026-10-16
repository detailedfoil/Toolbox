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

for (const hdrs of ['x-engine,x-return-format']) {
  const t0 = Date.now();
  try {
    const r = await fetch('https://r.jina.ai/' + SL.productUrl('480PG'), { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': hdrs, 'User-Agent': UA } });
    out.preflight[hdrs] = { http: r.status, allowHeaders: r.headers.get('access-control-allow-headers'), allowOrigin: r.headers.get('access-control-allow-origin'), ms: Date.now() - t0 };
  } catch (e) { out.preflight[hdrs] = { error: String(e.message) }; }
  await sleep(1500);
}

const codes = ['842CF', '318FX', '480PG'];
const VARIANTS = [
  ['plain', {}],
  ['html', { 'X-Return-Format': 'html' }],
  ['html+nocache', { 'X-Return-Format': 'html', 'X-No-Cache': 'true' }],
  ['html+browser', { 'X-Return-Format': 'html', 'X-Engine': 'browser' }],
  ['html+browser+nocache', { 'X-Return-Format': 'html', 'X-Engine': 'browser', 'X-No-Cache': 'true' }],
  ['html+direct', { 'X-Return-Format': 'html', 'X-Engine': 'direct' }]
];
for (let round = 0; round < 2; round++) {
  for (const [label, headers] of VARIANTS) {
    for (const code of codes) {
      const t0 = Date.now(); const rec = { label: label + ' #' + round, code };
      try {
        const res = await fetch('https://r.jina.ai/' + SL.productUrl(code), { headers: { Origin: ORIGIN, 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(40000) });
        const text = await res.text();
        rec.http = res.status; rec.len = text.length; rec.ms = Date.now() - t0;
        const r = JSON.parse(JSON.stringify(SL.interpret({ status: res.status, text }, code)));
        rec.status = r.status; rec.why = r.why; rec.price = r.price; rec.ldSure = r.ldSure;
      } catch (e) { rec.error = String(e.message).slice(0, 120); rec.ms = Date.now() - t0; }
      out.runs.push(rec);
      console.log(rec.label, code, rec.http, rec.len, rec.ms, rec.status, rec.price, rec.ldSure, rec.error || '');
      await sleep(3200);
    }
  }
}
fs.mkdirSync('diag', { recursive: true });
fs.writeFileSync('diag/out4.json', JSON.stringify(out, null, 1));
