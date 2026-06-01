/**
 * Unified auto-code generation (Phase 2A).
 * Transaction-safe, per-tenant, per-year sequences with backward-compatible floors.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from './db';

export const CODE_ENTITY_KEYS = {
  CUSTOMER: 'CUSTOMER',
  SUPPLIER: 'SUPPLIER',
  RAW_MATERIAL: 'RAW_MATERIAL',
  FINISHED_PRODUCT: 'FINISHED_PRODUCT',
  WAREHOUSE: 'WAREHOUSE',
  SALES_INVOICE: 'SALES_INVOICE',
  PURCHASE_INVOICE: 'PURCHASE_INVOICE',
  PRODUCTION_ORDER: 'PRODUCTION_ORDER',
  PRODUCTION_LINE: 'PRODUCTION_LINE',
  JOURNAL_ENTRY: 'JOURNAL_ENTRY',
  STOCK_TRANSFER: 'STOCK_TRANSFER',
  GOODS_RECEIPT: 'GOODS_RECEIPT',
  STOCK_ADJUSTMENT: 'STOCK_ADJUSTMENT',
  CASHBOX: 'CASHBOX',
} as const;

export type CodeEntityKey = (typeof CODE_ENTITY_KEYS)[keyof typeof CODE_ENTITY_KEYS];

const ENTITY_PREFIX: Record<CodeEntityKey, string> = {
  CUSTOMER: 'CUS',
  SUPPLIER: 'VEN',
  RAW_MATERIAL: 'RAW',
  FINISHED_PRODUCT: 'PRD',
  WAREHOUSE: 'WRH',
  SALES_INVOICE: 'SAL',
  PURCHASE_INVOICE: 'PUR',
  PRODUCTION_ORDER: 'PO',
  PRODUCTION_LINE: 'PL',
  JOURNAL_ENTRY: 'JE',
  STOCK_TRANSFER: 'ST',
  GOODS_RECEIPT: 'GR',
  STOCK_ADJUSTMENT: 'ADJ',
  CASHBOX: 'CB',
};

/** Legacy prefixes still honored when seeding sequence floor */
const LEGACY_PREFIXES: Partial<Record<CodeEntityKey, string[]>> = {
  SUPPLIER: ['SUP'],
  RAW_MATERIAL: ['RM'],
  FINISHED_PRODUCT: ['FG', 'PR'],
  WAREHOUSE: ['WH'],
  SALES_INVOICE: ['INV', 'SI'],
  PURCHASE_INVOICE: ['PINV', 'PI'],
  STOCK_ADJUSTMENT: ['SA'],
};

const SEQ_PAD = 5;
const MAX_UNIQUE_RETRIES = 500;

type DbClient = Prisma.TransactionClient | typeof prisma;

export function formatEntityCode(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(SEQ_PAD, '0')}`;
}

export function parseSequenceFromCode(
  code: string,
  prefixes: string[],
  year: number,
): number {
  let max = 0;
  for (const prefix of prefixes) {
    const standard = new RegExp(`^${prefix}-${year}-(\\d+)$`, 'i');
    const m = code.match(standard);
    if (m) {
      max = Math.max(max, parseInt(m[1], 10));
    }
  }
  // Legacy journal: JE2026000001
  if (prefixes.includes('JE')) {
    const legacyJe = code.match(/^JE(\d{4})(\d+)$/i);
    if (legacyJe && parseInt(legacyJe[1], 10) === year) {
      max = Math.max(max, parseInt(legacyJe[2], 10));
    }
  }
  return max;
}

function prefixesFor(entityKey: CodeEntityKey): string[] {
  const primary = ENTITY_PREFIX[entityKey];
  const legacy = LEGACY_PREFIXES[entityKey] ?? [];
  return [primary, ...legacy.filter((p) => p !== primary)];
}

function maxFromCodes(codes: string[], entityKey: CodeEntityKey, year: number): number {
  const prefixes = prefixesFor(entityKey);
  return codes.reduce((max, code) => Math.max(max, parseSequenceFromCode(code, prefixes, year)), 0);
}

/**
 * Scan existing rows so new sequences never collide with legacy/manual codes.
 */
export async function computeSequenceFloor(
  db: DbClient,
  tenantId: string,
  entityKey: CodeEntityKey,
  year: number,
): Promise<number> {
  const prefixes = prefixesFor(entityKey);
  const codeOr = (field: 'code' | 'invoiceNumber' | 'orderNumber' | 'entryNumber' | 'transferNumber' | 'receiptNumber' | 'adjustmentNumber') =>
    prefixes.map((p) => ({ [field]: { startsWith: `${p}-${year}-` } }));

  const collect = async (codes: string[]) => maxFromCodes(codes, entityKey, year);

  switch (entityKey) {
    case 'CUSTOMER': {
      const rows = await db.customer.findMany({
        where: { tenantId, OR: codeOr('code') },
        select: { code: true },
      });
      return collect(rows.map((r) => r.code));
    }
    case 'SUPPLIER': {
      const rows = await db.supplier.findMany({
        where: { tenantId, OR: codeOr('code') },
        select: { code: true },
      });
      return collect(rows.map((r) => r.code));
    }
    case 'RAW_MATERIAL': {
      const rows = await db.product.findMany({
        where: { tenantId, type: 'raw_material', OR: codeOr('code') },
        select: { code: true },
      });
      return collect(rows.map((r) => r.code));
    }
    case 'FINISHED_PRODUCT': {
      const rows = await db.product.findMany({
        where: {
          tenantId,
          type: 'finished_product',
          OR: [...codeOr('code'), { code: { startsWith: `PRD-${year}-` } }],
        },
        select: { code: true },
      });
      return collect(rows.map((r) => r.code));
    }
    case 'WAREHOUSE': {
      const rows = await db.warehouse.findMany({
        where: { tenantId, OR: codeOr('code') },
        select: { code: true },
      });
      return collect(rows.map((r) => r.code));
    }
    case 'SALES_INVOICE': {
      const rows = await db.salesInvoice.findMany({
        where: { tenantId, OR: codeOr('invoiceNumber') },
        select: { invoiceNumber: true },
      });
      return collect(rows.map((r) => r.invoiceNumber));
    }
    case 'PURCHASE_INVOICE': {
      const rows = await db.purchaseInvoice.findMany({
        where: { tenantId, OR: codeOr('invoiceNumber') },
        select: { invoiceNumber: true },
      });
      return collect(rows.map((r) => r.invoiceNumber));
    }
    case 'PRODUCTION_ORDER': {
      const rows = await db.productionOrder.findMany({
        where: { tenantId, OR: codeOr('orderNumber') },
        select: { orderNumber: true },
      });
      return collect(rows.map((r) => r.orderNumber));
    }
    case 'PRODUCTION_LINE': {
      const rows = await (db as any).productionLine.findMany({
        where: { tenantId, OR: codeOr('code') },
        select: { code: true },
      });
      return collect(rows.map((r: { code: string }) => r.code));
    }
    case 'JOURNAL_ENTRY': {
      const rows = await db.journalEntry.findMany({
        // entryNumber is globally unique in current schema, so floor must be global too.
        // Otherwise a new tenant may collide with previously used JE numbers in other tenants.
        select: { entryNumber: true },
      });
      return collect(rows.map((r) => r.entryNumber));
    }
    case 'STOCK_TRANSFER': {
      const rows = await db.stockTransfer.findMany({
        where: { tenantId, OR: codeOr('transferNumber') },
        select: { transferNumber: true },
      });
      return collect(rows.map((r) => r.transferNumber));
    }
    case 'GOODS_RECEIPT': {
      const rows = await db.goodsReceipt.findMany({
        where: { tenantId, OR: codeOr('receiptNumber') },
        select: { receiptNumber: true },
      });
      return collect(rows.map((r) => r.receiptNumber));
    }
    case 'STOCK_ADJUSTMENT': {
      const rows = await db.stockAdjustment.findMany({
        where: { tenantId, OR: codeOr('adjustmentNumber') },
        select: { adjustmentNumber: true },
      });
      return collect(rows.map((r) => r.adjustmentNumber));
    }
    case 'CASHBOX': {
      const rows = await (db as any).cashbox.findMany({
        where: { tenantId, OR: codeOr('code') },
        select: { code: true },
      });
      return collect(rows.map((r: { code: string }) => r.code));
    }
    default:
      return 0;
  }
}

async function ensureSequenceRow(
  client: Prisma.TransactionClient,
  tenantId: string,
  entityKey: CodeEntityKey,
  year: number,
): Promise<void> {
  const existing = await client.codeSequence.findUnique({
    where: { tenantId_entityKey_year: { tenantId, entityKey, year } },
  });
  if (existing) return;

  const floor = await computeSequenceFloor(client, tenantId, entityKey, year);
  await client.codeSequence.create({
    data: { tenantId, entityKey, year, lastValue: floor },
  });
}

/**
 * Allocate next code inside a transaction (Serializable when standalone).
 */
export async function nextEntityCode(
  entityKey: CodeEntityKey,
  tenantId: string,
  tx?: Prisma.TransactionClient,
  year: number = new Date().getFullYear(),
): Promise<string> {
  const allocate = async (client: Prisma.TransactionClient): Promise<string> => {
    await ensureSequenceRow(client, tenantId, entityKey, year);
    const prefix = ENTITY_PREFIX[entityKey];

    for (let attempt = 0; attempt < MAX_UNIQUE_RETRIES; attempt++) {
      const row = await client.codeSequence.update({
        where: { tenantId_entityKey_year: { tenantId, entityKey, year } },
        data: { lastValue: { increment: 1 } },
      });
      const code = formatEntityCode(prefix, year, row.lastValue);
      if (await isCodeAvailable(client, entityKey, code)) {
        return code;
      }
    }
    // Final safe fallback for very rare high-contention/global-unique collisions
    // (notably JOURNAL_ENTRY). Keep prefix/year format and force uniqueness by suffix.
    const emergencySeq = Date.now().toString().slice(-8);
    const emergencyCode = `${prefix}-${year}-${emergencySeq}`;
    if (await isCodeAvailable(client, entityKey, emergencyCode)) {
      return emergencyCode;
    }
    throw new Error(`Failed to allocate unique code for ${entityKey} after ${MAX_UNIQUE_RETRIES} attempts`);
  };

  if (tx) {
    return allocate(tx);
  }

  return prisma.$transaction(allocate, {
    isolationLevel: 'Serializable',
    maxWait: 10000,
    timeout: 30000,
  });
}

/**
 * Allocate next code — backend only; never accepts client input.
 */
export async function allocateEntityCode(
  entityKey: CodeEntityKey,
  tenantId: string,
  tx?: Prisma.TransactionClient,
  year: number = new Date().getFullYear(),
): Promise<string> {
  return nextEntityCode(entityKey, tenantId, tx, year);
}

/** @deprecated Client-provided codes are ignored — use allocateEntityCode */
export async function resolveEntityCode(
  _provided: string | null | undefined,
  entityKey: CodeEntityKey,
  tenantId: string,
  tx?: Prisma.TransactionClient,
  year: number = new Date().getFullYear(),
): Promise<string> {
  return allocateEntityCode(entityKey, tenantId, tx, year);
}

export function productCodeEntityKey(productType: string): CodeEntityKey {
  return productType === 'raw_material'
    ? CODE_ENTITY_KEYS.RAW_MATERIAL
    : CODE_ENTITY_KEYS.FINISHED_PRODUCT;
}

async function isCodeAvailable(
  client: Prisma.TransactionClient,
  entityKey: CodeEntityKey,
  code: string,
): Promise<boolean> {
  switch (entityKey) {
    case 'CUSTOMER':
      return (
        await client.customer.findFirst({ where: { code }, select: { id: true } })
      ) === null;
    case 'SUPPLIER':
      return (
        await client.supplier.findFirst({ where: { code }, select: { id: true } })
      ) === null;
    case 'RAW_MATERIAL':
    case 'FINISHED_PRODUCT':
      return (
        await client.product.findFirst({ where: { code }, select: { id: true } })
      ) === null;
    case 'WAREHOUSE':
      return (
        await client.warehouse.findFirst({ where: { code }, select: { id: true } })
      ) === null;
    case 'SALES_INVOICE':
      return (await client.salesInvoice.findUnique({ where: { invoiceNumber: code }, select: { id: true } })) === null;
    case 'PURCHASE_INVOICE':
      return (await client.purchaseInvoice.findUnique({ where: { invoiceNumber: code }, select: { id: true } })) === null;
    case 'PRODUCTION_ORDER':
      return (await client.productionOrder.findUnique({ where: { orderNumber: code }, select: { id: true } })) === null;
    case 'PRODUCTION_LINE':
      return (await (client as any).productionLine.findUnique({ where: { code }, select: { id: true } })) === null;
    case 'JOURNAL_ENTRY':
      return (await client.journalEntry.findUnique({ where: { entryNumber: code }, select: { id: true } })) === null;
    case 'STOCK_TRANSFER':
      return (await client.stockTransfer.findUnique({ where: { transferNumber: code }, select: { id: true } })) === null;
    case 'GOODS_RECEIPT':
      return (await client.goodsReceipt.findUnique({ where: { receiptNumber: code }, select: { id: true } })) === null;
    case 'STOCK_ADJUSTMENT':
      return (await client.stockAdjustment.findUnique({ where: { adjustmentNumber: code }, select: { id: true } })) === null;
    case 'CASHBOX':
      return (await (client as any).cashbox.findUnique({ where: { code }, select: { id: true } })) === null;
    default:
      return true;
  }
}
