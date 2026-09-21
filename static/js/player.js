/* THE HIDDEN COURT · player profile page */

(function () {
  "use strict";

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

  function shortDate(iso) {
    if (!iso) return "\u2014";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "\u2014";
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
      " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function trendChar(trend) {
    if (trend === "up") return "\u25b4";
    if (trend === "down") return "\u25be";
    return "";
  }

  // Truncated list (fits up to 14 points) for a smooth readable chart.
  function buildChart(points) {
    var list = [];
    var step = Math.max(1, Math.ceil(points.length / 14));
    for (var i = 0; i < points.length; i += step) list.push(points[i]);
    if (list[list.length - 1] !== points[points.length - 1]) list.push(points[points.length - 1]);
    return list;
  }

  function renderChart(svg, values) {
    if (!values || values.length < 2) {
      if (values && values.length === 1) {
        var p0 = values[0];
        var dot = '  <circle cx="50" cy="' + (40 - p0 * 30) + '" r="1.4" fill="#c084fc"/>' +
                  '  <circle cx="50" cy="' + (40 - p0 * 30) + '" r="3" fill="none" stroke="#c084fc" stroke-width="0.6"/>';
        svg.setAttribute("viewBox", "0 0 100 40");
        svg.innerHTML = dot;
      } else {
        svg.innerHTML = "";
      }
      return;
    }

    var max = Math.max.apply(null, values);
    var min = Math.min.apply(null, values);
    var span = (max - min) || 1;
    // pad so the line never sits exactly on the top/bottom edge
    var top = max + span * 0.15;
    var bottom = Math.max(0, min - span * 0.15);
    var range = (top - bottom) || 1;

    var n = values.length;
    var path = "";
    var lastX = null, lastY = null;
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 100;
      var y = 40 - ((values[i] - bottom) / range) * 36 - 2;
      if (i === 0) path += "M" + x.toFixed(2) + " " + y.toFixed(2);
      else path += " L" + x.toFixed(2) + " " + y.toFixed(2);
      lastX = x; lastY = y;
    }

    // area fill under the line
    var area = path + " L" + lastX.toFixed(2) + " 38 L0 38 Z";

    svg.setAttribute("viewBox", "0 0 100 40");
    svg.innerHTML =
      '  <defs>' +
      '    <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">' +
      '      <stop offset="0" stop-color="#c084fc" stop-opacity="0.35"/>' +
      '      <stop offset="1" stop-color="#c084fc" stop-opacity="0.02"/>' +
      '    </linearGradient>' +
      '  </defs>' +
      '  <path d="' + area + '" fill="url(#chartFill)"/>' +
      '  <path d="' + path + '" fill="none" stroke="#c084fc" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/>' +
      '  <circle cx="' + lastX.toFixed(2) + '" cy="' + lastY.toFixed(2) + '" r="1.3" fill="#e9d5ff"/>';
  }

  function deltaLabel(delta) {
    var cls = delta > 0 ? "hist-up" : delta < 0 ? "hist-down" : "hist-flat";
    var sign = delta > 0 ? "+\u0020" : "";
    return '<span class="delta ' + cls + '">' + sign + delta + '</span>';
  }

  function render(data) {
    var p = data.player;
    var st = data.stats || {};
    var hist = data.history || [];

    $("p-name").textContent = p.name;

    var av = $("p-avatar");
    if ((p.image || "").trim()) {
      av.textContent = "";
      av.style.background = "";
      av.innerHTML = '<img class="avatar-img" src="' + escapeHtml(p.image.trim()) + '" alt="" loading="lazy" onerror="this.remove()" />';
    } else {
      av.innerHTML = "";
      av.textContent = initials(p.name);
      av.style.background = "linear-gradient(145deg, rgba(124,58,237,.55), rgba(91,33,182,.55))";
    }

    $("p-points").textContent = p.points;

    var mvpEl = $("p-mvp");
    if (mvpEl) mvpEl.hidden = !p.is_mvp;

    var streakEl = $("p-streak");
    if (streakEl) {
      if (p.streak > 0) { streakEl.textContent = "\ud83d\udd25 " + p.streak; streakEl.hidden = false; }
      else streakEl.hidden = true;
    }

    if (p.team && p.team.trim()) {
      $("p-team").textContent = p.team.trim();
      $("p-team").hidden = false;
    } else {
      $("p-team").hidden = true;
    }

    var rank = p.rank != null ? "#" + p.rank : "\u2014";
    $("p-rank").textContent = rank;

    var t = $("p-trend");
    t.textContent = trendChar(p.trend);
    t.className = "trend" + (p.trend === "up" ? " trend-up" : p.trend === "down" ? " trend-down" : "");

    $("s-matches").textContent = st.matches != null ? st.matches : "\u2014";
    $("s-peak").textContent = st.peak != null ? st.peak : "\u2014";
    $("s-season").textContent = st.season_points != null ? st.season_points : "\u2014";
    $("s-first").textContent = st.matches ? (st.season_points / st.matches).toFixed(1) : "\u2014";

    $("profile-hero").hidden = false;

    // chart
    var values = hist.map(function (h) { return h.new_points; });
    renderChart($("chart"), buildChart(values));

    // list
    var listEl = $("h-list");
    var emptyEl = $("h-empty");
    listEl.innerHTML = "";
    if (!hist.length) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    var html = "";
    for (var i = 0; i < hist.length; i++) {
      var h = hist[i];
      html +=
        '<li class="history-item">' +
          '<span class="hist-date">' + shortDate(h.created_at) + '</span>' +
          '<span class="hist-change">' + deltaLabel(h.delta) + '</span>' +
          '<span class="hist-range">' + h.old_points + ' \u2192 ' + h.new_points + '</span>' +
        '</li>';
    }
    listEl.innerHTML = html;
  }

  function load() {
    fetch("/api/players/" + PLAYER_ID + "/history", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(render)
      .catch(function () {
        var el = $("h-empty");
        if (el) { el.textContent = "تعذر تحميل البيانات."; el.hidden = false; }
        var st = $("foot-status");
        if (st) st.textContent = "حدث خطأ في التحميل.";
      });
  }

  var yr = $("year");
  if (yr) yr.textContent = new Date().getFullYear();

  load();
  setInterval(load, 30000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) load();
  });
})();