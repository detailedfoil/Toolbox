/* Simple sign-in gate for Toolbox. Username: a store code (e.g. LB1). Password: that store's cost code.
   This is a light lock to keep casual visitors out, not real security. */
(function () {
  "use strict";
  var KEY = "toolbox.signedIn.area20";
  var signedIn = false;
  try { signedIn = !!localStorage.getItem(KEY); } catch (e) {}
  if (signedIn) return;

  // Hide the page until signed in
  var hide = document.createElement("style");
  hide.id = "tb-auth-hide";
  hide.textContent = "body > *:not(#tb-auth){display:none !important}";
  document.head.appendChild(hide);

  var css = document.createElement("style");
  css.textContent =
    "#tb-auth{position:fixed;inset:0;display:grid;place-items:center;padding:24px 16px;background:var(--bg,#0f1115);color:var(--text,#f2f4f8);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;z-index:9999}" +
    "#tb-auth form{width:min(360px,100%);background:var(--card,#181b22);border:1px solid var(--border,#2a2f3a);border-radius:20px;padding:22px 20px}" +
    "#tb-auth h1{margin:0 0 4px;font-size:1.6rem;letter-spacing:-.02em}" +
    "#tb-auth p{margin:0 0 18px;color:var(--muted,#9aa3b2);font-size:.92rem}" +
    "#tb-auth label{display:block;color:var(--muted,#9aa3b2);font-size:.85rem;font-weight:600;margin:12px 0 6px}" +
    "#tb-auth input{width:100%;box-sizing:border-box;min-height:50px;padding:0 14px;font-size:16px;font-family:inherit;border-radius:12px;border:1px solid var(--border,#2a2f3a);background:var(--bg,#0f1115);color:inherit;outline:none}" +
    "#tb-auth input:focus{border-color:var(--accent,#4f8cff)}" +
    "#tb-auth #tb-user{text-transform:uppercase;letter-spacing:.04em}#tb-auth #tb-user::placeholder{text-transform:none;letter-spacing:0}" +
    "#tb-auth button{width:100%;min-height:50px;margin-top:18px;border:0;border-radius:14px;background:var(--accent,#4f8cff);color:#fff;font-size:1rem;font-weight:650;font-family:inherit;cursor:pointer}" +
    "#tb-auth .err{min-height:1.2em;margin:12px 0 0;color:#ff8080;font-size:.88rem}" +
    "@media (prefers-color-scheme:light){#tb-auth .err{color:#c62828}}";
  document.head.appendChild(css);

  function sha256Hex(text) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    });
  }

  function build() {
    var root = document.createElement("div");
    root.id = "tb-auth";
    root.innerHTML =
      '<form autocomplete="on" novalidate>' +
        "<h1>Toolbox</h1><p>Sign in with your store details.</p>" +
        '<label for="tb-user">Store code</label>' +
        '<input id="tb-user" name="username" autocomplete="username" autocapitalize="characters" spellcheck="false" placeholder="e.g. LB1">' +
        '<label for="tb-pass">Cost code</label>' +
        '<input id="tb-pass" name="password" type="password" autocomplete="current-password">' +
        '<button type="submit">Sign in</button>' +
        '<p class="err" role="alert"></p>' +
      "</form>";
    document.body.appendChild(root);

    var form = root.querySelector("form"), err = root.querySelector(".err");
    root.querySelector("#tb-user").focus();
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var user = form.username.value.trim().toUpperCase();
      var pass = form.password.value.trim().replace(/^0+(?=\d)/, "");
      var auth = window.TOOLBOX_AUTH;
      if (!user || !pass) { err.textContent = "Enter your store code and cost code."; return; }
      if (!auth || !window.crypto || !crypto.subtle) { err.textContent = "Sign-in isn't available right now. Reload and try again."; return; }
      sha256Hex(auth.salt + "|" + user + "|" + pass).then(function (h) {
        if (auth.keys.indexOf(h.slice(0, 20)) === -1) {
          err.textContent = "That store code and cost code don't match.";
          form.password.value = "";
          form.password.focus();
          return;
        }
        try { localStorage.setItem(KEY, user); } catch (x) {}
        try { window.dispatchEvent(new CustomEvent("toolbox:login", { detail: { user: user } })); } catch (x) {}
        root.remove();
        var h2 = document.getElementById("tb-auth-hide");
        if (h2) h2.remove();
      });
    });
  }

  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);
})();
