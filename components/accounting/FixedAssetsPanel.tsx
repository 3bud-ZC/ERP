'use client';

import type { ComponentType, FormEvent } from 'react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Landmark, Plus, RefreshCw } from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api/fetcher';
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

interface AccountOption {
  id: string;
  code: string;
  nameAr: string;
  nameEn?: string | null;
  type: string;
  subType?: string | null;
}

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
  usefulLife: '60',
  salvageValue: '0',
  accountCode: '',
  creditAccountCode: '1010',
  notes: '',
};

export function FixedAssetsPanel({
  onCreated,
}: {
  onCreated: () => Promise<unknown> | unknown;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, showToast] = useToast();

  const assetsQuery = useFixedAssetsQuery();
  const accountsQuery = useAccountsQuery();

  const assetAccounts = useMemo(() => {
    return (accountsQuery.data ?? []).filter((account) => {
      const type = String(account.type || '').toLowerCase();
      const subtype = String(account.subType || '').toLowerCase();
      const name = String(account.nameAr || '').toLowerCase();
      return type === 'asset' && (
        subtype.includes('fixed') ||
        name.includes('أصل') ||
        account.code.startsWith('14') ||
        account.code.startsWith('104')
      );
    });
  }, [accountsQuery.data]);

  const fundingAccounts = useMemo(() => {
    return (accountsQuery.data ?? []).filter((account) => {
      const type = String(account.type || '').toLowerCase();
      return ['asset', 'liability', 'equity'].includes(type);
    });
  }, [accountsQuery.data]);

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
  const canCreateAsset = assetAccounts.length > 0 && fundingAccounts.length > 0;

  function openCreateModal() {
    const defaultAssetAccount =
      assetAccounts.find((account) => account.code === form.accountCode)?.code ||
      assetAccounts[0]?.code ||
      '';
    const defaultFundingAccount =
      fundingAccounts.find((account) => account.code === form.creditAccountCode)?.code ||
      fundingAccounts.find((account) => account.code === '1010')?.code ||
      fundingAccounts[0]?.code ||
      '';

    setForm((current) => ({
      ...DEFAULT_FORM,
      category: current.category,
      accountCode: defaultAssetAccount,
      creditAccountCode: defaultFundingAccount,
    }));
    setFormError(null);
    setOpen(true);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);

    try {
      const categoryLabel = CATEGORY_OPTIONS.find((item) => item.value === form.category)?.label ?? 'أصول أخرى';
      const assetName = `${categoryLabel} - ${form.name.trim()}`;
      const description = [
        `تصنيف الأصل: ${categoryLabel}`,
        form.notes.trim() ? `ملاحظات: ${form.notes.trim()}` : null,
      ].filter(Boolean).join('\n');

      await apiPost('/api/fixed-assets', {
        name: assetName,
        description,
        accountCode: form.accountCode,
        creditAccountCode: form.creditAccountCode,
        purchaseDate: form.purchaseDate,
        purchaseCost: Number(form.purchaseCost),
        usefulLife: Number(form.usefulLife),
        salvageValue: Number(form.salvageValue || 0),
        depreciationMethod: 'straight_line',
      });

      setOpen(false);
      setForm(DEFAULT_FORM);
      await Promise.all([assetsQuery.refetch(), Promise.resolve(onCreated())]);
      showToast('تم تسجيل الأصل الثابت وترحيل أثره المحاسبي', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذر حفظ الأصل الثابت';
      setFormError(message);
      showToast(message, 'error');
    } finally {
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
              disabled={!canCreateAsset || accountsQuery.isLoading}
            >
              <Plus className="h-4 w-4" />
              إضافة أصل ثابت
            </button>
          </div>
        </div>

        {!canCreateAsset && !accountsQuery.isLoading && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            لا توجد حسابات مناسبة للأصول الثابتة أو الحساب المقابل. راجع دليل الحسابات أولًا ثم أعد المحاولة.
          </div>
        )}

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
        title="إضافة أصل ثابت"
        subtitle="سيتم إنشاء الأصل وترحيل أثره المحاسبي فورًا"
        icon={<Building2 className="h-5 w-5" />}
        footer={
          <>
            <SecondaryButton onClick={() => setOpen(false)} disabled={submitting}>إلغاء</SecondaryButton>
            <PrimaryButton type="submit" form="fixed-asset-form" disabled={submitting}>
              {submitting ? 'جاري الحفظ...' : 'حفظ الأصل'}
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

            <Field
              label="العمر المحاسبي (بالشهور)"
              type="number"
              min="1"
              step="1"
              value={form.usefulLife}
              onChange={(e) => setForm((current) => ({ ...current, usefulLife: e.target.value }))}
              required
            />

            <Field
              label="القيمة التخريدية"
              type="number"
              min="0"
              step="0.01"
              value={form.salvageValue}
              onChange={(e) => setForm((current) => ({ ...current, salvageValue: e.target.value }))}
            />

            <SelectField
              label="حساب الأصل"
              value={form.accountCode}
              onChange={(e) => setForm((current) => ({ ...current, accountCode: e.target.value }))}
              required
            >
              <option value="">اختر حساب الأصل</option>
              {assetAccounts.map((account) => (
                <option key={account.id} value={account.code}>
                  {account.code} - {account.nameAr}
                </option>
              ))}
            </SelectField>

            <SelectField
              label="الحساب المقابل / مصدر التمويل"
              value={form.creditAccountCode}
              onChange={(e) => setForm((current) => ({ ...current, creditAccountCode: e.target.value }))}
              required
            >
              <option value="">اختر الحساب المقابل</option>
              {fundingAccounts.map((account) => (
                <option key={account.id} value={account.code}>
                  {account.code} - {account.nameAr}
                </option>
              ))}
            </SelectField>
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
    staleTime: 0,
  });
}

function useAccountsQuery() {
  return useQuery({
    queryKey: ['accounts', 'fixed-assets-panel'],
    queryFn: () => apiGet<AccountOption[]>('/api/accounts'),
    staleTime: 0,
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
