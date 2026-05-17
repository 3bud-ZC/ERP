import { describe, it, expect } from 'vitest';
import {
  buildSalesInvoiceJournalLines,
  buildPurchaseInvoiceJournalLines,
  buildPaymentJournalLines,
} from '@/lib/services/invoice-accounting.service';

describe('invoice journal line builders', () => {
  it('balances sales invoice entry with COGS', () => {
    const lines = buildSalesInvoiceJournalLines({
      invoiceNumber: 'INV-1',
      netSubtotal: 1000,
      tax: 140,
      grandTotal: 1140,
      totalCogs: 600,
      tenantId: 't1',
    });
    const debit = lines.reduce((s, l) => s + l.debit, 0);
    const credit = lines.reduce((s, l) => s + l.credit, 0);
    expect(Math.abs(debit - credit)).toBeLessThan(0.01);
    expect(debit).toBe(1140 + 600);
  });

  it('balances purchase invoice entry', () => {
    const lines = buildPurchaseInvoiceJournalLines({
      invoiceNumber: 'PI-1',
      inventoryValue: 1000,
      tax: 140,
      grandTotal: 1140,
      tenantId: 't1',
    });
    const debit = lines.reduce((s, l) => s + l.debit, 0);
    const credit = lines.reduce((s, l) => s + l.credit, 0);
    expect(Math.abs(debit - credit)).toBeLessThan(0.01);
  });

  it('balances payment entry', () => {
    const lines = buildPaymentJournalLines({
      amount: 500,
      type: 'incoming',
      tenantId: 't1',
      reference: 'pay1',
    });
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBe(500);
    expect(lines.reduce((s, l) => s + l.credit, 0)).toBe(500);
  });
});
