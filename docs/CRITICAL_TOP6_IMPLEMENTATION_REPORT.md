# تقرير تنفيذ الأولويات الستة الحرجة — OG ERP

تاريخ التنفيذ: 2026-05-25

## 1) ما تم تنفيذه

### A) تنظيف القوائم والمسارات
- إزالة ظهور تسمية `المالية` من تنقل المحاسبة الأساسي.
- اعتماد 4 صفحات محاسبية فقط في الواجهة:
  - `/accounting` (لوحة المحاسبة)
  - `/accounting/treasury`
  - `/accounting/payments`
  - `/accounting/trial-balance`
- تحديث روابط التنبيهات أعلى النظام لتتجه إلى:
  - `/dashboard` بدل `/dashboard/executive`
  - `/inventory/products` بدل `/inventory/analytics`
- مسارات التحليلات/التنفيذي ما زالت متاحة كـ redirect توافقي (بدون كسر الروابط القديمة).

### B) إصلاح فشل إنشاء الفاتورة
- تحسين تحقق المخزون قبل إنشاء فاتورة المبيعات:
  - إضافة `tenantId` إلى `validateStockAvailability`.
  - تجميع الكميات لكل منتج قبل التحقق (حل مشكلة تكرار نفس المنتج على عدة بنود).
- تحسين رسائل الخطأ العربية في مسارات:
  - `app/api/sales-invoices/route.ts`
  - `app/api/purchase-invoices/route.ts`
  - `lib/utils/arabic-errors.ts`
- تحسين عرض تفاصيل نقص المخزون في واجهة إنشاء الفاتورة بدل رسالة عامة فقط.

### C) الربط الذري بين الفاتورة والخزنة
- تم الحفاظ على المسار الذري القائم في `invoice-execution.service` (فاتورة + Payment + Allocation + Cashbox).
- إضافة تحسينات تحقق ورسائل لمنع الحالات غير المتسقة (دفع/توزيع/خزنة).

### D) تنظيم صفحات المحاسبة الأساسية
- تغيير التسمية في الواجهة إلى `لوحة المحاسبة` بدل `لوحة التحكم المالية`.
- توحيد الشريط العلوي/التبويبات مع هذا الاتجاه.

### E) الأداء والتحديث الفوري
- تحديث إعدادات React Query العامة:
  - `staleTime: 0`
  - `refetchOnWindowFocus: true`
- تقليل stale caching في صفحات تشغيلية:
  - المدفوعات
  - ميزان المراجعة
  - قائمة الفواتير
  - Dashboard
- بعد حفظ الفاتورة:
  - توسيع `invalidateQueries` للمفاتيح المالية الأساسية.
  - إضافة `router.refresh()` لتحسين الانعكاس الفوري.

### F) اختبارات التحقق
- `npx tsc --noEmit` ✅
- `npm test` ✅ (9 ملفات، 174 اختبار)
- `npm run build` ✅

---

## 2) الملفات التي تم تعديلها في هذه الجولة

- `components/layout/Sidebar.tsx`
- `components/accounting/AccountingLayout.tsx`
- `components/layout/Topbar.tsx`
- `app/(dashboard)/accounting/page.tsx`
- `app/(dashboard)/dashboard/page.tsx`
- `app/(dashboard)/accounting/payments/page.tsx`
- `app/(dashboard)/accounting/trial-balance/page.tsx`
- `components/providers/QueryProvider.tsx`
- `components/invoices/InvoiceForm.tsx`
- `components/invoices/InvoiceList.tsx`
- `lib/inventory.ts`
- `app/api/sales-invoices/route.ts`
- `app/api/purchase-invoices/route.ts`
- `lib/services/invoice-execution.service.ts`
- `lib/utils/arabic-errors.ts`
- `app/api/accounting/financial-overview/route.ts`

---

## 3) النواقص المتبقية (مرتبة بالأولوية)

### P0 (حرج)
1. تنفيذ Smoke E2E فعلي على بيئة التشغيل لتدفق:
   مبيعات/مشتريات (مدفوع كلي/جزئي) → الخزنة → المدفوعات → ميزان المراجعة.
2. مراجعة أي نقاط قديمة تستخدم `product.stock` مباشرة بدل مصدر مخزون موحد (Warehouse/valuation).

### P1 (مهم)
1. توحيد ألوان عناصر الفواتير (بعض الأزرار/الـfocus ما زالت تحمل درجات خضراء قديمة).
2. توسيع invalidation المتبادل بعد العمليات المحاسبية غير الفواتير (مثل المصروفات/التحويلات) بنفس درجة الصرامة.
3. تحسين صفحة المحاسبة الرئيسية لتعرض روابط تشغيلية مختصرة أكثر مباشرة (حسب سيناريو المستخدم اليومي).

### P2 (تحسين)
1. إضافة اختبارات تكامل آلية لتدفق Invoice→Payment→Cashbox.
2. إضافة telemetry أدق لقياس زمن تحديث الواجهات بعد كل mutation.

---

## 4) ملاحظة تشغيلية

تم التنفيذ بدون تغيير معماري، بدون reset لقاعدة البيانات، وبدون المساس بالمسارات الذرية الأساسية للفواتير/المدفوعات/الخزنة.
