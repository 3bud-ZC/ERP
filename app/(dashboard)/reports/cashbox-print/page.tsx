'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiGetList } from '@/lib/api/fetcher';
import { ReportsLayout } from '@/components/reports/ReportsLayout';
import { ReportShell, ReportLabel, reportInputCls, fmtMoneyEGP, ReportSummaryCard } from '@/components/reports/ReportShell';

interface Cashbox {
  id: string;
  code: string;
  name: string;
}

interface CashboxTx {
  id: string;
  type: string;
  direction: 'in' | 'out';
  amount: number;
  beforeBalance: number;
  afterBalance: number;
  date: string;
  referenceType?: string | null;
  description?: string | null;
  userName?: string | null;
  cashbox?: Cashbox;
}

interface CashboxReport {
  rows: CashboxTx[];
  summary: {
    openingBalance: number;
    totalIn: number;
    totalOut: number;
    endingBalance: number;
    transactionCount: number;
  };
}

const today = () => new Date().toISOString().slice(0, 10);
const firstOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

export default function CashboxPrintReportPage() {
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [cashboxId, setCashboxId] = useState('');
  const cashboxesQ = useQuery({
    queryKey: ['cashboxes', 'report-filter'],
    queryFn: () => apiGetList<Cashbox>('/api/cashboxes?status=active'),
    staleTime: 30_000,
  });
  const q = useQuery({
    queryKey: ['reports', 'cashbox-print', from, to, cashboxId],
    queryFn: () => {
      const params = new URLSearchParams({ fromDate: from, toDate: to });
      if (cashboxId) params.set('cashboxId', cashboxId);
      return apiGet<CashboxReport>(`/api/reports/cashbox-print?${params.toString()}`);
    },
    staleTime: 0,
  });
  const data = q.data;
  const periodLabel = `من ${new Date(from).toLocaleDateString('ar-EG')} إلى ${new Date(to).toLocaleDateString('ar-EG')}`;

  return (
    <ReportsLayout title="طباعة الخزنة" subtitle="تقرير حركة الخزنة والرصيد خلال فترة محددة">
      <ReportShell
        title="طباعة الخزنة"
        subtitle="حركة الخزنة والداخل والخارج والرصيد النهائي"
        periodLabel={periodLabel}
        exportConfig={{ report: 'cashbox-print', params: { fromDate: from, toDate: to, cashboxId } }}
        loading={q.isLoading}
        error={q.error ? (q.error as Error).message : null}
        filters={
          <>
            <div>
              <ReportLabel>من تاريخ</ReportLabel>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={reportInputCls} />
            </div>
            <div>
              <ReportLabel>إلى تاريخ</ReportLabel>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={reportInputCls} />
            </div>
            <div>
              <ReportLabel>الخزنة</ReportLabel>
              <select value={cashboxId} onChange={(e) => setCashboxId(e.target.value)} className={reportInputCls}>
                <option value="">كل الخزن</option>
                {(cashboxesQ.data ?? []).map((cashbox) => <option key={cashbox.id} value={cashbox.id}>{cashbox.name} ({cashbox.code})</option>)}
              </select>
            </div>
          </>
        }
      >
        {data && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <ReportSummaryCard label="الرصيد الافتتاحي" value={fmtMoneyEGP(data.summary.openingBalance)} />
              <ReportSummaryCard label="إجمالي الداخل" value={fmtMoneyEGP(data.summary.totalIn)} accent="bg-emerald-50 border-emerald-200" />
              <ReportSummaryCard label="إجمالي الخارج" value={fmtMoneyEGP(data.summary.totalOut)} accent="bg-red-50 border-red-200" />
              <ReportSummaryCard label="الرصيد النهائي" value={fmtMoneyEGP(data.summary.endingBalance)} accent="bg-slate-50 border-slate-200" />
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-3">
                <h3 className="text-sm font-semibold text-slate-700">تفاصيل العمليات ({data.summary.transactionCount})</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-right">التاريخ</th>
                      <th className="px-3 py-2 text-right">الخزنة</th>
                      <th className="px-3 py-2 text-right">نوع العملية</th>
                      <th className="px-3 py-2 text-right">طريقة الدفع</th>
                      <th className="px-3 py-2 text-left">داخل</th>
                      <th className="px-3 py-2 text-left">خارج</th>
                      <th className="px-3 py-2 text-left">الرصيد بعد العملية</th>
                      <th className="px-3 py-2 text-right">المستخدم</th>
                      <th className="px-3 py-2 text-right">ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.rows.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 text-slate-500">{new Date(row.date).toLocaleDateString('ar-EG')}</td>
                        <td className="px-3 py-2">{row.cashbox?.name || '—'}</td>
                        <td className="px-3 py-2">{typeLabel(row.type)}</td>
                        <td className="px-3 py-2">خزنة</td>
                        <td className="px-3 py-2 text-left text-emerald-700 tabular-nums">{row.direction === 'in' ? fmtMoneyEGP(row.amount) : '—'}</td>
                        <td className="px-3 py-2 text-left text-red-700 tabular-nums">{row.direction === 'out' ? fmtMoneyEGP(row.amount) : '—'}</td>
                        <td className="px-3 py-2 text-left font-semibold tabular-nums">{fmtMoneyEGP(row.afterBalance)}</td>
                        <td className="px-3 py-2 text-slate-500">{row.userName || '—'}</td>
                        <td className="px-3 py-2 text-slate-500">{row.description || row.referenceType || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.rows.length === 0 && <div className="p-8 text-center text-sm text-slate-500">لا توجد حركات في هذه الفترة.</div>}
              </div>
            </div>
          </>
        )}
      </ReportShell>
    </ReportsLayout>
  );
}

function typeLabel(type: string) {
  const map: Record<string, string> = {
    opening_balance: 'رصيد افتتاحي',
    manual_in: 'وارد يدوي',
    manual_out: 'منصرف يدوي',
    sales_receipt: 'تحصيل مبيعات',
    purchase_payment: 'سداد مشتريات',
    customer_collection: 'تحصيل عميل',
    supplier_payment: 'سداد مورد',
    treasury_transfer: 'تحويل خزنة',
    expense: 'مصروف',
    salary: 'رواتب',
  };
  return map[type] || type;
}
