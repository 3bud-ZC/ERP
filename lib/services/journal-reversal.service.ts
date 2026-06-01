/**
 * Reverse journal entries inside Prisma transactions.
 */

import { Prisma } from '@prisma/client';

export async function reverseJournalEntriesInTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  referenceType: string,
  referenceId: string,
): Promise<number> {
  const entries = await tx.journalEntry.findMany({
    where: { tenantId, referenceType, referenceId, isPosted: true },
    include: { lines: true },
  });

  let reversed = 0;
  for (const entry of entries) {
    for (const line of entry.lines) {
      const account = await tx.account.findUnique({
        where: { tenantId_code: { tenantId, code: line.accountCode } },
        select: { id: true, type: true },
      });
      if (!account) continue;

      const debit = Number(line.debit);
      const credit = Number(line.credit);
      const isDebitNormal = ['Asset', 'Expense'].includes(account.type);
      const originalChange = isDebitNormal ? debit - credit : credit - debit;

      await tx.account.update({
        where: { id: account.id },
        data: { balance: { increment: -originalChange } },
      });
    }

    await tx.journalEntryLine.deleteMany({ where: { journalEntryId: entry.id } });
    await tx.journalEntry.delete({ where: { id: entry.id } });
    reversed++;
  }

  return reversed;
}

/** Reverse every posted journal entry for a referenceId (optional exact referenceType). */
export async function reverseAllJournalEntriesForReferenceId(
  tx: Prisma.TransactionClient,
  tenantId: string,
  referenceId: string,
  referenceType?: string,
): Promise<number> {
  const entries = await tx.journalEntry.findMany({
    where: {
      tenantId,
      referenceId,
      isPosted: true,
      ...(referenceType ? { referenceType } : {}),
    },
    include: { lines: true },
  });

  let reversed = 0;
  for (const entry of entries) {
    for (const line of entry.lines) {
      const account = await tx.account.findUnique({
        where: { tenantId_code: { tenantId, code: line.accountCode } },
        select: { id: true, type: true },
      });
      if (!account) continue;

      const debit = Number(line.debit);
      const credit = Number(line.credit);
      const isDebitNormal = ['Asset', 'Expense'].includes(account.type);
      const originalChange = isDebitNormal ? debit - credit : credit - debit;

      await tx.account.update({
        where: { id: account.id },
        data: { balance: { increment: -originalChange } },
      });
    }

    await tx.journalEntryLine.deleteMany({ where: { journalEntryId: entry.id } });
    await tx.journalEntry.delete({ where: { id: entry.id } });
    reversed++;
  }

  return reversed;
}

/** Reverse all posted entries for a business document (e.g. production order sub-types). */
export async function reverseJournalEntriesByReferenceId(
  tx: Prisma.TransactionClient,
  tenantId: string,
  referenceId: string,
  referenceTypePrefix = 'ProductionOrder',
): Promise<number> {
  const entries = await tx.journalEntry.findMany({
    where: {
      tenantId,
      referenceId,
      referenceType: { startsWith: referenceTypePrefix },
      isPosted: true,
    },
    include: { lines: true },
  });

  let reversed = 0;
  for (const entry of entries) {
    for (const line of entry.lines) {
      const account = await tx.account.findUnique({
        where: { tenantId_code: { tenantId, code: line.accountCode } },
        select: { id: true, type: true },
      });
      if (!account) continue;

      const debit = Number(line.debit);
      const credit = Number(line.credit);
      const isDebitNormal = ['Asset', 'Expense'].includes(account.type);
      const originalChange = isDebitNormal ? debit - credit : credit - debit;

      await tx.account.update({
        where: { id: account.id },
        data: { balance: { increment: -originalChange } },
      });
    }

    await tx.journalEntryLine.deleteMany({ where: { journalEntryId: entry.id } });
    await tx.journalEntry.delete({ where: { id: entry.id } });
    reversed++;
  }

  return reversed;
}
