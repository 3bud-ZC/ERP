'use client';

import Link from 'next/link';

export function AccountingQuickNav() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex items-center justify-between gap-3 flex-wrap" dir="rtl">
      <div className="text-sm font-semibold text-slate-700">اختصارات</div>
      <div className="flex items-center gap-2 flex-wrap">
        <Link className={pillCls} href="/accounting">لوحة التحكم</Link>
        <Link className={pillCls} href="/accounting/treasury">الخزنة</Link>
        <Link className={pillCls} href="/accounting/payments">المدفوعات</Link>
        <Link className={pillCls} href="/accounting/trial-balance">ميزان المراجعة</Link>
      </div>
    </div>
  );
}

const pillCls = 'rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50';
