# The Hidden Court — FULL HANDOFF (للمتابعة من أي سيشن/شات جديد)

كل اللي محتاج تعرفه عشان تكمّل الشغل صح مع أي opencode/مساعد جديد.

---

## سؤال 1) آخر حاجة كنا شغالين فيها قبل وقف الشات؟

**آخر حاجة اتعملت فعليًا (خلصت واتصدمت حيًا) — مش في النص:**

- ✅ **إرجاع كل اللاعبين للـ 0 نقطة + مسح السجل (history) نهائيًا** — بناءً على طلب المستخدم "ارجع كلو للزيرو عشان اضيف من اول وجديد من غير ما يظهر في البروفايل انهم رجعوا لصفر".
- ✅ تعديل `restore_from_seed` في `server.py`: لو اللاعب صفر ومفيش سجل، **ميتعملش** entry "0→0" — فالبروفايل يبدأ فاضي/نظيف. (لو عنده نقط > 0 بيتعمل بس entry أساسي 0→points).
- ✅ توليد `seed_players.json` جديد: 14 لاعب، كلهم `points: 0`، `points_history: []`.
- ✅ commit `24041b0` + push على GitHub → الموقع الحي تفحص وهو شغّال (14 لاعب، كلهم 0، سجل 0).

**ملاحظة مهمة:** عند آخر رسالة في الشات، المستخدم قال "في مشكله اكبر" — وبعد سؤاله وضّح إنها **مش مشكلة في الموقع** لكن مشكلة **استمرارية الشات نفسه** (استهلاك السياق والدعم) — وده اللي قادنا لعمل الـ AGENTS.md والـ Handoff. فلا يوجد ANY feature ناقص/في النص من قبل.

---

## سؤال 2) أفكار/مطلوبات متخزنة في الشات القديم؟

كل المطلوبات اللي طلبها المستخدم خلال الشات اللي فات **تم تنفيذها كلها**:

| المطلب | الحالة |
|---|---|
| صفحة لموضوع "قواعد الدوري" بشكل جميل (كان شكلها خباية تحت) | ✅ تم — إعادة تصميم كاملة v6 + أنيميشن |
| إضافة animation وتجميل الموقع بشكل عام | ✅ تم — بطاقات متحركة، hero، counters، stagger |
| ظهور أسماء اللاعبين على الكمبيوتر (كانت الكاش تعطل) | ✅ تم إصلاحه (cache-busting + no-store) |
| og:image يكون https صحيح | ✅ تم |
| بروفايل لاعب فيه سجل نقاط (رسم بياني) | ✅ تم — `/player/<id>` + `/api/players/<id>/history` |
| **الحفاظ على تسلسل النقاط عبر الـ deploys** (لو خد 5 في بطولة ثم 4 بعده ما يظهرش الرقم الأخير بس) | ✅ تم إصلاحه — seed بيحتفظ بـ `points_history` والـ restore بيسترجعه |
| إرجاع الكل للزيرو + بداية جديدة نظيفة | ✅ تم (آخر commit) |

**مفيش مطلوبات/أفكار جديدة متروكة غير منفذة.**

---

## سؤال 3) مشاكل أو bugs لسه موجودة ومتعالجتش؟

خلّ بالك من النقاط دي:

1. **⭐ أهم حاجة (ملاحق النظام):** Railway بيعمل **قرص جديد فاضي مع كل deploy** → أي تعديل في البيانات من لوحة الإدارة على الموقع الحي **لا ينحفظ تلقائيًا**.
   - **العلاج** (اتفقنا عليه ولسه ساري): بعد أي تعديل من `/admin` → حمّل Backup → استبدل `seed_players.json` → ارفع على GitHub.
   - دي مش bug قابلة للحل، ده سلوك Railway المجاني، والـ seed هو الحل المطلوب.

2. **كاش المتصفح عند المستخدمين:** اللي اتصلوا بالموقع قبل إصلاح الكاش، ممكن تفضل عندهم نسخ قديمة من CSS/JS. الحل: hard refresh (Ctrl+F5) أو فتح في tab جديد. ولسه موجود الـ cache-busting `?v=` — أي تعديل في static لازم يرفع رقم الـ v.

3. **لو المستخدم غيّر كلمة سر الـ admin من Railway env variables:** دخوليه المحلي/الحي ممكن يختلفوا — يلزم مزامنتهم. لا نسخة نصية من الباسورد محفوظة، والـ hash في `.env` (محلي) + env var في Railway.

4. **التحقق من محتوى صفحة البروفايل عبر أدوات أوتوماتيكية:** بيانات البروفايل بترسم بالـ JS على العميل — فالفحص الآلي (مثل webfetch) بيشوف أصفار placeholders. **للتحقق الصح: استخدم API** `/api/players/<id>/history`.

---

## سؤال 4) تعديلات إدارية (اسم/شعار/ألوان/الخ)؟

**مفيش طلبات تعديل اسم/شعار/ألوان متخزنة من المستخدم** — لكن لو عايز تعملها، دي أماكنها:

- **اسم/شعار الموقع**: في `templates/index.html` و `templates/admin.html` في الـ topnav — حالياً "HC" + "THE HIDDEN COURT".
- **ألوان/ستايل عام**: في `static/css/public.css` (وكمان `admin.css`). الألوان حالياً **دارك ثابت** (المستخدم أزال الـ theme toggle طلبًا).
- **بعد أي تعديل static**: ارفع رقم `?v=` في الـ templates الأول + اعمل deploy وفحصه حيًا.

---

## أساسيات الشغل (أهم 5 — عشان الشات الجديد يشتغل صح)

1. **المسار**: `C:\Users\Lenovo\AppData\Local\Temp\opencode\the-hidden-court`
   - ⚠️ المسار ده في Temp — المحفوظ دائمًا هو GitHub. لو ضاع: `git clone https://github.com/itsrakfs/The-Hidden-Court.git`.
2. **GitHub**: `origin = https://github.com/itsrakfs/The-Hidden-Court.git` — الفرع المحلي `master`، وـ deploy بياخد `main`: `git push origin master:main`.
3. **تشغيل محلي**: `python server.py --port 5000` → `http://127.0.0.1:5000` . إعادة تشغيل بعد أي تعديل كود:
   ```
   Stop-Process -Name python -Force -ErrorAction SilentlyContinue
   Start-Process -FilePath "python" -ArgumentList "server.py --port 5000" -WorkingDirectory "<path>" -WindowStyle Hidden
   ```
4. **الدخول لوحة الإدارة**: username `Rakfs` — الباسورد في `.env` (محلي) / Railway env (حي)؛ مخزن hash فقط.
5. **ممنوع** حذف أو تعديل بيانات لاعب من غير موافقة المستخدم. أي تعديل بيانات → احفظ backup → استبدل seed → ارفع.

---

## تفاصيل تقنية حالية (آخر حالة)

- **الـ DB**: SQLite WAL، ملف `players.db`.
- **الـ seed**: `seed_players.json` (14 لاعب، 0 نقطة، سجل فاضي — بداية نظيفة).
- **الترند**: أسهم ↑/↓ خلال `TREND_WINDOW_SECONDS = 3*24*60*60` باستخدام `points_changed_at` + `points_direction`.
- **السجل**: جدول `point_history` (player_id, old_points, new_points, delta, created_at) — بيتضاف تلقائيًا عند أي تعديل نقاط.
- **API عام**: `/api/ranking`، `/api/players/<id>/history`. **Admin**: `/admin` + `/api/auth/login` (CSRF) + `/api/backup` (get snapshot).
- **إعدادات head/SEO**: OG image = `https://thehiddencourt.fun/static/og-cover.png` (https ثابت).
- **الكاش**: HTML `no-store`؛ static `max-age=30 يوم`؛ كل قالب بيعمل cache-bust `?v=6` حاليًا.

---

## آخر commits على GitHub (بالترتيب الأحدث)
```
097d554 Add AGENTS.md project handoff
24041b0 Reset all players to 0 with empty history (fresh start)
e69171b Preserve per-player points history through seed restore
dbaa7d8 Redesign rules page (v6) + topnav + animations
975760c Cache-bust static assets + no-store HTML
c2e95b7 Force https og/twitter image
a1225df Update seed from live backup
a7d55a3 Add player profiles, rules page, OG image
9075f6c Remove theme toggle; add 3-day trend arrows
0e60ce8 Auto-restore from seed + admin backup download
```
الموقع الحي يعمل بآخر `24041b0` وهو شغّال (تحقق: 14 لاعب صفر + home 200).

---

*ملف الخلاصة الكاملة — جاهز للإرسال لأي شات/سيشن جديد. بعد قراءته، يبدأ الشغل فورًا.*