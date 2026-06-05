'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowDownCircle, ArrowUpCircle, FileText, Wallet } from 'lucide-react';
import { apiGet, apiGetList, apiPost } from '@/lib/api/fetcher';
import { Modal, Field, SelectField, TextAreaField } from '@/components/ui/modal';
import { Toast, useToast } from '@/components/ui/patterns';
import { ServicesLayout } from '@/components/services/ServicesLayout';
import { KpiCard } from '@/components/accounting/AccountingLayout';
import { fmtMoneyEGP } from '@/components/reports/ReportShell';

type PartyType = 'customer' | 'supplier';

interface Cashbox {
  id: string;
  code: string;
  name: string;
  currentBalance: number;
}

interface LedgerRow {
  id: string;
  date: string;
  type: string;
  label: string;
  debit: number;
  credit: number;
  balance: number;
  notes?: string | null;
}

interface DebtPayload {
  partyType: PartyType;
  party: {
    id: string;
    code: string;
    nameAr: string;
    phone?: string | null;
    email?: string | null;
    openingBalanceType?: string | null;
    openingBalanceAmount?: number | null;
  };
  summary: {
    openingBalance: number;
    invoiceTotal: number;
    invoicePaid: number;
    invoiceRemaining: number;
    directCollections?: number;
    directPayments?: number;
    currentBalance: number;
    status: string;
    lastTransactionAt?: string | null;
  };
  transactions: LedgerRow[];
}

export function PartyDebtDetailsPage({ partyType, partyId }: { partyType: PartyType; partyId: string }) {
  const queryClient = useQueryClient();
  const [toast, showToast] = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const isCustomer = partyType === 'customer';
  const queryKey = ['party-debt', partyType, partyId];

  const debtQ = useQuery({
    queryKey,
    queryFn: () => apiGet<DebtPayload>(`/api/party-debts?partyType=${partyType}&partyId=${partyId}`),
    staleTime: 0,
  });
  const cashboxesQ = useQuery({
    queryKey: ['cashboxes', 'active'],
    queryFn: () => apiGetList<Cashbox>('/api/cashboxes?status=active'),
    staleTime: 30_000,
  });

  const [form, setForm] = useState({
    cashboxId: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    notes: '',
  });

  const cashboxes = cashboxesQ.data ?? [];
  const data = debtQ.data;
  const actionType = isCustomer ? 'customer_collection' : 'supplier_payment';
  const actionLabel = isCustomer ? 'تحصيل من العميل' : 'سداد للمورد';

  async function submit() {
    const amount = Number(form.amount);
    if (!form.cashboxId) return showToast('يجب اختيار الخزنة', 'error');
    if (!Number.isFinite(amount) || amount <= 0) return showToast('المبلغ يجب أن يكون أكبر من صفر', 'error');

    setSaving(true);
    try {
      await apiPost('/api/party-debts', {
        partyType,
        partyId,
        transactionType: actionType,
        cashboxId: form.cashboxId,
        amount,
        date: form.date,
        notes: form.notes,
      });
      showToast('تم تسجيل الحركة بنجاح', 'success');
      setOpen(false);
      setForm({ cashboxId: '', amount: '', date: new Date().toISOString().slice(0, 10), notes: '' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey }),
        queryClient.invalidateQueries({ queryKey: ['cashboxes'] }),
      ]);
    } catch (error: any) {
      showToast(error?.message || 'تعذر تسجيل الحركة', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ServicesLayout
      title={isCustomer ? 'تفاصيل العميل' : 'تفاصيل المورد'}
      subtitle={data?.party?.nameAr || 'جاري التحميل…'}
      toolbar={(
        <button
          type="button"
          onClick={() => {
            setForm((f) => ({ ...f, cashboxId: f.cashboxId || (cashboxes[0]?.id ?? '') }));
            setOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900"
        >
          {isCustomer ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowUpCircle className="h-4 w-4" />}
          {actionLabel}
        </button>
      )}
    >
      <Toast toast={toast} />
      {debtQ.error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{(debtQ.error as Error).message}</div>}

      {data && (
        <>
          <div className="text-xs text-slate-500" dir="rtl">
            <Link className="hover:text-slate-900" href={isCustomer ? '/customers' : '/suppliers'}>
              {isCustomer ? 'العملاء' : 'الموردون'}
            </Link>
            {' > '}
            {data.party.nameAr}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard title="إجمالي الرصيد الافتتاحي" value={fmtMoneyEGP(data.summary.openingBalance)} subtitle={data.summary.status} icon={Wallet} color="slate" />
            <KpiCard title={isCustomer ? 'إجمالي فواتير العميل' : 'إجمالي فواتير المورد'} value={fmtMoneyEGP(data.summary.invoiceTotal)} subtitle="قبل التحصيل/السداد المباشر" icon={FileText} color="blue" />
            <KpiCard
              title={isCustomer ? 'إجمالي المحصل' : 'إجمالي المدفوع'}
              value={fmtMoneyEGP(data.summary.invoicePaid + (data.summary.directCollections || data.summary.directPayments || 0))}
              subtitle="من الفواتير والحركات المباشرة"
              icon={isCustomer ? ArrowDownCircle : ArrowUpCircle}
              color="green"
            />
            <KpiCard title="الرصيد الحالي" value={fmtMoneyEGP(data.summary.currentBalance)} subtitle={data.summary.status} icon={Wallet} color={data.summary.currentBalance > 0 ? 'amber' : 'green'} />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" dir="rtl">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <Info label="الكود" value={data.party.code} />
              <Info label="الهاتف" value={data.party.phone || '—'} />
              <Info label="البريد الإلكتروني" value={data.party.email || '—'} />
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" dir="rtl">
            <div className="border-b border-slate-200 px-5 py-3">
              <h3 className="text-sm font-semibold text-slate-800">سجل العمليات</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-right">التاريخ</th>
                    <th className="px-4 py-3 text-right">البيان</th>
                    <th className="px-4 py-3 text-left">مدين</th>
                    <th className="px-4 py-3 text-left">دائن</th>
                    <th className="px-4 py-3 text-left">الرصيد</th>
                    <th className="px-4 py-3 text-right">ملاحظات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.transactions.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-500">{new Date(row.date).toLocaleDateString('ar-EG')}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{row.label}</td>
                      <td className="px-4 py-3 text-left tabular-nums">{row.debit ? fmtMoneyEGP(row.debit) : '—'}</td>
                      <td className="px-4 py-3 text-left tabular-nums">{row.credit ? fmtMoneyEGP(row.credit) : '—'}</td>
                      <td className="px-4 py-3 text-left font-semibold tabular-nums">{fmtMoneyEGP(row.balance)}</td>
                      <td className="px-4 py-3 text-slate-500">{row.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.transactions.length === 0 && <div className="p-8 text-center text-sm text-slate-500">لا توجد عمليات بعد.</div>}
            </div>
          </div>
        </>
      )}

      <Modal
        open={open}
        onClose={() => (saving ? null : setOpen(false))}
        title={actionLabel}
        subtitle="سيتم تسجيل الحركة في الخزنة والقيود المحاسبية"
        icon={isCustomer ? <ArrowDownCircle className="h-5 w-5" /> : <ArrowUpCircle className="h-5 w-5" />}
        footer={(
          <>
            <button type="button" onClick={() => setOpen(false)} disabled={saving} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">إلغاء</button>
            <button type="button" onClick={submit} disabled={saving} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60">{saving ? 'جاري الحفظ…' : 'حفظ الحركة'}</button>
          </>
        )}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="الخزنة" required value={form.cashboxId} onChange={(e) => setForm((f) => ({ ...f, cashboxId: e.target.value }))}>
            <option value="">اختر الخزنة</option>
            {cashboxes.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
          </SelectField>
          <Field label="المبلغ" required type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          <Field label="التاريخ" required type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          <div className="sm:col-span-2">
            <TextAreaField label="ملاحظات" rows={3} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
      </Modal>
    </ServicesLayout>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-xs text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900">{value}</div>
    </div>
  );
}
