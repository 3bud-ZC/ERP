'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowDownCircle, ArrowUpCircle, BookOpen, CreditCard, RefreshCw, WalletCards } from 'lucide-react';
import { AccountingLayout } from '@/components/accounting/AccountingLayout';
import { AccountingQuickNav } from '@/components/accounting/AccountingQuickNav';
import { fmtMoney } from '@/components/invoices/InvoiceConfig';

interface Overview {
  summary: {
    treasuryBalance: number;
    dailyInflow: number;
    dailyOutflow: number;
    revenue: number;
    purchases: number;
    expenses: number;
    receivables: number;
    payables: number;
    overdueInvoices: number;
    salesCount: number;
    purchaseCount: number;
    expenseCount: number;
  };
  recentCash: Array<{ id: string; type: string; direction: string; amount: number; date: string; description?: string; cashbox?: { name: string; code: string } }>;
  recentJournals: Array<{ id: string; entryNumber: string; entryDate: string; description?: string; totalDebit: number; totalCredit: number; isPosted: boolean; referenceType?: string; referenceId?: string }>;
  receivables: Array<{ id: string; number: string; party: string; total: number; paid: number }>;
  payables: Array<{ id: string; number: string; party: string; total: number; paid: number }>;
}

const empty: Overview = {
  summary: {
    treasuryBalance: 0,
    dailyInflow: 0,
    dailyOutflow: 0,
    revenue: 0,
    purchases: 0,
    expenses: 0,
    receivables: 0,
    payables: 0,
    overdueInvoices: 0,
    salesCount: 0,
    purchaseCount: 0,
    expenseCount: 0,
  },
  recentCash: [],
  recentJournals: [],
  receivables: [],
  payables: [],
};

export default function AccountingFinancialDashboardPage() {
  const [data, setData] = useState<Overview>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/accounting/financial-overview', { credentials: 'include', cache: 'no-store' });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'تعذر تحميل لوحة المحاسبة');
      setData(json.data || empty);
    } catch (err: any) {
      setError(err?.message || 'تعذر الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <AccountingLayout
      title="لوحة المحاسبة"
      subtitle="مركز متابعة النقدية، الذمم، القيود، والتدفقات اليومية"
      toolbar={
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          تحديث
        </button>
      }
    >
      <div className="space-y-5" dir="rtl">
        <div className="text-xs text-slate-500">المحاسبة &gt; لوحة المحاسبة</div>
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <div className="grid gap-3 md:grid-cols-4">
          <Metric title="رصيد الخزائن" value={fmtMoney(data.summary.treasuryBalance)} icon={<WalletCards />} />
          <Metric title="وارد اليوم" value={fmtMoney(data.summary.dailyInflow)} icon={<ArrowDownCircle />} tone="emerald" />
          <Metric title="منصرف اليوم" value={fmtMoney(data.summary.dailyOutflow)} icon={<ArrowUpCircle />} tone="red" />
          <Metric title="فواتير متأخرة" value={String(data.summary.overdueInvoices)} icon={<CreditCard />} tone="amber" />
          <Metric title="إيرادات الفترة" value={fmtMoney(data.summary.revenue)} icon={<ArrowDownCircle />} />
          <Metric title="مصروفات الفترة" value={fmtMoney(data.summary.expenses)} icon={<ArrowUpCircle />} />
          <Metric title="مديونيات العملاء" value={fmtMoney(data.summary.receivables)} icon={<CreditCard />} />
          <Metric title="مستحقات الموردين" value={fmtMoney(data.summary.payables)} icon={<CreditCard />} />
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="آخر حركات الخزنة" href="/accounting/treasury/transactions">
            {loading ? <LoadingRows /> : data.recentCash.length === 0 ? <Empty text="لا توجد حركات خزنة بعد." /> : data.recentCash.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0">
                <div>
                  <div className="font-semibold text-slate-800">{cashType(row.type)}</div>
                  <div className="text-xs text-slate-500">{row.cashbox?.name || 'خزنة'} · {new Date(row.date).toLocaleString('ar-EG')}</div>
                </div>
                <div className={row.direction === 'in' ? 'font-bold text-emerald-700' : 'font-bold text-red-700'}>
                  {row.direction === 'in' ? '+' : '-'} {fmtMoney(row.amount)}
                </div>
              </div>
            ))}
          </Panel>

          <Panel title="آخر القيود اليومية" href="/accounting/journal-entries">
            {loading ? <LoadingRows /> : data.recentJournals.length === 0 ? <Empty text="لا توجد قيود محاسبية بعد." /> : data.recentJournals.map((row) => (
              <Link href={`/accounting/journal-entries/${row.id}`} key={row.id} className="flex items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0 hover:bg-slate-50">
                <div>
                  <div className="font-semibold text-slate-800">{row.entryNumber}</div>
                  <div className="text-xs text-slate-500">{row.description || 'قيد محاسبي'} · {new Date(row.entryDate).toLocaleDateString('ar-EG')}</div>
                </div>
                <div className="text-left text-sm font-bold text-slate-900">{fmtMoney(Number(row.totalDebit || 0))}</div>
              </Link>
            ))}
          </Panel>

          <Panel title="أهم مديونيات العملاء" href="/reports/receivables">
            {data.receivables.length === 0 ? <Empty text="لا توجد مديونيات مفتوحة." /> : data.receivables.map((row) => (
              <div key={row.id} className="flex items-center justify-between border-b border-slate-100 py-3 last:border-0">
                <div>
                  <div className="font-semibold text-slate-800">{row.party}</div>
                  <div className="text-xs text-slate-500">{row.number}</div>
                </div>
                <div className="font-bold text-red-700">{fmtMoney(row.total - row.paid)}</div>
              </div>
            ))}
          </Panel>

          <Panel title="أهم مستحقات الموردين" href="/reports/payables">
            {data.payables.length === 0 ? <Empty text="لا توجد مستحقات مفتوحة." /> : data.payables.map((row) => (
              <div key={row.id} className="flex items-center justify-between border-b border-slate-100 py-3 last:border-0">
                <div>
                  <div className="font-semibold text-slate-800">{row.party}</div>
                  <div className="text-xs text-slate-500">{row.number}</div>
                </div>
                <div className="font-bold text-red-700">{fmtMoney(row.total - row.paid)}</div>
              </div>
            ))}
          </Panel>
        </div>

        <AccountingQuickNav />
      </div>
    </AccountingLayout>
  );
}

function Metric({ title, value, icon, tone = 'slate' }: { title: string; value: string; icon: React.ReactNode; tone?: 'slate' | 'emerald' | 'red' | 'amber' }) {
  const toneClass = {
    slate: 'text-slate-600 bg-slate-50',
    emerald: 'text-emerald-700 bg-emerald-50',
    red: 'text-red-700 bg-red-50',
    amber: 'text-amber-700 bg-amber-50',
  }[tone];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500">{title}</span>
        <span className={`rounded-md p-2 ${toneClass}`}>{icon}</span>
      </div>
      <div className="mt-3 text-xl font-black text-slate-950">{value}</div>
    </div>
  );
}

function Panel({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-bold text-slate-900">{title}</h2>
        <Link href={href} className="text-xs font-semibold text-sky-700 hover:text-sky-900">فتح</Link>
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">{text}</div>;
}

function LoadingRows() {
  return <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-slate-100" />)}</div>;
}

function cashType(type: string) {
  const labels: Record<string, string> = {
    sales_receipt: 'تحصيل مبيعات',
    purchase_payment: 'سداد مشتريات',
    expense: 'مصروف',
    salary: 'راتب',
    treasury_transfer: 'تحويل خزنة',
    adjustment: 'تسوية',
    manual_in: 'وارد يدوي',
    manual_out: 'منصرف يدوي',
    opening_balance: 'رصيد افتتاحي',
  };
  return labels[type] || type;
}
