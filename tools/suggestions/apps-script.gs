/**
 * Toolbox Suggestions Box backend (Google Apps Script web app).
 *
 * Setup (once):
 *   1. Go to script.google.com > New project. Delete what's there and paste this whole file.
 *   2. Deploy > New deployment > type "Web app".
 *        Execute as: Me      Who has access: Anyone
 *   3. Authorise when asked, then copy the Web app URL (ends in /exec).
 *   4. Put that URL in ENDPOINT at the top of tools/suggestions/app.js.
 *
 * Suggestions are kept in a Google Sheet called "Toolbox suggestions" in your Drive.
 * It's made automatically on the first suggestion (or run setup() from the editor to make it now).
 * Nothing about who posted is recorded: no name, no store, no IP.
 *
 * Only the LB1 / 1845 sign-in can open the box. The code is checked here on Google's side,
 * stored only as a hash, and lists are never sent to anyone else.
 */

var SALT = "toolbox-2026";
var UNLOCK_HASH = "4f45a34d8fec0c66fdcc874dbaca65d8109c545de06888461dc07181c388906a"; // sha256("toolbox-2026|LB1|1845")
var MAX_LEN = 1000;
var UNDO_MINUTES = 15;
var HEAD = ["ID", "Posted", "Type", "Tool", "Suggestion", "Status", "Token"];
var TYPES = { idea: "New tool idea", improve: "Improve a tool" };

function doGet() {
  return json_({ ok: true, service: "toolbox-suggestions" });
}

function doPost(e) {
  var req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || "{}"); }
  catch (err) { return json_({ ok: false, error: "bad_request" }); }
  try { return json_(handle_(req)); }
  catch (err) { return json_({ ok: false, error: "server", detail: String(err && err.message || err) }); }
}

function handle_(req) {
  switch (req.action) {
    case "add": return add_(req);
    case "undo": return undo_(req);
    case "list": return withAuth_(req, list_);
    case "status": return withAuth_(req, setStatus_);
    case "remove": return withAuth_(req, remove_);
    default: return { ok: false, error: "unknown_action" };
  }
}

/* ---------- public ---------- */

function add_(req) {
  var text = clean_(req.text, MAX_LEN);
  if (text.length < 3) return { ok: false, error: "too_short" };
  var type = TYPES[req.type] ? req.type : "idea";
  var tool = type === "improve" ? clean_(req.tool, 60) : "";
  var id = Utilities.getUuid().slice(0, 8);
  var token = Utilities.getUuid();
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet_().appendRow([id, new Date(), TYPES[type], safe_(tool), safe_(text), "New", token]);
  } finally { lock.releaseLock(); }
  return { ok: true, id: id, token: token, undoMinutes: UNDO_MINUTES };
}

function undo_(req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_(), row = findRow_(sh, req.id);
    if (!row) return { ok: true, gone: true };
    var vals = sh.getRange(row, 1, 1, HEAD.length).getValues()[0];
    if (!req.token || vals[6] !== req.token) return { ok: false, error: "not_yours" };
    if (new Date() - new Date(vals[1]) > UNDO_MINUTES * 60000) return { ok: false, error: "too_late" };
    sh.deleteRow(row);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ---------- owner only ---------- */

function withAuth_(req, fn) {
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get("fails") || 0);
  if (fails >= 10) return { ok: false, error: "locked_out" };
  var user = String(req.user || "").trim().toUpperCase();
  var pass = String(req.pass || "").trim().replace(/^0+(?=\d)/, "");
  if (sha256_(SALT + "|" + user + "|" + pass) !== UNLOCK_HASH) {
    cache.put("fails", String(fails + 1), 600);
    return { ok: false, error: "denied" };
  }
  return fn(req);
}

function list_() {
  var ss = book_(), sh = sheet_();
  var n = sh.getLastRow() - 1;
  var rows = n > 0 ? sh.getRange(2, 1, n, HEAD.length).getValues() : [];
  var items = rows.filter(function (r) { return r[0]; }).map(function (r) {
    return { id: String(r[0]), ts: new Date(r[1]).toISOString(), type: r[2], tool: unsafe_(r[3]), text: unsafe_(r[4]), status: r[5] || "New" };
  }).reverse();
  return { ok: true, items: items, sheetUrl: ss.getUrl() };
}

function setStatus_(req) {
  var status = req.status === "Done" ? "Done" : "New";
  var sh = sheet_(), row = findRow_(sh, req.id);
  if (!row) return { ok: false, error: "not_found" };
  sh.getRange(row, 6).setValue(status);
  return { ok: true, status: status };
}

function remove_(req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_(), row = findRow_(sh, req.id);
    if (row) sh.deleteRow(row);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ---------- helpers ---------- */

function setup() {
  Logger.log("Suggestions sheet: " + book_().getUrl());
}

function book_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("SHEET_ID"), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create("Toolbox suggestions");
    var sh = ss.getSheets()[0];
    sh.setName("Suggestions");
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight("bold");
    sh.setFrozenRows(1);
    sh.setColumnWidth(5, 480);
    sh.hideColumns(7);
    props.setProperty("SHEET_ID", ss.getId());
  }
  return ss;
}

function sheet_() {
  var ss = book_();
  return ss.getSheetByName("Suggestions") || ss.getSheets()[0];
}

function findRow_(sh, id) {
  if (!id) return 0;
  var n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  var ids = sh.getRange(2, 1, n, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}

function clean_(v, max) {
  return String(v == null ? "" : v).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B-\u001F]/g, "").trim().slice(0, max);
}

// Stop a suggestion starting with = + - @ being run as a spreadsheet formula
function safe_(s) { return /^[=+\-@]/.test(s) ? "'" + s : s; }
function unsafe_(s) { s = String(s == null ? "" : s); return s; }

function sha256_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ("0" + (b & 255).toString(16)).slice(-2); }).join("");
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
