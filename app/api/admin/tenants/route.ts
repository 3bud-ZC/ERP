import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { seedChartOfAccounts } from '@/lib/accounting';
import {
  buildTenantCode,
  deriveSubscriptionStatus,
  normalizeTenantStatus,
} from '@/lib/admin/platform-admin';
import { ROLE_LABELS, getPermissionDescription, getRolePermissions } from '@/lib/permissions-config';
import { adminError, adminSuccess, parsePositiveInt, requirePlatformAdmin } from '@/lib/admin/api';
import { CODE_ENTITY_KEYS, allocateEntityCode } from '@/lib/code-sequence.service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PLAN_LIMITS: Record<string, { maxUsers: number; maxProducts: number; maxWarehouses: number }> = {
  trial: { maxUsers: 5, maxProducts: 200, maxWarehouses: 1 },
  starter: { maxUsers: 8, maxProducts: 1000, maxWarehouses: 2 },
  business: { maxUsers: 25, maxProducts: 10000, maxWarehouses: 8 },
  enterprise: { maxUsers: 100, maxProducts: 100000, maxWarehouses: 50 },
};

function normalizePlan(value: unknown): keyof typeof PLAN_LIMITS {
  const plan = String(value || '').trim().toLowerCase();
  return (plan in PLAN_LIMITS ? plan : 'trial') as keyof typeof PLAN_LIMITS;
}

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function parseDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function generatePassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function ensureRoleWithPermissions(code: string) {
  const label = ROLE_LABELS[code] ?? ROLE_LABELS.admin;
  const role = await prisma.role.upsert({
    where: { code },
    update: {
      nameAr: label.nameAr,
      nameEn: label.nameEn,
      description: label.description,
      isActive: true,
    },
    create: {
      code,
      nameAr: label.nameAr,
      nameEn: label.nameEn,
      description: label.description,
      isActive: true,
    },
  });

  for (const permissionCode of getRolePermissions(code)) {
    const nameAr = getPermissionDescription(permissionCode);
    let permission = await prisma.permission.findUnique({ where: { code: permissionCode } });
    if (!permission) {
      permission = await prisma.permission.findFirst({ where: { nameAr } });
    }
    if (!permission) {
      permission = await prisma.permission.create({
        data: {
          code: permissionCode,
          nameAr,
          nameEn: permissionCode.replace(/_/g, ' '),
          module: permissionCode.split('_').at(-1) || 'erp',
          action: permissionCode.split('_')[0] || 'use',
          isActive: true,
        },
      });
    } else {
      permission = await prisma.permission.update({
        where: { id: permission.id },
        data: { isActive: true, code: permission.code || permissionCode },
      });
    }
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: role.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: role.id,
        permissionId: permission.id,
      },
    });
  }

  return role;
}

export async function GET(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 1, 5000);
  const limit = parsePositiveInt(url.searchParams.get('limit'), 20, 1, 200);
  const skip = (page - 1) * limit;
  const search = String(url.searchParams.get('search') || '').trim();
  const status = String(url.searchParams.get('status') || '').trim().toLowerCase();
  const plan = String(url.searchParams.get('plan') || '').trim().toLowerCase();

  const where: Prisma.TenantWhereInput = {};
  if (status && status !== 'all') where.status = status;
  if (plan && plan !== 'all') where.subscriptionPlan = plan;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { nameAr: { contains: search, mode: 'insensitive' } },
      { tenantCode: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        tenantCode: true,
        name: true,
        nameAr: true,
        email: true,
        phone: true,
        status: true,
        subscriptionPlan: true,
        subscriptionExpiry: true,
        maxUsers: true,
        maxProducts: true,
        settings: true,
        createdAt: true,
        updatedAt: true,
        users: {
          where: { role: { code: 'admin' } },
          orderBy: { assignedAt: 'asc' },
          take: 1,
          select: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                isActive: true,
                lastLogin: true,
              },
            },
          },
        },
        _count: {
          select: {
            users: true,
            products: true,
            warehouses: true,
            customers: true,
            suppliers: true,
            salesInvoices: true,
            purchaseInvoices: true,
          },
        },
      },
    }),
    prisma.tenant.count({ where }),
  ]);

  const data = rows.map((tenant) => {
    const owner = tenant.users[0]?.user ?? null;
    const settings = (tenant.settings || {}) as Record<string, unknown>;
    return {
      id: tenant.id,
      tenantCode: tenant.tenantCode,
      name: tenant.name,
      nameAr: tenant.nameAr,
      email: tenant.email,
      phone: tenant.phone,
      status: tenant.status,
      subscriptionStatus: deriveSubscriptionStatus({
        tenantStatus: tenant.status,
        subscriptionExpiry: tenant.subscriptionExpiry,
      }),
      subscriptionPlan: tenant.subscriptionPlan,
      subscriptionStart: settings.subscriptionStart ?? null,
      subscriptionExpiry: tenant.subscriptionExpiry,
      owner,
      limits: {
        maxUsers: tenant.maxUsers,
        maxProducts: tenant.maxProducts,
      },
      notes: settings.adminNotes ?? null,
      counts: tenant._count,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
    };
  });

  return adminSuccess({
    rows: data,
    meta: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  });
}

export async function POST(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({} as Record<string, unknown>));

  const companyName = String(body.companyName || '').trim();
  const companyNameAr = String(body.companyNameAr || companyName).trim();
  const ownerName = String(body.ownerName || body.adminName || '').trim();
  const ownerEmail = normalizeEmail(body.ownerEmail || body.adminEmail);
  const ownerPhone = String(body.ownerPhone || '').trim();
  const plainPassword = String(body.password || body.adminPassword || '').trim() || generatePassword();
  const plan = normalizePlan(body.plan || body.subscriptionPlan);
  const requestedStatus = normalizeTenantStatus(body.status) || 'active';
  const safeStatus = requestedStatus === 'trial' ? 'trial' : 'active';
  const notes = String(body.notes || '').trim();
  const seedAccounting = body.seedAccounting !== false;

  if (!companyName) return adminError('اسم الشركة مطلوب', 400);
  if (!ownerName) return adminError('اسم مالك الحساب مطلوب', 400);
  if (!ownerEmail) return adminError('بريد مالك الحساب مطلوب', 400);
  if (plainPassword.length < 8) return adminError('كلمة المرور يجب ألا تقل عن 8 أحرف', 400);

  const startDate = parseDateOrNull(body.subscriptionStartDate) ?? new Date();
  const explicitEndDate = parseDateOrNull(body.subscriptionEndDate);
  const durationDays = parsePositiveInt(body.subscriptionDurationDays, plan === 'trial' ? 14 : 30, 1, 3650);
  const endDate = explicitEndDate ?? addDays(startDate, durationDays);

  const limits = PLAN_LIMITS[plan];
  const maxUsers = parsePositiveInt(body.maxUsers, limits.maxUsers, 1, 5000);
  const maxProducts = parsePositiveInt(body.maxProducts, limits.maxProducts, 1, 1000000);

  const existingUser = await prisma.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
  if (existingUser) return adminError('هذا البريد مستخدم بالفعل', 409);

  if (body.companyEmail) {
    const companyEmail = normalizeEmail(body.companyEmail);
    if (companyEmail) {
      const existingTenantEmail = await prisma.tenant.findUnique({ where: { email: companyEmail }, select: { id: true } });
      if (existingTenantEmail) return adminError('بريد الشركة مستخدم بالفعل', 409);
    }
  }

  const role = await ensureRoleWithPermissions('admin');
  const tenantCode = buildTenantCode(companyName);
  const passwordHash = await hashPassword(plainPassword);

  const created = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({
      data: {
        tenantCode,
        name: companyName,
        nameAr: companyNameAr,
        email: normalizeEmail(body.companyEmail),
        phone: String(body.companyPhone || body.phone || '').trim() || null,
        status: safeStatus,
        subscriptionPlan: plan,
        subscriptionExpiry: endDate,
        maxUsers,
        maxProducts,
        settings: {
          currency: String(body.currency || 'EGP'),
          language: 'ar',
          dateFormat: 'DD/MM/YYYY',
          onboardingCompleted: true,
          ownerPhone,
          subscriptionStart: startDate.toISOString(),
          adminNotes: notes || null,
          createdFromPlatformAdmin: true,
        },
      },
    });

    const owner = await tx.user.create({
      data: {
        name: ownerName,
        email: ownerEmail,
        password: passwordHash,
        isActive: true,
        roles: {
          create: {
            roleId: role.id,
          },
        },
        userTenantRoles: {
          create: {
            tenantId: tenant.id,
            roleId: role.id,
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    const suffix = tenant.id.slice(-6).toUpperCase();
    await tx.company.create({
      data: {
        code: `CO-${suffix}`,
        nameAr: `${companyNameAr}-${suffix}`,
        nameEn: companyName,
        email: normalizeEmail(body.companyEmail) || null,
        phone: String(body.companyPhone || body.phone || '').trim() || null,
        tenantId: tenant.id,
      },
    });

    await tx.warehouse.create({
      data: {
        code: `WH-${suffix}`,
        nameAr: `المستودع الرئيسي ${suffix}`,
        nameEn: `Main Warehouse ${suffix}`,
        isActive: true,
        tenantId: tenant.id,
      },
    });

    const cashboxCode = await allocateEntityCode(CODE_ENTITY_KEYS.CASHBOX, tenant.id, tx as any);
    await (tx as any).cashbox.create({
      data: {
        code: cashboxCode,
        name: 'الخزنة الرئيسية',
        currency: 'EGP',
        openingBalance: 0,
        currentBalance: 0,
        status: 'active',
        tenantId: tenant.id,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: auth.user.id,
        action: 'CREATE_TENANT',
        module: 'platform_admin',
        entityType: 'Tenant',
        entityId: tenant.id,
        tenantId: null,
        changes: JSON.stringify({
          tenantCode: tenant.tenantCode,
          ownerEmail,
          plan,
          status: safeStatus,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        }),
        status: 'success',
      },
    });

    return { tenant, owner };
  });

  let accountingSeeded = false;
  if (seedAccounting) {
    try {
      await seedChartOfAccounts(created.tenant.id);
      accountingSeeded = true;
    } catch (error: unknown) {
      return adminError(`تم إنشاء العميل لكن فشل تجهيز الحسابات الافتراضية: ${error instanceof Error ? error.message : 'unknown'}`, 500);
    }
  }

  return adminSuccess(
    {
      tenant: created.tenant,
      owner: created.owner,
      bootstrap: {
        accountingSeeded,
      },
      generatedPassword: body.password || body.adminPassword ? null : plainPassword,
    },
    { status: 201 },
  );
}

export async function PUT(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const id = String(body.id || '').trim();
  if (!id) return adminError('معرف العميل مطلوب', 400);

  const tenant = await prisma.tenant.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      status: true,
      subscriptionPlan: true,
      subscriptionExpiry: true,
      maxUsers: true,
      maxProducts: true,
      settings: true,
    },
  });
  if (!tenant) return adminError('العميل غير موجود', 404);

  const status = normalizeTenantStatus(body.status);
  const plan = body.subscriptionPlan ? normalizePlan(body.subscriptionPlan) : null;
  const subscriptionExpiry = body.subscriptionEndDate !== undefined
    ? parseDateOrNull(body.subscriptionEndDate)
    : undefined;
  const maxUsers = body.maxUsers !== undefined ? parsePositiveInt(body.maxUsers, tenant.maxUsers, 1, 5000) : undefined;
  const maxProducts = body.maxProducts !== undefined ? parsePositiveInt(body.maxProducts, tenant.maxProducts, 1, 1000000) : undefined;
  const notes = body.notes !== undefined ? String(body.notes || '').trim() : undefined;

  const settings = ((tenant.settings || {}) as Record<string, unknown>);
  const mergedSettings = {
    ...settings,
    ...(notes !== undefined ? { adminNotes: notes || null } : {}),
  };

  const updated = await prisma.tenant.update({
    where: { id },
    data: {
      ...(status ? { status } : {}),
      ...(plan ? { subscriptionPlan: plan } : {}),
      ...(subscriptionExpiry !== undefined ? { subscriptionExpiry } : {}),
      ...(maxUsers !== undefined ? { maxUsers } : {}),
      ...(maxProducts !== undefined ? { maxProducts } : {}),
      ...(notes !== undefined ? { settings: mergedSettings as Prisma.InputJsonValue } : {}),
    },
    select: {
      id: true,
      tenantCode: true,
      name: true,
      nameAr: true,
      status: true,
      subscriptionPlan: true,
      subscriptionExpiry: true,
      maxUsers: true,
      maxProducts: true,
      settings: true,
      updatedAt: true,
    },
  });

  if (status && ['suspended', 'deleted', 'expired'].includes(status)) {
    const tenantUserIds = await prisma.userTenantRole.findMany({
      where: { tenantId: id },
      select: { userId: true },
    });
    if (tenantUserIds.length > 0) {
      await prisma.session.deleteMany({
        where: { userId: { in: tenantUserIds.map(item => item.userId) } },
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: auth.user.id,
      action: 'UPDATE_TENANT',
      module: 'platform_admin',
      entityType: 'Tenant',
      entityId: id,
      tenantId: null,
      changes: JSON.stringify({
        before: tenant,
        after: {
          status: updated.status,
          subscriptionPlan: updated.subscriptionPlan,
          subscriptionExpiry: updated.subscriptionExpiry,
          maxUsers: updated.maxUsers,
          maxProducts: updated.maxProducts,
          notes: ((updated.settings || {}) as Record<string, unknown>).adminNotes ?? null,
        },
      }),
      status: 'success',
    },
  });

  return adminSuccess(updated);
}
