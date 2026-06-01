export class InvoiceExecutionError extends Error {
  constructor(
    public code: 'INVOICE_FAILED' | 'INVENTORY_FAILED' | 'ACCOUNTING_FAILED' | 'VALIDATION_FAILED',
    message: string,
    public cause?: Error,
  ) {
    super(message);
    this.name = 'InvoiceExecutionError';
  }
}
