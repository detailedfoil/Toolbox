// Price Compare: reading a store's price out of its page (tools/price-compare/read.js, shared by the page and the
// GitHub check), the store and product list (data/compare.json), and the GitHub check start to finish against a
// pretend jina and pretend stores. The page layouts are as the stores showed them on 26 Oct 2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REPO } from './load.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sandbox = {};
vm.runInNewContext(fs.readFileSync(path.join(REPO, 'tools/price-compare/read.js'), 'utf8'), sandbox);
const R = sandbox.PriceRead;
const LIST = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/price-compare/data/compare.json'), 'utf8'));
const JOBS = R.jobs(LIST);
const job = (key) => JOBS.find((j) => j.key === key) || assert.fail('no job ' + key);
const plain = (x) => JSON.parse(JSON.stringify(x));
const page = (title, body) => `Title: ${title}\n\nURL Source: https://example.com/p\n\nMarkdown Content:\n[Skip to content](#main)\n\nFree delivery on orders over £50\n\n${body}\n\nSome words about the product, so the page is the size a real one is.\n`;
const price = (r) => (r.ok ? r.price : r.why);

/* ---------- reading the text jina sends back ---------- */

// trimmed copies of the real pages as jina sent them on 26 Oct 2026 (fixtures/compare-<store>-<item>.txt)
test('price compare: reads the real store pages, each one the price including VAT', () => {
  const real = (f) => fs.readFileSync(path.join(HERE, 'fixtures', 'compare-' + f + '.txt'), 'utf8');
  const want = {
    'screwfix-cu15': 15.6, 'screwfix-cu22': 31.31, 'toolstation-cu15': 15.6, 'wickes-cu15': 16, 'bq-cu15': 15.6,
    'travisperkins-cu15': 17.24,       // "Retail price £17.24 per length £14.37 ex. vat", under the reviews heading
    'cityplumbing-cu15': 15.59,        // the price is a heading of its own ("## £15.59"), its Inc. VAT label lines later
    'selco-cu15': 14.4,                // "£12.00 Ex VAT£4.00 per m£14.40 Inc VAT"
    'builderdepot-cu15': 14.1,         // jina warns of a 403, but the real page is under it
    'bes-cu15': 17.66, 'bes-cu22': 35.3 // the price sits above the heading, after a bulk price ("20+£15.37£12.81")
  };
  for (const [f, v] of Object.entries(want)) {
    const [store, item] = f.split('-');
    const r = R.text(real(f), job(item + '/' + store));
    assert.equal(r.ok ? r.price : r.why, v, f);
  }
  // Jewson shows a price only once a branch is picked: its delivery thresholds (orders over £150, between £100-£150) aren't it
  assert.equal(R.text(real('jewson-cu15'), job('cu15/jewson')).why, 'no price on the page');
});

test('price compare: reads each store layout, and the price with VAT whichever way round the page shows it', () => {
  // Screwfix: "£13.88Inc Vat"
  assert.equal(price(R.text(page('Wednesbury Copper Pipe 15mm x 3m (98683) | Screwfix.com', '# Wednesbury Copper Pipe 15mm x 3m (98683)\n\n£13.88Inc Vat\n\n£11.57Ex Vat'), job('cu15/screwfix'))), 13.88);
  // Toolstation: the price, then "ex. VAT" labelling the price without VAT after it
  assert.equal(price(R.text(page('Wednesbury Copper Pipe 22mm x 3m', '# Wednesbury Copper Pipe 22mm x 3m\n\n£31.31ex. VAT £26.09\n\nPay in 3 interest-free payments of £10.44'), job('cu22/toolstation'))), 31.31);
  // Selco: without VAT first, a per metre price, then with VAT
  assert.equal(price(R.text(page('Copper Pipe 22mm x 3m', '# Copper Pipe 22mm x 3m\n\nItem Code: 344680041\n\n£24.37Ex VAT\n\n£8.12 per m\n\n£29.24 Inc VAT'), job('cu22/selco'))), 29.24);
  // City Plumbing: labelled, then per metre and a bulk table
  assert.equal(price(R.text(page('x', '# Wednesbury Plain Copper Tube Length 15mm x 3m X015L-3\n\n£15.59 per length, Inc. VAT\n\n£5.20 per metre, Inc. VAT\n\n| 1-9 | £15.59 |\n| 10+ | £15.12 |'), job('cu15/cityplumbing'))), 15.59);
  // BES and Build Depot: two bare prices, with and without VAT
  assert.equal(price(R.text(page('x', '# Copper Tube - 15mm x 3m\n\n£17.66 £14.72\n\nBuy 20+ for £15.37 £12.81'), job('cu15/bes'))), 17.66);
  assert.equal(price(R.text(page('x', '# Copper Tube 22mm x 3m\n\n£29.34 £35.21'), job('cu22/builderdepot'))), 35.21, 'the bigger one includes VAT, whichever comes first');
  // B&Q: one bare price, taken as including VAT
  const bq = R.text(page('Wednesbury Copper Compression Pipe (L)3m (Dia)15mm | B&Q', '# Wednesbury Copper Compression Pipe (L)3m (Dia)15mm\n\n![photo](x.jpg)\n\n£15.60\n\n£5.20 per m'), job('cu15/bq'));
  assert.deepEqual([bq.price, bq.sure, bq.name], [15.6, false, 'Wednesbury Copper Compression Pipe (L)3m (Dia)15mm']);
});

test('price compare: a heading in the page title only, links and pictures in the text, and a price labelled after a colon', () => {
  assert.equal(price(R.text(page('Copper Tube 15mm x 3m | Builder Depot', '[Copper Tube 15mm x 3m](https://x)\n\nInc VAT: £17.62\n\nEx VAT: £14.68'), job('cu15/builderdepot'))), 17.62);
  assert.equal(price(R.text(page('x', 'Plain Copper Tube 15mm x 3mtr\n=====\n\n**£12.00** Ex VAT'), job('cu15/graham'))), 14.4, 'a price only shown without VAT gets VAT added');
});

test('price compare: was prices, savings, finance, delivery and per metre prices are never the price', () => {
  const sale = R.text(page('x', '# Wednesbury Copper Pipe - 22mm x 3m\n\n~~£33.00~~ £29.50\n\nSave £3.50'), job('cu22/wickes'));
  assert.deepEqual([sale.price, sale.was], [29.5, 33]);
  const was = R.text(page('x', '# Wednesbury Copper Pipe - 22mm x 3m\n\nWas £33.00 Now £29.50 Inc VAT'), job('cu22/wickes'));
  assert.deepEqual([was.price, was.was], [29.5, 33]);
  assert.equal(price(R.text(page('x', '# Copper Pipe 15mm x 3m\n\nPay £5.00 a month with Klarna\n\n£5.00 per m\n\n£14.40 Inc VAT'), job('cu15/selco'))), 14.4);
  assert.equal(price(R.text(page('x', '# Copper Pipe 15mm x 3m\n\nSpend £75 for free delivery\n\n£14.40\n\n£12.00'), job('cu15/selco'))), 14.4);
});

test("price compare: another size, length or pack, a price that isn't believable, or no price, is never read as this product", () => {
  assert.match(price(R.text(page('x', '# Wednesbury Copper Pipe 22mm x 3m 10 Pack\n\n£304.99'), job('cu22/toolstation'))), /different product/);
  assert.match(price(R.text(page('x', '# Wednesbury Copper Pipe 15mm x 2m\n\n£10.24'), job('cu15/toolstation'))), /different length/);
  assert.match(price(R.text(page('Wednesbury Copper Pipe 22mm x 3m', '# Wednesbury Copper Pipe 22mm x 3m\n\n£31.31'), job('cu15/toolstation'))), /different product/, 'a 22mm page where 15mm is wanted');
  assert.match(price(R.text(page('x', '# Chrome Plated Copper Pipe 15mm x 3m\n\n£19.99'), job('cu15/toolstation'))), /different product/);
  assert.match(price(R.text(page('x', '# Copper Pipe 15mm x 3m\n\n£1.39 Inc VAT'), job('cu15/selco'))), /£1\.39 doesn't look like/);
  assert.match(price(R.text(page('x', '# Copper Pipe 15mm x 3m\n\n£139.00 Inc VAT'), job('cu15/selco'))), /£139\.00 doesn't look like/);
  // Jewson: no price until a branch is picked. The chrome tube under "You may also like" isn't this one's price
  assert.equal(price(R.text(page('x', '# Wednesbury Table Plain Copper Tube 3m x 15mm\n\nSee price and availability\n\n## You may also like\n\n# Copper Tube 15mm x 3m\n\n£19.99'), job('cu15/jewson'))), 'no price on the page');
  // past the product's own block, a price only counts when it says what it is
  assert.equal(price(R.text(page('x', '# Wednesbury Table Plain Copper Tube 3m x 15mm\n\nSee price and availability\n\n## Delivery\n\nNext day for £12.99'), job('cu15/jewson'))), 'no price on the page');
  assert.equal(price(R.text(page('x', '# Copper Pipe 15mm x 3m\n\n## Price\n\n£14.40 Inc VAT'), job('cu15/selco'))), 14.4);
});

test("price compare: the store's bot check, an error page and a page that's gone are told apart", () => {
  // jina's error warning over a real, whole page (Builder Depot) is read as the page
  const long = 'Words about this copper pipe and how good it is for plumbing jobs. '.repeat(60);
  assert.equal(price(R.text('Title: Copper Tube 15mm x 3m\n\nURL Source: x\n\nWarning: Target URL returned error 403: Forbidden\n\nMarkdown Content:\n# Copper Tube 15mm x 3m\n\n£14.10 Inc VAT\n\n' + long, job('cu15/builderdepot'))), 14.1);
  const bot = R.text('Title: Just a moment...\n\nURL Source: x\n\nMarkdown Content:\nChecking your browser before accessing the site, this takes a few seconds.', job('cu15/wickes'));
  assert.deepEqual(plain([bot.ok, bot.why, bot.gone]), [false, "the store's bot check", false]);
  const gone = R.text('Title: \n\nURL Source: x\n\nWarning: Target URL returned error 404: Not Found\n\nMarkdown Content:\nThe page you were looking for has gone.', job('cu15/wickes'));
  assert.deepEqual(plain([gone.why, gone.gone]), ['the store says the page has gone (404)', true]);
  assert.match(R.text('Warning: Target URL returned error 503: Service Unavailable\n\nMarkdown Content:\nBack soon, we are down for maintenance right now.', job('cu15/wickes')).why, /error 503/);
});

/* ---------- reading a whole page ---------- */

const ldPage = (name, price, extra = {}) => `<!doctype html><html><head><title>${name} | Store</title>` +
  `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name, sku: 'X1', offers: { '@type': 'Offer', price: String(price), priceCurrency: 'GBP', ...extra } })}</script>` +
  `<script src="https://www.google.com/recaptcha/api.js"></script></head><body><h1>${name}</h1><p>Lots of words about the product here.</p></body></html>`;

test('price compare: a whole page gives its product data, with VAT added when the data says it has none', () => {
  const a = R.html(ldPage('Wednesbury Copper Pipe 15mm x 3m', 13.88), job('cu15/screwfix'));
  assert.deepEqual(plain([a.ok, a.price, a.how]), [true, 13.88, 'data'], 'a reCAPTCHA script in the head is not a bot check');
  const ex = R.html(ldPage('Wednesbury Copper Tube Plain Lengths 22mm x 3m', 26.07, { priceSpecification: { '@type': 'UnitPriceSpecification', price: 26.07, valueAddedTaxIncluded: false } }), job('cu22/travisperkins'));
  assert.equal(ex.price, 31.28);
  assert.match(price(R.html(ldPage('Wednesbury Copper Pipe 22mm x 3m', 31.31), job('cu15/toolstation'))), /different product/);
  const meta = '<html><head><title>Copper Pipe 15mm x 3m</title><meta property="product:price:amount" content="14.40"></head><body><h1>Copper Pipe 15mm x 3m</h1><p>words words words words words words words words</p></body></html>';
  assert.equal(price(R.html(meta, job('cu15/selco'))), 14.4);
  // no product data: the page's own text, as for a page fetched straight from the store
  const bare = '<html><head><title>Copper Tube 22mm x 3m | Builder Depot</title><style>.x{}</style></head><body><nav>Basket £0.00</nav><h1>Copper Tube 22mm x 3m</h1><div class="price"><span>£35.21</span> <span>£29.34</span></div></body></html>';
  const b = R.html(bare, job('cu22/builderdepot'));
  assert.deepEqual(plain([b.price, b.how]), [35.21, 'page']);
  // Selco: a second copy of its data without a product code, priced without VAT, isn't the one
  const two = '<html><head><title>Copper Pipe 15mm x 3m</title>' +
    `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Copper Pipe 15mm x 3m', offers: { price: 12 } })}</script>` +
    `<script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name: 'Copper Pipe 15mm x 3m', sku: '344680001', offers: { price: '14.40' } })}</script></head><body><h1>Copper Pipe 15mm x 3m</h1></body></html>`;
  const sel = R.html(two, job('cu15/selco'));
  assert.equal(sel.price, 14.4);
  // a price read from the text is backed up by the page's data, with or without VAT, and not by another number
  assert.equal(R.agrees(sel, 14.4), true);
  assert.equal(R.agrees(R.html(ldPage('Wednesbury Copper Tube Plain Lengths 15mm x 3m', 14.37), job('cu15/travisperkins')), 17.24), true, 'Travis Perkins data is without VAT');
  assert.equal(R.agrees(sel, 19.99), false);
  assert.equal(R.agrees(null, 14.4), false);
});

/* ---------- the list ---------- */

test('price compare: every product has an entry for every store, and every entry can be read or says why not', () => {
  const ids = LIST.stores.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'store ids are unique');
  assert.equal(LIST.stores.filter((s) => s.home).length, 1, 'one store is ours');
  assert.equal(new Set(LIST.items.map((i) => i.id)).size, LIST.items.length);
  for (const item of LIST.items) {
    assert.ok(LIST.groups.some((g) => g.id === item.group), item.id + ' is in a group');
    assert.ok(item.name && item.short && item.size && item.q && item.len > 0 && item.perM[0] < item.perM[1], item.id + ' has its names, length and price range');
    [...item.has, item.not].forEach((re) => new RegExp(re, 'i'));
    assert.deepEqual(Object.keys(item.at).sort(), [...ids].sort(), item.id + ' has an entry for every store');
    for (const [sid, e] of Object.entries(item.at)) {
      const store = LIST.stores.find((s) => s.id === sid);
      R.links(e).forEach((u) => assert.match(u, new RegExp('^https://(?:www\\.)?' + store.site.replace(/\./g, '\\.') + '/'), `${item.id}/${sid} links to ${store.site}`));
      assert.ok(R.links(e).length || e.none || store.none, `${item.id}/${sid} has a page or says why not`);
    }
  }
  const read = JOBS.filter((j) => j.urls.length && !j.none).map((j) => j.key);
  assert.ok(read.length >= 18, 'most stores are read');
  assert.ok(read.includes('cu15/screwfix') && read.includes('cu22/screwfix'));
  // the product names the stores use pass the name check (as seen 26 Oct 2026)
  for (const [key, name] of [['cu15/screwfix', 'Wednesbury Copper Pipe 15mm x 3m (98683)'], ['cu22/toolstation', 'Wednesbury Copper Pipe 22mm x 3m'],
    ['cu15/wickes', 'Wednesbury Copper Pipe - 15mm x 3m'], ['cu15/bq', 'Wednesbury Copper Compression Pipe (L)3m (Dia)15mm'],
    ['cu22/bq', 'Wednesbury Compression Copper Pipe (Dia)22mm (L)3m, Pack of 1'], ['cu15/travisperkins', 'Wednesbury Copper Tube Plain Lengths 15mm x 3m'],
    ['cu22/cityplumbing', 'Wednesbury Plain Copper Tube Length 22mm x 3m X022L-3'], ['cu15/selco', 'Copper Pipe 15mm x 3m'],
    ['cu15/builderdepot', 'COPPER TUBE/PIPE 15mm X 3000mm'], ['cu15/graham', 'Plain Copper Tube 15mm x 3mtr'], ['cu22/bes', 'Copper Tube - 22mm x 3m'],
    ['cu15/jewson', 'Wednesbury Table Plain Copper Tube 3m x 15mm'], ['cu15/wolseley', 'Yorkshire Copper Tube 15 mm, 3 M, X153']]) {
    assert.equal(R.nameOk(name, job(key)), '', key + ': ' + name);
  }
  for (const [key, name] of [['cu15/toolstation', 'Wednesbury Copper Pipe 15mm x 3m 10 Pack'], ['cu15/bq', 'Wednesbury Copper Tube (L)3m (Dia)15mm, Pack of 10'],
    ['cu15/screwfix', 'Wednesbury Copper Pipe 15mm x 2m'], ['cu22/screwfix', 'Wednesbury Copper Pipe 15mm x 3m'], ['cu15/wickes', 'Wednesbury Chrome Plated Copper Pipe - 15mm x 3m'],
    ['cu15/screwfix', 'Wednesbury Copper Pipe 15mm x 30m'], ['cu15/screwfix', 'Flomasta PE-X Pipe 15mm x 3m']]) {
    assert.notEqual(R.nameOk(name, job(key)), '', key + ': ' + name);
  }
  assert.equal(R.unitPrice(15, job('cu15/selco')), 5);
  assert.equal(R.unitPrice(150, { item: { len: 3 }, entry: { pack: 10 } }), 5);
});

/* ---------- the GitHub check, start to finish ---------- */

const STORES = [{ id: 'home', name: 'Home Store', site: 'home.example', home: true }, { id: 'tools', name: 'Tool Shop', site: 'tools.example' },
  { id: 'merch', name: 'Merchant', site: 'merch.example' }, { id: 'shy', name: 'Shy Store', site: 'shy.example', none: 'Prices for account holders only' }];
const CU = (size, perM) => ({ group: 'copper', name: size + ' copper pipe, 3m', short: size, size: size + ' x 3m', len: 3, q: size + ' copper pipe 3m', has: ['(?:^|[^\\d.])' + size.replace('mm', '\\s?mm\\b'), 'copper'], not: 'chrome|\\b\\d+\\s?pack', perM });
const SMALL = {
  stores: STORES, groups: [{ id: 'copper', name: 'Copper pipe' }],
  items: [
    { id: 'cu15', ...CU('15mm', [1.5, 25]), at: { home: { url: 'https://home.example/p/15' }, tools: { url: ['https://tools.example/old-15', 'https://tools.example/p/15'] }, merch: { url: 'https://merch.example/15' }, shy: {} } },
    { id: 'cu22', ...CU('22mm', [3, 50]), at: { home: { url: 'https://home.example/p/22' }, tools: { url: 'https://tools.example/p/22' }, merch: { url: 'https://merch.example/22' }, shy: {} } }
  ]
};
const text = (name, body) => `Title: ${name}\n\nURL Source: https://x\n\nMarkdown Content:\n# ${name}\n\n${body}\n\nWords about the pipe, enough of them to look like a page.\n`;
const ld = (name, p) => `<html><head><title>${name}</title><script type="application/ld+json">${JSON.stringify({ '@type': 'Product', name, offers: { price: p } })}</script></head><body><h1>${name}</h1></body></html>`;

/* a pretend jina and stores: pages[url] = {text, html, direct}, each an answer or a list used in turn (the last one
   repeats). An answer is a page, or {status, body}. */
function pretend(pages) {
  const s = { pages, hits: [], used: {} };
  const answer = (url, kind) => {
    const k = url + ' ' + kind, list = [].concat((pages[url] || {})[kind] ?? { status: kind === 'direct' ? 403 : 200, body: 'Warning: Target URL returned error 404: Not Found\n\nMarkdown Content:\nnothing here at all, this page has gone' });
    const n = s.used[k] = (s.used[k] || 0) + 1;
    return list[Math.min(n, list.length) - 1];
  };
  s.server = http.createServer((req, res) => {
    const direct = req.url.startsWith('/direct/');
    const url = decodeURIComponent(req.url.replace(/^\/(direct\/)?/, ''));
    const kind = direct ? 'direct' : req.headers['x-return-format'] === 'html' ? 'html' : 'text';
    s.hits.push(kind + ' ' + url);
    let a = answer(url, kind);
    if (typeof a === 'string') a = { status: 200, body: a };
    res.writeHead(a.status, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(a.body);
  });
  return new Promise((ok) => s.server.listen(0, '127.0.0.1', () => { s.port = s.server.address().port; ok(s); }));
}

async function check(s, dir, { mode, now = '2026-10-26T05:41:00.000Z', event } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-temp-'));
  const env = { PATH: process.env.PATH, JINA_URL: `http://127.0.0.1:${s.port}/`, DIRECT_VIA: `http://127.0.0.1:${s.port}/direct/`, PC_DIR: dir, PC_NOW: now, GAP_MS: '10',
                RUNNER_TEMP: temp, GITHUB_STEP_SUMMARY: path.join(temp, 'summary.md'), RAW_DIR: path.join(temp, 'raw') };
  if (mode) env.MODE = mode;
  if (event) env.GITHUB_EVENT_NAME = event;
  s.hits.length = 0;
  const out = await new Promise((ok) => {
    const p = spawn(process.execPath, ['--import', pathToFileURL(path.join(HERE, 'preload.mjs')).href, path.join(REPO, '.github/price-compare/check.mjs')], { env });
    let stdout = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stdout += d; });
    p.on('close', (code) => ok({ code, stdout }));
  });
  const read = (f) => (fs.existsSync(path.join(temp, f)) ? fs.readFileSync(path.join(temp, f), 'utf8') : '');
  out.commit = read('compare-commit.txt');
  out.summary = read('summary.md');
  out.raw = fs.existsSync(path.join(temp, 'raw')) ? fs.readdirSync(path.join(temp, 'raw')).sort() : [];
  fs.rmSync(temp, { recursive: true, force: true });
  const file = path.join(dir, 'prices.json');
  out.data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  return out;
}

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-data-'));
  fs.writeFileSync(path.join(dir, 'compare.json'), JSON.stringify(SMALL));
  return dir;
}
const shop = () => ({
  'https://home.example/p/15': { text: text('Copper Pipe 15mm x 3m', '£13.88 Inc VAT') },
  'https://home.example/p/22': { text: text('Copper Pipe 22mm x 3m', '£28.00 Inc VAT') },
  'https://tools.example/p/15': { text: text('Copper Pipe 15mm x 3m', '£15.60ex. VAT £13.00') },
  'https://tools.example/p/22': { text: text('Copper Pipe 22mm x 3m', '£31.31ex. VAT £26.09') },
  'https://merch.example/15': { text: text('Copper Tube 15mm x 3m', '£12.00Ex VAT\n\n£4.00 per m\n\n£14.40 Inc VAT') },
  'https://merch.example/22': { text: text('Copper Tube 22mm x 3m', '£24.37Ex VAT\n\n£29.24 Inc VAT') }
});

test('price compare check: the first run prices every store that can be read and leaves out the ones that say why not', async () => {
  const s = await pretend(shop()), dir = setup();
  try {
    const r = await check(s, dir);
    assert.equal(r.code, 0, r.stdout);
    assert.deepEqual(plain(Object.fromEntries(Object.entries(r.data.items).map(([i, rows]) => [i, Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.price]))]))),
      { cu15: { home: 13.88, tools: 15.6, merch: 14.4 }, cu22: { home: 28, tools: 31.31, merch: 29.24 } });
    assert.equal(r.data.items.cu15.tools.url, 'https://tools.example/p/15', "the first address had gone, so the second one's used");
    assert.equal(r.data.items.cu15.home.since, '2026-10-26T05:41:00.000Z');
    assert.equal(r.data.checked, '2026-10-26T05:41:00.000Z');
    assert.deepEqual(plain(r.data.run).tried, 6);
    assert.ok(!s.hits.some((h) => /shy\.example/.test(h)), 'a store with no prices for the public is never asked');
    // a store's two pages are never read back to back: every store for 15mm, then every store for 22mm
    const order = s.hits.filter((h) => h.startsWith('text ')).map((h) => h.replace(/^text https:\/\/(\w+)\.example\/.*?(15|22)$/, '$1 $2'));
    assert.deepEqual(order, ['home 15', 'tools 15', 'tools 15', 'merch 15', 'home 22', 'tools 22', 'merch 22'], 'tools 15 twice: the old address, then the new one');
    assert.match(r.commit, /^Price compare: Home Store 15mm £13\.88 \(first price\)/);
    assert.match(r.summary, /\| 1 \| Home Store \| £13\.88 \| text \|/);
    assert.match(fs.readFileSync(path.join(dir, 'prices.json'), 'utf8'), /\n   "home": \{"price":13\.88/, 'one store per line, so a commit shows exactly what moved');
  } finally {
    s.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('price compare check: a price change is kept with what it was, a failed read keeps the last price, a big jump waits for proof', async () => {
  const pages = shop(), s = await pretend(pages), dir = setup();
  try {
    await check(s, dir);
    pages['https://tools.example/p/15'].text = text('Copper Pipe 15mm x 3m', '£15.99ex. VAT £13.33');
    pages['https://merch.example/22'] = { text: { status: 200, body: 'Title: Just a moment...\n\nMarkdown Content:\nChecking your browser' }, direct: { status: 403, body: 'no' } };
    pages['https://home.example/p/22'].text = text('Copper Pipe 22mm x 3m', '£39.00 Inc VAT');     // +39%, and the product data doesn't say so
    pages['https://home.example/p/22'].html = ld('Copper Pipe 22mm x 3m', '28.00');
    let r = await check(s, dir, { now: '2026-10-26T12:41:00.000Z' });
    assert.equal(r.code, 0, r.stdout);
    const t15 = r.data.items.cu15.tools;
    assert.deepEqual(plain([t15.price, t15.since, t15.moves]), [15.99, '2026-10-26T12:41:00.000Z', [{ on: '2026-10-26T12:41:00.000Z', from: 15.6, to: 15.99 }]]);
    const m22 = r.data.items.cu22.merch;
    assert.deepEqual(plain([m22.price, m22.fail.since, m22.fail.n]), [29.24, '2026-10-26T12:41:00.000Z', 1]);
    assert.deepEqual(plain([m22.fail.why, m22.fail.direct]), ["the store's bot check", "the store's bot check (error 403)"]);
    const h22 = r.data.items.cu22.home;
    assert.deepEqual(plain([h22.price, h22.pending]), [28, { price: 39, on: '2026-10-26T12:41:00.000Z' }]);
    assert.match(h22.fail.why, /new price £39\.00 \(was £28\.00\) not confirmed yet/);
    assert.match(r.commit, /^Price compare: Tool Shop 15mm £15\.99 \(was £15\.60\)$/m);
    assert.match(r.stdout, /::warning title=Not read::Merchant 22mm/);

    // the next run: the bot check has gone, and the big jump is seen again, so it's believed
    pages['https://merch.example/22'] = { text: text('Copper Tube 22mm x 3m', '£24.37Ex VAT\n\n£29.24 Inc VAT') };
    r = await check(s, dir, { now: '2026-10-27T05:41:00.000Z' });
    assert.equal(r.data.items.cu22.merch.price, 29.24);
    assert.equal(r.data.items.cu22.merch.fail, undefined, 'read again, so no longer failing');
    assert.deepEqual(plain([r.data.items.cu22.home.price, r.data.items.cu22.home.pending || null, r.data.items.cu22.home.moves.at(-1)]), [39, null, { on: '2026-10-27T05:41:00.000Z', from: 28, to: 39 }]);
    // and a big jump the product data agrees with is believed straight away
    pages['https://home.example/p/15'] = { text: text('Copper Pipe 15mm x 3m', '£19.99 Inc VAT'), html: ld('Copper Pipe 15mm x 3m', '19.99') };
    r = await check(s, dir, { now: '2026-10-27T12:41:00.000Z' });
    assert.equal(r.data.items.cu15.home.price, 19.99);
  } finally {
    s.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("price compare check: jina blocked but the store answers directly; a push reads only what's new; test mode saves nothing", async () => {
  const pages = shop(), s = await pretend(pages), dir = setup();
  try {
    pages['https://merch.example/15'] = { text: { status: 451, body: '{"code":451,"name":"SecurityCompromiseError"}' },
      direct: '<html><head><title>Copper Tube 15mm x 3m</title></head><body><h1>Copper Tube 15mm x 3m</h1><span>£14.40</span><span>£12.00</span></body></html>' };
    let r = await check(s, dir);
    assert.equal(r.data.items.cu15.merch.price, 14.4);
    assert.match(r.stdout, /Merchant 15mm: £14\.40 \(page \(direct\)\)/);

    // a push with a new store on the list reads just that one
    const list = JSON.parse(JSON.stringify(SMALL));
    list.stores.push({ id: 'new', name: 'New Store', site: 'new.example' });
    list.items[0].at.new = { url: 'https://new.example/15' };
    list.items[1].at.new = { none: "Doesn't sell 22mm" };
    fs.writeFileSync(path.join(dir, 'compare.json'), JSON.stringify(list));
    pages['https://new.example/15'] = { text: text('Copper Pipe 15mm x 3m', '£12.50 Inc VAT') };
    r = await check(s, dir, { event: 'push', now: '2026-10-26T09:00:00.000Z' });
    assert.deepEqual(s.hits, ['text https://new.example/15']);
    assert.equal(r.data.items.cu15.new.price, 12.5);
    assert.equal(r.data.checked, '2026-10-26T05:41:00.000Z', 'the other rows were last read by the morning run');
    assert.equal(r.data.last.mode, 'new');

    // a push with nothing new is a 3 page smoke test that saves nothing
    const before = fs.readFileSync(path.join(dir, 'prices.json'), 'utf8');
    r = await check(s, dir, { event: 'push', now: '2026-10-26T10:00:00.000Z' });
    assert.deepEqual([...new Set(s.hits.map((h) => h.replace(/^\w+ https:\/\/(\w+)\.example\/.*$/, '$1')))], ['home', 'tools', 'merch'], 'three pages, one from each of the first three stores');
    assert.match(r.stdout, /Smoke test: nothing saved/);
    assert.equal(fs.readFileSync(path.join(dir, 'prices.json'), 'utf8'), before);
    assert.equal(r.commit, '');
  } finally {
    s.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("price compare check: a site jina can't open, and why, in plain words", async () => {
  const pages = shop(), s = await pretend(pages), dir = setup();
  try {
    pages['https://merch.example/15'] = { text: { status: 422, body: JSON.stringify({ data: null, code: 422, name: 'AssertionFailureError', readableMessage: 'AssertionFailureError: Failed to goto https://merch.example/15: Error: net::ERR_CERT_DATE_INVALID at https://merch.example/15' }) },
      direct: { status: 200, body: '<html><head><title>JavaScript is disabled</title></head><body>Please enable JavaScript to continue using this website, thanks very much indeed.</body></html>' } };
    const r = await check(s, dir);
    assert.equal(r.data.items.cu15.merch.fail.why, "their website's security certificate has run out");
    assert.match(r.stdout, /::warning title=Not read::Merchant 15mm: their website's security certificate has run out \(straight from the store: /);
  } finally {
    s.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("price compare check: raw mode saves every page as it came back; nothing read at all fails the run", async () => {
  const pages = shop(), s = await pretend(pages), dir = setup();
  try {
    let r = await check(s, dir, { mode: 'raw' });
    assert.equal(r.code, 0, r.stdout);
    assert.ok(r.raw.includes('home-cu15.txt') && r.raw.includes('tools-cu15-2.html') && r.raw.includes('merch-cu22.direct.html') && r.raw.includes('index.md'), r.raw.join());
    assert.equal(r.data, null, 'raw mode saves no prices');
    for (const k of Object.keys(pages)) pages[k] = { text: { status: 503, body: 'down' }, html: { status: 503, body: 'down' }, direct: { status: 503, body: 'down' } };
    r = await check(s, dir);
    assert.equal(r.code, 1, 'a run that reads nothing at all fails, so GitHub emails');
    assert.match(r.stdout, /::error title=Price compare::Couldn't read any of the 6 pages/);
  } finally {
    s.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
