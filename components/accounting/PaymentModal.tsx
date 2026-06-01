'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Save, WalletCards } from 'lucide-react';
import { apiGetList } from '@/lib/api/fetcher';

interface Cashbox {
  id: string;
  name: string;
  currency: string;
}

export function PaymentModal({
  isOpen,
  onClose,
  defaultAmount,
  invoiceId,
  supplierId,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  defaultAmount: number;
  invoiceId?: string;
  supplierId?: string;
  onSuccess: () => void;
}) {
  const [amount, setAmount] = useState(defaultAmount.toString());
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [cashboxId, setCashboxId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { data: cashboxes, isLoading } = useQuery({
    queryKey: ['cashboxes', 'active'],
    queryFn: () => apiGetList<Cashbox>('/api/cashboxes'),
    enabled: isOpen,
  });

  if (!isOpen) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) return setError('المبلغ يجب أن يكون أكبر من صفر');
    if (!cashboxId) return setError('يجب اختيار الخزنة');

    setSaving(true);
    try {
      const payload: any = {
        amount: numAmount,
        date,
        type: 'outgoing',
        cashboxId,
        notes: notes.trim() || undefined,
        supplierId,
        purchaseInvoiceId: invoiceId,
        allocations: [],
      };

      if (invoiceId) {
        payload.allocations.push({
          invoiceId,
          invoiceType: 'purchase',
          amount: numAmount,
        });
      }

      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const j = await res.json();
      if (j.success) {
        onSuccess();
        onClose();
      } else {
        setError(j.message || j.error || 'فشل حفظ الدفعة');
      }
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" dir="rtl">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl ring-1 ring-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <WalletCards className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">سداد دفعة</h2>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">المبلغ</label>
            <input
              type="number"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">التاريخ</label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">الخزنة</label>
            <select
              required
              value={cashboxId}
              onChange={(e) => setCashboxId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">اختر الخزنة...</option>
              {cashboxes?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.currency})
                </option>
              ))}
            </select>
            {isLoading && <p className="text-xs text-slate-500 mt-1">جاري تحميل الخزن...</p>}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">ملاحظات (اختياري)</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="pt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> {saving ? 'جاري السداد...' : 'تأكيد السداد'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
