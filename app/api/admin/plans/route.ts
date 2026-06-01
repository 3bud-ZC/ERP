import { prisma } from '@/lib/db';
import { adminError, adminSuccess, requirePlatformAdmin } from '@/lib/admin/api';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PlanRow = {
  code: string;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number | null;
  maxUsers: number;
  maxWarehouses: number;
  maxProducts: number;
  enabledModules: {
    sales: boolean;
    purchases: boolean;
    inventory: boolean;
    manufacturing: boolean;
    accounting: boolean;
    reports: boolean;
  };
  status: 'active' | 'inactive';
  description: string;
};

const CATALOG: PlanRow[] = [
  {
    code: 'trial',
    name: 'تجريبي',
    monthlyPrice: 0,
    yearlyPrice: null,
    maxUsers: 5,
    maxWarehouses: 1,
    maxProducts: 200,
    enabledModules: { sales: true, purchases: true, inventory: true, manufacturing: true, accounting: true, reports: true },
    status: 'active',
    description: 'خطة تجربة لإعداد الحساب',
  },
  {
    code: 'starter',
    name: 'Starter',
    monthlyPrice: 1499,
    yearlyPrice: 14990,
    maxUsers: 8,
    maxWarehouses: 2,
    maxProducts: 1000,
    enabledModules: { sales: true, purchases: true, inventory: true, manufacturing: true, accounting: true, reports: true },
    status: 'active',
    description: 'خطة مناسبة للشركات الصغيرة',
  },
  {
    code: 'business',
    name: 'Business',
    monthlyPrice: 3999,
    yearlyPrice: 39990,
    maxUsers: 25,
    maxWarehouses: 8,
    maxProducts: 10000,
    enabledModules: { sales: true, purchases: true, inventory: true, manufacturing: true, accounting: true, reports: true },
    status: 'active',
    description: 'خطة تشغيلية كاملة للشركات المتوسطة',
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    monthlyPrice: 9999,
    yearlyPrice: 99990,
    maxUsers: 100,
    maxWarehouses: 50,
    maxProducts: 100000,
    enabledModules: { sales: true, purchases: true, inventory: true, manufacturing: true, accounting: true, reports: true },
    status: 'active',
    description: 'خطة المؤسسات والتوسع الكبير',
  },
];

export async function GET(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const tenantsByPlan = await prisma.tenant.groupBy({
    by: ['subscriptionPlan'],
    _count: { subscriptionPlan: true },
  });
  const usageMap = new Map<string, number>();
  tenantsByPlan.forEach((row) => usageMap.set(row.subscriptionPlan, row._count.subscriptionPlan));

  return adminSuccess({
    rows: CATALOG.map((plan) => ({
      ...plan,
      assignedTenants: usageMap.get(plan.code) ?? 0,
    })),
    note: 'إدارة إنشاء/تعديل الخطط المتقدمة تتطلب نموذج بيانات مستقل. حالياً يتم اعتماد كتالوج الخطط القياسي.',
  });
}

export async function PUT(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const tenantId = String(body.tenantId || '').trim();
  const planCode = String(body.planCode || '').trim().toLowerCase();
  const start = body.subscriptionStart ? new Date(String(body.subscriptionStart)) : new Date();
  const end = body.subscriptionEnd ? new Date(String(body.subscriptionEnd)) : null;

  if (!tenantId) return adminError('معرف العميل مطلوب', 400);
  if (!CATALOG.some((plan) => plan.code === planCode)) return adminError('الخطة غير مدعومة', 400);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, settings: true },
  });
  if (!tenant) return adminError('العميل غير موجود', 404);

  const settings = (tenant.settings || {}) as Record<string, unknown>;
  const nextSettings = {
    ...settings,
    subscriptionStart: start.toISOString(),
  };

  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      subscriptionPlan: planCode,
      ...(end && !Number.isNaN(end.getTime()) ? { subscriptionExpiry: end } : {}),
      status: 'active',
      settings: nextSettings,
    },
    select: {
      id: true,
      subscriptionPlan: true,
      subscriptionExpiry: true,
      status: true,
      settings: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: auth.user.id,
      action: 'ASSIGN_PLAN',
      module: 'platform_admin',
      entityType: 'Tenant',
      entityId: tenantId,
      tenantId: null,
      changes: JSON.stringify({
        planCode,
        subscriptionStart: start.toISOString(),
        subscriptionEnd: end && !Number.isNaN(end.getTime()) ? end.toISOString() : null,
      }),
      status: 'success',
    },
  });

  return adminSuccess(updated);
}
