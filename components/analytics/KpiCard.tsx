'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export function KpiCard({
  title,
  value,
  hint,
  icon,
  tone = 'slate',
}: {
  title: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  tone?: 'slate' | 'emerald' | 'red' | 'amber' | 'blue';
}) {
  const toneCls = {
    slate: 'text-slate-600 bg-slate-50',
    emerald: 'text-emerald-700 bg-emerald-50',
    red: 'text-red-700 bg-red-50',
    amber: 'text-amber-700 bg-amber-50',
    blue: 'text-blue-700 bg-blue-50',
  }[tone];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-500">{title}</div>
        {icon && <div className={cn('rounded-md p-2', toneCls)}>{icon}</div>}
      </div>
      <div className="mt-2 text-xl font-black text-slate-950 tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

