'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import {
  TrendingUp, ShoppingCart, Package, BookOpen, Users, Truck,
  Receipt, Factory, ChevronLeft, BarChart3, TriangleAlert, WalletCards,
} from 'lucide-react';
import { ReportsLayout } from '@/components/reports/ReportsLayout';
import { useAuthStore } from '@/lib/store/auth';
import { hasReportAccess, type ReportKey } from '@/lib/reports/report-access';

const REPORTS = [
  {
    key: 'sales',
    href: '/reports/sales', title: 'تقرير المبيعات',
    description: 'فواتير المبيعات حسب الفترة والعميل والمنتج',
    icon: TrendingUp, accent: 'bg-emerald-50 text-emerald-700',
  },
  {
    key: 'purchases',
    href: '/reports/purchases', title: 'تقرير المشتريات',
    description: 'فواتير المشتريات حسب الفترة والمورد',
    icon: ShoppingCart, accent: 'bg-emerald-50 text-emerald-600',
  },
  {
    key: 'inventory',
    href: '/reports/inventory', title: 'تقرير المخازن',
    description: 'أرصدة المخزون وقيمته وحدود إعادة الطلب',
    icon: Package, accent: 'bg-amber-50 text-amber-600',
  },
  {
    key: 'waste',
    href: '/reports/waste', title: 'تقرير الفاقد',
    description: 'يجمع فاقد أوامر الإنتاج وتسويات المخزون بدون تكرار',
    icon: TriangleAlert, accent: 'bg-rose-50 text-rose-700',
  },
  {
    key: 'expenses',
    href: '/reports/expenses', title: 'تقرير المصروفات',
    description: 'المصروفات حسب الفترة والتصنيف وطريقة الدفع',
    icon: Receipt, accent: 'bg-red-50 text-red-600',
  },
  {
    key: 'customer-statement',
    href: '/reports/customer-statement', title: 'كشف حساب عميل',
    description: 'فواتير ومدفوعات ورصيد عميل محدد',
    icon: Users, accent: 'bg-indigo-50 text-slate-700',
  },
  {
    key: 'supplier-statement',
    href: '/reports/supplier-statement', title: 'كشف حساب مورد',
    description: 'فواتير ومدفوعات ورصيد مورد محدد',
    icon: Truck, accent: 'bg-cyan-50 text-cyan-700',
  },
  {
    key: 'profit-loss',
    href: '/reports/profit-loss', title: 'قائمة الدخل',
    description: 'الإيرادات والمصروفات وصافي الربح للفترة',
    icon: BookOpen, accent: 'bg-cyan-50 text-cyan-600',
  },
  {
    key: 'balance-sheet',
    href: '/reports/balance-sheet', title: 'الميزانية العمومية',
    description: 'الأصول والخصوم وحقوق الملكية في تاريخ معين',
    icon: BarChart3, accent: 'bg-teal-50 text-teal-600',
  },
  {
    key: 'cashbox-print',
    href: '/reports/cashbox-print', title: 'تقارير الخزنة',
    description: 'حركة الخزنة والداخل والخارج والرصيد النهائي',
    icon: WalletCards, accent: 'bg-slate-100 text-slate-700',
  },
  {
    key: 'manufacturing',
    href: '/reports/manufacturing', title: 'تقرير التصنيع',
    description: 'أوامر الإنتاج، الفاقد، والتكاليف الصناعية',
    icon: Factory, accent: 'bg-pink-50 text-pink-600',
  },
];

export default function ReportsHubPage() {
  const { user } = useAuthStore();
  const visibleReports = useMemo(
    () => REPORTS.filter((report) => hasReportAccess(user, report.key as ReportKey)),
    [user],
  );

  return (
    <ReportsLayout
      title="التقارير"
      subtitle="اختر التقرير المناسب لاستعراضه أو طباعته"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleReports.map(r => (
          <Link key={r.href} href={r.href}
            className="group bg-white rounded-2xl shadow-sm border border-slate-200 hover:shadow-md hover:border-emerald-200 transition-all p-5 flex items-start gap-4"
          >
            <div className={`w-11 h-11 rounded-xl ${r.accent} flex items-center justify-center flex-shrink-0`}>
              <r.icon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-slate-900 group-hover:text-emerald-800 transition-colors">{r.title}</h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{r.description}</p>
            </div>
            <ChevronLeft className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 flex-shrink-0 mt-2" />
          </Link>
        ))}
      </div>
    </ReportsLayout>
  );
}
