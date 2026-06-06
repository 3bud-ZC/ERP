'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle,
  Printer,
  RefreshCw,
  Scale,
  Search,
  WalletCards,
} from 'lucide-react';
import { apiGetList } from '@/lib/api/fetcher';
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

interface TrialBalanceComputedRow extends TrialBalanceRow {
  balance: number;
  balanceAbs: number;
  balanceSide: 'مدين' | 'دائن' | 'متوازن';
}

const TYPE_ORDER = ['asset', 'liability', 'equity', 'revenue', 'expense'];

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

function fmtMoney(value: number) {
  return value.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TrialBalancePage() {
  const today = new Date().toISOString().slice(0, 10);
  const [asOfDate, setAsOfDate] = useState(today);
  const [search, setSearch] = useState('');

  const trialQ = useQuery({
    queryKey: ['accounting', 'trial-balance', asOfDate],
    queryFn: () => apiGetList<TrialBalanceRow>(`/api/accounting/trial-balance?asOfDate=${asOfDate}`),
    staleTime: 0,
  });

  const filteredRows = useMemo(() => {
    const rows = trialQ.data ?? [];
    const needle = search.trim().toLowerCase();
    const scopedRows = !needle ? rows : rows.filter((row) => {
      const haystack = [
        row.accountCode,
        row.accountNameAr,
        row.accountNameEn,
        row.accountType,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(needle);
    });
    return scopedRows.map((row) => {
      const balance = Number(row.debit || 0) - Number(row.credit || 0);
      return {
        ...row,
        balance,
        balanceAbs: Math.abs(balance),
        balanceSide: balance > 0.009 ? 'مدين' : balance < -0.009 ? 'دائن' : 'متوازن',
      } satisfies TrialBalanceComputedRow;
    });
  }, [search, trialQ.data]);

  const groups = useMemo(() => {
    const grouped = new Map<string, TrialBalanceComputedRow[]>();
    for (const row of filteredRows) {
      const key = normalizeType(row.accountType);
      const bucket = grouped.get(key) || [];
      bucket.push(row);
      grouped.set(key, bucket);
    }

    const orderedKeys = Array.from(grouped.keys()).sort((a, b) => {
      const ai = TYPE_ORDER.indexOf(a);
      const bi = TYPE_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    return orderedKeys.map((key) => {
      const rows = grouped.get(key) || [];
      const debit = rows.reduce((sum, row) => sum + Number(row.debit || 0), 0);
      const credit = rows.reduce((sum, row) => sum + Number(row.credit || 0), 0);
      const balance = rows.reduce((sum, row) => sum + Number(row.balance || 0), 0);
      return {
        key,
        label: TYPE_LABELS[key] ?? key ?? 'غير مصنف',
        rows,
        debit,
        credit,
        balance,
      };
    });
  }, [filteredRows]);

  const totals = useMemo(() => {
    const totalDebit = filteredRows.reduce((sum, row) => sum + Number(row.debit || 0), 0);
    const totalCredit = filteredRows.reduce((sum, row) => sum + Number(row.credit || 0), 0);
    return {
      totalDebit,
      totalCredit,
      difference: Math.abs(totalDebit - totalCredit),
      isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
    };
  }, [filteredRows]);

  function printReport() {
    const printable = document.getElementById('trial-balance-printable')?.innerHTML ?? '';
    const win = window.open('', '_blank', 'width=1100,height=800');
    if (!win) {
      window.print();
      return;
    }

    win.document.write(
      `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /><title>ميزان المراجعة</title><style>@page{margin:12mm}body{font-family:Arial,Tahoma,sans-serif;color:#0f172a;direction:rtl}h1{font-size:20px;margin:0 0 6px}.muted{font-size:12px;color:#64748b;margin-bottom:14px}.group{margin-bottom:18px;break-inside:avoid}.group-title{font-size:14px;font-weight:700;margin:0 0 8px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #e2e8f0;padding:7px 8px;text-align:right}th{background:#f1f5f9}.summary{margin-bottom:16px;padding:10px;border:1px solid #e2e8f0;background:#f8fafc}.num{text-align:left}</style></head><body><h1>ميزان المراجعة</h1><div class="muted">حتى ${asOfDate} - تاريخ الطباعة ${new Date().toLocaleDateString('ar-EG')}</div><div class="summary">إجمالي المدين: ${fmtMoney(totals.totalDebit)} ج.م | إجمالي الدائن: ${fmtMoney(totals.totalCredit)} ج.م | ${totals.isBalanced ? 'الميزان متوازن' : `الفرق: ${fmtMoney(totals.difference)} ج.م`}</div>${printable}</body></html>`,
    );
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
      win.close();
    }, 300);
  }

  function exportExcel() {
    const printable = document.getElementById('trial-balance-printable')?.innerHTML;
    if (!printable) return;
    const blob = new Blob(
      [`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8" /></head><body>${printable}</body></html>`],
      { type: 'application/vnd.ms-excel;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ميزان-المراجعة-${asOfDate}.xls`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AccountingLayout
      title="ميزان المراجعة"
      subtitle={trialQ.isLoading ? 'جاري التحميل...' : `قراءة مباشرة من القيود المرحّلة حتى ${asOfDate}`}
      toolbar={
        <>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <label htmlFor="trial-balance-date" className="text-xs font-medium text-slate-500">بتاريخ</label>
            <input
              id="trial-balance-date"
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
          <button
            type="button"
            onClick={() => void trialQ.refetch()}
            disabled={trialQ.isFetching}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${trialQ.isFetching ? 'animate-spin' : ''}`} />
            تحديث
          </button>
          <button
            type="button"
            onClick={exportExcel}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Excel
          </button>
          <button
            type="button"
            onClick={printReport}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-900"
          >
            <Printer className="h-4 w-4" />
            طباعة
          </button>
        </>
      }
    >
      <div className="text-xs text-slate-500" dir="rtl">المحاسبة &gt; ميزان المراجعة</div>

      <div
        className={`rounded-xl border px-4 py-3 text-sm ${
          totals.isBalanced
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}
      >
        {totals.isBalanced
          ? 'الميزان متوازن حاليًا. إجمالي المدين يساوي إجمالي الدائن.'
          : `الميزان غير متوازن. الفرق الحالي بين المدين والدائن هو ${fmtMoney(totals.difference)} ج.م.`}
      </div>

      {trialQ.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {(trialQ.error as Error).message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <KpiCard title="إجمالي المدين" value={`${fmtMoney(totals.totalDebit)} ج.م`} subtitle="كل الحركات المدينة" icon={Scale} color="blue" />
        <KpiCard title="إجمالي الدائن" value={`${fmtMoney(totals.totalCredit)} ج.م`} subtitle="كل الحركات الدائنة" icon={WalletCards} color="purple" />
        <KpiCard
          title="فرق الميزان"
          value={`${fmtMoney(totals.difference)} ج.م`}
          subtitle={totals.isBalanced ? 'لا يوجد فرق' : 'راجع الحسابات غير المتوازنة'}
          icon={totals.isBalanced ? CheckCircle : AlertTriangle}
          color={totals.isBalanced ? 'green' : 'amber'}
        />
        <KpiCard title="عدد الحسابات" value={String(filteredRows.length)} subtitle="بعد الفلترة الحالية" icon={Scale} color="slate" />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">قراءة واضحة للحسابات</h2>
            <p className="mt-1 text-xs text-slate-500">
              الحسابات مجمعة حسب نوعها المحاسبي لتسهيل مراجعة الأصول والالتزامات وحقوق الملكية والإيرادات والمصروفات.
            </p>
          </div>
          <div className="relative w-full lg:w-80">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث برمز الحساب أو الاسم"
              className="w-full rounded-lg border border-slate-200 py-2 pr-9 pl-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
        </div>
      </div>

      {trialQ.isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          جاري تحميل ميزان المراجعة...
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center text-sm text-slate-500">
          لا توجد بيانات مطابقة حتى التاريخ المحدد.
        </div>
      ) : (
        <div id="trial-balance-printable" className="space-y-4">
          {groups.map((group) => (
            <section key={group.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{group.label}</h3>
                  <p className="mt-1 text-xs text-slate-500">{group.rows.length} حساب</p>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
                  <span>مدين: <strong className="font-semibold text-slate-900">{fmtMoney(group.debit)}</strong></span>
                  <span>دائن: <strong className="font-semibold text-slate-900">{fmtMoney(group.credit)}</strong></span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-white text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-right font-medium">رمز الحساب</th>
                      <th className="px-4 py-3 text-right font-medium">اسم الحساب</th>
                      <th className="px-4 py-3 text-right font-medium">نوع الرصيد</th>
                      <th className="px-4 py-3 text-left font-medium">الرصيد</th>
                      <th className="px-4 py-3 text-left font-medium">مدين</th>
                      <th className="px-4 py-3 text-left font-medium">دائن</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {group.rows.map((row) => (
                      <tr key={row.accountCode} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs text-slate-700">{row.accountCode}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{row.accountNameAr}</div>
                          {row.accountNameEn && <div className="mt-1 text-xs text-slate-500">{row.accountNameEn}</div>}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          {row.balanceSide}
                        </td>
                        <td className="px-4 py-3 text-left font-semibold tabular-nums text-slate-900">
                          {row.balanceAbs > 0 ? fmtMoney(row.balanceAbs) : '—'}
                        </td>
                        <td className="px-4 py-3 text-left font-semibold tabular-nums text-slate-900">
                          {row.debit > 0 ? fmtMoney(row.debit) : '—'}
                        </td>
                        <td className="px-4 py-3 text-left font-semibold tabular-nums text-slate-900">
                          {row.credit > 0 ? fmtMoney(row.credit) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-slate-200 bg-slate-50">
                    <tr>
                      <td colSpan={2} className="px-4 py-3 text-right text-sm font-semibold text-slate-700">إجمالي المجموعة</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-slate-700">
                        {group.balance > 0.009 ? 'مدين' : group.balance < -0.009 ? 'دائن' : 'متوازن'}
                      </td>
                      <td className="px-4 py-3 text-left text-sm font-bold tabular-nums text-slate-900">{fmtMoney(Math.abs(group.balance))}</td>
                      <td className="px-4 py-3 text-left text-sm font-bold tabular-nums text-slate-900">{fmtMoney(group.debit)}</td>
                      <td className="px-4 py-3 text-left text-sm font-bold tabular-nums text-slate-900">{fmtMoney(group.credit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          ))}

          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h3 className="text-sm font-bold text-slate-900">الإجماليات النهائية</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-right font-medium">البيان</th>
                    <th className="px-4 py-3 text-left font-medium">القيمة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="px-4 py-3 text-slate-700">إجمالي المدين</td>
                    <td className="px-4 py-3 text-left font-semibold tabular-nums text-slate-900">{fmtMoney(totals.totalDebit)}</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-slate-700">إجمالي الدائن</td>
                    <td className="px-4 py-3 text-left font-semibold tabular-nums text-slate-900">{fmtMoney(totals.totalCredit)}</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-slate-700">الفرق</td>
                    <td className={`px-4 py-3 text-left font-semibold tabular-nums ${totals.isBalanced ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {fmtMoney(totals.difference)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      <AccountingQuickNav />
    </AccountingLayout>
  );
}

function normalizeType(value?: string | null) {
  return String(value || '').trim().toLowerCase() || 'other';
}
