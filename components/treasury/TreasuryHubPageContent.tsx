'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Plus,
  RefreshCw,
  ReceiptText,
  RotateCcw,
  WalletCards,
} from 'lucide-react';
import { fmtMoney } from '@/components/invoices/InvoiceConfig';
import { typeLabel } from '@/components/treasury/TreasuryPageContent';
import { KpiCard } from '@/components/accounting/AccountingLayout';
import { Modal, Field, SelectField, TextAreaField } from '@/components/ui/modal';
import { Toast, useToast } from '@/components/ui/patterns';

type CashboxTx = {
  id: string;
  type: string;
  direction: string;
  amount: number;
  beforeBalance: number;
  afterBalance: number;
  date: string;
  referenceType?: string | null;
  referenceId?: string | null;
  description?: string | null;
  cashbox?: { id: string; code: string; name: string };
};

type Cashbox = {
  id: string;
  code: string;
  name: string;
  currency: string;
  openingBalance: number;
  currentBalance: number;
  status: string;
  transactions?: Array<{ id: string; type: string; direction: string; amount: number; date: string; description?: string | null }>;
};

type TreasuryAnalytics = {
  kpis: {
    treasuryBalance: number;
    availableBalance?: number;
    purchaseOrderCommitments?: number;
    dailyInflow: number;
    dailyOutflow: number;
  };
  distribution?: Array<{ id: string; code: string; name: string; balance: number; currency: string; status: string }>;
};

type CashboxesReportPayload = {
  cashboxes: Cashbox[];
  summary: {
    totalBalance: number;
    totalInflow: number;
    totalOutflow: number;
    activeCashboxes: number;
    lowBalanceCount: number;
    transactionCount: number;
  };
};

export function TreasuryHubPageContent() {
  const [toast, showToast] = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
  const [cashboxesSummary, setCashboxesSummary] = useState<CashboxesReportPayload['summary']>({
    totalBalance: 0,
    totalInflow: 0,
    totalOutflow: 0,
    activeCashboxes: 0,
    lowBalanceCount: 0,
    transactionCount: 0,
  });
  const [recentTx, setRecentTx] = useState<CashboxTx[]>([]);
  const [summary, setSummary] = useState<TreasuryAnalytics | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [manualDir, setManualDir] = useState<'in' | 'out'>('in');
  const [manualForm, setManualForm] = useState({ cashboxId: '', amount: '', date: today, description: '' });

  async function load(silent = false) {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const [resCashboxes, resTx, resSummary] = await Promise.all([
        // Keep hub light: fetch cashboxes list only, and get KPIs from treasury-summary.
        fetch('/api/cashboxes', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/cashboxes?transactions=true&take=25', { credentials: 'include', cache: 'no-store' }),
        fetch('/api/analytics/treasury-summary', { credentials: 'include', cache: 'no-store' }),
      ]);

      const jCashboxes = await resCashboxes.json();
      if (!jCashboxes.success) throw new Error(jCashboxes.message || 'تعذر تحميل الخزن');
      const cashRows: Cashbox[] = Array.isArray(jCashboxes.data) ? jCashboxes.data : (jCashboxes.data?.cashboxes ?? []);
      setCashboxes(cashRows ?? []);

      const jTx = await resTx.json();
      if (!jTx.success) throw new Error(jTx.message || 'تعذر تحميل حركات الخزنة');
      setRecentTx((jTx.data?.rows ?? []).slice(0, 25));

      const jSummary = await resSummary.json();
      if (!jSummary.success) throw new Error(jSummary.message || 'تعذر تحميل ملخص الخزنة');
      setSummary(jSummary.data);
      // Keep the legacy summary object updated for any UI parts that still reference it.
      const k = jSummary.data?.kpis ?? {};
      setCashboxesSummary({
        totalBalance: Number(k.treasuryBalance ?? 0),
        totalInflow: Number(k.dailyInflow ?? 0),
        totalOutflow: Number(k.dailyOutflow ?? 0),
        activeCashboxes: Number(k.activeCashboxes ?? 0),
        lowBalanceCount: Number(k.lowBalanceCount ?? 0),
        transactionCount: 0,
      });
    } catch (err: any) {
      setError(err?.message || 'تعذر الاتصال بالخادم');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, []);

  const lowBalanceCashboxes = useMemo(() => {
    return (cashboxes ?? []).filter((c) => Number(c.currentBalance || 0) <= 0).slice(0, 6);
  }, [cashboxes]);

  function openManual(direction: 'in' | 'out') {
    setManualDir(direction);
    setManualForm((f) => ({ ...f, cashboxId: f.cashboxId || (cashboxes[0]?.id ?? ''), date: today }));
    setManualOpen(true);
  }

  async function submitManual() {
    if (manualSubmitting) return;
    setManualSubmitting(true);
    try {
      const cashboxId = manualForm.cashboxId;
      const amount = Number(manualForm.amount);
      const date = manualForm.date ? new Date(manualForm.date).toISOString() : undefined;
      const description = manualForm.description?.trim() || undefined;

      const res = await fetch('/api/cashboxes/manual', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cashboxId, direction: manualDir, amount, date, description }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.message || 'تعذر تسجيل الحركة');
      }
      showToast(json?.message || 'تم تسجيل الحركة بنجاح', 'success');
      setManualOpen(false);
      setManualForm({ cashboxId: '', amount: '', date: today, description: '' });
      await load(true);
    } catch (err: any) {
      showToast(err?.message || 'تعذر تسجيل الحركة', 'error');
    } finally {
      setManualSubmitting(false);
    }
  }

  async function reverseManualTx(id: string) {
    const ok = window.confirm('تأكيد: هل تريد عكس هذه الحركة؟ سيتم إنشاء حركة عكس بنفس المبلغ.');
    if (!ok) return;
    try {
      const res = await fetch(`/api/cashboxes/transactions/${encodeURIComponent(id)}/reverse`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.message || 'تعذر عكس الحركة');
      showToast(json?.message || 'تم عكس الحركة بنجاح', 'success');
      await load(true);
    } catch (err: any) {
      showToast(err?.message || 'تعذر عكس الحركة', 'error');
    }
  }

  return (
    <div className="space-y-6" dir="rtl">
      <Toast toast={toast} />
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-slate-500">المحاسبة &gt; الخزنة</div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            تحديث
          </button>
          <button
            onClick={() => openManual('in')}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            title="تسجيل وارد يدوي"
          >
            <ArrowDownCircle className="h-4 w-4 text-sky-700" />
            وارد يدوي
          </button>
          <button
            onClick={() => openManual('out')}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            title="تسجيل منصرف يدوي"
          >
            <ArrowUpCircle className="h-4 w-4 text-rose-600" />
            منصرف يدوي
          </button>
          <Link
            href="/accounting/treasury/new"
            className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900"
          >
            <Plus className="h-4 w-4" />
            إضافة خزنة
          </Link>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {!loading && !error && cashboxesSummary.lowBalanceCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <div className="font-bold">تنبيه: يوجد خزن برصيد منخفض/سالب</div>
          <div className="mt-1 text-xs text-amber-800">
            {lowBalanceCashboxes.map((c) => (
              <span key={c.id} className="ml-2 inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5">
                <Link href={`/accounting/treasury/${c.id}`} className="font-semibold hover:underline">
                  {c.name}
                </Link>
                <span className="tabular-nums">{fmtMoney(Number(c.currentBalance || 0))}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-5">
        <KpiCard title="إجمالي رصيد الخزن" value={fmtMoney(summary?.kpis.treasuryBalance ?? cashboxesSummary.totalBalance)} icon={WalletCards} color="purple" />
        <KpiCard title="الرصيد المتاح" value={fmtMoney(summary?.kpis.availableBalance ?? (summary?.kpis.treasuryBalance ?? cashboxesSummary.totalBalance))} icon={WalletCards} color="blue" />
        <KpiCard title="التزامات أوامر الشراء" value={fmtMoney(summary?.kpis.purchaseOrderCommitments ?? 0)} icon={ReceiptText} color="amber" />
        <KpiCard title="وارد اليوم" value={fmtMoney(summary?.kpis.dailyInflow ?? 0)} icon={ArrowDownCircle} color="blue" />
        <KpiCard title="منصرف اليوم" value={fmtMoney(summary?.kpis.dailyOutflow ?? 0)} icon={ArrowUpCircle} color="red" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="bg-white rounded-[10px] shadow-sm border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-bold text-slate-900">الخزن</div>
              <div className="text-xs text-slate-500">إدارة الخزن ورصد الرصيد الحالي</div>
            </div>
            <Link href="/accounting/treasury" className="text-xs font-semibold text-sky-700 hover:text-sky-900">عرض التفاصيل</Link>
          </div>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : cashboxes.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
              لا توجد خزن بعد. أضف خزنة لبدء تسجيل التحصيلات والمدفوعات النقدية.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {cashboxes.slice(0, 6).map((c) => {
                const last = c.transactions?.[0];
                const tone = Number(c.currentBalance || 0) < 0 ? 'bg-red-50 text-red-700' : c.status === 'active' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-700';
                return (
                  <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-950 truncate">{c.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5 truncate">{c.code} · {c.currency}</div>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${tone}`}>
                        {Number(c.currentBalance || 0) < 0 ? 'سالب' : c.status === 'active' ? 'نشطة' : 'غير نشطة'}
                      </span>
                    </div>
                    <div className="mt-2 text-lg font-black text-slate-950 tabular-nums">{fmtMoney(Number(c.currentBalance || 0))}</div>
                    <div className="mt-2 text-xs text-slate-500 truncate">
                      آخر حركة: {last ? `${typeLabel(last.type)} - ${fmtMoney(Number(last.amount || 0))}` : 'لا توجد'}
                    </div>
                    <div className="mt-3">
                      <Link href={`/accounting/treasury/${c.id}`} className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        التفاصيل
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-[10px] shadow-sm border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-bold text-slate-900">آخر حركات الخزنة</div>
              <div className="text-xs text-slate-500">وارد/منصرف مع الرصيد قبل وبعد</div>
            </div>
            <Link href="/accounting/treasury/transactions" className="text-xs font-semibold text-sky-700 hover:text-sky-900">كل الحركات</Link>
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-right text-xs font-semibold">الخزنة</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold">النوع</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold">المبلغ</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold">قبل/بعد</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold">التاريخ</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold w-28">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  [1, 2, 3, 4, 5].map((i) => (
                    <tr key={i}><td colSpan={6} className="px-3 py-3"><div className="h-8 animate-pulse rounded bg-slate-100" /></td></tr>
                  ))
                ) : recentTx.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">لا توجد حركات حتى الآن.</td></tr>
                ) : (
                  recentTx.slice(0, 10).map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-semibold">{t.cashbox?.name || '—'}</td>
                      <td className="px-3 py-2 text-slate-700">{typeLabel(t.type)}</td>
                      <td className="px-3 py-2 font-bold">
                        <span className={t.direction === 'in' ? 'text-sky-700' : 'text-red-700'}>
                          {t.direction === 'in' ? '+' : '-'} {fmtMoney(Number(t.amount || 0))}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500 tabular-nums">{fmtMoney(Number(t.beforeBalance || 0))} / {fmtMoney(Number(t.afterBalance || 0))}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{new Date(t.date).toLocaleDateString('ar-EG')}</td>
                      <td className="px-3 py-2">
                        {t.type === 'manual_in' || t.type === 'manual_out' ? (
                          <button
                            onClick={() => reverseManualTx(t.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            title="عكس الحركة"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            عكس
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-semibold text-slate-700">تحليلات الخزنة</div>
          <div className="text-xs text-slate-500 mt-0.5">الاتجاهات والتوقعات متاحة في صفحة التحليلات لتسريع الأداء هنا.</div>
        </div>
        <Link href="/accounting/treasury/analytics" className="inline-flex items-center justify-center rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-900">
          فتح التحليلات
        </Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm font-semibold text-slate-700">إجراءات سريعة</div>
        <div className="flex items-center gap-2">
          <Link className={pillCls} href="/accounting/treasury/transfers">تحويل بين الخزن</Link>
          <Link className={pillCls} href="/accounting/treasury/report">تقرير الخزنة</Link>
          <Link className={pillCls} href="/accounting/payments?type=incoming">التحصيلات</Link>
          <Link className={pillCls} href="/accounting/payments?type=outgoing">المدفوعات</Link>
        </div>
      </div>

      <Modal
        open={manualOpen}
        onClose={() => (manualSubmitting ? null : setManualOpen(false))}
        title={manualDir === 'in' ? 'تسجيل وارد يدوي' : 'تسجيل منصرف يدوي'}
        subtitle="هذه الحركة تُسجّل في الخزنة فوراً مع الرصيد قبل وبعد."
        icon={manualDir === 'in' ? <ArrowDownCircle className="w-5 h-5" /> : <ArrowUpCircle className="w-5 h-5" />}
        size="lg"
        footer={
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
              onClick={submitManual}
              disabled={manualSubmitting}
              className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60"
            >
              {manualSubmitting ? 'جاري الحفظ…' : 'حفظ الحركة'}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SelectField
            label="الخزنة"
            required
            value={manualForm.cashboxId}
            onChange={(e) => setManualForm((f) => ({ ...f, cashboxId: e.target.value }))}
          >
            <option value="">اختر خزنة</option>
            {cashboxes.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
            ))}
          </SelectField>
          <Field
            label="التاريخ"
            type="date"
            value={manualForm.date}
            onChange={(e) => setManualForm((f) => ({ ...f, date: e.target.value }))}
          />
          <Field
            label="المبلغ"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            placeholder="مثال: 1500"
            value={manualForm.amount}
            onChange={(e) => setManualForm((f) => ({ ...f, amount: e.target.value }))}
          />
          <div className="sm:col-span-2">
            <TextAreaField
              label="الوصف (اختياري)"
              placeholder={manualDir === 'in' ? 'مثال: إيداع نقدي' : 'مثال: مصروفات تشغيل'}
              rows={3}
              value={manualForm.description}
              onChange={(e) => setManualForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}

const pillCls = 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50';
