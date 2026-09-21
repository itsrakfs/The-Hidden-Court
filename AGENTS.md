# AGENTS.md — The Hidden Court (Padel Ranking)

بيئة عمل خلاصة لمشروع موقع "The Hidden Court" — بتتقرا تلقائيًا في أول أي سيشن جديد على opencode في فولدر المشروع ده. اقراها الأول قبل أي شغل.

## اللي هو المشروع
موقع تصنيف دوري بادل (Padel) — اللي بينجح لغاية أول 3 لاعبين في الترتيب + جداول تصنيف خطية، وكل لاعب عنده بروفايل بسجل نقاط (رسم بياني SVG) + صفحة قواعد + لوحة إدارة كاملة.
- **المسار المحلي**: `C:\Users\Lenovo\AppData\Local\Temp\opencode\the-hidden-court`
- **الموقع الحي**: `https://thehiddencourt.fun` (مستضاف على Railway، دومين مخصوص)
- **GitHub**: `https://github.com/itsrakfs/The-Hidden-Court.git`
- **الفرع النشط**: `master` محليًا، و `main` على GitHub هو ما بينتقله Railway (نستخدم `git push origin master:main`).
- **الـ app**: Flask + SQLite (WAL). مفيش Node على الجهاز، استعمل Python (3.12).

## التشغيل المحلي
```powershell
cd "C:\Users\Lenovo\AppData\Local\Temp\opencode\the-hidden-court"
python server.py --port 5000          # بيشتغل على http://127.0.0.1:5000
```
- السيرفر الحالي بيتطلع من `server.py` مباشرة (مفيش gunicorn). على Railway البيئة = `python server.py` عبر `railway.toml`/`Procfile`.
- أي تغيير في `server.py` محتاج إعادة تشغيل عمليته ليتطبق.
- إيقاف/تشغيل السيرفر:
```powershell
Stop-Process -Name python -Force -ErrorAction SilentlyContinue
Start-Process -FilePath "python" -ArgumentList "server.py --port 5000" -WorkingDirectory "C:\Users\Lenovo\AppData\Local\Temp\opencode\the-hidden-court" -WindowStyle Hidden
```

## الداتا — المهم جدًا
- قاعدة البيانات = `players.db` (في فولدر المشروع).
- Railway يعطي **قرص جديد فارغ مع كل deploy** → أي تغيير مباشر على DB في الحيّ ما بينحفظش عبر الـ deploys.
- **نظام الحفظ** (مهم جدًا):
  - `seed_players.json` هو **النسخة الرسمية المرفوعة في Git** (الـ source of truth للاسترجاع).
  - `init_db()` → `restore_from_seed(conn)` بيشغّل تلقائيًا عند كل إقلاع: لو جدول `players` فاضي، بيرجع اللعبين بـ `seed_players.json`.
  - الملف ده **هو الاسترجاع الحقيقي** — أي تغيير في النقاط/اللاعبين من لوحة الإدارة على الموقع الحي **لازم يتنقل لـ seed** بعد ما يتعمل: هنزّل backup من الموقع (زرار "نسخ احتياطي" في `/admin` أو `GET /api/backup` مع جلسة مسجّل دخول) ونستبدل `seed_players.json` به، ثم رفعه.
- **ممنوع** اننا نحذف أو نغيّر أي بيانات لاعب من غير سؤال المستخدم الأول. المستخدم حساس جدًا للبيانات (كانت حصلت مشاكل فقدان بيانات عربية سابقًا).

## اللاعبين الحاليين (20 لاعبًا بعد آخر backup)
الاسم ↔ النقاط (أول 10 وفي الأسفل الباقي). أي تعديل بيانات حي لازم يتحفظ بالـ backup → seed:
`Mohamed Reda 13`, `Marawan Elsaadany 10` (تيم كويوو), `Anas Fayed 9` (تيم شينجالان), `Waleed Allam 9`, `Adel Eltahan 8` (تيم كويوو), `Ahmed Ramadan 6`, `Eyad Eleterby 6`, `Noor Elsherbeny 5`, `Zeyad Meshaal 5`, `Fahd Elboredy 4`, `Ahmed Hamam 3`, `Mohamed Salah 3`, `Ali Maged 2`, `Makram Mahmoud 2`, `Momen Sharaby 2`, `Ahmed Ayaad 1`, `Ahmed Hany 1`, `Yasen Aboelfatoh 1` (تيم شينجالان), `Body Essam 0`, `Omar Emad 0`. إجمالي النقاط = 90.

## الإعدادات / المصادقة
- `.env` هو ملف الإعدادات المحلي ويعتبر **مستثنى من git** (مش موجود في الـ repo). فيه:
  - `SECRET_KEY`
  - `ADMIN_USERNAME` = `Rakfs`
  - `ADMIN_PASSWORD_HASH` (بت hash pbkdf2، مش نص)
- على Railway، إعدادات `ADMIN_USERNAME` و`ADMIN_PASSWORD` وأي أسرار بتتفعّل من **Environment Variables في لوحة Railway** (مش محلولة محليًا). команд `set_password` في `server.py` بتحدّث كليهما (الـ .env المحلي) وبيخزن hash فقط.
- تحويل كلمة السر في البيئة الحية: في بداية init بيرخذ `ADMIN_PASSWORD` من env ويحوّله لـ hash، ومن غير ذلك يبقى لسه admin الـ hash المخزن.

## المهام Architecture و flow
- **الصفحات العامة**: `/` (المسار)، `/rules`، `/player/<id>`
- **لوحة الإدارة**: `/admin` (+ APIs: `/api/ranking`, `/api/players`, PUT/DELETE, `/api/players/<id>/history`, `/api/players/<id>/streak` POST، `/api/players/<id>/mvp` POST، `/api/backup`، auth عبر `/api/auth/login` + CSRF)
- **ميزة confirmation / trends**: كل لعيب فيه `points_changed_at` + `points_direction`؛ سهم ↑/↓ بنظهر لمدة `TREND_WINDOW_SECONDS = 3*24*60*60`.
- **history**: جدول `point_history` (player_id, old_points, new_points, delta, created_at). بيُضاف تلقائيًا عند أي تغيير نقاط. `restore_from_seed` بيسترجعه لو موجود في seed.

## المميزات (الإضافات الأخيرة)
- **صور اللاعبين**: عمود `image` (رابط صورة مباشر) في جدول `players` + seed؛ بيظهر بدل الأحرف الأولى في التصنيف والـ podium والبروفايل. بيُدخل من الأدمن (حقل "رابط الصورة" في modal الإضافة + شكل تعديل الصف).
- **ستريك المشاركة 🔥**: عمود `streak`؛ الأدمن بيدوس زرار "🔥 N" بجانب كل لاعب عشان يزيد +1، وبيظهر `🔥 N` جنب الاسم عند التصنيف والبروفايل. الـ endpoint: `POST /api/players/<id>/streak`.
- **الـ MVP**: عمود `is_mvp` (bool، واحد بس في كل الدوري — لو اتشغّل لـ لاعب بيتلغى عن البقية). التبديل من الأدمن بزرار نجمة؛ وبيظهر بلون أخضر مميز في التصنيف (صف أخضر + شارة MVP) والـ podium (طوق أخضر) والبروفايل. الـ endpoint: `POST /api/players/<id>/mvp` (toggle).
- **عدد البطولات**: في أعلى الصفحة الرئيسية بدل "آخر تحديث": `عدد البطولات = إجمالي نقاط كل اللاعبين // 30` (حاليًا 90 → 3). الـ `TOURNAMENT_POINTS = 30` في `public.js`.
- **ملاحظة مهمة**: `image`/`streak`/`is_mvp` محفوظة في الـ backup والـ seed — أي تعديل منهم من الأدمن لازم يتم حفظه بالطريقة العادية (منزّل backup → استبدال seed → push).
- **الكاش الحالي**: `public.css/js` = `?v=8` (index/player/rules)، و`admin.css/js` = `?v=7`. زيّد الرقم عند أي تعديل static.

## الأمان
- CSS/JS معناها versioned بعلامة `?v=` في templates — إذا عدّلتها زيّد رقم الإصدار عشان الكاش لا يضرب.
- صفحات HTML بتطلع `Cache-Control: no-store` من `after_request`؛ أصول static بتتخزن `max-age=2592000`.
- `og:image` و`twitter:image` محصورة في HTTPS ثابت: `https://thehiddencourt.fun/static/og-cover.png`
- لا تضع أي سكّر سري أو باسورد في ملفات تُرفع على GitHub.

## Workflow عام مع المستخدم
- اللغة: **عربي مصري** في الردود والتواصل.
- المستخدم بيبعت عدة طلبات متتابعة (تعديلات تصميم/ بيانات/ مساعدة). رد بإيجاز وجرّب محليًا قبل الرفع على GitHub.
- قبل رفع أي تغيير للـ prod: اختبر محليًا (`python server.py --port 5000` + check API) ثم `git status` نظيف و commit + `git push origin master:main`.
- لو حصل deploy على Railway، انتظر شوية (حوالي 1-2 دقيقة) و check الموقع الحي للتأكد.