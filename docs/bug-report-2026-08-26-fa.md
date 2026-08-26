# گزارش باگ‌ها و وضعیت ربات V2Ray Aggregator

> تاریخ: ۲۰۲۶-۰۸-۲۶ (روز تست)
> این فایل برای مراجعه در روزهای بعد یا دادن به یک مدل هوش مصنوعی برای راهنمایی تهیه شده است.
> هر بخش شامل: نشانه‌ها (Symptom)، ریشهٔ مشکل (Root Cause)، محل دقیق در کد، و پیشنهاد رفع است.

---

## وضعیت کلی

| مورد | وضعیت |
|------|--------|
| دیپلوی | Cloudflare Workers — `https://v2ray-aggregator.hossein-mahmoudi-dev.workers.dev` |
| ریپو | `github.com/ivar79/bot-v2ray.git` — برنچ `main` |
| تست | ۷۳۳ تست پاس (vitest) — `npm test` |
| تایپ‌چک | تمیز — `npm run typecheck` |
| پلن Workers | ظاهراً رایگان → محدودیت **۵۰ ساب‌رکوئست** و **~۳۰ ثانیه زمان** در هر invocation |

---

## ✅ چیزهایی که الان درست کار می‌کنند

- دکمهٔ **🔄 دریافت الآن** شروع می‌شود (قبلاً به‌خاطر ردیف‌های گیرکرده بلاک بود).
- دکمه‌های **🗑 حذف اشتراک** و منوی **📤 ارسال** (`files/recent/all/cancel`) — شاخه‌های `del_sub:` و `send:` در `src/telegram/routing.ts` اضافه شده.
- لیست اشتراک‌ها: به‌جای نام بی‌معنی، دامنه/نام نمایش داده می‌شود؛ «📊 تعداد کل».
- `/addsource` کار می‌کند.
- غلط املایی فارسی اصلاح شده: «بزمان»→«بازه زمانی»، «ساعد»→«ساعت»، «مقدم»→«مقدار».
- پیام‌های autofetch بهتر شده («از قبل فعال بود» / «هیچ اشتراکی ثبت نشده»).

---

## ❌ مشکل ۱ — چرخهٔ fetch توسط Cloudflare کُشته می‌شود → ردیف یتیم → 🔄 بلاک می‌شود

### نشانه‌ها
- بعد از زدن 🔄، پیام «🔄 در حال دریافت...» می‌آید و بعد هیچ — نتیجه‌ای نمی‌رسد.
- زدن دوبارهٔ 🔄 → «⏳ یک دریافت دیگر برای شما در حال اجراست.»
- لاگ `wrangler tail` بلافاصله بعد از `SUBSCRIPTIONS_LOADED`:
  ```
  (warn) waitUntil() tasks did not complete within the allowed time after invocation end and have been cancelled.
  ```

### ریشهٔ مشکل
1. `src/telegram/webhook.ts` فوراً `200 OK` برمی‌گرداند و کل پردازش را داخل `ctx.waitUntil(runRoute())` اجرا می‌کند تا وبهوک تایم‌اوت نخورد.
2. بودجهٔ waitUntil در پلن رایگان ~۳۰ ثانیه است. اگر کار بیشتر طول بکشد، Cloudflare تسک را می‌کُشد.
3. `src/ingest/pipeline.ts` → `runPipeline()` برای **هر کانفیگ ۲ تا ۴ کوئری جداگانهٔ D1** اجرا می‌کند:
   - `configHashExists()` (۱ کوئری)
   - برای کانفیگ تکراری: `SELECT id` + `touchConfig()` + `insertOccurrence()` (۳ کوئری)
   - برای کانفیگ جدید: `insertConfig()` + `insertOccurrence()` (۲ کوئری)
4. سابسکریپشن بزرگ (مثل روسترکید `V2RAY_BASE64.txt`) تا سقف `MAX_CONFIGS_PER_SUB = 2000` کانفیگ دارد → حدود **۴۰۰۰ تا ۶۰۰۰ رفت‌وبرگشت D1 پشت‌سرهم** (هر کدام ~۵۰–۱۵۰ms) → چند دقیقه!
5. وقتی تسک کُشته می‌شود، `finally { unregisterFetch(...) }` در `src/telegram/commands.ts` → `handleFetchNow()` **هرگز اجرا نمی‌شود** → ردیف `fetch_runs` با `status='running'` می‌ماند → `getActiveFetch()` دفعهٔ بعد را بلاک می‌کند.

### وضعیت فعلی
- **تا حدی رفع شده:** فیلتر ۱۵ دقیقه‌ای حالا واقعاً کار می‌کند (`datetime(started_at)` در `src/db/fetch-runs.ts` — باگ مقایسهٔ فرمت ISO `T` در برابر فرمت فاصله‌دار `datetime('now')` در SQLite رفع شد). یعنی بلاک حداکثر ۱۵ دقیقه طول می‌کشد، ولی **چرخه هنوز کُشته می‌شود و fetch هیچ‌وقت کامل نمی‌شود**.

### پیشنهاد رفع (به ترتیب اثر)
1. **بچ کردن D1** در `src/ingest/pipeline.ts`: به‌جای insert یکی‌یکی، از `db.batch()` (تا ۱۰۰ statement در یک ساب‌رکوئست) برای `insertConfig`/`insertOccurrence` استفاده شود → هزاران برابر سریع‌تر.
2. **سقف زمانی چرخه**: یک ددلاین ~۲۵ ثانیه‌ای به `fetchAllSubscriptions()` اضافه شود که قبل از کُشته شدن توسط Cloudflare، ردیف را تمیز (`failed`/`completed`) ببندد → دیگر هیچ ردیف یتیمی نمی‌ماند.
3. کاهش `MAX_CONFIGS_PER_SUB` (فعلاً ۲۰۰۰) در `src/ingest/subscription.ts`.

---

## ❌ مشکل ۲ — `/cancel` در مسیر in-memory ردیف را نمی‌بندد

### نشانه‌ها
- بعد از اینکه fetch کُشته شد، `/cancel` پیام «❌ درخواست لغو دریافت ثبت شد.» می‌دهد ولی زدن دوبارهٔ 🔄 **هنوز بلاک است**.

### ریشهٔ مشکل
`src/ingest/subscription.ts` → `cancelFetch()`:
- اگر flowId در مپ in-memory ایزوله (`activeFetches`) باشد (و fetch کُشته‌شده هنوز آنجاست چون `unregisterFetch` اجرا نشده): فقط `fetch.cancelled = true` + `controller.abort()` (روی کنترلر مرده!) + `requestFetchCancellation()` (فقط فلگ) → **`finishFetchRun()` صدا زده نمی‌شود** → ردیف `running` می‌ماند.
- مسیر DB-only (fetch در حافظه نیست) قبلاً اصلاح شده و ردیف را `cancelled` می‌کند، ولی **مسیر in-memory اصلاح نشده**.

### پیشنهاد رفع
در شاخهٔ in-memory هم بعد از abort، `await finishFetchRun(db, flowId, "cancelled")` صدا زده شود. (برای fetch زنده هم بی‌خطر است؛ `finishFetchRun` فقط روی ردیف `running` اثر می‌کند.)

---

## ❌ مشکل ۳ — کانال خروجی خراب + انفجار خطای «Too many subrequests»

### نشانه‌ها
- منوی 📤 → ارسال → «✅ ارسال کانفیگ‌ها انجام شد / ارسال‌شده: 0 / ناموفق: 10»
- لاگ:
  ```
  (error) [api] sendMessage FAILED: status=400 chatId=-1002128220461 error=Bad Request: chat not found  (×10)
  (error) [api] sendMessage EXCEPTION: chatId=-1002128220461 error=Too many subrequests by single Worker invocation  (×~100)
  ```

### ریشهٔ مشکل
- **الف) تنظیمات کانال:** ربات در کانال خروجی `-1002128220461` **عضو/ادمین نیست** یا شناسه اشتباه است. تلگرام برای کانالی که بات نمی‌بیند همین «chat not found» را برمی‌گرداند. → این یک مشکل **تنظیماتی** است: یا بات را ادمین کانال کنید یا با `/setoutput` شناسهٔ درست را بدهید (جدول `settings` → `output_channel_id`).
- **ب) رفتار کد:** `src/telegram/output-publisher.ts` → `sendConfigCards()` / `publishToTelegramChannel()` برای هر کارت/فایل یک `sendMessage`/`sendDocument` می‌فرستد، بدون توقف روی خطای کشنده. هر تلاش ناموفق هم یک ساب‌رکوئست مصرف می‌کند؛ پلن رایگان سقف ۵۰ دارد → بعد از پر شدن سقف، هر فراخوانی بعدی `Too many subrequests` می‌دهد و اسپم خطا تولید می‌شود.

### پیشنهاد رفع
1. وقتی خطا «chat not found» / ۴۰۳ یا ۴۰۰ باشد، حلقه **متوقف** شود و یک پیام واضح («ربات در کانال خروجی نیست») گزارش شود.
2. سقف تعداد ارسال در هر invocation (مثلاً ۴۰) و رفع اسپم خطا.
3. (دستی) بات را در کانال خروجی ادمین کنید یا `/setoutput` بزنید.

---

## ⚠️ مشکل ۴ — جزئی: `/removesource` بدون فاصله
`/removesource-1003703251773` (چسبیده) → «❓ Unknown command». درست: `/removesource -1003703251773`. باگ نیست، خطای کاربر است. (اختیاری: روتر می‌تواند حالت بدون فاصله را هم بپذیرد.)

---

## 🛠️ اصلاحاتی که تا این لحظه اعمال و دیپلوی شده

1. `src/telegram/routing.ts` — شاخه‌های `send:files|recent|all|cancel` و `del_sub:` (دکمه‌های خراب درست شد).
2. `src/telegram/commands.ts` — اصلاح غلط‌های فارسی، پیام‌های autofetch بهتر، لیست اشتراک با دامنه.
3. `src/db/fetch-runs.ts` — نرمال‌سازی `datetime(started_at)` در مقایسه‌ها (فیلتر ۱۵ دقیقه‌ای حالا واقعاً کار می‌کند).
4. `src/ingest/subscription.ts` — `cancelFetch` در مسیر DB-only ردیف را `cancelled` می‌کند.
5. تست‌های جدید: `tests/db/fetch-runs.test.ts` + به‌روزرسانی تست‌های routing/commands/subscription. مجموع ۷۳۳ تست.

---

## 🗂️ مسیرهای کلیدی کد

| فایل | نقش |
|------|------|
| `src/ingest/pipeline.ts` | پردازش کانفیگ‌ها + insert در D1 (گلوگاه مشکل ۱) |
| `src/ingest/subscription.ts` | چرخهٔ fetch، ثبت/لغو ردیف‌های fetch_runs |
| `src/db/fetch-runs.ts` | CRUD و staleness ردیف‌های fetch_runs |
| `src/telegram/webhook.ts` | ورودی وبهوک + `ctx.waitUntil()` |
| `src/telegram/routing.ts` | مسیریابی callback ها |
| `src/telegram/commands.ts` | هندلر دستورات و منوها |
| `src/telegram/output-publisher.ts` | ارسال به کانال خروجی (مشکل ۳) |

---

## 🚀 دستورات مفید

```bash
npm run typecheck          # تایپ‌چک
npm test                   # تست‌ها (۷۳۳)
npx wrangler deploy        # دیپلوی
npx wrangler tail v2ray-aggregator --format pretty   # مشاهدهٔ لاگ زنده
```

---

## 📌 نکات باز / نیاز به بررسی دستی

- شناسهٔ `output_channel_id` در جدول `settings` (D1) — بررسی شود که ربات ادمین همان کانال است.
- پلن Cloudflare (رایگان = سقف ۵۰ ساب‌رکوئست) — اگر پولی شود محدودیت‌ها بالاتر می‌روند ولی باز هم بچ‌کردن D1 لازم است.
- سابسکریپشن روسترکید بسیار بزرگ است (بیش از ۲ مگابایت، هزاران کانفیگ) — `fetchWithLimits` آن را به ۲ مگابایت محدود می‌کند و `MAX_CONFIGS_PER_SUB=2000` اعمال می‌شود، ولی پردازش همین هم از بودجهٔ زمانی عبور می‌کند.
