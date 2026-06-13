'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Scale,
  WalletCards,
  CreditCard,
  BookOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Tabs for the unified `/accounting/*` section.
 *
 * Mirrors the structure of `components/reports/ReportLayout.tsx` so the
 * accounting and reports sections share the same look-and-feel.
 */
const ACCOUNTING_TABS = [
  { href: '/accounting',                title: 'لوحة المحاسبة',      icon: LayoutDashboard },
  { href: '/accounting/treasury',        title: 'الخزنة',           icon: WalletCards },
  { href: '/accounting/payments',        title: 'المدفوعات',        icon: CreditCard },
  { href: '/accounting/balance-sheet',   title: 'الميزانية العمومية', icon: BookOpen },
  { href: '/accounting/trial-balance',   title: 'ميزان المراجعة',   icon: Scale },
] as const;

/**
 * Shared chrome for the accounting sub-pages.
 *
 * Renders the page title + the five-tab strip. Each accounting page wraps
 * its filters / KPIs / tables in this layout so navigation stays
 * consistent across `/accounting/*` routes.
 */
export function AccountingLayout({
  title,
  subtitle,
  toolbar,
  children,
}: {
  title: string;
  subtitle?: string;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
        </div>
        {toolbar && <div className="flex items-center gap-2">{toolbar}</div>}
      </div>

      {/* Tab strip */}
      <div className="neo-raised rounded-2xl p-2 flex gap-1.5 overflow-x-auto">
        {ACCOUNTING_TABS.map(t => {
          const active = t.href === '/accounting'
            ? pathname === '/accounting'
            : pathname === t.href || pathname?.startsWith(t.href + '/');
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                'flex-1 min-w-[120px] flex items-center gap-2 justify-center px-4 py-2.5 rounded-lg text-sm transition-all',
                active
                  ? 'neo-inset text-indigo-700 font-semibold'
                  : 'text-slate-600 hover:text-indigo-700 hover:bg-slate-100/70',
              )}
            >
              <Icon className="w-4 h-4" />
              {t.title}
            </Link>
          );
        })}
      </div>

      {children}
    </div>
  );
}

/**
 * Common KPI card. Re-exported here so accounting pages don't need to
 * reach into `components/reports/*`. Same visual contract as
 * `components/reports/ReportLayout.tsx#KpiCard`.
 */
export function KpiCard({
  title,
  value,
  subtitle,
  trend,
  icon: Icon,
  color = 'blue',
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: number;
  icon?: React.ComponentType<{ className?: string }>;
  color?: 'blue' | 'green' | 'red' | 'amber' | 'purple' | 'slate';
}) {
  const palette: Record<string, { tile: string; ring: string; glow: string }> = {
    blue:   { tile: 'bg-indigo-600 text-white',                                   ring: 'ring-indigo-100',     glow: 'shadow-indigo-500/10' },
    green:  { tile: 'bg-green-600 text-white',                                    ring: 'ring-green-100', glow: 'shadow-green-500/15' },
    red:    { tile: 'bg-gradient-to-br from-rose-500 to-red-600 text-white',        ring: 'ring-rose-100',    glow: 'shadow-rose-500/15' },
    amber:  { tile: 'bg-gradient-to-br from-amber-400 to-orange-500 text-white',    ring: 'ring-amber-100',   glow: 'shadow-amber-500/15' },
    purple: { tile: 'bg-violet-600 text-white',                                      ring: 'ring-violet-100',    glow: 'shadow-violet-500/15' },
    slate:  { tile: 'bg-slate-700 text-white',                                     ring: 'ring-slate-100',   glow: 'shadow-slate-500/10' },
  };
  const p = palette[color];
  return (
    <div className={cn(
      'relative neo-raised rounded-2xl p-4 transition-all',
      'hover:translate-y-[-1px]',
      p.glow,
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide truncate">{title}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums">{value}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
          {trend != null && (
            <p className={cn('text-xs mt-1.5 font-semibold inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md',
              trend > 0 ? 'text-emerald-700 bg-emerald-50'
                : trend < 0 ? 'text-rose-700 bg-rose-50'
                : 'text-slate-600 bg-slate-100')}>
              {trend > 0 ? '▲' : trend < 0 ? '▼' : '—'} {Math.abs(trend).toFixed(1)}%
            </p>
          )}
        </div>
        {Icon && (
          <div className={cn('w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 ring-4', p.tile, p.ring)}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
    </div>
  );
}
