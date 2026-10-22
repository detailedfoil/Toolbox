# Toolbox

Tools for Screwfix Area 20 stores, published with GitHub Pages at https://detailedfoil.github.io/Toolbox/.
Plain HTML, CSS and JavaScript with no build step: what's in the repo is what the site serves, a minute or
two after a push to `main`. The owner (detailedfoil) isn't a programmer and tests changes on a phone, so
explain changes in plain English and say what they'll see.

## Before you commit

1. Changed any `.js` or `.css` file? Run `node .github/stamp.mjs`. It sets the `?v=` on every page to a
   fingerprint of each file, so phones fetch the new copy and the Monday check and A25 pages show their
   "newer version" banner. Never type a `?v=` by hand. On a merge conflict in a `?v=` line, take either side
   and run the script again.
2. Run the tests: `cd .github && npm ci` (once per session), then `npm test` (under a minute). They must
   all pass. If you changed behaviour on purpose, change the test that describes it, and add a test for any
   new awkward case (especially in the page reader, `lookup.js`).
3. Leave `[skip ci]` off commits that change code, so the tests and the price checks' smoke tests run on
   GitHub. It's fine on commits that only change data or wording.

## Where things are

- `index.html`, `app.js`, `tools.js`: the home page. `tools.js` is the list of tiles; to add a tool, copy
  `tools/example.html` and add one entry there.
- `auth.js`, `auth-data.js`: the sign-in screen (store code + cost code, stored hashed). A light lock only:
  the repo is public, so everything in it can be read on GitHub.
- `analytics.js`: GoatCounter visitor stats.
- `tools/<tool>.html` with its scripts in `tools/<tool>/`:
  - `price-tickets`: 90 x 75 mm tickets. `ticket-engine.js` makes the PDF. `lookup.js` is the Screwfix page
    reader shared by four pages (tickets, posters, Monday check, A25) and both GitHub checks.
  - `posters`: A4 posters. `poster-engine.js` (PDF), `photo.js` (product photos).
  - `shelf-check`: the Monday Price Check page. `sheet-engine.js` makes its PDFs. `data/plan.json` is the
    shop plan from the brief; a new brief can wait in `data/plan.next.json` until its `effective` date.
  - `counter-trial`: the A25 Behind counter trial page (it also uses `shelf-check/shelf-check.css`).
    `data/plan.json` is the ticket list with the printed prices.
  - `fuel`: Fuel Prices, every Area 20 store (pick your store; forecourts within 5 miles). `parse.js` holds the
    store list and reads PetrolPrices.co.uk's fuel map (`map.php`, the government Fuel Finder feed) as jina renders
    it (needs `X-Timeout`, or the list hasn't filled in). The government's own feed blocks GitHub's servers. Shared by
    the page (live on every open) and the Leighton Buzzard backup on GitHub. `data/hidden.json` lists forecourts to
    leave out for everyone (closed, say): each is hidden until it reports a price dated after its `hiddenOn`.
  - `till-count`: Photo Coin Counter (was Till Count), every store. Notes take a value; coins take a value, a number of coins or a photo
    of a pile of one coin (whichever was changed last wins). A £50 or £75 float (remembered per phone) comes off
    the total. Counts last while the page is open (sessionStorage) and photos only in memory: nothing is sent
    anywhere. `coins.js` is the coin reader, no libraries: edge points vote for circle middles (a first pass at
    any size finds one coin's size, a second finds every coin of about that size), each checked by how much of
    its rim shows. Allows for photos taken at a slight angle; amber = counted but worth a look. `money.js` does
    the sums in whole pence. Tested on two real photos (`.github/tests/fixtures/coins-*.jpg`, 50 10p and 48 20p,
    receipt blurred): any change to `coins.js` must keep those exact. Edges come from lightness and colour (red minus
    blue, `CHROMA`), added 22 Oct 2026: on wood it found 71% of coins before, 99% after. Also tested on four made-up piles
    of one coin (`coins-pile-*.jpg`, from `.github/till-count/make-piles.py` with `PILES=1`, some on `wood.jpg`, bare
    wood cut from a real phone photo).
  - Photo Coin Counter 2 (mixed coins, `coin-counter-2`) was a test, built and removed 22 Oct 2026 at detailedfoil's say.
  - `product-search`: Product Search, every store (the "Under construction" tile badge and page banner were removed on 21 Oct 2026,
    detailedfoil's say; `badge` on a tile still works). A parody "CrashFix" look on this page only (colours from screenshots of the real site). `search.js` is the search: no network, an index
    in memory, typo tolerant; add a test in `.github/tests/product-search.test.mjs` for any search that should work.
    `photos.js` keeps the product list on the phone (IndexedDB) and shows photos: the kept copy only if there is one (Screwfix's image server isn't asked), else media.screwfix.com (120 px).
    `data/products.json` is made from detailedfoil's stock export by `.github/product-search/make-list.py` (code, name
    and the four warning flags only: no stock or locations, the repo is public). `data/web-names.json` holds the
    screwfix.com names and `photos/<CODE>.jpg` the 120 px photos (JPEG quality 85, about 2 KB each; `PHOTO_PX` and `PHOTO_QUALITY` in check.mjs), both written by the nightly check (`a: 1` on a
    product in `web-names.json` means age restricted, found by the same reader the posters use (`age` in `lookup.js`),
    shown as an "Age restricted" badge; `p: 1` means its photo is saved; `d: 1` means `descriptions/<CODE>.json` holds its
    description, `{t, b}` = paragraph text and feature bullets, read from the same page by `.github/product-search/describe.mjs`,
    tested on real pages saved in `.github/tests/fixtures/page-*.txt`; the page loads it only when a result is tapped). `data/desc-words.json` (also robot-written) holds each
    description's search words, minus words already in its names, filler and bare numbers; the page loads it after the
    list and `search.js` uses it as a lower tier: codes, then names (title and alternative name), then description
    matches ("Found in the description"), then close spellings.
    `families.js` groups sizes of the same product (detailedfoil, 22 Oct 2026): a name with its sizes taken out (mm,
    inches, gauge, litres, packs, clothing and boot sizes) is the family; results show one card per family (the best
    match) with a size switcher (buttons for up to 5 short sizes, otherwise a drop-down) that swaps the card in place.
    Rules he set: never mix brands, never mix ways of measuring (mm / inches / gauge), gold and silver ranges apart.
    screwfix.com names are used; a product not read yet joins only a family of its own brand measured the same way,
    and stock-only families need a brand seen on screwfix.com. Tested in `.github/tests/product-search.test.mjs`.
  - `area-map`: Area Map, every store (all 986, UK, Ireland and the Isle of Man) on a Leaflet map (vendored in
    `area-map/leaflet/`, OpenStreetMap tiles, greyed; a button turns them off). `data/stores.json` holds each store's
    name, address, postcode, area, country and location ONLY: detailedfoil asked for no names of people, numbers, store
    codes or anything else (the repo is public; a test checks the keys). `approx: 1` = pin placed from the postcode area
    (or, in Ireland, by hand from the address), not the exact postcode. `data/areas.json` is made by
    `.github/area-map/make-areas.mjs` (run it after any change to stores.json; a test fails until you do): every place
    goes to its nearest store's area (worked out separately on Great Britain, the island of Ireland and the Isle of
    Man), clipped to Natural Earth's coastline (`.github/area-map/land.json`), coloured so neighbours never share a
    colour or two that look alike (`ALIKE`, checked for colour blindness). `geo.js` is the search and the sums (tested
    in `.github/tests/area-map.test.mjs`). A town or postcode that isn't a store is looked up on postcodes.io (UK only).
    "My store" and the street map setting stay on the phone.
  - `nps`, `suggestions`, `audit-quiz.html` (all in one file): separate tools that share nothing.
- `.github/workflows/shelf-check.yml` (Mondays) and `counter-trial.yml` (every night) run
  `.github/shelf-check/check.mjs` and `.github/counter-trial/check.mjs` on GitHub. Both read prices with the
  shared `.github/lib/price-check.mjs` and commit the results to `tools/<tool>/data/prices.json`.
  A push to `main` that changes the reading code makes each run a five line smoke test.
  `.github/workflows/fuel.yml` runs `.github/fuel/check.mjs` for Leighton Buzzard only and commits
  `tools/fuel/data/prices.json` when a price changes or the saved copy is 5 hours old. Its 3-hourly schedule was
  switched off on 21 Oct 2026 (the page reads live fast enough), so it only runs by hand or when its code changes;
  the saved copy is just a fallback and goes stale.
- `.github/workflows/product-search-names.yml` runs `.github/product-search/check.mjs` every 6 hours (00:23, 06:23, 12:23,
  18:23 UTC), each run up to 5.5 hours, so it goes round the clock until every product is done, then finds nothing to do.
  Each run starts with a photo sweep (`PHOTO_SWEEP: 'on'`): every missing photo, about one a second through the free relay
  wsrv.nl (Screwfix's image server refused GitHub directly, 20 Oct 2026; a 40 photo test at that pace was not blocked), since a
  photo's address needs only the code. 3 refusals in a row stop the sweep for that run (a warning, not a failure). Then per
  product: the page through jina (name and age check, text read only), photos only for any the sweep left. About one product every 20 s, gaps 14 to 26 s,
  a 2 to 6 minute break every 40 to 70 products, progress saved every 20. A failed product is skipped (retried after a
  week, 3 goes). 4 failures in a row: an hour's pause; 3 pauses with nothing working: it gives up (run fails, GitHub
  emails detailedfoil) and the next run gives up at once if its first 4 fail. detailedfoil asked for it to be as
  unsuspicious as possible: keep it polite (slow, uneven, backs off), never add ways to dodge Screwfix's blocking, and
  don't speed it up. Add `PHOTOS: 'off'` to the workflow to leave photos out.
- `.github/tests/`: the tests. The checks are run against a pretend jina and Screwfix
  (`mock-screwfix.mjs`, with the made-up products in `scenarios.mjs`), so the tests never touch the real sites.

## Things that are easy to break

- **Files written by robots.** `tools/shelf-check/data/prices.json`, `phone.json` and
  `tools/counter-trial/data/prices.json`, `ticks.json`, `tools/fuel/data/prices.json`, `tools/product-search/data/web-names.json` and `desc-words.json` are written by the GitHub checks, or by the pages
  through the GitHub API with a token saved on a phone. Don't edit them by hand, and pull before you push:
  the checks commit to `main` most nights.
- **The page reader** (`tools/price-tickets/lookup.js`) is behind every price on the site. Bump `VERSION`
  inside it when you change it (error reports show it). jina rules, learned the hard way: read the text
  first and only then ask for the whole page (`X-Return-Format: html`); never send `X-No-Cache`; jina allows
  20 requests a minute without a key.
- **The PDF engines** `ticket-engine.js` and `poster-engine.js` are exact ports of the original artwork
  scripts: don't restyle them (see the note at the top of each). Each engine has its own small PDF writer
  on purpose, so a change for one can't move another.
- **Copies that must stay in step.** These pairs share code by copy, not by a shared file. When you fix one,
  check the other has the same fix:
  - `tools/shelf-check/app.js` and `tools/counter-trial/app.js`: the device check (relays left out after
    failing, keeping the screen awake), the error report (`attemptLine`, `connTest`, `copyText`,
    `reportSheet`) and `checkVersion`.
  - `tools/price-tickets/app.js` and `tools/posters/app.js`: the code / price / name rows, status messages,
    the lookup queue, making and sharing the PDFs, and the toast.

## Trying a page

Serve the folder (`python3 -m http.server 8000`) and open `http://localhost:8000/tools/...`. To skip the
sign-in screen, run `localStorage.setItem('toolbox.signedIn.area20', 'LB1')` in the browser console first.
