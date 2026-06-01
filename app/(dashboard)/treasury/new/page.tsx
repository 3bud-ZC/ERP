'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Save, WalletCards } from 'lucide-react';

export default function NewCashboxPage() {
  const router = useRouter();
  const pathname = usePathname();
  const basePath = pathname?.startsWith('/accounting/treasury') ? '/accounting/treasury' : '/treasury';
  const [form, setForm] = useState({ name: '', code: '', openingBalance: '0', currency: 'EGP', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('اسم الخزنة مطلوب');
    setSaving(true);
    try {
      const res = await fetch('/api/cashboxes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          code: form.code.trim() || undefined,
          openingBalance: Number(form.openingBalance || 0),
          currency: form.currency,
          notes: form.notes.trim() || undefined,
        }),
      });
      const j = await res.json();
      if (j.success) {
        router.push(basePath);
        router.refresh();
      }
      else setError(j.message || j.error || 'فشل حفظ الخزنة');
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
            <WalletCards className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">إضافة خزنة</h1>
            <p className="text-sm text-slate-500 mt-1">الكود اختياري ويُولَّد تلقائياً عند الحفظ.</p>
          </div>
        </div>
        <Link href={basePath} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
          <ArrowRight className="h-4 w-4" /> العودة
        </Link>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="اسم الخزنة" required value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="الخزنة الرئيسية" />
          <Field label="الكود" value={form.code} onChange={v => setForm(f => ({ ...f, code: v }))} placeholder="يُولَّد تلقائياً مثل CB-2026-00001" />
          <Field label="الرصيد الافتتاحي" type="number" value={form.openingBalance} onChange={v => setForm(f => ({ ...f, openingBalance: v }))} />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">العملة</label>
            <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} className={inputCls}>
              <option value="EGP">جنيه مصري</option>
              <option value="USD">دولار</option>
              <option value="SAR">ريال سعودي</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">ملاحظات</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} className={inputCls} />
          </div>
        </div>
        <div className="flex justify-end">
          <button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60">
            <Save className="h-4 w-4" /> {saving ? 'جاري الحفظ...' : 'حفظ الخزنة'}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white';

function Field({ label, value, onChange, placeholder, type = 'text', required = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}{required && ' *'}</label>
      <input type={type} required={required} min={type === 'number' ? '0' : undefined} step={type === 'number' ? '0.01' : undefined}
        value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
    </div>
  );
}
