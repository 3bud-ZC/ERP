# تقرير العمل النهائي (Codex) — OG ERP

التاريخ: 2026-05-24

## الهدف
تبسيط القوائم، تقوية الخزنة، حل مشاكل التحديث/الـRefresh، توحيد الثيم للأزرق، وإضافة أدوات أدمن لتصفير/حذف بشكل آمن، مع نشر آمن على الـVPS بدون GitHub pull وبدون فقد بيانات الإنتاج.

## أبرز النتائج

1. **لوحة التحكم**
   - إلغاء `/dashboard/executive` كميزة (Redirect دائم إلى `/dashboard`).

2. **تنظيف القوائم**
   - حذف روابط تحليلات المخزون/التصنيع من الـSidebar مع Redirectات آمنة.

3. **UI/Branding**
   - إدخال Logo وهوية OG (Name/Logo) في الـSidebar والـLogin.
   - تقليل اللون الأخضر وتحويل الـaccent إلى Sky/Navy في:
     - Sidebar
     - Login
     - Modal primitives
     - بعض مكونات Accounting KPIs
     - Tokens في `globals.css`

4. **الخزنة (Treasury)**
   - إضافة “وارد يدوي / منصرف يدوي” مباشرة من صفحة الخزنة.
   - إضافة “عكس” للحركات اليدوية بدلاً من الحذف.
   - تحسين عرض KPIs وإضافة:
     - التزامات أوامر الشراء
     - الرصيد المتاح

5. **تحديث فوري وتقليل الحاجة للـRefresh**
   - React Query default: `staleTime=0` + `refetchOnWindowFocus=true`
   - تخفيض staleTime في صفحات تشغيلية (عملاء/موردين/مدفوعات/ميزان مراجعة/تصنيع/فواتير).

6. **Admin**
   - تصفير بيانات عميل (Tenant reset) مع Fix لمشكلة BOM FK.
   - حذف مستخدم بالكامل (موجود سابقاً).
   - إضافة “تصفير النظام بالكامل” (يمسح كل العملاء ويُبقي مالك النظام فقط) بتأكيدات متعددة.

7. **Purchase Orders**
   - إضافة `cashboxId` اختياري لأمر الشراء (Commitment فقط).
   - تحسين tenant scoping ورسائل عربية في `/api/purchase-orders`.

8. **PDF**
   - تحسين API PDF invoice ليستخدم Branding OG + tenant scoping (جزئي).

## ملفات تم تعديلها (مختصر)
- UI/Theme: `components/layout/Sidebar.tsx`, `components/ui/modal.tsx`, `app/globals.css`, `app/login/page.tsx`
- Treasury: `components/treasury/*`, `app/api/cashboxes/*`, `app/api/analytics/treasury/route.ts`
- Admin: `app/(dashboard)/admin/page.tsx`, `app/api/admin/tenants/[id]/reset/route.ts`, `app/api/admin/system/wipe/route.ts`
- DB: `prisma/schema.prisma`, `prisma/migrations/20260524120000_add_purchase_order_cashbox_commitment/migration.sql`
- Ops: `scripts/backup.ts` (Fix لروابط Prisma التي تحتوي `?schema=`)

## التحقق
- محلياً: `tsc` ✅, `tests` ✅, `build` ✅
- على VPS: `npm ci` ✅, `migrate deploy` ✅, `build` ✅, `erp-system` ✅, `health` ✅

## النشر
تمت مزامنة المشروع المحلي مباشرة إلى VPS باستخدام `tar/scp` (بدون GitHub pull) ثم build في release dir وتبديل آمن إلى `/var/www/erp`.

## المخاطر/المتبقي
- System wipe حساس جداً: لا يُستخدم إلا عند الحاجة وبوجود Backup.
- ما زال هناك أماكن غير حرجة تستخدم emerald في بعض الصفحات (يمكن عمل pass نهائي لو مطلوب).
- Purchase Order UI غير ظاهر بالقائمة حالياً (الـbackend جاهز).

