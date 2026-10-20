// A pretend jina (r.jina.ai) and screwfix.com for the tests. It serves made-up product pages, so the
// GitHub price checks and the page reader can be run start to finish without touching the real sites.
//
// Each product code gets a list of answers for each way it can be asked:
//   text   jina's normal (markdown) read of the product page
//   html   jina's whole page (asked with X-Return-Format: html)
//   direct straight to screwfix.com (the checks' fallback when jina fails)
// An answer is a page (a string), {status, body}, or 'reset' (no answer at all). They're used in
// order and the last one keeps being used, so ['429', page] is "rate limited once, then fine".
import http from 'node:http';

const pounds = (v) => '£' + v.toFixed(2);

/* jina's text answer for a product page */
export function textPage({ code, name, price, was }) {
  return `Title: ${name} (${code}) | Screwfix.com\n\nURL Source: https://www.screwfix.com/p/${code.toLowerCase()}\n\n` +
    `Markdown Content:\n# ${name} (${code})\n\n${pounds(price)} Inc Vat` + (was ? ` Was ${pounds(was)}` : '') +
    `\n\n${pounds(price / 1.2)} Ex Vat\n\nAdd to basket\n`;
}

/* the whole product page, with the product data (JSON-LD) Screwfix builds into it */
export function wholePage({ code, name, price, ldCode = code, ldPrice = price }) {
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name, sku: ldCode,
    offers: { '@type': 'Offer', price: ldPrice.toFixed(2), priceCurrency: 'GBP' } });
  return `<!doctype html><html><head><title>${name} (${code}) | Screwfix.com</title>` +
    `<script type="application/ld+json">${ld}</script></head><body><h1>${name} (${code})</h1>` +
    `<div><span>${pounds(price)}</span> <span>Inc Vat</span></div></body></html>`;
}

export const NOT_FOUND = 'Title: 404 | Screwfix.com\n\nURL Source: https://www.screwfix.com/p/product/x\n\n' +
  'Warning: Target URL returned error 404: Not Found\n\nMarkdown Content:\nSorry, we couldn\'t find that page\n';
export const BOT_CHECK = 'Title: Just a moment...\n\nURL Source: https://www.screwfix.com/p/product/x\n\nMarkdown Content:\nChecking your browser\n';
/* a tiny made-up JPEG: the right first bytes, then filler */
export const PICTURE = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 7)]);
export const LIMITED = { status: 429, body: '{"data":null,"code":429,"name":"RateLimitTriggeredError","retryAfter":7,"readableMessage":"Too many requests"}' };

/* -> Promise<{port, hits, close()}>. hits: every request, as {code, mode}. */
export function startMock(scenarios) {
  const queues = {}, hits = [];
  const next = (code, mode) => {
    const key = code + ' ' + mode;
    if (!queues[key]) queues[key] = [...(((scenarios[code] || {})[mode]) || [])];
    const q = queues[key];
    return q.length > 1 ? q.shift() : q[0];
  };
  const server = http.createServer((req, res) => {
    // Screwfix's image server (media.screwfix.com/is/image/ae235/<CODE>_P): scenarios[code].image is a list of
    // answers like the others: a Buffer (a picture), {status, body}, or 'reset'. Nothing set up = 404.
    const im = /^\/media\/is\/image\/ae235\/([A-Z0-9]+)_P/i.exec(req.url);
    if (im) {
      const icode = im[1].toUpperCase();
      hits.push({ code: icode, mode: 'image' });
      let b = next(icode, 'image');
      if (b === undefined) b = { status: 404, body: 'none' };
      if (b === 'reset') { req.socket.destroy(); return; }
      if (Buffer.isBuffer(b)) b = { status: 200, body: b, type: 'image/jpeg' };
      res.writeHead(b.status, { 'content-type': b.type || 'text/html; charset=utf-8' });
      res.end(b.body);
      return;
    }
    const m = /\/p\/product\/([a-z0-9]+)$/i.exec(req.url);
    const code = m ? m[1].toUpperCase() : '?';
    const mode = req.url.startsWith('/direct/') ? 'direct' : req.headers['x-return-format'] === 'html' ? 'html' : 'text';
    hits.push({ code, mode });
    let a = next(code, mode);
    if (a === undefined) a = mode === 'text' ? NOT_FOUND : { status: 500, body: 'no answer set up for this' };
    if (a === 'reset') { req.socket.destroy(); return; }
    if (typeof a === 'string') a = { status: 200, body: a };
    res.writeHead(a.status, { 'content-type': mode === 'text' && a.status === 200 ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8' });
    res.end(a.body);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => {
    ok({ port: server.address().port, hits, close: () => new Promise((done) => server.close(done)) });
  }));
}
