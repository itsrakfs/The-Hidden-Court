/* THE HIDDEN COURT · PADEL RANKING — public page logic v2 */

(function () {
  "use strict";

  var state = {
    players: [],
    lastUpdated: null,
    search: "",
    sort: "rank",
    filter: "all",
  };

  var els = {};
  var refreshTimer = null;
  var pollIntervalMs = 15000;

  // ------------------------------------------------------------------ utils
  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function initials(name) {
    return String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); })
      .join("") || "?";
  }

  function formatDate(iso) {
    if (!iso) return "\u2014";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "\u2014";
    var opts = { year: "numeric", month: "2-digit", day: "2-digit" };
    return d.toLocaleDateString("en-GB", opts) +
      " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function shortDate(iso) {
    if (!iso) return "\u2014";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "\u2014";
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
      " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // ------------------------------------------------------------------ fetch
  function fetchRanking(isAuto) {
    fetch("/api/ranking", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        var changed =
          JSON.stringify(data.players.map(function (p) {
            return [p.id, p.name, p.points, p.updated_at];
          })) !==
          JSON.stringify(state.players.map(function (p) {
            return [p.id, p.name, p.points, p.updated_at];
          }));

        state.players = data.players || [];
        state.lastUpdated = data.last_updated || null;
        render();

        var foot = els.footStatus;
        if (foot) {
          if (isAuto) {
            foot.textContent = changed
              ? "\u062a\u0645 \u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a"
              : "\u062a\u062d\u062f\u064a\u062b \u062a\u0644\u0642\u0627\u0626\u064a";
          } else {
            foot.textContent = "\u062a\u0645 \u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a";
          }
        }
      })
      .catch(function () {
        if (els.footStatus && isAuto) {
          els.footStatus.textContent = "\u0641\u0634\u0644 \u0627\u0644\u062a\u062d\u062f\u064a\u062b. \u0633\u0646\u0639\u064a\u062f \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629...";
        }
      });
  }

  // ------------------------------------------------------------- filtering
  function getVisiblePlayers() {
    var q = state.search.trim().toLowerCase();
    var list = state.players.slice();

    if (q) {
      list = list.filter(function (p) { return p.name.toLowerCase().indexOf(q) !== -1; });
    }

    if (state.filter !== "all") {
      var limit = parseInt(state.filter, 10);
      list = list.filter(function (p) { return p.rank <= limit; });
    }

    return list;
  }

  function sortList(list) {
    if (state.sort === "points") {
      list.sort(function (a, b) { return b.points - a.points; });
    } else {
      list.sort(function (a, b) { return a.rank - b.rank; });
    }
    return list;
  }

  // ---------------------------------------------------------------- render
  function render() {
    renderStats();
    var visible = getVisiblePlayers();
    renderPodium(visible.filter(function (p) { return p.rank <= 3; }));
    renderTable(sortList(visible.filter(function (p) { return p.rank >= 4; })));
  }

  function renderStats() {
    els.statPlayers.textContent = state.players.length;
    els.statPoints.textContent = state.players.reduce(function (s, p) { return s + (p.points || 0); }, 0);
    els.statUpdated.textContent = shortDate(state.lastUpdated);
  }

  function renderPodium(top3) {
    var podiumSection = els.podiumSection;
    var hasTop = top3.length > 0;

    if (podiumSection) {
      podiumSection.hidden = !hasTop;
      podiumSection.style.display = hasTop ? "" : "none";
    }

    var cards = document.querySelectorAll(".podium-card");
    var map = {};
    top3.forEach(function (p) { map[p.rank] = p; });

    // Restart entrance animations each time the podium is (re)populated
    Array.prototype.forEach.call(cards, function (card) {
      card.style.display = "none";
      card.classList.remove("pod-anim");
    });

    ["1", "2", "3"].forEach(function (r) {
      var p = map[r];
      var card = document.querySelector(".pod-" + r);
      if (!p) {
        if (card) card.style.display = "none";
        els["pod" + r + "Name"].textContent = "\u2014";
        els["pod" + r + "Points"].textContent = "0";
        els["pod" + r + "Avatar"].textContent = "?";
        return;
      }
      if (card) {
        card.style.display = "";
        void card.offsetWidth; // reflow to restart CSS animation
        card.classList.add("pod-anim");
      }
      els["pod" + r + "Name"].textContent = p.name;
      els["pod" + r + "Points"].textContent = p.points;
      els["pod" + r + "Avatar"].textContent = initials(p.name);
    });

    // Reveal the podium after cards are placed, so the stagger reads nicely.
    if (hasTop && podiumSection) {
      podiumSection.hidden = false;
      podiumSection.style.display = "";
    }
  }

  function renderTable(list) {
    var body = els.rankingBody;
    var empty = els.emptyState;

    if (!list.length) {
      body.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    var html = "";
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      html +=
        '<tr>' +
          '<td class="th-rank"><span class="num">' + p.rank + '</span></td>' +
          '<td class="th-player"><div class="player-cell">' +
            '<span class="initials">' + escapeHtml(initials(p.name)) + '</span>' +
            '<span>' + escapeHtml(p.name) + '</span>' +
          '</div></td>' +
          '<td class="th-num"><span class="num">' + p.points + '</span></td>' +
          '<td class="th-updated"><span class="updated-cell">' + formatDate(p.updated_at) + '</span></td>' +
        '</tr>';
    }
    body.innerHTML = html;
  }

  // ------------------------------------------------------------ controls
  function bindControls() {
    els.search.addEventListener("input", function (e) {
      state.search = e.target.value;
      render();
    });

    els.filter.addEventListener("change", function (e) {
      state.filter = e.target.value;
      render();
    });

    els.sortSelect.addEventListener("change", function (e) {
      state.sort = e.target.value;
      render();
    });
  }

  // ------------------------------------------------------------------- init
  function init() {
    els = {
      statPlayers: $("stat-players"),
      statPoints: $("stat-points"),
      statUpdated: $("stat-updated"),
      podiumSection: $("podium-section"),
      podium: $("podium"),
      search: $("search-input"),
      sortSelect: $("sort-select"),
      filter: $("filter-select"),
      rankingBody: $("ranking-body"),
      emptyState: $("empty-state"),
      footStatus: $("foot-status"),
      pod1Name: $("pod-1-name"), pod1Points: $("pod-1-points"), pod1Avatar: $("pod-1-avatar"),
      pod2Name: $("pod-2-name"), pod2Points: $("pod-2-points"), pod2Avatar: $("pod-2-avatar"),
      pod3Name: $("pod-3-name"), pod3Points: $("pod-3-points"), pod3Avatar: $("pod-3-avatar"),
    };

    var yr = $("year");
    if (yr) yr.textContent = new Date().getFullYear();

    bindControls();
    fetchRanking(false);

    refreshTimer = setInterval(function () { fetchRanking(true); }, pollIntervalMs);

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) fetchRanking(true);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();