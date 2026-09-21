/* THE HIDDEN COURT · PADEL RANKING — public page logic v3 */

(function () {
  "use strict";

  var state = {
    players: [],
    lastUpdated: null,
    search: "",
    sort: "rank",
    filter: "all",
    team: "all",
  };

  var els = {};
  var refreshTimer = null;
  var pollIntervalMs = 15000;
  var NEW_DAYS = 7;

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

  function isNew(p) {
    if (!p.created_at) return false;
    var d = new Date(p.created_at);
    if (isNaN(d.getTime())) return false;
    return (Date.now() - d.getTime()) < NEW_DAYS * 24 * 60 * 60 * 1000;
  }

  function mvpBadgeHtml() {
    return '<span class="mvp-badge">MVP</span>';
  }

  function avatarInner(p) {
    var url = (p.image || "").trim();
    if (url) {
      return '<img class="avatar-img" src="' + escapeHtml(url) +
        '" alt="" loading="lazy" onerror="this.remove()" />';
    }
    return escapeHtml(initials(p.name));
  }

  function streakHtml(p) {
    if (!(p.streak > 0)) return "";
    return '<span class="streak-chip">\ud83d\udd25 ' + p.streak + '</span>';
  }

  function mvpCountHtml(p) {
    if (!(p.mvp_count > 0)) return "";
    return '<span class="mvp-count-badge" title="\u0645\u0631\u0627\u062a \u0627\u0644\u0645\u0641">\u2b50 ' + p.mvp_count + '</span>';
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
            return [p.id, p.name, p.points, p.team, p.image, p.streak, p.is_mvp, p.updated_at];
          })) !==
          JSON.stringify(state.players.map(function (p) {
            return [p.id, p.name, p.points, p.team, p.image, p.streak, p.is_mvp, p.updated_at];
          }));

        state.players = data.players || [];
        state.lastUpdated = data.last_updated || null;
        state.total_tournaments = data.total_tournaments || 0;
        populateTeams();
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

  // -------------------------------------------------------- team select fill
  function populateTeams() {
    var sel = els.teamSelect;
    if (!sel) return;
    var teams = [];
    state.players.forEach(function (p) {
      var t = (p.team || "").trim();
      if (t && teams.indexOf(t) === -1) teams.push(t);
    });
    teams.sort();

    var cur = state.team;
    if (teams.indexOf(cur) === -1) cur = "all";

    var html = '<option value="all">\u0643\u0644 \u0627\u0644\u0641\u0631\u0642</option>';
    teams.forEach(function (t) {
      html += '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + '</option>';
    });

    if (sel.innerHTML !== html) {
      sel.innerHTML = html;
      sel.value = cur;
      state.team = cur;
    }
  }

  // ------------------------------------------------------------- filtering
  function getVisiblePlayers() {
    var q = state.search.trim().toLowerCase();
    var list = state.players.slice();

    if (q) {
      list = list.filter(function (p) { return p.name.toLowerCase().indexOf(q) !== -1; });
    }

    if (state.team !== "all") {
      list = list.filter(function (p) { return (p.team || "") === state.team; });
    }

    if (state.filter !== "all") {
      var limit = parseInt(state.filter, 10);
      list = list.filter(function (p) { return p.rank <= limit; });
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
    var totalPoints = state.players.reduce(function (s, p) { return s + (p.points || 0); }, 0);
    var totalTournaments = state.total_tournaments || 0;
    animateValue(els.statPlayers, state.players.length, "players");
    animateValue(els.statPoints, totalPoints, "points");
    els.statAvg.textContent = state.players.length
      ? Math.round(totalPoints / state.players.length)
      : "\u2014";
    animateValue(els.statTournaments, totalTournaments, "tournaments");
  }

  // Animated number counter (animates the first paint only; instant afterwards)
  var statsFirst = { players: true, points: true, tournaments: true };
  function animateValue(el, target, key) {
    if (!el) return;
    if (statsFirst[key]) {
      statsFirst[key] = false;
      var from = 0;
      var start = null;
      var dur = 900;
      function tick(ts) {
        if (start === null) start = ts;
        var p = Math.min(1, (ts - start) / dur);
        p = 1 - Math.pow(1 - p, 3); // easeOutCubic
        el.textContent = Math.round(from + (target - from) * p);
        if (p < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    } else {
      el.textContent = target;
    }
  }

  function teamLabel(p) {
    var t = (p.team || "").trim();
    return t ? '<span class="team-tag">' + escapeHtml(t) + '</span>' : "";
  }

  function trendHtml(trend) {
    if (trend === "up") return '<span class="trend trend-up" title="\u0632\u064a\u0627\u062f\u0629 \u0627\u0644\u0646\u0642\u0627\u0637">\u25b4</span>';
    if (trend === "down") return '<span class="trend trend-down" title="\u0627\u0646\u062e\u0641\u0627\u0636 \u0627\u0644\u0646\u0642\u0627\u0637">\u25be</span>';
    return "";
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
        els["pod" + r + "Avatar"].innerHTML = "?";
        els["pod" + r + "Avatar"].className = "pod-avatar";
        els["pod" + r + "Avatar"].onclick = null;
        var t = els["pod" + r + "Trend"];
        if (t) { t.textContent = ""; t.className = "trend"; }
        return;
      }
      if (card) {
        card.style.display = "";
        if (p.is_mvp) card.classList.add("mvp"); else card.classList.remove("mvp");
        void card.offsetWidth; // reflow to restart CSS animation
        card.classList.add("pod-anim");
      }
      els["pod" + r + "Points"].textContent = p.points;

      var nameEl = els["pod" + r + "Name"];
      nameEl.innerHTML = '<a class="pod-link" href="/player/' + p.id + '">' + escapeHtml(p.name) + '</a>' +
        (p.is_mvp ? mvpBadgeHtml() : "") +
        streakHtml(p) +
        mvpCountHtml(p);
      if (els["pod" + r + "Avatar"]) {
        els["pod" + r + "Avatar"].innerHTML = avatarInner(p);
        els["pod" + r + "Avatar"].className = "pod-avatar pod-avatar-link";
        els["pod" + r + "Avatar"].onclick = function () { location.href = "/player/" + p.id; };
      }

      var team = els["pod" + r + "Team"];
      if (team) team.textContent = (p.team || "").trim() || "";

      var trend = els["pod" + r + "Trend"];
      if (trend) {
        trend.textContent = p.trend === "up" ? "\u25b4" : p.trend === "down" ? "\u25be" : "";
        trend.className = "trend" + (p.trend === "up" ? " trend-up" : p.trend === "down" ? " trend-down" : "");
      }
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
        '<tr data-player-id="' + p.id + '"' + (p.is_mvp ? ' class="mvp-row"' : "") + '>' +
          '<td class="th-rank"><span class="num">' + p.rank + '</span></td>' +
          '<td class="th-player"><div class="player-cell">' +
            '<a class="initials" href="/player/' + p.id + '" aria-label="\u0628\u0631\u0648\u0641\u0627\u064a\u0644 ' + escapeHtml(p.name) + '">' + avatarInner(p) + '</a>' +
            '<span class="player-name-cell">' +
              '<a class="player-link" href="/player/' + p.id + '">' +
                escapeHtml(p.name) +
              '</a>' +
              (p.is_mvp ? mvpBadgeHtml() : "") +
              streakHtml(p) +
              mvpCountHtml(p) +
              (isNew(p) ? '<span class="new-badge">\u062c\u062f\u064a\u062f</span>' : "") +
            '</span>' +
            teamLabel(p) +
          '</div></td>' +
          '<td class="th-num"><span class="num">' + p.points + '</span> ' +
            '<span class="points-label">pt</span> ' +
            trendHtml(p.trend) + '</td>' +
          '<td class="th-actions"><div class="row-actions">' +
            '<button class="share-btn" type="button" data-id="' + p.id + '" data-name="' + escapeHtml(p.name) + '" aria-label="\u0645\u0634\u0627\u0631\u0643\u0629">' +
              '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="18" cy="5" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="19" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" stroke="currentColor" stroke-width="2"/></svg>' +
            '</button>' +
          '</div></td>' +
        '</tr>';
    }
    body.innerHTML = html;
    // Staggered row entrance (only the first time, to avoid re-animating on polling)
    if (!renderTable.didAnimate) {
      renderTable.didAnimate = true;
      var rows = body.querySelectorAll("tr");
      Array.prototype.forEach.call(rows, function (r, idx) {
        r.style.animationDelay = Math.min(idx * 0.045, 0.9) + "s";
        r.classList.add("row-in");
      });
    }
    bindShareButtons();
  }

  // --------------------------------------------------------------- sharing
  function bindShareButtons() {
    var btns = document.querySelectorAll(".share-btn");
    Array.prototype.forEach.call(btns, function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute("data-id");
        var name = btn.getAttribute("data-name");
        var url = location.origin + location.pathname + "#player=" + id;
        sharePlayer(url, name);
      };
    });
  }

  function sharePlayer(url, name) {
    if (navigator.share) {
      navigator.share({ title: "The Hidden Court", text: name + " \u2014 \u0627\u0644\u0645\u0648\u0642\u0639", url: url })
        .catch(function () {});
      return;
    }
    copyToClipboard(url);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showToast("\u062a\u0645 \u0646\u0633\u062e \u0627\u0644\u0631\u0627\u0628\u0637");
      }).catch(function () { showToast("\u062a\u0645 \u062a\u062c\u0647\u064a\u0632 \u0627\u0644\u0631\u0627\u0628\u0637"); });
    } else {
      showToast(location.origin + location.pathname + "#player=" + currentHashPlayer());
    }
  }

  function currentHashPlayer() {
    var m = location.hash.match(/player=(\d+)/);
    return m ? m[1] : "";
  }

  var toastTimer = null;
  function showToast(msg) {
    var el = els.toast;
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  function highlightPlayer() {
    var m = location.hash.match(/player=(\d+)/);
    if (!m) return;
    var id = parseInt(m[1], 10);
    var row = document.querySelector('tr[data-player-id="' + id + '"]');
    if (!row) return;
    row.classList.add("highlight-row");
    setTimeout(function () { row.classList.remove("highlight-row"); }, 4000);
    row.scrollIntoView({ behavior: "smooth", block: "center" });
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

    els.teamSelect.addEventListener("change", function (e) {
      state.team = e.target.value;
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
      statAvg: $("stat-avg"),
      statTournaments: $("stat-tournaments"),
      podiumSection: $("podium-section"),
      podium: $("podium"),
      search: $("search-input"),
      sortSelect: $("sort-select"),
      filter: $("filter-select"),
      teamSelect: $("team-select"),
      rankingBody: $("ranking-body"),
      emptyState: $("empty-state"),
      footStatus: $("foot-status"),
      toast: $("toast"),
      pod1Name: $("pod-1-name"), pod1Points: $("pod-1-points"), pod1Avatar: $("pod-1-avatar"), pod1Team: $("pod-1-team"), pod1Trend: $("pod-1-trend"),
      pod2Name: $("pod-2-name"), pod2Points: $("pod-2-points"), pod2Avatar: $("pod-2-avatar"), pod2Team: $("pod-2-team"), pod2Trend: $("pod-2-trend"),
      pod3Name: $("pod-3-name"), pod3Points: $("pod-3-points"), pod3Avatar: $("pod-3-avatar"), pod3Team: $("pod-3-team"), pod3Trend: $("pod-3-trend"),
    };

    var yr = $("year");
    if (yr) yr.textContent = new Date().getFullYear();

    bindControls();
    fetchRanking(false);
    highlightPlayer();

    window.addEventListener("hashchange", highlightPlayer);

    refreshTimer = setInterval(function () { fetchRanking(true); }, pollIntervalMs);

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) fetchRanking(true);
    });
  }

  function sortList(list) {
    if (state.sort === "points") {
      list.sort(function (a, b) { return b.points - a.points; });
    } else {
      list.sort(function (a, b) { return a.rank - b.rank; });
    }
    return list;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();