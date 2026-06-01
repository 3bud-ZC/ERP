/**
 * Reusable invoice tax & totals engine (exclusive tax by default).
 * Supports line discounts, header discounts, extra charges, and purchase freight allocation.
 */

export type TaxMode = 'exclusive' | 'inclusive';

export interface InvoiceLineInput {
  productId: string;
  quantity: number;
  price: number;
  unitCost?: number;
  warehouseId?: string | null;
  discountPercent?: number;
  discountAmount?: number;
  taxRate?: number;
  description?: string;
}

export interface InvoiceTotalsOptions {
  lines: InvoiceLineInput[];
  /** Fixed header discount (wins over percent). */
  headerDiscount?: number;
  headerDiscountPercent?: number;
  /** Invoice-level tax rate % applied to net after header discount. */
  headerTaxRate?: number;
  /** Explicit tax amount (wins over headerTaxRate). */
  headerTaxAmount?: number;
  taxMode?: TaxMode;
  extraCharges?: number;
  /** Purchase freight — allocated into line unit costs. */
  freightAmount?: number;
  freightAllocation?: 'quantity' | 'value';
}

export interface ComputedInvoiceLine {
  productId: string;
  quantity: number;
  price: number;
  unitCost: number;
  description?: string;
  discountPercent: number;
  lineDiscount: number;
  gross: number;
  net: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

export interface InvoiceTotalsResult {
  lines: ComputedInvoiceLine[];
  subtotal: number;
  lineDiscountTotal: number;
  netBeforeHeaderDiscount: number;
  headerDiscount: number;
  netSubtotal: number;
  tax: number;
  extraCharges: number;
  freightAmount: number;
  grandTotal: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function lineDiscount(line: InvoiceLineInput, gross: number): number {
  const fixed = Number(line.discountAmount ?? 0);
  if (fixed > 0) return Math.min(fixed, gross);
  const pct = Math.max(0, Math.min(100, Number(line.discountPercent ?? 0)));
  return (gross * pct) / 100;
}

/** Compute all invoice monetary fields server-side. */
export function computeInvoiceTotals(opts: InvoiceTotalsOptions): InvoiceTotalsResult {
  const taxMode = opts.taxMode ?? 'exclusive';
  const extraCharges = Math.max(0, Number(opts.extraCharges ?? 0));
  const freightAmount = Math.max(0, Number(opts.freightAmount ?? 0));

  let subtotal = 0;
  let lineDiscountTotal = 0;
  const computedLines: ComputedInvoiceLine[] = [];

  for (const line of opts.lines) {
    const qty = Number(line.quantity) || 0;
    const price = Number(line.price) || 0;
    const unitCost = Number(line.unitCost ?? line.price) || 0;
    const gross = qty * price;
    const disc = lineDiscount(line, gross);
    const net = Math.max(0, gross - disc);
    const taxRate = Math.max(0, Number(line.taxRate ?? 0));
    let taxAmount = 0;
    let lineTotal = net;

    if (taxMode === 'exclusive' && taxRate > 0) {
      taxAmount = (net * taxRate) / 100;
      lineTotal = net + taxAmount;
    } else if (taxMode === 'inclusive' && taxRate > 0) {
      taxAmount = net - net / (1 + taxRate / 100);
      lineTotal = net;
    }

    subtotal += gross;
    lineDiscountTotal += disc;
    computedLines.push({
      productId: line.productId,
      quantity: qty,
      price,
      unitCost,
      description: line.description,
      discountPercent: Number(line.discountPercent ?? 0),
      lineDiscount: round2(disc),
      gross: round2(gross),
      net: round2(net),
      taxRate,
      taxAmount: round2(taxAmount),
      total: round2(lineTotal),
    });
  }

  const netBeforeHeaderDiscount = Math.max(0, subtotal - lineDiscountTotal);
  const explicitHeaderDisc = Number(opts.headerDiscount ?? 0);
  const headerPct = Number(opts.headerDiscountPercent ?? 0);
  const headerDiscount =
    explicitHeaderDisc > 0
      ? Math.min(explicitHeaderDisc, netBeforeHeaderDiscount)
      : (netBeforeHeaderDiscount * Math.max(0, Math.min(100, headerPct))) / 100;

  const netSubtotal = Math.max(0, netBeforeHeaderDiscount - headerDiscount);

  const lineTaxSum = computedLines.reduce((s, l) => s + l.taxAmount, 0);
  const explicitTax = Number(opts.headerTaxAmount ?? 0);
  const headerTaxRate = Number(opts.headerTaxRate ?? 0);
  let tax = lineTaxSum;
  if (explicitTax > 0) {
    tax = explicitTax;
  } else if (headerTaxRate > 0 && lineTaxSum === 0) {
    tax = taxMode === 'inclusive'
      ? netSubtotal - netSubtotal / (1 + headerTaxRate / 100)
      : (netSubtotal * headerTaxRate) / 100;
  }

  const grandTotal = round2(netSubtotal + tax + extraCharges + freightAmount);

  return {
    lines: computedLines,
    subtotal: round2(subtotal),
    lineDiscountTotal: round2(lineDiscountTotal),
    netBeforeHeaderDiscount: round2(netBeforeHeaderDiscount),
    headerDiscount: round2(headerDiscount),
    netSubtotal: round2(netSubtotal),
    tax: round2(tax),
    extraCharges: round2(extraCharges),
    freightAmount: round2(freightAmount),
    grandTotal,
  };
}

/** Spread freight across purchase lines by quantity or value. */
export function allocateFreightToLines(
  lines: ComputedInvoiceLine[],
  freightAmount: number,
  mode: 'quantity' | 'value' = 'value',
): ComputedInvoiceLine[] {
  if (freightAmount <= 0 || lines.length === 0) return lines;

  const basis = mode === 'quantity'
    ? lines.reduce((s, l) => s + l.quantity, 0)
    : lines.reduce((s, l) => s + l.net, 0);

  if (basis <= 0) return lines;

  return lines.map(l => {
    const share = mode === 'quantity' ? l.quantity / basis : l.net / basis;
    const freightShare = (freightAmount * share) / Math.max(l.quantity, 1);
    return {
      ...l,
      unitCost: round2(l.unitCost + freightShare),
    };
  });
}

/** Payment status from amounts and due date. */
export function derivePaymentStatus(params: {
  paidAmount: number;
  grandTotal: number;
  dueDate?: Date | null;
  invoiceDate?: Date;
  paymentTermsDays?: number;
}): 'unpaid' | 'partial' | 'paid' | 'overdue' {
  const due = Math.max(0, params.grandTotal);
  const paid = Math.max(0, params.paidAmount);

  if (due <= 0.01 || paid >= due - 0.01) return 'paid';
  if (paid <= 0.01) {
    const base = params.dueDate ?? addDays(params.invoiceDate ?? new Date(), params.paymentTermsDays ?? 0);
    if (base && base < startOfDay(new Date())) return 'overdue';
    return 'unpaid';
  }
  return 'partial';
}

/** Map legacy form values (cash/credit) to initial paid amount. */
export function resolveInitialPayment(params: {
  paymentStatus?: string;
  grandTotal: number;
  paidAmount?: number;
}): { paidAmount: number; paymentStatus: string } {
  let paidAmount = Number(params.paidAmount ?? 0);
  const status = params.paymentStatus;
  
  if (status === 'cash' || status === 'paid') {
    paidAmount = params.grandTotal;
  } else if (status === 'unpaid') {
    paidAmount = 0;
  } else if (status === 'partial') {
    paidAmount = Math.max(0, Math.min(paidAmount, params.grandTotal));
  } else {
    // If no specific status or invalid status, clamp explicit amount
    paidAmount = Math.max(0, Math.min(paidAmount, params.grandTotal));
  }

  return {
    paidAmount,
    paymentStatus: derivePaymentStatus({ paidAmount, grandTotal: params.grandTotal }),
  };
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function invoiceAmountDue(grandTotal: number, paidAmount: number): number {
  return Math.max(0, round2(grandTotal - paidAmount));
}
