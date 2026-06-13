/**
 * E2E-only helper to unblock auth when the database is seeded but
 * system_settings.initialized is still false.
 *
 * This script is intentionally minimal:
 * - it never bootstraps business data
 * - it only marks the singleton system settings row as initialized
 * - it refuses to run outside an isolated E2E database
 */

import { PrismaClient } from '@prisma/client';
import { assertIsolatedDatabase } from './assert-isolated-db';

function assertAllowed(): void {
  if (process.env.E2E_ALLOW_AUTH_RESET === '1') return;
  if (process.env.NODE_ENV === 'development') return;
  if (process.env.ALLOW_SEED === 'true') return;
  throw new Error(
    '❌ System initialization helper is disabled. Set E2E_ALLOW_AUTH_RESET=1 (CI) or NODE_ENV=development.'
  );
}

async function main() {
  assertIsolatedDatabase();
  assertAllowed();

  const prisma = new PrismaClient();
  try {
    const current = await prisma.systemSettings.findFirst();

    if (!current) {
      await prisma.systemSettings.create({
        data: {
          initialized: true,
          locked: false,
          productionMode: false,
        },
      });
      console.log('[ensure-system-initialized] created system settings and marked initialized');
      return;
    }

    await prisma.systemSettings.update({
      where: { id: current.id },
      data: {
        initialized: true,
        locked: false,
        initLock: null,
        initLockId: null,
        productionMode: false,
      },
    });

    console.log('[ensure-system-initialized] marked system initialized');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[ensure-system-initialized] failed:', error);
  process.exit(1);
});
