/**
 * Manufacturing journal line builders — canonical posting (Phase 6A).
 */

import type { PostingProfile } from '@/lib/services/accounting-posting-profile.service';
import type { JournalLineDraft } from '@/lib/services/invoice-accounting.service';

export const PRODUCTION_REF = {
  RM: 'ProductionOrder:RM',
  LABOR: 'ProductionOrder:Labor',
  OVERHEAD: 'ProductionOrder:Overhead',
  COMPLETE: 'ProductionOrder:Complete',
} as const;

export function buildRawMaterialConsumptionLines(
  amount: number,
  tenantId: string,
  profile: PostingProfile,
): JournalLineDraft[] {
  if (amount <= 0.001) return [];
  return [
    {
      accountCode: profile.wip,
      debit: amount,
      credit: 0,
      description: 'Raw materials to WIP',
      tenantId,
    },
    {
      accountCode: profile.inventory,
      debit: 0,
      credit: amount,
      description: 'Raw materials consumed',
      tenantId,
    },
  ];
}

export function buildManufacturingLaborLines(
  amount: number,
  tenantId: string,
  profile: PostingProfile,
): JournalLineDraft[] {
  if (amount <= 0.001) return [];
  return [
    {
      accountCode: profile.wip,
      debit: amount,
      credit: 0,
      description: 'Direct labor to WIP',
      tenantId,
    },
    {
      accountCode: profile.laborExpense,
      debit: 0,
      credit: amount,
      description: 'Direct labor expense',
      tenantId,
    },
  ];
}

export function buildManufacturingOverheadLines(
  amount: number,
  tenantId: string,
  profile: PostingProfile,
): JournalLineDraft[] {
  if (amount <= 0.001) return [];
  return [
    {
      accountCode: profile.wip,
      debit: amount,
      credit: 0,
      description: 'Overhead to WIP',
      tenantId,
    },
    {
      accountCode: profile.overheadExpense,
      debit: 0,
      credit: amount,
      description: 'Manufacturing overhead',
      tenantId,
    },
  ];
}

export function buildProductionCompletionLines(
  totalCost: number,
  tenantId: string,
  profile: PostingProfile,
): JournalLineDraft[] {
  if (totalCost <= 0.001) return [];
  return [
    {
      accountCode: profile.inventory,
      debit: totalCost,
      credit: 0,
      description: 'Finished goods from production',
      tenantId,
    },
    {
      accountCode: profile.wip,
      debit: 0,
      credit: totalCost,
      description: 'WIP cleared to finished goods',
      tenantId,
    },
  ];
}
