import { backfillWarehouseStockFromProducts } from '../lib/services/warehouse-stock.service';
import { prisma } from '../lib/db';

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true } });
  let total = 0;
  for (const t of tenants) {
    total += await backfillWarehouseStockFromProducts(t.id);
  }
  console.log(`Backfilled ${total} warehouse stock rows`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
