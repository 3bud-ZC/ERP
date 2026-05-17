import { describe, it, expect } from 'vitest';
import {
  computeInvoiceTotals,
  allocateFreightToLines,
  derivePaymentStatus,
  resolveInitialPayment,
  invoiceAmountDue,
} from '@/lib/utils/invoice-tax';

describe('computeInvoiceTotals', () => {
  it('applies line and header discounts with exclusive tax', () => {
    const r = computeInvoiceTotals({
      lines: [
        { productId: 'p1', quantity: 2, price: 100, discountPercent: 10, taxRate: 14 },
        { productId: 'p2', quantity: 1, price: 50 },
      ],
      headerDiscountPercent: 5,
      taxMode: 'exclusive',
    });
    expect(r.subtotal).toBe(250);
    expect(r.lineDiscountTotal).toBe(20);
    expect(r.headerDiscount).toBeGreaterThan(0);
    expect(r.tax).toBeGreaterThan(0);
    expect(r.grandTotal).toBeGreaterThan(r.netSubtotal);
  });

  it('includes extra charges and freight in grand total', () => {
    const r = computeInvoiceTotals({
      lines: [{ productId: 'p1', quantity: 1, price: 100 }],
      extraCharges: 10,
      freightAmount: 5,
    });
    expect(r.grandTotal).toBe(115);
  });
});

describe('allocateFreightToLines', () => {
  it('increases unit cost proportionally', () => {
    const lines = computeInvoiceTotals({
      lines: [
        { productId: 'a', quantity: 2, price: 100 },
        { productId: 'b', quantity: 1, price: 100 },
      ],
    }).lines;
    const allocated = allocateFreightToLines(lines, 30, 'value');
    const totalUnit = allocated.reduce((s, l) => s + l.unitCost * l.quantity, 0);
    expect(totalUnit).toBeGreaterThan(300);
  });
});

describe('payment helpers', () => {
  it('derives paid when fully paid', () => {
    expect(derivePaymentStatus({ paidAmount: 100, grandTotal: 100 })).toBe('paid');
  });

  it('derives partial', () => {
    expect(derivePaymentStatus({ paidAmount: 40, grandTotal: 100 })).toBe('partial');
  });

  it('maps cash to full payment', () => {
    const r = resolveInitialPayment({ paymentStatus: 'cash', grandTotal: 200 });
    expect(r.paidAmount).toBe(200);
    expect(r.paymentStatus).toBe('paid');
  });

  it('computes amount due', () => {
    expect(invoiceAmountDue(1000, 300)).toBe(700);
  });
});
