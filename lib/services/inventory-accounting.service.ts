import type { PostingProfile } from '@/lib/services/accounting-posting-profile.service';
import type { JournalLineDraft } from '@/lib/services/invoice-accounting.service';

export function buildStockAdjustmentJournalLines(
  type: 'increase' | 'decrease',
  value: number,
  tenantId: string,
  profile: PostingProfile,
): JournalLineDraft[] {
  if (value <= 0.001) return [];
  if (type === 'increase') {
    return [
      {
        accountCode: profile.inventory,
        debit: value,
        credit: 0,
        description: 'Stock adjustment increase',
        tenantId,
      },
      {
        accountCode: profile.adjustment,
        debit: 0,
        credit: value,
        description: 'Adjustment offset',
        tenantId,
      },
    ];
  }
  return [
    {
      accountCode: profile.adjustment,
      debit: value,
      credit: 0,
      description: 'Stock adjustment decrease',
      tenantId,
    },
    {
      accountCode: profile.inventory,
      debit: 0,
      credit: value,
      description: 'Inventory reduction',
      tenantId,
    },
  ];
}
