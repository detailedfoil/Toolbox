// One-off (round 5): does jina's whole-page mode work for a product nobody has fetched lately,
// or only once jina has the page cached from its normal text mode?
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
const out = { at: new Date().toISOString(), runs: [] };
const MODES = { html: { 'X-Return-Format': 'html' }, plain: {} };
const PLAN = [
  ['455HH', ['html', 'plain', 'html']], ['67928', ['html', 'plain', 'html']], ['950CH', ['html', 'plain', 'html']],
  ['44241', ['plain', 'html', 'plain']], ['636LF', ['plain', 'html', 'plain']], ['614LF', ['plain', 'html', 'plain']]
];
for (const [code, modes] of PLAN) {
  for (const mode of modes) {
    const t0 = Date.now(); const rec = { code, mode };
    try {
      const res = await fetch('https://r.jina.ai/' + SL.productUrl(code), { headers: { Origin: ORIGIN, 'User-Agent': UA, ...MODES[mode] }, signal: AbortSignal.timeout(45000) });
      const text = await res.text();
      rec.http = res.status; rec.len = text.length; rec.ms = Date.now() - t0;
      rec.remaining = res.headers.get('x-ratelimit-remaining');
      const r = JSON.parse(JSON.stringify(SL.interpret({ status: res.status, text }, code)));
      rec.status = r.status; rec.why = r.why; rec.price = r.price; rec.ldSure = r.ldSure; rec.name = (r.name || '').slice(0, 40);
      if (r.status !== 'found') rec.head = text.slice(0, 240).replace(/\s+/g, ' ');
    } catch (e) { rec.error = String(e.message).slice(0, 120); rec.ms = Date.now() - t0; }
    out.runs.push(rec);
    console.log(code, mode, rec.http, rec.len, rec.ms, rec.status, rec.price, rec.ldSure, rec.error || '');
    await sleep(3300);
  }
}
fs.mkdirSync('diag', { recursive: true });
fs.writeFileSync('diag/out5.json', JSON.stringify(out, null, 1));
