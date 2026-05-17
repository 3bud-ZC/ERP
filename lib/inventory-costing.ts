/**
 * Inventory Costing Engine
 *
 * FIFO (default) and WAC costing with InventoryValuation + COGSTransaction records.
 * Use createInventoryCostingEngine(tenantId, tx) inside Prisma transactions.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
export class InsufficientCostLayersError extends Error {
  constructor(productId: string, required: number, available: number) {
    super(
      `Insufficient cost layers for product ${productId}. Required: ${required}, available: ${available}`,
    );
    this.name = 'InsufficientCostLayersError';
  }
}

export enum CostingMethod {
  FIFO = 'FIFO',
  WAC = 'WAC',
}

type DbClient = Prisma.TransactionClient | typeof prisma;

export class InventoryCostingEngine {
  private costingMethod: CostingMethod = CostingMethod.FIFO;
  private tenantId?: string;

  constructor(private readonly db: DbClient = prisma) {}

  setCostingMethod(method: CostingMethod): void {
    this.costingMethod = method;
  }

  getCostingMethod(): CostingMethod {
    return this.costingMethod;
  }

  setTenantId(tenantId: string): void {
    this.tenantId = tenantId;
  }

  async recordStockInflow(
    productId: string,
    quantity: number,
    unitCost: number,
    referenceType?: string,
    referenceId?: string,
  ): Promise<void> {
    if (!this.tenantId) {
      throw new Error('tenantId must be set on InventoryCostingEngine');
    }
    if (this.costingMethod === CostingMethod.FIFO) {
      await this.recordFIFOInflow(productId, quantity, unitCost, referenceType, referenceId);
    } else {
      await this.recordWACInflow(productId, quantity, unitCost, referenceType, referenceId);
    }
    await this.updateInventoryValuation(productId);
  }

  async recordStockOutflow(
    productId: string,
    quantity: number,
    referenceType?: string,
    referenceId?: string,
  ): Promise<number> {
    if (!this.tenantId) {
      throw new Error('tenantId must be set on InventoryCostingEngine');
    }
    let cogs = 0;
    if (this.costingMethod === CostingMethod.FIFO) {
      cogs = await this.recordFIFOOutflow(productId, quantity, referenceType, referenceId);
    } else {
      cogs = await this.recordWACOutflow(productId, quantity, referenceType, referenceId);
    }
    await this.updateInventoryValuation(productId);
    return cogs;
  }

  async getCurrentCost(productId: string): Promise<number> {
    const valuation = await this.db.inventoryValuation.findUnique({
      where: { productId },
    });
    if (!valuation || valuation.totalQuantity === 0) {
      const product = await this.db.product.findUnique({
        where: { id: productId },
        select: { cost: true },
      });
      return product?.cost || 0;
    }
    return valuation.averageCost;
  }

  async getInventoryValue(productId: string): Promise<number> {
    const valuation = await this.db.inventoryValuation.findUnique({
      where: { productId },
    });
    return valuation?.totalValue ?? 0;
  }

  private async recordFIFOInflow(
    productId: string,
    quantity: number,
    unitCost: number,
    referenceType?: string,
    referenceId?: string,
  ): Promise<void> {
    await this.db.fIFOLayer.create({
      data: {
        productId,
        quantity,
        unitCost,
        remainingQuantity: quantity,
        transactionDate: new Date(),
        referenceType,
        referenceId,
        tenantId: this.tenantId!,
      },
    });
  }

  private async recordFIFOOutflow(
    productId: string,
    quantity: number,
    referenceType?: string,
    referenceId?: string,
  ): Promise<number> {
    let remainingToDeduct = quantity;
    let totalCOGS = 0;

    const layers = await this.db.fIFOLayer.findMany({
      where: { productId, remainingQuantity: { gt: 0 } },
      orderBy: { transactionDate: 'asc' },
    });

    for (const layer of layers) {
      if (remainingToDeduct <= 0) break;
      const deductQuantity = Math.min(remainingToDeduct, layer.remainingQuantity);
      totalCOGS += deductQuantity * layer.unitCost;
      await this.db.fIFOLayer.update({
        where: { id: layer.id },
        data: { remainingQuantity: layer.remainingQuantity - deductQuantity },
      });
      remainingToDeduct -= deductQuantity;
    }

    if (remainingToDeduct > 0) {
      const available = quantity - remainingToDeduct;
      throw new InsufficientCostLayersError(productId, quantity, available);
    }

    if (totalCOGS > 0) {
      await this.db.cOGSTransaction.create({
        data: {
          productId,
          quantity,
          totalCost: totalCOGS,
          averageCost: totalCOGS / quantity,
          referenceType,
          referenceId,
          date: new Date(),
          tenantId: this.tenantId!,
        },
      });
    }

    return totalCOGS;
  }

  private async recordWACInflow(
    productId: string,
    quantity: number,
    unitCost: number,
    referenceType?: string,
    referenceId?: string,
  ): Promise<void> {
    const valuation = await this.db.inventoryValuation.findUnique({
      where: { productId },
    });

    let newAverageCost = unitCost;
    let newTotalQuantity = quantity;
    let newTotalValue = quantity * unitCost;

    if (valuation && valuation.totalQuantity > 0) {
      newTotalQuantity = valuation.totalQuantity + quantity;
      newTotalValue = valuation.totalValue + quantity * unitCost;
      newAverageCost = newTotalValue / newTotalQuantity;
    }

    await this.db.inventoryValuation.upsert({
      where: { productId },
      update: {
        totalQuantity: newTotalQuantity,
        totalValue: newTotalValue,
        averageCost: newAverageCost,
        lastUpdated: new Date(),
      },
      create: {
        productId,
        totalQuantity: newTotalQuantity,
        totalValue: newTotalValue,
        averageCost: newAverageCost,
        tenantId: this.tenantId!,
      },
    });

    await this.db.costLayer.create({
      data: {
        productId,
        quantity,
        unitCost,
        referenceType,
        referenceId,
        date: new Date(),
        tenantId: this.tenantId!,
      },
    });
  }

  private async recordWACOutflow(
    productId: string,
    quantity: number,
    referenceType?: string,
    referenceId?: string,
  ): Promise<number> {
    const valuation = await this.db.inventoryValuation.findUnique({
      where: { productId },
    });

    if (!valuation || valuation.totalQuantity < quantity) {
      const available = valuation?.totalQuantity ?? 0;
      throw new InsufficientCostLayersError(productId, quantity, available);
    }

    const cogs = valuation.averageCost * quantity;

    await this.db.inventoryValuation.update({
      where: { productId },
      data: {
        totalQuantity: { decrement: quantity },
        totalValue: { decrement: cogs },
        lastUpdated: new Date(),
      },
    });

    await this.db.cOGSTransaction.create({
      data: {
        productId,
        quantity,
        totalCost: cogs,
        averageCost: valuation.averageCost,
        referenceType,
        referenceId,
        date: new Date(),
        tenantId: this.tenantId!,
      },
    });

    return cogs;
  }

  /** Recompute InventoryValuation snapshot from FIFO layers (no stock movement). */
  async refreshValuation(productId: string): Promise<void> {
    await this.updateInventoryValuation(productId);
  }

  private async updateInventoryValuation(productId: string): Promise<void> {
    if (this.costingMethod === CostingMethod.FIFO) {
      await this.updateFIFOValuation(productId);
    }
  }

  private async updateFIFOValuation(productId: string): Promise<void> {
    const layers = await this.db.fIFOLayer.findMany({
      where: { productId, remainingQuantity: { gt: 0 } },
    });

    let totalQuantity = 0;
    let totalValue = 0;
    for (const layer of layers) {
      totalQuantity += layer.remainingQuantity;
      totalValue += layer.remainingQuantity * layer.unitCost;
    }

    const averageCost = totalQuantity > 0 ? totalValue / totalQuantity : 0;

    await this.db.inventoryValuation.upsert({
      where: { productId },
      update: {
        totalQuantity,
        totalValue,
        averageCost,
        lastUpdated: new Date(),
      },
      create: {
        productId,
        totalQuantity,
        totalValue,
        averageCost,
        tenantId: this.tenantId!,
      },
    });
  }

  async getCOGSForPeriod(startDate: Date, endDate: Date): Promise<number> {
    const transactions = await this.db.cOGSTransaction.findMany({
      where: { date: { gte: startDate, lte: endDate }, tenantId: this.tenantId },
    });
    return transactions.reduce((sum, t) => sum + t.totalCost, 0);
  }

  async getInventoryValuationReport(): Promise<
    Array<{
      productId: string;
      productCode: string;
      productName: string | null;
      stock: number;
      valuationQuantity: number;
      valuationValue: number;
      averageCost: number;
      variance: number;
    }>
  > {
    const valuations = await this.db.inventoryValuation.findMany({
      where: this.tenantId ? { tenantId: this.tenantId } : undefined,
      include: {
        product: {
          select: { code: true, nameAr: true, nameEn: true, stock: true },
        },
      },
    });

    return valuations.map(v => ({
      productId: v.productId,
      productCode: v.product.code,
      productName: v.product.nameAr || v.product.nameEn,
      stock: v.product.stock,
      valuationQuantity: v.totalQuantity,
      valuationValue: v.totalValue,
      averageCost: v.averageCost,
      variance: v.product.stock - v.totalQuantity,
    }));
  }
}

export function createInventoryCostingEngine(
  tenantId: string,
  tx?: Prisma.TransactionClient,
): InventoryCostingEngine {
  const engine = new InventoryCostingEngine(tx ?? prisma);
  engine.setTenantId(tenantId);
  return engine;
}

const defaultEngine = new InventoryCostingEngine();

export async function recordStockInflow(
  productId: string,
  quantity: number,
  unitCost: number,
  tenantId: string,
  referenceType?: string,
  referenceId?: string,
): Promise<void> {
  const engine = createInventoryCostingEngine(tenantId);
  await engine.recordStockInflow(productId, quantity, unitCost, referenceType, referenceId);
}

export async function recordStockOutflow(
  productId: string,
  quantity: number,
  tenantId: string,
  referenceType?: string,
  referenceId?: string,
): Promise<number> {
  const engine = createInventoryCostingEngine(tenantId);
  return engine.recordStockOutflow(productId, quantity, referenceType, referenceId);
}

export async function getCurrentCost(productId: string): Promise<number> {
  return defaultEngine.getCurrentCost(productId);
}

export async function getInventoryValue(productId: string): Promise<number> {
  return defaultEngine.getInventoryValue(productId);
}
