# تقرير إصلاحات التصنيع + الخزنة (Codex)

التاريخ: 2026-05-24

## ما تم إصلاحه/تنفيذه

1. **إزالة صفحات التحليلات غير المطلوبة من القوائم مع Redirect آمن**
   - حذف روابط:
     - `/dashboard/executive` (تم تحويلها إلى `/dashboard`)
     - `/inventory/analytics` (تم تحويلها إلى `/inventory/products`)
     - `/manufacturing/analytics` (تم تحويلها إلى `/manufacturing/production-orders`)
   - منع كسر أي روابط قديمة عبر صفحات Redirect بدل الحذف الجذري.

2. **الخزنة: وارد/منصرف يدوي + عكس حركة (بدون Delete مباشر)**
   - إضافة API:
     - `POST /api/cashboxes/manual` لتسجيل وارد/منصرف يدوي.
     - `POST /api/cashboxes/transactions/:id/reverse` لعكس الحركات اليدوية فقط.
   - إضافة UI داخل `/accounting/treasury`:
     - أزرار: **وارد يدوي** + **منصرف يدوي** (Modal عربي).
     - زر **عكس** للحركات اليدوية في جدول “آخر الحركات”.
   - إضافة UI في صفحة “كل الحركات”:
     - زر **عكس** للحركات اليدوية فقط.

3. **الخزنة: التزامات أوامر الشراء (Commitments)**
   - إضافة عمود اختياري `cashboxId` في `PurchaseOrder` (Migration + Prisma schema).
   - تحديث `GET /api/analytics/treasury` لإظهار:
     - `التزامات أوامر الشراء`
     - `الرصيد المتاح` = رصيد الخزن - الالتزامات

4. **حل مشكلة “التصفير مش نافع” (Tenant Reset)**
   - سبب رئيسي كان FK من BOM (قوائم المواد) يمنع حذف المنتجات بسبب `materialId` بدون cascade.
   - إصلاح ترتيب الحذف وتغطية BOM/Assignments قبل حذف المنتجات.

5. **تحسينات تحديث البيانات/الأداء (Refresh)**
   - React Query:
     - جعل `staleTime` الافتراضي = `0` (تحديث أسرع).
     - تفعيل `refetchOnWindowFocus`.
   - خفض `staleTime` في صفحات تشغيلية (عملاء/موردين/فواتير/مدفوعات/ميزان المراجعة/تصنيع) لتقليل الحاجة لـ refresh يدوي.

6. **ثيم أزرق (Navy + Sky) وتخفيف الأخضر**
   - تحديث Sidebar + Modal primitives + Login + Tokens في `globals.css` ليكون اللون السائد Sky/Navy.

## الملفات التي تم تعديلها (أهمها)

UI / Theme:
- `components/layout/Sidebar.tsx`
- `components/ui/modal.tsx`
- `components/ui/patterns.tsx`
- `app/globals.css`
- `app/login/page.tsx`
- `components/accounting/AccountingLayout.tsx`

Treasury:
- `components/treasury/TreasuryHubPageContent.tsx`
- `components/treasury/TreasuryTransactionsPageContent.tsx`
- `components/treasury/TreasuryPageContent.tsx`
- `app/api/cashboxes/manual/route.ts`
- `app/api/cashboxes/transactions/[id]/reverse/route.ts`
- `app/api/analytics/treasury/route.ts`

Admin reset / wipe:
- `app/api/admin/tenants/[id]/reset/route.ts`
- `app/api/admin/system/wipe/route.ts`
- `app/(dashboard)/admin/page.tsx`

Redirect pages:
- `app/(dashboard)/dashboard/executive/page.tsx`
- `app/(dashboard)/inventory/analytics/page.tsx`
- `app/(dashboard)/manufacturing/analytics/page.tsx`

Purchase Order commitment:
- `prisma/schema.prisma`
- `prisma/migrations/20260524120000_add_purchase_order_cashbox_commitment/migration.sql`
- `app/api/purchase-orders/route.ts`

PDF export branding/security (جزئي):
- `app/api/pdf/invoice/[id]/route.ts`

Backup fix (حتى يعمل على VPS مع `?schema=`):
- `scripts/backup.ts`

## APIs التي تغيرت/أضيفت

أضيفت:
- `POST /api/cashboxes/manual`
- `POST /api/cashboxes/transactions/:id/reverse`
- `POST /api/admin/system/wipe` (Danger Zone – مالك النظام فقط + تأكيدات متعددة)

تغيرت:
- `GET /api/analytics/treasury` (KPIs إضافية + commitments)
- `PUT/POST/GET/DELETE /api/purchase-orders` (تحسين tenant scoping + دعم cashboxId + رسائل عربية)

## Migrations

تمت إضافة migration واحدة:
- `20260524120000_add_purchase_order_cashbox_commitment`

## نتائج التحقق (Validation)

محلياً:
- `npx prisma generate` ✅
- `npx tsc --noEmit` ✅
- `npm test` ✅ (173 test)
- `npm run build` ✅

على الـVPS:
- `npm ci` ✅
- `npx prisma migrate deploy` ✅ (تطبيق migration الجديدة)
- `npm run build` ✅
- `systemctl start erp-system` ✅
- `curl https://og-estore.site/api/health` ✅ (healthy)

## حالة النشر (Deployment)

تم النشر على:
- VPS: `159.223.167.220`
- المسار: `/var/www/erp`
- الخدمة: `erp-system`

Backups:
- `DB dump` + `.env` + (إن وجد) `public/uploads` داخل: `/var/backups/erp/20260524-185124/`

## متبقي/ملاحظات

1. **UI أمر الشراء (Purchase Order) غير ظاهر في القائمة حالياً**: تم تجهيز البيانات والـAPI والـanalytics، لكن يحتاج واجهة/ربط في الـSidebar لو مطلوب عملياً.
2. **System wipe**: موجود ومؤمّن بتأكيدات متعددة، ويُستخدم بحذر شديد فقط.
3. ممكن نكمل Pass إضافي لتوحيد اللون الأزرق في صفحات الأدمن/الداشبورد (فيه بقايا emerald في بعض الأماكن غير الحرجة).

