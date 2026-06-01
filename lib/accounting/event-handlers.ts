/**
 * Accounting Event Handlers — legacy GL posting disabled (canonical services only).
 */

import { EventHandler } from '../events/event-bus';
import { DomainEvent } from '../events/domain-events';
import {
  isSalesInvoiceCreated,
  isPurchaseCreated,
  isPaymentReceived,
  isStockUpdated,
  isJournalEntryPosted,
} from '../events/domain-events';

async function noopFinancialHandler(_event: DomainEvent): Promise<void> {
  return;
}

export class SalesInvoiceAccountingHandler implements EventHandler {
  eventType = 'SalesInvoiceCreated';

  async handle(event: DomainEvent): Promise<void> {
    if (!isSalesInvoiceCreated(event)) return;
    await noopFinancialHandler(event);
  }
}

export class PurchaseAccountingHandler implements EventHandler {
  eventType = 'PurchaseCreated';

  async handle(event: DomainEvent): Promise<void> {
    if (!isPurchaseCreated(event)) return;
    await noopFinancialHandler(event);
  }
}

export class PaymentAccountingHandler implements EventHandler {
  eventType = 'PaymentReceived';

  async handle(event: DomainEvent): Promise<void> {
    if (!isPaymentReceived(event)) return;
    await noopFinancialHandler(event);
  }
}

export class StockValuationHandler implements EventHandler {
  eventType = 'StockUpdated';

  async handle(event: DomainEvent): Promise<void> {
    if (!isStockUpdated(event)) return;
    await noopFinancialHandler(event);
  }
}

export class JournalEntryPostedHandler implements EventHandler {
  eventType = 'JournalEntryPosted';

  async handle(event: DomainEvent): Promise<void> {
    if (!isJournalEntryPosted(event)) return;
    await noopFinancialHandler(event);
  }
}

export const accountingEventHandlers: EventHandler[] = [
  new SalesInvoiceAccountingHandler(),
  new PurchaseAccountingHandler(),
  new PaymentAccountingHandler(),
  new StockValuationHandler(),
  new JournalEntryPostedHandler(),
];

export function registerAccountingHandlers(eventBus: {
  subscribe: (type: string, handler: EventHandler) => void;
}): void {
  for (const handler of accountingEventHandlers) {
    eventBus.subscribe(handler.eventType, handler);
  }
}
