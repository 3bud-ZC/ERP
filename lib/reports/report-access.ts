export type ReportKey =
  | 'overview'
  | 'sales'
  | 'purchases'
  | 'inventory'
  | 'waste'
  | 'expenses'
  | 'customer-statement'
  | 'supplier-statement'
  | 'receivables'
  | 'payables'
  | 'aging'
  | 'profit-loss'
  | 'balance-sheet'
  | 'cashbox-print'
  | 'manufacturing';

export type ReportTab = {
  key: ReportKey;
  href: string;
  title: string;
};

export const REPORT_TABS: ReportTab[] = [
  { key: 'overview', href: '/reports', title: 'نظرة عامة' },
  { key: 'sales', href: '/reports/sales', title: 'المبيعات' },
  { key: 'purchases', href: '/reports/purchases', title: 'المشتريات' },
  { key: 'inventory', href: '/reports/inventory', title: 'المخازن' },
  { key: 'waste', href: '/reports/waste', title: 'الفاقد' },
  { key: 'expenses', href: '/reports/expenses', title: 'المصروفات' },
  { key: 'customer-statement', href: '/reports/customer-statement', title: 'كشف عميل' },
  { key: 'supplier-statement', href: '/reports/supplier-statement', title: 'كشف مورد' },
  { key: 'receivables', href: '/reports/receivables', title: 'مديونيات العملاء' },
  { key: 'payables', href: '/reports/payables', title: 'مستحقات الموردين' },
  { key: 'aging', href: '/reports/aging', title: 'الأعمار' },
  { key: 'profit-loss', href: '/reports/profit-loss', title: 'قائمة الدخل' },
  { key: 'balance-sheet', href: '/reports/balance-sheet', title: 'الميزانية' },
  { key: 'cashbox-print', href: '/reports/cashbox-print', title: 'طباعة الخزنة' },
  { key: 'manufacturing', href: '/reports/manufacturing', title: 'التصنيع' },
];

const REPORT_PERMISSIONS: Record<ReportKey, string[]> = {
  overview: ['reports_full_access', 'view_financial_reports', 'view_accounting', 'view_sales_reports', 'view_purchase'],
  sales: ['reports_full_access', 'view_sales_reports', 'view_sales', 'read_sales_invoice', 'sales_full_access'],
  purchases: ['reports_full_access', 'view_purchase', 'read_purchase_invoice', 'purchase_full_access'],
  inventory: ['reports_full_access', 'read_inventory', 'inventory_full_access', 'manage_inventory', 'view_products'],
  waste: ['reports_full_access', 'read_inventory', 'inventory_full_access', 'manage_inventory', 'production_full_access', 'read_production_order'],
  expenses: ['reports_full_access', 'view_accounting', 'manage_accounting', 'view_financial_reports', 'accounting_full_access'],
  'customer-statement': ['reports_full_access', 'view_accounting', 'view_financial_reports', 'accounting_full_access', 'view_sales_reports'],
  'supplier-statement': ['reports_full_access', 'view_accounting', 'view_financial_reports', 'accounting_full_access', 'view_purchase'],
  receivables: ['reports_full_access', 'view_financial_reports', 'view_accounting', 'accounting_full_access', 'view_sales_reports'],
  payables: ['reports_full_access', 'view_financial_reports', 'view_accounting', 'accounting_full_access', 'view_purchase'],
  aging: ['reports_full_access', 'view_financial_reports', 'view_accounting', 'accounting_full_access'],
  'profit-loss': ['reports_full_access', 'view_financial_reports', 'view_accounting', 'accounting_full_access'],
  'balance-sheet': ['reports_full_access', 'view_financial_reports', 'view_accounting', 'accounting_full_access'],
  'cashbox-print': ['reports_full_access', 'view_financial_reports', 'view_accounting', 'accounting_full_access'],
  manufacturing: ['reports_full_access', 'production_full_access', 'read_production_order', 'view_accounting'],
};

export function hasReportAccess(user: { roles?: string[]; permissions?: string[]; email?: string } | null | undefined, report: ReportKey): boolean {
  if (!user) return false;
  if (user.roles?.includes('admin') || user.email?.toLowerCase().includes('admin')) return true;
  const permissions = user.permissions ?? [];
  return REPORT_PERMISSIONS[report].some((permission) => permissions.includes(permission));
}

export function hasAnyReportAccess(user: { roles?: string[]; permissions?: string[]; email?: string } | null | undefined): boolean {
  return REPORT_TABS.some((tab) => hasReportAccess(user, tab.key));
}
