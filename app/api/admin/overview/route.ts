import { prisma } from '@/lib/db';
import { adminSuccess, requirePlatformAdmin } from '@/lib/admin/api';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PLAN_PRICE_MAP: Record<string, number> = {
  trial: 0,
  starter: 1499,
  business: 3999,
  enterprise: 9999,
};

export async function GET(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const now = new Date();
  const in14Days = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const [
    totalTenants,
    activeTenants,
    suspendedTenants,
    trialTenants,
    deletedTenants,
    expiredSubscriptions,
    totalUsers,
    activeUsers,
    tenantsWithPlan,
    recentTenants,
    recentUsers,
    expiringSubscriptions,
    latestAdminActions,
  ] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { status: 'active' } }),
    prisma.tenant.count({ where: { status: 'suspended' } }),
    prisma.tenant.count({ where: { status: 'trial' } }),
    prisma.tenant.count({ where: { status: 'deleted' } }),
    prisma.tenant.count({
      where: {
        OR: [
          { status: 'expired' },
          { subscriptionExpiry: { lt: now } },
        ],
      },
    }),
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.tenant.findMany({
      select: {
        subscriptionPlan: true,
        status: true,
      },
    }),
    prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        tenantCode: true,
        name: true,
        nameAr: true,
        status: true,
        subscriptionPlan: true,
        createdAt: true,
        users: {
          where: { role: { code: 'admin' } },
          take: 1,
          select: {
            user: {
              select: { name: true, email: true },
            },
          },
        },
      },
    }),
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        createdAt: true,
        userTenantRoles: {
          take: 1,
          select: {
            tenant: {
              select: { id: true, name: true, nameAr: true, tenantCode: true },
            },
          },
        },
      },
    }),
    prisma.tenant.findMany({
      where: {
        subscriptionExpiry: {
          gte: now,
          lte: in14Days,
        },
      },
      orderBy: { subscriptionExpiry: 'asc' },
      take: 8,
      select: {
        id: true,
        name: true,
        nameAr: true,
        tenantCode: true,
        subscriptionPlan: true,
        subscriptionExpiry: true,
        status: true,
      },
    }),
    prisma.auditLog.findMany({
      where: {
        module: {
          in: ['platform_admin', 'admin'],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        status: true,
        createdAt: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    }),
  ]);

  const revenueEstimate = tenantsWithPlan.reduce((sum, tenant) => {
    if (!['active', 'trial'].includes(tenant.status)) return sum;
    return sum + (PLAN_PRICE_MAP[tenant.subscriptionPlan] || 0);
  }, 0);

  return adminSuccess({
    cards: {
      totalTenants,
      activeTenants,
      suspendedTenants,
      trialTenants,
      deletedTenants,
      expiredSubscriptions,
      totalUsers,
      activeUsers,
      revenueEstimate,
      systemHealth: 'healthy',
    },
    widgets: {
      recentTenants: recentTenants.map((tenant) => ({
        ...tenant,
        owner: tenant.users[0]?.user ?? null,
      })),
      recentUsers,
      expiringSubscriptions,
      latestAdminActions,
    },
  });
}
