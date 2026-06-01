import { prisma } from '@/lib/db';
import { seedChartOfAccounts } from '@/lib/accounting';

export interface TenantResetPreview {
  products: number;
  customers: number;
  suppliers: number;
  warehouses: number;
  salesInvoices: number;
  purchaseInvoices: number;
  payments: number;
  cashboxes: number;
  cashboxTransactions: number;
  expenses: number;
  journalEntries: number;
  inventoryTransactions: number;
  productionOrders: number;
}

export async function getTenantResetPreview(tenantId: string): Promise<TenantResetPreview> {
  const [
    products,
    customers,
    suppliers,
    warehouses,
    salesInvoices,
    purchaseInvoices,
    payments,
    cashboxes,
    cashboxTransactions,
    expenses,
    journalEntries,
    inventoryTransactions,
    productionOrders,
  ] = await prisma.$transaction([
    prisma.product.count({ where: { tenantId } }),
    prisma.customer.count({ where: { tenantId } }),
    prisma.supplier.count({ where: { tenantId } }),
    prisma.warehouse.count({ where: { tenantId } }),
    prisma.salesInvoice.count({ where: { tenantId } }),
    prisma.purchaseInvoice.count({ where: { tenantId } }),
    prisma.payment.count({ where: { tenantId } }),
    prisma.cashbox.count({ where: { tenantId } }),
    prisma.cashboxTransaction.count({ where: { tenantId } }),
    prisma.expense.count({ where: { tenantId } }),
    prisma.journalEntry.count({ where: { tenantId } }),
    prisma.inventoryTransaction.count({ where: { tenantId } }),
    prisma.productionOrder.count({ where: { tenantId } }),
  ]);

  return {
    products,
    customers,
    suppliers,
    warehouses,
    salesInvoices,
    purchaseInvoices,
    payments,
    cashboxes,
    cashboxTransactions,
    expenses,
    journalEntries,
    inventoryTransactions,
    productionOrders,
  };
}

export async function resetTenantOperationalData(tenantId: string, seedAccounting: boolean) {
  await prisma.$transaction(async tx => {
    await tx.session.deleteMany({ where: { tenantId } });

    await tx.paymentAllocation.deleteMany({ where: { tenantId } });
    await tx.cashboxTransaction.deleteMany({ where: { tenantId } });
    await tx.journalEntryLine.deleteMany({ where: { tenantId } });
    await tx.accountBalanceHistory.deleteMany({ where: { tenantId } });

    await tx.inventoryValuation.deleteMany({ where: { tenantId } });
    await tx.inventoryTransaction.deleteMany({ where: { tenantId } });
    await tx.warehouseStock.deleteMany({ where: { tenantId } });
    await tx.stockReservation.deleteMany({ where: { tenantId } });
    await tx.stocktake.deleteMany({ where: { tenantId } });
    await tx.stockTransfer.deleteMany({ where: { tenantId } });
    await tx.stockAdjustment.deleteMany({ where: { tenantId } });
    await tx.goodsReceipt.deleteMany({ where: { tenantId } });
    await tx.workInProgress.deleteMany({ where: { tenantId } });

    await tx.productionWaste.deleteMany({ where: { tenantId } });
    await tx.productionOrder.deleteMany({ where: { tenantId } });
    await tx.productionLine.deleteMany({ where: { tenantId } });

    await tx.bOMItem.deleteMany({
      where: {
        OR: [
          { product: { tenantId } },
          { material: { tenantId } },
        ],
      },
    });

    await tx.productionLineAssignment.deleteMany({
      where: {
        OR: [
          { productionLine: { tenantId } },
          { product: { tenantId } },
        ],
      },
    });

    await tx.salesReturn.deleteMany({ where: { tenantId } });
    await tx.purchaseReturn.deleteMany({ where: { tenantId } });
    await tx.salesOrder.deleteMany({ where: { tenantId } });
    await tx.purchaseOrder.deleteMany({ where: { tenantId } });
    await tx.purchaseRequisition.deleteMany({ where: { tenantId } });
    await tx.quotation.deleteMany({ where: { tenantId } });

    await tx.salesInvoice.deleteMany({ where: { tenantId } });
    await tx.purchaseInvoice.deleteMany({ where: { tenantId } });

    await tx.payment.deleteMany({ where: { tenantId } });
    await tx.expense.deleteMany({ where: { tenantId } });
    await tx.journalEntry.deleteMany({ where: { tenantId } });

    await tx.cOGSTransaction.deleteMany({ where: { tenantId } });
    await tx.fIFOLayer.deleteMany({ where: { tenantId } });
    await tx.costLayer.deleteMany({ where: { tenantId } });
    await tx.batch.deleteMany({ where: { tenantId } });

    await tx.accrual.deleteMany({ where: { tenantId } });
    await tx.budgetEntry.deleteMany({ where: { tenantId } });
    await tx.budget.deleteMany({ where: { tenantId } });
    await tx.fixedAsset.deleteMany({ where: { tenantId } });
    await tx.fiscalYear.deleteMany({ where: { tenantId } });
    await tx.accountingPeriod.deleteMany({ where: { tenantId } });

    await tx.customer.deleteMany({ where: { tenantId } });
    await tx.supplier.deleteMany({ where: { tenantId } });
    await tx.product.deleteMany({ where: { tenantId } });

    await tx.cashbox.deleteMany({ where: { tenantId } });
    await tx.warehouse.deleteMany({ where: { tenantId } });
    await tx.company.deleteMany({ where: { tenantId } });
    await tx.codeSequence.deleteMany({ where: { tenantId } });
    await tx.idempotencyKey.deleteMany({ where: { tenantId } });
    await tx.outboxEvent.deleteMany({ where: { tenantId } });
    await tx.auditLog.deleteMany({ where: { tenantId } });
    await tx.account.deleteMany({ where: { tenantId } });
  });

  if (seedAccounting) {
    await seedChartOfAccounts(tenantId);
  }
}
