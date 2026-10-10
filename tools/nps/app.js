(function () {
  "use strict";
  var KEY = "toolbox.nps.v1";
  var $ = function (id) { return document.getElementById(id); };
  var state = { data: null, store: "", target: 90, manual: { p: "", pa: "", d: "" }, tab: "calc" };

  /* ---- helpers ---- */
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function pct(v, dp) { return v == null ? "-" : (v * 100).toFixed(dp == null ? 1 : dp) + "%"; }
  function signed(v) { if (v == null) return "-"; var t = Math.abs(v * 100).toFixed(1); return (t === "0.0" ? "" : v > 0 ? "+" : "-") + t + "%"; }
  function cls(v) { return v > 0.00005 ? "up" : v < -0.00005 ? "down" : "flat"; }
  function n(v) { return typeof v === "number" ? v.toLocaleString("en-GB") : v; }
  function isMe(name) { return /\(LB1\)/.test(name) || /^dunstable/i.test(name); }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ data: state.data, store: state.store, target: state.target, manual: state.manual })); } catch (e) {}
  }
  function restore() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || "null");
      if (s && s.data && s.data.stores) {
        state.data = s.data; state.store = s.store || ""; state.target = s.target == null ? 90 : s.target;
        state.manual = s.manual || state.manual;
      }
    } catch (e) {}
  }
  function defaultStore() {
    var me = state.data.stores.filter(function (s) { return isMe(s.name); })[0];
    return me ? me.name : "Manual";
  }

  /* ---- upload ---- */
  function showError(msg) { var e = $("error"); e.textContent = msg || ""; e.hidden = !msg; }

  $("file").addEventListener("change", function (ev) {
    var f = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!f) return;
    showError("");
    var rd = new FileReader();
    rd.onerror = function () { showError("Could not read that file."); };
    rd.onload = function () {
      try {
        var wb = XLSX.read(new Uint8Array(rd.result), { type: "array" });
        var data = NPS.parseWorkbook(wb, f.name);
        state.data = data;
        if (state.store !== "Manual" && state.store !== "Area Total" &&
            !data.stores.some(function (s) { return s.name === state.store; })) state.store = defaultStore();
        if (!state.store) state.store = defaultStore();
        save(); render();
      } catch (e) {
        showError(e && e.message ? e.message : "That file could not be read as the NPS workbook.");
      }
    };
    rd.readAsArrayBuffer(f);
  });

  function renderLoad() {
    var d = state.data, info = $("loadInfo");
    if (!d) {
      info.innerHTML = "<strong>No workbook loaded</strong><span>Choose the latest DD.MM.YYYY.xlsx</span>";
      $("fileLabel").textContent = "Upload";
      return;
    }
    var an = NPS.nps(d.area);
    info.innerHTML = "<strong>" + (d.date ? "Data from " + esc(d.date) : "Workbook loaded") + "</strong>" +
      "<span>" + d.stores.length + " stores &middot; Area " + pct(an) + "</span>";
    $("fileLabel").textContent = "Replace";
  }

  /* ---- calculator ---- */
  function currentCounts() {
    var d = state.data;
    if (state.store === "Manual") {
      return { p: +state.manual.p || 0, pa: +state.manual.pa || 0, d: +state.manual.d || 0 };
    }
    if (state.store === "Area Total") return d.area;
    return d.stores.filter(function (s) { return s.name === state.store; })[0] || d.area;
  }

  function row(k, v, sub, extra) {
    return '<div class="row"><div class="k">' + k + (extra ? "<small>" + extra + "</small>" : "") + '</div><div class="v">' + v + (sub ? "<small>" + sub + "</small>" : "") + "</div></div>";
  }

  function renderCalc() {
    var d = state.data, el = $("tab-calc");
    var manual = state.store === "Manual";
    var opts = ['<option value="Manual"' + (manual ? " selected" : "") + ">Manual entry</option>",
                '<option value="Area Total"' + (state.store === "Area Total" ? " selected" : "") + ">Area Total</option>"]
      .concat(d.stores.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (s) {
        return '<option value="' + esc(s.name) + '"' + (s.name === state.store ? " selected" : "") + ">" + esc(s.name) + "</option>";
      })).join("");

    var x = currentCounts();
    var shown = manual ? state.manual : { p: x.p, pa: x.pa, d: x.d };

    el.innerHTML =
      '<div class="card">' +
        '<div class="field"><label for="store">Select store</label><select id="store">' + opts + "</select></div>" +
        '<div class="three">' +
          '<div class="field"><label for="cp">Promoters</label><input id="cp" type="number" inputmode="numeric" min="0" step="1" value="' + shown.p + '"' + (manual ? "" : " readonly") + "></div>" +
          '<div class="field"><label for="cpa">Passives</label><input id="cpa" type="number" inputmode="numeric" min="0" step="1" value="' + shown.pa + '"' + (manual ? "" : " readonly") + "></div>" +
          '<div class="field"><label for="cd">Detractors</label><input id="cd" type="number" inputmode="numeric" min="0" step="1" value="' + shown.d + '"' + (manual ? "" : " readonly") + "></div>" +
        "</div>" +
        '<p class="hint">' + (manual ? "Type your own counts: promoters 9-10, passives 7-8, detractors 0-6." : "Counts come from the workbook. Pick Manual entry to type your own.") + "</p>" +
        '<div class="field" style="margin-top:14px;margin-bottom:0"><label for="target">Target NPS %</label><input id="target" type="number" inputmode="decimal" min="0" max="100" step="0.1" value="' + state.target + '"></div>' +
      "</div>" +
      '<div id="results"></div>';

    $("store").addEventListener("change", function (e) { state.store = e.target.value; save(); renderCalc(); });
    $("target").addEventListener("input", function (e) { state.target = e.target.value === "" ? "" : +e.target.value; save(); renderResults(); });
    if (manual) {
      [["cp", "p"], ["cpa", "pa"], ["cd", "d"]].forEach(function (m) {
        $(m[0]).addEventListener("input", function (e) { state.manual[m[1]] = e.target.value; save(); renderResults(); });
      });
    }
    renderResults();
  }

  function renderResults() {
    var d = state.data, x = currentCounts();
    var tPct = state.target === "" ? NaN : state.target;
    var t = isNaN(tPct) ? 0.9 : tPct / 100;
    var c = NPS.calculate(x, t);
    var el = $("results");
    if (!c.total) { el.innerHTML = '<div class="card"><p class="hint" style="margin:0">Enter at least one response to see the results.</p></div>'; return; }

    var ratingCls = c.rating === "Great" ? "ok" : c.rating === "On Target" ? "warn" : "bad";
    var pos = NPS.position(d, c.score);
    var isStore = state.store !== "Manual" && state.store !== "Area Total";
    var posTxt = isStore ? "of " + d.stores.length : "of " + (d.stores.length + 1) + " (incl. you)";

    function after(v) { return pct(v) + '<small class="' + cls(v - c.score) + '">' + signed(v - c.score) + "</small>"; }

    el.innerHTML =
      '<div class="card"><h2>NPS score</h2><div class="score"><div><div class="big">' + pct(c.score) + '</div><div class="sub">' + n(c.total) + " responses</div></div>" +
        '<span class="pill ' + ratingCls + '">' + c.rating + "</span></div>" +
        '<div class="bar"><i class="p" style="width:' + (c.pPct * 100) + '%"></i><i class="pa" style="width:' + (c.paPct * 100) + '%"></i><i class="d" style="width:' + (c.dPct * 100) + '%"></i></div>' +
        '<div class="legend"><span><span class="dot p"></span>Promoters <b>' + pct(c.pPct) + '</b></span><span><span class="dot pa"></span>Passives <b>' + pct(c.paPct) + '</b></span><span><span class="dot d"></span>Detractors <b>' + pct(c.dPct) + "</b></span></div></div>" +

      '<div class="card"><h2>Target calculator</h2>' +
        row("Additional promoters needed", n(c.needed), "", "to reach " + (isNaN(tPct) ? "90" : tPct) + "% NPS") +
        row("Per store", n(c.perStore), "", "if calculating for the area (" + NPS.STORE_COUNT_DIVISOR + " stores)") +
      "</div>" +

      '<div class="card"><h2>NPS after 1 response</h2>' +
        row("+1 Promoter", after(c.afterPromoter)) +
        row("+1 Passive", after(c.afterPassive)) +
        row("+1 Detractor", after(c.afterDetractor)) +
      "</div>" +

      '<div class="card"><h2>Offset counter</h2>' +
        row("Promoters to offset 1 detractor", n(c.offsetDetractor), "", "maintaining current NPS") +
        row("Promoters to offset 1 passive", n(c.offsetPassive), "", "maintaining current NPS") +
      "</div>" +

      '<div class="card"><h2>Leaderboard position</h2>' +
        row(isStore ? "Position" : "Your position", n(pos), posTxt) +
      "</div>";
  }

  /* ---- leaderboard ---- */
  function renderBoard() {
    var d = state.data, lb = NPS.leaderboard(d), a = lb.area;
    var rows = lb.rows.map(function (r) {
      var moved = r.rankLy == null ? 0 : r.rankLy - r.rankNow;   // positive = climbed
      var rv = r.rankLy == null ? r.rankNow : r.rankNow + '<small class="ly">was ' + r.rankLy + "</small>";
      return '<tr class="' + (isMe(r.name) ? "me" : "") + '"><td class="pos">' + r.pos + '</td><td class="name">' + esc(r.name) + '<small class="ly">last year ' + pct(r.ly) + "</small></td>" +
        "<td>" + pct(r.now) + '</td><td class="' + cls(r.change) + '">' + signed(r.change) + "</td>" +
        '<td class="' + (moved > 0 ? "up" : moved < 0 ? "down" : "flat") + '">' + rv + "</td></tr>";
    }).join("");

    $("tab-board").innerHTML =
      '<div class="card"><h2>Area total</h2><div class="sumline"><span class="big">' + pct(a.now) + '</span>' +
        '<span class="' + cls(a.change) + '">' + signed(a.change) + " v last year (" + pct(a.ly) + ")</span></div></div>" +
      '<div class="tbl-wrap"><table class="t"><thead><tr><th>#</th><th class="name">Store</th><th>NPS</th><th>Change</th><th>Rank v LY</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      '<p class="note">Ordered by change on last year. Rank v LY is this year&rsquo;s NPS rank, with last year&rsquo;s in brackets. Green = moved up, red = moved down.</p>';
  }

  /* ---- store breakdown ---- */
  function renderStores() {
    var d = state.data, bd = NPS.breakdown(d);
    function line(r) {
      var t = r.nps == null;
      return '<tr class="' + (r.isArea ? "sum" : isMe(r.name) ? "me" : "") + '"><td class="name">' + esc(r.name) + "</td>" +
        "<td><b>" + pct(r.nps) + "</b></td><td>" + (t ? "-" : r.rank) + "</td>" +
        '<td class="need">' + (t ? "-" : n(r.toTop)) + '</td><td class="need">' + (t ? "-" : n(r.toTarget)) + '</td><td class="keep">' + (t ? "-" : n(r.detractorsLeft)) + "</td>" +
        "<td>" + (t ? "-" : n(r.offsetPassive)) + "</td><td>" + (t ? "-" : n(r.offsetDetractor)) + "</td>" +
        "<td>" + n(r.p) + "</td><td>" + n(r.pa) + "</td><td>" + n(r.d) + "</td><td>" + n(r.total) + "</td></tr>";
    }
    var tgt = (NPS.TARGET * 100).toFixed(1) + "%";
    $("tab-stores").innerHTML =
      '<div class="tbl-wrap"><table class="t wide"><thead><tr><th class="name">Store</th><th>NPS %</th><th>Rank</th>' +
      "<th>Promoters<br>to #1</th><th>Promoters<br>to " + tgt + "</th><th>Detractors before &lt; " + tgt + "</th><th>Promoters to offset 1 passive</th><th>Promoters to offset 1 detractor</th><th>Promoters</th><th>Passives</th><th>Detractors</th><th>Total</th></tr></thead><tbody>" +
      bd.stores.map(line).join("") + line(bd.area) + "</tbody></table></div>" +
      '<p class="note">Sorted best first. Green numbers = promoters needed. Red numbers = detractors you can take before dropping under ' + tgt + ". Scroll sideways for all columns.</p>";
  }

  /* ---- tabs / render ---- */
  function render() {
    renderLoad();
    $("main").hidden = !state.data;
    if (!state.data) return;
    if (!state.store) state.store = defaultStore();
    renderCalc(); renderBoard(); renderStores();
    setTab(state.tab);
    if (state.data.warnings && state.data.warnings.length) showError(state.data.warnings.join(" "));
  }
  function setTab(t) {
    state.tab = t;
    Array.prototype.forEach.call(document.querySelectorAll(".nps-tabs button"), function (b) {
      var on = b.dataset.tab === t; b.classList.toggle("is-on", on); b.setAttribute("aria-selected", on);
    });
    ["calc", "board", "stores"].forEach(function (k) { $("tab-" + k).hidden = k !== t; });
  }
  document.querySelector(".nps-tabs").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-tab]"); if (b) setTab(b.dataset.tab);
  });

  restore();
  render();
})();
