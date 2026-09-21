/* THE HIDDEN COURT - share & screenshot helpers (html2canvas based) */
(function () {
  "use strict";

  var toastEl = document.getElementById("toast");
  var toastTimer = null;

  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2600);
  }

  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function formatAR(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }

  function initials(name) {
    return String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); })
      .join("") || "?";
  }

  // ------------------------------------------------------------------- rules
  function buildRulesCardHTML() {
    var c1 = [
      "الدورة فيها 6 فرق — كل فريق من اتنين بيلعبوا مع بعض.",
      "الكل بيلعب مع الكل — كل فريق بيواجه باقي الفرق مرة واحدة."
    ];
    var c2 = [
      "المركز 1 → 5 نقاط، والتاني 4، والتالت 3، والرابع 2، والخامس 1، والسادس 0."
    ];
    var c3 = [
      "كل حضور بطولة متتالية = ستريك +1 — بتكسب أو تخسر.",
      "تغيب عن بطولة → الستريك بيرجع صفر وتبدأ من جديد.",
      "كل 4 ستريك متتالية (4، 8، 12) → نقطة زيادة في التصنيف تلقائيًا."
    ];
    var c4 = [
      "في كل بطولة لاعب واحد بس هو الـ MVP — أي توج جديد بيشيل القديم تلقائيًا.",
      "التتويج بيديك +1 نقطة هدية ونجمة في سجلك، وشارتك لما تتحال بيشدها لاعب تاني."
    ];
    var c5 = [
      "الفوز الساحق 6-0 (من غير ما الخصم ياخد أي جيم) → نقاط البطولة بتتضاعف."
    ];
    var c6 = [
      "ماتشات الدوري يومي الثلاثاء والجمعة من 9 لـ 12 بالليل."
    ];

    function card(title, arr, emoji, accent) {
      var lis = arr.map(function (t) { return '<li>' + t + '</li>'; }).join("");
      return '<div class="rc" style="--ac:' + accent + '">' +
        '<div class="rc-head">' + emoji + '<h3>' + title + '</h3></div>' +
        '<ul class="rc-list">' + lis + "</ul></div>";
    }

    return '<div class="rc-grid" dir="rtl">' +
      card("شكل البطولة", c1, "⚡", "#a855f7") +
      card("النقاط حسب المركز", c2, "🏅", "#f5c469") +
      card("الستريك", c3, "🔥", "#fb923c") +
      card("لقب MVP", c4, "⭐", "#43f0b2") +
      card("الفوز الساحق", c5, "🎯", "#d98e5a") +
      card("المواعيد", c6, "📅", "#d7d0ea") +
    "</div>";
  }

  // ---------------------------------------------------------------- ranking
  function avatarBlock(name) {
    var inits = esc(initials(name));
    return '<span class="r-av">' + inits + "</span>";
  }

  function playerLinkHTML(p) {
    var s = "";
    s += esc(p.name);
    if (p.streak > 0) s += ' <span class="chip">🔥 ' + p.streak + "</span>";
    if (p.mvp_count > 0) s += ' <span class="chip">⭐ ' + p.mvp_count + "</span>";
    if (p.tournaments > 0) s += ' <span class="chip">🏆 ' + p.tournaments + "</span>";
    return s;
  }

  function buildRankingCardHTML() {
    var rows = [];
    try {
      var trs = document.querySelectorAll("#ranking-body tr");
      for (var i = 0; i < trs.length; i++) {
        var t = trs[i];
        var rankEl = t.querySelector("td.th-rank .num");
        var nameEl = t.querySelector("a.player-link");
        var ptsEl = t.querySelector("td.th-num .num");
        if (!nameEl) continue;
        var p = {
          rank: rankEl ? rankEl.textContent : "",
          name: nameEl.textContent.trim(),
          points: ptsEl ? ptsEl.textContent : "",
          streak: 0, mvp_count: 0, tournaments: 0
        };
        var cell = nameEl.closest("td");
        if (cell) {
          var st = cell.querySelector(".streak-chip");
          if (st) p.streak = parseInt(st.textContent.replace(/[^0-9]/g, ""), 10) || 0;
          var mc = cell.querySelector(".mvp-count-badge");
          if (mc) p.mvp_count = parseInt(mc.textContent.replace(/[^0-9]/g, ""), 10) || 0;
          var tc = cell.querySelector(".tournament-chip");
          if (tc) p.tournaments = parseInt(tc.textContent.replace(/[^0-9]/g, ""), 10) || 0;
          var mvb = cell.querySelector(".mvp-badge");
          if (mvb) p.is_mvp = true;
        }
        rows.push(p);
      }
    } catch (e) { rows = []; }

    var podium = "";
    var pods = document.querySelectorAll(".podium-card");
    for (var j = 0; j < pods.length; j++) {
      var pc = pods[j];
      if (pc.style.display === "none") continue;
      var order = pc.classList.contains("pod-1") ? 1 : pc.classList.contains("pod-2") ? 2 : 3;
      var nm = pc.querySelector(".pod-link");
      var pts = pc.querySelector(".pod-points");
      var name = nm ? nm.textContent.trim() : "";
      if (!name) continue;
      var ptVal = pts ? pts.firstChild.textContent.trim() : "";
      podium += '<li class="pd pd-' + order + '">' +
        '<span class="pd-rank">' + order + "</span>" +
        avatarBlock(name) +
        '<span class="pd-name">' + esc(name) + "</span>" +
        '<span class="pd-pts">' + ptVal + ' <small>pt</small></span></li>';
    }

    var rowsHTML = "";
    for (var k = 0; k < rows.length; k++) {
      var r = rows[k];
      rowsHTML += "<tr><td>" + r.rank + "</td><td>" +
        avatarBlock(r.name) + playerLinkHTML(r) +
        "</td><td><b>" + r.points + "</b> pt</td></tr>";
    }

    return '<div class="rc rc--wide" dir="rtl">' +
      '<div class="rc-head">🎖️<h3>تصنيف اللاعبين</h3>' +
      '<span class="rc-date">' + formatAR(new Date()) + "</span></div>" +
      '<ul class="rc-podium">' + podium + "</ul>" +
      '<table class="rc-table"><thead><tr><th>#</th><th>اللاعب</th><th>النقاط</th></tr></thead>' +
      "<tbody>" + rowsHTML + "</tbody></table></div>";
  }

  // -------------------------------------------------------------- pipeline
  function dataURLToBlob(dataURL) {
    var parts = dataURL.split(",");
    var mime = parts[0].match(/:(.*?);/)[1];
    var bin = atob(parts[1]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 800);
  }

  function nativeShare(blob, filename, text) {
    if (!navigator.canShare) return false;
    try {
      var f = new File([blob], filename, { type: "image/png" });
      if (!navigator.canShare({ files: [f] })) return false;
      navigator.share({ files: [f], title: "The Hidden Court", text: text }).catch(function () {});
      return true;
    } catch (e) { return false; }
  }

  function done(blob, filename, text) {
    if (nativeShare(blob, filename, text)) return;
    downloadBlob(blob, filename);
    showToast("تم حفظ الصورة 📷");
  }

  function capture(selector, filename, text, wide) {
    if (!window.html2canvas) {
      showToast("المتصفح مش بيدعم التقاط الصور هنا");
      return;
    }
    var src = document.querySelector(selector);
    var holder = document.getElementById("share-canvas");
    if (!holder || !src) return;

    holder.innerHTML = wide ? buildRankingCardHTML() : buildRulesCardHTML();
    var scale = Math.min(window.devicePixelRatio || 1, 2);

    html2canvas(holder, {
      backgroundColor: "#0b0714",
      scale: scale,
      useCORS: true,
      logging: false
    }).then(function (canvas) {
      var dataURL = canvas.toDataURL("image/png");
      holder.innerHTML = "";
      try { done(dataURLToBlob(dataURL), filename, text); }
      catch (e) { showToast("تعذر إنشاء الصورة"); }
    }).catch(function () {
      holder.innerHTML = "";
      showToast("تعذر إنشاء الصورة");
    });
  }

  // ---------------------------------------------------------------- wiring
  function bind() {
    var rulesBtn = document.getElementById("share-rules-btn");
    if (rulesBtn) {
      rulesBtn.addEventListener("click", function () {
        capture("#share-canvas", "قواعد-الدوري.png", "قواعد دوري The Hidden Court", false);
      });
    }

    var rankBtn = document.getElementById("share-ranking-btn");
    if (rankBtn) {
      rankBtn.addEventListener("click", function () {
        capture("#share-canvas", "تصنيف-الدوري.png", "ترتيب لاعبي The Hidden Court", true);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();