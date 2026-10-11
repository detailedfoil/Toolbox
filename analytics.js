/* Visitor stats for Toolbox, via GoatCounter (free, no cookies).
   Setup: make a free account at goatcounter.com, pick a site code, and put it in CODE below.
   Counts page views (unique visitors show on the dashboard) plus one "login/STORECODE" entry
   per signed-in store, so you can see which stores use it. The cost code is never sent. */
(function () {
  "use strict";
  var CODE = "detailedfoil"; // -> https://detailedfoil.goatcounter.com
  var KEY = "toolbox.signedIn.area20";

  window.TOOLBOX_STATS = { code: CODE, url: CODE ? "https://" + CODE + ".goatcounter.com" : "" };
  if (!CODE) return;

  function who(user) {
    if (!user || !window.goatcounter || !window.goatcounter.count) return;
    try {
      if (sessionStorage.getItem("tb.who." + user)) return;
      sessionStorage.setItem("tb.who." + user, "1");
    } catch (e) {}
    window.goatcounter.count({ path: "login/" + user, title: "Store " + user, event: true });
  }

  var s = document.createElement("script");
  s.async = true;
  s.src = "https://gc.zgo.at/count.js";
  s.setAttribute("data-goatcounter", "https://" + CODE + ".goatcounter.com/count");
  s.setAttribute("data-goatcounter-settings", '{"no_onload":true}');
  s.onload = function () {
    window.goatcounter.count({ path: location.pathname });
    var user = null;
    try { user = localStorage.getItem(KEY); } catch (e) {}
    who(user);
  };
  document.head.appendChild(s);

  // Fired by auth.js right after a successful sign-in
  window.addEventListener("toolbox:login", function (e) { who(e.detail && e.detail.user); });
})();
