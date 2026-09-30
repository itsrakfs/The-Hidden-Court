/* THE HIDDEN COURT · shared runtime config
   Same JS runs on both hosts:
     - Flask (same-origin): no data-* attributes -> relative URLs, no fallback.
     - GitHub Pages (static): build_pages.js injects data-api-base,
       data-player-url and data-fallback so the API is cross-origin and the
       page still renders from the baked snapshot when the API is down. */
(function () {
  "use strict";

  function attr(name) {
    var el = document.documentElement;
    return el ? el.getAttribute(name) || "" : "";
  }

  var API_BASE = attr("data-api-base").replace(/\/+$/, "");
  var PLAYER_URL = attr("data-player-url") || "/player/";
  var FALLBACK_URL = attr("data-fallback");

  function apiUrl(path) {
    return API_BASE + path;
  }

  function playerUrl(id) {
    return PLAYER_URL + String(id);
  }

  function playerId() {
    var raw = new URLSearchParams(window.location.search).get("id");
    var n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  }

  function fetchJSON(path) {
    return fetch(apiUrl(path), { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .catch(function (err) {
        if (!FALLBACK_URL || path !== "/api/ranking") throw err;
        return fetch(FALLBACK_URL, { cache: "no-store" })
          .then(function (res) {
            if (!res.ok) throw err;
            return res.json();
          })
          .then(function (data) {
            data.__from_fallback = true;
            return data;
          });
      });
  }

  window.TH = {
    apiUrl: apiUrl,
    playerUrl: playerUrl,
    playerId: playerId,
    fetchJSON: fetchJSON,
  };
})();
