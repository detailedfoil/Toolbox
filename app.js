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

/* Hidden stats panel: tap the "Toolbox" title 5 times quickly. */
(function () {
  const title = document.querySelector("header h1");
  if (!title) return;
  let taps = 0, timer = null;
  title.addEventListener("click", () => {
    taps++;
    clearTimeout(timer);
    timer = setTimeout(() => { taps = 0; }, 2500);
    if (taps >= 5) { taps = 0; openStats(); }
  });

  function openStats() {
    if (document.getElementById("tb-stats")) return;
    const stats = window.TOOLBOX_STATS || {};
    let me = "";
    try { me = localStorage.getItem("toolbox.signedIn.area20") || ""; } catch (e) {}
    const el = document.createElement("div");
    el.id = "tb-stats";
    el.style.cssText = "position:fixed;inset:0;z-index:9998;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.6)";
    const box = document.createElement("div");
    box.style.cssText = "width:min(380px,100%);background:var(--card,#181b22);color:var(--text,#f2f4f8);border:1px solid var(--border,#2a2f3a);border-radius:20px;padding:22px 20px;font-family:inherit";
    const body = stats.url
      ? '<p style="margin:0 0 6px;color:var(--muted,#9aa3b2);font-size:.92rem">Unique visitors and page views are on the dashboard. Stores that have signed in appear under Pages as <b>login/STORECODE</b>, and tool opens show as their own pages.</p>' +
        '<a href="' + stats.url + '" target="_blank" rel="noopener" style="display:block;margin-top:16px;text-align:center;padding:14px;border-radius:14px;background:var(--accent,#4f8cff);color:#fff;font-weight:650;text-decoration:none">Open visitor stats</a>'
      : '<p style="margin:0;color:var(--muted,#9aa3b2);font-size:.92rem">Stats are not switched on yet. Set the GoatCounter site code at the top of analytics.js and this will link straight to your dashboard.</p>';
    box.innerHTML = '<h2 style="margin:0 0 10px;font-size:1.3rem">Stats</h2>' + body +
      (me ? '<p style="margin:14px 0 0;color:var(--muted,#9aa3b2);font-size:.8rem">Signed in here as ' + me + '</p>' : "") +
      '<button type="button" style="width:100%;margin-top:12px;min-height:44px;border:1px solid var(--border,#2a2f3a);border-radius:14px;background:transparent;color:inherit;font:inherit;cursor:pointer">Close</button>';
    el.appendChild(box);
    document.body.appendChild(el);
    const close = () => el.remove();
    box.querySelector("button").addEventListener("click", close);
    el.addEventListener("click", e => { if (e.target === el) close(); });
  }
})();
