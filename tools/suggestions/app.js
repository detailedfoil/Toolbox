/* Suggestions Box: anonymous slips posted into a box; only the box owner can unlock and read them.
   Backend is a Google Apps Script web app (see apps-script.gs). Put its /exec URL in ENDPOINT. */
(function () {
  "use strict";

  var ENDPOINT = "";
  var UNDO_SECONDS = 30;
  var DRAFT_KEY = "toolbox.suggestions.draft";

  var $ = function (id) { return document.getElementById(id); };
  var form = $("slip"), sheet = $("sheet"), paper = $("paper"), text = $("text"), tool = $("tool"),
      toolRow = $("toolRow"), count = $("count"), post = $("post"), err = $("err"),
      box = $("box"), slot = $("slot"), toast = $("toast"), toastMsg = $("toastMsg"), undoBtn = $("undoBtn"), toastBar = $("toastBar"),
      key = $("key"), keyForm = $("keyForm"), kUser = $("kUser"), kPass = $("kPass"), kErr = $("kErr"), kGo = $("kGo"),
      inside = $("inside"), slipsEl = $("slips"), sheetLink = $("sheetLink");

  var reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var last = null;        // { req: Promise, id, token, draft }
  var toastTimer = null;
  var owner = null;       // { user, pass } while unlocked, memory only
  var items = [];
  var filter = "New";

  /* ---------- setup ---------- */

  $("slipDate").textContent = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  var toolNames = (typeof TOOLS !== "undefined" ? TOOLS : [])
    .map(function (t) { return t.name; })
    .filter(function (n) { return n !== "Suggestions Box"; });
  tool.innerHTML = ['<option value="">Pick one</option>']
    .concat(toolNames.map(function (n) { return '<option>' + esc(n) + '</option>'; }))
    .concat(['<option>Toolbox homepage</option>', '<option>Something else</option>']).join("");

  if (!ENDPOINT) { $("offline").hidden = false; post.disabled = true; }

  form.addEventListener("change", function (e) {
    if (e.target.name === "type") toolRow.hidden = form.type.value !== "improve";
  });
  text.addEventListener("input", function () {
    updateCount();
    try { localStorage.setItem(DRAFT_KEY, text.value); } catch (x) {}
  });
  try { var d = localStorage.getItem(DRAFT_KEY); if (d) text.value = d; } catch (x) {}
  updateCount();

  function updateCount() { count.textContent = text.value.length + " / 1000"; }

  /* ---------- posting ---------- */

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    err.textContent = "";
    var draft = readForm();
    if (draft.text.length < 3) { err.textContent = "Write your suggestion on the slip first."; text.focus(); return; }
    if (draft.type === "improve" && !draft.tool) { err.textContent = "Pick which tool it's about."; tool.focus(); return; }
    if (!ENDPOINT) { err.textContent = "The box isn't connected yet."; return; }
    if (last) dismissToast();

    post.disabled = true;
    var req = api({ action: "add", type: draft.type, tool: draft.tool, text: draft.text });
    var current = last = { req: req, draft: draft };

    flyIn().then(function () {
      clearForm();
      showToast("Posted in the box. Thanks!", true);
      undoBtn.disabled = true;
      return req;
    }).then(function (res) {
      if (current !== last) return;
      if (!res.ok) throw new Error(res.error || "failed");
      current.id = res.id; current.token = res.token;
      undoBtn.disabled = false;
    }).catch(function () {
      if (current !== last) return;
      dismissToast();
      last = null;
      restoreForm(draft);
      flyOut().then(function () { err.textContent = "That didn't post. Check your signal and try again."; });
    }).then(function () { post.disabled = !ENDPOINT; });
  });

  undoBtn.addEventListener("click", function () {
    var u = last;
    if (!u) return;
    dismissToast();
    last = null;
    restoreForm(u.draft);
    flyOut().then(function () { text.focus(); });
    u.req.then(function (res) {
      if (!res.ok) return;
      return api({ action: "undo", id: res.id, token: res.token }).then(function (r) {
        if (!r.ok) err.textContent = r.error === "too_late" ? "Too late to undo, that one's already in the box." : "Couldn't take it back out. Try again.";
      });
    }).catch(function () { err.textContent = "Couldn't take it back out. Check your signal and try again."; });
  });

  function readForm() {
    return { type: form.type.value, tool: form.type.value === "improve" ? tool.value : "", text: text.value.trim() };
  }
  function clearForm() {
    text.value = ""; tool.value = ""; form.type.value = "idea"; toolRow.hidden = true; updateCount();
    try { localStorage.removeItem(DRAFT_KEY); } catch (x) {}
    sheet.style.visibility = "";
    if (!reduceMotion) { paper.classList.remove("fresh"); void paper.offsetWidth; paper.classList.add("fresh"); }
  }
  function restoreForm(d) {
    form.type.value = d.type; toolRow.hidden = d.type !== "improve"; tool.value = d.tool; text.value = d.text; updateCount();
    try { localStorage.setItem(DRAFT_KEY, d.text); } catch (x) {}
  }

  /* ---------- toast ---------- */

  function showToast(msg, withUndo) {
    toastMsg.textContent = msg;
    undoBtn.hidden = !withUndo;
    toast.hidden = false;
    toastBar.getAnimations && toastBar.getAnimations().forEach(function (a) { a.cancel(); });
    if (toastBar.animate) toastBar.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: UNDO_SECONDS * 1000, easing: "linear", fill: "forwards" });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(dismissToast, UNDO_SECONDS * 1000);
  }
  function dismissToast() { clearTimeout(toastTimer); toast.hidden = true; }

  /* ---------- the slip going in / coming back out ---------- */

  // A copy of the slip folds up and drops through the slot. It sits in a layer that ends exactly at the slot,
  // so it vanishes into the box rather than sliding behind it.
  function stage() {
    var sx = window.scrollX, sy = window.scrollY;
    var r = sheet.getBoundingClientRect(), s = slot.getBoundingClientRect();
    var clip = document.createElement("div");
    clip.className = "fly-clip sg";
    clip.style.position = "absolute";
    clip.style.height = (s.top + sy + s.height / 2) + "px";
    var fly = document.createElement("div");
    fly.className = "fly slip";
    fly.style.cssText = "left:" + (r.left + sx) + "px;top:" + (r.top + sy) + "px;width:" + r.width + "px";
    var copy = sheet.cloneNode(true);
    copy.removeAttribute("id");
    copy.style.visibility = "";
    copy.querySelectorAll("[id]").forEach(function (n) { n.removeAttribute("id"); });
    copy.querySelectorAll("input,select,textarea").forEach(function (n) { n.disabled = true; n.removeAttribute("name"); });
    var ta = copy.querySelector("textarea"); if (ta) ta.value = text.value;
    var sel = copy.querySelector("select"); if (sel) sel.value = tool.value;
    var radios = copy.querySelectorAll("input[type=radio]");
    radios.forEach(function (n) { n.checked = n.value === form.type.value; });
    copy.querySelector(".slip-paper").classList.remove("fresh");
    var folds = document.createElement("i"); folds.className = "folds";
    copy.querySelector(".slip-paper").appendChild(folds);
    fly.appendChild(copy);
    clip.appendChild(fly);
    document.body.appendChild(clip);

    var fold = 0.34;
    var scaleX = Math.min(1, (s.width * 0.92) / r.width);
    var h = r.height * fold;
    var dx = (s.left + s.width / 2) - (r.left + r.width / 2);
    var cy = r.top + r.height / 2;
    var above = (s.top + s.height / 2) - h / 2 - 10 - cy;
    var below = (s.top + s.height / 2) + h / 2 + 6 - cy;
    return {
      clip: clip, fly: fly,
      frames: [
        { transform: "translate(0,0) scale(1,1) rotate(-.6deg)", offset: 0 },
        { transform: "translate(0,0) scale(1," + fold + ") rotate(0deg)", offset: 0.3 },
        { transform: "translate(" + dx + "px," + above + "px) scale(" + scaleX + "," + fold + ") rotate(2deg)", offset: 0.72 },
        { transform: "translate(" + dx + "px," + below + "px) scale(" + scaleX + "," + fold + ") rotate(0deg)", offset: 1 }
      ]
    };
  }

  function revealBox() {
    var b = box.getBoundingClientRect();
    if (b.bottom > window.innerHeight - 90 || b.top < 0) {
      window.scrollTo({ top: window.scrollY + b.bottom - window.innerHeight + 110, behavior: reduceMotion ? "auto" : "smooth" });
      return new Promise(function (res) { setTimeout(res, reduceMotion ? 0 : 380); });
    }
    return Promise.resolve();
  }

  function flyIn() {
    if (reduceMotion || !document.body.animate) return Promise.resolve();
    return revealBox().then(function () {
      var st = stage();
      sheet.style.visibility = "hidden";
      setTimeout(function () { st.fly.classList.add("folded"); }, 260);
      var a = st.fly.animate(st.frames, { duration: 1150, easing: "cubic-bezier(.45,.05,.35,1)", fill: "forwards" });
      return a.finished.then(function () {
        st.clip.remove();
        box.classList.remove("gulp"); void box.offsetWidth; box.classList.add("gulp");
      });
    });
  }

  function flyOut() {
    if (reduceMotion || !document.body.animate) { sheet.style.visibility = ""; return Promise.resolve(); }
    return revealBox().then(function () {
      var st = stage();
      sheet.style.visibility = "hidden";
      st.fly.classList.add("folded");
      box.classList.remove("gulp"); void box.offsetWidth; box.classList.add("gulp");
      var a = st.fly.animate(st.frames.slice().reverse().map(function (f) { return { transform: f.transform, offset: 1 - f.offset }; }),
        { duration: 1000, easing: "cubic-bezier(.45,.05,.35,1)", fill: "forwards" });
      setTimeout(function () { st.fly.classList.remove("folded"); }, 650);
      return a.finished.then(function () {
        st.clip.remove();
        sheet.style.visibility = "";
        var top = sheet.getBoundingClientRect().top;
        if (top < 0) window.scrollTo({ top: window.scrollY + top - 20, behavior: "smooth" });
      });
    });
  }

  /* ---------- unlocking (owner only) ---------- */

  $("unlockBtn").addEventListener("click", function () {
    kErr.textContent = ""; kPass.value = "";
    if (key.showModal) key.showModal(); else key.setAttribute("open", "");
    setTimeout(function () { kUser.focus(); }, 30);
  });
  $("keyClose").addEventListener("click", function () { key.close(); });
  key.addEventListener("click", function (e) { if (e.target === key) key.close(); });

  keyForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var user = kUser.value.trim().toUpperCase(), pass = kPass.value.trim();
    if (!user || !pass) { kErr.textContent = "Enter the store code and cost code."; return; }
    if (!ENDPOINT) { kErr.textContent = "The box isn't connected yet."; return; }
    kGo.disabled = true; kGo.textContent = "Checking...";
    api({ action: "list", user: user, pass: pass }).then(function (res) {
      if (!res.ok) {
        kErr.textContent = res.error === "locked_out" ? "Too many wrong tries. Wait 10 minutes and try again." : "That sign-in can't open this box.";
        kPass.value = ""; kPass.focus();
        if (!reduceMotion) { keyForm.classList.remove("shake"); void keyForm.offsetWidth; keyForm.classList.add("shake"); }
        return;
      }
      owner = { user: user, pass: pass };
      key.close();
      openBox(res);
    }).catch(function () {
      kErr.textContent = "Couldn't reach the box. Check your signal and try again.";
    }).then(function () { kGo.disabled = false; kGo.textContent = "Unlock"; });
  });

  function openBox(res) {
    box.classList.add("open");
    setItems(res);
    inside.hidden = false;
    setTimeout(function () { inside.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }); }, 300);
  }

  $("lockBtn").addEventListener("click", function () {
    owner = null; items = []; slipsEl.innerHTML = "";
    inside.hidden = true;
    box.classList.remove("open");
    box.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  });

  $("refresh").addEventListener("click", function () {
    if (!owner) return;
    var b = this; b.textContent = "Refreshing...";
    ownerCall({ action: "list" }).then(setItems).catch(function () {}).then(function () { b.textContent = "Refresh"; });
  });

  document.querySelector(".inside-filter").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-f]");
    if (!b) return;
    filter = b.dataset.f;
    this.querySelectorAll("button").forEach(function (x) { x.classList.toggle("is-on", x === b); });
    render();
  });

  slipsEl.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act]");
    if (!b) return;
    var id = b.closest(".note").dataset.id;
    var it = items.find(function (x) { return x.id === id; });
    if (!it) return;
    if (b.dataset.act === "done") {
      var next = it.status === "Done" ? "New" : "Done";
      it.status = next; render();
      ownerCall({ action: "status", id: id, status: next }).catch(function () { it.status = next === "Done" ? "New" : "Done"; render(); });
    } else if (b.dataset.act === "bin") {
      if (!confirm("Bin this suggestion? It can't be brought back.")) return;
      items = items.filter(function (x) { return x.id !== id; }); render();
      ownerCall({ action: "remove", id: id }).catch(function () { ownerCall({ action: "list" }).then(setItems); });
    }
  });

  function ownerCall(body) {
    body.user = owner.user; body.pass = owner.pass;
    return api(body).then(function (res) { if (!res.ok) throw new Error(res.error); return res; });
  }

  function setItems(res) {
    items = res.items || [];
    if (res.sheetUrl) { sheetLink.href = res.sheetUrl; sheetLink.hidden = false; }
    render();
  }

  function render() {
    var nNew = items.filter(function (x) { return x.status !== "Done"; }).length;
    $("nNew").textContent = nNew; $("nDone").textContent = items.length - nNew; $("nAll").textContent = items.length;
    var shown = items.filter(function (x) { return filter === "all" || (filter === "Done" ? x.status === "Done" : x.status !== "Done"); });
    if (!shown.length) {
      slipsEl.innerHTML = '<p class="empty-box">' + (items.length ? "Nothing here." : "The box is empty for now.") + "</p>";
      return;
    }
    slipsEl.innerHTML = shown.map(function (x) {
      var done = x.status === "Done";
      return '<article class="note' + (done ? " done" : "") + '" data-id="' + esc(x.id) + '">' +
        '<div class="note-meta"><span class="note-tag">' + esc(x.type || "Suggestion") + "</span>" +
        (x.tool ? "<span>" + esc(x.tool) + "</span>" : "") +
        "<span>" + esc(when(x.ts)) + "</span></div>" +
        '<p class="note-text">' + esc(x.text) + "</p>" +
        '<div class="note-acts"><button type="button" data-act="done">' + (done ? "Move back to new" : "Mark done") + "</button>" +
        '<button type="button" class="bin" data-act="bin">Bin</button></div></article>';
    }).join("");
  }

  /* ---------- helpers ---------- */

  function api(body) {
    // text/plain keeps this a "simple" request so Apps Script doesn't need a CORS preflight
    return fetch(ENDPOINT, { method: "POST", body: JSON.stringify(body), redirect: "follow" })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); });
  }

  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " +
      d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
})();
