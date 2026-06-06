'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { apiGet } from '@/lib/api/fetcher';
import { AccountingLayout } from '@/components/accounting/AccountingLayout';
import { AccountingQuickNav } from '@/components/accounting/AccountingQuickNav';
import { BalanceSheetView } from '@/components/accounting/BalanceSheetView';
import { FixedAssetsPanel } from '@/components/accounting/FixedAssetsPanel';
import type { BalanceSheetData } from '@/lib/reports/balance-sheet';

const today = () => new Date().toISOString().slice(0, 10);

export default function AccountingBalanceSheetPage() {
  const [asOf, setAsOf] = useState(today());
  const q = useQuery({
    queryKey: ['accounting', 'balance-sheet', asOf],
    queryFn: () => apiGet<BalanceSheetData>(`/api/accounting/balance-sheet?asOfDate=${asOf}`),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const data = q.data;

  return (
    <AccountingLayout
      title="الميزانية العمومية"
      subtitle="صفحة تشغيلية لمتابعة الأصول والالتزامات والمركز المالي بدون أدوات الطباعة"
      toolbar={
        <>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <label htmlFor="balance-sheet-date" className="text-xs font-medium text-slate-500">بتاريخ</label>
            <input
              id="balance-sheet-date"
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
          <button
            type="button"
            onClick={() => void q.refetch()}
            disabled={q.isFetching}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${q.isFetching ? 'animate-spin' : ''}`} />
            تحديث
          </button>
        </>
      }
    >
      <div className="text-xs text-slate-500" dir="rtl">المحاسبة &gt; الميزانية العمومية</div>

      <FixedAssetsPanel onCreated={() => q.refetch()} />

      {q.error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {(q.error as Error).message}
        </div>
      ) : q.isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          جاري تحميل الميزانية العمومية...
        </div>
      ) : data ? (
        <BalanceSheetView data={data} />
      ) : null}

      <AccountingQuickNav />
    </AccountingLayout>
  );
}
