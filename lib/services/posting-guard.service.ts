/**
 * Document posting state guards — prevent duplicate JE / double-post.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { InvoiceExecutionError } from '@/lib/services/invoice-execution.service';

export type DocumentLifecycleStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'posted'
  | 'paid'
  | 'partial'
  | 'unpaid'
  | 'overdue'
  | 'reversed'
  | 'cancelled'
  | 'credited';

export function isPostedLifecycleStatus(status?: string | null): boolean {
  if (!status) return false;
  const posted = new Set([
    'posted',
    'paid',
    'pending',
    'partial',
    'unpaid',
    'overdue',
    'credit',
    'credited',
    'approved',
  ]);
  return posted.has(status) && status !== 'draft' && status !== 'cancelled';
}

export async function assertInvoiceNotCancelled(
  status?: string | null,
): Promise<void> {
  if (status === 'cancelled' || status === 'reversed') {
    throw new InvoiceExecutionError(
      'VALIDATION_FAILED',
      'Cannot modify a cancelled or reversed document',
    );
  }
}

/** True if a posted journal entry already exists for this business reference. */
export async function hasPostedJournalEntry(
  tx: Prisma.TransactionClient | typeof prisma,
  tenantId: string,
  referenceType: string,
  referenceId: string,
): Promise<boolean> {
  const entry = await tx.journalEntry.findFirst({
    where: {
      tenantId,
      referenceType,
      referenceId,
      isPosted: true,
    },
    select: { id: true },
  });
  return !!entry;
}

export async function assertCanPostInvoice(
  tx: Prisma.TransactionClient,
  tenantId: string,
  referenceType: 'SalesInvoice' | 'PurchaseInvoice',
  referenceId: string,
  idempotencyKey?: string,
): Promise<void> {
  if (idempotencyKey) {
    const dup = await tx.journalEntry.findFirst({
      where: {
        tenantId,
        correlationId: idempotencyKey,
        isPosted: true,
      },
    });
    if (dup) {
      throw new InvoiceExecutionError(
        'VALIDATION_FAILED',
        'Duplicate posting request (idempotency key already used)',
      );
    }
  }

  const exists = await hasPostedJournalEntry(tx, tenantId, referenceType, referenceId);
  if (exists) {
    throw new InvoiceExecutionError(
      'VALIDATION_FAILED',
      `Document ${referenceType} is already posted to the ledger`,
    );
  }
}

/** Prevent duplicate GL posting for any reference (manufacturing, etc.). */
export async function assertCanPostReference(
  tx: Prisma.TransactionClient,
  tenantId: string,
  referenceType: string,
  referenceId: string,
): Promise<void> {
  const exists = await hasPostedJournalEntry(tx, tenantId, referenceType, referenceId);
  if (exists) {
    throw new InvoiceExecutionError(
      'VALIDATION_FAILED',
      `Reference ${referenceType} is already posted to the ledger`,
    );
  }
}

export async function assertReturnNotAlreadyApproved(
  status: string,
): Promise<void> {
  if (status === 'approved') {
    throw new InvoiceExecutionError(
      'VALIDATION_FAILED',
      'Return is already approved and posted',
    );
  }
}
