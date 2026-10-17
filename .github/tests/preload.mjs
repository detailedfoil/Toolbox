// Loaded (node --import) into a GitHub price check while the tests run it: requests to screwfix.com go to
// the pretend site in mock-screwfix.mjs instead, and every wait is 1000 times shorter, so a whole run,
// pauses and all, takes a moment.
const site = `http://127.0.0.1:${process.env.MOCK_PORT}/direct/`;
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const u = String(url);
  return realFetch(u.startsWith('https://www.screwfix.com/') ? site + u.slice('https://www.screwfix.com/'.length) : u, init);
};
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, (Number(ms) || 0) / 1000, ...args);
