'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Landmark, Pencil, Plus, RefreshCw } from 'lucide-react';
import { apiGetList, apiPost, apiPut } from '@/lib/api/fetcher';
import { fmtMoneyEGP } from '@/components/reports/ReportShell';
import { Field, Modal, PrimaryButton, SecondaryButton, SelectField, TextAreaField } from '@/components/ui/modal';
import { Toast, useToast } from '@/components/ui/patterns';
import { useAuthStore } from '@/lib/store/auth';

interface CapitalEntry {
  id: string;
  journalEntryId: string;
  amount: number;
  date: string;
  notes: string;
  sourceType: 'cashbox' | 'bank';
  sourceAccountCode: string;
  cashbox?: { id: string; code: string; name: string } | null;
}

interface Cashbox {
  id: string;
  code: string;
  name: string;
}

const DEFAULT_FORM = {
  amount: '',
  date: new Date().toISOString().slice(0, 10),
  sourceType: 'bank',
  cashboxId: '',
  notes: '',
};

export function CapitalContributionsPanel({ onChanged }: { onChanged: () => Promise<unknown> | unknown }) {
  const { user } = useAuthStore();
  const [toast, showToast] = useToast();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);

  const canManage = Boolean(user?.roles?.includes('admin') || user?.email?.toLowerCase().includes('admin') || user?.permissions?.includes('manage_accounting'));

  const entriesQuery = useQuery({
    queryKey: ['accounting-capital'],
    queryFn: () => apiGetList<CapitalEntry>('/api/accounting/capital'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const cashboxesQuery = useQuery({
    queryKey: ['cashboxes', 'capital-panel'],
    queryFn: () => apiGetList<Cashbox>('/api/cashboxes?status=active'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const totalCapital = useMemo(
    () => (entriesQuery.data ?? []).reduce((sum, row) => sum + Number(row.amount || 0), 0),
    [entriesQuery.data],
  );

  function openCreate() {
    setEditingId(null);
    setForm(DEFAULT_FORM);
    setOpen(true);
  }

  function openEdit(entry: CapitalEntry) {
    setEditingId(entry.id);
    setForm({
      amount: String(Number(entry.amount || 0)),
      date: new Date(entry.date).toISOString().slice(0, 10),
      sourceType: entry.sourceType,
      cashboxId: entry.cashbox?.id || '',
      notes: entry.notes || '',
    });
    setOpen(true);
  }

  async function submit() {
    setSubmitting(true);
    try {
      const payload = {
        id: editingId,
        amount: Number(form.amount),
        date: form.date,
        sourceType: form.sourceType,
        cashboxId: form.sourceType === 'cashbox' ? form.cashboxId : undefined,
        notes: form.notes,
      };
      if (editingId) await apiPut('/api/accounting/capital', payload);
      else await apiPost('/api/accounting/capital', payload);

      await Promise.all([entriesQuery.refetch(), Promise.resolve(onChanged())]);
      setOpen(false);
      setEditingId(null);
      setForm(DEFAULT_FORM);
      showToast(editingId ? 'تم تعديل رأس المال' : 'تم تسجيل رأس المال', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'تعذر حفظ رأس المال', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (!canManage) return null;

  return (
    <>
      <Toast toast={toast} />
      <section className="neo-raised rounded-2xl p-5" dir="rtl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">إدارة رأس المال</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">من هنا تسجل رأس المال وتعدله، وسيظهر مباشرة داخل حقوق الملكية ويؤثر على الخزنة أو البنك.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void entriesQuery.refetch()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className={`h-4 w-4 ${entriesQuery.isFetching ? 'animate-spin' : ''}`} />
              تحديث
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4" />
              تسجيل رأس المال
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">إجمالي رأس المال المسجل</div>
            <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">{fmtMoneyEGP(totalCapital)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-xs text-slate-500">عدد عمليات رأس المال</div>
            <div className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">{entriesQuery.data?.length ?? 0}</div>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800">آخر عمليات رأس المال</div>
          {entriesQuery.isLoading ? (
            <div className="p-6 text-center text-sm text-slate-500">جاري تحميل العمليات...</div>
          ) : (entriesQuery.data?.length ?? 0) === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">لا توجد عمليات رأس مال مسجلة حتى الآن.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-right font-medium">التاريخ</th>
                    <th className="px-4 py-3 text-right font-medium">المصدر</th>
                    <th className="px-4 py-3 text-left font-medium">القيمة</th>
                    <th className="px-4 py-3 text-right font-medium">ملاحظات</th>
                    <th className="px-4 py-3 text-right font-medium">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(entriesQuery.data ?? []).slice(0, 6).map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-4 py-3 text-slate-600">{new Date(entry.date).toLocaleDateString('ar-EG')}</td>
                      <td className="px-4 py-3 text-slate-600">{entry.sourceType === 'cashbox' ? `خزنة - ${entry.cashbox?.name || '—'}` : 'بنك'}</td>
                      <td className="px-4 py-3 text-left font-semibold tabular-nums text-slate-900">{fmtMoneyEGP(entry.amount)}</td>
                      <td className="px-4 py-3 text-slate-600">{entry.notes || '—'}</td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => openEdit(entry)}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          تعديل
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <Modal
        open={open}
        onClose={() => !submitting && setOpen(false)}
        title={editingId ? 'تعديل رأس المال' : 'تسجيل رأس المال'}
        subtitle="أدخل القيمة وسيتم ترحيلها محاسبيًا مباشرة"
        icon={<Landmark className="h-5 w-5" />}
        footer={(
          <>
            <SecondaryButton onClick={() => setOpen(false)} disabled={submitting}>إلغاء</SecondaryButton>
            <PrimaryButton type="button" onClick={submit} disabled={submitting}>
              {submitting ? 'جاري الحفظ...' : editingId ? 'حفظ التعديل' : 'حفظ رأس المال'}
            </PrimaryButton>
          </>
        )}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="قيمة رأس المال" type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((current) => ({ ...current, amount: e.target.value }))} required />
          <Field label="التاريخ" type="date" value={form.date} onChange={(e) => setForm((current) => ({ ...current, date: e.target.value }))} required />
          <SelectField label="المصدر" value={form.sourceType} onChange={(e) => setForm((current) => ({ ...current, sourceType: e.target.value as 'cashbox' | 'bank' }))}>
            <option value="bank">بنك</option>
            <option value="cashbox">خزنة</option>
          </SelectField>
          {form.sourceType === 'cashbox' ? (
            <SelectField label="الخزنة" value={form.cashboxId} onChange={(e) => setForm((current) => ({ ...current, cashboxId: e.target.value }))} required>
              <option value="">اختر الخزنة</option>
              {(cashboxesQuery.data ?? []).map((cashbox) => (
                <option key={cashbox.id} value={cashbox.id}>{cashbox.name} ({cashbox.code})</option>
              ))}
            </SelectField>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              سيتم تسجيل رأس المال على الحساب البنكي الافتراضي.
            </div>
          )}
          <div className="sm:col-span-2">
            <TextAreaField label="ملاحظات" rows={3} value={form.notes} onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))} />
          </div>
        </div>
      </Modal>
    </>
  );
}
