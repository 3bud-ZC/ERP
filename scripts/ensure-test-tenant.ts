import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { seedChartOfAccounts } from '../lib/accounting';
import { getPermissionDescription, getRolePermissions, ROLE_LABELS } from '../lib/permissions-config';

const prisma = new PrismaClient();

const TENANT_NAME = process.env.TEST_TENANT_NAME || 'OG Test Company';
const TEST_EMAIL = (process.env.TEST_USER_EMAIL || 'test@og-estore.site').toLowerCase();
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || 'Test@2026!';

async function ensureRole(code: string) {
  const label = ROLE_LABELS[code] ?? {
    nameAr: code,
    nameEn: code,
    description: 'Test role',
  };
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

async function main() {
  const adminRole = await ensureRole('admin');
  const tenant = await prisma.tenant.upsert({
    where: { tenantCode: 'og-test-company' },
    update: {
      name: TENANT_NAME,
      nameAr: TENANT_NAME,
      status: 'active',
      subscriptionPlan: 'business',
      maxUsers: 10,
      maxProducts: 250,
    },
    create: {
      tenantCode: 'og-test-company',
      name: TENANT_NAME,
      nameAr: TENANT_NAME,
      status: 'active',
      subscriptionPlan: 'business',
      maxUsers: 10,
      maxProducts: 250,
      settings: { currency: 'EGP', language: 'ar', dateFormat: 'DD/MM/YYYY', testTenant: true },
    },
  });

  const password = await hash(TEST_PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { email: TEST_EMAIL },
    update: { name: 'Test User', password, isActive: true },
    create: {
      email: TEST_EMAIL,
      name: 'Test User',
      password,
      isActive: true,
      roles: { create: { roleId: adminRole.id } },
      userTenantRoles: { create: { tenantId: tenant.id, roleId: adminRole.id } },
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
    update: {},
    create: { userId: user.id, roleId: adminRole.id },
  });
  await prisma.userTenantRole.upsert({
    where: { userId_tenantId_roleId: { userId: user.id, tenantId: tenant.id, roleId: adminRole.id } },
    update: {},
    create: { userId: user.id, tenantId: tenant.id, roleId: adminRole.id },
  });

  await seedChartOfAccounts(tenant.id);

  console.log(JSON.stringify({
    tenantId: tenant.id,
    tenantCode: tenant.tenantCode,
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  }, null, 2));
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
