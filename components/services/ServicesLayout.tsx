'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Users, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Tabs for the unified `/services` section (customers + suppliers).
 *
 * Mirrors `components/accounting/AccountingLayout.tsx` so the two sections
 * feel like a matched set. The actual customer/supplier pages still live
 * at their original `/customers` and `/suppliers` URLs (a lot of internal
 * links point there); this layout just wraps them under a shared chrome.
 */
const SERVICES_TABS = [
  { href: '/customers', title: 'العملاء',    icon: Users },
  { href: '/suppliers', title: 'الموردون',   icon: Building2 },
] as const;

export function ServicesLayout({
  title,
  subtitle,
  toolbar,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
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

      <div className="neo-raised rounded-2xl p-2 flex gap-1.5 overflow-x-auto">
        {SERVICES_TABS.map(t => {
          const active = pathname === t.href || pathname?.startsWith(t.href + '/');
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                'flex-1 min-w-[140px] flex items-center gap-2 justify-center px-4 py-2.5 rounded-lg text-sm transition-all',
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
