'use client';

import { useEffect, useState } from 'react';
import { AccountingLayout } from '@/components/accounting/AccountingLayout';
import { fmtMoney } from '@/components/invoices/InvoiceConfig';

interface CashFlowData {
  operatingActivities?: Record<string, number>;
  investingActivities?: Record<string, number>;
  financingActivities?: Record<string, number>;
  netCashFlow?: number;
  beginningCash?: number;
  endingCash?: number;
}

export default function CashFlowPage() {
  const [data, setData] = useState<CashFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/accounting/cash-flow', { credentials: 'include', cache: 'no-store' });
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'تعذر تحميل التدفقات النقدية');
        setData(json.data || json);
      } catch (err: any) {
        setError(err?.message || 'تعذر الاتصال بالخادم');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <AccountingLayout title="التدفقات النقدية" subtitle="ملخص مصادر واستخدامات النقد">
      <div className="space-y-5" dir="rtl">
        <div className="text-xs text-slate-500">المحاسبة &gt; التدفقات النقدية</div>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {loading ? <div className="h-64 animate-pulse rounded-lg bg-slate-100" /> : (
          <div className="grid gap-4 md:grid-cols-3">
            <Card title="بداية النقدية" value={fmtMoney(Number(data?.beginningCash || 0))} />
            <Card title="صافي التدفق" value={fmtMoney(Number(data?.netCashFlow || 0))} />
            <Card title="نهاية النقدية" value={fmtMoney(Number(data?.endingCash || 0))} />
          </div>
        )}
      </div>
    </AccountingLayout>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold text-slate-500">{title}</div>
      <div className="mt-3 text-2xl font-black text-slate-950">{value}</div>
    </div>
  );
}

