# Warehouse Shift online co-op

Open `tools/warehouse-shift.html?online=1` on each device using the same game build and the existing game login. Choose **Online co-op → Host a shift** on one device. The host sees a six-character code in the top bar. Up to three other players choose **Join shift** and enter that code. A PC kept awake with its game tab visible is the best host. Each online device has one local player. Solo and local split-screen use their original controls.

## Configure Cloudflare

The GitHub Pages game and the relay deploy separately. Use a Cloudflare account with Workers, a workers.dev subdomain, and permission to deploy Workers and Durable Object migrations to that account. Wrangler can authenticate in a browser. For CI, keep the account ID and a Workers deployment token in the CI secret store. The game only needs the **public relay origin**.

From the repository root, using Node 22.12+ and the Wrangler version tested here:

```sh
npx wrangler@4.166.0 login
npx wrangler@4.166.0 whoami
npx wrangler@4.166.0 deploy --config workers/warehouse-relay/wrangler.toml
```

The configuration creates the `ROOMS` binding and the SQLite-backed `WarehouseRoom` class. `GAME_ORIGIN` is the exact origin of the web page, currently `https://detailedfoil.github.io`. For a different game host, set that value before deployment. A GitHub Pages repository path such as `/Toolbox` belongs in the page URL only.

Put the deployed HTTPS origin in the `RELAY` constant in `tools/warehouse-shift/online.js`, run `node .github/stamp.mjs`, and publish the game build. To test a staging build before setting its default, append `&relay=https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev` to its flagged game URL on every device. The normal game URL continues to open solo or local split-screen.

## Local checks

```sh
cd .github
npm ci
npm test
cd ..
npx wrangler@4.166.0 dev --local --config workers/warehouse-relay/wrangler.toml
```

In a second terminal at the repo root:

```sh
node --test .github/warehouse-shift/test-relay.mjs .github/warehouse-shift/test-online-game.mjs
```

The tests connect to loopback port 8787 (override with `RELAY_PORT`). Keep the configured GitHub Pages origin for these tests. They open four WebSocket connections to the local Durable Object and exercise the game DOM, including a touch layout. The game test uses the real scene graph, scanners and till with canvas drawing stubbed. For a manual local browser run, serve the Toolbox checkout over HTTP and start Wrangler with `--var GAME_ORIGIN:http://localhost:8000` if the game is served on that origin. Open the game with `?online=1&relay=http://127.0.0.1:8787`.

For the rendered browser check, install Python Playwright (the workflow pins the version) and use Chrome with SwiftShader. Start a static server from the repo root on port 8000 and run local Wrangler with `--var GAME_ORIGIN:http://127.0.0.1:8000`. Set `CHROME_BIN` to the Chrome executable and run `python3 .github/warehouse-shift/browser-online.py`. It checks a desktop host, a touch guest, shelf relocation, rotation and two simulated controllers. Set `WAREHOUSE_SCREENSHOT` to a PNG path to capture the guest's view.

## Room behaviour

- The host runs Day, customer paths, Sam and the till queues. The relay assigns identities, limits room size and forwards messages. Guests run their own camera, input and scanner UI. The host verifies ownership, line order, proximity and till baskets before accepting shared actions.
- A guest rebuilds item and location references against its own catalogue. The protocol version, stamped game scripts and catalogue fingerprint have to match. Movement and character poses are sent up to ten times per second. Shared records are sent on change and on joining. Rooms with only the host send no periodic gameplay messages.
- A dropped connection reserves the seat for 30 seconds. An open tab reconnects automatically and gets a fresh snapshot. Unfinished guest work goes back to the shared list or delivery. Completed work stays completed. After a page reload a guest can rejoin using the room code when a seat is available.
- A hidden host tab pauses gameplay. If the original host disconnects, guests wait up to 30 seconds for that tab to return. Leaving explicitly or losing the host past that deadline ends the room. The simulation lives in the host tab, so reloading it ends that shift.
- WebSocket attachments preserve socket identities and rate counters across Durable Object hibernation. Only membership and expiry times are stored in the object. The relay caps guest messages at 30 per second and host messages at 100 per second, with separate payload limits.

Before exposing the online menu by default, play a shift on a real PC and phone against the deployed relay. Check walking and squatting, picking the same job, the holding area, till payment, briefly disconnecting each device, and ending the shift from the host.

[Cloudflare Durable Objects setup](https://developers.cloudflare.com/durable-objects/get-started/) · [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
