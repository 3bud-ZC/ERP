# تقرير تحسين الأداء + الخزنة (Performance/Treasury Polish)

التاريخ: 2026-05-24

## 1) إصلاحات “التحديث الفوري” (Refresh / Stale Data)

تم تعديل React Query defaults لحل مشكلة “لازم Refresh يدوي” بدون زيادة الضغط على الشبكة:
- `staleTime = 10s`
- `refetchOnWindowFocus = false`
- الاعتماد على `invalidateQueries` بعد عمليات Create/Update/Delete في الصفحات التشغيلية بدل refetch المستمر.

الملف:
- `components/providers/QueryProvider.tsx`

كما تم خفض `staleTime` في صفحات تشغيلية مؤثرة:
- العملاء: `app/(dashboard)/customers/page.tsx`
- الموردون: `app/(dashboard)/suppliers/page.tsx`
- قائمة الفواتير: `components/invoices/InvoiceList.tsx`
- أوامر الإنتاج + خطوط الإنتاج: `app/(dashboard)/manufacturing/*`
- المدفوعات: `app/(dashboard)/accounting/payments/page.tsx`
- ميزان المراجعة: `app/(dashboard)/accounting/trial-balance/page.tsx`

النتيجة المتوقعة:
ظهور البيانات الجديدة فور الرجوع للقوائم أو تغيير التبويبات بدون انتظار 30-60 ثانية.

## 2) تطوير الخزنة (Treasury UX + Operations)

تمت إضافة:
- “وارد يدوي” و “منصرف يدوي” في `/accounting/treasury` (Modal عربي).
- “عكس” للحركات اليدوية (في Hub وفي صفحة كل الحركات).

Routes:
- `POST /api/cashboxes/manual`
- `POST /api/cashboxes/transactions/:id/reverse`

الملفات:
- `components/treasury/TreasuryHubPageContent.tsx`
- `components/treasury/TreasuryTransactionsPageContent.tsx`
- `app/api/cashboxes/manual/route.ts`
- `app/api/cashboxes/transactions/[id]/reverse/route.ts`

## 3) التزامات أوامر الشراء (Commitments)

تم إضافة `cashboxId` اختياري في `PurchaseOrder` لدعم:
- KPI: “التزامات أوامر الشراء”
- KPI: “الرصيد المتاح” (رصيد الخزن - الالتزامات)

DB:
- `prisma/schema.prisma`
- `prisma/migrations/20260524120000_add_purchase_order_cashbox_commitment/migration.sql`

Analytics:
- `app/api/analytics/treasury/route.ts`

## 3.1) تخفيف ثقل صفحة الخزنة (Treasury Hub Performance)

تم تقليل الثقل بشكل واضح عبر:
- نقل التحليلات الثقيلة والـCharts خارج Hub (تركها في صفحة analytics فقط).
- إضافة endpoint خفيف KPI-only:
  - `GET /api/analytics/treasury-summary`
- تعديل Hub ليعتمد على:
  - `GET /api/cashboxes` (بدون report)
  - `GET /api/cashboxes?transactions=true&take=25`
  - `GET /api/analytics/treasury-summary`

الملفات:
- `app/api/analytics/treasury-summary/route.ts`
- `components/treasury/TreasuryHubPageContent.tsx`

## 3.2) تحسينات API الخزن (تقليل N+1 + تقليل payload)

- تحسين `GET /api/cashboxes?report=true` لتجنب `include transactions` (N+1) واستبداله بجلب "آخر حركة" باستعلام واحد باستخدام `distinct`.
- تقليل default `take` في `GET /api/cashboxes?transactions=true` إلى 100 (والـUI يحدد `take` عند الحاجة).

الملف:
- `app/api/cashboxes/route.ts`

## 3.3) Indexes لتحسين سرعة الاستعلامات

تم إضافة indexes لتحسين استعلامات الخزنة/الحركات + commitments:
- `CashboxTransaction(tenantId, date)`
- `CashboxTransaction(tenantId, cashboxId, date)`
- `PurchaseOrder(tenantId, cashboxId, status)`

DB:
- `prisma/schema.prisma`
- `prisma/migrations/20260524170000_perf_indexes_cashbox/migration.sql`

## 4) ثيم أزرق (Navy + Sky)

تم تقليل الاعتماد على emerald وتوحيد الـaccent إلى Sky في:
- `app/globals.css` (Tokens + background accents)
- `components/layout/Sidebar.tsx`
- `components/ui/modal.tsx`
- `app/login/page.tsx`

## 5) التحقق

محلياً:
- `npx tsc --noEmit` ✅
- `npm test` ✅
- `npm run build` ✅

على VPS:
- Backup DB إلى `/var/backups/erp/20260524-185124/backup.sql` ✅
- `npx prisma migrate deploy` ✅
- `npm run build` ✅
- `systemctl start erp-system` ✅
- Health: `https://og-estore.site/api/health` ✅

آخر نشر: `20260524-201933`

## 6) متبقي
- تحسينات إضافية للـinvalidateQueries في بعض mutations (لو ظهرت شاشات محددة ما زالت تحتاج refresh).
- تحسين “تقرير الخزنة” لعرض commitments في جدول تفصيلي (حالياً KPIs موجودة في analytics + hub).

## 7) إصلاح ربط الفواتير بالخزنة (مبيعات/مشتريات)

سبب المشكلة:
- كان النظام يعتمد على `paidAmount` اليدوي فقط لإنشاء حركة الخزنة.
- عند اختيار طريقة الدفع `cash/paid` وترك `paidAmount = 0` كانت الفاتورة تُحفظ كمدفوعة، لكن بدون إنشاء Payment/Allocation/Transaction في الخزنة.

الإصلاحات المطبقة:
- في `invoice-execution.service` تم اعتماد `effectivePaidAmount` (المبلغ المدفوع الفعلي بعد حل طريقة الدفع) بدلاً من الاعتماد على `paidAmount` الخام فقط.
- إذا `effectivePaidAmount > 0` يتم إنشاء:
  - Payment
  - PaymentAllocation
  - Cashbox transaction
  داخل نفس transaction الذرّية.
- إضافة تحقق صارم: إذا الدفع فعليًا > 0 لازم `cashboxId` موجود.
- توحيد تحقق الـAPI في إنشاء فواتير المبيعات والمشتريات بحيث حالة `cash/paid` تتطلب اختيار خزنة.
- تعديل `InvoiceForm` ليحسب المدفوع الفعلي في الـpreview/validation/payload بشكل متسق مع السيرفر.

الملفات:
- `lib/services/invoice-execution.service.ts`
- `app/api/sales-invoices/route.ts`
- `app/api/purchase-invoices/route.ts`
- `components/invoices/InvoiceForm.tsx`

نتيجة متوقعة:
- أي فاتورة مبيعات/مشتريات يتم سدادها (جزئيًا أو كليًا) من شاشة الفاتورة نفسها ستنعكس مباشرة على الخزنة المحددة.

نشر الإصلاح:
- Deployment: `20260524-232225`
- Health بعد النشر: `https://og-estore.site/api/health` ✅
