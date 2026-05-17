import { describe, it, expect } from 'vitest';
import {
  buildSalesInvoiceJournalLines,
  buildSalesReturnJournalLines,
} from '@/lib/services/invoice-accounting.service';
import type { PostingProfile } from '@/lib/services/accounting-posting-profile.service';
import { computeInvoiceTotals } from '@/lib/utils/invoice-tax';

function isPostedLifecycleStatus(status?: string | null): boolean {
  if (!status) return false;
  const posted = new Set(['posted', 'paid', 'pending', 'partial', 'unpaid', 'overdue', 'approved']);
  return posted.has(status) && status !== 'draft' && status !== 'cancelled';
}

const customProfile: PostingProfile = {
  cash: '1100',
  ar: '1200',
  ap: '2100',
  inventory: '1300',
  revenue: '4100',
  cogs: '5100',
  taxPayable: '2200',
  taxInput: '2210',
  adjustment: '5900',
  wip: '6001',
  laborExpense: '5020',
  overheadExpense: '5060',
};

describe('Phase 5B — posting profile', () => {
  it('uses tenant profile account codes in sales JE', () => {
    const lines = buildSalesInvoiceJournalLines(
      {
        invoiceNumber: 'INV-1',
        netSubtotal: 100,
        tax: 15,
        grandTotal: 115,
        totalCogs: 40,
        tenantId: 't1',
      },
      customProfile,
    );
    expect(lines.find(l => l.accountCode === '1200')?.debit).toBe(115);
    expect(lines.find(l => l.accountCode === '4100')?.credit).toBe(100);
    expect(lines.find(l => l.accountCode === '5100')?.debit).toBe(40);
  });

  it('reverses sales invoice lines for returns', () => {
    const lines = buildSalesReturnJournalLines(
      {
        returnNumber: 'SR-1',
        netSubtotal: 50,
        tax: 0,
        grandTotal: 50,
        totalCogs: 20,
        tenantId: 't1',
      },
      customProfile,
    );
    expect(lines.find(l => l.accountCode === '1200')?.credit).toBe(50);
    expect(lines.find(l => l.accountCode === '5100')?.credit).toBe(20);
  });
});

describe('Phase 5B — lifecycle guards', () => {
  it('treats posted/paid as posted lifecycle', () => {
    expect(isPostedLifecycleStatus('posted')).toBe(true);
    expect(isPostedLifecycleStatus('paid')).toBe(true);
    expect(isPostedLifecycleStatus('draft')).toBe(false);
    expect(isPostedLifecycleStatus('cancelled')).toBe(false);
  });
});

describe('Phase 5B — edit totals', () => {
  it('recalculates grand total when qty changes', () => {
    const first = computeInvoiceTotals({
      lines: [{ productId: 'p1', quantity: 2, price: 10 }],
      headerTaxRate: 15,
    });
    const second = computeInvoiceTotals({
      lines: [{ productId: 'p1', quantity: 5, price: 10 }],
      headerTaxRate: 15,
    });
    expect(second.grandTotal).toBeGreaterThan(first.grandTotal);
  });
});

