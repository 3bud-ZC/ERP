import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { adminError, adminSuccess, parsePositiveInt, requirePlatformAdmin } from '@/lib/admin/api';
import { deriveSubscriptionStatus, normalizeTenantStatus } from '@/lib/admin/platform-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function GET(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 1, 10000);
  const limit = parsePositiveInt(url.searchParams.get('limit'), 20, 1, 200);
  const skip = (page - 1) * limit;
  const statusFilter = String(url.searchParams.get('status') || '').trim().toLowerCase();
  const search = String(url.searchParams.get('search') || '').trim();

  const where: Prisma.TenantWhereInput = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { nameAr: { contains: search, mode: 'insensitive' } },
      { tenantCode: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        tenantCode: true,
        name: true,
        nameAr: true,
        status: true,
        subscriptionPlan: true,
        subscriptionExpiry: true,
        settings: true,
        createdAt: true,
      },
    }),
    prisma.tenant.count({ where }),
  ]);

  const mapped = rows
    .map((tenant) => {
      const settings = (tenant.settings || {}) as Record<string, unknown>;
      const subscriptionStatus = deriveSubscriptionStatus({
        tenantStatus: tenant.status,
        subscriptionExpiry: tenant.subscriptionExpiry,
      });
      return {
        tenantId: tenant.id,
        tenantCode: tenant.tenantCode,
        companyName: tenant.nameAr || tenant.name,
        plan: tenant.subscriptionPlan,
        startDate: settings.subscriptionStart ?? tenant.createdAt,
        endDate: tenant.subscriptionExpiry,
        renewalDate: tenant.subscriptionExpiry,
        status: subscriptionStatus,
        notes: settings.adminNotes ?? null,
      };
    })
    .filter((row) => !statusFilter || statusFilter === 'all' || row.status === statusFilter);

  return adminSuccess({
    rows: mapped,
    meta: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  });
}

export async function PUT(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const tenantId = String(body.tenantId || '').trim();
  const action = String(body.action || '').trim().toLowerCase();
  if (!tenantId) return adminError('معرف العميل مطلوب', 400);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, status: true, settings: true, subscriptionPlan: true, subscriptionExpiry: true },
  });
  if (!tenant) return adminError('العميل غير موجود', 404);

  const settings = (tenant.settings || {}) as Record<string, unknown>;

  if (action === 'extend') {
    const days = parsePositiveInt(body.days, 30, 1, 3650);
    const from = tenant.subscriptionExpiry && tenant.subscriptionExpiry > new Date() ? tenant.subscriptionExpiry : new Date();
    const next = new Date(from);
    next.setDate(next.getDate() + days);
    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        subscriptionExpiry: next,
        status: tenant.status === 'expired' ? 'active' : tenant.status,
      },
      select: {
        id: true,
        subscriptionExpiry: true,
        status: true,
      },
    });
    await prisma.auditLog.create({
      data: {
        userId: auth.user.id,
        action: 'EXTEND_SUBSCRIPTION',
        module: 'platform_admin',
        entityType: 'Tenant',
        entityId: tenantId,
        tenantId: null,
        changes: JSON.stringify({
          beforeExpiry: tenant.subscriptionExpiry,
          afterExpiry: next,
          days,
        }),
        status: 'success',
      },
    });
    return adminSuccess(updated);
  }

  if (action === 'change_plan') {
    const plan = String(body.plan || '').trim().toLowerCase();
    if (!plan) return adminError('الخطة مطلوبة', 400);
    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: { subscriptionPlan: plan },
      select: { id: true, subscriptionPlan: true },
    });
    await prisma.auditLog.create({
      data: {
        userId: auth.user.id,
        action: 'CHANGE_SUBSCRIPTION_PLAN',
        module: 'platform_admin',
        entityType: 'Tenant',
        entityId: tenantId,
        tenantId: null,
        changes: JSON.stringify({
          beforePlan: tenant.subscriptionPlan,
          afterPlan: plan,
        }),
        status: 'success',
      },
    });
    return adminSuccess(updated);
  }

  if (action === 'cancel') {
    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        status: 'deleted',
        settings: {
          ...settings,
          cancelledAt: new Date().toISOString(),
          cancelReason: String(body.notes || '').trim() || null,
        },
      },
      select: { id: true, status: true, settings: true },
    });
    await prisma.auditLog.create({
      data: {
        userId: auth.user.id,
        action: 'CANCEL_SUBSCRIPTION',
        module: 'platform_admin',
        entityType: 'Tenant',
        entityId: tenantId,
        tenantId: null,
        changes: JSON.stringify({ from: tenant.status, to: 'deleted' }),
        status: 'success',
      },
    });
    return adminSuccess(updated);
  }

  if (action === 'set_status') {
    const status = normalizeTenantStatus(body.status);
    if (!status) return adminError('حالة الاشتراك غير صالحة', 400);
    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: { status },
      select: { id: true, status: true },
    });
    await prisma.auditLog.create({
      data: {
        userId: auth.user.id,
        action: 'UPDATE_SUBSCRIPTION_STATUS',
        module: 'platform_admin',
        entityType: 'Tenant',
        entityId: tenantId,
        tenantId: null,
        changes: JSON.stringify({ from: tenant.status, to: status }),
        status: 'success',
      },
    });
    return adminSuccess(updated);
  }

  if (action === 'update') {
    const startDate = parseDateOrNull(body.startDate);
    const endDate = parseDateOrNull(body.endDate);
    const notes = String(body.notes || '').trim();
    const nextSettings = {
      ...settings,
      ...(startDate ? { subscriptionStart: startDate.toISOString() } : {}),
      ...(notes ? { adminNotes: notes } : {}),
    };

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(endDate ? { subscriptionExpiry: endDate } : {}),
        settings: nextSettings,
      },
      select: {
        id: true,
        subscriptionExpiry: true,
        settings: true,
      },
    });
    await prisma.auditLog.create({
      data: {
        userId: auth.user.id,
        action: 'UPDATE_SUBSCRIPTION',
        module: 'platform_admin',
        entityType: 'Tenant',
        entityId: tenantId,
        tenantId: null,
        changes: JSON.stringify({
          startDate: startDate?.toISOString() || null,
          endDate: endDate?.toISOString() || null,
          notes: notes || null,
        }),
        status: 'success',
      },
    });
    return adminSuccess(updated);
  }

  return adminError('إجراء غير مدعوم', 400);
}
