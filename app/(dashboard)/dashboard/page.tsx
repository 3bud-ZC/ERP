'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw,
  ShoppingCart,
  Truck,
  Wallet,
  TrendingUp,
  Users,
  AlertTriangle,
  FileText,
  Package,
  Clock4,
} from 'lucide-react';
import { apiGet, apiGetList } from '@/lib/api/fetcher';
import { queryKeys } from '@/lib/api/query-keys';

interface DashboardData {
  totalSales: number;
  totalPurchases: number;
  totalExpenses: number;
  salesTrend: number;
  purchasesTrend: number;
  expensesTrend: number;
  grossProfit: number;
  netProfit: number;
  profitMargin: number;
  lowStockDetails: { id: string; nameAr: string; stock: number; minStock?: number }[];
  totalProducts: number;
  recentActivities: {
    id: string;
    type: string;
    title: string;
    description: string;
    amount: number;
    date: string;
    status: string;
  }[];
}

interface SalesInvoice {
  id: string;
  invoiceNumber: string;
  date?: string;
  createdAt: string;
  total?: number;
  grandTotal?: number;
  paidAmount?: number;
  remainingAmount?: number;
  status?: string;
  customer?: { nameAr: string };
}

interface PurchaseInvoice {
  id: string;
  invoiceNumber: string;
  date?: string;
  createdAt: string;
  total?: number;
  grandTotal?: number;
  paidAmount?: number;
  remainingAmount?: number;
  status?: string;
  supplier?: { nameAr: string };
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function moneyEGP(v: number): string {
  return `${v.toLocaleString('ar-EG', { maximumFractionDigits: 0 })} ج.م`;
}

function shortDate(v?: string) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function monthShort(v: Date) {
  return v.toLocaleDateString('ar-EG', { month: 'short' });
}

function DashboardKpi({
  title,
  value,
  hint,
  icon,
}: {
  title: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="silk-card rounded-2xl p-5">
      <div className="mb-3 flex items-start justify-between">
        <p className="text-sm text-slate-500">{title}</p>
        <div className="silk-inset flex h-10 w-10 items-center justify-center rounded-full text-indigo-600">{icon}</div>
      </div>
      <p className="text-3xl font-semibold text-slate-900 leading-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export default function DashboardPage() {
  const qc = useQueryClient();

  const [dashQ, salesQ, purchasesQ, customersQ, suppliersQ] = useQueries({
    queries: [
      { queryKey: queryKeys.dashboard, queryFn: () => apiGet<DashboardData>('/api/dashboard'), staleTime: 5_000 },
      { queryKey: queryKeys.salesInvoices, queryFn: () => apiGetList<SalesInvoice>('/api/sales-invoices'), staleTime: 5_000 },
      { queryKey: queryKeys.purchaseInvoices, queryFn: () => apiGetList<PurchaseInvoice>('/api/purchase-invoices'), staleTime: 5_000 },
      { queryKey: queryKeys.customers, queryFn: () => apiGetList<any>('/api/customers'), staleTime: 5_000 },
      { queryKey: queryKeys.suppliers, queryFn: () => apiGetList<any>('/api/suppliers'), staleTime: 5_000 },
    ],
  });

  const loading = [dashQ, salesQ, purchasesQ, customersQ, suppliersQ].some((q) => q.isLoading);
  const refreshing = [dashQ, salesQ, purchasesQ, customersQ, suppliersQ].some((q) => q.isFetching && !q.isLoading);

  const dash = dashQ.data;
  const sales = salesQ.data ?? [];
  const purchases = purchasesQ.data ?? [];
  const customers = customersQ.data ?? [];
  const suppliers = suppliersQ.data ?? [];

  const invoiceInsights = useMemo(() => {
    const salesTotal = sales.reduce((s, i) => s + toNum(i.grandTotal ?? i.total), 0);
    const purchaseTotal = purchases.reduce((s, i) => s + toNum(i.grandTotal ?? i.total), 0);

    const receivables = sales.reduce((s, i) => {
      const explicit = toNum(i.remainingAmount);
      if (explicit > 0) return s + explicit;
      const total = toNum(i.grandTotal ?? i.total);
      const paid = toNum(i.paidAmount);
      return s + Math.max(0, total - paid);
    }, 0);

    const payables = purchases.reduce((s, i) => {
      const explicit = toNum(i.remainingAmount);
      if (explicit > 0) return s + explicit;
      const total = toNum(i.grandTotal ?? i.total);
      const paid = toNum(i.paidAmount);
      return s + Math.max(0, total - paid);
    }, 0);

    const now = new Date();
    const monthly = Array.from({ length: 6 }).map((_, idx) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - idx), 1);
      return {
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: monthShort(d),
        sales: 0,
        purchases: 0,
      };
    });
    const monthlyMap = new Map(monthly.map((m) => [m.key, m]));

    for (const inv of sales) {
      const dt = new Date(inv.date ?? inv.createdAt);
      if (Number.isNaN(dt.getTime())) continue;
      const key = `${dt.getFullYear()}-${dt.getMonth()}`;
      const target = monthlyMap.get(key);
      if (target) target.sales += toNum(inv.grandTotal ?? inv.total);
    }
    for (const inv of purchases) {
      const dt = new Date(inv.date ?? inv.createdAt);
      if (Number.isNaN(dt.getTime())) continue;
      const key = `${dt.getFullYear()}-${dt.getMonth()}`;
      const target = monthlyMap.get(key);
      if (target) target.purchases += toNum(inv.grandTotal ?? inv.total);
    }

    const maxValue = Math.max(
      1,
      ...monthly.flatMap((m) => [m.sales, m.purchases]),
    );

    const pendingSales = sales.filter((i) => i.status === 'pending' || i.status === 'draft').length;
    const pendingPurchases = purchases.filter((i) => i.status === 'pending' || i.status === 'draft').length;

    return {
      salesTotal,
      purchaseTotal,
      receivables,
      payables,
      monthly,
      maxValue,
      pendingSales,
      pendingPurchases,
    };
  }, [sales, purchases]);

  const recentSales = useMemo(() => sales.slice(0, 5), [sales]);

  if (loading) {
    return (
      <div className="space-y-6" dir="rtl">
        <div className="silk-card h-24 animate-pulse rounded-2xl" />
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="silk-card h-40 animate-pulse rounded-2xl" />)}
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="silk-card h-[370px] animate-pulse rounded-2xl xl:col-span-2" />
          <div className="silk-card h-[370px] animate-pulse rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-7" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-4xl font-semibold text-slate-900">لوحة التحكم الرئيسية</h1>
          <p className="mt-1 text-sm text-slate-500">متابعة المبيعات والمشتريات والمخزون والمحاسبة لحظيًا</p>
        </div>
        <button
          type="button"
          onClick={() => {
            qc.invalidateQueries({ queryKey: queryKeys.dashboard });
            qc.invalidateQueries({ queryKey: queryKeys.salesInvoices });
            qc.invalidateQueries({ queryKey: queryKeys.purchaseInvoices });
            qc.invalidateQueries({ queryKey: queryKeys.customers });
            qc.invalidateQueries({ queryKey: queryKeys.suppliers });
          }}
          className="silk-btn inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          تحديث البيانات
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-5">
        <DashboardKpi title="إجمالي المبيعات" value={moneyEGP(dash?.totalSales ?? invoiceInsights.salesTotal)} hint={`نمو ${Math.abs(toNum(dash?.salesTrend)).toFixed(1)}%`} icon={<ShoppingCart className="h-5 w-5" />} />
        <DashboardKpi title="إجمالي المشتريات" value={moneyEGP(dash?.totalPurchases ?? invoiceInsights.purchaseTotal)} hint={`نمو ${Math.abs(toNum(dash?.purchasesTrend)).toFixed(1)}%`} icon={<Truck className="h-5 w-5" />} />
        <DashboardKpi title="صافي الربح" value={moneyEGP(dash?.netProfit ?? 0)} hint={`هامش ${toNum(dash?.profitMargin).toFixed(1)}%`} icon={<TrendingUp className="h-5 w-5" />} />
        <DashboardKpi title="مديونيات العملاء" value={moneyEGP(invoiceInsights.receivables)} hint={`${invoiceInsights.pendingSales} فواتير غير مكتملة`} icon={<Wallet className="h-5 w-5" />} />
        <DashboardKpi title="مستحقات الموردين" value={moneyEGP(invoiceInsights.payables)} hint={`${invoiceInsights.pendingPurchases} فواتير غير مكتملة`} icon={<FileText className="h-5 w-5" />} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="silk-card rounded-2xl p-6 xl:col-span-2">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-2xl font-semibold text-slate-900">حركة 6 شهور (بيانات فعلية)</h3>
            <span className="text-xs text-slate-500">المبيعات مقابل المشتريات</span>
          </div>
          <div className="grid h-[260px] grid-cols-6 items-end gap-4">
            {invoiceInsights.monthly.map((m) => {
              const salesH = Math.max(10, Math.round((m.sales / invoiceInsights.maxValue) * 210));
              const purchasesH = Math.max(10, Math.round((m.purchases / invoiceInsights.maxValue) * 210));
              return (
                <div key={m.key} className="flex flex-col items-center gap-2">
                  <div className="flex h-[220px] items-end gap-2">
                    <div className="neo-raised w-4 rounded-t-xl bg-indigo-500/80" style={{ height: salesH }} title={`مبيعات: ${moneyEGP(m.sales)}`} />
                    <div className="neo-raised w-4 rounded-t-xl bg-violet-400/70" style={{ height: purchasesH }} title={`مشتريات: ${moneyEGP(m.purchases)}`} />
                  </div>
                  <span className="text-xs text-slate-500">{m.label}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-center gap-5 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-indigo-500" /> مبيعات</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-violet-400" /> مشتريات</span>
          </div>
        </div>

        <div className="silk-card rounded-2xl p-6">
          <h3 className="mb-4 text-2xl font-semibold text-slate-900">تنبيهات تشغيلية</h3>
          <div className="space-y-3">
            <div className="silk-inset rounded-xl p-3">
              <p className="text-sm text-slate-500">العملاء</p>
              <p className="text-2xl font-semibold text-slate-900">{customers.length}</p>
            </div>
            <div className="silk-inset rounded-xl p-3">
              <p className="text-sm text-slate-500">الموردون</p>
              <p className="text-2xl font-semibold text-slate-900">{suppliers.length}</p>
            </div>
            <div className="silk-inset rounded-xl p-3">
              <p className="text-sm text-slate-500">منتجات منخفضة المخزون</p>
              <p className="text-2xl font-semibold text-slate-900">{dash?.lowStockDetails?.length ?? 0}</p>
              <Link href="/inventory/products" className="mt-1 inline-block text-xs text-indigo-600 hover:text-indigo-700">عرض المنتجات</Link>
            </div>
          </div>
          {(dash?.lowStockDetails?.length ?? 0) > 0 ? (
            <div className="mt-4 rounded-xl bg-red-50 p-3 text-red-700">
              <p className="mb-2 inline-flex items-center gap-1 text-sm font-medium"><AlertTriangle className="h-4 w-4" /> تنبيه مخزون</p>
              <div className="space-y-1 text-xs">
                {dash!.lowStockDetails.slice(0, 3).map((p) => (
                  <p key={p.id}>
                    {p.nameAr}: {p.stock} / {p.minStock ?? 0}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="silk-card rounded-2xl p-6">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="text-2xl font-semibold text-slate-900">آخر فواتير المبيعات</h3>
            <Link href="/invoices/sales" className="text-sm text-indigo-600 hover:text-indigo-700">عرض الكل</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right">
              <thead>
                <tr className="border-b border-slate-300/70 text-sm text-slate-500">
                  <th className="pb-3">رقم الفاتورة</th>
                  <th className="pb-3">العميل</th>
                  <th className="pb-3">التاريخ</th>
                  <th className="pb-3">المبلغ</th>
                </tr>
              </thead>
              <tbody>
                {recentSales.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-500">لا توجد فواتير مبيعات بعد</td>
                  </tr>
                ) : recentSales.map((inv) => (
                  <tr key={inv.id} className="border-b border-slate-200/70 last:border-0">
                    <td className="py-3 font-semibold text-slate-800">{inv.invoiceNumber}</td>
                    <td className="py-3 text-slate-700">{inv.customer?.nameAr ?? '—'}</td>
                    <td className="py-3 text-slate-500">{shortDate(inv.date ?? inv.createdAt)}</td>
                    <td className="py-3 font-semibold text-slate-900">{moneyEGP(toNum(inv.grandTotal ?? inv.total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="silk-card rounded-2xl p-6">
          <h3 className="mb-5 text-2xl font-semibold text-slate-900">آخر أنشطة النظام</h3>
          <div className="space-y-3">
            {(dash?.recentActivities ?? []).slice(0, 6).map((a) => (
              <div key={a.id} className="silk-inset flex items-start justify-between rounded-xl p-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{a.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{a.description}</p>
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-slate-900">{moneyEGP(toNum(a.amount))}</p>
                  <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500"><Clock4 className="h-3 w-3" /> {shortDate(a.date)}</p>
                </div>
              </div>
            ))}
            {(dash?.recentActivities?.length ?? 0) === 0 ? (
              <div className="silk-inset rounded-xl p-4 text-sm text-slate-500">لا توجد أنشطة حديثة الآن</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link href="/invoices/sales/new" className="silk-btn rounded-xl px-4 py-3 text-center text-sm font-semibold">إنشاء فاتورة مبيعات</Link>
        <Link href="/invoices/purchases/new" className="silk-btn rounded-xl px-4 py-3 text-center text-sm font-semibold">إنشاء فاتورة مشتريات</Link>
        <Link href="/inventory/stock-adjustments/new" className="silk-btn rounded-xl px-4 py-3 text-center text-sm font-semibold">تسوية مخزون</Link>
      </div>
    </div>
  );
}
