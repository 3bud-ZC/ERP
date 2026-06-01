# تقرير ERP Intelligence & Analytics (OG ERP)

التاريخ: 2026-05-23

## ما تم تنفيذه
- إضافة طبقة تحليلات (Analytics) بهدف “Executive Visibility” بدون تغيير معماري أو لمس منطق التنفيذ المالي/المخزون.
- ربط صفحات التحليلات داخل الـSidebar لتكون قابلة للوصول بسهولة.
- توحيد إشعارات النظام في الـTopbar عبر endpoint واحد للـSmart Alerts.

## صفحات/Routes جديدة (UI)
- `/dashboard/executive` لوحة التنفيذي: KPIs + اتجاهات + أفضل منتجات/عملاء + تنبيهات + نشاط مالي حديث.
- `/inventory/analytics` تحليلات المخزون: سريعة/بطيئة/راكدة + إعادة طلب + فلتر مستودع.
- `/manufacturing/analytics` تحليلات التصنيع: اتجاهات التكلفة + استهلاك + فاقد + أداء خطوط.
- `/accounting/treasury/analytics` تحليلات الخزنة: وارد/منصرف + توقعات 14 يوم + توزيع الخزن + أكبر المصروفات.

## APIs جديدة (Analytics)
- `GET /api/analytics/executive`
- `GET /api/analytics/inventory`
- `GET /api/analytics/manufacturing`
- `GET /api/analytics/treasury`
- `GET /api/analytics/alerts`

ملاحظات تقنية:
- كل الـendpoints مضبوطة على `dynamic = 'force-dynamic'` و `revalidate = 0` لتفادي أي caching غير مقصود.
- تم وضع Limits واضحة على الاستعلامات لتجنب تحميل بيانات كبيرة.

## تحسينات UX/Performance
- Sidebar:
  - إضافة روابط التحليلات: لوحة التنفيذي + تحليلات المخزون + تحليلات التصنيع + تحليلات الخزنة.
  - فتح مجموعة “لوحة التحكم” تلقائياً عند التواجد داخل `/dashboard`.
- Topbar Notifications:
  - استبدال مكالمتين API قديمتين بواحدة: `/api/analytics/alerts`.
  - تحديث تلقائي للإشعارات كل 60 ثانية.
  - دعم 3 درجات severity: مرتفع/متوسط/منخفض مع ألوان وأيقونات مختلفة.

## تحسينات قسم المحاسبة (UI)
- توحيد تبويبات المحاسبة الأساسية لتكون واضحة ومترابطة:
  - لوحة التحكم المالية
  - المالية
  - الخزنة
  - المدفوعات
  - ميزان المراجعة
- إضافة شريط اختصارات ثابت داخل صفحات المحاسبة لسهولة التنقل بين الصفحات الأساسية.
- صفحة المدفوعات أصبحت تدعم فلترة سريعة: (الكل / التحصيلات / المدفوعات) عبر `?type=`.

## الملفات المعدلة
- [Sidebar.tsx](/C:/Users/Abud/Desktop/system/system/components/layout/Sidebar.tsx)
- [Topbar.tsx](/C:/Users/Abud/Desktop/system/system/components/layout/Topbar.tsx)

## التحقق (Validation)
محلياً:
- `npx tsc --noEmit`
- `npm run build`

الإنتاج (بعد النشر):
- فحص `https://og-estore.site/api/health`
- فتح:
  - `/login`
  - `/dashboard/executive`
  - `/inventory/analytics`
  - `/manufacturing/analytics`
  - `/accounting/treasury/analytics`

## حالة النشر (Deployment)
- لم يتم تنفيذ النشر من داخل Codex في هذه الخطوة (يتطلب SSH credentials/إتاحة وصول).
- جاهز للنشر عبر tar/rsync مع الحفاظ على `.env` وملفات uploads/storage.

## مخاطر/ملاحظات متبقية
- أي تقارير ثقيلة جداً قد تحتاج Pagination/Indexes لاحقاً حسب حجم البيانات الفعلي.
- إن وُجدت شكاوى “تحتاج Refresh” في صفحات غير التحليلات، نكمل audit على الصفحات الأكثر استخداماً ونضيف `force-dynamic` أو `router.refresh()/invalidateQueries` حسب الحالة.
