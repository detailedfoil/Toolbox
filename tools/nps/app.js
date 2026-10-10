(function () {
  "use strict";

  const KEY = "toolbox.nps.v2";
  const OLD_KEY = "toolbox.nps.v1";
  const $ = (id) => document.getElementById(id);

  const state = {
    data: null,
    store: "",              // a store name, "@area", "@manual", or "" (not chosen yet)
    target: 87.7,           // percent
    manual: { p: "", pa: "", d: "" },
    tab: "calc",
    open: new Set()         // expanded rows on the overview
  };

  /* ---------- formatting ---------- */
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pct = (v) => (v == null ? "-" : (v * 100).toFixed(1) + "%");
  const pts = (v) => Math.abs(v * 100).toFixed(1);
  const n = (v) => (typeof v === "number" ? v.toLocaleString("en-GB") : v);
  const plural = (k, word) => n(k) + " " + word + (k === 1 ? "" : "s");
  const tgtText = (t) => (Math.round(t * 100) / 100) + "%";
  function ord(k) { const s = ["th", "st", "nd", "rd"], v = k % 100; return k + (s[(v - 20) % 10] || s[v] || s[0]); }
  function splitName(name) {
    const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(name);
    return m ? { base: m[1], code: m[2] } : { base: name, code: "" };
  }

  const ICON = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="m8 12.4 2.7 2.7 5.4-5.6"/></svg>',
    no: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 16.5v-9M8.4 11 12 7.4l3.6 3.6"/></svg>',
    chev: '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'
  };

  /* ---------- saving ---------- */
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ data: state.data, store: state.store, target: state.target, manual: state.manual, tab: state.tab }));
      localStorage.removeItem(OLD_KEY);
    } catch (e) { /* storage blocked: the page still works, it just won't remember */ }
  }
  function restore() {
    try {
      let s = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!s) {
        const old = JSON.parse(localStorage.getItem(OLD_KEY) || "null");
        if (old && old.data) {
          s = { data: old.data, manual: old.manual,
                store: old.store === "Manual" ? "@manual" : old.store === "Area Total" ? "@area" : old.store };
        }
      }
      if (s && s.data && s.data.stores) {
        state.data = s.data;
        state.store = s.store || "";
        if (typeof s.target === "number" && s.target > 0 && s.target <= 100) state.target = s.target;
        if (s.manual) state.manual = s.manual;
        if (s.tab === "overview") state.tab = "overview";
      }
    } catch (e) {}
  }

  /* ---------- upload ---------- */
  function showError(msg) { const e = $("error"); e.textContent = msg || ""; e.hidden = !msg; }

  $("file").addEventListener("change", (ev) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!f) return;
    showError("");
    const rd = new FileReader();
    rd.onerror = () => showError("Couldn't open that file. Try choosing it again.");
    rd.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(rd.result), { type: "array" });
        const data = NPS.parseWorkbook(wb, f.name);
        state.data = data;
        if (state.store && state.store[0] !== "@" && !data.stores.some((s) => s.name === state.store)) state.store = "";
        state.open.clear();
        save();
        render();
      } catch (e) {
        showError(e && e.message ? e.message : "That file isn't the NPS workbook. Upload the dated .xlsx.");
      }
    };
    rd.readAsArrayBuffer(f);
  });

  function renderLoad() {
    const d = state.data;
    if (!d) return;
    $("loadInfo").innerHTML =
      "<strong>" + (d.date ? "Data from " + esc(d.date) : "Workbook loaded") + "</strong>" +
      "<span>" + d.stores.length + " stores, area NPS " + pct(NPS.nps(d.area)) + "</span>";
    $("fileLabel").textContent = "Replace";
  }

  /* ---------- calculator ---------- */
  function counts() {
    const d = state.data;
    const whole = (v) => Math.max(0, Math.floor(+v || 0));
    if (state.store === "@manual") return { p: whole(state.manual.p), pa: whole(state.manual.pa), d: whole(state.manual.d) };
    if (state.store === "@area") return d.area;
    return d.stores.find((s) => s.name === state.store) || null;
  }

  function renderCalc() {
    const d = state.data, el = $("tab-calc");
    const manual = state.store === "@manual";
    const storeOpts = d.stores.slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) =>
      '<option value="' + esc(s.name) + '"' + (s.name === state.store ? " selected" : "") + ">" + esc(s.name) + "</option>").join("");
    const opts =
      (state.store ? "" : '<option value="" selected disabled>Choose your store</option>') +
      storeOpts +
      '<optgroup label="Other">' +
        '<option value="@area"' + (state.store === "@area" ? " selected" : "") + ">Whole area</option>" +
        '<option value="@manual"' + (manual ? " selected" : "") + ">Enter my own numbers</option>" +
      "</optgroup>";

    const field = (id, key, label, dot) =>
      '<div><label for="' + id + '"><i class="dot ' + dot + '"></i>' + label + '</label>' +
      '<input id="' + id + '" type="number" inputmode="numeric" min="0" step="1" placeholder="0" value="' + esc(state.manual[key]) + '"></div>';

    el.innerHTML =
      '<div class="card">' +
        '<label class="lbl" for="store">Store</label>' +
        '<select id="store">' + opts + "</select>" +
        (manual ? '<div class="manual">' + field("mp", "p", "Promoters", "p") + field("mpa", "pa", "Passives", "pa") + field("md", "d", "Detractors", "d") + "</div>" : "") +
        '<div id="now"></div>' +
      "</div>" +
      '<div id="calcBody">' +
        '<section class="target" aria-labelledby="tgtLbl">' +
          '<div class="target-top"><label class="lbl" id="tgtLbl" for="target">Your target</label></div>' +
          '<div class="stepper">' +
            '<button class="step" type="button" data-step="-0.1" aria-label="Lower the target by 0.1">&minus;</button>' +
            '<div class="target-field"><input id="target" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="' + tgtText(state.target).replace("%", "") + '"><span aria-hidden="true">%</span></div>' +
            '<button class="step" type="button" data-step="0.1" aria-label="Raise the target by 0.1">+</button>' +
          "</div>" +
          '<div class="chips">' +
            '<button class="chip" type="button" data-target="87.7">87.7%<span>on target</span></button>' +
            '<button class="chip" type="button" data-target="90">90%<span>great</span></button>' +
          "</div>" +
          '<div class="answer" id="answer" aria-live="polite"></div>' +
        "</section>" +
        '<h2 class="sec">What the next response does</h2>' +
        '<div class="tiles" id="next"></div>' +
        '<h2 class="sec" id="wbHead">Winning back a bad response</h2>' +
        '<div class="card rows" id="winback"></div>' +
      "</div>";

    $("store").addEventListener("change", (e) => {
      state.store = e.target.value;
      save();
      renderCalc();
      renderOverview();
    });
    if (manual) {
      [["mp", "p"], ["mpa", "pa"], ["md", "d"]].forEach(([id, key]) => {
        $(id).addEventListener("input", (e) => { state.manual[key] = e.target.value; save(); updateCalc(); });
      });
    }

    const tInput = $("target");
    tInput.parentElement.addEventListener("click", () => tInput.focus());
    tInput.addEventListener("input", () => {
      const v = parseFloat(tInput.value.replace(",", ".").replace("%", ""));
      if (isFinite(v) && v > 0 && v <= 100) { state.target = v; save(); renderOverview(); }
      updateCalc(isFinite(v) && v > 0 && v <= 100);
    });
    tInput.addEventListener("blur", () => { tInput.value = tgtText(state.target).replace("%", ""); updateCalc(true); });
    tInput.addEventListener("keydown", (e) => { if (e.key === "Enter") tInput.blur(); });
    el.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
      const v = Math.min(100, Math.max(0.1, Math.round((state.target + parseFloat(b.dataset.step)) * 10) / 10));
      setTarget(v);
    }));
    el.querySelectorAll("[data-target]").forEach((b) => b.addEventListener("click", () => setTarget(parseFloat(b.dataset.target))));

    updateCalc(true);
  }

  function gapText(gap) {
    const t = pts(gap);
    return t === "0.0" ? "Just under target" : t + " points below target";
  }

  function setTarget(v) {
    state.target = v;
    $("target").value = tgtText(v).replace("%", "");
    save();
    updateCalc(true);
    renderOverview();
  }

  function updateCalc(targetValid = true) {
    const d = state.data, x = counts();
    const isArea = state.store === "@area", isManual = state.store === "@manual";
    const now = $("now"), body = $("calcBody");

    document.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(Math.abs(parseFloat(c.dataset.target) - state.target) < 1e-9)));

    if (!x || !NPS.total(x)) {
      now.innerHTML = '<p class="pick-prompt">' + (isManual ? "Enter your promoters, passives and detractors to work it out." : "Pick a store to see its score and how many promoters it needs.") + "</p>";
      body.hidden = true;
      return;
    }
    body.hidden = false;

    const c = NPS.calculate(x, state.target, isArea ? null : d.stores);
    const tgt = tgtText(state.target);

    // where you are now
    const seg = (k, cls) => (k > 0 ? '<i class="' + cls + '" style="flex:' + k + ' 1 0"></i>' : "");
    const key = (cls, word, k, share) => '<li><span class="mk-l"><i class="dot ' + cls + '"></i>' + word + '</span><span class="mk-v"><b>' + n(k) + "</b> " + pct(share) + "</span></li>";
    let rankHtml = "", upHtml = "";
    if (c.rank) {
      rankHtml = '<div class="now-rank">' + ord(c.rank) + "<small>of " + (d.stores.length + (isManual ? 1 : 0)) + (isManual ? " if it were a store" : " in the area") + "</small></div>";
      if (c.nextUp && c.nextUp.promoters === Infinity) upHtml = '<p class="now-up">The store above is on 100%, which can\'t be matched once a passive or detractor is in.</p>';
      else if (c.nextUp) upHtml = '<p class="now-up"><b>' + plural(c.nextUp.promoters, "more promoter") + "</b> moves you up to " + ord(c.nextUp.rank) + ".</p>";
      else upHtml = '<p class="now-up">Top of the area.</p>';
    }
    now.innerHTML =
      '<div class="now">' +
        '<div class="now-head"><div><span class="now-num">' + pct(c.score) + '</span><span class="now-lbl">' + (isArea ? "Area NPS" : "NPS") + " from " + n(c.total) + " responses</span></div>" + rankHtml + "</div>" +
        '<div class="mix" role="img" aria-label="' + plural(x.p, "promoter") + ", " + plural(x.pa, "passive") + ", " + plural(x.d, "detractor") + '">' + seg(x.p, "p") + seg(x.pa, "pa") + seg(x.d, "d") + "</div>" +
        '<ul class="mix-key">' + key("p", "Promoters", x.p, c.pPct) + key("pa", "Passives", x.pa, c.paPct) + key("d", "Detractors", x.d, c.dPct) + "</ul>" +
        upHtml +
      "</div>";

    // the answer
    const ans = $("answer");
    if (!targetValid) {
      ans.innerHTML = '<p class="ans-more">Type a target between 0.1 and 100.</p>';
    } else if (c.onTarget) {
      const who = isArea ? "the area" : "you";
      if (c.detractorsToSpare > 0) {
        ans.innerHTML =
          '<span class="status ok">' + ICON.ok + "On target</span>" +
          '<div class="ans"><div class="ans-num">' + n(c.detractorsToSpare) + '</div><div class="ans-txt">' + (c.detractorsToSpare === 1 ? "detractor" : "detractors") + " to spare before " + who + " drop" + (isArea ? "s" : "") + " under " + tgt + "</div></div>" +
          '<p class="ans-more">Or <b>' + plural(c.passivesToSpare, "passive") + "</b>. Every new promoter adds more room.</p>";
      } else {
        ans.innerHTML =
          '<span class="status ok">' + ICON.ok + "On target</span>" +
          '<p class="ans-line">No room to spare. The next detractor would take ' + (isArea ? "the area" : "you") + " under " + tgt + ".</p>" +
          '<p class="ans-more">' + (c.passivesToSpare > 0 ? "There's room for <b>" + plural(c.passivesToSpare, "passive") + "</b>, though." : "So would the next passive.") + " Every new promoter adds more room.</p>";
      }
    } else if (c.needed === Infinity) {
      ans.innerHTML =
        '<span class="status no">' + ICON.no + gapText(state.target / 100 - c.score) + "</span>" +
        '<p class="ans-more">100% means every response has to be a promoter, so it can\'t be reached once a passive or detractor is in.</p>';
    } else {
      const per = isArea ? NPS.perStore(c.needed, d.stores.length) : 0;
      ans.innerHTML =
        '<span class="status no">' + ICON.no + gapText(state.target / 100 - c.score) + "</span>" +
        '<div class="ans"><div class="ans-num">' + n(c.needed) + '</div><div class="ans-txt">more ' + (c.needed === 1 ? "promoter" : "promoters") + " to reach " + tgt + "</div></div>" +
        '<p class="ans-more">That\'s if every new response is a promoter.' +
          (isArea ? " Shared across " + d.stores.length + " stores, that's <b>" + n(per) + "</b> each." : "") + "</p>";
    }

    // the next response
    const tile = (label, cls, v) => {
      const diff = v - c.score, txt = pts(diff);
      const dir = txt === "0.0" ? "flat" : diff > 0 ? "up" : "down";
      const delta = txt === "0.0" ? "No change" : (diff > 0 ? "&#9650; " : "&#9660; ") + txt;
      return '<div class="tile"><span class="tile-k"><i class="dot ' + cls + '"></i>' + label + '</span><span class="tile-v">' + pct(v) + '</span><span class="tile-d ' + dir + '">' + delta + "</span></div>";
    };
    $("next").innerHTML = tile("Promoter", "p", c.afterPromoter) + tile("Passive", "pa", c.afterPassive) + tile("Detractor", "d", c.afterDetractor);

    // winning back
    const wb = (k) => (k === Infinity ? "Can't get back to 100%" : n(k) + " <span>" + (k === 1 ? "promoter" : "promoters") + "</span>");
    $("wbHead").innerHTML = "Winning back a bad response<small>Promoters it takes to get back to " + pct(c.score) + ".</small>";
    $("winback").innerHTML =
      '<div class="r"><span class="k"><i class="dot d"></i>After a detractor</span><span class="v">' + wb(c.offsetDetractor) + "</span></div>" +
      '<div class="r"><span class="k"><i class="dot pa"></i>After a passive</span><span class="v">' + wb(c.offsetPassive) + "</span></div>";
  }

  /* ---------- overview ---------- */
  function renderOverview() {
    const d = state.data, el = $("tab-overview");
    if (!d) return;
    const ov = NPS.overview(d, state.target), a = ov.area, tgt = tgtText(state.target);

    const areaNeed = !a.total ? "" : a.onTarget
      ? "The area is on target with <b>" + plural(a.detractorsToSpare, "detractor") + "</b> to spare."
      : a.toTarget === Infinity ? "100% can't be reached once a passive or detractor is in."
      : "The area needs <b>" + plural(a.toTarget, "more promoter") + "</b> to reach " + tgt + ", about <b>" + n(a.perStore) + "</b> per store.";

    let list = "", lineDone = false;
    ov.rows.forEach((r, i) => {
      if (!lineDone && !r.onTarget) {
        list += '<li class="tline" aria-hidden="true">Target ' + tgt + "</li>";
        lineDone = true;
      }
      list += storeRow(r, i, tgt);
    });
    if (!lineDone) list += '<li class="tline" aria-hidden="true">Target ' + tgt + "</li>";

    el.innerHTML =
      '<div class="card area">' +
        '<div class="area-head">' +
          '<div><span class="area-num">' + pct(a.nps) + '</span><span class="area-lbl">Area NPS from ' + n(a.total) + " responses</span></div>" +
          '<div class="area-count">' + ov.onTargetCount + " of " + d.stores.length + "<small>stores on target</small></div>" +
        "</div>" +
        '<p class="area-need">' + areaNeed + "</p>" +
        '<p class="area-target"><span>Measured against your ' + tgt + ' target</span><button class="link" type="button" data-goto-target>Change</button></p>' +
      "</div>" +
      '<h2 class="sec">Stores, best first<small>Tap a store to see its numbers.</small></h2>' +
      '<ol class="list">' + list + "</ol>";
  }

  function storeRow(r, i, tgt) {
    const nm = splitName(r.name);
    const picked = r.name === state.store;
    const open = state.open.has(r.name);
    let st;
    if (!r.total) st = '<span class="st">No responses yet</span>';
    else if (r.onTarget) st = '<span class="st ok">' + ICON.ok + (r.detractorsToSpare > 0 ? plural(r.detractorsToSpare, "detractor") + " to spare" : "On target, none to spare") + "</span>";
    else st = '<span class="st no">' + ICON.no + (r.toTarget === Infinity ? "Can't reach 100%" : "Needs " + plural(r.toTarget, "more promoter")) + "</span>";

    const fact = (k, v) => '<div class="r"><span class="k">' + k + '</span><span class="v">' + v + "</span></div>";
    const proms = (k) => (k === Infinity ? "Not possible" : n(k) + " <span>" + (k === 1 ? "promoter" : "promoters") + "</span>");
    let detail = "";
    if (r.total) {
      detail =
        '<div class="counts">' +
          "<div>Promoters<b><i class=\"dot p\"></i>" + n(r.p) + "</b></div>" +
          "<div>Passives<b><i class=\"dot pa\"></i>" + n(r.pa) + "</b></div>" +
          "<div>Detractors<b><i class=\"dot d\"></i>" + n(r.d) + "</b></div>" +
          "<div>Responses<b>" + n(r.total) + "</b></div>" +
        "</div>" +
        '<div class="facts">' +
          fact("To reach 1st", r.rank === 1 ? "Already 1st" : proms(r.toTop)) +
          (r.nextUp ? fact("To move up to " + ord(r.nextUp.rank), proms(r.nextUp.promoters)) : "") +
          (r.onTarget ? fact("Passives to spare", n(r.passivesToSpare)) : "") +
          fact("Win back a detractor", proms(r.offsetDetractor)) +
          fact("Win back a passive", proms(r.offsetPassive)) +
        "</div>";
    }
    detail += '<button class="btn" type="button" data-open-calc="' + esc(r.name) + '">Open in calculator</button>';

    return '<li class="store' + (open ? " open" : "") + (picked ? " is-picked" : "") + '" data-name="' + esc(r.name) + '">' +
      '<button class="store-btn" type="button" aria-expanded="' + open + '" aria-controls="det-' + i + '">' +
        '<span class="rk">' + (r.rank || "-") + "</span>" +
        '<span class="nm"><b>' + esc(nm.base) + "</b>" + (nm.code ? '<span class="code">' + esc(nm.code) + "</span>" : "") +
          (picked ? '<span class="tag">In calculator</span>' : "") + st + "</span>" +
        '<span class="sc">' + pct(r.nps) + "</span>" + ICON.chev +
      "</button>" +
      '<div class="detail" id="det-' + i + '"' + (open ? "" : " hidden") + ">" + detail + "</div>" +
    "</li>";
  }

  $("tab-overview").addEventListener("click", (e) => {
    const row = e.target.closest(".store-btn");
    if (row) {
      const li = row.closest(".store"), name = li.dataset.name, open = !li.classList.contains("open");
      li.classList.toggle("open", open);
      row.setAttribute("aria-expanded", String(open));
      li.querySelector(".detail").hidden = !open;
      if (open) state.open.add(name); else state.open.delete(name);
      return;
    }
    const go = e.target.closest("[data-open-calc]");
    if (go) {
      state.store = go.dataset.openCalc;
      save();
      renderCalc();
      renderOverview();
      setTab("calc");
      $("main").scrollIntoView({ block: "start" });
      return;
    }
    if (e.target.closest("[data-goto-target]")) {
      setTab("calc");
      const t = $("target");
      if (t && t.offsetParent !== null) { t.scrollIntoView({ block: "center" }); t.focus(); t.select(); }
      else $("store").focus();
    }
  });

  /* ---------- tabs ---------- */
  function setTab(t) {
    state.tab = t;
    document.querySelectorAll(".nps-tabs [role=tab]").forEach((b) => {
      const on = b.dataset.tab === t;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $("tab-calc").hidden = t !== "calc";
    $("tab-overview").hidden = t !== "overview";
    save();
  }
  document.querySelector(".nps-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) setTab(b.dataset.tab);
  });
  document.querySelector(".nps-tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const next = state.tab === "calc" ? "overview" : "calc";
    setTab(next);
    $("tabbtn-" + next).focus();
  });

  function render() {
    renderLoad();
    $("main").hidden = !state.data;
    if (!state.data) return;
    renderCalc();
    renderOverview();
    setTab(state.tab);
  }

  restore();
  render();
})();
