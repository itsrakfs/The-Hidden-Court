/* THE HIDDEN COURT · ADMIN — login + dashboard logic */

(function () {
  "use strict";

  var state = {
    authenticated: false,
    csrf: null,
    players: [],
    lastUpdated: null,
    search: "",
    editingId: null,      // player id currently being row-edited (null = no inline edit)
    savingId: null,       // id whose Save button is pending
    cropTarget: null,     // input element that will receive the cropped image
  };

  var els = {};

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

  function avatarInner(p) {
    var url = (p.image || "").trim();
    if (url) {
      return '<img class="avatar-img" src="' + escapeHtml(url) +
        '" alt="" loading="lazy" onerror="this.remove()" />';
    }
    return escapeHtml(initials(p.name));
  }

  function toast(message, isError) {
    var t = els.toast;
    t.textContent = message;
    t.className = "toast" + (isError ? " error" : "");
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  // ------------------------------------------------------------------ API
  function api(url, options) {
    options = options || {};
    options.headers = Object.assign({}, options.headers || {});
    if (state.csrf && options.method && options.method !== "GET") {
      options.headers["X-CSRF-Token"] = state.csrf;
    }
    if (options.body && typeof options.body === "object") {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(options.body);
    }
    return fetch(url, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok || data.error) {
          var err = new Error(data.error || ("HTTP " + res.status));
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  // --------------------------------------------------------------- session
  function checkSession() {
    return fetch("/api/auth/me", { cache: "no-store" })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.authenticated) {
          state.authenticated = true;
          state.csrf = data.csrf || null;
          setAdminIdentity(data.username);
          showDashboard();
        } else {
          showLogin();
        }
      })
      .catch(function () { showLogin(); });
  }

  function showLogin() {
    state.authenticated = false;
    els.loginScreen.hidden = false;
    els.dashboard.hidden = true;
    setTimeout(function () { els.loginUsername.focus(); }, 50);
  }

  function showDashboard() {
    state.authenticated = true;
    els.loginScreen.hidden = true;
    els.dashboard.hidden = false;
    loadPlayers();
  }

  // ---------------------------------------------------------- auth actions
  function handleLogin(e) {
    e.preventDefault();
    var username = els.loginUsername.value.trim();
    var password = els.loginPassword.value;

    els.loginError.hidden = true;
    els.loginBtn.disabled = true;
    els.loginBtn.textContent = "\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u062d\u0642\u0642...";

    api("/api/auth/login", {
      method: "POST",
      body: { username: username, password: password },
    })
      .then(function (data) {
        state.csrf = data.csrf;
        setAdminIdentity(data.username);
        showDashboard();
      })
      .catch(function (err) {
        els.loginError.textContent =
          err.status === 401
            ? "\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u0623\u0648 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u063a\u064a\u0631 \u0635\u062d\u064a\u062d\u0629."
            : "\u062a\u0639\u0630\u0631 \u0627\u0644\u0627\u062a\u0635\u0627\u0644 \u0628\u0627\u0644\u062e\u0627\u062f\u0645.";
        els.loginError.hidden = false;
      })
      .finally(function () {
        els.loginBtn.disabled = false;
        els.loginBtn.textContent = "\u062a\u0633\u062c\u064a\u0644 \u0627\u0644\u062f\u062e\u0648\u0644";
      });
  }

  function handleLogout() {
    api("/api/auth/logout", { method: "POST" })
      .catch(function () {})
      .finally(function () {
        state.csrf = null;
        state.players = [];
        showLogin();
      });
  }

  function handleBackup() {
    var btn = els.backupBtn;
    if (btn) btn.disabled = true;
    fetch("/api/backup", {
      method: "GET",
      credentials: "same-origin",
      headers: { "Accept": "application/json" },
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.blob();
      })
      .then(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "seed_players.json";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 300);
      })
      .catch(function () {
        showToast("فشل إنشاء النسخة الاحتياطية");
      })
      .finally(function () {
        if (btn) btn.disabled = false;
      });
  }

  function setAdminIdentity(username) {
    els.adminName.textContent = username || "admin";
    els.adminAvatar.textContent = (username || "A").charAt(0).toUpperCase();
  }

  // ------------------------------------------------------------------ data
  function loadPlayers() {
    fetch("/api/ranking", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        state.players = data.players || [];
        state.lastUpdated = data.last_updated || null;
        state.totalTournaments = data.total_tournaments || 0;
        renderDashboard();
      })
      .catch(function () { toast("\u062a\u0639\u0630\u0631 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a.", true); });
  }

  function renderDashboard() {
    var players = state.players;
    var points = players.reduce(function (s, p) { return s + (p.points || 0); }, 0);

    els.kpiPlayers.textContent = players.length;
    els.kpiPoints.textContent = points;
    if (els.kpiTotalTournaments) {
      els.kpiTotalTournaments.textContent = state.totalTournaments || 0;
    }
    if (els.leagueRoundsInput) {
      els.leagueRoundsInput.value = state.totalTournaments || 0;
    }
    els.kpiUpdated.textContent = (state.lastUpdated || "\u2014")
      .toString().replace("T", " ").slice(0, 16);

    renderTable();
  }

  function filteredPlayers() {
    var q = state.search.trim().toLowerCase();
    if (!q) return state.players.slice();
    return state.players.filter(function (p) { return p.name.toLowerCase().indexOf(q) !== -1; });
  }

  // ----------------------------------------------------------------- table
  function renderTable() {
    var list = filteredPlayers();
    var body = els.adminBody;
    els.adminEmpty.hidden = list.length > 0;

    if (!list.length) {
      body.innerHTML = "";
      return;
    }

    var html = "";
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (state.editingId === p.id) {
        html += editRowHtml(p);
      } else {
        html += viewRowHtml(p);
      }
    }
    body.innerHTML = html;
  }

  function viewRowHtml(p) {
    return (
      '<tr data-id="' + p.id + '"' + (p.is_mvp ? ' class="mvp-row"' : "") + '>' +
        '<td class="th-rank">' + p.rank + "</td>" +
        '<td class="th-player"><div class="name-cell"><span class="initials">' + avatarInner(p) +
        "</span><span>" + escapeHtml(p.name) + "</span></div></td>" +
        '<td class="th-team">' + (p.team ? '<span class="team-tag">' + escapeHtml(p.team) + "</span>" : "<span class=\"muted\">\u2014</span>") + "</td>" +
        '<td class="th-num">' + p.points + "</td>" +
        '<td class="th-tournaments"><div class="trophy-ctl">' +
          '<span class="trophy-num" title="\u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a">\ud83c\udfc6\u2009' + (p.tournaments || 0) + "</span>" +
          '<button class="mini-btn" data-action="tournaments" data-delta="1" title="\u0628\u0637\u0648\u0644\u0629 \u062c\u062f\u064a\u062f\u0629">+</button>' +
          '<button class="mini-btn" data-action="tournaments" data-delta="-1" title="\u0625\u0644\u063a\u0627\u0621 \u0628\u0637\u0648\u0644\u0629">\u2212</button>' +
        "</div></td>" +
        '<td class="th-streak"><div class="streak-ctl">' +
          '<span class="streak-num" title="\u0627\u0644\u0633\u062a\u0631\u064a\u0643">\ud83d\udd25 ' + (p.streak || 0) + "</span>" +
          '<button class="mini-btn" data-action="streak" data-delta="1" title="+1">+</button>' +
          '<button class="mini-btn" data-action="streak" data-delta="-1" title="\u0646\u0642\u0635 1">\u2212</button>' +
          '<button class="mini-btn undo-btn" data-action="streak-undo" title="\u0627\u0644\u062a\u0631\u0627\u062c\u0639 \u0639\u0646 \u0622\u062e\u0631 \u062a\u0639\u062f\u064a\u0644">\u2936</button>' +
        "</div></td>" +
        '<td class="th-mvp"><div class="mvp-ctl">' +
        '<button class="star-btn' + (p.is_mvp ? " active" : "") +
          '" data-action="mvp" title="\u062a\u0639\u064a\u064a\u0646 / \u0625\u0644\u063a\u0627\u0621 MVP">' +
          (p.is_mvp ? "\u2605" : "\u2606") +
          (p.mvp_count ? '<span class="mvp-count">\u00d7' + p.mvp_count + "</span>" : "") +
        "</button>" +
        '<button class="mini-btn undo-btn" data-action="mvp-undo" title="\u0627\u0644\u062a\u0631\u0627\u062c\u0639 \u0639\u0646 \u0622\u062e\u0631 MVP">\u2936</button>' +
        "</div></td>" +
        '<td class="th-actions"><div class="row-actions">' +
          '<button class="icon-btn" data-action="edit" title="Edit"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M17 3l4 4L8 20H4v-4L17 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg></button>' +
          '<button class="icon-btn danger" data-action="delete" title="Delete"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
        "</div></td>" +
      "</tr>"
    );
  }

  function editRowHtml(p) {
    var saving = state.savingId === p.id;
    var img = (p.image || "").trim();
    var isData = img.indexOf("data:") === 0;
    var thumbHtml = img
      ? '<img src="' + escapeHtml(img) + '" alt="" onerror="this.remove()" />'
      : "";
    return (
      '<tr data-id="' + p.id + '">' +
        '<td class="th-rank">' + p.rank + "</td>" +
        '<td class="th-player"><div class="edit-img-row">' +
          '<span class="edit-row-thumb">' + thumbHtml + "</span>" +
          '<input class="name-input m-input" data-field="image" value="' +
            escapeHtml(isData ? "" : img) + '" data-image="' + escapeHtml(img) +
            '" placeholder="' + (isData
              ? "\u0635\u0648\u0631\u0629 \u0645\u0631\u0641\u0648\u0639\u0629 \u2014 \u0627\u0636\u063a\u0637 \u0623\u0648 \u0627\u062d\u0630\u0641\u0647\u0627"
              : "\u0631\u0627\u0628\u0637 \u0635\u0648\u0631\u0629") + '" />' +
          '<button class="mini-btn edit-photo-btn" data-action="photo" title="\u0631\u0641\u0639 \u0623\u0648 \u0642\u0635 \u0635\u0648\u0631\u0629 \u0645\u0646 \u0627\u0644\u062c\u0647\u0627\u0632">\ud83d\udde4</button>' +
          '<button class="mini-btn edit-photo-btn" data-action="photo-clear" title="\u0625\u0632\u0627\u0644\u0629 \u0627\u0644\u0635\u0648\u0631\u0629">\u2715</button>' +
        "</div>" +
        '<div class="name-cell edit-cell">' +
          '<input class="name-input" data-field="name" value="' + escapeHtml(p.name) + '" />' +
        "</div></td>" +
        '<td class="th-team"><input class="name-input" data-field="team" maxlength="40" value="' + escapeHtml(p.team || "") + '" placeholder="\u0641\u0631\u064a\u0642" /></td>' +
        '<td class="th-num"><input class="text-input" type="number" min="0" data-field="points" value="' + p.points + '" /></td>' +
        '<td class="th-streak"><div class="streak-ctl">' +
          '<span class="streak-num" title="\u0627\u0644\u0633\u062a\u0631\u064a\u0643">\ud83d\udd25 ' + (p.streak || 0) + "</span>" +
          '<button class="mini-btn" data-action="streak" data-delta="1" title="+1">+</button>' +
          '<button class="mini-btn" data-action="streak" data-delta="-1" title="\u0646\u0642\u0635 1">\u2212</button>' +
          '<button class="mini-btn undo-btn" data-action="streak-undo" title="\u0627\u0644\u062a\u0631\u0627\u062c\u0639 \u0639\u0646 \u0622\u062e\u0631 \u062a\u0639\u062f\u064a\u0644">\u2936</button>' +
        "</div></td>" +
        '<!--B1-->' +
        '<td class="th-tournaments"><div class="tournament-ctl" title="\u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a">' +
          '<span class="tournament-num">\ud83c\udfc6\u2009' + (p.tournaments || 0) + "</span>" +
          '<button class="mini-btn" data-action="tournaments" data-delta="1" title="+1">+</button>' +
          '<button class="mini-btn" data-action="tournaments" data-delta="-1" title="\u0646\u0642\u0635 1">\u2212</button>' +
        "</div></td>" +
        '<td class="th-mvp"><div class="mvp-ctl">' +
        '<button class="star-btn' + (p.is_mvp ? " active" : "") +
          '" data-action="mvp" title="\u062a\u0639\u064a\u064a\u0646 / \u0625\u0644\u063a\u0627\u0621 MVP">' +
          (p.is_mvp ? "\u2605" : "\u2606") +
          (p.mvp_count ? '<span class="mvp-count">\u00d7' + p.mvp_count + "</span>" : "") +
        "</button>" +
        '<button class="mini-btn undo-btn" data-action="mvp-undo" title="\u0627\u0644\u062a\u0631\u0627\u062c\u0639 \u0639\u0646 \u0622\u062e\u0631 MVP">\u2936</button>' +
        "</div></td>" +
        '<td class="th-actions"><div class="row-actions">' +
          '<button class="btn btn-primary inline-save" data-action="save" ' + (saving ? "disabled" : "") + ">" +
            (saving ? "\u062c\u0627\u0631\u064d \u0627\u0644\u062d\u0641\u0638..." : "\u062d\u0641\u0638") +
          "</button>" +
          '<button class="icon-btn" data-action="cancel" title="Cancel"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
        "</div></td>" +
      "</tr>"
    );
  }

  // --------------------------------------------------------- table actions
  function handleTableClick(e) {
    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    var tr = btn.closest("tr");
    var id = tr ? parseInt(tr.dataset.id, 10) : null;
    var action = btn.dataset.action;
    if (id === null || isNaN(id)) return;

    if (action === "edit") startEdit(id);
    else if (action === "cancel") { state.editingId = null; renderTable(); }
    else if (action === "save") saveRow(id, tr);
    else if (action === "delete") confirmDelete(id);
    else if (action === "photo") openRowPhoto(tr);
    else if (action === "photo-clear") clearRowPhoto(tr);
    else if (action === "streak") addStreak(id, btn.getAttribute("data-delta"));
    else if (action === "streak-undo") undoStreak(id);
    else if (action === "mvp") toggleMvp(id);
    else if (action === "mvp-undo") undoMvp(id);
    else if (action === "tournaments") addTournaments(id, btn.getAttribute("data-delta"));
  }

  function addStreak(id, delta) {
    api("/api/players/" + id + "/streak", { method: "POST", body: { delta: parseInt(delta, 10) || 1 } })
      .then(function (res) {
        state.players = res.players || [];
        state.lastUpdated = res.last_updated || state.lastUpdated;
        renderDashboard();
        toast("\ud83d\udd25 \u062a\u0645 \u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u0633\u062a\u0631\u064a\u0643 \u0628\u0646\u062c\u0627\u062d.");
      })
      .catch(function (err) { toast(err.message, true); });
  }

  function toggleMvp(id) {
    api("/api/players/" + id + "/mvp", { method: "POST" })
      .then(function (res) {
        state.players = res.players || [];
        state.lastUpdated = res.last_updated || state.lastUpdated;
        renderDashboard();
        toast("\u2b50 \u062a\u0645 \u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0645\u0631\u0643\u0632 (MVP).");
      })
      .catch(function (err) { toast(err.message, true); });
  }

  function undoStreak(id) {
    api("/api/players/" + id + "/streak/undo", { method: "POST" })
      .then(function (res) {
        state.players = res.players || [];
        state.lastUpdated = res.last_updated || state.lastUpdated;
        renderDashboard();
        toast("\ud83d\udd25 \u062a\u0645 \u0627\u0644\u062a\u0631\u0627\u062c\u0639 \u0639\u0646 \u0622\u062e\u0631 \u062a\u0639\u062f\u064a\u0644 \u0633\u062a\u0631\u064a\u0643.");
      })
      .catch(function (err) { toast(err.message, true); });
  }

  function undoMvp(id) {
    api("/api/players/" + id + "/mvp/undo", { method: "POST" })
      .then(function (res) {
        state.players = res.players || [];
        state.lastUpdated = res.last_updated || state.lastUpdated;
        renderDashboard();
        toast("\u2b50 \u062a\u0645 \u0627\u0644\u062a\u0631\u0627\u062c\u0639 \u0639\u0646 \u0622\u062e\u0631 \u0625\u062c\u0631\u0627\u0621 MVP \u0648\u0631\u062c\u0639\u062a \u0627\u0644\u0634\u0627\u0631\u0629 \u0644\u0645\u0646 \u064a\u0633\u062a\u062d\u0642.");
      })
      .catch(function (err) { toast(err.message, true); });
  }

  function addTournaments(id, delta) {
    api("/api/players/" + id + "/tournaments", { method: "POST", body: { delta: parseInt(delta, 10) || 1 } })
      .then(function (res) {
        state.players = res.players || [];
        state.lastUpdated = res.last_updated || state.lastUpdated;
        renderDashboard();
        toast("\ud83c\udfc6 \u062a\u0645 \u062a\u0639\u062f\u064a\u0644 \u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a \u0628\u0646\u062c\u0627\u062d.");
      })
      .catch(function (err) { toast(err.message, true); });
  }

  function findPlayer(id) {
    return state.players.filter(function (p) { return p.id === id; })[0] || null;
  }

  function startEdit(id) {
    state.editingId = id;
    state.savingId = null;
    renderTable();
    var row = els.adminBody.querySelector('tr[data-id="' + id + '"]');
    if (row) {
      var nameInput = row.querySelector('[data-field="name"]');
      if (nameInput) nameInput.focus();
    }
  }

  // live re-render from an edited row
  function collectRow(tr) {
    var inputs = tr.querySelectorAll("[data-field]");
    var data = {};
    Array.prototype.forEach.call(inputs, function (inp) {
      var field = inp.dataset.field;
      if (field === "name") {
        data.name = inp.value.trim();
      } else if (field === "team") {
        data.team = inp.value.trim();
      } else if (field === "image") {
        // A stored upload lives in data-image (kept out of the visible box);
        // typing a link in the box overrides it.
        data.image = inp.value.trim() || inp.dataset.image || "";
      } else {
        var val = parseInt(inp.value, 10);
        data[field] = isNaN(val) ? 0 : Math.max(0, val);
      }
    });
    return data;
  }

  function saveRow(id, tr) {
    var data = collectRow(tr);
    if (!data.name) { toast("\u064a\u062c\u0628 \u0625\u062f\u062e\u0627\u0644 \u0627\u0633\u0645 \u0627\u0644\u0644\u0627\u0639\u0628.", true); return; }

    state.savingId = id;
    renderTable();

    api("/api/players/" + id, { method: "PUT", body: data })
      .then(function (res) {
        state.savingId = null;
        state.editingId = null;
        state.players = res.players || [];
        state.lastUpdated = res.last_updated || state.lastUpdated;
        renderDashboard();
        toast("\u062a\u0645 \u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a \u0628\u0646\u062c\u0627\u062d.");
      })
      .catch(function (err) {
        state.savingId = null;
        renderTable();
        toast(err.message, true);
      });
  }

  function confirmDelete(id) {
    var p = findPlayer(id);
    if (!p) return;
    els.confirmText.innerHTML =
      "\u0647\u0644 \u0623\u0646\u062a \u0645\u062a\u0623\u0643\u062f \u0645\u0646 \u062d\u0630\u0641 <strong>" +
      escapeHtml(p.name) + "</strong> \u0645\u0646 \u0627\u0644\u062a\u0635\u0646\u064a\u0641\u061f \u0644\u0627 \u064a\u0645\u0643\u0646 \u0627\u0644\u062a\u0631\u0627\u062c\u0639.";
    els.confirmYes.dataset.id = id;
    els.confirmBg.hidden = false;
  }

  function doDelete() {
    var id = parseInt(els.confirmYes.dataset.id, 10);
    els.confirmBg.hidden = true;
    api("/api/players/" + id, { method: "DELETE" })
      .then(function (res) {
        state.players = res.players || [];
        state.lastUpdated = res.last_updated || state.lastUpdated;
        renderDashboard();
        toast("\u062a\u0645 \u062d\u0630\u0641 \u0627\u0644\u0644\u0627\u0639\u0628.");
      })
      .catch(function (err) { toast(err.message, true); });
  }

  // ----------------------------------------------------------------- modal
  function openAddModal() {
    els.playerForm.reset();
    els.pfId.value = "";
    els.modalTitle.textContent = "\u0625\u0636\u0627\u0641\u0629 \u0644\u0627\u0639\u0628 \u062c\u062f\u064a\u062f";
    els.pfError.hidden = true;
    els.pfFile.value = "";
    updateThumb(els.pfImage.value || "");
    els.modalBg.hidden = false;
    setTimeout(function () { els.pfName.focus(); }, 50);
  }

  function closeModal() {
    els.modalBg.hidden = true;
  }

  function submitPlayer(e) {
    e.preventDefault();
    var data = {
      name: els.pfName.value.trim(),
      points: parseInt(els.pfPoints.value, 10) || 0,
      team: els.pfTeam.value.trim(),
      image: els.pfImage.value.trim(),
    };

    if (!data.name) {
      showFormError("\u064a\u062c\u0628 \u0625\u062f\u062e\u0627\u0644 \u0627\u0633\u0645 \u0627\u0644\u0644\u0627\u0639\u0628.");
      return;
    }

    els.pfSubmit.disabled = true;
    els.pfSubmit.textContent = "\u062c\u0627\u0631\u064d \u0627\u0644\u062d\u0641\u0638...";

    api("/api/players", { method: "POST", body: data })
      .then(function (res) {
        state.players = res.players || [];
        state.lastUpdated = res.last_updated || state.lastUpdated;
        els.pfSubmit.disabled = false;
        els.pfSubmit.textContent = "\u062d\u0641\u0638";
        els.modalBg.hidden = true;
        renderDashboard();
        toast("\u062a\u0645\u062a \u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0644\u0627\u0639\u0628 \u0628\u0646\u062c\u0627\u062d.");
      })
      .catch(function (err) {
        els.pfSubmit.disabled = false;
        els.pfSubmit.textContent = "\u062d\u0641\u0638";
        showFormError(err.message);
      });
  }

  function showFormError(msg) {
    els.pfError.textContent = msg;
    els.pfError.hidden = false;
  }

  function updateThumb(src) {
    var t = els.pfThumb;
    var url = (src || "").trim();
    if (url) {
      t.innerHTML = '<img class="thumb-img" src="' + escapeHtml(url) + '" alt="" onerror="this.remove()" />';
      els.pfRemove.hidden = false;
    } else {
      t.textContent = "?";
      els.pfRemove.hidden = true;
    }
  }

  // --------------------------------------------------------------- image crop
  var crop = {
    img: null,      // HTMLImageElement
    scale: 1,       // cover base scale
    zoom: 1,
    dragX: 0, dragY: 0,   // cumulative pan offset (canvas px)
    startX: 0, startY: 0, // pointer start (client px)
    imgX0: 0, imgY0: 0,   // pointer-start cumulative offset
    dragging: false,
  };

  var CROP_SIZE = 420;

  function prepareCropImage(src, cb) {
    var img = new Image();
    img.onload = function () { cb(null, img); };
    img.onerror = function () { cb(new Error("\u062a\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0635\u0648\u0631\u0629."), null); };
    img.src = src;
  }

  function cropInit(img) {
    crop.img = img;
    var base = Math.max(CROP_SIZE / img.naturalWidth, CROP_SIZE / img.naturalHeight);
    crop.scale = base;
    crop.zoom = 1;
    crop.dragX = 0; crop.dragY = 0;
    els.cropZoom.value = "1";
    cropDraw();
  }

  function cropDraw() {
    var canvas = els.cropCanvas;
    var ctx = canvas.getContext("2d");
    var z = crop.zoom;
    var s = crop.scale * z;
    var dw = crop.img.naturalWidth * s;
    var dh = crop.img.naturalHeight * s;
    var maxX = Math.max(0, (dw - CROP_SIZE) / 2);
    var maxY = Math.max(0, (dh - CROP_SIZE) / 2);
    crop.dragX = Math.max(-maxX, Math.min(maxX, crop.dragX));
    crop.dragY = Math.max(-maxY, Math.min(maxY, crop.dragY));
    var drawX = -dw / 2 + CROP_SIZE / 2 + crop.dragX;
    var drawY = -dh / 2 + CROP_SIZE / 2 + crop.dragY;

    ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
    ctx.save();
    ctx.beginPath();
    ctx.arc(CROP_SIZE / 2, CROP_SIZE / 2, CROP_SIZE / 2 - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(crop.img, drawX, drawY, dw, dh);
    ctx.restore();
    ctx.strokeStyle = "rgba(168,85,247,.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(CROP_SIZE / 2, CROP_SIZE / 2, CROP_SIZE / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
  }

  function cropSave() {
    if (!crop.img) return;
    var s = crop.scale * crop.zoom;
    var sx = crop.img.naturalWidth / 2 - (CROP_SIZE / 2 + crop.dragX) / s;
    var sy = crop.img.naturalHeight / 2 - (CROP_SIZE / 2 + crop.dragY) / s;
    var side = CROP_SIZE / s;

    var out = document.createElement("canvas");
    out.width = 256;
    out.height = 256;
    var octx = out.getContext("2d");
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(crop.img, sx, sy, side, side, 0, 0, 256, 256);
    var dataUrl = out.toDataURL("image/jpeg", 0.88);
    var target = state.cropTarget || els.pfImage;
    if (!target) return;
    if (target === els.pfImage) {
      target.value = dataUrl;
      updateThumb(dataUrl);
    } else {
      target.value = "";
      target.dataset.image = dataUrl;
      updateRowThumb(target);
    }
    cropClose();
    toast("\ud83d\udcf7 \u062a\u0645 \u0636\u0628\u0637 \u0627\u0644\u0635\u0648\u0631\u0629.");
  }

  function updateRowThumb(input) {
    var tr = input.closest("tr");
    if (!tr) return;
    var thumb = tr.querySelector(".edit-row-thumb");
    if (!thumb) return;
    var url = (input.value || "").trim() || input.dataset.image || "";
    thumb.innerHTML = url
      ? '<img src="' + escapeHtml(url) + '" alt="" onerror="this.remove()" />'
      : "";
  }

  function openCrop() {
    els.cropBg.hidden = false;
    setTimeout(function () { cropDraw(); }, 30);
  }

  function cropClose() {
    els.cropBg.hidden = true;
    crop.img = null;
  }

  function handlePfFile(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      prepareCropImage(ev.target.result, function (err, img) {
        if (err) { toast(err.message, true); return; }
        cropInit(img);
        if (els.cropBg.hidden) openCrop();
        else cropDraw();
      });
    };
    reader.readAsDataURL(file);
  }

  function cropZoomChanged() {
    crop.zoom = parseFloat(els.cropZoom.value) || 1;
    cropDraw();
  }

  function cropStageDown(e) {
    if (!crop.img) return;
    crop.dragging = true;
    crop.startX = e.clientX;
    crop.startY = e.clientY;
    crop.imgX0 = crop.dragX;
    crop.imgY0 = crop.dragY;
    els.cropStage.classList.add("dragging");
    e.preventDefault();
  }

  function cropStageMove(e) {
    if (!crop.dragging) return;
    var disp = els.cropStage.clientWidth || CROP_SIZE;
    var k = CROP_SIZE / disp;
    crop.dragX = crop.imgX0 + (e.clientX - crop.startX) * k;
    crop.dragY = crop.imgY0 + (e.clientY - crop.startY) * k;
    cropDraw();
    e.preventDefault();
  }

  function cropStageUp() {
    crop.dragging = false;
    els.cropStage.classList.remove("dragging");
  }

  function openRowPhoto(tr) {
    var input = tr.querySelector('[data-field="image"]');
    if (!input) return;
    state.cropTarget = input;
    var existing = (input.value || "").trim() || input.dataset.image || "";
    if (existing) {
      // already has a photo -> reopen the cropper on it so it can be adjusted
      prepareCropImage(existing, function (err, img) {
        if (err) { els.pfFile.value = ""; els.pfFile.click(); return; }
        cropInit(img);
        openCrop();
      });
    } else {
      els.pfFile.value = "";
      els.pfFile.click();
    }
  }

  function clearRowPhoto(tr) {
    var input = tr.querySelector('[data-field="image"]');
    if (!input) return;
    input.value = "";
    input.dataset.image = "";
    updateRowThumb(input);
    toast("\ud83d\uddd1 \u062a\u0645 \u0625\u0632\u0627\u0644\u0629 \u0627\u0644\u0635\u0648\u0631\u0629 (\u0627\u062d\u0641\u0638 \u0627\u0644\u0635\u0641 \u0644\u062a\u062d\u0641\u064a\u0638\u0647\u0627).");
  }

  // ---------------------------------------------------------------- bind
  function bind() {
    els.loginForm.addEventListener("submit", handleLogin);
    els.logoutBtn.addEventListener("click", handleLogout);
    els.passToggle.addEventListener("click", function () {
      var inp = els.loginPassword;
      inp.type = inp.type === "password" ? "text" : "password";
    });

    els.addPlayerBtn.addEventListener("click", openAddModal);
    if (els.backupBtn) els.backupBtn.addEventListener("click", handleBackup);
    els.modalClose.addEventListener("click", closeModal);
    els.modalCancel.addEventListener("click", closeModal);
    els.modalBg.addEventListener("click", function (e) { if (e.target === els.modalBg) closeModal(); });
    els.playerForm.addEventListener("submit", submitPlayer);
    els.pfUpload.addEventListener("click", function () {
      state.cropTarget = els.pfImage;
      els.pfFile.value = "";
      els.pfFile.click();
    });
    els.pfFile.addEventListener("change", handlePfFile);
    els.pfRemove.addEventListener("click", function () {
      els.pfImage.value = "";
      updateThumb("");
    });
    els.pfImage.addEventListener("input", function () { updateThumb(els.pfImage.value); });

    els.cropClose.addEventListener("click", cropClose);
    els.cropCancel.addEventListener("click", cropClose);
    els.cropBg.addEventListener("click", function (e) { if (e.target === els.cropBg) cropClose(); });
    els.cropSave.addEventListener("click", cropSave);
    els.cropReplace.addEventListener("click", function () {
      els.pfFile.value = "";
      els.pfFile.click();
    });
    els.cropZoom.addEventListener("input", cropZoomChanged);
    els.cropStage.addEventListener("pointerdown", cropStageDown);
    document.addEventListener("pointermove", cropStageMove);
    document.addEventListener("pointerup", cropStageUp);

    els.confirmCancel.addEventListener("click", function () { els.confirmBg.hidden = true; });
    els.confirmBg.addEventListener("click", function (e) { if (e.target === els.confirmBg) els.confirmBg.hidden = true; });
    els.confirmYes.addEventListener("click", doDelete);

    els.adminBody.addEventListener("click", handleTableClick);
    els.adminBody.addEventListener("input", function (e) {
      var t = e.target;
      if (t && t.dataset && t.dataset.field === "image") updateRowThumb(t);
    });
    els.adminSearch.addEventListener("input", function (e) {
      state.search = e.target.value;
      renderTable();
    });

    if (els.leagueTournamentBtn) {
      els.leagueTournamentBtn.addEventListener("click", function () {
        api("/api/league/tournament", { method: "POST" })
          .then(function (res) {
            state.players = res.players || [];
            state.lastUpdated = res.last_updated || state.lastUpdated;
            state.totalTournaments = res.total_tournaments || (state.totalTournaments + 1);
            renderDashboard();
            toast("\ud83c\udfc6 \u062a\u0645 \u062a\u0633\u062c\u064a\u0644 \u062f\u0648\u0631\u0629 \u062c\u062f\u064a\u062f\u0629 \u0644\u0644\u062f\u0648\u0631\u064a.");
          })
          .catch(function (err) { toast(err.message, true); });
      });
    }

    if (els.leagueRoundsSet && els.leagueRoundsInput) {
      els.leagueRoundsSet.addEventListener("click", function () {
        var val = parseInt(els.leagueRoundsInput.value, 10);
        if (isNaN(val) || val < 0) val = 0;
        api("/api/league/tournament", { method: "POST", body: { total: val } })
          .then(function (res) {
            state.players = res.players || [];
            state.lastUpdated = res.last_updated || state.lastUpdated;
            state.totalTournaments = res.total_tournaments || 0;
            renderDashboard();
            toast("\ud83c\udfc6 \u062a\u0645 \u062a\u0639\u064a\u064a\u0646 \u0639\u062f\u062f \u0627\u0644\u062f\u0648\u0631\u0627\u062a \u0625\u0644\u0649 " + val + ".");
          })
          .catch(function (err) { toast(err.message, true); });
      });
      els.leagueRoundsInput.addEventListener("change", function () {
        els.leagueRoundsInput.value = parseInt(els.leagueRoundsInput.value, 10) || 0;
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (!els.modalBg.hidden) els.modalBg.hidden = true;
        if (!els.confirmBg.hidden) els.confirmBg.hidden = true;
        if (!els.cropBg.hidden) cropClose();
      }
    });
  }

  function init() {
    els = {
      loginScreen: $("login-screen"),
      dashboard: $("dashboard"),
      loginForm: $("login-form"),
      loginUsername: $("login-username"),
      loginPassword: $("login-password"),
      loginError: $("login-error"),
      loginBtn: $("login-btn"),
      passToggle: $("pass-toggle"),
      logoutBtn: $("logout-btn"),
      adminName: $("admin-name"),
      adminAvatar: $("admin-avatar"),

      kpiPlayers: $("kpi-players"),
      kpiPoints: $("kpi-points"),
      kpiTotalTournaments: $("kpi-total-tournaments"),
      leagueTournamentBtn: $("league-tournament-btn"),
      leagueRoundsSet: $("league-rounds-set"),
      leagueRoundsInput: $("league-rounds-input"),
      kpiUpdated: $("kpi-updated"),
      adminSearch: $("admin-search"),
      adminBody: $("admin-body"),
      adminEmpty: $("admin-empty"),

      addPlayerBtn: $("add-player-btn"),
      backupBtn: $("backup-btn"),
      modalBg: $("modal-bg"),
      modalTitle: $("modal-title"),
      modalClose: $("modal-close"),
      modalCancel: $("modal-cancel"),
      playerForm: $("player-form"),
      pfId: $("pf-id"),
      pfName: $("pf-name"),
      pfPoints: $("pf-points"),
      pfTeam: $("pf-team"),
      pfImage: $("pf-image"),
      pfThumb: $("pf-thumb"),
      pfUpload: $("pf-upload"),
      pfRemove: $("pf-remove"),
      pfFile: $("pf-file"),
      pfError: $("pf-error"),
      pfSubmit: $("pf-submit"),

      cropBg: $("crop-bg"),
      cropCanvas: $("crop-canvas"),
      cropStage: $("crop-stage"),
      cropZoom: $("crop-zoom"),
      cropClose: $("crop-close"),
      cropCancel: $("crop-cancel"),
      cropSave: $("crop-save"),
      cropReplace: $("crop-replace"),

      confirmBg: $("confirm-bg"),
      confirmText: $("confirm-text"),
      confirmYes: $("confirm-yes"),
      confirmCancel: $("confirm-cancel"),

      toast: $("toast"),
    };

    bind();
    checkSession();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();