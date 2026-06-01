'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  Database,
  Download,
  ShieldAlert,
  Building2,
  Users,
  Clock3,
} from 'lucide-react';
import { Toast, useToast } from '@/components/ui/patterns';
import { apiGet } from '@/lib/api/fetcher';

type SettingsOverview = {
  tenant: {
    id: string;
    tenantCode: string;
    name: string;
    nameAr?: string | null;
    status: string;
    subscriptionPlan: string;
    createdAt: string;
    updatedAt: string;
  };
  usersCount: number;
  activeSessions: number;
  canReset: boolean;
  lastActivity?: { createdAt: string; action: string; module: string } | null;
  serverTime: string;
};

type ResetPreview = {
  tenant: { tenantCode: string; name: string; nameAr?: string | null };
  preview: {
    products: number;
    customers: number;
    suppliers: number;
    warehouses: number;
    salesInvoices: number;
    purchaseInvoices: number;
    payments: number;
    cashboxes: number;
    cashboxTransactions: number;
    expenses: number;
    journalEntries: number;
    inventoryTransactions: number;
    productionOrders: number;
  };
};

export default function SettingsPage() {
  const [toast, showToast] = useToast();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<SettingsOverview | null>(null);
  const [preview, setPreview] = useState<ResetPreview | null>(null);
  const [resetting, setResetting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setRefreshing(true);
    try {
      const [ov, pv] = await Promise.all([
        apiGet<SettingsOverview>('/api/settings/overview'),
        apiGet<ResetPreview>('/api/settings/reset').catch(() => null),
      ]);
      setOverview(ov);
      setPreview(pv);
    } catch (error: any) {
      showToast(error?.message || 'فشل تحميل الإعدادات', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetCode = useMemo(() => {
    const code = overview?.tenant?.tenantCode;
    if (!code) return '';
    return `RESET ${code}`;
  }, [overview?.tenant?.tenantCode]);

  async function handleBackup() {
    try {
      const res = await fetch('/api/settings/export', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.message || j?.error || 'فشل تصدير النسخة الاحتياطية');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('تم تحميل النسخة الاحتياطية بنجاح', 'success');
    } catch (error: any) {
      showToast(error?.message || 'فشل تصدير النسخة الاحتياطية', 'error');
    }
  }

  async function handleReset() {
    if (!overview?.canReset || !resetCode) return;
    const step1 = window.confirm('تحذير: سيتم حذف بيانات التشغيل الحالية للشركة (الفواتير، المخزون، المدفوعات...). هل تريد المتابعة؟');
    if (!step1) return;

    const typed = window.prompt(`للتأكيد، اكتب بالضبط:\n${resetCode}`);
    if (!typed) return;
    const seedAccounting = window.confirm('هل تريد إعادة تجهيز شجرة الحسابات تلقائيًا بعد التصفير؟');

    setResetting(true);
    try {
      const res = await fetch('/api/settings/reset', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmation: typed.trim(),
          seedAccounting,
        }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) throw new Error(j?.message || j?.error || 'فشل تصفير البيانات');
      showToast('تم تصفير بيانات الشركة بنجاح', 'success');
      await load();
    } catch (error: any) {
      showToast(error?.message || 'فشل تصفير البيانات', 'error');
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-6 pb-12" dir="rtl">
      <Toast toast={toast} />

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">الإعدادات</h1>
            <p className="text-sm text-slate-500 mt-1">
              إدارة بيانات الشركة، النسخ الاحتياطي، وتصفير البيانات بأمان.
            </p>
          </div>
          <button
            onClick={load}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            تحديث البيانات
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">جاري تحميل الإعدادات...</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <InfoCard
              icon={Building2}
              label="الشركة"
              value={overview?.tenant?.nameAr || overview?.tenant?.name || '—'}
              hint={overview?.tenant?.tenantCode || '—'}
            />
            <InfoCard
              icon={Users}
              label="المستخدمون"
              value={String(overview?.usersCount ?? 0)}
              hint={`جلسات نشطة: ${overview?.activeSessions ?? 0}`}
            />
            <InfoCard
              icon={Clock3}
              label="آخر تحديث"
              value={overview?.lastActivity ? new Date(overview.lastActivity.createdAt).toLocaleString('ar-EG') : '—'}
              hint={overview?.lastActivity ? `${overview.lastActivity.module} / ${overview.lastActivity.action}` : 'لا يوجد'}
            />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-slate-900">النسخ الاحتياطي</h2>
              <p className="text-sm text-slate-500 mt-1">حفظ نسخة JSON من بيانات الشركة على جهازك.</p>
              <button
                onClick={handleBackup}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <Download className="h-4 w-4" />
                Export / Backup Data
              </button>
            </section>

            <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-red-700">تصفير بيانات الشركة</h2>
              <p className="text-sm text-slate-600 mt-1">
                هذا الإجراء يحذف بيانات التشغيل (الفواتير، المخزون، المدفوعات، التصنيع...) ويُبقي الشركة والمستخدمين.
              </p>

              {preview?.preview && (
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <MiniCount label="المنتجات" value={preview.preview.products} />
                  <MiniCount label="العملاء" value={preview.preview.customers} />
                  <MiniCount label="الموردون" value={preview.preview.suppliers} />
                  <MiniCount label="فواتير البيع" value={preview.preview.salesInvoices} />
                  <MiniCount label="فواتير الشراء" value={preview.preview.purchaseInvoices} />
                  <MiniCount label="حركات الخزنة" value={preview.preview.cashboxTransactions} />
                </div>
              )}

              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                تأكيد التنفيذ مطلوب كتابة الكود: <span className="font-mono font-bold">{resetCode || '—'}</span>
              </div>

              <button
                onClick={handleReset}
                disabled={!overview?.canReset || resetting}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {resetting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
                Format / Reset Data
              </button>
              {!overview?.canReset && (
                <p className="mt-2 text-xs text-red-600">هذه العملية متاحة لمدير النظام داخل الشركة فقط.</p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{label}</span>
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-2 text-lg font-bold text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function MiniCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 flex items-center justify-between">
      <span className="text-slate-600">{label}</span>
      <span className="font-semibold tabular-nums text-slate-900">{value.toLocaleString('ar-EG')}</span>
    </div>
  );
}
