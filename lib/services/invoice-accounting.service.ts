/**
 * Single path for building balanced invoice journal lines inside transactions.
 */

import { Prisma } from '@prisma/client';
import type { PostingProfile } from '@/lib/services/accounting-posting-profile.service';
import { assertJournalEntryCanPost } from '@/lib/services/posting-guard.service';
import { chartOfAccounts } from '@/lib/accounting';

export const INVOICE_ACCOUNTS = {
  CASH: '1001',
  AR: '1020',
  INVENTORY: '1030',
  AP: '2010',
  TAX_PAYABLE: '2030',
  REVENUE: '4010',
  COGS: '5010',
  ADJUSTMENT: '5070',
} as const;

const DEFAULT_PROFILE: PostingProfile = {
  cash: INVOICE_ACCOUNTS.CASH,
  ar: INVOICE_ACCOUNTS.AR,
  ap: INVOICE_ACCOUNTS.AP,
  inventory: INVOICE_ACCOUNTS.INVENTORY,
  revenue: INVOICE_ACCOUNTS.REVENUE,
  cogs: INVOICE_ACCOUNTS.COGS,
  taxPayable: INVOICE_ACCOUNTS.TAX_PAYABLE,
  taxInput: INVOICE_ACCOUNTS.TAX_PAYABLE,
  adjustment: INVOICE_ACCOUNTS.ADJUSTMENT,
  wip: '6001',
  laborExpense: '5020',
  overheadExpense: '5060',
};

function resolveProfile(profile?: PostingProfile): PostingProfile {
  return profile ?? DEFAULT_PROFILE;
}

async function ensureChartOfAccountsInTransaction(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  for (const [code, account] of Object.entries(chartOfAccounts)) {
    await tx.account.upsert({
      where: { tenantId_code: { tenantId, code } },
      update: {},
      create: {
        code,
        nameAr: account.nameAr,
        nameEn: account.nameEn,
        type: account.type,
        subType: account.subType,
        isActive: true,
        tenantId,
      },
    });
  }
}

export interface JournalLineDraft {
  accountCode: string;
  debit: number;
  credit: number;
  description: string;
  tenantId: string;
}

export function buildSalesInvoiceJournalLines(
  params: {
    invoiceNumber: string;
    netSubtotal: number;
    tax: number;
    grandTotal: number;
    totalCogs: number;
    tenantId: string;
  },
  profile?: PostingProfile,
): JournalLineDraft[] {
  const { invoiceNumber, netSubtotal, tax, grandTotal, totalCogs, tenantId } = params;
  const p = resolveProfile(profile);
  const lines: JournalLineDraft[] = [
    {
      accountCode: p.ar,
      debit: grandTotal,
      credit: 0,
      description: `AR — ${invoiceNumber}`,
      tenantId,
    },
    {
      accountCode: p.revenue,
      debit: 0,
      credit: netSubtotal,
      description: `Revenue — ${invoiceNumber}`,
      tenantId,
    },
  ];
  if (tax > 0.001) {
    lines.push({
      accountCode: p.taxPayable,
      debit: 0,
      credit: tax,
      description: `Tax — ${invoiceNumber}`,
      tenantId,
    });
  }
  if (totalCogs > 0.001) {
    lines.push(
      {
        accountCode: p.cogs,
        debit: totalCogs,
        credit: 0,
        description: `COGS — ${invoiceNumber}`,
        tenantId,
      },
      {
        accountCode: p.inventory,
        debit: 0,
        credit: totalCogs,
        description: `Inventory COGS — ${invoiceNumber}`,
        tenantId,
      },
    );
  }
  return lines;
}

export function buildPurchaseInvoiceJournalLines(
  params: {
    invoiceNumber: string;
    inventoryValue: number;
    tax: number;
    grandTotal: number;
    tenantId: string;
  },
  profile?: PostingProfile,
): JournalLineDraft[] {
  const { invoiceNumber, inventoryValue, tax, grandTotal, tenantId } = params;
  const p = resolveProfile(profile);
  const lines: JournalLineDraft[] = [
    {
      accountCode: p.inventory,
      debit: inventoryValue,
      credit: 0,
      description: `Inventory — ${invoiceNumber}`,
      tenantId,
    },
  ];
  if (tax > 0.001) {
    lines.push({
      accountCode: p.taxInput,
      debit: tax,
      credit: 0,
      description: `Input tax — ${invoiceNumber}`,
      tenantId,
    });
  }
  lines.push({
    accountCode: p.ap ?? INVOICE_ACCOUNTS.AP,
    debit: 0,
    credit: grandTotal,
    description: `AP — ${invoiceNumber}`,
    tenantId,
  });
  return lines;
}

export function buildSalesReturnJournalLines(
  params: {
    returnNumber: string;
    netSubtotal: number;
    tax: number;
    grandTotal: number;
    totalCogs: number;
    tenantId: string;
  },
  profile?: PostingProfile,
): JournalLineDraft[] {
  const sales = buildSalesInvoiceJournalLines(
    {
      invoiceNumber: params.returnNumber,
      netSubtotal: params.netSubtotal,
      tax: params.tax,
      grandTotal: params.grandTotal,
      totalCogs: params.totalCogs,
      tenantId: params.tenantId,
    },
    profile,
  );
  return sales.map(l => ({ ...l, debit: l.credit, credit: l.debit }));
}

export function buildPaymentJournalLines(
  params: {
    amount: number;
    type: 'incoming' | 'outgoing';
    tenantId: string;
    reference: string;
  },
  profile?: PostingProfile,
): JournalLineDraft[] {
  const { amount, type, tenantId, reference } = params;
  const p = resolveProfile(profile);
  if (type === 'incoming') {
    return [
      {
        accountCode: p.cash,
        debit: amount,
        credit: 0,
        description: `Cash received — ${reference}`,
        tenantId,
      },
      {
        accountCode: p.ar,
        debit: 0,
        credit: amount,
        description: `AR reduction — ${reference}`,
        tenantId,
      },
    ];
  }
  return [
    {
      accountCode: p.ap,
      debit: amount,
      credit: 0,
      description: `AP reduction — ${reference}`,
      tenantId,
    },
    {
      accountCode: p.cash,
      debit: 0,
      credit: amount,
      description: `Cash paid — ${reference}`,
      tenantId,
    },
  ];
}

export async function postJournalLinesInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    userId: string;
    entryDate: Date;
    description: string;
    referenceType: string;
    referenceId: string;
    lines: JournalLineDraft[];
    correlationId?: string;
  },
): Promise<{ id: string }> {
  await ensureChartOfAccountsInTransaction(tx, params.tenantId);

  await assertJournalEntryCanPost(tx, {
    tenantId: params.tenantId,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    correlationId: params.correlationId,
  });

  const { nextEntityCode, CODE_ENTITY_KEYS } = await import('@/lib/code-sequence.service');
  const entryNumber = await nextEntityCode(CODE_ENTITY_KEYS.JOURNAL_ENTRY, params.tenantId, tx);

  const totalDebit = params.lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = params.lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(totalDebit - totalCredit) > 0.02) {
    throw new Error(
      `Unbalanced journal entry: debit=${totalDebit} credit=${totalCredit}`,
    );
  }

  const entry = await tx.journalEntry.create({
    data: {
      entryNumber,
      entryDate: params.entryDate,
      description: params.description,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      correlationId: params.correlationId,
      isPosted: true,
      postedDate: new Date(),
      totalDebit,
      totalCredit,
      tenantId: params.tenantId,
      createdBy: params.userId,
      lines: {
        create: params.lines.map(l => ({
          accountCode: l.accountCode,
          debit: l.debit,
          credit: l.credit,
          description: l.description,
          tenantId: l.tenantId,
        })),
      },
    },
    include: { lines: true },
  });

  await updateAccountBalancesInTx(
    tx,
    entry.lines.map(l => ({
      accountCode: l.accountCode,
      debit: Number(l.debit),
      credit: Number(l.credit),
    })),
    params.tenantId,
  );
  return { id: entry.id };
}

export async function updateAccountBalancesInTx(
  tx: Prisma.TransactionClient,
  lines: Array<{ accountCode: string; debit: number; credit: number }>,
  tenantId: string,
): Promise<void> {
  for (const line of lines) {
    const account = await tx.account.findUnique({
      where: { tenantId_code: { tenantId, code: line.accountCode } },
      select: { id: true, type: true },
    });
    if (!account) {
      console.warn(`[invoice-accounting] Account ${line.accountCode} not found`);
      continue;
    }
    const isDebitNormal = ['Asset', 'Expense'].includes(account.type);
    const change = isDebitNormal
      ? line.debit - line.credit
      : line.credit - line.debit;
    await tx.account.update({
      where: { id: account.id },
      data: { balance: { increment: change } },
    });
  }
}
