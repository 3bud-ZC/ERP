'use client';

import type { ComponentType, FormEvent } from 'react';
import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Landmark, Pencil, Plus, RefreshCw } from 'lucide-react';
import { apiFetch, apiGet, apiPut } from '@/lib/api/fetcher';
import { fmtMoneyEGP } from '@/components/reports/ReportShell';
import { Toast, useToast } from '@/components/ui/patterns';
import {
  Field,
  FieldGrid,
  FormError,
  Modal,
  PrimaryButton,
  SecondaryButton,
  SelectField,
  TextAreaField,
} from '@/components/ui/modal';

type FixedAssetCategory = 'machines' | 'furniture' | 'devices' | 'vehicles' | 'other';

interface FixedAssetRecord {
  id: string;
  assetNumber: string;
  name: string;
  description?: string | null;
  accountCode: string;
  purchaseDate: string;
  purchaseCost: number;
  usefulLife: number;
  salvageValue: number;
  netBookValue: number;
  status: string;
}

interface FixedAssetsPayload {
  fixedAssets: FixedAssetRecord[];
  total: number;
  page: number;
  limit: number;
}

const CATEGORY_OPTIONS: Array<{ value: FixedAssetCategory; label: string; placeholder: string }> = [
  { value: 'machines', label: 'الآلات', placeholder: 'مثال: ماكينة قص' },
  { value: 'furniture', label: 'الأثاث', placeholder: 'مثال: مكتب إدارة' },
  { value: 'devices', label: 'الأجهزة', placeholder: 'مثال: لابتوب تصميم' },
  { value: 'vehicles', label: 'السيارات', placeholder: 'مثال: سيارة نقل' },
  { value: 'other', label: 'أصول أخرى', placeholder: 'مثال: تجهيزات مصنع' },
];

const DEFAULT_FORM = {
  category: 'machines' as FixedAssetCategory,
  name: '',
  purchaseCost: '',
  purchaseDate: new Date().toISOString().slice(0, 10),
  notes: '',
};

function createIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `fixed-asset-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function FixedAssetsPanel({
  onCreated,
}: {
  onCreated: () => Promise<unknown> | unknown;
}) {
  const [open, setOpen] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, showToast] = useToast();
  const submitLockRef = useRef<string | null>(null);

  const assetsQuery = useFixedAssetsQuery();

  const summary = useMemo(() => {
    const items = assetsQuery.data?.fixedAssets ?? [];
    const activeAssets = items.filter((asset) => asset.status === 'active');
    return {
      count: activeAssets.length,
      cost: activeAssets.reduce((sum, asset) => sum + Number(asset.purchaseCost || 0), 0),
      netBookValue: activeAssets.reduce((sum, asset) => sum + Number(asset.netBookValue || 0), 0),
    };
  }, [assetsQuery.data]);

  const categoryPlaceholder = CATEGORY_OPTIONS.find((item) => item.value === form.category)?.placeholder ?? '';

  function openCreateModal() {
    setEditingAssetId(null);
    setForm(DEFAULT_FORM);
    setFormError(null);
    setOpen(true);
  }

  function inferCategory(asset: FixedAssetRecord): FixedAssetCategory {
    const haystack = `${asset.name} ${asset.description || ''}`.toLowerCase();
    if (haystack.includes('آلة') || haystack.includes('ماكينة') || haystack.includes('machine')) return 'machines';
    if (haystack.includes('أثاث') || haystack.includes('مكتب') || haystack.includes('furniture')) return 'furniture';
    if (haystack.includes('جهاز') || haystack.includes('laptop') || haystack.includes('printer')) return 'devices';
    if (haystack.includes('سيارة') || haystack.includes('vehicle') || haystack.includes('truck')) return 'vehicles';
    return 'other';
  }

  function extractNotes(description?: string | null) {
    if (!description) return '';
    const noteLine = description.split('\n').find((line) => line.startsWith('ملاحظات:'));
    return noteLine ? noteLine.replace('ملاحظات:', '').trim() : '';
  }

  function openEditModal(asset: FixedAssetRecord) {
    setEditingAssetId(asset.id);
    setForm({
      category: inferCategory(asset),
      name: asset.name,
      purchaseCost: String(Number(asset.purchaseCost || 0)),
      purchaseDate: new Date(asset.purchaseDate).toISOString().slice(0, 10),
      notes: extractNotes(asset.description),
    });
    setFormError(null);
    setOpen(true);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitLockRef.current) return;

    const idempotencyKey = createIdempotencyKey();
    submitLockRef.current = idempotencyKey;
    setSubmitting(true);
    setFormError(null);

    try {
      const payload = {
        name: form.name.trim(),
        category: form.category,
        notes: form.notes.trim(),
        purchaseDate: form.purchaseDate,
        purchaseCost: Number(form.purchaseCost),
      };

      if (editingAssetId) {
        await apiPut('/api/fixed-assets', {
          id: editingAssetId,
          ...payload,
        });
      } else {
        await apiFetch('/api/fixed-assets', {
          method: 'POST',
          headers: {
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify(payload),
        });
      }

      setOpen(false);
      setEditingAssetId(null);
      setForm(DEFAULT_FORM);
      await Promise.all([assetsQuery.refetch(), Promise.resolve(onCreated())]);
      showToast(editingAssetId ? 'تم تعديل الأصل الثابت' : 'تم تسجيل الأصل الثابت', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذر حفظ الأصل الثابت';
      setFormError(message);
      showToast(message, 'error');
    } finally {
      submitLockRef.current = null;
      setSubmitting(false);
    }
  }

  return (
    <>
      <Toast toast={toast} />

      <section className="neo-raised rounded-2xl p-5" dir="rtl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-sm font-bold text-slate-900">إدارة الأصول الثابتة</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              من هنا تدخل الآلات والأثاث والأجهزة والسيارات والأصول الأخرى كأصول فعلية مرتبطة بالقيد اليومي والميزانية العمومية.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void assetsQuery.refetch()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
              disabled={assetsQuery.isFetching}
            >
              <RefreshCw className={`h-4 w-4 ${assetsQuery.isFetching ? 'animate-spin' : ''}`} />
              تحديث الأصول
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4" />
              إضافة أصل ثابت
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <MiniInfoCard title="عدد الأصول النشطة" value={String(summary.count)} subtitle="أصول غير مستبعدة من الخدمة" icon={Building2} />
          <MiniInfoCard title="إجمالي تكلفة الشراء" value={fmtMoneyEGP(summary.cost)} subtitle="القيمة التاريخية المسجلة" icon={Landmark} />
          <MiniInfoCard title="صافي القيمة الدفترية" value={fmtMoneyEGP(summary.netBookValue)} subtitle="بعد الإهلاك المسجل" icon={Landmark} />
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800">
            آخر الأصول الثابتة المسجلة
          </div>

          {assetsQuery.isLoading ? (
            <div className="p-6 text-center text-sm text-slate-500">جاري تحميل الأصول الثابتة...</div>
          ) : assetsQuery.error ? (
            <div className="p-6 text-center text-sm text-red-600">
              {(assetsQuery.error as Error).message}
            </div>
          ) : (assetsQuery.data?.fixedAssets?.length ?? 0) === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">لا توجد أصول ثابتة مسجلة حتى الآن.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-right font-medium">الأصل</th>
                    <th className="px-4 py-3 text-right font-medium">الحساب</th>
                    <th className="px-4 py-3 text-right font-medium">التاريخ</th>
                    <th className="px-4 py-3 text-left font-medium">التكلفة</th>
                    <th className="px-4 py-3 text-left font-medium">القيمة الدفترية</th>
                    <th className="px-4 py-3 text-right font-medium">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(assetsQuery.data?.fixedAssets ?? []).slice(0, 6).map((asset) => (
                    <tr key={asset.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{asset.name}</div>
                        <div className="mt-1 text-xs text-slate-500">{asset.assetNumber}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{asset.accountCode}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {new Date(asset.purchaseDate).toLocaleDateString('ar-EG')}
                      </td>
                      <td className="px-4 py-3 text-left font-semibold tabular-nums text-slate-900">
                        {fmtMoneyEGP(Number(asset.purchaseCost || 0))}
                      </td>
                      <td className="px-4 py-3 text-left font-semibold tabular-nums text-emerald-700">
                        {fmtMoneyEGP(Number(asset.netBookValue || 0))}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => openEditModal(asset)}
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
        onClose={() => !submitting && (setOpen(false), setEditingAssetId(null))}
        title={editingAssetId ? 'تعديل أصل ثابت' : 'إضافة أصل ثابت'}
        subtitle={editingAssetId ? 'عدّل بيانات الأصل ثم احفظ' : 'سجّل الأصل الثابت مباشرة'}
        icon={<Building2 className="h-5 w-5" />}
        footer={
          <>
            <SecondaryButton onClick={() => { setOpen(false); setEditingAssetId(null); }} disabled={submitting}>إلغاء</SecondaryButton>
            <PrimaryButton type="submit" form="fixed-asset-form" disabled={submitting}>
              {submitting ? 'جاري الحفظ...' : editingAssetId ? 'حفظ التعديل' : 'حفظ الأصل'}
            </PrimaryButton>
          </>
        }
      >
        <form id="fixed-asset-form" className="space-y-5" onSubmit={handleSubmit}>
          <FormError>{formError}</FormError>

          <FieldGrid cols={2}>
            <SelectField
              label="نوع الأصل"
              value={form.category}
              onChange={(e) => setForm((current) => ({ ...current, category: e.target.value as FixedAssetCategory }))}
              required
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </SelectField>

            <Field
              label="اسم الأصل"
              value={form.name}
              placeholder={categoryPlaceholder}
              onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
              required
            />

            <Field
              label="قيمة الأصل"
              type="number"
              min="0"
              step="0.01"
              value={form.purchaseCost}
              onChange={(e) => setForm((current) => ({ ...current, purchaseCost: e.target.value }))}
              required
            />

            <Field
              label="تاريخ الإضافة"
              type="date"
              value={form.purchaseDate}
              onChange={(e) => setForm((current) => ({ ...current, purchaseDate: e.target.value }))}
              required
            />
          </FieldGrid>

          <TextAreaField
            label="ملاحظات"
            rows={4}
            placeholder="أي وصف إضافي أو بيانات تشغيلية"
            value={form.notes}
            onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))}
          />
        </form>
      </Modal>
    </>
  );
}

function useFixedAssetsQuery() {
  return useQuery({
    queryKey: ['fixed-assets', 'balance-sheet-panel'],
    queryFn: () => apiGet<FixedAssetsPayload>('/api/fixed-assets?status=active&limit=12'),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

function MiniInfoCard({
  title,
  value,
  subtitle,
  icon: Icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-slate-500">{title}</div>
          <div className="mt-1 text-xl font-bold text-slate-900 tabular-nums">{value}</div>
          <div className="mt-1 text-xs text-slate-500">{subtitle}</div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}
