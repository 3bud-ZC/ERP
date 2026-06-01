'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight, AlertCircle, Save } from 'lucide-react';

/**
 * EntityFormPage
 * --------------
 * Shared chrome for any "create / edit" entity page (customer, supplier,
 * product, warehouse, journal entry, expense, stock-adjustment, …).
 *
 * Mirrors the layout used by the sales/purchase invoice creation page so
 * every CRUD form across the app feels identical:
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │ ⟵ العودة للقائمة   │   icon  العنوان              │
 *   │                    │         الـ subtitle          │
 *   ├──────────────────────────────────────────────────────┤
 *   │ <error banner if any>                                │
 *   │ <Section> الحقول… </Section>                          │
 *   │ <Section> الحقول… </Section>                          │
 *   ├──────────────────────────────────────────────────────┤
 *   │  [إلغاء]                              [حفظ الكيان]   │
 *   └──────────────────────────────────────────────────────┘
 *
 * The component is intentionally _layout only_ — children pass their own
 * `<Section>` cards (`@/components/ui/modal`) and form state.
 */

interface EntityFormPageProps {
  /** Big page title, e.g. "إنشاء عميل جديد". */
  title: string;
  /** Smaller helper text under the title. */
  subtitle?: string;
  /** Where the "العودة للقائمة" link should point. */
  backHref: string;
  backLabel?: string;
  /** Icon shown inside the gradient tile in the header. */
  icon?: React.ReactNode;
  /** Optional badge shown next to the title (e.g. status pill on edit). */
  badge?: React.ReactNode;
  /** Inline error message rendered above the form. */
  error?: string | null;
  /** Whether the primary action is currently saving. */
  saving?: boolean;
  /** Form ID — primary submit button is wired via this id. */
  formId: string;
  /** Primary submit-button label (defaults to "حفظ"). */
  primaryLabel?: string;
  /** Disabled state for the primary button. */
  primaryDisabled?: boolean;
  /** Optional secondary action shown next to "إلغاء". */
  secondary?: React.ReactNode;
  children: React.ReactNode;
}

export function EntityFormPage({
  title,
  subtitle,
  backHref,
  backLabel = 'العودة للقائمة',
  icon,
  badge,
  error,
  saving,
  formId,
  primaryLabel = 'حفظ',
  primaryDisabled,
  secondary,
  children,
}: EntityFormPageProps) {
  return (
    <div className="space-y-5 pb-24" dir="rtl">
      <div className="overflow-hidden rounded-2xl neo-raised">
        <div className="flex flex-col gap-4 neo-header-gradient px-5 py-5 text-white sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            {icon && (
              <div className="w-11 h-11 rounded-xl bg-white/12 text-white ring-1 ring-white/30 flex items-center justify-center shadow-md shadow-indigo-900/25 flex-shrink-0">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold text-white">{title}</h1>
                {badge}
              </div>
              {subtitle && (
                <p className="text-sm text-slate-300 mt-1">{subtitle}</p>
              )}
            </div>
          </div>

          <Link
            href={backHref}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/15"
          >
            <ArrowRight className="w-4 h-4" /> {backLabel}
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-0 border-t border-slate-200/70 bg-slate-100/50 text-xs text-slate-600 sm:grid-cols-4">
          <div className="border-l border-slate-200/70 px-4 py-3">
            <span className="block font-semibold text-slate-700">الحالة</span>
            <span>{saving ? 'جاري الحفظ' : 'جاهز للإدخال'}</span>
          </div>
          <div className="border-l border-slate-200/70 px-4 py-3">
            <span className="block font-semibold text-slate-700">النمط</span>
            <span>تشغيلي RTL</span>
          </div>
          <div className="border-l border-slate-200/70 px-4 py-3">
            <span className="block font-semibold text-slate-700">الأكواد</span>
            <span>تلقائية عند الحفظ</span>
          </div>
          <div className="px-4 py-3">
            <span className="block font-semibold text-slate-700">المراجعة</span>
            <span>حقول مرتبة حسب القسم</span>
          </div>
        </div>
      </div>

      {/* Inline error banner */}
      {error && (
        <div className="flex items-center gap-2 text-red-700 text-sm bg-red-50 border border-red-200 rounded-[10px] px-4 py-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Body — sectioned cards live here */}
      <div className="space-y-5">{children}</div>

      {/* Sticky footer */}
      <div
        className="fixed bottom-0 inset-x-0 lg:start-64 bg-[#e8eaf0]/95 backdrop-blur border-t border-slate-200/80 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 z-30"
        dir="rtl"
      >
        <div className="text-xs text-slate-500 hidden sm:block">احفظ التغييرات بعد مراجعة البيانات الأساسية والتواصل.</div>
        <div className="flex items-center gap-2">
          <Link
            href={backHref}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
          >
            إلغاء
          </Link>

          {secondary}

          <button
            type="submit"
            form={formId}
            disabled={saving || primaryDisabled}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-indigo-700 neo-raised hover:text-indigo-800 active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4" />
            {saving ? 'جاري الحفظ…' : primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
