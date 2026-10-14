// To add a tool: copy tools/example.html to a new file, then add one entry here.
// name: tile title | desc: one line | icon: emoji | url: page path | category: section heading
// only: optional list of store codes that see the tile (others don't)
// url can also be a full https:// link to another site; those tiles open in a new tab.
const TOOLS = [
  { name: "Price Tickets", desc: "Screwfix 90 x 75 mm shelf tickets with live prices", icon: "🏷️", url: "tools/price-tickets.html", category: "Screwfix" },
  { name: "A4 Posters", desc: "Screwfix A4 price posters with live prices and photos", icon: "🖼️", url: "tools/posters.html", category: "Screwfix" },
  { name: "Monday Price Check", desc: "Weekly shelf price check: what changed, plus printable sheets", icon: "📋", url: "tools/shelf-check.html", category: "Screwfix" },
  { name: "A25 Behind counter trial", desc: "Nightly price check on the behind counter tickets, kept until you tick them off", icon: "🧾", url: "tools/counter-trial.html", category: "Screwfix", only: ["LB1"] },
  { name: "NPS", desc: "Promoters needed to hit your target, plus an area overview", icon: "📊", url: "tools/nps.html", category: "Screwfix" },
  { name: "Audit Ready", desc: "Team audit quiz: safety, Challenge 25, deliveries and more", icon: "🧠", url: "tools/audit-quiz.html?v=2026101402", category: "Screwfix" },
  { name: "Incentive Tracker", desc: "Area 20 daily incentive tracker", icon: "🏆", url: "https://script.google.com/macros/s/AKfycbyjM1MXqsvfMT2Tn0RyJq_F23TLoUz-yh-jeoLqNQMh-s8Cm70-PS0a8CJvrspp1UDQ/exec", category: "Screwfix" }
];
