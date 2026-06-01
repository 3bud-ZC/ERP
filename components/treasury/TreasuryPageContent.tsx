'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ArrowDownCircle, ArrowUpCircle, Eye, Plus, RefreshCw, WalletCards,
} from 'lucide-react';
import { fmtMoney } from '@/components/invoices/InvoiceConfig';

interface CashboxTransaction {
  id: string;
  type: string;
  direction: string;
  amount: number;
  date: string;
  description?: string | null;
}

interface Cashbox {
  id: string;
  code: string;
  name: string;
  currency: string;
  openingBalance: number;
  currentBalance: number;
  status: string;
  transactions?: CashboxTransaction[];
}

interface SummaryData {
  totalBalance: number;
  totalInflow: number;
  totalOutflow: number;
  activeCashboxes: number;
  lowBalanceCount: number;
  transactionCount: number;
  pendingReceivables?: number;
  pendingPayables?: number;
  overdueInvoices?: number;
  dailyInflow?: number;
  dailyOutflow?: number;
}

const emptySummary: SummaryData = {
  totalBalance: 0,
  totalInflow: 0,
  totalOutflow: 0,
  activeCashboxes: 0,
  lowBalanceCount: 0,
  transactionCount: 0,
};

export function TreasuryPageContent({ basePath = '/treasury' }: { basePath?: string }) {
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
  const [summary, setSummary] = useState<SummaryData>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const [resCashboxes, resSummary] = await Promise.all([
        fetch('/api/cashboxes?report=true', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/analytics/treasury-summary', { credentials: 'include', cache: 'no-store' }),
      ]);

      const j = await resCashboxes.json();
      if (!j.success) throw new Error(j.message || j.error || 'تعذر تحميل الخزن');
      const payload = Array.isArray(j.data) ? { cashboxes: j.data, summary: emptySummary } : j.data;

      const s = await resSummary.json().catch(() => null);
      const kpis = s?.success ? s.data?.kpis : {};
      setCashboxes(payload.cashboxes ?? []);
      setSummary({
        ...(payload.summary ?? emptySummary),
        dailyInflow: kpis?.dailyInflow ?? 0,
        dailyOutflow: kpis?.dailyOutflow ?? 0,
      });
    } catch (err: any) {
      setError(err?.message || 'تعذر الاتصال بالخادم');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const hasWarning = useMemo(
    () => summary.lowBalanceCount > 0 || cashboxes.some(c => Number(c.currentBalance || 0) < 0),
    [cashboxes, summary.lowBalanceCount],
  );

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs text-slate-500 mb-1">المحاسبة &gt; الخزنة</div>
          <h1 className="text-2xl font-bold text-slate-900">الخزنة</h1>
          <p className="text-sm text-slate-500 mt-1">متابعة النقدية الفعلية وحركات التحصيل والسداد.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> تحديث
          </button>
          <Link href={`${basePath}/new`} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-900">
            <Plus className="h-4 w-4" /> إضافة خزنة
          </Link>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {hasWarning && !loading && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4" /> توجد خزنة برصيد منخفض أو صفر. راجع حركة النقدية قبل تسجيل مدفوعات جديدة.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Summary title="إجمالي الرصيد" value={fmtMoney(summary.totalBalance)} icon={<WalletCards className="h-5 w-5" />} />
        <Summary title="وارد اليوم" value={fmtMoney(summary.dailyInflow ?? 0)} icon={<ArrowDownCircle className="h-5 w-5" />} />
        <Summary title="منصرف اليوم" value={fmtMoney(summary.dailyOutflow ?? 0)} icon={<ArrowUpCircle className="h-5 w-5" />} />
        <Summary title="الخزن النشطة" value={String(summary.activeCashboxes)} icon={<WalletCards className="h-5 w-5" />} />
        <Summary title="عدد الحركات" value={String(summary.transactionCount)} icon={<RefreshCw className="h-5 w-5" />} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Summary title="مديونيات قيد التحصيل" value={fmtMoney(summary.pendingReceivables ?? 0)} icon={<ArrowDownCircle className="h-5 w-5" />} />
        <Summary title="مستحقات مطلوبة" value={fmtMoney(summary.pendingPayables ?? 0)} icon={<ArrowUpCircle className="h-5 w-5" />} />
        <Summary title="فواتير متأخرة" value={String(summary.overdueInvoices ?? 0)} icon={<AlertTriangle className="h-5 w-5" />} />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-44 rounded-lg border border-slate-200 bg-white animate-pulse" />)}
        </div>
      ) : cashboxes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
          لا توجد خزن بعد. أضف خزنة لتسجيل المدفوعات النقدية وربطها بالفواتير.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {cashboxes.map(c => {
            const last = c.transactions?.[0];
            return (
              <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-bold text-slate-950">{c.name}</h2>
                    <p className="text-xs text-slate-500 mt-1">{c.code} · {c.currency}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${c.status === 'active' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>
                    {c.status === 'active' ? 'نشطة' : 'غير نشطة'}
                  </span>
                </div>
                <div className="mt-5 text-3xl font-black text-slate-950">{fmtMoney(c.currentBalance)}</div>
                <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <div className="font-semibold text-slate-700">آخر حركة</div>
                  <div className="mt-1 truncate">{last ? `${typeLabel(last.type)} - ${fmtMoney(last.amount)}` : 'لا توجد حركات'}</div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Link href={`${basePath}/${c.id}`} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    <Eye className="h-4 w-4" /> التفاصيل
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function typeLabel(type: string) {
  const labels: Record<string, string> = {
    sales_receipt: 'تحصيل فاتورة مبيعات',
    purchase_payment: 'سداد فاتورة مشتريات',
    expense: 'مصروف',
    manual_in: 'وارد يدوي',
    manual_out: 'منصرف يدوي',
    manual_in_reversal: 'عكس وارد يدوي',
    manual_out_reversal: 'عكس منصرف يدوي',
    opening_balance: 'رصيد افتتاحي',
    payment_reversal: 'عكس حركة',
    sales_receipt_reversal: 'عكس تحصيل',
    purchase_payment_reversal: 'عكس سداد',
    treasury_transfer: 'تحويل بين الخزن',
    salary: 'راتب',
    adjustment: 'تسوية',
  };
  return labels[type] || type;
}

function Summary({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between text-slate-500">
        <span className="text-sm">{title}</span>
        <span className="text-sky-700">{icon}</span>
      </div>
      <div className="mt-3 text-xl font-bold text-slate-950">{value}</div>
    </div>
  );
}
