'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDownCircle, ArrowUpCircle, BarChart3, RefreshCw, WalletCards } from 'lucide-react';
import { AccountingLayout } from '@/components/accounting/AccountingLayout';
import { fmtMoney } from '@/components/invoices/InvoiceConfig';
import { ChartCard } from '@/components/analytics/ChartCard';
import { KpiCard } from '@/components/analytics/KpiCard';
import { TrendLineChart } from '@/components/analytics/TrendLineChart';

type TreasuryData = {
  kpis: {
    treasuryBalance: number;
    dailyInflow: number;
    dailyOutflow: number;
    expectedCollections14d: number;
    expectedPayments14d: number;
  };
  trend: Array<{ day: string; inflow: number; outflow: number }>;
  distribution: Array<{ id: string; code: string; name: string; balance: number; currency: string; status: string }>;
  biggestExpenses: Array<{ id: string; category: string; description: string; total: number; date: string }>;
  forecast: {
    expectedCollections: { total: number; buckets: Array<{ day: string; value: number; count: number }> };
    expectedPayments: { total: number; buckets: Array<{ day: string; value: number; count: number }> };
  };
};

export default function TreasuryAnalyticsPage() {
  const [data, setData] = useState<TreasuryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/analytics/treasury', { credentials: 'include', cache: 'no-store' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'تعذر تحميل تحليلات الخزنة');
      setData(json.data);
    } catch (err: any) {
      setError(err?.message || 'تعذر الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const trendChart = useMemo(
    () => (data?.trend ?? []).map((r) => ({ day: r.day, inflow: r.inflow, outflow: r.outflow })),
    [data?.trend],
  );

  const forecastChart = useMemo(() => {
    const map = new Map<string, any>();
    (data?.forecast.expectedCollections.buckets ?? []).forEach((b) => { map.set(b.day, { day: b.day, collections: b.value }); });
    (data?.forecast.expectedPayments.buckets ?? []).forEach((b) => {
      const row = map.get(b.day) || { day: b.day };
      row.payments = b.value;
      map.set(b.day, row);
    });
    return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));
  }, [data?.forecast.expectedCollections.buckets, data?.forecast.expectedPayments.buckets]);

  return (
    <AccountingLayout
      title="تحليلات الخزنة"
      subtitle="اتجاهات النقدية، التوقعات، التوزيع، وأكبر المصروفات"
      toolbar={
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          تحديث
        </button>
      }
    >
      <div className="space-y-5" dir="rtl">
        <div className="text-xs text-slate-500">المحاسبة &gt; الخزنة &gt; التحليلات</div>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="grid gap-3 md:grid-cols-5">
          <KpiCard title="رصيد الخزائن" value={fmtMoney(data?.kpis.treasuryBalance || 0)} icon={<WalletCards className="h-4 w-4" />} />
          <KpiCard title="وارد اليوم" value={fmtMoney(data?.kpis.dailyInflow || 0)} icon={<ArrowDownCircle className="h-4 w-4" />} tone="emerald" />
          <KpiCard title="منصرف اليوم" value={fmtMoney(data?.kpis.dailyOutflow || 0)} icon={<ArrowUpCircle className="h-4 w-4" />} tone="red" />
          <KpiCard title="تحصيل متوقع 14 يوم" value={fmtMoney(data?.kpis.expectedCollections14d || 0)} tone="emerald" icon={<BarChart3 className="h-4 w-4" />} />
          <KpiCard title="سداد متوقع 14 يوم" value={fmtMoney(data?.kpis.expectedPayments14d || 0)} tone="amber" icon={<BarChart3 className="h-4 w-4" />} />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard title="اتجاه الوارد/المنصرف" subtitle="يومي">
            {loading ? <Sk /> : (
              <TrendLineChart
                data={trendChart}
                series={[
                  { key: 'inflow', name: 'وارد', color: '#22c55e', format: 'money' },
                  { key: 'outflow', name: 'منصرف', color: '#ef4444', format: 'money' },
                ]}
              />
            )}
          </ChartCard>
          <ChartCard title="توقعات التحصيل/السداد" subtitle="14 يوم قادمة">
            {loading ? <Sk /> : (
              <TrendLineChart
                data={forecastChart}
                series={[
                  { key: 'collections', name: 'تحصيل متوقع', color: '#10b981', format: 'money' },
                  { key: 'payments', name: 'سداد متوقع', color: '#f97316', format: 'money' },
                ]}
              />
            )}
          </ChartCard>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard title="توزيع الخزن" subtitle="رصيد كل خزنة" right={<Link href="/accounting/treasury" className="text-xs font-semibold text-emerald-700 hover:text-emerald-900">الخزن</Link>}>
            <MiniTable
              loading={loading}
              headers={['الخزنة', 'الرصيد']}
              rows={(data?.distribution ?? []).map((c) => [c.name, fmtMoney(c.balance)])}
              empty="لا توجد خزن."
            />
          </ChartCard>
          <ChartCard title="أكبر المصروفات" subtitle="خلال الفترة" right={<Link href="/reports/expenses" className="text-xs font-semibold text-emerald-700 hover:text-emerald-900">تقرير المصروفات</Link>}>
            <MiniTable
              loading={loading}
              headers={['التاريخ', 'النوع', 'القيمة']}
              rows={(data?.biggestExpenses ?? []).map((e) => [new Date(e.date).toLocaleDateString('ar-EG'), e.category || 'مصروف', fmtMoney(e.total)])}
              empty="لا توجد مصروفات."
            />
          </ChartCard>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-700">خطوات سريعة</div>
          <div className="flex gap-2">
            <Link className={pillCls} href="/accounting/treasury/transactions">حركات الخزنة</Link>
            <Link className={pillCls} href="/accounting/treasury/transfers">تحويل بين الخزن</Link>
          </div>
        </div>
      </div>
    </AccountingLayout>
  );
}

const pillCls = 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50';

function Sk() {
  return <div className="h-[260px] w-full animate-pulse rounded-lg bg-slate-100" />;
}

function MiniTable({ loading, headers, rows, empty }: { loading: boolean; headers: string[]; rows: string[][]; empty: string }) {
  if (loading) return <div className="space-y-2">{[1, 2, 3, 4].map((i) => <div key={i} className="h-10 animate-pulse rounded-md bg-slate-100" />)}</div>;
  if (!rows.length) return <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">{empty}</div>;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            {headers.map((h) => <th key={h} className="px-3 py-2 text-right text-xs font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, idx) => (
            <tr key={idx} className="hover:bg-slate-50">
              {r.map((c, i) => <td key={i} className="px-3 py-2">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

