'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth';
import {
  PieChart, TrendingUp, ShoppingCart, Package, BookOpen, Users, Truck,
  Clock, Receipt, Factory, CreditCard, TriangleAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { REPORT_TABS, hasReportAccess, type ReportKey } from '@/lib/reports/report-access';

/**
 * Tabs for the unified `/reports` (التقارير) section. Mirrors the look of
 * `InventoryLayout` / `ManufacturingLayout`. Hidden when printing via the
 * `no-print` class.
 */
const ALL_TABS = [
  { href: '/reports',                      title: 'نظرة عامة',         icon: PieChart },
  { href: '/reports/sales',                title: 'المبيعات',           icon: TrendingUp },
  { href: '/reports/purchases',            title: 'المشتريات',          icon: ShoppingCart },
  { href: '/reports/inventory',            title: 'المخازن',            icon: Package },
  { href: '/reports/waste',                title: 'الفاقد',             icon: TriangleAlert },
  { href: '/reports/expenses',             title: 'المصروفات',          icon: Receipt },
  { href: '/reports/customer-statement',   title: 'كشف عميل',          icon: Users },
  { href: '/reports/supplier-statement',   title: 'كشف مورد',          icon: Truck },
  { href: '/reports/receivables',           title: 'مديونيات العملاء',   icon: CreditCard },
  { href: '/reports/payables',              title: 'مستحقات الموردين',   icon: CreditCard },
  { href: '/reports/aging',                title: 'الأعمار',             icon: Clock },
  { href: '/reports/profit-loss',          title: 'قائمة الدخل',         icon: BookOpen },
  { href: '/reports/balance-sheet',        title: 'الميزانية',           icon: BookOpen },
  { href: '/reports/manufacturing',        title: 'التصنيع',            icon: Factory },
] as const;

const TAB_KEY_BY_HREF = Object.fromEntries(REPORT_TABS.map((tab) => [tab.href, tab.key])) as Record<string, ReportKey>;

export function ReportsLayout({
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
  const { user } = useAuthStore();
  const tabs = ALL_TABS.filter((tab) => hasReportAccess(user, TAB_KEY_BY_HREF[tab.href]));

  return (
    <div className="space-y-5 print-area" dir="rtl">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
        </div>
        {toolbar && <div className="flex items-center gap-2 flex-wrap no-print">{toolbar}</div>}
      </div>

      <div className="neo-raised rounded-2xl p-2 flex gap-1.5 overflow-x-auto no-print">
        {tabs.map(t => {
          const active =
            t.href === '/reports'
              ? pathname === '/reports'
              : pathname === t.href || pathname?.startsWith(t.href + '/');
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                'flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm transition-all',
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
