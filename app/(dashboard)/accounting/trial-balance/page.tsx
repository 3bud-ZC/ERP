'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiGetList } from '@/lib/api/fetcher';
import {
  Scale,
  CheckCircle,
  AlertTriangle,
  Printer,
  RefreshCw,
} from 'lucide-react';
import { AccountingLayout, KpiCard } from '@/components/accounting/AccountingLayout';
import { AccountingQuickNav } from '@/components/accounting/AccountingQuickNav';

interface TrialBalanceRow {
  account: string;
  accountCode: string;
  accountNameAr: string;
  accountNameEn?: string | null;
  accountType?: string | null;
  debit: number;
  credit: number;
}

const TYPE_LABELS: Record<string, string> = {
  asset: 'الأصول',
  liability: 'الالتزامات',
  equity: 'حقوق الملكية',
  revenue: 'الإيرادات',
  expense: 'المصروفات',
  ASSET: 'الأصول',
  LIABILITY: 'الالتزامات',
  EQUITY: 'حقوق الملكية',
  REVENUE: 'الإيرادات',
  EXPENSE: 'المصروفات',
};

function fmtMoney(v: number) {
  return v.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Trial Balance page.
 *
 * Snapshot of every account's debit / credit totals as of a chosen date
 * (defaults to today). Pulls from `/api/accounting/trial-balance` which
 * aggregates all *posted* journal-entry lines for the tenant.
 */
export default function TrialBalancePage() {
  const today = new Date().toISOString().slice(0, 10);
  const [asOfDate, setAsOfDate] = useState(today);

  const trialQ = useQuery({
    queryKey: ['accounting', 'trial-balance', asOfDate],
    queryFn: () => apiGetList<TrialBalanceRow>(`/api/accounting/trial-balance?asOfDate=${asOfDate}`),
    staleTime: 0,
  });
  const rows = useMemo(() => trialQ.data ?? [], [trialQ.data]);
  const loading = trialQ.isLoading;
  const errMsg = trialQ.error ? (trialQ.error as Error).message : null;

  const totals = useMemo(() => {
    let totalDebit = 0, totalCredit = 0;
    for (const r of rows) {
      totalDebit  += Number(r.debit  ?? 0);
      totalCredit += Number(r.credit ?? 0);
    }
    return { totalDebit, totalCredit, isBalanced: Math.abs(totalDebit - totalCredit) < 0.01 };
  }, [rows]);

  function printReport() {
    const printable = document.getElementById('trial-balance-printable')?.innerHTML ?? '';
    const win = window.open('', '_blank', 'width=1100,height=800');
    if (!win) {
      window.print();
      return;
    }
    win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /><title>ميزان المراجعة</title><style>@page{margin:12mm}body{font-family:Arial,Tahoma,sans-serif;color:#0f172a;direction:rtl}h1{font-size:20px;margin:0 0 6px}.muted{font-size:12px;color:#64748b;margin-bottom:14px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #e2e8f0;padding:7px 8px;text-align:right}th{background:#f1f5f9}.cards{display:none}</style></head><body><h1>ميزان المراجعة</h1><div class="muted">حتى ${asOfDate} - تاريخ الطباعة ${new Date().toLocaleDateString('ar-EG')}</div>${printable}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
      win.close();
    }, 300);
  }

  function exportExcel() {
    const printable = document.getElementById('trial-balance-table')?.outerHTML;
    if (!printable) return;
    const blob = new Blob([`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /></head><body>${printable}</body></html>`], {
      type: 'application/vnd.ms-excel;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ميزان-المراجعة-${asOfDate}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AccountingLayout
      title="ميزان المراجعة"
      subtitle={loading ? 'جاري التحميل…' : `${rows.length} حساب — حتى ${asOfDate}`}
      toolbar={
        <>
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
          />
          <button onClick={() => trialQ.refetch()} disabled={loading || trialQ.isFetching}
            className="flex items-center gap-2 px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50 text-sm text-slate-700">
            <RefreshCw className={`w-4 h-4 ${trialQ.isFetching ? 'animate-spin' : ''}`} />
            تحديث
          </button>
          <button onClick={exportExcel}
            className="flex items-center gap-2 px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-sm text-slate-700">
            Excel
          </button>
          <button onClick={printReport}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-950 text-white rounded-lg hover:bg-slate-900 active:scale-95 transition-all text-sm font-medium">
            <Printer className="w-4 h-4" />
            طباعة
          </button>
        </>
      }
    >
      <div className="text-xs text-slate-500" dir="rtl">المحاسبة &gt; ميزان المراجعة</div>

      {errMsg && (
        <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {errMsg}
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          title="إجمالي المدين"
          value={fmtMoney(totals.totalDebit) + ' ج.م'}
          icon={Scale}
          color="blue"
        />
        <KpiCard
          title="إجمالي الدائن"
          value={fmtMoney(totals.totalCredit) + ' ج.م'}
          icon={Scale}
          color="purple"
        />
        <KpiCard
          title="الحالة"
          value={totals.isBalanced ? 'متوازن ✓' : 'غير متوازن ⚠'}
          subtitle={
            totals.isBalanced
              ? 'مدين = دائن'
              : `الفرق: ${fmtMoney(Math.abs(totals.totalDebit - totals.totalCredit))} ج.م`
          }
          icon={totals.isBalanced ? CheckCircle : AlertTriangle}
          color={totals.isBalanced ? 'green' : 'amber'}
        />
      </div>

      {/* Trial balance table */}
      {loading ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center text-slate-400 text-sm">
          جاري التحميل…
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
          <Scale className="w-16 h-16 mx-auto text-slate-300 mb-4" />
          <p className="text-slate-500">لا توجد قيود مرحّلة حتى التاريخ المحدد</p>
          <p className="text-sm text-slate-400 mt-1">سيظهر ميزان المراجعة بعد ترحيل القيود اليومية</p>
        </div>
      ) : (
        <div id="trial-balance-printable" className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <table id="trial-balance-table" className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 w-32">رمز الحساب</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">اسم الحساب</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 w-32">النوع</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 w-40">مدين</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 w-40">دائن</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.accountCode} className="hover:bg-slate-50">
                  <td className="px-5 py-2.5 font-mono text-xs text-slate-700">{r.accountCode}</td>
                  <td className="px-5 py-2.5">
                    <div className="text-slate-900 font-medium">{r.accountNameAr}</div>
                    {r.accountNameEn && (
                      <div className="text-xs text-slate-500">{r.accountNameEn}</div>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-xs text-slate-600">
                    {r.accountType ? (TYPE_LABELS[r.accountType] ?? r.accountType) : '—'}
                  </td>
                  <td className="px-5 py-2.5 text-left tabular-nums text-slate-700">
                    {r.debit > 0 ? fmtMoney(r.debit) : '—'}
                  </td>
                  <td className="px-5 py-2.5 text-left tabular-nums text-slate-700">
                    {r.credit > 0 ? fmtMoney(r.credit) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-300 bg-slate-50">
              <tr>
                <td colSpan={3} className="px-5 py-3 text-sm font-semibold text-slate-700 text-right">
                  الإجمالي
                </td>
                <td className="px-5 py-3 text-sm font-bold text-slate-900 text-left tabular-nums">
                  {fmtMoney(totals.totalDebit)}
                </td>
                <td className="px-5 py-3 text-sm font-bold text-slate-900 text-left tabular-nums">
                  {fmtMoney(totals.totalCredit)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <AccountingQuickNav />
    </AccountingLayout>
  );
}
