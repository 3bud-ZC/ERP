'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api/fetcher';
import { AccountingLayout } from '@/components/accounting/AccountingLayout';
import { AccountingQuickNav } from '@/components/accounting/AccountingQuickNav';
import { ReportShell, ReportLabel, reportInputCls } from '@/components/reports/ReportShell';
import { BalanceSheetView } from '@/components/accounting/BalanceSheetView';
import type { BalanceSheetData } from '@/lib/reports/balance-sheet';

const today = () => new Date().toISOString().slice(0, 10);

export default function AccountingBalanceSheetPage() {
  const [asOf, setAsOf] = useState(today());
  const q = useQuery({
    queryKey: ['accounting', 'balance-sheet', asOf],
    queryFn: () => apiGet<BalanceSheetData>(`/api/accounting/balance-sheet?asOfDate=${asOf}`),
    staleTime: 0,
  });
  const data = q.data;

  return (
    <AccountingLayout title="الميزانية العمومية" subtitle="بنية الميزانية العملية حسب الأصول والالتزامات والملكية">
      <div className="text-xs text-slate-500" dir="rtl">المحاسبة &gt; الميزانية العمومية</div>
      <ReportShell
        title="الميزانية العمومية"
        subtitle="عرض تفصيلي حسب الأصول الثابتة، المتداولة، الخزنة، العملاء، الموردين، والالتزامات"
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
        {data && <BalanceSheetView data={data} />}
      </ReportShell>
      <AccountingQuickNav />
    </AccountingLayout>
  );
}
