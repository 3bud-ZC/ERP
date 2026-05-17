# Phase 6A — Manufacturing Atomic Execution

**Status:** Implemented  
**Live:** https://og-estore.site

## What was broken

1. RM journal posted on **pending** orders using `product.cost`, not FIFO COGS.
2. Stock and GL used **separate transactions** (`postJournalEntry` outside Prisma tx).
3. Completion JE posted **after** FG stock transaction committed.
4. Labor/overhead stored on WIP but **never posted** to GL.
5. DELETE used direct `product.stock` without costing reversal.
6. Event handlers could **duplicate** stock/JE with wrong WIP account (1040).

## What was fixed

- Single **Serializable** Prisma transaction per create/approve/complete/delete.
- Stock only via `applyProductionMaterialOutflow` / `applyProductionFinishedInflow`.
- GL only via `postJournalLinesInTransaction` with posting profile (`wip`, `laborExpense`, `overheadExpense`).
- Posting guard per sub-reference: `ProductionOrder:RM`, `:Labor`, `:Overhead`, `:Complete`.
- Approve = consume RM + post RM/Labor/Overhead JEs.
- Complete = FG inflow at `WIP.totalCost / qty` + completion JE.
- Delete = reverse all `ProductionOrder*` JEs + reverse stock movements.

## Files modified

- `lib/services/production-execution.service.ts` (new)
- `lib/services/production-accounting.service.ts` (new)
- `lib/services/inventory-movement.service.ts`
- `lib/services/posting-guard.service.ts`
- `lib/services/journal-reversal.service.ts`
- `lib/services/accounting-posting-profile.service.ts`
- `lib/services/invoice-accounting.service.ts` (default profile fields)
- `app/api/production-orders/route.ts`
- `lib/event-handlers.ts` (production handlers no-op)
- `tests/domain/production-accounting.test.ts` (new)

## VPS deploy

1. Backup DB
2. `git pull && npm ci && npm run build`
3. No migration required
4. `systemctl restart erp-system`
5. Smoke: create PO pending → approve → set waiting → complete → verify stock + 4 JEs (RM, Labor if any, Overhead if any, Complete)

## Validation checklist

- [ ] Pending create: no stock change, no JE
- [ ] Approve: RM stock down, RM+WIP JE balanced
- [ ] Complete: FG stock up, DR Inventory / CR WIP
- [ ] Delete: stock and JEs reversed
- [ ] Second approve on same order: blocked by posting guard

## Remaining (Phase 6D+)

- `app/api/production-waste/route.ts` still legacy direct stock
- Multi-warehouse balances (Phase 6E)
