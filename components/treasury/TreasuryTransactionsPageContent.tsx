'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { fmtMoney } from '@/components/invoices/InvoiceConfig';
import { typeLabel } from '@/components/treasury/TreasuryPageContent';
import { Toast, useToast } from '@/components/ui/patterns';

interface TxRow {
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
  cashbox?: { id: string; code: string; name: string };
}

const EMPTY_FILTERS = { from: '', to: '', type: '', reference: '' };

export function TreasuryTransactionsPageContent() {
  const [toast, showToast] = useToast();
  const [rows, setRows] = useState<TxRow[]>([]);
  const [summary, setSummary] = useState({ totalInflow: 0, totalOutflow: 0, transactionCount: 0 });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (nextFilters: typeof EMPTY_FILTERS) => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ transactions: 'true' });
    if (nextFilters.from) params.set('from', nextFilters.from);
    if (nextFilters.to) params.set('to', nextFilters.to);
    if (nextFilters.type) params.set('type', nextFilters.type);
    if (nextFilters.reference) params.set('reference', nextFilters.reference);
    try {
      const res = await fetch(`/api/cashboxes?${params.toString()}`, { credentials: 'include', cache: 'no-store' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'تعذر تحميل حركات الخزنة');
      setRows(json.data?.rows ?? []);
      setSummary(json.data?.summary ?? { totalInflow: 0, totalOutflow: 0, transactionCount: 0 });
    } catch (err: any) {
      setError(err?.message || 'تعذر الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(EMPTY_FILTERS); }, [load]);

  async function reverseManual(id: string) {
    const ok = window.confirm('تأكيد: هل تريد عكس هذه الحركة اليدوية؟ سيتم إنشاء حركة عكس بنفس المبلغ.');
    if (!ok) return;
    try {
      const res = await fetch(`/api/cashboxes/transactions/${encodeURIComponent(id)}/reverse`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.message || 'تعذر عكس الحركة');
      showToast(json?.message || 'تم عكس الحركة بنجاح', 'success');
      await load(filters);
    } catch (err: any) {
      showToast(err?.message || 'تعذر عكس الحركة', 'error');
    }
  }

  function exportCsv() {
    const csvRows = [
      ['الخزنة', 'التاريخ', 'النوع', 'الاتجاه', 'المبلغ', 'قبل الحركة', 'بعد الحركة', 'المرجع', 'الوصف'],
      ...rows.map((r) => [
        r.cashbox?.name || '',
        new Date(r.date).toLocaleString('ar-EG'),
        typeLabel(r.type),
        r.direction === 'in' ? 'وارد' : 'منصرف',
        r.amount,
        r.beforeBalance,
        r.afterBalance,
        [r.referenceType, r.referenceId].filter(Boolean).join(':'),
        r.description || '',
      ]),
    ];
    const csv = csvRows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'treasury-transactions.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5" dir="rtl">
      <Toast toast={toast} />
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs text-slate-500 mb-1">المحاسبة &gt; الخزنة &gt; الحركات</div>
          <h1 className="text-2xl font-bold text-slate-900">حركات الخزنة</h1>
          <p className="text-sm text-slate-500 mt-1">تتبع كل وارد ومنصرف مع الرصيد قبل وبعد الحركة والمرجع التشغيلي.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/accounting/treasury/transfers" className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-900">تحويل بين الخزن</Link>
          <button onClick={exportCsv} disabled={!rows.length} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50">
            <Download className="h-4 w-4" /> تصدير
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-3 md:grid-cols-3">
        <Summary title="إجمالي الوارد" value={fmtMoney(summary.totalInflow)} />
        <Summary title="إجمالي المنصرف" value={fmtMoney(summary.totalOutflow)} />
        <Summary title="عدد الحركات" value={String(summary.transactionCount)} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-5">
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className={inputCls} />
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className={inputCls} />
          <select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })} className={inputCls}>
            <option value="">كل الأنواع</option>
            <option value="sales_receipt">تحصيل مبيعات</option>
            <option value="purchase_payment">سداد مشتريات</option>
            <option value="expense">مصروف</option>
            <option value="salary">راتب</option>
            <option value="treasury_transfer">تحويل خزنة</option>
            <option value="manual_in">وارد يدوي</option>
            <option value="manual_out">منصرف يدوي</option>
          </select>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={filters.reference} onChange={(e) => setFilters({ ...filters, reference: e.target.value })} placeholder="المرجع أو الوصف" className={`${inputCls} pr-9`} />
          </div>
          <button onClick={() => void load(filters)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> تطبيق
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-4 py-3 text-right">الخزنة</th>
              <th className="px-4 py-3 text-right">التاريخ</th>
              <th className="px-4 py-3 text-right">النوع</th>
              <th className="px-4 py-3 text-right">الاتجاه</th>
              <th className="px-4 py-3 text-right">المبلغ</th>
              <th className="px-4 py-3 text-right">قبل</th>
              <th className="px-4 py-3 text-right">بعد</th>
              <th className="px-4 py-3 text-right">المرجع</th>
              <th className="px-4 py-3 text-right w-28">إجراء</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">جاري تحميل الحركات...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-500">لا توجد حركات مطابقة.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-semibold">{row.cashbox?.name || '-'}</td>
                <td className="px-4 py-3">{new Date(row.date).toLocaleString('ar-EG')}</td>
                <td className="px-4 py-3">{typeLabel(row.type)}</td>
                <td className="px-4 py-3"><span className={row.direction === 'in' ? 'text-sky-700 font-bold' : 'text-red-700 font-bold'}>{row.direction === 'in' ? 'وارد' : 'منصرف'}</span></td>
                <td className="px-4 py-3 font-bold">{fmtMoney(row.amount)}</td>
                <td className="px-4 py-3">{fmtMoney(row.beforeBalance)}</td>
                <td className="px-4 py-3">{fmtMoney(row.afterBalance)}</td>
                <td className="px-4 py-3 text-slate-500">{[row.referenceType, row.referenceId].filter(Boolean).join(':') || '-'}</td>
                <td className="px-4 py-3">
                  {row.type === 'manual_in' || row.type === 'manual_out' ? (
                    <button
                      onClick={() => reverseManual(row.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      title="عكس الحركة"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      عكس
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500';

function Summary({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold text-slate-500">{title}</div>
      <div className="mt-2 text-xl font-black text-slate-950">{value}</div>
    </div>
  );
}
