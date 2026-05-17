/**
 * @deprecated Import from `@/lib/services/invoice-execution.service` instead.
 * Re-exports preserved for backward compatibility (Phase 4A callers).
 */

export {
  InvoiceExecutionError as TransactionError,
  createSalesInvoiceAtomic,
  createPurchaseInvoiceAtomic,
  handleTransactionError,
  executeCreateSalesInvoice,
  executeCreatePurchaseInvoice,
  executeApproveSalesReturn,
  mapExecutionError,
} from '@/lib/services/invoice-execution.service';
