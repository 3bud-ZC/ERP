'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/lib/store/auth';
import {
  LayoutDashboard,
  Package,
  Users,
  FileText,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  BookOpen,
  Factory,
  PieChart,
  ShieldCheck,
  Building2,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BRAND } from '@/lib/branding';

interface NavSubItem {
  title: string;
  href: string;
}

interface NavItem {
  title: string;
  /** Either a direct link or a parent for `children`. */
  href: string;
  icon: React.ReactNode;
  platformOnly?: boolean;
  requiredPermission?: string;
  /** When present, the item becomes a collapsible group. */
  children?: NavSubItem[];
}

const navItems: NavItem[] = [
  {
    title: 'Admin',
    href: '/admin',
    icon: <Building2 className="w-5 h-5" />,
    platformOnly: true,
  },
  {
    title: 'لوحة التحكم',
    href: '/dashboard',
    icon: <LayoutDashboard className="w-5 h-5" />,
    children: [
      { title: 'نظرة عامة', href: '/dashboard' },
    ],
  },
  {
    title: 'الخدمات',
    href: '/customers',
    icon: <Users className="w-5 h-5" />,
    children: [
      { title: 'العملاء',    href: '/customers' },
      { title: 'الموردون',   href: '/suppliers' },
    ],
  },
  {
    title: 'المخازن',
    href: '/inventory/raw-materials',
    icon: <Package className="w-5 h-5" />,
    children: [
      { title: 'مواد خام',        href: '/inventory/raw-materials' },
      { title: 'منتجات نهائية',   href: '/inventory/finished-products' },
      { title: 'المستودعات',      href: '/warehouses' },
      { title: 'تسوية المخزون',   href: '/inventory/stock-adjustments' },
    ],
  },
  {
    title: 'الفواتير',
    href: '/invoices/sales',
    icon: <FileText className="w-5 h-5" />,
    children: [
      { title: 'فواتير المبيعات',  href: '/invoices/sales' },
      { title: 'فواتير المشتريات', href: '/invoices/purchases' },
    ],
  },
  {
    title: 'التصنيع',
    href: '/manufacturing/production-orders',
    icon: <Factory className="w-5 h-5" />,
    children: [
      { title: 'أوامر الإنتاج',  href: '/manufacturing/production-orders' },
      { title: 'قوائم المواد',   href: '/manufacturing/bom' },
      { title: 'خطوط الإنتاج',   href: '/manufacturing/production-lines' },
      { title: 'الفاقد',          href: '/manufacturing/waste' },
    ],
  },
  {
    title: 'المحاسبة',
    href: '/accounting',
    icon: <BookOpen className="w-5 h-5" />,
    children: [
      { title: 'لوحة المحاسبة',        href: '/accounting' },
      { title: 'الخزن',               href: '/accounting/treasury' },
      // تم دمج (الخزن + الحركات + التحليلات) داخل صفحة الخزنة نفسها لتقليل التشتيت.
      { title: 'المدفوعات',           href: '/accounting/payments' },
      { title: 'ميزان المراجعة',      href: '/accounting/trial-balance' },
      // ملاحظة: صفحات المحاسبة المتقدمة (قيود/دليل حسابات/ميزان مراجعة...)
      // ما زالت موجودة كـ routes لكن تم إخفاؤها من قائمة "المحاسبة" لتبسيط الواجهة.
      // مثال: القيود اليومية، دليل الحسابات، ميزان المراجعة التفصيلي... إلخ.
    ],
  },
  {
    title: 'التقارير',
    href: '/reports',
    icon: <PieChart className="w-5 h-5" />,
    children: [
      { title: 'نظرة عامة',         href: '/reports' },
      { title: 'تقرير المبيعات',   href: '/reports/sales' },
      { title: 'تقرير المشتريات',  href: '/reports/purchases' },
      { title: 'تقرير المخازن',     href: '/reports/inventory' },
      { title: 'تقرير المصروفات',   href: '/reports/expenses' },
      { title: 'كشف حساب عميل',    href: '/reports/customer-statement' },
      { title: 'كشف حساب مورد',    href: '/reports/supplier-statement' },
      { title: 'مديونيات العملاء',  href: '/reports/receivables' },
      { title: 'مستحقات الموردين',  href: '/reports/payables' },
      { title: 'تقرير الأعمار',     href: '/reports/aging' },
      { title: 'قائمة الدخل',         href: '/reports/profit-loss' },
      { title: 'الميزانية العمومية', href: '/reports/balance-sheet' },
      { title: 'تقرير التصنيع',    href: '/reports/manufacturing' },
    ],
  },
  {
    title: 'الإعدادات',
    href: '/settings',
    icon: <Settings className="w-5 h-5" />,
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuthStore();
  const isPlatformAdmin = user?.email?.toLowerCase() === 'admin@erp.com';
  const isTenantAdmin = user?.roles?.includes('admin') || (user?.email || '').toLowerCase().includes('admin');
  const permissionSet = new Set(user?.permissions || []);
  const visibleNavItems = navItems.filter(item => {
    if (item.platformOnly && !isPlatformAdmin) return false;
    if (!item.requiredPermission) return true;
    if (isPlatformAdmin || isTenantAdmin) return true;
    return permissionSet.has(item.requiredPermission);
  });
  // افتح المجموعات ذات الصلة تلقائياً حسب المسار الحالي.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => ({
    '/dashboard':     pathname?.startsWith('/dashboard')     ?? false,
    '/customers':     pathname?.startsWith('/services')      || pathname?.startsWith('/customers')  || pathname?.startsWith('/suppliers')  || false,
    '/inventory/raw-materials': pathname?.startsWith('/inventory') || pathname?.startsWith('/warehouses') || false,
    '/invoices/sales': pathname?.startsWith('/invoices')     ?? false,
    '/manufacturing/production-orders': pathname?.startsWith('/manufacturing') ?? false,
    '/accounting': pathname?.startsWith('/accounting') ?? false,
    '/reports':       pathname?.startsWith('/reports')       ?? false,
  }));
  const toggleGroup = (href: string) =>
    setOpenGroups(prev => ({ ...prev, [href]: !prev[href] }));

  return (
    <div
      className={cn(
        'hidden lg:block fixed right-0 top-0 h-full text-slate-700 transition-all duration-300 z-40 neo-raised',
        'border-l border-slate-200/70',
        collapsed ? 'w-16' : 'w-64'
      )}
      dir="rtl"
    >
      <div className="flex flex-col h-full">
        {/* Brand */}
        <div className="flex items-center justify-between px-4 h-20 border-b border-slate-200/80">
          {!collapsed ? (
            <div className="flex items-center gap-2.5">
              <div className="w-11 h-11 rounded-2xl neo-raised flex items-center justify-center text-indigo-700 font-black text-base">
                OG
              </div>
              <div className="leading-tight">
                <div className="text-lg font-black text-indigo-700">{BRAND.name}</div>
                {BRAND.taglineEn ? (
                  <div className="text-[10px] text-slate-500 tracking-[0.18em] uppercase">{BRAND.taglineEn}</div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="w-11 h-11 mx-auto rounded-2xl neo-raised flex items-center justify-center text-indigo-700 font-black text-base">
              OG
            </div>
          )}
          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200/70 hover:text-indigo-700 transition-colors"
            aria-label="تبديل الشريط الجانبي"
          >
            {collapsed ? (
              <ChevronLeft className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-2 overflow-y-auto">
          {visibleNavItems.map((item) => {
            const hasChildren = !!(item.children && item.children.length > 0);
            const isActive = hasChildren
              ? item.children!.some(child => pathname === child.href || pathname?.startsWith(child.href + '/'))
              : pathname?.startsWith(item.href);
            const isOpen = openGroups[item.href] ?? false;

            // Group with submenu — only when sidebar isn't collapsed.
            if (hasChildren && !collapsed) {
              return (
                <div key={item.href} className="relative rounded-2xl p-1">
                  {isActive && <span className="absolute right-0 top-2 bottom-2 w-1 rounded-l-full bg-indigo-500" aria-hidden />}
                  <button
                    type="button"
                    onClick={() => toggleGroup(item.href)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl transition-all flex-row-reverse justify-end',
                      isActive
                        ? 'neo-inset text-indigo-700'
                        : 'text-slate-600 hover:bg-slate-100/80 hover:text-indigo-700',
                    )}
                    aria-expanded={isOpen}
                  >
                    <ChevronDown className={cn('w-4 h-4 transition-transform text-slate-400', isOpen ? 'rotate-180 text-indigo-500' : '')} />
                    <span className="flex-1 text-sm font-medium text-right">{item.title}</span>
                    <span className={cn('shrink-0', isActive ? 'text-indigo-600' : 'text-slate-400')}>{item.icon}</span>
                  </button>
                  {isOpen && (
                    <div className="mt-1.5 mr-2 pr-3 border-r border-slate-300/80 space-y-1.5">
                      {item.children!.map(child => {
                        const childActive = pathname === child.href || pathname?.startsWith(child.href + '/');
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={cn(
                              'block px-3 py-2 rounded-xl text-xs transition-colors text-right',
                              childActive
                                ? 'neo-inset text-indigo-700 font-semibold'
                                : 'text-slate-500 hover:text-indigo-700 hover:bg-slate-100/75',
                            )}
                          >
                            {child.title}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            // Plain link (or collapsed sidebar)
            return (
              <div key={item.href} className="relative rounded-2xl p-1">
                {isActive && !collapsed && <span className="absolute right-0 top-2 bottom-2 w-1 rounded-l-full bg-indigo-500" aria-hidden />}
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-2xl transition-all',
                    isActive
                      ? 'neo-inset text-indigo-700'
                      : 'text-slate-600 hover:bg-slate-100/80 hover:text-indigo-700',
                    collapsed ? 'justify-center' : 'flex-row-reverse justify-end'
                  )}
                  title={item.title}
                >
                  <span className={cn('shrink-0', isActive ? 'text-indigo-600' : 'text-slate-400')}>{item.icon}</span>
                  {!collapsed && <span className="text-sm font-medium">{item.title}</span>}
                </Link>
              </div>
            );
          })}
        </nav>

        {/* User / Tenant Info */}
        {!collapsed && (
          <div className="p-4 border-t border-slate-200/80">
            <div className="flex items-center gap-2.5 rounded-2xl neo-inset p-3">
              <div className="w-10 h-10 rounded-xl neo-raised flex items-center justify-center text-indigo-700 font-bold text-sm shrink-0">
                {(user?.name?.[0] ?? 'م').toUpperCase()}
              </div>
              <div className="min-w-0 text-right">
                <div className="font-semibold text-slate-800 text-sm truncate">
                  {user?.name || 'المستخدم'}
                </div>
                <div className="truncate text-[11px] text-slate-500">
                  {user?.email || ''}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
