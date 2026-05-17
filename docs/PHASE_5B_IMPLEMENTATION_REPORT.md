# Phase 5B — ERP Core Stabilization & Consistency Layer

**Site:** https://og-estore.site  
**Date:** 2026-05-17  
**Status:** Implemented (deploy after backup + smoke tests)

---

## 1. Summary

Phase 5B unifies invoice mutations behind a single execution architecture: canonical stock movement, costing bridge, posting guards, tenant posting profiles, and journal reversal on edit/cancel/returns. Legacy force-save PUT paths and duplicate event-handler posting were removed or no-op’d.

---

## 2. Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| `invoice-execution.service.ts` + `invoice-execution-mutations.ts` | Create vs update/cancel/return split keeps 5A stable while 5B adds republish |
| `inventory-movement.service.ts` | Single entry for outflow/inflow/reversal; no direct `Product.stock` in routes |
| `posting-guard.service.ts` | `assertCanPostInvoice`, `hasPostedJournalEntry`, idempotency via `correlationId` |
| `accounting-posting-profile.service.ts` | Per-tenant GL codes in `Tenant.settings.postingProfile` with hardcoded fallback |
| `journal-reversal.service.ts` | Delete + balance unwind inside tx (republish/cancel) |
| `audit-trail.service.ts` | Unified `recordAuditTrail` for API layers |
| Event handlers no-op for returns | Prevents double JE/stock when API already calls canonical approve |

---

## 3. Files Modified / Added

### New services
- `lib/services/accounting-posting-profile.service.ts`
- `lib/services/posting-guard.service.ts`
- `lib/services/inventory-movement.service.ts`
- `lib/services/journal-reversal.service.ts`
- `lib/services/audit-trail.service.ts`
- `lib/services/invoice-execution-mutations.ts`
- `lib/utils/map-execution-items.ts`

### Updated core
- `lib/services/invoice-execution.service.ts` — create uses movement + profile + guards; re-exports mutations
- `lib/services/invoice-accounting.service.ts` — `PostingProfile` on all builders; `correlationId` on post
- `lib/event-handlers.ts` — return approve handlers no-op

### API routes
- `app/api/sales-invoices/route.ts` — PUT → `executeUpdateSalesInvoice` / cancel
- `app/api/purchase-invoices/route.ts` — PUT → `executeUpdatePurchaseInvoice` / cancel
- `app/api/sales-returns/route.ts` — approve → `executeApproveSalesReturn`
- `app/api/purchase-returns/route.ts` — approve → `executeApprovePurchaseReturn`
- `app/api/sales-orders/[id]/convert-to-invoice/route.ts` — `executeCreateSalesInvoice`
- `app/api/purchase-orders/[id]/convert-to-invoice/route.ts` — `executeCreatePurchaseInvoice`

### UI (light)
- `components/invoices/DocumentStatusBadge.tsx`
- `components/invoices/InvoiceDetail.tsx` — status badge + paid allocation line

### Tests
- `tests/integration/phase-5b-invoice-flows.test.ts`

---

## 4. Flow Coverage

| Flow | Path |
|------|------|
| Create sales/purchase invoice | `executeCreate*` (POST routes) |
| Update posted invoice | `executeUpdate*` → reverse JE/stock → republish |
| Cancel invoice | `executeCancel*` |
| Sales/purchase return approve | `executeApprove*Return` |
| SO/PO full convert | convert routes → `executeCreate*` |
| Partial SO invoice | `partial-invoice` (5A, unchanged) |

---

## 5. Posting Profile Configuration

Add to tenant settings JSON:

```json
{
  "postingProfile": {
    "cash": "1001",
    "ar": "1020",
    "ap": "2010",
    "inventory": "1030",
    "revenue": "4010",
    "cogs": "5010",
    "taxPayable": "2030",
    "taxInput": "2030",
    "adjustment": "5070"
  }
}
```

Omit keys to use defaults from `INVOICE_ACCOUNTS`.

---

## 6. Risks Remaining

1. **DELETE handlers** still use legacy cascade (not republish-aware costing reversal).
2. **Workflow events** for invoice create may still fire duplicate handlers in some paths — audit if `transitionEntity` used on invoice POST.
3. **Republish** creates reversal inventory rows then deletes originals — monitor layer integrity on heavily edited invoices.
4. **Purchase return JE** reuses sales-return reversal pattern — may need dedicated purchase-return builder later.
5. **Integration tests** are unit-level; full DB integration tests need test DB + seed.

---

## 7. Manual QA Checklist

- [ ] Create sales invoice (posted) → stock ↓, JE balanced, COGS lines
- [ ] Edit qty on posted sales invoice → old JE gone, new JE, stock net correct
- [ ] Cancel sales invoice → stock restored, JE removed, status `cancelled`
- [ ] Approve sales return → stock ↑, reversing JE, no duplicate on second approve
- [ ] Convert SO → invoice → stock/JE same as direct create
- [ ] Partial SO invoice → remaining qty on order correct
- [ ] Repeat approve/POST with same doc → 400 “already posted”
- [ ] Purchase mirror of above
- [ ] Custom `postingProfile` in tenant settings → JE uses custom codes

---

## 8. VPS Deploy Steps

1. **Backup DB:** `pg_dump` or `deployment/scripts/backup.sh`
2. Pull code on VPS; `npm ci && npm run build`
3. No new Prisma migration required (uses existing `Tenant.settings`, `JournalEntry.correlationId`)
4. Restart app: `pm2 restart ecosystem` or `deployment/scripts/restart.sh`
5. Smoke: create draft invoice → post → edit one line → verify balances
6. Rollback: restore DB backup + previous release tag if JE/stock diverge

---

## 9. Rollback Notes

- Reverting code restores legacy PUT force-save (not recommended).
- If bad JEs posted after deploy, use accounting module to identify `referenceType` + `referenceId` and reverse manually.
- Clear posting profile cache not required on rollback (in-memory only).

---

## 10. Recommended Next Phases

- **5C:** Payment allocation rollback + idempotency on `executeCreatePayment`
- **5D:** DELETE/cascade through canonical reversal services
- **5E:** Full DB integration test suite + deadlock retry wrapper
- **6A:** Stock reservations on SO partial convert
