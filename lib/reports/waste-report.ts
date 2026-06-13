import { prisma } from '@/lib/db';

const AUTO_PRODUCTION_WASTE_SOURCE = 'ProductionOrderWasteAuto';

export type WasteReportSource = 'all' | 'production' | 'inventory';

export type WasteReportRow = {
  id: string;
  date: Date;
  productId: string;
  productName: string;
  productCode: string;
  unit: string;
  quantity: number;
  source: 'production' | 'inventory';
  sourceLabel: string;
  reference: string;
  notes: string;
};

export async function buildWasteReportData(params: {
  tenantId: string;
  fromDate: Date;
  toDate: Date;
  productId?: string;
  source?: WasteReportSource;
}) {
  const source = params.source ?? 'all';
  const [productionWastes, inventoryWastes] = await Promise.all([
    source === 'inventory'
      ? Promise.resolve([])
      : prisma.productionWaste.findMany({
          where: {
            tenantId: params.tenantId,
            date: { gte: params.fromDate, lte: params.toDate },
            ...(params.productId ? { productId: params.productId } : {}),
          },
          include: {
            product: { select: { code: true, nameAr: true, unit: true } },
            productionOrder: { select: { orderNumber: true } },
          },
          orderBy: { date: 'desc' },
        }),
    source === 'production'
      ? Promise.resolve([])
      : prisma.stockAdjustment.findMany({
          where: {
            tenantId: params.tenantId,
            date: { gte: params.fromDate, lte: params.toDate },
            ...(params.productId ? { productId: params.productId } : {}),
            reason: 'lost',
            applyToStock: true,
            OR: [
              { sourceType: null },
              { sourceType: { not: AUTO_PRODUCTION_WASTE_SOURCE } },
            ],
          },
          include: {
            product: { select: { code: true, nameAr: true, unit: true } },
          },
          orderBy: { date: 'desc' },
        }),
  ]);

  const rows: WasteReportRow[] = [
    ...productionWastes.map((waste) => ({
      id: `production:${waste.id}`,
      date: waste.date,
      productId: waste.productId,
      productName: waste.product?.nameAr || '—',
      productCode: waste.product?.code || '—',
      unit: waste.product?.unit || '',
      quantity: Number(waste.quantity || 0),
      source: 'production' as const,
      sourceLabel: 'أمر إنتاج',
      reference: waste.productionOrder?.orderNumber || '—',
      notes: waste.notes || '',
    })),
    ...inventoryWastes.map((adjustment) => ({
      id: `inventory:${adjustment.id}`,
      date: adjustment.date,
      productId: adjustment.productId,
      productName: adjustment.product?.nameAr || '—',
      productCode: adjustment.product?.code || '—',
      unit: adjustment.product?.unit || '',
      quantity: Number(adjustment.quantity || 0),
      source: 'inventory' as const,
      sourceLabel: 'تسوية مخزون',
      reference: adjustment.adjustmentNumber,
      notes: adjustment.notes || '',
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  const summary = rows.reduce(
    (acc, row) => {
      acc.recordCount += 1;
      acc.totalWaste += row.quantity;
      if (row.source === 'production') acc.productionWaste += row.quantity;
      if (row.source === 'inventory') acc.inventoryWaste += row.quantity;
      return acc;
    },
    { recordCount: 0, totalWaste: 0, productionWaste: 0, inventoryWaste: 0 },
  );

  const byProductMap = new Map<
    string,
    {
      productId: string;
      productName: string;
      productCode: string;
      unit: string;
      totalQuantity: number;
      productionQuantity: number;
      inventoryQuantity: number;
      recordCount: number;
    }
  >();

  for (const row of rows) {
    const existing = byProductMap.get(row.productId);
    if (existing) {
      existing.totalQuantity += row.quantity;
      existing.recordCount += 1;
      if (row.source === 'production') existing.productionQuantity += row.quantity;
      if (row.source === 'inventory') existing.inventoryQuantity += row.quantity;
      continue;
    }
    byProductMap.set(row.productId, {
      productId: row.productId,
      productName: row.productName,
      productCode: row.productCode,
      unit: row.unit,
      totalQuantity: row.quantity,
      productionQuantity: row.source === 'production' ? row.quantity : 0,
      inventoryQuantity: row.source === 'inventory' ? row.quantity : 0,
      recordCount: 1,
    });
  }

  const byProduct = Array.from(byProductMap.values()).sort(
    (a, b) => b.totalQuantity - a.totalQuantity,
  );

  return { rows, summary, byProduct };
}
