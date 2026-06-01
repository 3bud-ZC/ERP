'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ReportsLayout } from '@/components/reports/ReportsLayout';
import {
  ReportShell,
  ReportLabel,
  reportInputCls,
  ReportSummaryCard,
  fmtMoneyEGP,
} from '@/components/reports/ReportShell';

interface Row {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate?: string;
  supplier: { code: string; nameAr: string };
  total: number;
  paid: number;
  remaining: number;
  dueDate: string | null;
  overdueDays: number;
  paymentStatus: string;
}

interface Summary {
  invoiceCount: number;
  totalInvoices: number;
  totalPaid: number;
  totalRemaining: number;
  overdueCount: number;
}

const defaultSummary: Summary = {
  invoiceCount: 0,
  totalInvoices: 0,
  totalPaid: 0,
  totalRemaining: 0,
  overdueCount: 0,
};

export default function PayablesReportPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary>(defaultSummary);
  const [filters, setFilters] = useState({ from: '', to: '', status: 'open' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.status && filters.status !== 'all') params.set('paymentStatus', filters.status);

    try {
      const res = await fetch(`/api/reports/payables?${params.toString()}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || json?.message || 'تعذر تحميل التقرير');
      }
      const payload = json.data;
      const nextRows = Array.isArray(payload) ? payload : payload?.rows ?? [];
      setRows(nextRows);
      setSummary(Array.isArray(payload) ? buildSummary(nextRows) : payload?.summary ?? defaultSummary);
    } catch (fetchError) {
      setRows([]);
      setSummary(defaultSummary);
      setError(fetchError instanceof Error ? fetchError.message : 'تعذر تحميل التقرير');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  const subtitle = useMemo(
    () => `إجمالي المستحق: ${fmtMoneyEGP(summary.totalRemaining)}`,
    [summary.totalRemaining]
  );

  const periodLabel = `من ${filters.from || '—'} إلى ${filters.to || '—'}`;

  return (
    <ReportsLayout title="تقرير مستحقات الموردين" subtitle={subtitle}>
      <ReportShell
        title="تقرير مستحقات الموردين"
        subtitle="تحليل الفواتير المفتوحة والمدفوعات حسب المورد"
        periodLabel={periodLabel}
        exportConfig={{ report: 'payables', params: { fromDate: filters.from, toDate: filters.to, status: filters.status } }}
        loading={loading}
        error={error}
        filters={
          <>
            <div>
              <ReportLabel>من تاريخ</ReportLabel>
              <input
                type="date"
                value={filters.from}
                onChange={(e) => setFilters({ ...filters, from: e.target.value })}
                className={reportInputCls}
              />
            </div>
            <div>
              <ReportLabel>إلى تاريخ</ReportLabel>
              <input
                type="date"
                value={filters.to}
                onChange={(e) => setFilters({ ...filters, to: e.target.value })}
                className={reportInputCls}
              />
            </div>
            <div>
              <ReportLabel>الحالة</ReportLabel>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className={reportInputCls}
              >
                <option value="open">مفتوحة</option>
                <option value="all">كل الحالات</option>
                <option value="unpaid">غير مدفوعة</option>
                <option value="partial">مدفوعة جزئيًا</option>
                <option value="paid">مدفوعة</option>
                <option value="overdue">متأخرة فقط</option>
              </select>
            </div>
          </>
        }
        extraActions={
          <>
            <button
              type="button"
              onClick={load}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 active:scale-95 transition-all text-sm font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              تحديث
            </button>
          </>
        }
      >
        <div className="grid gap-3 md:grid-cols-5">
          <ReportSummaryCard label="إجمالي الفواتير" value={summary.invoiceCount.toString()} />
          <ReportSummaryCard label="إجمالي قيمة الفواتير" value={fmtMoneyEGP(summary.totalInvoices)} />
          <ReportSummaryCard label="إجمالي المدفوع" value={fmtMoneyEGP(summary.totalPaid)} />
          <ReportSummaryCard label="إجمالي المتبقي" value={fmtMoneyEGP(summary.totalRemaining)} accent="bg-red-50 border-red-200" />
          <ReportSummaryCard label="فواتير متأخرة" value={summary.overdueCount.toString()} />
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 text-right">المورد</th>
                <th className="px-4 py-3 text-right">الفاتورة</th>
                <th className="px-4 py-3 text-right">تاريخ الفاتورة</th>
                <th className="px-4 py-3 text-right">الاستحقاق</th>
                <th className="px-4 py-3 text-right">الإجمالي</th>
                <th className="px-4 py-3 text-right">المدفوع</th>
                <th className="px-4 py-3 text-right">المتبقي</th>
                <th className="px-4 py-3 text-right">أيام التأخير</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    لا توجد مستحقات مطابقة للفلاتر الحالية.
                  </td>
                </tr>
              ) : rows.map((r) => (
                <tr key={r.invoiceId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold">{r.supplier.nameAr}</td>
                  <td className="px-4 py-3">{r.invoiceNumber}</td>
                  <td className="px-4 py-3">{formatDate(r.invoiceDate)}</td>
                  <td className="px-4 py-3">{formatDate(r.dueDate)}</td>
                  <td className="px-4 py-3">{fmtMoneyEGP(r.total)}</td>
                  <td className="px-4 py-3">{fmtMoneyEGP(r.paid)}</td>
                  <td className="px-4 py-3 font-bold text-red-700">{fmtMoneyEGP(r.remaining)}</td>
                  <td className="px-4 py-3">{r.overdueDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ReportShell>
    </ReportsLayout>
  );
}

function buildSummary(rows: Row[]): Summary {
  return rows.reduce((acc, row) => ({
    invoiceCount: acc.invoiceCount + 1,
    totalInvoices: acc.totalInvoices + row.total,
    totalPaid: acc.totalPaid + row.paid,
    totalRemaining: acc.totalRemaining + row.remaining,
    overdueCount: acc.overdueCount + (row.overdueDays > 0 ? 1 : 0),
  }), { ...defaultSummary });
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('ar-EG');
}
