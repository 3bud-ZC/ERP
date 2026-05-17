/**
 * ERP Event Handlers — Phase 6C: legacy posting disabled; use canonical API services.
 */

import { DomainEventType, EventHandler } from './workflow-engine';

const noop = async (): Promise<void> => undefined;

export const quotationAcceptedHandler: EventHandler = {
  eventType: DomainEventType.QuotationAccepted,
  handler: noop,
};

export const invoiceCreatedHandler: EventHandler = {
  eventType: DomainEventType.InvoiceCreated,
  handler: noop,
};

export const invoicePaidHandler: EventHandler = {
  eventType: DomainEventType.InvoicePaid,
  handler: noop,
};

export const salesReturnApprovedHandler: EventHandler = {
  eventType: DomainEventType.SalesReturnApproved,
  handler: noop,
};

export const purchaseOrderConfirmedHandler: EventHandler = {
  eventType: DomainEventType.PurchaseOrderCreated,
  handler: noop,
};

export const purchaseInvoiceCreatedHandler: EventHandler = {
  eventType: DomainEventType.PurchaseInvoiceCreated,
  handler: noop,
};

export const purchaseReturnApprovedHandler: EventHandler = {
  eventType: DomainEventType.PurchaseReturnApproved,
  handler: noop,
};

export const paymentMadeHandler: EventHandler = {
  eventType: DomainEventType.PaymentMade,
  handler: noop,
};

export const stockConsumedHandler: EventHandler = {
  eventType: DomainEventType.StockConsumed,
  handler: noop,
};

export const stockTransferredHandler: EventHandler = {
  eventType: DomainEventType.StockTransferred,
  handler: noop,
};

export const stockAdjustedHandler: EventHandler = {
  eventType: DomainEventType.StockAdjusted,
  handler: noop,
};

export const productionOrderStartedHandler: EventHandler = {
  eventType: DomainEventType.ProductionOrderStarted,
  handler: noop,
};

export const productionOrderCompletedHandler: EventHandler = {
  eventType: DomainEventType.ProductionOrderCompleted,
  handler: noop,
};

import { workflowEngine } from './workflow-engine';

export function registerAllEventHandlers(): void {
  workflowEngine.registerHandler(quotationAcceptedHandler);
  workflowEngine.registerHandler(invoiceCreatedHandler);
  workflowEngine.registerHandler(invoicePaidHandler);
  workflowEngine.registerHandler(salesReturnApprovedHandler);
  workflowEngine.registerHandler(purchaseOrderConfirmedHandler);
  workflowEngine.registerHandler(purchaseInvoiceCreatedHandler);
  workflowEngine.registerHandler(purchaseReturnApprovedHandler);
  workflowEngine.registerHandler(paymentMadeHandler);
  workflowEngine.registerHandler(stockConsumedHandler);
  workflowEngine.registerHandler(stockTransferredHandler);
  workflowEngine.registerHandler(stockAdjustedHandler);
  workflowEngine.registerHandler(productionOrderStartedHandler);
  workflowEngine.registerHandler(productionOrderCompletedHandler);
}
