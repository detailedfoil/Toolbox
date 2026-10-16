// One-off: the live counter trial page in a real Chrome, against the real relays. Runs a device check on a few
// tickets and saves what happened, plus the page's own error report, to diag/.
import fs from 'node:fs';
import { chromium } from 'playwright-core';
const SITE = 'https://detailedfoil.github.io/Toolbox/';
const WANT = process.env.WANT_V || '20261016d';
const CODES = (process.env.CODES || '842CF,318FX,480PG,455HH,950CH,404RR,1402X,813AW').split(',');
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
fs.mkdirSync('diag', { recursive: true });
const out = { at: new Date().toISOString(), codes: CODES, events: [] };

// wait until the site serves the new version
for (let i = 0; i < 30; i++) {
  const h = await (await fetch(SITE + 'tools/counter-trial.html?t=' + Date.now())).text();
  if (h.includes('app.js?v=' + WANT)) { out.live = true; break; }
  await sleep(10000);
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 1400 }, userAgent:
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://detailedfoil.github.io' });
const page = await ctx.newPage();
page.on('pageerror', (e) => out.events.push('pageerror ' + e.message));
page.on('requestfailed', (r) => { if (/jina|codetabs|cors|allorigins/.test(r.url())) out.events.push('requestfailed ' + r.url().slice(0, 90) + ' ' + (r.failure() || {}).errorText); });
await page.goto(SITE + 'index.html');
await page.evaluate((codes) => {
  localStorage.clear();
  localStorage.setItem('toolbox.signedIn.area20', 'LB1');
  localStorage.setItem('ct-phone-run-v2', JSON.stringify({ started: new Date().toISOString(), total: codes.length, got: 0, fails: 0, failed: [], retry: true, codes }));
}, CODES);
await page.goto(SITE + 'tools/counter-trial.html');
await page.waitForSelector('#phoneRun', { state: 'visible' });
await sleep(2000);
out.button = await page.innerText('#phoneLabel');
await page.click('#phoneRun');
const t0 = Date.now();
const notes = [];
while (Date.now() - t0 < 8 * 60000) {
  await sleep(3000);
  if (await page.isVisible('#prog')) notes.push(Math.round((Date.now() - t0) / 1000) + 's ' + (await page.innerText('#progText')) + ' | ' + (await page.innerText('#progNote')).replace(/\n/g, ' / '));
  else break;
}
out.notes = notes;
out.toast = await page.innerText('#toastMsg');
out.todo = await page.$$eval('#todoList li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
out.missed = await page.$$eval('#missList li', (els) => els.slice(0, 12).map((e) => e.innerText.replace(/\s+/g, ' ') + ' | box=' + e.querySelector('input').value));
await page.click('#reportLink');
await sleep(500);
await page.click('#ctRepCopy');
await sleep(500);
const report = await page.evaluate(() => navigator.clipboard.readText());
await page.screenshot({ path: 'diag/e2e.png', fullPage: false });
fs.writeFileSync('diag/e2e-report.txt', report);
fs.writeFileSync('diag/e2e.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
console.log(report);
await browser.close();
