'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { useToast, Toast } from '@/components/ui/patterns';
import { Field, Section, FieldGrid, SelectField } from '@/components/ui/modal';
import { EntityFormPage } from '@/components/forms/EntityFormPage';
import { AutoCodeField } from '@/components/forms/AutoCodeField';
import { queryKeys } from '@/lib/api/query-keys';

export interface CustomerExisting {
  id:           string;
  code:         string;
  nameAr:       string;
  nameEn?:      string | null;
  email?:       string | null;
  phone?:       string | null;
  creditLimit?: number | null;
  openingBalanceType?: string | null;
  openingBalanceAmount?: number | null;
  openingBalanceDate?: string | null;
}

const empty = { nameAr: '', nameEn: '', email: '', phone: '', creditLimit: '', openingBalanceType: '', openingBalanceAmount: '', openingBalanceDate: new Date().toISOString().slice(0, 10) };

/**
 * Full-page customer create / edit form.
 *
 * Mirrors the visual layout of the sales-invoice creation page so every
 * "إضافة عميل / تعديل عميل" feels identical.
 */
export function CustomerForm({
  mode,
  existing,
}: {
  mode:      'create' | 'edit';
  existing?: CustomerExisting;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const [toast, showToast] = useToast();

  const [form, setForm] = useState(() =>
    existing
      ? {
          nameAr:      existing.nameAr,
          nameEn:      existing.nameEn ?? '',
          email:       existing.email ?? '',
          phone:       existing.phone ?? '',
          creditLimit: existing.creditLimit != null ? String(existing.creditLimit) : '',
          openingBalanceType: existing.openingBalanceType ?? '',
          openingBalanceAmount: existing.openingBalanceAmount != null ? String(existing.openingBalanceAmount) : '',
          openingBalanceDate: existing.openingBalanceDate ? new Date(existing.openingBalanceDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        }
      : empty,
  );

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.nameAr.trim()) return setError('الاسم بالعربية مطلوب');

    setSaving(true);
    try {
      const payload =
        mode === 'create'
          ? {
              nameAr:      form.nameAr.trim(),
              ...(form.nameEn   && { nameEn:   form.nameEn.trim() }),
              ...(form.email    && { email:    form.email.trim() }),
              ...(form.phone    && { phone:    form.phone.trim() }),
              ...(form.creditLimit && { creditLimit: Number(form.creditLimit) }),
              ...(form.openingBalanceType && { openingBalanceType: form.openingBalanceType }),
              ...(form.openingBalanceAmount && { openingBalanceAmount: Number(form.openingBalanceAmount) }),
              ...(form.openingBalanceAmount && { openingBalanceDate: form.openingBalanceDate }),
            }
          : {
              id:          existing!.id,
              nameAr:      form.nameAr.trim(),
              nameEn:      form.nameEn.trim() || null,
              email:       form.email.trim()  || null,
              phone:       form.phone.trim()  || null,
              creditLimit: form.creditLimit ? Number(form.creditLimit) : null,
              openingBalanceType: form.openingBalanceType || null,
              openingBalanceAmount: form.openingBalanceAmount ? Number(form.openingBalanceAmount) : 0,
              openingBalanceDate: form.openingBalanceAmount ? form.openingBalanceDate : null,
            };

      const res = await fetch('/api/customers', {
        method:      mode === 'create' ? 'POST' : 'PUT',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify(payload),
      });
      const j = await res.json();

      if (j.success) {
        qc.invalidateQueries({ queryKey: queryKeys.customers });
        showToast(mode === 'create' ? 'تم إضافة العميل بنجاح' : 'تم تحديث بيانات العميل', 'success');
        // Small delay so the toast is visible before navigation.
        setTimeout(() => router.push('/customers'), 600);
      } else {
        setError(j.message || j.error || 'فشل الحفظ');
        setSaving(false);
      }
    } catch {
      setError('تعذر الاتصال بالخادم');
      setSaving(false);
    }
  }

  return (
    <>
      <Toast toast={toast} />

      <EntityFormPage
        title={mode === 'create' ? 'إنشاء عميل جديد' : 'تعديل بيانات العميل'}
        subtitle={
          mode === 'create'
            ? 'أدخل بيانات العميل في الأقسام التالية'
            : existing?.nameAr
        }
        backHref="/customers"
        icon={<Users className="w-5 h-5" />}
        error={error}
        saving={saving}
        formId="customer-form"
        primaryLabel={mode === 'create' ? 'حفظ العميل' : 'حفظ التعديلات'}
      >
        <form id="customer-form" onSubmit={handleSubmit} className="space-y-5">
          <Section title="البيانات الأساسية" subtitle="الاسم وحد الائتمان">
            <FieldGrid>
              <AutoCodeField mode={mode} value={existing?.code} />
              <Field
                label="حد الائتمان (ج.م)"
                type="number"
                min="0"
                value={form.creditLimit}
                placeholder="0"
                onChange={e => setForm(f => ({ ...f, creditLimit: e.target.value }))}
              />
              <Field
                label="الاسم بالعربية"
                required
                value={form.nameAr}
                placeholder="شركة الأمل"
                className="sm:col-span-2"
                onChange={e => setForm(f => ({ ...f, nameAr: e.target.value }))}
              />
              <Field
                label="الاسم بالإنجليزية"
                value={form.nameEn}
                placeholder="Al Amal Company (اختياري)"
                className="sm:col-span-2"
                onChange={e => setForm(f => ({ ...f, nameEn: e.target.value }))}
              />
            </FieldGrid>
          </Section>

          <Section title="بيانات التواصل" subtitle="الهاتف والبريد الإلكتروني">
            <FieldGrid>
              <Field
                label="الهاتف"
                value={form.phone}
                placeholder="0501234567"
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              />
              <Field
                label="البريد الإلكتروني"
                type="email"
                value={form.email}
                placeholder="info@co.com"
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              />
            </FieldGrid>
          </Section>

          <Section title="الرصيد الافتتاحي" subtitle="اختياري، ويتم ترحيله محاسبيًا عند الحفظ">
            <FieldGrid>
              <SelectField
                label="نوع الرصيد"
                value={form.openingBalanceType}
                onChange={e => setForm(f => ({ ...f, openingBalanceType: e.target.value }))}
              >
                <option value="">بدون رصيد افتتاحي</option>
                <option value="customer_owes_us">مستحق على العميل</option>
                <option value="we_owe_customer">رصيد دائن للعميل</option>
              </SelectField>
              <Field
                label="قيمة الرصيد (ج.م)"
                type="number"
                min="0"
                step="0.01"
                value={form.openingBalanceAmount}
                placeholder="0"
                onChange={e => setForm(f => ({ ...f, openingBalanceAmount: e.target.value }))}
              />
              <Field
                label="تاريخ الرصيد"
                type="date"
                value={form.openingBalanceDate}
                onChange={e => setForm(f => ({ ...f, openingBalanceDate: e.target.value }))}
              />
            </FieldGrid>
          </Section>
        </form>
      </EntityFormPage>
    </>
  );
}
