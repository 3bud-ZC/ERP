# FINAL ERP AUDIT REPORT

Generated: 2026-05-17T17:02:01.566134Z  
Source: local project (flash-drive merge, NOT remote git)

## Summary

| Metric | Count |
|--------|------:|
| Git changed paths | 257 |
| Modified (M) | 255 |
| Untracked (??) | 2 |
| Execution services | 19 |
| Prisma migrations | 7 |

## Canonical execution services

- `lib/services/accounting-posting-profile.service.ts`
- `lib/services/audit-trail.service.ts`
- `lib/services/execution-errors.ts`
- `lib/services/inventory-accounting.service.ts`
- `lib/services/inventory-movement.service.ts`
- `lib/services/invoice-accounting.service.ts`
- `lib/services/invoice-execution-mutations.ts`
- `lib/services/invoice-execution.service.ts`
- `lib/services/journal-reversal.service.ts`
- `lib/services/party-balance.service.ts`
- `lib/services/payment-execution.service.ts`
- `lib/services/posting-guard.service.ts`
- `lib/services/production-accounting.service.ts`
- `lib/services/production-execution.service.ts`
- `lib/services/production-waste-execution.service.ts`
- `lib/services/stock-adjustment-execution.service.ts`
- `lib/services/stock-transfer-execution.service.ts`
- `lib/services/stocktake-execution.service.ts`
- `lib/services/warehouse-stock.service.ts`

## Prisma migrations

- `prisma/migrations/20260420205303_add_device_tracking_to_session/migration.sql`
- `prisma/migrations/20260421203752_/migration.sql`
- `prisma/migrations/20260426194000_add_invoice_form_fields/migration.sql`
- `prisma/migrations/20260427000000_add_isactive_to_business_entities/migration.sql`
- `prisma/migrations/20260517000000_add_system_settings/migration.sql`
- `prisma/migrations/20260517120000_add_code_sequence/migration.sql`
- `prisma/migrations/20260517120000_warehouse_stock/migration.sql`

## Major systems implemented

- Canonical invoice engine (`invoice-execution.service`, `invoice-execution-mutations`)
- FIFO/WAC costing (`inventory-costing`, `inventory-costing-bridge`)
- Inventory movement single path (`inventory-movement.service`)
- Warehouse stock (`warehouse-stock.service`, migration `20260517120000_warehouse_stock`)
- Payment canonical execution (`payment-execution.service`)
- Invoice delete/reversal (`executeDeleteInvoice`, journal + stock + payment reversal)
- Journal reversal (`journal-reversal.service`)
- Posting guard + idempotency (`posting-guard.service`, `assertJournalEntryCanPost`)
- Manufacturing atomic execution (`production-execution.service`)
- Stocktake / transfer / adjustment / waste execution services
- Unified auto-codes (`code-sequence.service`)
- ERP engine legacy GL/inventory posting disabled for canonical types
- Event/accounting handlers financial posting disabled
- `execution-errors.ts` breaks circular import for production build

## APIs using canonical flows

- `app/api/sales-invoices` → executeCreate/Update/Delete/Cancel invoice services
- `app/api/purchase-invoices` → same
- `app/api/payments` → executeCreate/Update/Delete payment
- Production/stock APIs → execution services (verify per-route)

## UI features verified

| Feature | Status |
|---------|--------|
| Product / Raw Material separation | Present (`/inventory/raw-materials`, `ProductInventoryPage`, `type` filter) |
| Auto customer code | Present (`customers/route` + `CODE_ENTITY_KEYS.CUSTOMER`) |
| Auto vendor/supplier code | Present (`suppliers/route` + `CODE_ENTITY_KEYS.SUPPLIER`) |
| Warehouse-aware inventory UI | Present (`warehouses`, `ProductInventoryPage`, warehouse migration) |
| Product type filtering | Present |
| Inventory page improvements | Present (`ProductInventoryPage`, inventory hub) |
| Manufacturing UI | Present (production orders, BOM, lines, waste) |
| Payment allocation visibility | Added `/accounting/payments` |
| Status badges | Present (`getStatusBadge`, dashboard, invoice lists) |
| Dashboard improvements | Present (enhanced dashboard page) |

## Remaining legacy paths (non-canonical JE / stock)

- `lib/accounting.ts`, `lib/accounting/journal-entry.service.ts` — manual JE (accruals, fixed-assets, expenses, journal-entries API)
- `lib/inventory-transactions.ts` — legacy stock helpers (not used by canonical invoice path)
- `lib/sales/sales-invoice.service.ts` — legacy direct JE create
- `lib/erp-execution-engine/services/journal-service.ts` — legacy (adapter returns [] for canonical types)
- `app/api/journal-entries`, `accruals`, `fixed-assets`, `expenses` — legacy accounting module

## Build status (local)

- `tsc --noEmit`: PASS
- `next build`: PASS

## All changed files (git status)

```
M .claude/launch.json
M .env.example
M .eslintrc.json
M .github/workflows/ci.yml
M .gitignore
M README.md
M app/(dashboard)/dashboard/page.tsx
M app/(dashboard)/layout.tsx
M app/api/accounting-periods/route.ts
M app/api/accounting/aging-report/route.ts
M app/api/accounting/balance-sheet/route.ts
M app/api/accounting/balances/route.ts
M app/api/accounting/budgets/route.ts
M app/api/accounting/cash-flow/route.ts
M app/api/accounting/cost-engine/route.ts
M app/api/accounting/income-statement/route.ts
M app/api/accounting/journal-entries/[id]/post/route.ts
M app/api/accounting/journal-entries/[id]/reverse/route.ts
M app/api/accounting/journal-entries/[id]/route.ts
M app/api/accounting/journal-entries/route.ts
M app/api/accounting/periods/[id]/close/route.ts
M app/api/accounting/trial-balance/route.ts
M app/api/accounts/[accountId]/ledger/route.ts
M app/api/accounts/route.ts
M app/api/accruals/route.ts
M app/api/activity-logs/route.ts
M app/api/auth/login/route.ts
M app/api/batches/route.ts
M app/api/bom/route.ts
M app/api/companies/route.ts
M app/api/dashboard/route.ts
M app/api/dashboards/accounting/route.ts
M app/api/dashboards/financial/route.ts
M app/api/dashboards/inventory/route.ts
M app/api/dashboards/purchase/route.ts
M app/api/dashboards/sales/route.ts
M app/api/erp/execute/route.ts
M app/api/erp/system-check/route.ts
M app/api/expenses/route.ts
M app/api/fixed-assets/route.ts
M app/api/health/detailed/route.ts
M app/api/health/route.ts
M app/api/init/route.ts
M app/api/inventory/expiry-alerts/route.ts
M app/api/inventory/low-stock-alerts/route.ts
M app/api/journal-entries/[id]/post/route.ts
M app/api/journal-entries/[id]/reverse/route.ts
M app/api/journal-entries/route.ts
M app/api/onboarding/init/route.ts
M app/api/onboarding/route.ts
M app/api/pdf/[type]/[id]/route.ts
M app/api/production-lines/route.ts
M app/api/purchase-invoices/route.ts
M app/api/purchase-orders/route.ts
M app/api/purchase-requisitions/[id]/convert/route.ts
M app/api/purchase-requisitions/route.ts
M app/api/purchases/reports/route.ts
M app/api/purchasing/three-way-match/route.ts
M app/api/quotations/[id]/convert/route.ts
M app/api/quotations/route.ts
M app/api/reports/aging/route.ts
M app/api/reports/balance-sheet/route.ts
M app/api/reports/customer-statement/route.ts
M app/api/reports/profit-loss/route.ts
M app/api/reports/route.ts
M app/api/reports/supplier-statement/route.ts
M app/api/resilience/health/route.ts
M app/api/resilience/stress-test/route.ts
M app/api/sales-invoices/route.ts
M app/api/sales-orders/backorders/route.ts
M app/api/sales-orders/fulfillment/route.ts
M app/api/sales-orders/route.ts
M app/api/sessions/route.ts
M app/api/setup/route.ts
M app/api/system/api-standardization/route.ts
M app/api/system/data-integrity/route.ts
M app/api/system/final-status/route.ts
M app/api/system/performance/route.ts
M app/api/system/status/route.ts
M app/api/tenants/route.ts
M app/demo/page.tsx
M app/globals.css
M app/login/page.tsx
M app/onboarding/page.tsx
M components/accounting/AccountingLayout.tsx
M components/invoices/InvoicePrintTemplate.tsx
M components/layout/Workspace.tsx
M components/providers/AppProviders.tsx
M components/ui/button.tsx
M components/ui/textarea.tsx
M deployment/.env.development.example
M deployment/.env.production.example
M deployment/DEPLOYMENT_STEPS.md
M deployment/FINAL_DEPLOYMENT_FLOW.md
M deployment/LOGROTATE_RECOMMENDATIONS.md
M deployment/MONITORING_RECOVERY.md
M deployment/NGINX_SSL_GUIDE.md
M deployment/PRE_DEPLOYMENT_CHECKLIST.md
M deployment/README-auto_certbot.md
M deployment/README.md
M deployment/TROUBLESHOOTING.md
M deployment/UBUNTU_VPS_EXECUTION_PLAN.md
M deployment/VPS_ARCHITECTURE.md
M deployment/VPS_CHECKLIST.md
M deployment/add-init-env.py
M deployment/auto-certbot.service
M deployment/ecosystem.config.js
M deployment/erp-system.service
M deployment/nginx.conf
M deployment/nginx.docker.conf
M e2e/.gitignore
M e2e/README.md
M e2e/accounting/journal.spec.ts
M e2e/auth/login.spec.ts
M e2e/customers/customers.spec.ts
M e2e/fixtures/auth-helpers.ts
M e2e/fixtures/credentials.ts
M e2e/fixtures/form-helpers.ts
M e2e/global.setup.ts
M e2e/inventory/products.spec.ts
M e2e/sales/invoices.spec.ts
M e2e/scripts/assert-isolated-db.ts
M e2e/scripts/reset-admin-password.ts
M lib/accounting/accounting.service.ts
M lib/accounting/event-handlers.ts
M lib/accounting/period.service.ts
M lib/accounting/validation.service.ts
M lib/aggregation-queries.ts
M lib/api-latency-tracker.ts
M lib/api-response.ts
M lib/api/api-errors.ts
M lib/api/client.ts
M lib/api/rate-limit.ts
M lib/api/safe-response.ts
M lib/audit/audit-logger.ts
M lib/audit/audit.middleware.ts
M lib/audit/audit.service.ts
M lib/auth.ts
M lib/auth/requireAuth.ts
M lib/authorization/authorization.middleware.ts
M lib/authorization/authorization.service.ts
M lib/background-jobs.ts
M lib/business-rules.ts
M lib/cache.ts
M lib/chart-of-accounts.ts
M lib/consistency-rules.ts
M lib/dashboard-helpers.ts
M lib/db.ts
M lib/env.ts
M lib/erp-execution-engine/adapters/accounting-adapter.ts
M lib/erp-execution-engine/adapters/inventory-adapter.ts
M lib/erp-execution-engine/erp-execution-engine.ts
M lib/erp-execution-engine/index.ts
M lib/erp-execution-engine/routers/business-router.ts
M lib/erp-execution-engine/services/audit-service.ts
M lib/erp-execution-engine/services/event-bus.ts
M lib/erp-execution-engine/services/journal-service.ts
M lib/erp-execution-engine/services/state-loader.ts
M lib/erp-execution-engine/services/workflow-repository.ts
M lib/erp-execution-engine/types.ts
M lib/erp-execution-engine/validators/transaction-validator.ts
M lib/erp-execution-engine/workflow/workflow-engine.ts
M lib/events/domain-events.ts
M lib/events/erp-event-handlers.ts
M lib/events/event-bus.ts
M lib/events/event-dispatcher.ts
M lib/events/event-handlers.ts
M lib/events/event-integration.ts
M lib/events/event-persistence.ts
M lib/events/event-processor-worker.ts
M lib/events/registered-handlers.ts
M lib/events/retry-mechanism.ts
M lib/format.ts
M lib/inventory-costing-bridge.ts
M lib/inventory.ts
M lib/jobs/job-queue.ts
M lib/logger.ts
M lib/middleware/global-error-handler.ts
M lib/middleware/global-security.ts
M lib/middleware/idempotency.ts
M lib/middleware/request-context.ts
M lib/payment-reconciliation.ts
M lib/pdf-templates.ts
M lib/performance/cache.service.ts
M lib/performance/index-audit.ts
M lib/performance/query-optimizer.ts
M lib/permissions-config.ts
M lib/prisma-tenant-middleware.ts
M lib/rate-limit.ts
M lib/reporting/financial-reports.service.ts
M lib/reporting/inventory-reports.service.ts
M lib/resilience/adaptive-cache.ts
M lib/resilience/circuit-breaker.ts
M lib/resilience/health-intelligence.ts
M lib/resilience/index.ts
M lib/resilience/self-healing.ts
M lib/resilience/stress-test.ts
M lib/sales/sales-invoice.service.ts
M lib/seed-demo-data.ts
M lib/services/inventory-movement.service.ts
M lib/services/invoice-accounting.service.ts
M lib/services/invoice-execution-mutations.ts
M lib/services/invoice-execution.service.ts
M lib/services/journal-reversal.service.ts
M lib/services/party-balance.service.ts
M lib/services/payment-execution.service.ts
M lib/services/posting-guard.service.ts
M lib/services/production-execution.service.ts
M lib/services/production-waste-execution.service.ts
M lib/services/stock-adjustment-execution.service.ts
M lib/services/stock-transfer-execution.service.ts
M lib/services/stocktake-execution.service.ts
M lib/store/auth.ts
M lib/store/tenant.ts
M lib/structured-logger.ts
M lib/system-bootstrap.ts
M lib/system-state.ts
M lib/system/orchestrator/index.ts
M lib/system/orchestrator/system-orchestrator.ts
M lib/system/system-stabilization.ts
M lib/tenant-config.ts
M lib/types/accounting.ts
M lib/types/common.ts
M lib/types/inventory.ts
M lib/types/purchases.ts
M lib/types/sales.ts
M lib/utils.ts
M lib/utils/index.ts
M lib/validation/schemas.ts
M lib/validation/validation-engine.ts
M lib/validation/validation-integration.ts
M lib/workflow-engine.ts
M lib/workflow-state-machines.ts
M middleware.ts
M middleware.ts.bak-recovery
M netlify.toml
M next.config.js
M package-lock.json
M package.json
M playwright.config.ts
M prisma/accounting-schema.prisma
M prisma/migrations/20260420205303_add_device_tracking_to_session/migration.sql
M prisma/migrations/20260421203752_/migration.sql
M prisma/migrations/20260426194000_add_invoice_form_fields/migration.sql
M prisma/migrations/migration_lock.toml
M prisma/seed-auth.ts
M prisma/seed-clean.ts
M prisma/seed.ts
M render.yaml
M scripts/backup.ts
M scripts/railway-start.js
M scripts/reset-database.ts
M scripts/system-start.js
M tailwind.config.ts
M tests/domain/api-routes-contract.test.ts
?? app/(dashboard)/accounting/payments/
?? lib/services/execution-errors.ts
```
