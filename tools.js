// To add a tool: copy tools/example.html to a new file, then add one entry here.
// name: tile title | desc: one line | icon: emoji | url: page path | category: section heading
// only: optional list of store codes that see the tile (others don't)
// badge: optional small label on the tile, e.g. "Under construction"
// url can also be a full https:// link to another site; those tiles open in a new tab.
const TOOLS = [
  { name: "Price Tickets", desc: "Screwfix 90 x 75 mm shelf tickets with live prices", icon: "🏷️", url: "tools/price-tickets.html", category: "Screwfix" },
  { name: "A4 Posters", desc: "Screwfix A4 price posters with live prices and photos", icon: "🖼️", url: "tools/posters.html", category: "Screwfix" },
  { name: "Offline site", desc: "Find any product by code or name, with photos, when screwfix.com is down", icon: "🔎", url: "tools/product-search.html", category: "Screwfix" },
  { name: "Area Map", desc: "Every Screwfix store on a map by area, with the nearest stores to anywhere", icon: "🗺️", url: "tools/area-map.html", category: "Screwfix" },
  { name: "Monday Price Check", desc: "Weekly shelf price check: what changed, plus printable sheets", icon: "📋", url: "tools/shelf-check.html", category: "Screwfix" },
  { name: "Price Compare", desc: "Copper pipe, 18V batteries and twin and earth at every major store, cheapest first", icon: "⚖️", url: "tools/price-compare.html", category: "Screwfix" },
  { name: "A25 Behind counter trial", desc: "Nightly price check on the behind counter tickets, kept until you tick them off", icon: "🧾", url: "tools/counter-trial.html", category: "Screwfix", only: ["LB1"] },
  { name: "NPS", desc: "Promoters needed to hit your target, plus an area overview", icon: "📊", url: "tools/nps.html", category: "Screwfix" },
  { name: "Audit Ready", desc: "Team audit quiz: safety, Challenge 25, deliveries and more", icon: "🧠", url: "tools/audit-quiz.html?v=2026101402", category: "Screwfix" },
  { name: "Incentive Tracker", desc: "Area 20 daily incentive tracker", icon: "🏆", url: "https://script.google.com/macros/s/AKfycbyjM1MXqsvfMT2Tn0RyJq_F23TLoUz-yh-jeoLqNQMh-s8Cm70-PS0a8CJvrspp1UDQ/exec", category: "Screwfix" },
  { name: "Photo Coin Counter", desc: "Count a till by note and coin, photograph a pile of coins, or work out a Z report", icon: '<span class="icon-duo">📷<small>🪙</small></span>', url: "tools/till-count.html", category: "Screwfix" },
  { name: "BCR", desc: "Opens the BCR app", icon: '<img src="icons/bcr.svg" alt="" width="44" height="44">', url: "https://apps.powerapps.com/play/e/00eef884-ff25-e066-88a7-4afb024cbe4e/a/f443d081-4f34-49b1-b9be-89cc5dc7d7c0?tenantId=7ed33041-1983-4df6-be2d-95054f5ce8c0&source=curatedApps&hint=25f2585b-e494-4ff9-8b3b-dd76e57cbc7d&sourcetime=1792252108568", category: "Screwfix" },
  { name: "Fuel near your store", desc: "Cheapest petrol and diesel within 5 miles, ranked", icon: "⛽", url: "tools/fuel.html", category: "Fuel Prices" }
];
