import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { ROLE_LABELS, getPermissionDescription, getRolePermissions } from '@/lib/permissions-config';
import { adminError, adminSuccess, requirePlatformAdmin } from '@/lib/admin/api';
import { deriveSubscriptionStatus, normalizeTenantStatus } from '@/lib/admin/platform-admin';
import { resetTenantOperationalData } from '@/lib/admin/tenant-data-reset';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function normalizePlan(value: unknown): 'trial' | 'starter' | 'business' | 'enterprise' {
  const plan = String(value || '').trim().toLowerCase();
  if (plan === 'starter' || plan === 'business' || plan === 'enterprise') return plan;
  return 'trial';
}

function parseDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function randomPassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function ensureRole(code: string) {
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
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    });
  }
  return role;
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const id = params.id;
  const tenant = await prisma.tenant.findUnique({
    where: { id },
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
        take: 1,
        orderBy: { assignedAt: 'asc' },
        select: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              isActive: true,
              lastLogin: true,
              createdAt: true,
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
          payments: true,
        },
      },
    },
  });
  if (!tenant) return adminError('العميل غير موجود', 404);

  const owner = tenant.users[0]?.user ?? null;
  const settings = (tenant.settings || {}) as Record<string, unknown>;

  return adminSuccess({
    id: tenant.id,
    tenantCode: tenant.tenantCode,
    name: tenant.name,
    nameAr: tenant.nameAr,
    email: tenant.email,
    phone: tenant.phone,
    status: tenant.status,
    subscriptionPlan: tenant.subscriptionPlan,
    subscriptionStatus: deriveSubscriptionStatus({
      tenantStatus: tenant.status,
      subscriptionExpiry: tenant.subscriptionExpiry,
    }),
    subscriptionStart: settings.subscriptionStart ?? null,
    subscriptionExpiry: tenant.subscriptionExpiry,
    limits: {
      maxUsers: tenant.maxUsers,
      maxProducts: tenant.maxProducts,
    },
    owner,
    notes: settings.adminNotes ?? null,
    counts: tenant._count,
    createdAt: tenant.createdAt,
    updatedAt: tenant.updatedAt,
  });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requirePlatformAdmin(request);
    if (!auth.ok) return auth.response;

    const id = params.id;
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const action = String(body.action || '').trim().toLowerCase();

    const tenant = await prisma.tenant.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      tenantCode: true,
      status: true,
      subscriptionPlan: true,
      subscriptionExpiry: true,
      maxUsers: true,
      maxProducts: true,
      settings: true,
    },
  });
    if (!tenant) return adminError('العميل غير موجود', 404);
    if (tenant.tenantCode.toLowerCase() === 'default' && ['suspend', 'soft_delete', 'hard_delete'].includes(action)) {
      return adminError('لا يمكن تنفيذ هذا الإجراء على حساب مالك النظام', 400);
    }

  if (action === 'suspend' || action === 'reactivate' || action === 'soft_delete' || action === 'restore') {
    const nextStatus =
      action === 'suspend'
        ? 'suspended'
        : action === 'soft_delete'
          ? 'deleted'
          : action === 'restore'
            ? 'active'
            : 'active';

    const updated = await prisma.tenant.update({
      where: { id },
      data: { status: nextStatus },
      select: {
        id: true,
        status: true,
      },
    });

    const tenantUserIds = await prisma.userTenantRole.findMany({
      where: { tenantId: id },
      select: { userId: true },
    });
    if (nextStatus !== 'active' && tenantUserIds.length > 0) {
      await prisma.session.deleteMany({
        where: { userId: { in: tenantUserIds.map(row => row.userId) } },
      });
    }

    await prisma.auditLog.create({
      data: {
        userId: auth.user.id,
        action: action.toUpperCase(),
        module: 'platform_admin',
        entityType: 'Tenant',
        entityId: id,
        tenantId: null,
        changes: JSON.stringify({
          fromStatus: tenant.status,
          toStatus: nextStatus,
        }),
        status: 'success',
      },
    });

    return adminSuccess(updated);
  }

  if (action === 'hard_delete') {
    const forceText = String(body.confirmText || '').trim();
    if (forceText !== `DELETE ${tenant.tenantCode}`) {
      return adminError(`تأكيد غير صحيح. اكتب: DELETE ${tenant.tenantCode}`, 400);
    }

    // Force mode for platform owner:
    // wipe all tenant operational data first, then hard-delete tenant + orphan users.
    await resetTenantOperationalData(id, false);

    try {
      await prisma.$transaction(async (tx) => {
        const links = await tx.userTenantRole.findMany({
          where: { tenantId: id },
          select: { userId: true },
        });
        const userIds = links.map((l) => l.userId);

        // Remove remaining tenant-owned records that can still block tenant deletion
        await tx.company.deleteMany({ where: { tenantId: id } });
        await tx.account.deleteMany({ where: { tenantId: id } });
        await tx.codeSequence.deleteMany({ where: { tenantId: id } });
        await tx.idempotencyKey.deleteMany({ where: { tenantId: id } });
        await tx.outboxEvent.deleteMany({ where: { tenantId: id } });
        await tx.session.deleteMany({ where: { tenantId: id } });
        if (userIds.length > 0) {
          await tx.session.deleteMany({ where: { userId: { in: userIds } } });
          await tx.userRole.deleteMany({ where: { userId: { in: userIds } } });
          await tx.auditLog.deleteMany({ where: { userId: { in: userIds } } });
        }
        await tx.userTenantRole.deleteMany({ where: { tenantId: id } });
        await tx.auditLog.deleteMany({ where: { tenantId: id } });

        if (userIds.length > 0) {
          const survivors = await tx.userTenantRole.groupBy({
            by: ['userId'],
            where: { userId: { in: userIds } },
            _count: { userId: true },
          });
          const stillLinked = new Set(survivors.map((s) => s.userId));
          const deletableUsers = userIds.filter((uid) => !stillLinked.has(uid) && uid !== auth.user.id);
          if (deletableUsers.length > 0) {
            await tx.user.deleteMany({ where: { id: { in: deletableUsers } } });
          }
        }

        await tx.tenant.delete({ where: { id } });
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown';
      return adminError(`تعذر الحذف النهائي بسبب ارتباطات بيانات داخلية. (${message})`, 400);
    }

    // Log best-effort only (do not fail response if actor user got removed by this operation)
    try {
      const actor = await prisma.user.findUnique({ where: { id: auth.user.id }, select: { id: true } });
      if (actor) {
        await prisma.auditLog.create({
          data: {
            userId: auth.user.id,
            action: 'HARD_DELETE_TENANT',
            module: 'platform_admin',
            entityType: 'Tenant',
            entityId: id,
            tenantId: null,
            changes: JSON.stringify({ tenantCode: tenant.tenantCode, tenantName: tenant.name }),
            status: 'success',
          },
        });
      }
    } catch {
      // no-op
    }

    return adminSuccess({ id, deleted: true });
  }

  if (action === 'change_plan') {
    const plan = normalizePlan(body.plan || body.subscriptionPlan);
    const subscriptionStart = parseDateOrNull(body.subscriptionStart) ?? new Date();
    const subscriptionEnd = parseDateOrNull(body.subscriptionEnd);
    const status = normalizeTenantStatus(body.status);

    const settings = (tenant.settings || {}) as Record<string, unknown>;
    const mergedSettings = {
      ...settings,
      subscriptionStart: subscriptionStart.toISOString(),
      adminNotes: String(body.notes ?? settings.adminNotes ?? '').trim() || null,
    };

    const updated = await prisma.tenant.update({
      where: { id },
      data: {
        subscriptionPlan: plan,
        ...(subscriptionEnd ? { subscriptionExpiry: subscriptionEnd } : {}),
        ...(status ? { status } : {}),
        settings: mergedSettings,
      },
      select: {
        id: true,
        subscriptionPlan: true,
        subscriptionExpiry: true,
        status: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: auth.user.id,
        action: 'CHANGE_PLAN',
        module: 'platform_admin',
        entityType: 'Tenant',
        entityId: id,
        tenantId: null,
        changes: JSON.stringify({
          before: {
            plan: tenant.subscriptionPlan,
            expiry: tenant.subscriptionExpiry,
            status: tenant.status,
          },
          after: updated,
        }),
        status: 'success',
      },
    });

    return adminSuccess(updated);
  }

  if (action === 'reset_owner_password') {
    const ownerRole = await ensureRole('admin');
    const ownerLink = await prisma.userTenantRole.findFirst({
      where: {
        tenantId: id,
        roleId: ownerRole.id,
      },
      select: {
        user: {
          select: { id: true, email: true, name: true },
        },
      },
      orderBy: { assignedAt: 'asc' },
    });
    const owner = ownerLink?.user;
    if (!owner) return adminError('لا يوجد مالك حساب مرتبط بهذا العميل', 404);

    const providedPassword = String(body.newPassword || '').trim();
    const newPassword = providedPassword.length >= 8 ? providedPassword : randomPassword();
    const hashed = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: owner.id },
      data: {
        password: hashed,
        isActive: true,
      },
    });
    await prisma.session.deleteMany({ where: { userId: owner.id } });

    await prisma.auditLog.create({
      data: {
        userId: auth.user.id,
        action: 'RESET_TENANT_OWNER_PASSWORD',
        module: 'platform_admin',
        entityType: 'User',
        entityId: owner.id,
        tenantId: null,
        changes: JSON.stringify({
          tenantId: id,
          ownerEmail: owner.email,
        }),
        status: 'success',
      },
    });

    return adminSuccess({
      ownerId: owner.id,
      ownerEmail: owner.email,
      generatedPassword: providedPassword.length >= 8 ? null : newPassword,
    });
  }

    return adminError('إجراء غير مدعوم', 400);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown';
    return adminError(`تعذر تنفيذ الإجراء: ${message}`, 500);
  }
}
