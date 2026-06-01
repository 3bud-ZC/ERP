'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRightLeft, RefreshCw } from 'lucide-react';
import { fmtMoney } from '@/components/invoices/InvoiceConfig';

interface Cashbox {
  id: string;
  code: string;
  name: string;
  currentBalance: number;
  currency: string;
  status: string;
}

export default function TreasuryTransfersPage() {
  const [cashboxes, setCashboxes] = useState<Cashbox[]>([]);
  const [form, setForm] = useState({ fromCashboxId: '', toCashboxId: '', amount: '', description: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    const res = await fetch('/api/cashboxes?status=active', { credentials: 'include', cache: 'no-store' });
    const json = await res.json();
    setCashboxes(json.success ? json.data ?? [] : []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/cashboxes/transfers', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: Number(form.amount) }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || json.error || 'فشل تحويل المبلغ');
      setMessage('تم تحويل المبلغ بين الخزن وتسجيل القيد المحاسبي بنجاح');
      setForm({ fromCashboxId: '', toCashboxId: '', amount: '', description: '' });
      await load();
    } catch (err: any) {
      setError(err?.message || 'تعذر الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div>
        <div className="text-xs text-slate-500 mb-1">المحاسبة &gt; الخزنة &gt; التحويلات</div>
        <h1 className="text-2xl font-bold text-slate-900">تحويل بين الخزن</h1>
        <p className="text-sm text-slate-500 mt-1">تحويل نقدية من خزنة إلى أخرى مع حركة وارد/منصرف وقيد يومية متوازن.</p>
      </div>

      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-4 md:grid-cols-3">
        {cashboxes.map((box) => (
          <div key={box.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="font-bold text-slate-900">{box.name}</div>
            <div className="text-xs text-slate-500">{box.code} · {box.currency}</div>
            <div className="mt-3 text-xl font-black text-slate-950">{fmtMoney(box.currentBalance)}</div>
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="من خزنة">
            <select required value={form.fromCashboxId} onChange={(e) => setForm({ ...form, fromCashboxId: e.target.value })} className={inputCls}>
              <option value="">اختر خزنة المصدر</option>
              {cashboxes.map((box) => <option key={box.id} value={box.id}>{box.name} - {fmtMoney(box.currentBalance)}</option>)}
            </select>
          </Field>
          <Field label="إلى خزنة">
            <select required value={form.toCashboxId} onChange={(e) => setForm({ ...form, toCashboxId: e.target.value })} className={inputCls}>
              <option value="">اختر خزنة الوجهة</option>
              {cashboxes.map((box) => <option key={box.id} value={box.id}>{box.name}</option>)}
            </select>
          </Field>
          <Field label="المبلغ">
            <input required min="0.01" step="0.01" type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputCls} />
          </Field>
          <Field label="ملاحظة">
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputCls} placeholder="مثال: تحويل للخزنة الرئيسية" />
          </Field>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button disabled={saving || loading} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
            تنفيذ التحويل
          </button>
          <Link href="/accounting/treasury/transactions" className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">حركات الخزنة</Link>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1 text-sm font-semibold text-slate-700">{label}{children}</label>;
}

const inputCls = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';

