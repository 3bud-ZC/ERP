'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { apiGet, apiGetList, apiPost } from '@/lib/api/fetcher';
import { AccountingLayout, KpiCard } from '@/components/accounting/AccountingLayout';
import { getStatusBadge } from '@/lib/page-utils';
import { ArrowDownCircle, ArrowUpCircle, Calculator, PlusCircle, Search, Wallet } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Modal, Field, SelectField, TextAreaField } from '@/components/ui/modal';
import { Toast, useToast } from '@/components/ui/patterns';
import { MANUAL_CATEGORY_LABEL, MANUAL_PAYMENT_CATEGORIES } from '@/lib/manual-payment-categories';

interface PaymentAllocation {
  id: string;
  invoiceId: string;
  invoiceType: string;
  amount: number;
}

interface PaymentRow {
  id: string;
  amount: number;
  date: string;
  type: string;
  source?: 'payment' | 'manual';
  manualCategory?: string;
  manualParty?: string;
  manualReason?: string;
  cashboxName?: string;
  reconciled?: boolean;
  customer?: { nameAr?: string; code?: string };
  supplier?: { nameAr?: string; code?: string };
  allocations?: PaymentAllocation[];
}

interface Cashbox {
  id: string;
  code: string;
  name: string;
  currentBalance: number;
  status: string;
}

interface CashboxTransactionRow {
  id: string;
  type: string;
  direction: 'in' | 'out';
  amount: number;
  date: string;
  description?: string | null;
  cashbox?: { id: string; code: string; name: string };
}

interface CashboxTransactionsPayload {
  rows?: CashboxTransactionRow[];
}

function parseManualDescription(rawValue?: string | null) {
  const raw = String(rawValue || '').trim();
  const parts = raw.split('::').map((part) => part.trim()).filter(Boolean);
  const meta: Record<string, string> = {};

  for (const part of parts) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key && value) meta[key] = value;
  }

  return {
    category: meta.category || 'other',
    party: meta.party || '',
    reason: meta.reason || parts.join(' - ') || raw,
  };
}

export default function PaymentsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [toast, showToast] = useToast();
  const sp = useSearchParams();
  const typeFilter = (sp.get('type') || '').toLowerCase(); // incoming | outgoing | ''

  const { data: paymentData, isLoading: paymentsLoading, error: paymentsError } = useQuery({
    queryKey: ['payments', 'list'],
    queryFn: () => apiGetList<PaymentRow>('/api/payments'),
    staleTime: 0,
  });

  const { data: cashboxTxPayload, isLoading: txLoading, error: txError } = useQuery({
    queryKey: ['cashboxes', 'manual-tx-payments'],
    queryFn: () => apiGet<CashboxTransactionsPayload>('/api/cashboxes?transactions=true&take=300'),
    staleTime: 0,
  });

  const { data: cashboxes = [] } = useQuery({
    queryKey: ['cashboxes', 'list'],
    queryFn: () => apiGetList<Cashbox>('/api/cashboxes?status=active'),
    staleTime: 0,
  });

  const [manualOpen, setManualOpen] = useState(false);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualForm, setManualForm] = useState({
    cashboxId: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    category: 'expense',
    reason: '',
    reference: '',
  });

  const paymentsAll = useMemo(() => {
    const base = paymentData ?? [];
    const manualRows: PaymentRow[] = (cashboxTxPayload?.rows ?? [])
      .filter((tx) => tx.type === 'manual_out' || tx.type === 'manual_in')
      .map((tx) => {
        const parsed = parseManualDescription(tx.description);
        return {
          id: `manual:${tx.id}`,
          amount: Number(tx.amount || 0),
          date: tx.date,
          type: tx.direction === 'in' ? 'incoming' : 'outgoing',
          source: 'manual',
          manualCategory: parsed.category,
          manualParty: parsed.party,
          manualReason: parsed.reason,
          cashboxName: tx.cashbox?.name || '—',
          reconciled: true,
          allocations: [],
        };
      });
    return [...base, ...manualRows].sort((a, b) => {
      const ad = new Date(a.date).getTime();
      const bd = new Date(b.date).getTime();
      return bd - ad;
    });
  }, [paymentData, cashboxTxPayload?.rows]);

  const isLoading = paymentsLoading || txLoading;
  const error = paymentsError || txError;
  const [filters, setFilters] = useState({ from: '', to: '', q: '' });
  const payments = useMemo(() => {
    if (typeFilter === 'incoming') return paymentsAll.filter((p) => p.type === 'incoming');
    if (typeFilter === 'outgoing') return paymentsAll.filter((p) => p.type !== 'incoming');
    return paymentsAll;
  }, [paymentsAll, typeFilter]);

  const filtered = useMemo(() => {
    const from = filters.from ? new Date(filters.from) : null;
    const to = filters.to ? new Date(filters.to) : null;
    const q = filters.q.trim().toLowerCase();

    return payments.filter((p) => {
      const d = p.date ? new Date(p.date) : null;
      if (from && d && d < from) return false;
      if (to && d && d > new Date(to.getTime() + 86399999)) return false;

      if (!q) return true;
      const party = (p.customer?.nameAr || p.supplier?.nameAr || p.manualParty || p.manualReason || '').toLowerCase();
      const partyCode = (p.customer?.code || p.supplier?.code || '').toLowerCase();
      const cashbox = (p.cashboxName || '').toLowerCase();
      const category = (p.manualCategory ? (MANUAL_CATEGORY_LABEL[p.manualCategory] || p.manualCategory) : '').toLowerCase();
      return party.includes(q) || partyCode.includes(q) || cashbox.includes(q) || category.includes(q) || String(p.id || '').toLowerCase().includes(q);
    });
  }, [payments, filters.from, filters.to, filters.q]);
  const summary = useMemo(() => {
    const incoming = paymentsAll.filter(p => p.type === 'incoming').reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const outgoing = paymentsAll.filter(p => p.type !== 'incoming').reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const total = paymentsAll.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    return {
      incoming,
      outgoing,
      average: paymentsAll.length ? total / paymentsAll.length : 0,
      count: paymentsAll.length,
    };
  }, [paymentsAll]);
  const fmt = (value: number) => `${value.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;

  const filteredTotals = useMemo(() => {
    const total = filtered.reduce((s, p) => s + Number(p.amount || 0), 0);
    const avg = filtered.length ? total / filtered.length : 0;
    return { total, avg, count: filtered.length };
  }, [filtered]);

  function setFilter(next: '' | 'incoming' | 'outgoing') {
    const url = new URL(window.location.href);
    if (!next) url.searchParams.delete('type');
    else url.searchParams.set('type', next);
    router.replace(url.pathname + (url.search ? url.search : ''), { scroll: false });
  }

  async function submitManualPayment() {
    if (manualSubmitting) return;

    const amount = Number(manualForm.amount);
    if (!manualForm.cashboxId) {
      showToast('يجب اختيار الخزنة التي سيتم الخصم منها', 'error');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('المبلغ يجب أن يكون أكبر من صفر', 'error');
      return;
    }
    if (!manualForm.reason.trim()) {
      showToast('سبب الدفع اليدوي إلزامي', 'error');
      return;
    }

    setManualSubmitting(true);
    try {
      const category = manualForm.category || 'other';
      const reason = manualForm.reason.trim();
      const reference = manualForm.reference.trim();
      const description = `category:${category}::${reason}${reference ? ` (مرجع: ${reference})` : ''}`;

      await apiPost('/api/cashboxes/manual', {
        cashboxId: manualForm.cashboxId,
        direction: 'out',
        amount,
        date: manualForm.date,
        description,
      });

      showToast('تم تسجيل المدفوع اليدوي بنجاح', 'success');
      setManualOpen(false);
      setManualForm({
        cashboxId: '',
        amount: '',
        date: new Date().toISOString().slice(0, 10),
        category: 'expense',
        reason: '',
        reference: '',
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payments', 'list'] }),
        queryClient.invalidateQueries({ queryKey: ['cashboxes', 'manual-tx-payments'] }),
        queryClient.invalidateQueries({ queryKey: ['cashboxes', 'list'] }),
      ]);
    } catch (err: any) {
      showToast(err?.message || 'تعذر تسجيل المدفوع اليدوي', 'error');
    } finally {
      setManualSubmitting(false);
    }
  }

  return (
    <AccountingLayout
      title="المدفوعات"
      subtitle="سجل التحصيلات والمدفوعات وتوزيعها على الفواتير"
      toolbar={(
        <button
          type="button"
          onClick={() => {
            setManualForm((f) => ({ ...f, cashboxId: f.cashboxId || (cashboxes[0]?.id ?? '') }));
            setManualOpen(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900"
        >
          <PlusCircle className="h-4 w-4" />
          إضافة مدفوع يدوي
        </button>
      )}
    >
      <Toast toast={toast} />
      {isLoading && <p className="text-sm text-slate-500">جاري التحميل…</p>}
      {error && <p className="text-sm text-red-600">{(error as Error).message}</p>}

      <div className="text-xs text-slate-500" dir="rtl">المحاسبة &gt; المدفوعات</div>

      <div className="bg-white rounded-[10px] shadow-sm border border-slate-200/80 p-1.5 flex gap-1 overflow-x-auto" dir="rtl">
        <button onClick={() => setFilter('')} className={segCls(!typeFilter)} type="button">الكل</button>
        <button onClick={() => setFilter('incoming')} className={segCls(typeFilter === 'incoming')} type="button">التحصيلات</button>
        <button onClick={() => setFilter('outgoing')} className={segCls(typeFilter === 'outgoing')} type="button">المدفوعات</button>
      </div>

      <div className="rounded-[10px] border border-slate-200 bg-white p-4 shadow-sm" dir="rtl">
        <div className="grid gap-3 md:grid-cols-4">
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className={inputCls} />
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className={inputCls} />
          <div className="relative md:col-span-2">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              placeholder="بحث بالاسم/الكود/المعرف…"
              className={`${inputCls} pr-9`}
            />
          </div>
        </div>
        <div className="mt-3 text-xs text-slate-500">
          النتائج المعروضة: <span className="font-bold text-slate-700">{filteredTotals.count}</span> حركة.
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="عدد الحركات (حسب الفلتر)"
          value={filteredTotals.count}
          subtitle={typeFilter === 'incoming' ? 'تحصيلات' : typeFilter === 'outgoing' ? 'مدفوعات' : 'الكل'}
          icon={Wallet}
          color="slate"
        />
        <KpiCard
          title={typeFilter === 'incoming' ? 'إجمالي التحصيل' : typeFilter === 'outgoing' ? 'إجمالي المدفوعات' : 'إجمالي قيمة الحركات'}
          value={fmt(filteredTotals.total)}
          subtitle="حسب النتائج المعروضة"
          icon={typeFilter === 'outgoing' ? ArrowUpCircle : ArrowDownCircle}
          color={typeFilter === 'outgoing' ? 'amber' : 'green'}
        />
        <KpiCard title="المتوسط الحسابي" value={fmt(filteredTotals.avg)} subtitle="متوسط قيمة الحركة" icon={Calculator} color="blue" />
        <KpiCard
          title="ملخص عام"
          value={fmt(typeFilter === 'incoming' ? summary.incoming : typeFilter === 'outgoing' ? summary.outgoing : (summary.incoming + summary.outgoing))}
          subtitle="إجمالي النظام (غير متأثر بالفلتر)"
          icon={Wallet}
          color="purple"
        />
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-2 text-right">التاريخ</th>
              <th className="px-3 py-2 text-right">النوع</th>
              <th className="px-3 py-2 text-right">الطرف</th>
              <th className="px-3 py-2 text-right">المبلغ</th>
              <th className="px-3 py-2 text-right">التوزيع</th>
              <th className="px-3 py-2 text-right">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const party = p.customer?.nameAr || p.supplier?.nameAr || '—';
              const badge = getStatusBadge(p.reconciled ? 'paid' : 'pending');
              const allocCount = p.allocations?.length ?? 0;
              const allocSum = (p.allocations ?? []).reduce((s, a) => s + Number(a.amount || 0), 0);
              const manualCategory = p.manualCategory ? (MANUAL_CATEGORY_LABEL[p.manualCategory] || p.manualCategory) : '';
              const partyLabel = p.source === 'manual'
                ? `${p.manualParty || manualCategory || 'مدفوع يدوي'}${p.cashboxName ? ` • ${p.cashboxName}` : ''}`
                : party;
              return (
                <tr key={p.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{new Date(p.date).toLocaleDateString('ar-EG')}</td>
                  <td className="px-3 py-2">{p.type === 'incoming' ? 'قبض' : 'صرف'}{p.source === 'manual' ? ' يدوي' : ''}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-900">{partyLabel}</div>
                    {p.source === 'manual' && p.manualReason && (
                      <div className="text-xs text-slate-500 mt-0.5">{p.manualReason}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 font-medium">{Number(p.amount).toLocaleString('ar-EG')}</td>
                  <td className="px-3 py-2">
                    {p.source === 'manual' ? (
                      <span className="text-xs font-semibold text-slate-600">حركة يدوية بدون فاتورة</span>
                    ) : allocCount === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <span className="text-xs font-semibold text-slate-700" title={`إجمالي التوزيع: ${fmt(allocSum)}`}>
                        {allocCount} فاتورة · {fmt(allocSum)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${badge.bgColor} ${badge.textColor}`}>
                      {badge.text}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!isLoading && filtered.length === 0 && (
          <p className="p-6 text-center text-sm text-slate-500">لا توجد نتائج مطابقة.</p>
        )}
      </div>

      <Modal
        open={manualOpen}
        onClose={() => (manualSubmitting ? null : setManualOpen(false))}
        title="إضافة مدفوع يدوي"
        subtitle="تسجيل صرف مباشر من خزنة محددة مع سبب إلزامي"
        icon={<ArrowUpCircle className="w-5 h-5" />}
        size="xl"
        footer={(
          <>
            <button
              type="button"
              onClick={() => setManualOpen(false)}
              disabled={manualSubmitting}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              إلغاء
            </button>
            <button
              type="button"
              onClick={submitManualPayment}
              disabled={manualSubmitting}
              className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
            >
              {manualSubmitting ? 'جاري الحفظ…' : 'حفظ المدفوع'}
            </button>
          </>
        )}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SelectField
            label="الخزنة"
            required
            value={manualForm.cashboxId}
            onChange={(e) => setManualForm((f) => ({ ...f, cashboxId: e.target.value }))}
          >
            <option value="">اختر الخزنة</option>
            {cashboxes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </SelectField>
          <Field
            label="المبلغ"
            required
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="مثال: 1500"
            value={manualForm.amount}
            onChange={(e) => setManualForm((f) => ({ ...f, amount: e.target.value }))}
          />
          <Field
            label="تاريخ الدفع"
            type="date"
            required
            value={manualForm.date}
            onChange={(e) => setManualForm((f) => ({ ...f, date: e.target.value }))}
          />
          <SelectField
            label="نوع المدفوع"
            required
            value={manualForm.category}
            onChange={(e) => setManualForm((f) => ({ ...f, category: e.target.value }))}
          >
            {MANUAL_PAYMENT_CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </SelectField>
          <div className="sm:col-span-2">
            <TextAreaField
              label="سبب الدفع (إلزامي)"
              required
              rows={3}
              placeholder="اكتب السبب بشكل واضح"
              value={manualForm.reason}
              onChange={(e) => setManualForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Field
              label="مرجع إضافي (اختياري)"
              placeholder="مثال: رقم فاتورة / اسم عامل / رقم سند"
              value={manualForm.reference}
              onChange={(e) => setManualForm((f) => ({ ...f, reference: e.target.value }))}
            />
          </div>
        </div>
      </Modal>

      {/* لتقليل التشتيت: الاعتماد على تبويبات المحاسبة + السايدبار */}
    </AccountingLayout>
  );
}

function segCls(active: boolean) {
  return `flex-1 min-w-[110px] px-4 py-2.5 rounded-lg text-sm transition-all ${active
    ? 'og-tab-active font-semibold shadow-md shadow-slate-950/10'
    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
  }`;
}

const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500';
