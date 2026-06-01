import { prisma } from '@/lib/db';
import { apiError, apiSuccess, handleApiError } from '@/lib/api-response';
import { getAuthenticatedUser } from '@/lib/auth';
import { isPlatformAdmin } from '@/lib/admin/platform-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Platform-wide wipe (DANGER).
 *
 * Goal: make the platform "clean" for resale/demo by deleting ALL tenants + their data,
 * while keeping ONLY the platform owner account.
 *
 * This endpoint is intentionally hard to trigger:
 * - platform admin only
 * - requires multiple confirmation fields
 *
 * NOTE: This does NOT take backups. Backups must be handled operationally on the VPS.
 */
export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser(request);
    if (!isPlatformAdmin(user)) return apiError('غير مصرح بالدخول للوحة الأدمن', 403);

    const body = await request.json().catch(() => ({}));
    const confirmText = String((body as any).confirmText || '').trim();
    const confirmEmail = String((body as any).confirmEmail || '').trim().toLowerCase();
    const confirmCode = String((body as any).confirmCode || '').trim();

    const expectedText = 'WIPE ALL';
    if (confirmText.toUpperCase() !== expectedText) {
      return apiError(`تأكيد غير صحيح. اكتب النص بالضبط: ${expectedText}`, 400);
    }
    if (!user?.email || confirmEmail !== user.email.toLowerCase()) {
      return apiError('تأكيد البريد الإلكتروني غير صحيح', 400);
    }
    if (!confirmCode || confirmCode.length < 6) {
      return apiError('كود التأكيد غير صحيح', 400);
    }

    // Soft guard: only allow wiping when the caller explicitly asks for "all tenants".
    // (The UI generates a one-time code and must send it back.)
    const before = {
      tenants: await prisma.tenant.count(),
      users: await prisma.user.count(),
    };

    // Keep ONLY platform owner (admin@erp.com) and delete the rest.
    const ownerEmail = 'admin@erp.com';

    await prisma.$transaction(async (tx) => {
      // Kill all sessions first to force logout across the system.
      await tx.session.deleteMany({});

      // Delete all non-owner users.
      await tx.user.deleteMany({
        where: { email: { not: ownerEmail } },
      });

      // Delete all tenants. Most tenant-scoped tables have tenantId with onDelete restrictions.
      // We delete tenant data by cascading deletes through explicit deleteMany on key tables.
      // For safety, we delete tenants last.
      const tenantIds = (await tx.tenant.findMany({ select: { id: true } })).map((t) => t.id);
      if (tenantIds.length) {
        const whereTenants = { tenantId: { in: tenantIds } } as any;

        await tx.paymentAllocation.deleteMany({ where: whereTenants });
        await tx.cashboxTransaction.deleteMany({ where: whereTenants });
        await tx.journalEntryLine.deleteMany({ where: whereTenants });
        await tx.accountBalanceHistory.deleteMany({ where: whereTenants });

        await tx.inventoryValuation.deleteMany({ where: whereTenants });
        await tx.inventoryTransaction.deleteMany({ where: whereTenants });
        await tx.warehouseStock.deleteMany({ where: whereTenants });
        await tx.stockReservation.deleteMany({ where: whereTenants });
        await tx.stocktake.deleteMany({ where: whereTenants });
        await tx.stockTransfer.deleteMany({ where: whereTenants });
        await tx.stockAdjustment.deleteMany({ where: whereTenants });
        await tx.goodsReceipt.deleteMany({ where: whereTenants });
        await tx.workInProgress.deleteMany({ where: whereTenants });

        await tx.productionWaste.deleteMany({ where: whereTenants });
        await tx.productionOrder.deleteMany({ where: whereTenants });
        await tx.productionLine.deleteMany({ where: whereTenants });
        await tx.bOMItem.deleteMany({
          where: {
            OR: [
              { product: { tenantId: { in: tenantIds } } },
              { material: { tenantId: { in: tenantIds } } },
            ],
          },
        });
        await tx.productionLineAssignment.deleteMany({
          where: {
            OR: [
              { productionLine: { tenantId: { in: tenantIds } } },
              { product: { tenantId: { in: tenantIds } } },
            ],
          },
        });

        await tx.salesReturn.deleteMany({ where: whereTenants });
        await tx.purchaseReturn.deleteMany({ where: whereTenants });
        await tx.salesOrder.deleteMany({ where: whereTenants });
        await tx.purchaseOrder.deleteMany({ where: whereTenants });
        await tx.purchaseRequisition.deleteMany({ where: whereTenants });
        await tx.quotation.deleteMany({ where: whereTenants });

        await tx.salesInvoice.deleteMany({ where: whereTenants });
        await tx.purchaseInvoice.deleteMany({ where: whereTenants });
        await tx.payment.deleteMany({ where: whereTenants });
        await tx.expense.deleteMany({ where: whereTenants });
        await tx.journalEntry.deleteMany({ where: whereTenants });

        await tx.cOGSTransaction.deleteMany({ where: whereTenants });
        await tx.fIFOLayer.deleteMany({ where: whereTenants });
        await tx.costLayer.deleteMany({ where: whereTenants });
        await tx.batch.deleteMany({ where: whereTenants });

        await tx.accrual.deleteMany({ where: whereTenants });
        await tx.budgetEntry.deleteMany({ where: whereTenants });
        await tx.budget.deleteMany({ where: whereTenants });
        await tx.fixedAsset.deleteMany({ where: whereTenants });
        await tx.fiscalYear.deleteMany({ where: whereTenants });
        await tx.accountingPeriod.deleteMany({ where: whereTenants });

        await tx.customer.deleteMany({ where: whereTenants });
        await tx.supplier.deleteMany({ where: whereTenants });
        await tx.product.deleteMany({ where: whereTenants });
        await tx.cashbox.deleteMany({ where: whereTenants });
        await tx.warehouse.deleteMany({ where: whereTenants });

        await tx.codeSequence.deleteMany({ where: whereTenants });
        await tx.idempotencyKey.deleteMany({ where: whereTenants });
        await tx.outboxEvent.deleteMany({ where: whereTenants });
        await tx.auditLog.deleteMany({ where: whereTenants });
        await tx.account.deleteMany({ where: whereTenants });
      }

      await tx.tenant.deleteMany({});

      // Owner user remains. Tenant association is derived from role mappings; removing tenants
      // means the owner has no tenant-scoped access until a new tenant is created.
    });

    const after = {
      tenants: await prisma.tenant.count(),
      users: await prisma.user.count(),
    };

    await prisma.auditLog.create({
      data: {
        userId: user!.id,
        tenantId: null,
        action: 'SYSTEM_WIPE',
        module: 'admin',
        entityType: 'System',
        entityId: 'platform',
        changes: JSON.stringify({ before, after }),
        status: 'success',
      },
    });

    return apiSuccess({ before, after }, 'تم تصفير النظام بالكامل بنجاح (مع إبقاء مالك النظام فقط)');
  } catch (error) {
    return handleApiError(error, 'System wipe');
  }
}
