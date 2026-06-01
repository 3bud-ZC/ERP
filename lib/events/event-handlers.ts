/**
 * Event Handlers — legacy inventory/GL side effects disabled (canonical services only).
 */

import { DomainEvent } from './domain-events';
import { EventHandler } from './event-bus';
import {
  isPurchaseCreated,
  isSalesInvoiceCreated,
  isStockUpdated,
  isPaymentReceived,
  isJournalEntryPosted,
} from './domain-events';

export class PurchaseCreatedHandler implements EventHandler {
  eventType = 'PurchaseCreated';

  async handle(event: DomainEvent): Promise<void> {
    if (!isPurchaseCreated(event)) return;
  }
}

export class SalesInvoiceCreatedHandler implements EventHandler {
  eventType = 'SalesInvoiceCreated';

  async handle(event: DomainEvent): Promise<void> {
    if (!isSalesInvoiceCreated(event)) return;
  }
}

export class StockUpdatedHandler implements EventHandler {
  eventType = 'StockUpdated';

  async handle(event: DomainEvent): Promise<void> {
    if (!isStockUpdated(event)) return;
  }
}

export class PaymentReceivedHandler implements EventHandler {
  eventType = 'PaymentReceived';

  async handle(event: DomainEvent): Promise<void> {
    if (!isPaymentReceived(event)) return;
  }
}

export class JournalEntryPostedHandler implements EventHandler {
  eventType = 'JournalEntryPosted';

  async handle(event: DomainEvent): Promise<void> {
    if (!isJournalEntryPosted(event)) return;
  }
}

export const eventHandlers: EventHandler[] = [
  new PurchaseCreatedHandler(),
  new SalesInvoiceCreatedHandler(),
  new StockUpdatedHandler(),
  new PaymentReceivedHandler(),
  new JournalEntryPostedHandler(),
];

export function registerHandlers(eventBus: {
  subscribe: (type: string, handler: EventHandler) => void;
}): void {
  for (const handler of eventHandlers) {
    eventBus.subscribe(handler.eventType, handler);
  }
}
