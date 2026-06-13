'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiGet } from '@/lib/api/fetcher';
import { ReportsLayout } from '@/components/reports/ReportsLayout';
import { ReportShell, ReportLabel, reportInputCls } from '@/components/reports/ReportShell';
import { BalanceSheetView } from '@/components/accounting/BalanceSheetView';
import type { BalanceSheetData } from '@/lib/reports/balance-sheet';

const today = () => new Date().toISOString().slice(0, 10);

export default function BalanceSheetPage() {
  const [asOf, setAsOf] = useState(today());

  const reportQ = useQuery({
    queryKey: ['balance-sheet', asOf],
    queryFn: () => apiGet<BalanceSheetData>(`/api/reports/balance-sheet?asOfDate=${asOf}`),
    staleTime: 0,
  });
  const data = reportQ.data;

  return (
    <ReportsLayout title="الميزانية العمومية" subtitle="عرض مالي عملي مبني على بيانات التشغيل والقيود المنشورة">
      <ReportShell
        title="الميزانية العمومية"
        subtitle="الأصول الثابتة والمتداولة، الخزنة، العملاء، الموردون، والالتزامات"
        periodLabel={`بتاريخ ${new Date(asOf).toLocaleDateString('ar-EG')}`}
        exportConfig={{ report: 'balance-sheet', params: { asOfDate: asOf } }}
        extraActions={<Link href={`/accounting/balance-sheet?asOfDate=${asOf}`} className="px-3 py-2 neo-raised text-slate-700 rounded-lg hover:text-indigo-700 text-sm font-medium">فتح في المحاسبة</Link>}
        loading={reportQ.isLoading}
        error={reportQ.error ? (reportQ.error as Error).message : null}
        filters={
          <div>
            <ReportLabel>بتاريخ</ReportLabel>
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={reportInputCls} />
          </div>
        }
      >
        {data && <BalanceSheetView data={data} />}
      </ReportShell>
    </ReportsLayout>
  );
}
