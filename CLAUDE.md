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
2. Run the tests: `cd .github && npm ci` (once per session), then `npm test` (about two minutes). They must
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
  - `fuel`: Fuel Prices, every Area 20 store (a big "Closest to me" button uses the phone's location as `lat,lng` to 3 decimals in the same map URL, or pick your store; forecourts within 5 miles). `parse.js` holds the
    store list and reads PetrolPrices.co.uk's fuel map (`map.php`, the government Fuel Finder feed) as jina renders
    it (needs `X-Timeout`, or the list hasn't filled in). The government's own feed blocks GitHub's servers. Shared by
    the page (live on every open) and the Leighton Buzzard backup on GitHub. `data/hidden.json` lists forecourts to
    leave out for everyone (closed, say): each is hidden until it reports a price dated after its `hiddenOn`.
    The "went down 2.0p by ..." history lines under each forecourt were removed on 26 Oct 2026 (detailedfoil: "just want the
    cost"); `merge()` still keeps `prev` / `prevSince` for the GitHub backup, they're just not shown. A strip under the
    Petrol/Diesel switch compares the listed forecourts' plain average with the UK average for that fuel: the government's
    WEEKLY figure (not live) from petrolprices.co.uk/fuel-price-index.php through jina, read by `parseAverage` in `parse.js`
    (tested on the real page, `fixtures/fuel-average.txt`), once per page open and again on Check again only if the saved
    one (`fu-avg-v1`) is over 6 hours old. It loads alongside the forecourts and stays hidden if it can't be read.
    The big green card is number 1 (a "1" badge, its distance, one forecourt) and the list under it starts at 2; a later
    row at the same price says "Same price". The footer text was taken off on 28 Oct 2026 (detailedfoil's say), leaving Check again and one tiny credit line
    (Fuel Finder via PetrolPrices.co.uk, OGL v3.0: the licence asks for it).
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
    A line under the photo tip says nothing is uploaded and counts clear when the page closes (detailedfoil, 26 Oct 2026).
  - Photo Coin Counter 2 (mixed coins, `coin-counter-2`) was a test, built and removed 22 Oct 2026 at detailedfoil's say.
  - Photo Coin Counter's **Z report tab** (`till-count.html#z-report`; built 26 Oct 2026 as its own tool and moved into this
    page the same evening, detailedfoil: "I wanted that z report calculator inside the coin counter app"). Two tabs at the
    top, Till count and Z report (the last used opens, `tc-tab` in sessionStorage). A photo of the card machine's Z report
    gives the OVERALL END OF DAY TOTAL row's Total minus the Worldline TradeUK row's Total (detailedfoil: the bottom circled
    number minus the upper one). Either can be typed instead (typing wins). The two numbers last while the page is open
    (sessionStorage `zr-state-v1`), the photo only in memory; a line under the photo buttons says nothing is uploaded or
    saved (detailedfoil asked). Everything on the tab has an id starting `zr-` and its buttons `data-zr`, so nothing clashes
    with the till count's ids and `data-act` buttons. `zreport-app.js` is the tab (and the tab switch), `zreport.js` reads
    the receipt with no libraries: Tesseract was tried and can't read this
    printer's slashed zeros (0.00 came out as U.UU, and other digits misread). Ink is judged against the paper around it; characters
    are blobs (pieces of one joined up, digits that print joined split by the fixed character width); money is digits, an
    empty cell, two digits (the full stop prints too faint to rely on; a faint digit is found from the darkness in its cell);
    rows are matched to the four 10-character columns (the Total column line goes through rows showing all four numbers) and
    named from the bottom by their gaps (the two end of day rows each sit twice a card row's gap below the row above); a
    tilt over 3 degrees is straightened first. Each digit is compared, at 9 small shifts, with the printer's own digits
    (`FONT` in zreport.js, one 10 x 16 shape per digit, made by `.github/z-report/train.mjs` from photos of real Z reports, kept off GitHub;
    the test photos and `FAKE` in make-fixture.mjs can train it too). Checks: Sale + Cashback - Refund = Total on each row,
    and the overall total against the current one; when a row doesn't add up and changing exactly one unsure digit to its
    runner-up fixes it, that's used. Green = checked, amber = compare with the receipt. The page turns a photo that gives no
    numbers (sideways, upside down) and reads it again. Tests: `.github/tests/z-report.test.mjs` on `fixtures/zreport-*.jpg`,
    real photos with every amount changed and the heading blurred by `.github/z-report/make-fixture.mjs` (made-up receipt:
    712.32 overall, 27.06 TradeUK): any change to zreport.js must keep those exact. Change GX/GY or the sampling and the
    shapes must be made again with train.mjs. Untested so far: totals of 1,000 or more (a comma is allowed for, but no
    receipt with one has been seen) and a negative total (a minus sign is looked for).
  - `product-search`: Product Search, every store (the "Under construction" tile badge and page banner were removed on 21 Oct 2026,
    detailedfoil's say; `badge` on a tile still works). A parody "CrashFix" look on this page only (colours from screenshots of the real site). `search.js` is the search: no network, an index
    in memory, typo tolerant; add a test in `.github/tests/product-search.test.mjs` for any search that should work.
    `photos.js` keeps the product list on the phone (IndexedDB) and shows photos: the kept copy only if there is one (Screwfix's image server isn't asked), else media.screwfix.com (120 px).
    `data/products.json` is made from detailedfoil's stock export by `.github/product-search/make-list.py` (code, name
    and the warning flags only: no stock or locations, the repo is public; flag 16 is the export's "Age Restricted"
    column, added 22 Oct 2026). The "Age restricted" badge and search go by that stock list flag (detailedfoil, 23 Oct
    2026): the check's old `a` from screwfix.com was catching promotional red boxes (28 Stanley tape measures, toolboxes and
    the like). The one exception: flag 32 (`--add` sets it on products the latest export doesn't have, 661 on 23 Oct, among
    them knives) lets the page use the check's `a` for those only, and only when `an` (the notice's words) is there. It reads the workbook or the report
    pasted as text; for a newer export he wants `--add` (keeps every product already there as it is, adds new codes only,
    and adds the age mark to any the export marks age restricted, never taking it off). `data/web-names.json` holds the
    screwfix.com names and `photos/<CODE>.jpg` the 120 px photos (JPEG quality 85, about 2 KB each; `PHOTO_PX` and `PHOTO_QUALITY` in check.mjs), both written by the nightly check (`a: 1` on a
    product in `web-names.json` means Screwfix's own Challenge 25 notice sits under the product heading (`ageNotice` in
    `describe.mjs`; a product the stock list marks age restricted but read with no notice is read again a day later, as 121EH's notice came after the first read; not `lookup.js`'s whole-page check, which caught promo boxes; `an` holds the notice's words); the page
    uses it only for flag 32 products (see above), otherwise it's a cross-check; `p: 1` means its photo is saved; `d: 1` means `descriptions/<CODE>.json` holds its
    description, `{t, b}` = paragraph text and feature bullets, read from the same page by `.github/product-search/describe.mjs`,
    tested on real pages saved in `.github/tests/fixtures/page-*.txt`; the page loads it only when a result is tapped). `data/desc-words.json` (also robot-written) holds each
    description's search words, minus words already in its names, filler and bare numbers; the page loads it after the
    list and `search.js` uses it as a lower tier: codes, then names (title and alternative name), then description
    matches ("Found in the description"), then close spellings.
    Stock levels (detailedfoil, 25 Oct 2026): "Paste stock" takes the stock system's SKU List report (Nailed = YES, Print
    Preview, Ctrl+A, Ctrl+C: PC only, the page says so; the steps and `stock-help.png` are in the paste box), read by `stock.js` (headings found by
    name, so a different column choice works; tested in product-search.test.mjs with made-up rows). Each result shows only
    the Available Qty (he doesn't want locations; only that column, the name and age are kept), and an "In stock only"
    switch hides results with none available. Kept in sessionStorage
    (`ps-stock`) for that tab only and never sent or committed: stock is store-specific and the repo is
    public. Pasted products not in the list are searchable for the visit, by their stock system name.
    Working with no signal (detailedfoil, 26 Oct 2026): `tools/product-search-sw.js` is a service worker registered by
    app.js with scope "product-search", so it only looks after this page and its files (never the other tools). It keeps
    every Toolbox file the page fetches (page, code and lists site-first with a 4 s fallback to the kept copy; photos
    and descriptions kept-first); never anything from another site. Settings has one "Download names" button (detailedfoil, 26 Oct 2026: "just names are ok"; descriptions
    and images were offered as separate downloads for a few hours, then taken out): it puts the page, its code and `products.json`
    (SKU code + ILS name) into the same cache (`product-search-v1`), about 1 MB, a moment; when it was saved is in `ps-saved2`.
    "Save again" fetches every file fresh first (header `X-PS-Save`, which the service worker lets straight through to the
    site), and only when all have come back deletes the whole cache and puts the new copy in (detailedfoil, 28 Oct 2026); a
    failed fetch leaves the old copy. The "Don't load photos" switch was taken off on 28 Oct 2026, and "Paste stock" is now
    labelled "Upload stock" (same paste box).
    Offline, photos show their placeholder and descriptions / description search don't work. Saved files are checked one at a time
    (`cache.match`): listing 20,000 with `cache.keys()` can fail in Chrome. The page has to be opened once with signal.
    Grouping sizes of the same product into one result with a size switcher (buttons or a drop-down) was built and
    removed on 22 Oct 2026 at detailedfoil's say (he didn't like it): every size is its own result.
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
  - `nps`: the NPS figures were taken off the public site on 22 Oct 2026. Anyone now loads them on the page for that
    visit only (sessionStorage, gone when the tab closes; never committed). Three ways in: the survey export (one row per
    customer, Store + LTR columns: 9-10 promoter, 7-8 passive, 0-6 detractor, blank LTR left out; `parseResponses`, checked
    against the dashboard summary on 27 Oct 2026, all 22 stores exact), the old dated workbook (Store Breakdown sheet), or
    figures pasted as text (`parseText`, still in engine.js and tested, but the paste box was taken off the page on
    27 Oct 2026, detailedfoil's say). The load box always shows "How to get the file" steps with his two screenshots of the
    dashboard's Data Export tab and export window (`nps/how/*.png`, added at his request knowing the repo is public). `STORES` in `engine.js` maps the exports' names to "Name (CODE)" ("Dunstable
    Houghton Regis" = Houghton Regis, "Luton" = Bilton Way, "Luton LAP" = Windmill). The dashboard summary (responses and
    score only) can't give the split, so the page asks for the export instead. Tests: `.github/tests/nps.test.mjs`. The
    real exports hold customer comments and invoice numbers: never commit one. The YTD trends tab hides itself with no chart.
  - `suggestions`, `audit-quiz.html` (all in one file): separate tools that share nothing.
  - `floor-plan`: 3D Floor Plan, Dunstable (LB1) only: the tile has `only: ["LB1"]` and `app.js` shows "only for
    Dunstable" to any other sign-in (a light lock: the layout is readable on GitHub like everything else). Built
    29 Oct 2026 from photos of the store's fire plan and electrical layout: 19.6 x 21.2 m inside, positions good to
    about 30 cm, heights and shelf counts are typical guesses until detailedfoil measures them. three.js r186 is
    vendored as a plain script (`floor-plan/three/three.min.js`, global THREE; the esbuild command is at its top)
    because there's no build step and the tests parse every .js file as a classic script. `data/layout.json` is the
    store in metres (x from the left wall, y from the back wall towards the front): openings in the outside walls,
    columns, inside walls, rooms, rack runs (`edges` = bay boundaries, `open` = the side you pick from, `braced` = bays
    drawn with an X on the plans, `plan` = the electrical drawing's labels), objects (counters, tills, shop shelving,
    furniture), zones, lights and where the walk starts. `bays.js` turns the runs into bays with temporary names
    (row letter + bay number + b / f for the back / front of a back-to-back row: F3b, C2, L5); it's shared with
    `.github/tests/floor-plan.test.mjs` (no overlaps, names unique, the walk starts on clear floor, LB1 only). Views:
    3D (outside walls cut at 3.2 m), Top (flat, back wall at the top like the drawings) and Walk (full walls, roof
    and lights; a stick on touch screens, WASD or arrows on a PC, drag to look, tap the little map to jump). Tap a
    bay for its card; "Walk here" stands you in the aisle looking at it. Shadows are drawn once (nothing moves).
    `data/locations.json` (added 29 Oct 2026 from detailedfoil's descriptions) says which stock-system location each bay
    holds, as AREA-BAY codes (AAA-01 is the start of AAA-01-12-06): bay 1 is nearest the middle aisle, 6 at the right
    wall. Done so far: K (front BAA 1-6, back BAB 1-6), J (front AAA 1-2 / 3-4 / 5-6 / 7-8 / 9 / 10, back AAB 1-6),
    G (front BAC 1-2 then AAE 1-4, back BAD split like AAA: 1+2, 3+4, 5+6, 7+8, 9, 10), F (front BAF 1-6), E (E3f BAG 1, E4f BAG 2; E3b and E4b are the hazard cabinets, codes not given yet), H (front AAC 1-6, back AAD 1-6), F back BAE 1-6. The viewer shows the location on the tag and card (`attach` in bays.js); no stock goes in the repo.
    Left block A-D is "bulk" to the shop; its location numbers run from the middle aisle (so drawn bay 4 holds 1+2,
    3 holds 3+4 and so on), and B and C have stock on both sides. Done (30 Oct 2026): A (front BBG, back BBH), B
    (BBE front, BBF back), C (BBC, BBD), D (back BBB, front BBA 1-6 then LAC 3+4 on D1f), P (LAC 1+2), W (front only,
    BBJ 1-12 from the back right corner to the fire door at the back left), E1 BBI 1+2 / E2 BBI 3+4 with BBK on E2's back, E3b HAB and E4b HAA (hazard
    cabinets, area only), L1 LAB 1+2, L3 LAB 3+4, L5 LAA, L2 and L4 the holding area, V1 AAJ 1, V2 AAJ 2 (HAD and HAE are ignored, detailedfoil's say). `unsure` marks guesses to confirm; area-only
    codes (no bay number) are fine in locations.json.
    Stock on the shelves (30 Oct 2026): the racking is 3.6 m tall (detailedfoil: the top shelf is about two people
    tall); shelf 10 of the AA_ areas is chin height (1.5 m, 15.3 cm apart for shelves 1 to 10), the shelves above them
    and every other aisle are spread evenly (`areas` in locations.json says how many shelves each area has). Shelves 1
    to 10 of AAA to AAE are cardboard drawers, 20 positions a shelf: a bay slice is about 12.7 cm per drawer wide, so a
    full width bay has 10 drawers of 2 (odd position = front, even = back) and a half width one (AAA 1-8) has 5 of 4.
    `stock.js` reads the pasted SKU List report (same report as Product Search; kept on that device in localStorage until "Clear stock" (detailedfoil asked for it to load by
    default, 30 Oct; it is NOT in the repo: the repo is public, so tests use made-up products) and works out where a location is (`index`, `place`,
    `cellRect`). The Stock button takes the paste; products on ordinary shelves become boxes, a tap on a drawer slides
    it out with what's in it, and the search jumps you to a product. Positions count from the LEFT as you face the
    shelf (an assumption, to be confirmed; `psign` in stock.js flips it). Mouse look: on a PC, in Walk, the first click
    captures the mouse like a game (Esc lets go); the "Mouse look" button (only shown with a mouse) turns it off for
    dragging instead. A paste that stops part way through a row (stock.js `cut`) is flagged, and "Add more" adds a second paste to the list (the 29 Oct list was cut at exactly 100,000 characters, 1,129 products; detailedfoil expects about 10,000 nailed). Next: whatever detailedfoil asks for (heights, shelf counts and the position direction are still guesses).
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
- `.github/workflows/price-compare.yml` runs `.github/price-compare/check.mjs` twice a day (05:41 and 12:41 UTC) and saves
  `tools/price-compare/data/prices.json` (one row per store per product, its last 6 moves, `fail` when the latest read
  failed: the last price stays). A new price more than 25% from the last is only believed when the page's product data
  agrees or the next run sees it again (`pending`). A push changing the list prices only new rows (nothing new = a 3 page
  smoke test; a row that has only ever failed counts as new only when its address changes, `fail.url`). Run it by hand in
  `raw` mode to save every store page as it came back to the `diag-compare` branch, for working out a new store's layout
  (`extra` adds more addresses, `textonly` reads just the text: quick, for looking through stores' search pages).
- `.github/tests/`: the tests. The checks are run against a pretend jina and Screwfix
  (`mock-screwfix.mjs`, with the made-up products in `scenarios.mjs`), so the tests never touch the real sites.

## Things that are easy to break

- **Files written by robots.** `tools/shelf-check/data/prices.json`, `phone.json` and
  `tools/counter-trial/data/prices.json`, `ticks.json`, `tools/fuel/data/prices.json`, `tools/price-compare/data/prices.json`, `tools/product-search/data/web-names.json` and `desc-words.json` are written by the GitHub checks, or by the pages
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
