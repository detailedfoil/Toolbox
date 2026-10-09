const grid = document.getElementById("app");
const search = document.getElementById("search");
const count = document.getElementById("count");

function render(filter = "") {
  const q = filter.trim().toLowerCase();
  const shown = TOOLS.filter(t => (t.name + " " + t.desc + " " + t.category).toLowerCase().includes(q));
  count.textContent = shown.length + (shown.length === 1 ? " tool" : " tools");
  if (!shown.length) { grid.innerHTML = '<p class="empty">No tools found</p>'; return; }
  const groups = {};
  shown.forEach(t => (groups[t.category || "Tools"] ||= []).push(t));
  grid.innerHTML = Object.entries(groups).map(([cat, items]) =>
    '<h2 class="cat">' + cat + '</h2><div class="grid">' +
    items.map(t => '<a class="tile" href="' + t.url + '"><div class="icon">' + (t.icon || "🔧") +
      '</div><div class="name">' + t.name + '</div><div class="desc">' + t.desc + '</div></a>').join("") +
    "</div>").join("");
}
search.addEventListener("input", e => render(e.target.value));
render();
