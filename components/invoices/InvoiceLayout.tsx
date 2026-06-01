'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TrendingUp, ShoppingCart } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Shared chrome for the unified Invoices section.
 *
 * Renders the page title + tab strip with three entries:
 *   - Overview     /invoices
 *   - Sales        /invoices/sales
 *   - Purchases    /invoices/purchases
 *
 * Each invoice page wraps its filters / KPIs / tables in this layout so
 * navigation stays consistent across the whole `/invoices/*` tree.
 */

const TABS = [
  { href: '/invoices/sales',     title: 'فواتير المبيعات',  icon: TrendingUp },
  { href: '/invoices/purchases', title: 'فواتير المشتريات', icon: ShoppingCart },
];

export function InvoiceLayout({
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
        {toolbar && <div className="flex items-center gap-2 flex-wrap">{toolbar}</div>}
      </div>

      <div className="neo-raised rounded-2xl p-2 flex gap-1.5 overflow-x-auto">
        {TABS.map(t => {
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
