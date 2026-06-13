import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { ROLE_LABELS, USER_ROLES, getPermissionDescription, getRolePermissions } from '@/lib/permissions-config';
import { adminError, adminSuccess, parsePositiveInt, requirePlatformAdmin } from '@/lib/admin/api';
import { getPlatformAdminEmails } from '@/lib/admin/platform-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function randomPassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function ensureRole(code: string) {
  const label = ROLE_LABELS[code] ?? ROLE_LABELS.manager;
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
    const permission = await prisma.permission.upsert({
      where: { code: permissionCode },
      update: { isActive: true },
      create: {
        code: permissionCode,
        nameAr: getPermissionDescription(permissionCode),
        nameEn: permissionCode.replace(/_/g, ' '),
        module: permissionCode.split('_').at(-1) || 'erp',
        action: permissionCode.split('_')[0] || 'use',
        isActive: true,
      },
    });
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    });
  }
  return role;
}

async function ensureCanDisableUser(targetUserId: string): Promise<
  | { ok: true; target: { id: string; email: string; isActive: boolean } }
  | { ok: false; error: string; status: number }
> {
  const protectedEmails = getPlatformAdminEmails();
  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, email: true, isActive: true },
  });
  if (!target) return { ok: false, error: 'المستخدم غير موجود', status: 404 };

  const isProtected = protectedEmails.includes(target.email.toLowerCase());
  if (!isProtected) return { ok: true, target };

  const activeSuperAdmins = await prisma.user.count({
    where: {
      isActive: true,
      email: { in: protectedEmails },
    },
  });
  if (activeSuperAdmins <= 1) {
    return {
      ok: false,
      error: 'لا يمكن تعطيل آخر حساب Super Admin على المنصة',
      status: 400,
    };
  }

  return { ok: true, target };
}

export async function GET(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const page = parsePositiveInt(url.searchParams.get('page'), 1, 1, 10000);
  const limit = parsePositiveInt(url.searchParams.get('limit'), 20, 1, 200);
  const skip = (page - 1) * limit;
  const search = String(url.searchParams.get('search') || '').trim();
  const tenantId = String(url.searchParams.get('tenantId') || '').trim();
  const role = String(url.searchParams.get('role') || '').trim();
  const status = String(url.searchParams.get('status') || '').trim().toLowerCase();

  const where: Prisma.UserWhereInput = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (status === 'active') where.isActive = true;
  if (status === 'suspended' || status === 'deleted') where.isActive = false;
  if (role) {
    where.roles = {
      some: {
        role: {
          code: role,
        },
      },
    };
  }
  if (tenantId) {
    where.userTenantRoles = {
      some: {
        tenantId,
      },
    };
  }

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        lastLogin: true,
        createdAt: true,
        roles: {
          select: {
            role: {
              select: {
                code: true,
                nameAr: true,
              },
            },
          },
        },
        userTenantRoles: {
          select: {
            tenantId: true,
            tenant: {
              select: {
                id: true,
                tenantCode: true,
                name: true,
                nameAr: true,
                status: true,
              },
            },
            role: {
              select: {
                code: true,
                nameAr: true,
              },
            },
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return adminSuccess({
    rows: rows.map((user) => ({
      ...user,
      status: user.isActive ? 'active' : 'suspended',
    })),
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
  const tenantId = String(body.tenantId || '').trim();
  const name = String(body.name || '').trim();
  const email = normalizeEmail(body.email);
  const plainPassword = String(body.password || '').trim() || randomPassword();
  const roleCode = String(body.role || 'manager').trim();
  const isActive = body.status === 'suspended' ? false : true;

  if (!tenantId) return adminError('اختيار العميل مطلوب', 400);
  if (!name) return adminError('اسم المستخدم مطلوب', 400);
  if (!email) return adminError('البريد الإلكتروني مطلوب', 400);
  if (!USER_ROLES.includes(roleCode)) return adminError('الدور غير صالح', 400);
  if (plainPassword.length < 8) return adminError('كلمة المرور يجب ألا تقل عن 8 أحرف', 400);

  const [tenant, existingUser] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, status: true, maxUsers: true, _count: { select: { users: true } } },
    }),
    prisma.user.findUnique({
      where: { email },
      select: { id: true },
    }),
  ]);

  if (!tenant) return adminError('العميل غير موجود', 404);
  if (!['active', 'trial'].includes(tenant.status)) return adminError('لا يمكن إضافة مستخدم لعميل غير نشط', 400);
  if (existingUser) return adminError('هذا البريد مستخدم بالفعل', 409);
  if (tenant._count.users >= tenant.maxUsers) {
    return adminError(`تم الوصول للحد الأقصى للمستخدمين (${tenant.maxUsers})`, 409);
  }

  const role = await ensureRole(roleCode);
  const password = await hashPassword(plainPassword);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        email,
        password,
        isActive,
        roles: { create: { roleId: role.id } },
        userTenantRoles: {
          create: {
            tenantId,
            roleId: role.id,
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        createdAt: true,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: auth.user.id,
        action: 'CREATE_USER',
        module: 'platform_admin',
        entityType: 'User',
        entityId: user.id,
        tenantId: null,
        changes: JSON.stringify({
          tenantId,
          role: roleCode,
          email,
          isActive,
        }),
        status: 'success',
      },
    });

    return user;
  });

  return adminSuccess(
    {
      ...created,
      generatedPassword: body.password ? null : plainPassword,
    },
    { status: 201 },
  );
}

export async function PUT(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const id = String(body.id || '').trim();
  if (!id) return adminError('معرف المستخدم مطلوب', 400);

  const existing = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      userTenantRoles: {
        orderBy: { assignedAt: 'desc' },
        select: {
          tenantId: true,
          roleId: true,
        },
      },
      roles: {
        orderBy: { assignedAt: 'desc' },
        select: {
          roleId: true,
        },
      },
    },
  });
  if (!existing) return adminError('المستخدم غير موجود', 404);

  const nextStatus = String(body.status || '').trim().toLowerCase();
  const wantsDisable = nextStatus === 'suspended' || body.isActive === false;
  if (wantsDisable) {
    const check = await ensureCanDisableUser(id);
    if (!check.ok) return adminError(check.error, check.status);
  }

  const roleCode = String(body.role || '').trim();
  const requestedTenantId = String(body.tenantId || '').trim();
  let roleId: string | null = null;
  if (roleCode) {
    if (!USER_ROLES.includes(roleCode)) return adminError('الدور غير صالح', 400);
    const role = await ensureRole(roleCode);
    roleId = role.id;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.user.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: String(body.name || '').trim() } : {}),
        ...(body.email !== undefined ? { email: normalizeEmail(body.email) } : {}),
        ...(nextStatus
          ? { isActive: !(nextStatus === 'suspended' || nextStatus === 'deleted') }
          : body.isActive !== undefined
            ? { isActive: Boolean(body.isActive) }
            : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        updatedAt: true,
      },
    });

    const existingTenantRole = existing.userTenantRoles[0];
    const existingGlobalRole = existing.roles[0];
    const nextTenantId = requestedTenantId || existingTenantRole?.tenantId;
    const nextRoleId = roleId || existingTenantRole?.roleId || existingGlobalRole?.roleId || null;

    if (roleId) {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.create({ data: { userId: id, roleId } });
    }

    if (nextTenantId && nextRoleId && (roleId || requestedTenantId)) {
      await tx.userTenantRole.deleteMany({ where: { userId: id } });
      await tx.userTenantRole.create({
        data: {
          userId: id,
          tenantId: nextTenantId,
          roleId: nextRoleId,
        },
      });
    }

    if (!row.isActive) {
      await tx.session.deleteMany({ where: { userId: id } });
    }

    await tx.auditLog.create({
      data: {
        userId: auth.user.id,
        action: 'UPDATE_USER',
        module: 'platform_admin',
        entityType: 'User',
        entityId: id,
        tenantId: null,
        changes: JSON.stringify({
          before: existing,
          after: {
            name: row.name,
            email: row.email,
            isActive: row.isActive,
            role: roleCode || null,
            tenantId: requestedTenantId || null,
          },
        }),
        status: 'success',
      },
    });

    return row;
  });

  return adminSuccess(updated);
}

export async function PATCH(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const id = String(body.id || '').trim();
  const action = String(body.action || '').trim().toLowerCase();
  if (!id) return adminError('معرف المستخدم مطلوب', 400);

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, isActive: true },
  });
  if (!user) return adminError('المستخدم غير موجود', 404);

  if (action === 'reset_password') {
    const providedPassword = String(body.password || '').trim();
    const plainPassword = providedPassword.length >= 8 ? providedPassword : randomPassword();
    if (plainPassword.length < 8) return adminError('كلمة المرور يجب ألا تقل عن 8 أحرف', 400);
    const hash = await hashPassword(plainPassword);

    await prisma.user.update({
      where: { id },
      data: {
        password: hash,
        isActive: true,
      },
    });
    await prisma.session.deleteMany({ where: { userId: id } });
    await prisma.auditLog.create({
      data: {
        userId: auth.user.id,
        action: 'RESET_USER_PASSWORD',
        module: 'platform_admin',
        entityType: 'User',
        entityId: id,
        tenantId: null,
        changes: JSON.stringify({ email: user.email }),
        status: 'success',
      },
    });
    return adminSuccess({
      id,
      generatedPassword: providedPassword ? null : plainPassword,
    });
  }

  if (action === 'suspend' || action === 'activate') {
    const isActive = action === 'activate';
    if (!isActive) {
      const check = await ensureCanDisableUser(id);
      if (!check.ok) return adminError(check.error, check.status);
    }

    await prisma.user.update({
      where: { id },
      data: { isActive },
    });
    if (!isActive) {
      await prisma.session.deleteMany({ where: { userId: id } });
    }
    await prisma.auditLog.create({
      data: {
        userId: auth.user.id,
        action: isActive ? 'ACTIVATE_USER' : 'SUSPEND_USER',
        module: 'platform_admin',
        entityType: 'User',
        entityId: id,
        tenantId: null,
        changes: JSON.stringify({ email: user.email }),
        status: 'success',
      },
    });
    return adminSuccess({ id, isActive });
  }

  return adminError('إجراء غير مدعوم', 400);
}

export async function DELETE(request: Request) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const id = String(body.id || '').trim();
  if (!id) return adminError('معرف المستخدم مطلوب', 400);

  const check = await ensureCanDisableUser(id);
  if (!check.ok) return adminError(check.error, check.status);

  await prisma.user.update({
    where: { id },
    data: {
      isActive: false,
    },
  });
  await prisma.session.deleteMany({ where: { userId: id } });

  await prisma.auditLog.create({
    data: {
      userId: auth.user.id,
      action: 'SOFT_DELETE_USER',
      module: 'platform_admin',
      entityType: 'User',
      entityId: id,
      tenantId: null,
      changes: JSON.stringify({
        email: check.target.email,
      }),
      status: 'success',
    },
  });

  return adminSuccess({ id, status: 'deleted' });
}
