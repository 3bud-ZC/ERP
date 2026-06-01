import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['query', 'error', 'warn'],
})

// Cache Prisma client globally in ALL environments to prevent connection pool exhaustion
globalForPrisma.prisma = prisma

// IMPORTANT: tenant-isolation middleware removed deliberately.
// The previous middleware in lib/prisma-tenant-middleware.ts had two critical bugs:
//   1. It injected tenantId into queries on child tables that lack the field
//      (e.g. SalesInvoiceItem, PurchaseInvoiceItem, JournalEntryLine), producing
//      "Unknown argument tenantId" errors on every delete/update/findMany.
//   2. It used a process-global mutable variable for the current tenant, which
//      is unsafe in a Node.js server with concurrent requests (cross-tenant leak).
// Tenant scoping is now done explicitly per-route via
//   findFirst({ where: { id, tenantId: user.tenantId } })
// which is safer, race-free, and works for all model shapes.

// IMPORTANT:
// Do NOT call `prisma.$connect()` on module import.
// In Next.js, this file can be evaluated during build-time (`next build`) and in edge cases
// where the DB is not reachable, it causes repeated connection attempts + noisy logs.
// Prisma connects lazily on the first query, and health endpoints already validate DB reachability.
