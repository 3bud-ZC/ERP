'use client';

import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  posted: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  paid: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  partial: 'bg-sky-50 text-sky-800 border-sky-200',
  unpaid: 'bg-orange-50 text-orange-800 border-orange-200',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
  reversed: 'bg-purple-50 text-purple-800 border-purple-200',
  credited: 'bg-violet-50 text-violet-800 border-violet-200',
  approved: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};

export function DocumentStatusBadge({
  status,
  label,
  className,
}: {
  status?: string | null;
  label?: string;
  className?: string;
}) {
  const key = (status ?? 'draft').toLowerCase();
  const style = STATUS_STYLES[key] ?? STATUS_STYLES.draft;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        style,
        className,
      )}
    >
      {label ?? status ?? '—'}
    </span>
  );
}
