# تقرير: الهوية + تصفير بيانات عميل (لوحة الأدمن)

التاريخ: 2026-05-23

## ما تم تنفيذه

1. تحديث هوية النظام (Branding):
   - تحديث عنوان المتصفح (Metadata title) ليكون عام واحترافي بدل "مصنع البلاستيك".
   - إضافة لوجو النظام وربطه في:
     - صفحة تسجيل الدخول
     - الشريط الجانبي (Sidebar)
   - إضافة أيقونة الموقع (favicon / app icon).

2. إضافة ميزة "تصفير بيانات العميل" داخل صفحة الأدمن:
   - زر جديد داخل جدول العملاء لإعادة تهيئة بيانات عميل واحد فقط (Tenant reset).
   - معاينة أعداد البيانات التي سيتم حذفها قبل التنفيذ.
   - تأكيد مبسط: يجب كتابة كود العميل `{tenantCode}` بالضبط قبل التنفيذ.
   - اختيار تجهيز شجرة الحسابات بعد التصفير (مستحسن).
   - العملية لا تحذف:
     - Tenant نفسه
     - المستخدمين (Users) وارتباطاتهم
     - بيانات المنصة العامة

3. إضافة حذف المستخدم بالكامل داخل لوحة الأدمن:
   - زر "حذف" بجانب كل مستخدم (غير مالك النظام).
   - تأكيد: كتابة البريد الإلكتروني للمستخدم قبل تنفيذ الحذف.
   - قبل الحذف يتم فك ربط المستخدم من فواتير المبيعات/المشتريات (salesRep / purchaseRep) لتجنب فشل قيود قاعدة البيانات.

## الملفات المعدلة/المضافة

- [system/lib/branding.ts](/C:/Users/Abud/Desktop/system/system/lib/branding.ts)
- [system/app/layout.tsx](/C:/Users/Abud/Desktop/system/system/app/layout.tsx)
- [system/components/layout/Sidebar.tsx](/C:/Users/Abud/Desktop/system/system/components/layout/Sidebar.tsx)
- [system/app/login/page.tsx](/C:/Users/Abud/Desktop/system/system/app/login/page.tsx)
- [system/app/(dashboard)/admin/page.tsx](/C:/Users/Abud/Desktop/system/system/app/(dashboard)/admin/page.tsx)
- [system/app/api/admin/tenants/[id]/reset/route.ts](/C:/Users/Abud/Desktop/system/system/app/api/admin/tenants/[id]/reset/route.ts)
- Assets:
  - `system/public/brand/logo.png`
  - `system/app/icon.png`
  - `system/app/apple-icon.png`

## الـAPIs التي تم إضافتها

- `GET /api/admin/tenants/:id/reset`
  - يعيد Preview لأعداد البيانات المتوقع حذفها.
- `POST /api/admin/tenants/:id/reset`
  - ينفذ التصفير بعد تأكيد كود العميل `{tenantCode}`.

- `DELETE /api/admin/users`
  - يحذف المستخدم بالكامل بعد تأكيد البريد الإلكتروني.

## التحقق (Validation)

- Local:
  - `npm test` ✅
  - `npx tsc --noEmit` ✅
  - `npm run build` ✅

- VPS:
  - تم النشر على `/var/www/erp` بدون لمس `.env`.
  - `systemctl restart erp-system` ✅
  - `curl https://og-estore.site/api/health` ✅

## ملاحظات/مخاطر متبقية

- التصفير عملية تدميرية (Destructive). تم تأمينها بتأكيد نصي ومعاينة counts، لكن يفضل استخدامها فقط على Tenant المقصود.
- إذا احتجنا لاحقاً "تصفير كامل" يشمل حذف المستخدمين أو إعادة إنشاء Tenant من الصفر، نعملها كمسار منفصل وبـMulti-confirmations إضافية.

## إصلاح مهم

- تم إصلاح سبب شائع لفشل التصفير: ترتيب الحذف داخل المعاملة كان قد يؤدي لفشل القيود المرجعية (مثل وجود `Product.warehouseId` يمنع حذف المستودعات). تم تعديل ترتيب الحذف ليتم حذف المنتجات قبل المستودعات.
