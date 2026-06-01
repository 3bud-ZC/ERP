'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ExternalLink, RotateCcw } from 'lucide-react';
import { AccountingLayout } from '@/components/accounting/AccountingLayout';
import { fmtMoney } from '@/components/invoices/InvoiceConfig';

interface EntryLine {
  id: string;
  accountCode: string;
  debit: number;
  credit: number;
  description?: string | null;
  account?: { nameAr: string };
}

interface Entry {
  id: string;
  entryNumber: string;
  entryDate: string;
  description?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  totalDebit: number;
  totalCredit: number;
  isPosted: boolean;
  postedDate?: string | null;
  reversalEntryId?: string | null;
  reversedBy?: { id: string; entryNumber: string } | null;
  lines: EntryLine[];
  createdAt: string;
  updatedAt: string;
}

export default function JournalEntryDetailPage({ params }: { params: { id: string } }) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/accounting/journal-entries/${params.id}`, { credentials: 'include', cache: 'no-store' });
        const json = await res.json();
        if (!json.success) throw new Error(json.message || 'تعذر تحميل القيد');
        setEntry(json.data);
      } catch (err: any) {
        setError(err?.message || 'تعذر الاتصال بالخادم');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id]);

  const source = useMemo(() => sourceLink(entry?.referenceType, entry?.referenceId), [entry?.referenceId, entry?.referenceType]);

  return (
    <AccountingLayout title="تفاصيل القيد" subtitle={entry?.entryNumber || 'جاري التحميل'}>
      <div className="space-y-5" dir="rtl">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">المحاسبة &gt; القيود اليومية &gt; تفاصيل القيد</div>
          <Link href="/accounting/journal-entries" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <ArrowRight className="h-4 w-4" /> رجوع
          </Link>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {loading ? (
          <div className="h-72 animate-pulse rounded-lg bg-slate-100" />
        ) : entry && (
          <>
            <div className="grid gap-3 md:grid-cols-4">
              <Info title="رقم القيد" value={entry.entryNumber} />
              <Info title="التاريخ" value={new Date(entry.entryDate).toLocaleDateString('ar-EG')} />
              <Info title="الحالة" value={entry.isPosted ? 'مرحّل' : 'مسودة'} />
              <Info title="الإجمالي" value={fmtMoney(Number(entry.totalDebit || 0))} />
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <h2 className="font-bold text-slate-900">البيان والمرجع</h2>
                  <p className="mt-2 text-sm text-slate-600">{entry.description || 'بدون بيان'}</p>
                  <div className="mt-3 text-sm text-slate-500">المرجع: {[entry.referenceType, entry.referenceId].filter(Boolean).join(':') || 'لا يوجد'}</div>
                  {source && <Link href={source.href} className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-900"><ExternalLink className="h-4 w-4" /> فتح المستند المصدر</Link>}
                </div>
                <div>
                  <h2 className="font-bold text-slate-900">سجل القيد</h2>
                  <div className="mt-2 space-y-1 text-sm text-slate-600">
                    <div>تاريخ الإنشاء: {new Date(entry.createdAt).toLocaleString('ar-EG')}</div>
                    <div>آخر تحديث: {new Date(entry.updatedAt).toLocaleString('ar-EG')}</div>
                    <div>تاريخ الترحيل: {entry.postedDate ? new Date(entry.postedDate).toLocaleString('ar-EG') : 'غير مرحّل'}</div>
                    <div className="flex items-center gap-2">حالة العكس: {entry.reversalEntryId ? <><RotateCcw className="h-4 w-4" /> معكوس</> : 'غير معكوس'}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-right">الحساب</th>
                    <th className="px-4 py-3 text-right">البيان</th>
                    <th className="px-4 py-3 text-left">مدين</th>
                    <th className="px-4 py-3 text-left">دائن</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {entry.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="px-4 py-3 font-semibold">{line.accountCode} - {line.account?.nameAr || 'حساب'}</td>
                      <td className="px-4 py-3 text-slate-600">{line.description || '-'}</td>
                      <td className="px-4 py-3 text-left font-bold">{fmtMoney(Number(line.debit || 0))}</td>
                      <td className="px-4 py-3 text-left font-bold">{fmtMoney(Number(line.credit || 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AccountingLayout>
  );
}

function Info({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold text-slate-500">{title}</div>
      <div className="mt-2 text-lg font-black text-slate-950">{value}</div>
    </div>
  );
}

function sourceLink(type?: string | null, id?: string | null) {
  if (!type || !id) return null;
  const map: Record<string, string> = {
    SalesInvoice: `/invoices/sales/${id}`,
    PurchaseInvoice: `/invoices/purchases/${id}`,
    Payment: `/accounting/payments`,
    Expense: `/reports/expenses`,
    ProductionOrder: `/manufacturing/production-orders/${id}`,
    CashboxTransfer: `/accounting/treasury/transactions`,
  };
  return map[type] ? { href: map[type] } : null;
}

