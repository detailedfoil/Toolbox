// Made-up products for testing the GitHub price checks, and what the pretend site says about each.
// Every awkward case the checks have to handle has its own code.
import { textPage, wholePage, NOT_FOUND, BOT_CHECK, LIMITED } from './mock-screwfix.mjs';

export const P = {
  STEADY: '11111',     // price as before
  UP: '22222',         // new price, confirmed by the product data in the whole page
  OTHER: '33333',      // new price, but the whole page's product data is for another code: can't be confirmed
  GONE: '44444',       // Screwfix says the page doesn't exist
  BUSY: '55555',       // jina says slow down once, then answers
  OFFER: '66666',      // on offer: was price next to the price
  DIRECT: '77777',     // jina gets the bot check; straight to Screwfix works
  BLOCKED: '88888',    // jina doesn't answer; Screwfix sends its bot check
  ELSEWHERE: '99999',  // jina's page is for a different product
  NEW: '10002',        // new to the list: no price yet
  GONE2: '20002'       // jina gets the bot check; Screwfix says the page doesn't exist
};

export const NAMES = {
  [P.STEADY]: 'Steady Widget', [P.UP]: 'Pricier Widget', [P.OTHER]: 'Confusing Widget', [P.GONE]: 'Old Widget',
  [P.BUSY]: 'Busy Widget', [P.OFFER]: 'Offer Widget', [P.DIRECT]: 'Direct Widget', [P.BLOCKED]: 'Blocked Widget',
  [P.ELSEWHERE]: 'Lost Widget', [P.NEW]: 'New Widget', [P.GONE2]: 'Older Widget'
};

/* the prices on file before the run */
export const BEFORE = {
  [P.STEADY]: 9.99, [P.UP]: 9.99, [P.OTHER]: 14, [P.GONE]: 2, [P.BUSY]: 5, [P.OFFER]: 20, [P.DIRECT]: 7.77,
  [P.BLOCKED]: 8.88, [P.ELSEWHERE]: 4, [P.GONE2]: 6
};

const t = (code, price, extra) => textPage({ code, name: NAMES[code], price, ...extra });
const w = (code, price, extra) => wholePage({ code, name: NAMES[code], price, ...extra });

export function site() {
  return {
    [P.STEADY]: { text: [t(P.STEADY, 9.99)] },
    [P.UP]: { text: [t(P.UP, 12.99)], html: [w(P.UP, 12.99)] },
    [P.OTHER]: { text: [t(P.OTHER, 15)], html: [w(P.OTHER, 15, { ldCode: '12345' })] },
    [P.GONE]: { text: [NOT_FOUND] },
    [P.BUSY]: { text: [LIMITED, t(P.BUSY, 5)] },
    [P.OFFER]: { text: [t(P.OFFER, 20, { was: 25 })] },
    [P.DIRECT]: { text: [BOT_CHECK], direct: [w(P.DIRECT, 7.77)] },
    [P.BLOCKED]: { text: ['reset'], direct: [{ status: 202, body: '<html><body>Checking your browser</body></html>' }] },
    [P.ELSEWHERE]: { text: [textPage({ code: '12345', name: 'Some Other Thing', price: 4 })] },
    [P.NEW]: { text: [t(P.NEW, 3.5)], html: [w(P.NEW, 3.5)] },
    [P.GONE2]: { text: [BOT_CHECK], direct: [{ status: 404, body: '<html><head><title>404 | Screwfix</title></head><body>Page not found</body></html>' }] }
  };
}

/* every code answers the same way: e.g. always rate limited, or never answers */
export function siteWhere(codes, answer) {
  return Object.fromEntries(codes.map((c) => [c, { text: [answer], html: [answer], direct: [answer] }]));
}

export const ORDER = [P.STEADY, P.UP, P.OTHER, P.GONE, P.BUSY, P.OFFER, P.DIRECT, P.BLOCKED, P.ELSEWHERE, P.NEW, P.GONE2];

/* ---------- UK dates, worked out the same way as the checks do ---------- */

export function londonDate(d = new Date()) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day}`;
}
export function mondayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const x = new Date(Date.UTC(y, m - 1, d));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

/* ---------- Monday shelf check: a shop plan and last week's prices ---------- */

export function shelfPlan(codes = ORDER) {
  const half = Math.ceil(codes.length / 2), a = codes.slice(0, half), b = codes.slice(half).concat([codes[0]]);   // the first code sits in both bays
  return {
    name: 'Test front of house', short: 'Test FOH', store: 'Test store', brief: 'Test brief',
    bays: [
      { page: 1, name: 'Bay 1', shelves: [{ label: 'Shelf 1', codes: a }], codes: a },
      { page: 2, name: 'Bay 2', shelves: [{ label: 'Shelf 1', codes: b }], codes: b }
    ]
  };
}

export function shelfPrices({ week = '2026-01-05', codes = ORDER, statuses = {} } = {}) {
  const products = {};
  for (const c of codes) {
    if (BEFORE[c] == null) continue;
    products[c] = { name: NAMES[c], price: BEFORE[c], prev: null, status: statuses[c] || 'ok', was: null, on: week };
  }
  return { plan: 'Test front of house', checked: week, previous_checked: '2025-12-29',
           run: { week, started: week + 'T03:30:00.000Z', finished: week + 'T04:30:00.000Z', trigger: 'schedule', complete: true },
           products };
}

/* ---------- A25 counter trial: the ticket list (with the printed prices) and the last results ---------- */

export function counterPlan(codes = ORDER) {
  return { name: 'Test trial', set: '2026-01-05',
           lines: codes.map((c, i) => ({ code: c, name: NAMES[c], shelf: BEFORE[c] != null ? BEFORE[c] : 3.5, sheet: 1 + (i % 2) })) };
}

export function counterPrices({ date = '2026-01-05', codes = ORDER, statuses = {} } = {}) {
  const products = {};
  for (const c of codes) {
    if (BEFORE[c] == null) continue;
    products[c] = { name: NAMES[c], price: BEFORE[c], since: '2026-01-02', status: statuses[c] || 'ok', was: null, on: date, moves: [] };
  }
  return { trial: 'Test trial', checked: date,
           run: { date, started: date + 'T00:07:00.000Z', finished: date + 'T00:20:00.000Z', trigger: 'schedule', complete: true },
           products };
}
