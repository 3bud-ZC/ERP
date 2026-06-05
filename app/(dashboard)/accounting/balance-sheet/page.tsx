'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api/fetcher';
import { AccountingLayout, KpiCard } from '@/components/accounting/AccountingLayout';
import { AccountingQuickNav } from '@/components/accounting/AccountingQuickNav';
import { ReportShell, ReportLabel, reportInputCls, fmtMoneyEGP } from '@/components/reports/ReportShell';
import { Landmark, Scale, Wallet } from 'lucide-react';

interface BSLine { code: string; nameAr: string; amount: number; subType?: string | null }
interface BSResponse {
  asOfDate: string;
  assets: { lines: BSLine[]; total: number; groups: Record<string, number> };
  liabilities: { lines: BSLine[]; total: number };
  equity: { lines: BSLine[]; netIncome: number; total: number; totalWithIncome: number };
  summary: {
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number;
    totalLiabilitiesAndEquity: number;
    isBalanced: boolean;
    difference: number;
  };
}

const today = () => new Date().toISOString().slice(0, 10);

export default function AccountingBalanceSheetPage() {
  const [asOf, setAsOf] = useState(today());
  const q = useQuery({
    queryKey: ['accounting', 'balance-sheet', asOf],
    queryFn: () => apiGet<BSResponse>(`/api/accounting/balance-sheet?asOfDate=${asOf}`),
    staleTime: 0,
  });
  const data = q.data;

  return (
    <AccountingLayout title="الميزانية العمومية" subtitle="الأصول، الخصوم، وحقوق الملكية من القيود المنشورة">
      <div className="text-xs text-slate-500" dir="rtl">المحاسبة &gt; الميزانية العمومية</div>
      <ReportShell
        title="الميزانية العمومية"
        subtitle="الأصول = الخصوم + حقوق الملكية"
        periodLabel={`بتاريخ ${new Date(asOf).toLocaleDateString('ar-EG')}`}
        exportConfig={{ report: 'balance-sheet', params: { asOfDate: asOf } }}
        loading={q.isLoading}
        error={q.error ? (q.error as Error).message : null}
        filters={
          <div>
            <ReportLabel>بتاريخ</ReportLabel>
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={reportInputCls} />
          </div>
        }
      >
        {data && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <KpiCard title="إجمالي الأصول" value={fmtMoneyEGP(data.summary.totalAssets)} subtitle="أصول متداولة وثابتة" icon={Wallet} color="green" />
              <KpiCard title="إجمالي الخصوم" value={fmtMoneyEGP(data.summary.totalLiabilities)} subtitle="التزامات وموردون" icon={Landmark} color="amber" />
              <KpiCard title="حقوق الملكية" value={fmtMoneyEGP(data.summary.totalEquity)} subtitle="تشمل صافي الربح" icon={Scale} color="blue" />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <BSSection title="الأصول" lines={data.assets.lines} total={data.assets.total} />
              <div className="space-y-4">
                <BSSection title="الخصوم / الالتزامات" lines={data.liabilities.lines} total={data.liabilities.total} />
                <BSSection
                  title="حقوق الملكية ومصادر التمويل"
                  lines={[...data.equity.lines, { code: 'NI', nameAr: 'صافي الربح للفترة', amount: data.equity.netIncome }]}
                  total={data.equity.totalWithIncome}
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4" dir="rtl">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">تصنيف الأصول التشغيلي</h3>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(data.assets.groups).map(([name, amount]) => (
                  <div key={name} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="text-xs text-slate-500">{name}</div>
                    <div className="mt-1 text-sm font-bold tabular-nums text-slate-900">{fmtMoneyEGP(amount)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className={`rounded-xl border p-4 text-sm ${data.summary.isBalanced ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`} dir="rtl">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="font-bold text-slate-900">إجمالي الخصوم + حقوق الملكية</span>
                <span className="font-bold tabular-nums text-slate-900">{fmtMoneyEGP(data.summary.totalLiabilitiesAndEquity)}</span>
              </div>
              {!data.summary.isBalanced && <div className="mt-2 text-red-700">الفرق: {fmtMoneyEGP(data.summary.difference)}</div>}
            </div>
          </>
        )}
      </ReportShell>
      <AccountingQuickNav />
    </AccountingLayout>
  );
}

function BSSection({ title, lines, total }: { title: string; lines: BSLine[]; total: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" dir="rtl">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <span className="text-sm font-bold tabular-nums text-slate-900">{fmtMoneyEGP(total)}</span>
      </div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {lines.map((line) => (
            <tr key={`${title}-${line.code}`} className="hover:bg-slate-50">
              <td className="w-20 px-5 py-2 font-mono text-slate-500">{line.code}</td>
              <td className="px-3 py-2 text-slate-800">{line.nameAr}</td>
              <td className="px-5 py-2 text-left tabular-nums">{fmtMoneyEGP(line.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {lines.length === 0 && <div className="p-6 text-center text-sm text-slate-400">لا توجد بنود</div>}
    </div>
  );
}
