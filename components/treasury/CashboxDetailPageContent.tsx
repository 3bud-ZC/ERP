'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Download, RefreshCw, Search, WalletCards } from 'lucide-react';
import { fmtMoney } from '@/components/invoices/InvoiceConfig';
import { typeLabel } from '@/components/treasury/TreasuryPageContent';

interface Transaction {
  id: string;
  type: string;
  direction: string;
  amount: number;
  beforeBalance: number;
  afterBalance: number;
  date: string;
  referenceType?: string | null;
  referenceId?: string | null;
  description?: string | null;
}

interface CashboxDetail {
  id: string;
  code: string;
  name: string;
  currency: string;
  openingBalance: number;
  currentBalance: number;
  status: string;
  transactions: Transaction[];
  summary?: { totalInflow: number; totalOutflow: number; transactionCount: number };
}

export function CashboxDetailPageContent({ id, basePath = '/treasury' }: { id: string; basePath?: string }) {
  const [cashbox, setCashbox] = useState<CashboxDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ from: '', to: '', type: '', reference: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ id });
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.type) params.set('type', filters.type);
    if (filters.reference) params.set('reference', filters.reference);
    try {
      const res = await fetch(`/api/cashboxes?${params.toString()}`, { credentials: 'include', cache: 'no-store' });
      const j = await res.json();
      if (!j.success) throw new Error(j.message || j.error || 'تعذر تحميل الخزنة');
      setCashbox(j.data);
    } catch (err: any) {
      setError(err?.message || 'تعذر الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, [filters.from, filters.reference, filters.to, filters.type, id]);

  useEffect(() => { load(); }, [load]);

  const filteredTotals = useMemo(() => {
    const rows = cashbox?.transactions ?? [];
    return {
      in: rows.filter(t => t.direction === 'in').reduce((s, t) => s + t.amount, 0),
      out: rows.filter(t => t.direction === 'out').reduce((s, t) => s + t.amount, 0),
    };
  }, [cashbox?.transactions]);

  function exportCsv() {
    if (!cashbox) return;
    const rows = [
      ['التاريخ', 'النوع', 'الاتجاه', 'المبلغ', 'قبل الحركة', 'بعد الحركة', 'المرجع', 'الوصف'],
      ...cashbox.transactions.map(t => [
        new Date(t.date).toLocaleDateString('ar-EG'),
        typeLabel(t.type),
        t.direction === 'in' ? 'وارد' : 'منصرف',
        String(t.amount),
        String(t.beforeBalance),
        String(t.afterBalance),
        [t.referenceType, t.referenceId].filter(Boolean).join(':'),
        t.description || '',
      ]),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${cashbox.code}-transactions.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs text-slate-500 mb-1">المحاسبة &gt; الخزنة &gt; تفاصيل الخزنة</div>
          <h1 className="text-2xl font-bold text-slate-900">{cashbox?.name || 'تفاصيل الخزنة'}</h1>
          <p className="text-sm text-slate-500 mt-1">{cashbox?.code || 'جاري التحميل...'}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} disabled={!cashbox} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <Download className="h-4 w-4" /> تصدير CSV
          </button>
          <Link href={basePath} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <ArrowRight className="h-4 w-4" /> رجوع
          </Link>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Summary title="رصيد الخزنة" value={fmtMoney(cashbox?.currentBalance || 0)} />
        <Summary title="رصيد افتتاحي" value={fmtMoney(cashbox?.openingBalance || 0)} />
        <Summary title="وارد" value={fmtMoney(cashbox?.summary?.totalInflow ?? filteredTotals.in)} />
        <Summary title="منصرف" value={fmtMoney(cashbox?.summary?.totalOutflow ?? filteredTotals.out)} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input type="date" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} className={inputCls} />
          <input type="date" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} className={inputCls} />
          <select value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))} className={inputCls}>
            <option value="">كل الأنواع</option>
            <option value="opening_balance">رصيد افتتاحي</option>
            <option value="sales_receipt">تحصيل فاتورة مبيعات</option>
            <option value="purchase_payment">سداد فاتورة مشتريات</option>
            <option value="expense">مصروف</option>
            <option value="manual_in">وارد يدوي</option>
            <option value="manual_out">منصرف يدوي</option>
          </select>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={filters.reference} onChange={e => setFilters(f => ({ ...f, reference: e.target.value }))} placeholder="بحث بالمرجع أو الوصف" className={`${inputCls} pr-9`} />
          </div>
          <button onClick={load} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900">
            <RefreshCw className="h-4 w-4" /> تطبيق
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 text-right">التاريخ</th>
              <th className="px-4 py-3 text-right">النوع</th>
              <th className="px-4 py-3 text-right">الاتجاه</th>
              <th className="px-4 py-3 text-right">المبلغ</th>
              <th className="px-4 py-3 text-right">قبل</th>
              <th className="px-4 py-3 text-right">بعد</th>
              <th className="px-4 py-3 text-right">المرجع</th>
              <th className="px-4 py-3 text-right">الوصف</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">جاري تحميل الحركات...</td></tr>
            ) : !cashbox?.transactions?.length ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">لا توجد حركات مطابقة للفلاتر.</td></tr>
            ) : cashbox.transactions.map(t => (
              <tr key={t.id}>
                <td className="px-4 py-3">{new Date(t.date).toLocaleDateString('ar-EG')}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{typeLabel(t.type)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${t.direction === 'in' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {t.direction === 'in' ? 'وارد' : 'منصرف'}
                  </span>
                </td>
                <td className="px-4 py-3 font-bold">{fmtMoney(t.amount)}</td>
                <td className="px-4 py-3">{fmtMoney(t.beforeBalance)}</td>
                <td className="px-4 py-3">{fmtMoney(t.afterBalance)}</td>
                <td className="px-4 py-3 text-slate-500">{[t.referenceType, t.referenceId].filter(Boolean).join(':') || '—'}</td>
                <td className="px-4 py-3 text-slate-600">{t.description || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

function Summary({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between text-slate-500">
        <span className="text-sm">{title}</span>
        <WalletCards className="h-5 w-5 text-emerald-600" />
      </div>
      <div className="mt-3 text-xl font-bold text-slate-950">{value}</div>
    </div>
  );
}
