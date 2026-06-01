/**
 * Canonical RBAC matrix used by platform admin user creation and seed scripts.
 * Permission codes intentionally match the codes checked in API routes.
 */

export const ROLE_LABELS: Record<string, { nameAr: string; nameEn: string; description: string }> = {
  admin: {
    nameAr: 'مدير النظام',
    nameEn: 'System Administrator',
    description: 'صلاحيات كاملة داخل حساب العميل',
  },
  manager: {
    nameAr: 'مدير',
    nameEn: 'Manager',
    description: 'إدارة تشغيلية كاملة بدون صلاحيات مالك المنصة',
  },
  accountant: {
    nameAr: 'محاسب',
    nameEn: 'Accountant',
    description: 'المحاسبة والتقارير والمدفوعات',
  },
  inventory_manager: {
    nameAr: 'مدير المخزون',
    nameEn: 'Inventory Manager',
    description: 'المنتجات والمخازن والتسويات وحركات المخزون',
  },
  sales_rep: {
    nameAr: 'مسؤول مبيعات',
    nameEn: 'Sales Representative',
    description: 'العملاء وفواتير المبيعات وتقاريرها',
  },
  purchase_officer: {
    nameAr: 'مسؤول مشتريات',
    nameEn: 'Purchase Officer',
    description: 'الموردون وفواتير المشتريات وتقاريرها',
  },
};

export const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  manage_system: 'إدارة النظام',
  manage_users: 'إدارة المستخدمين',
  manage_roles: 'إدارة الأدوار',
  manage_permissions: 'إدارة الصلاحيات',
  view_audit_logs: 'عرض سجل التدقيق',
  manage_tenants: 'إدارة العملاء',
  view_all_data: 'عرض كل البيانات',

  create_product: 'إنشاء منتج',
  read_product: 'عرض المنتجات',
  update_product: 'تعديل منتج',
  delete_product: 'حذف منتج',
  view_products: 'عرض المنتجات',
  read_inventory: 'عرض المخزون',
  manage_inventory: 'إدارة المخزون',
  inventory_full_access: 'صلاحيات كاملة للمخزون',
  create_warehouse: 'إنشاء مخزن',
  update_warehouse: 'تعديل مخزن',
  delete_warehouse: 'حذف مخزن',

  create_sales_invoice: 'إنشاء فاتورة بيع',
  create_customer: 'إنشاء عميل',
  update_customer: 'تعديل عميل',
  delete_customer: 'حذف عميل',
  read_sales_invoice: 'عرض فواتير البيع',
  update_sales_invoice: 'تعديل فاتورة بيع',
  delete_sales_invoice: 'حذف فاتورة بيع',
  view_sales_reports: 'عرض تقارير المبيعات',
  view_sales: 'عرض المبيعات',
  create_sales: 'إنشاء مستندات المبيعات',
  update_sales: 'تعديل مستندات المبيعات',
  delete_sales: 'حذف مستندات المبيعات',
  manage_sales: 'إدارة المبيعات',
  read_sales: 'قراءة المبيعات',
  sales_full_access: 'صلاحيات كاملة للمبيعات',

  create_purchase_invoice: 'إنشاء فاتورة شراء',
  view_suppliers: 'عرض الموردين',
  create_supplier: 'إنشاء مورد',
  update_supplier: 'تعديل مورد',
  delete_supplier: 'حذف مورد',
  read_purchase_invoice: 'عرض فواتير الشراء',
  update_purchase_invoice: 'تعديل فاتورة شراء',
  delete_purchase_invoice: 'حذف فاتورة شراء',
  view_purchase: 'عرض المشتريات',
  create_purchase: 'إنشاء مستندات المشتريات',
  update_purchase: 'تعديل مستندات المشتريات',
  delete_purchase: 'حذف مستندات المشتريات',
  manage_purchase: 'إدارة المشتريات',
  read_purchase: 'قراءة المشتريات',
  purchase_full_access: 'صلاحيات كاملة للمشتريات',

  create_production_order: 'إنشاء أمر إنتاج',
  read_production_order: 'عرض أوامر الإنتاج',
  update_production_order: 'تعديل أمر إنتاج',
  delete_production_order: 'حذف أمر إنتاج',
  production_full_access: 'صلاحيات كاملة للتصنيع',

  view_accounting: 'عرض المحاسبة',
  manage_accounting: 'إدارة المحاسبة',
  view_financial_reports: 'عرض التقارير المالية',
  manage_accounts: 'إدارة الحسابات',
  accounting_full_access: 'صلاحيات كاملة للمحاسبة',
  reports_full_access: 'صلاحيات كاملة للتقارير',

  approve_orders: 'اعتماد الطلبات',
  approve_invoices: 'اعتماد الفواتير',
  approve_payments: 'اعتماد المدفوعات',
};

export const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: Object.keys(PERMISSION_DESCRIPTIONS),

  manager: [
    'manage_users',
    'view_audit_logs',
    'create_product',
    'read_product',
    'update_product',
    'view_products',
    'read_inventory',
    'manage_inventory',
    'create_warehouse',
    'update_warehouse',
    'delete_warehouse',
    'create_sales_invoice',
    'create_customer',
    'update_customer',
    'delete_customer',
    'read_sales_invoice',
    'update_sales_invoice',
    'create_purchase_invoice',
    'view_suppliers',
    'create_supplier',
    'update_supplier',
    'delete_supplier',
    'read_purchase_invoice',
    'update_purchase_invoice',
    'create_production_order',
    'read_production_order',
    'update_production_order',
    'view_accounting',
    'manage_accounting',
    'view_financial_reports',
    'manage_accounts',
    'view_sales',
    'create_sales',
    'update_sales',
    'manage_sales',
    'read_sales',
    'view_purchase',
    'create_purchase',
    'update_purchase',
    'manage_purchase',
    'read_purchase',
    'reports_full_access',
    'approve_orders',
    'approve_invoices',
    'approve_payments',
  ],

  accountant: [
    'read_product',
    'view_products',
    'read_sales_invoice',
    'read_purchase_invoice',
    'view_accounting',
    'manage_accounting',
    'view_financial_reports',
    'manage_accounts',
    'accounting_full_access',
    'reports_full_access',
    'view_audit_logs',
  ],

  inventory_manager: [
    'create_product',
    'read_product',
    'update_product',
    'delete_product',
    'view_products',
    'read_inventory',
    'manage_inventory',
    'inventory_full_access',
    'create_warehouse',
    'update_warehouse',
    'delete_warehouse',
    'read_sales_invoice',
    'read_purchase_invoice',
    'read_production_order',
  ],

  sales_rep: [
    'read_product',
    'view_products',
    'create_sales_invoice',
    'create_customer',
    'update_customer',
    'read_sales_invoice',
    'update_sales_invoice',
    'view_sales_reports',
    'view_sales',
    'create_sales',
    'update_sales',
    'read_sales',
    'sales_full_access',
  ],

  purchase_officer: [
    'read_product',
    'view_products',
    'read_inventory',
    'create_purchase_invoice',
    'view_suppliers',
    'create_supplier',
    'update_supplier',
    'read_purchase_invoice',
    'update_purchase_invoice',
    'view_purchase',
    'create_purchase',
    'update_purchase',
    'read_purchase',
    'purchase_full_access',
  ],
};

export const USER_ROLES = Object.keys(ROLE_LABELS);

export function getRolePermissions(roleCode: string): string[] {
  return ROLE_PERMISSIONS[roleCode] || [];
}

export function roleHasPermission(roleCode: string, permissionCode: string): boolean {
  return ROLE_PERMISSIONS[roleCode]?.includes(permissionCode) || false;
}

export function getAllPermissions(): string[] {
  return Object.keys(PERMISSION_DESCRIPTIONS);
}

export function getPermissionDescription(permissionCode: string): string {
  return PERMISSION_DESCRIPTIONS[permissionCode] || permissionCode;
}
