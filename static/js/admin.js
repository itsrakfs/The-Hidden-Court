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
        renderDashboard();
      })
      .catch(function () { toast("\u062a\u0639\u0630\u0631 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a.", true); });
  }

  function renderDashboard() {
    var players = state.players;
    var points = players.reduce(function (s, p) { return s + (p.points || 0); }, 0);

    els.kpiPlayers.textContent = players.length;
    els.kpiPoints.textContent = points;
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
        "</div></td>" +
        '<td class="th-mvp"><button class="star-btn' + (p.is_mvp ? " active" : "") +
          '" data-action="mvp" title="\u062a\u0639\u064a\u064a\u0646 / \u0625\u0644\u063a\u0627\u0621 MVP">' +
          (p.is_mvp ? "\u2605" : "\u2606") +
          (p.mvp_count ? '<span class="mvp-count">\u00d7' + p.mvp_count + "</span>" : "") +
        "</button></td>" +
        '<td class="th-actions"><div class="row-actions">' +
          '<button class="icon-btn" data-action="edit" title="Edit"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M17 3l4 4L8 20H4v-4L17 3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg></button>' +
          '<button class="icon-btn danger" data-action="delete" title="Delete"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
        "</div></td>" +
      "</tr>"
    );
  }

  function editRowHtml(p) {
    var saving = state.savingId === p.id;
    return (
      '<tr data-id="' + p.id + '">' +
        '<td class="th-rank">' + p.rank + "</td>" +
        '<td class="th-player"><div class="name-cell edit-cell">' +
          '<input class="name-input m-input" data-field="image" value="' + escapeHtml(p.image || "") + '" placeholder="\u0627\u0644\u0635\u0648\u0631\u0629" />' +
          '<input class="name-input" data-field="name" value="' + escapeHtml(p.name) + '" />' +
        "</div></td>" +
        '<td class="th-team"><input class="name-input" data-field="team" maxlength="40" value="' + escapeHtml(p.team || "") + '" placeholder="\u0641\u0631\u064a\u0642" /></td>' +
        '<td class="th-num"><input class="text-input" type="number" min="0" data-field="points" value="' + p.points + '" /></td>' +
        '<td class="th-streak"><div class="streak-ctl">' +
          '<span class="streak-num" title="\u0627\u0644\u0633\u062a\u0631\u064a\u0643">\ud83d\udd25 ' + (p.streak || 0) + "</span>" +
          '<button class="mini-btn" data-action="streak" data-delta="1" title="+1">+</button>' +
          '<button class="mini-btn" data-action="streak" data-delta="-1" title="\u0646\u0642\u0635 1">\u2212</button>' +
        "</div></td>" +
        '<!--B1-->' +
        '<td class="th-tournaments"><div class="tournament-ctl" title="\u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a">' +
          '<span class="tournament-num">\ud83c\udfc6\u2009' + (p.tournaments || 0) + "</span>" +
          '<button class="mini-btn" data-action="tournaments" data-delta="1" title="+1">+</button>' +
          '<button class="mini-btn" data-action="tournaments" data-delta="-1" title="\u0646\u0642\u0635 1">\u2212</button>' +
        "</div></td>" +
        '<td class="th-mvp"><button class="star-btn' + (p.is_mvp ? " active" : "") +
          '" data-action="mvp" title="\u062a\u0639\u064a\u064a\u0646 / \u0625\u0644\u063a\u0627\u0621 MVP">' +
          (p.is_mvp ? "\u2605" : "\u2606") +
        "</button></td>" +
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
    else if (action === "streak") addStreak(id, btn.getAttribute("data-delta"));
    else if (action === "mvp") toggleMvp(id);
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
        data.image = inp.value.trim();
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

    els.confirmCancel.addEventListener("click", function () { els.confirmBg.hidden = true; });
    els.confirmBg.addEventListener("click", function (e) { if (e.target === els.confirmBg) els.confirmBg.hidden = true; });
    els.confirmYes.addEventListener("click", doDelete);

    els.adminBody.addEventListener("click", handleTableClick);
    els.adminSearch.addEventListener("input", function (e) {
      state.search = e.target.value;
      renderTable();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        if (!els.modalBg.hidden) els.modalBg.hidden = true;
        if (!els.confirmBg.hidden) els.confirmBg.hidden = true;
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
      pfError: $("pf-error"),
      pfSubmit: $("pf-submit"),

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